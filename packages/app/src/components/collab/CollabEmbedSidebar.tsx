/**
 * Sidebar rendered inside the opencode iframe when ?embed=collab is set.
 *
 * Replaces the default project rail/panel with a list of the current user's
 * collab sessions.  Clicking a session navigates the *top* window (out of
 * the iframe) to that collab session's page — same content as the landing
 * page's Rejoin card, and the rows follow the same idiom.
 *
 * This renders inside the themed editor, so it is built on host tokens only:
 * it has to follow whatever theme the editor is in, light or dark.
 */

import { createResource, For, Show, createMemo, createSignal } from "solid-js"
import type { CollabSession } from "@opencode-ai/collab"
import { collabEmbedSessionId, navigateTopToCollabSession } from "@/utils/collab-embed"
import { ConfirmDialog } from "./CollabDialog"
import { BTN_GHOST, BTN_ICON_CRITICAL, CHIP, LABEL_MICRO, ROW_ACTIVE } from "./ui"
import { BrandMark } from "./BrandMark"

interface Me {
  githubId: number
  githubLogin: string
}

/** Navigate the TOP window (not the iframe) back to the landing page. */
function goToLanding() {
  const top = window.top ?? window
  top.location.href = "/collab/new"
}

export function CollabEmbedSidebar() {
  const activeSessionId = createMemo(() => collabEmbedSessionId())
  const [pendingDelete, setPendingDelete] = createSignal<CollabSession | null>(null)
  const [deleteError, setDeleteError] = createSignal<string | null>(null)

  const [me] = createResource(async () => {
    const res = await fetch("/collab/me")
    if (!res.ok) return null
    return (await res.json()) as Me
  })

  const [sessions, { refetch }] = createResource(async () => {
    const res = await fetch("/collab/session")
    if (!res.ok) return []
    return (await res.json()) as CollabSession[]
  })

  // Reading a rejected resource re-throws, which inside the editor iframe
  // would replace the whole embedded app with an error boundary over a failed
  // session list.  Read the error flag first and degrade to an empty list.
  const sessionList = () => (sessions.error ? [] : (sessions() ?? []))

  function canDelete(session: CollabSession): boolean {
    const user = me.error ? null : me()
    if (!user) return false
    return session.participants?.some((p) => p.githubId === user.githubId && p.role === "driver") ?? false
  }

  async function deleteSession(session: CollabSession) {
    const res = await fetch(`/collab/session/${session.id}`, { method: "DELETE" })
    if (!res.ok) {
      setDeleteError(`Could not delete "${session.name}" (HTTP ${res.status})`)
      return
    }
    // If we just deleted the session we were viewing, bounce to /collab/new
    if (session.id === activeSessionId()) {
      goToLanding()
      return
    }
    void refetch()
  }

  return (
    <div class="flex h-full w-full flex-col border-r border-border-weak-base bg-surface-base">
      <div class="shrink-0 border-b border-border-weak-base px-3 py-2.5">
        <div class="mb-1 flex items-center gap-2">
          <button
            type="button"
            onClick={goToLanding}
            title="Back to your collab sessions"
            class="flex items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-collab-accent-line"
          >
            <BrandMark size={16} />
            <span class="text-12-medium text-text-strong">Unleash Collab</span>
          </button>
        </div>
        <h2 class="text-12-medium text-text-strong">Sessions</h2>
        <p class="text-12-regular text-text-base">Switch between coding sessions</p>
      </div>

      <div class="shrink-0 border-b border-border-weak-base px-2 py-2">
        <button type="button" onClick={goToLanding} class={`${BTN_GHOST} h-7 w-full px-2`}>
          <svg class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New collab session
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
        <Show when={!sessions.loading} fallback={<p class="px-3 py-3 text-12-regular text-text-base">Loading sessions…</p>}>
          <Show
            when={sessionList().length > 0}
            fallback={
              <p class="px-3 py-6 text-center text-12-regular text-text-base">
                {sessions.error ? "Could not load your sessions" : "No sessions"}
              </p>
            }
          >
            <For each={sessionList()}>
              {(session) => {
                const isActive = () => session.id === activeSessionId()
                return (
                  // Outer is a div, not a button, because we nest a real
                  // <button> for delete and nested buttons are invalid HTML.
                  <div
                    onClick={() => navigateTopToCollabSession(session.id)}
                    role="button"
                    tabIndex={0}
                    aria-current={isActive() ? "page" : undefined}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return
                      e.preventDefault()
                      navigateTopToCollabSession(session.id)
                    }}
                    classList={{
                      "group flex cursor-pointer items-start gap-2 px-3 py-2 outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-collab-accent-line motion-reduce:transition-none":
                        true,
                      [ROW_ACTIVE]: isActive(),
                      "hover:bg-surface-base-hover": !isActive(),
                    }}
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-12-medium text-text-strong">{session.name}</span>
                        <Show when={isActive()}>
                          <span class={`${LABEL_MICRO} shrink-0 text-collab-accent`}>Open</span>
                        </Show>
                      </div>

                      <div class="mt-1 flex flex-wrap items-center gap-1">
                        <Show
                          when={(session.repos?.length ?? 0) > 0}
                          fallback={<span class="font-mono text-[10.5px] text-text-base">no repos linked</span>}
                        >
                          <For each={session.repos.slice(0, 2)}>
                            {(repo) => (
                              <span class={CHIP} title={repo}>
                                {repo.split("/")[1] ?? repo}
                              </span>
                            )}
                          </For>
                          <Show when={(session.repos?.length ?? 0) > 2}>
                            <span class="font-mono text-[10.5px] text-text-weak">+{session.repos.length - 2}</span>
                          </Show>
                        </Show>
                        <span class={CHIP} title="Prompt queue mode">
                          {session.queueMode === "vote" ? "vote" : "fifo"}
                        </span>
                      </div>

                      <Show when={session.branch}>
                        {(branch) => (
                          <p class="mt-1 truncate font-mono text-[10.5px] text-text-base" title={branch()}>
                            {branch()}
                          </p>
                        )}
                      </Show>

                      <Show when={(session.participants?.length ?? 0) > 0}>
                        <div class="mt-1 flex items-center" aria-hidden="true">
                          <For each={(session.participants ?? []).slice(0, 3)}>
                            {(p, i) => (
                              <img
                                src={p.githubAvatarUrl || `https://github.com/${p.githubLogin}.png?size=24`}
                                alt=""
                                title={p.githubLogin}
                                classList={{
                                  "size-4 rounded-full border border-background-base bg-surface-inset-base": true,
                                  "-ml-1": i() > 0,
                                }}
                              />
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>

                    <Show when={canDelete(session)}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          setDeleteError(null)
                          setPendingDelete(session)
                        }}
                        aria-label={`Delete ${session.name}`}
                        title="Delete session"
                        class={`${BTN_ICON_CRITICAL} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
                      >
                        <svg
                          class="size-3.5"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </Show>
                  </div>
                )
              }}
            </For>
          </Show>
        </Show>
      </div>

      <Show when={pendingDelete()}>
        {(session) => (
          <ConfirmDialog
            title="Delete this session?"
            body={
              <>
                <strong class="text-text-strong">{session().name}</strong> and its cloned workspace are removed. This
                cannot be undone.
              </>
            }
            confirmLabel="Delete session"
            destructive
            onConfirm={() => void deleteSession(session())}
            onClose={() => setPendingDelete(null)}
          />
        )}
      </Show>

      <Show when={deleteError()}>
        {(message) => <ConfirmDialog title="Delete failed" body={message()} onClose={() => setDeleteError(null)} />}
      </Show>
    </div>
  )
}
