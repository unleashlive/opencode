/**
 * Team chat rail for /collab/:id (SKU-1).
 *
 * A side-channel chat where participants ping each other with `@mentions`,
 * separate from the LLM prompt path.  Why it exists: the opencode editor inside
 * the iframe binds `@` to a file/agent picker, so there is no way to type a
 * user mention there.  This rail owns its own textarea and an autocomplete
 * popover that suggests session participants matching the current `@<partial>`.
 *
 * Submitted notes:
 *   - hit POST /collab/session/:id/note
 *   - broadcast `collab:note_added` (renders in everyone's feed)
 *   - emit `collab:mention` events for any @-mentions matching a real
 *     participant (badge + desktop notification handled in the CollabProvider)
 *
 * Previously this was a collapsible block stacked inside the one mixed sidebar.
 * It is now the right-hand rail of the session page: day dividers, author rows,
 * a typing line and the composer pinned to the bottom.  The rail collapses to a
 * 40px strip and remembers that choice in localStorage.
 */

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import { renderMentions } from "./mentions"
import { BTN_ICON } from "./ui"
import { clockTime, dayKey, dayLabel } from "./timeline-utils"
import type { Participant, CollabNote } from "@opencode-ai/collab"

const COLLAPSED_KEY = "collab:chat-rail-collapsed"

/** Match the `@<partial>` token at the current caret — only when the
 *  caret is right after a token that has no whitespace between `@` and
 *  the cursor.  Returns null when not in an active mention edit. */
function matchActiveMention(value: string, caret: number): { start: number; partial: string } | null {
  // Walk backwards from caret looking for `@` or whitespace.
  let i = caret - 1
  while (i >= 0) {
    const ch = value[i]!
    if (ch === "@") {
      // The `@` must be at start of string OR preceded by whitespace.
      if (i === 0 || /\s/.test(value[i - 1]!)) {
        const partial = value.slice(i + 1, caret)
        // Login chars only — bail if the partial contains anything weird.
        if (/^[A-Za-z0-9-]*$/.test(partial) && partial.length <= 39) {
          return { start: i, partial }
        }
      }
      return null
    }
    if (/\s/.test(ch)) return null
    i--
  }
  return null
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1"
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0")
  } catch {
    // private mode / storage disabled — the rail just forgets the choice
  }
}

export function TeamChatRail(props: {
  /** Hide the composer (Viewer role). */
  readonly?: boolean
  /**
   * "rail" is the desktop column: fixed width, collapsible to a strip.
   * "pane" is the mobile tab: full width, always expanded.
   */
  variant?: "rail" | "pane"
  class?: string
}) {
  const collab = useCollab()
  const isRail = () => (props.variant ?? "rail") === "rail"

  const [collapsed, setCollapsed] = createSignal(readCollapsed())
  const [text, setText] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const [highlightIdx, setHighlightIdx] = createSignal(0)
  let textareaRef: HTMLTextAreaElement | undefined

  const myLogin = () => collab.participants().find((p) => p.githubId === collab.meGithubId())?.githubLogin

  /** Everyone typing right now except the local user. */
  const typing = createMemo(() => {
    const me = myLogin()
    return [...collab.typingUsers()].filter((login) => login !== me)
  })

  const typingLabel = createMemo(() => {
    const who = typing()
    if (who.length === 0) return null
    if (who.length === 1) return `${who[0]} is typing`
    if (who.length === 2) return `${who[0]} and ${who[1]} are typing`
    return `${who.length} people are typing`
  })

  /** Notes bucketed into calendar days so the feed can show dividers. */
  const dayGroups = createMemo(() => {
    const groups: Array<{ key: string; label: string; notes: CollabNote[] }> = []
    const now = Date.now()
    for (const note of collab.notes()) {
      const at = note.createdAt instanceof Date ? note.createdAt : new Date(note.createdAt as unknown as string)
      const key = dayKey(at)
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.notes.push(note)
      else groups.push({ key, label: dayLabel(at, now), notes: [note] })
    }
    return groups
  })

  /** The active @-mention edit at the current caret, if any. */
  const activeMention = createMemo(() => {
    if (!textareaRef) return null
    return matchActiveMention(text(), textareaRef.selectionStart ?? text().length)
  })

  /** Up-to-6 participant suggestions whose login prefix-matches the
   *  active partial.  Sorted online-first so likely targets are at top. */
  const suggestions = createMemo<Participant[]>(() => {
    const active = activeMention()
    if (!active) return []
    const q = active.partial.toLowerCase()
    return collab
      .participants()
      .filter((p) => p.githubLogin.toLowerCase().startsWith(q))
      .sort((a, b) => Number(b.isOnline) - Number(a.isOnline))
      .slice(0, 6)
  })

  // Reading the rail is what marks mentions as read.
  createEffect(() => {
    if (!collapsed() && collab.unreadMentions() > 0) collab.clearMentions()
  })

  function toggleCollapsed() {
    const next = !collapsed()
    setCollapsed(next)
    writeCollapsed(next)
  }

  function insertSuggestion(p: Participant) {
    const active = activeMention()
    if (!active || !textareaRef) return
    const before = text().slice(0, active.start)
    const after = text().slice(textareaRef.selectionStart ?? text().length)
    const insertion = `@${p.githubLogin} `
    const next = before + insertion + after
    setText(next)
    setPopoverOpen(false)
    // Place caret right after the inserted login + trailing space.
    const caret = (before + insertion).length
    queueMicrotask(() => {
      textareaRef!.focus()
      textareaRef!.setSelectionRange(caret, caret)
    })
  }

  function handleKeyDown(e: KeyboardEvent) {
    // ⌘↵ / Ctrl+↵ submits regardless of popover state.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
      return
    }
    if (popoverOpen() && suggestions().length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlightIdx((i) => (i + 1) % suggestions().length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlightIdx((i) => (i - 1 + suggestions().length) % suggestions().length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const pick = suggestions()[highlightIdx()]
        if (pick) insertSuggestion(pick)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setPopoverOpen(false)
        return
      }
    }
  }

  function handleInput() {
    if (!textareaRef) return
    setText(textareaRef.value)
    const active = matchActiveMention(textareaRef.value, textareaRef.selectionStart ?? 0)
    if (active) {
      setPopoverOpen(true)
      setHighlightIdx(0)
    } else {
      setPopoverOpen(false)
    }
  }

  async function submit() {
    const content = text().trim()
    if (!content || sending()) return
    setSending(true)
    setError(null)
    try {
      await collab.postNote(content)
      setText("")
      setPopoverOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <Show
      when={!(isRail() && collapsed())}
      fallback={
        <aside class={`hidden w-10 shrink-0 flex-col items-center gap-2 border-l border-border-weak-base bg-surface-base py-2 md:flex ${props.class ?? ""}`}>
          <button type="button" onClick={toggleCollapsed} aria-label="Expand team chat" title="Expand team chat" class={BTN_ICON}>
            <ChevronLeft />
          </button>
          <span class="font-mono text-[10.5px] text-text-weak [writing-mode:vertical-rl]">team chat</span>
          <Show when={collab.notes().length > 0}>
            <span class="font-mono text-[10.5px] text-text-weaker [writing-mode:vertical-rl]">{collab.notes().length}</span>
          </Show>
          <Show when={collab.unreadMentions() > 0}>
            <span class="size-1.5 rounded-full bg-collab-accent" title={`${collab.unreadMentions()} unread mentions`} />
          </Show>
        </aside>
      }
    >
      <aside
        class={`flex w-full min-h-0 flex-col border-border-weak-base bg-surface-base md:w-[296px] md:shrink-0 md:border-l ${props.class ?? ""}`}
        aria-label="Team chat"
      >
        <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-weak-base px-3">
          <Show when={isRail()}>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Collapse team chat"
              title="Collapse team chat"
              class={`${BTN_ICON} -ml-1.5`}
            >
              <ChevronRight />
            </button>
          </Show>
          <span class="text-12-medium text-text-strong">Team chat</span>
          <span class="ml-auto font-mono text-[10.5px] text-text-weak">
            <Show when={collab.unreadMentions() > 0}>
              <span class="text-collab-accent">{collab.unreadMentions()}</span>
              <span class="text-text-weaker">/</span>
            </Show>
            {collab.notes().length}
          </span>
        </div>

        <NotesFeed groups={dayGroups()} />

        <div class="h-5 shrink-0 px-3">
          <Show when={typingLabel()}>
            {(label) => (
              <p class="flex items-center gap-1 truncate text-[11px] text-text-weaker" aria-live="polite">
                <span class="flex items-center gap-0.5" aria-hidden="true">
                  <For each={[0, 200, 400]}>
                    {(delay) => (
                      <span
                        class="size-1 rounded-full bg-collab-accent animate-pulse motion-reduce:animate-none"
                        style={{ "animation-delay": `${delay}ms` }}
                      />
                    )}
                  </For>
                </span>
                {label()}
              </p>
            )}
          </Show>
        </div>

        <Show
          when={!props.readonly}
          fallback={
            <p class="shrink-0 border-t border-border-weak-base px-3 py-2 font-mono text-[10.5px] text-text-weaker">
              viewer · read only
            </p>
          }
        >
          <div class="relative shrink-0 border-t border-border-weak-base p-2">
            <textarea
              ref={(el) => (textareaRef = el)}
              value={text()}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onSelect={handleInput /* keep activeMention() in sync with caret */}
              onFocus={() => collab.clearMentions()}
              placeholder="Message the team"
              rows={2}
              disabled={sending()}
              aria-label="Team chat message"
              class="w-full resize-none rounded-md border border-border-weak-base bg-surface-inset-base px-2 py-1.5 text-12-regular text-text-strong outline-none placeholder:text-text-weaker focus-visible:ring-2 focus-visible:ring-collab-accent-line disabled:text-text-weak"
            />
            <div class="flex items-center gap-2 pt-1">
              <span class="font-mono text-[10px] text-text-weaker">@ mention · cmd+enter send</span>
              <Show when={sending()}>
                <span class="ml-auto font-mono text-[10px] text-text-weak">sending…</span>
              </Show>
            </div>

            {/* Autocomplete popover */}
            <Show when={popoverOpen() && suggestions().length > 0}>
              <div
                class="absolute inset-x-2 bottom-full z-20 mb-1 overflow-hidden rounded-md border border-border-weak-base bg-surface-raised-base"
                style={{ "max-height": "200px", "overflow-y": "auto" }}
                role="listbox"
              >
                <For each={suggestions()}>
                  {(p, i) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={i() === highlightIdx()}
                      onMouseDown={(e) => {
                        // mousedown not click — click would fire after blur
                        e.preventDefault()
                        insertSuggestion(p)
                      }}
                      onMouseEnter={() => setHighlightIdx(i())}
                      classList={{
                        "flex w-full min-h-7 items-center gap-2 px-2 py-1 text-left text-12-regular transition-colors duration-150 ease-out motion-reduce:transition-none":
                          true,
                        "bg-collab-accent-soft text-collab-accent": i() === highlightIdx(),
                        "text-text-base hover:bg-surface-base-hover": i() !== highlightIdx(),
                      }}
                    >
                      <img
                        src={p.githubAvatarUrl || `https://github.com/${p.githubLogin}.png?size=24`}
                        alt=""
                        class="size-4 rounded-full"
                      />
                      <span class="font-mono text-[11px]">@{p.githubLogin}</span>
                      <Show when={p.isOnline}>
                        <span class="ml-auto size-1.5 rounded-full bg-surface-success-strong" title="Online" />
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show when={error()}>
              <p class="pt-1 text-[11px] text-text-on-critical-base">{error()}</p>
            </Show>
          </div>
        </Show>
      </aside>
    </Show>
  )
}

function NotesFeed(props: { groups: Array<{ key: string; label: string; notes: CollabNote[] }> }) {
  let scroller: HTMLDivElement | undefined
  // After every render, auto-scroll to the bottom IF the user was already at
  // (or within 40 px of) the bottom — preserves position when reading older
  // messages.
  let lastCount = 0
  const total = () => props.groups.reduce((sum, g) => sum + g.notes.length, 0)
  const onAfter = () => {
    if (!scroller) return
    const wasAtBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 40
    if (total() !== lastCount && (wasAtBottom || lastCount === 0)) {
      scroller.scrollTop = scroller.scrollHeight
    }
    lastCount = total()
  }
  createEffect(() => {
    total()
    queueMicrotask(onAfter)
  })
  onCleanup(() => (scroller = undefined))

  return (
    <div
      ref={(el) => (scroller = el)}
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2"
    >
      <Show
        when={props.groups.length > 0}
        fallback={
          <p class="rounded-md border border-dashed border-border-weak-base px-3 py-6 text-center text-12-regular text-text-weaker">
            No team messages yet.
          </p>
        }
      >
        <For each={props.groups}>
          {(group) => (
            <section>
              <div class="sticky top-0 z-10 -mx-3 bg-surface-base px-3 py-1">
                <span class="font-mono text-[10px] uppercase tracking-[0.06em] text-text-weaker">{group.label}</span>
              </div>
              <For each={group.notes}>
                {(n) => {
                  const at = () => (n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt as unknown as string))
                  return (
                    <article class="flex items-start gap-2 py-1">
                      <img
                        src={`https://github.com/${n.authorGithubLogin}.png?size=24`}
                        alt=""
                        class="mt-0.5 size-5 shrink-0 rounded-full"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="flex items-baseline gap-1.5">
                          <span class="truncate text-12-medium text-text-strong">{n.authorGithubLogin}</span>
                          <span class="ml-auto shrink-0 font-mono text-[10px] text-text-weaker">{clockTime(at())}</span>
                        </div>
                        <p class="text-12-regular text-text-base break-words whitespace-pre-wrap">
                          {renderMentions(n.content)}
                        </p>
                      </div>
                    </article>
                  )
                }}
              </For>
            </section>
          )}
        </For>
      </Show>
    </div>
  )
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="size-4">
      <path d="M7.5 4.5 13 10l-5.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="size-4">
      <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}
