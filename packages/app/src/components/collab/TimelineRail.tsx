/**
 * Timeline rail for /collab/:id (SKU-1).
 *
 * The audit trail of the session: the pending queue pinned at the top, then
 * every prompt and action the client knows about, grouped by day and hour.
 *
 * Where the data comes from:
 *   prompts (persisted)  GET /collab/session/:id/export → suggestions[], every
 *                        status with its DB createdAt.  Fetched once per
 *                        session id; this is the only prompt history that
 *                        survives a page reload.
 *   prompts (live)       collab.promptLog() — collab:prompt_submitted events.
 *   pending queue        collab.queue() — the server only ever sends the
 *                        pending pool here, so approved / submitted rows come
 *                        from the two sources above.
 *   actions              collab.activityLog() — derived from the SSE stream,
 *                        page lifetime only (the server keeps no action feed).
 *
 * No server changes: everything above is an endpoint or event that already
 * existed.  Known gaps are recorded in COLLAB-UI-UPLIFT.md rather than faked
 * here — the rail renders what exists and nothing more.
 */

import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import type { CollabRole, PromptSuggestion } from "@opencode-ai/collab"
import { renderMentions } from "./mentions"
import { Chevron } from "./glyphs"
import { LABEL_MICRO } from "./ui"
import { bucketMeta, clockTime, groupTimeline, openByDefault, type TimelineEvent } from "./timeline-utils"

type Filter = "all" | "prompts" | "actions"

/** Shape of one row in the /export payload (server: collab/router.ts). */
interface ExportedSuggestion {
  id: string
  authorGithubLogin: string
  content: string
  status: string
  model?: string
  agent?: string
  variant?: string
  createdAt: string
}

/** The fixed reaction bar, mirrored from REACTION_EMOJIS in @opencode-ai/collab. */
const REACTION_BAR: readonly string[] = ["👍", "👎", "🔥", "🚀", "❤️", "😄"]

function avatarUrl(login: string, size = 32): string {
  return `https://github.com/${login}.png?size=${size}`
}

/** JSON puts Dates on the wire as strings; the types still say Date. */
function epoch(value: Date | string | number | undefined): number {
  if (value == null) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** `build · claude-sonnet-4-5` — the machine facts about a dispatched prompt. */
function promptMeta(s: { model?: string; agent?: string; variant?: string; status?: string }): string | undefined {
  const model = s.model ? (s.model.includes("/") ? s.model.split("/").slice(1).join("/") : s.model) : null
  const parts = [s.agent, model, s.variant].filter(Boolean) as string[]
  if (s.status === "rejected") parts.unshift("rejected")
  return parts.length > 0 ? parts.join(" · ") : undefined
}

export function TimelineRail(props: { myLogin: string; class?: string }) {
  const collab = useCollab()
  const myRole = (): CollabRole => collab.viewerRole()

  const [filter, setFilter] = createSignal<Filter>("all")
  /** Explicit user toggles; anything absent falls back to the default state. */
  const [openOverrides, setOpenOverrides] = createSignal<Record<string, boolean>>({})

  // "Now" only matters for the Today / Yesterday labels and for which bucket
  // starts expanded, so a one-minute tick is plenty.
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 60_000)
  onCleanup(() => clearInterval(clock))

  // Persisted prompt history.  createResource holds off until the session id
  // exists, and re-runs if the page ever swaps sessions.
  const [history] = createResource(
    () => collab.session()?.id,
    async (id): Promise<ExportedSuggestion[]> => {
      const res = await fetch(`/collab/session/${id}/export`)
      if (!res.ok) return []
      const data = (await res.json()) as { suggestions?: ExportedSuggestion[] }
      return data.suggestions ?? []
    },
  )

  const pending = createMemo(() => collab.queue().filter((s) => s.status === "pending"))

  const events = createMemo<TimelineEvent[]>(() => {
    const out: TimelineEvent[] = []
    // Server history first: it carries the authoritative createdAt, and
    // groupTimeline keeps the first entry it sees for any duplicate id.
    for (const s of history() ?? []) {
      if (s.status === "pending") continue // pinned in the queue card instead
      out.push({
        id: s.id,
        kind: "prompt",
        at: epoch(s.createdAt),
        author: s.authorGithubLogin,
        content: s.content,
        meta: promptMeta(s),
      })
    }
    for (const s of collab.promptLog()) {
      out.push({
        id: s.id,
        kind: "prompt",
        at: epoch(s.createdAt as unknown as string),
        author: s.authorGithubLogin,
        content: s.content,
        meta: promptMeta(s),
      })
    }
    for (const a of collab.activityLog()) {
      out.push({ id: a.id, kind: "action", at: a.at, author: a.author, content: a.text })
    }
    return out
  })

  const filtered = createMemo(() => {
    const f = filter()
    if (f === "all") return events()
    const want = f === "prompts" ? "prompt" : "action"
    return events().filter((e) => e.kind === want)
  })

  const days = createMemo(() => groupTimeline(filtered(), now()))
  const defaults = createMemo(() => openByDefault(now()))
  // Sum of the per-day counts, not filtered().length: groupTimeline dedupes
  // by event id (the same prompt can arrive via both /export history and
  // collab.promptLog()), so the raw pre-dedup array can be longer than what
  // is actually rendered below.
  const renderedCount = createMemo(() => days().reduce((n, d) => n + d.count, 0))

  function isOpen(key: string, fallback: boolean): boolean {
    const override = openOverrides()[key]
    return override === undefined ? fallback : override
  }

  function toggle(key: string, fallback: boolean) {
    setOpenOverrides((prev) => ({ ...prev, [key]: !(prev[key] === undefined ? fallback : prev[key]) }))
  }

  /** One line telling the viewer where their next prompt actually goes. */
  const routingHint = () => {
    if (myRole() === "viewer") return "viewer · read only"
    if (myRole() === "driver") {
      return collab.session()?.queueMode === "fifo" ? "driver · prompts dispatch directly" : "driver · prompts join the vote pool"
    }
    return collab.session()?.queueMode === "vote" ? "prompts join the vote pool" : "prompts wait for driver approval"
  }

  return (
    <aside
      class={`flex w-full min-h-0 flex-col border-border-weak-base bg-surface-base md:w-[304px] md:shrink-0 md:border-r ${props.class ?? ""}`}
      aria-label="Session timeline"
    >
      <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-weak-base px-3">
        <span class="text-12-medium text-text-strong">Timeline</span>
        <span class="font-mono text-[10.5px] text-text-weak">{renderedCount()}</span>
        <span class="ml-auto truncate font-mono text-[10.5px] text-text-base" title={routingHint()}>
          {routingHint()}
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-1 border-b border-border-weak-base px-3 py-1.5" role="group" aria-label="Filter timeline">
        <For each={[["all", "All"], ["prompts", "Prompts"], ["actions", "Actions"]] as const}>
          {([value, label]) => (
            <button
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter() === value}
              classList={{
                "inline-flex min-h-6 items-center rounded-full border px-2 text-[11px] font-[500] transition-colors duration-150 ease-out motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-collab-accent-line":
                  true,
                "border-collab-accent-line bg-collab-accent-soft text-collab-accent": filter() === value,
                "border-transparent text-text-base hover:bg-surface-base-hover hover:text-text-strong": filter() !== value,
              }}
            >
              {label}
            </button>
          )}
        </For>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Show when={pending().length > 0}>
          <QueueCard
            pending={pending()}
            myRole={myRole()}
            myLogin={props.myLogin}
            queueMode={collab.session()?.queueMode ?? "fifo"}
            onApprove={(id) => collab.approvesuggestion(id)}
            onReject={(id) => collab.rejectSuggestion(id)}
            onVote={(id) => collab.castVote(id)}
            onReact={(id, emoji) => collab.react(id, emoji)}
          />
        </Show>

        <Show
          when={days().length > 0}
          fallback={
            <p class="px-3 py-6 text-center text-12-regular text-text-base">
              {history.loading ? "Loading history…" : "Nothing here yet."}
            </p>
          }
        >
          <For each={days()}>
            {(day) => {
              const dayOpen = () => isOpen(day.key, day.key === defaults().day)
              return (
                <section class="border-b border-border-weak-base last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggle(day.key, day.key === defaults().day)}
                    aria-expanded={dayOpen()}
                    class="flex min-h-8 w-full items-center gap-1.5 px-3 py-1.5 text-left outline-none transition-colors duration-150 ease-out hover:bg-surface-base-hover focus-visible:ring-2 focus-visible:ring-collab-accent-line motion-reduce:transition-none"
                  >
                    <Chevron open={dayOpen()} />
                    <span class={LABEL_MICRO}>{day.label}</span>
                    <span class="ml-auto font-mono text-[10.5px] text-text-weak">{day.count}</span>
                  </button>

                  <Show when={dayOpen()}>
                    <For each={day.hours}>
                      {(bucket) => {
                        const bucketOpen = () => isOpen(bucket.key, bucket.key === defaults().hour)
                        return (
                          <div>
                            <button
                              type="button"
                              onClick={() => toggle(bucket.key, bucket.key === defaults().hour)}
                              aria-expanded={bucketOpen()}
                              class="flex min-h-7 w-full items-center gap-1.5 py-1 pl-6 pr-3 text-left outline-none transition-colors duration-150 ease-out hover:bg-surface-base-hover focus-visible:ring-2 focus-visible:ring-collab-accent-line motion-reduce:transition-none"
                            >
                              <Chevron open={bucketOpen()} />
                              <span class="font-mono text-[10.5px] text-text-base">{bucket.label}</span>
                              <span class="ml-auto truncate font-mono text-[10.5px] text-text-base">{bucketMeta(bucket)}</span>
                            </button>
                            <Show when={bucketOpen()}>
                              <For each={bucket.events}>{(event) => <EventRow event={event} />}</For>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </Show>
                </section>
              )
            }}
          </For>
        </Show>
      </div>
    </aside>
  )
}

// ── Pinned queue card ────────────────────────────────────────────────────────

function QueueCard(props: {
  pending: PromptSuggestion[]
  myRole: CollabRole
  myLogin: string
  queueMode: "fifo" | "vote"
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  onVote: (id: string) => Promise<void>
  onReact: (id: string, emoji: string) => Promise<void>
}) {
  return (
    <section class="m-2 rounded-md border border-collab-accent-line bg-collab-accent-soft">
      <div class="flex items-center gap-2 px-2.5 py-1.5">
        <span class={`${LABEL_MICRO} text-collab-accent`}>Queue</span>
        <span class="ml-auto font-mono text-[10.5px] text-text-base">
          {props.pending.length} pending · {props.queueMode === "vote" ? "Vote" : "FIFO"}
        </span>
      </div>
      <ul class="divide-y divide-collab-accent-line">
        <For each={props.pending}>
          {(s) => (
            <li class="px-2.5 py-2">
              <QueueRow
                suggestion={s}
                myRole={props.myRole}
                myLogin={props.myLogin}
                queueMode={props.queueMode}
                onApprove={props.onApprove}
                onReject={props.onReject}
                onVote={props.onVote}
                onReact={props.onReact}
              />
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}

function QueueRow(props: {
  suggestion: PromptSuggestion
  myRole: CollabRole
  myLogin: string
  queueMode: "fifo" | "vote"
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  onVote: (id: string) => Promise<void>
  onReact: (id: string, emoji: string) => Promise<void>
}) {
  const s = props.suggestion
  const [busy, setBusy] = createSignal<"approve" | "reject" | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  async function run(kind: "approve" | "reject", fn: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <p class="line-clamp-2 text-12-regular text-text-strong break-words">{renderMentions(s.content)}</p>

      <div class="mt-1 flex items-center gap-1.5">
        <img src={avatarUrl(s.authorGithubLogin, 24)} alt="" class="size-4 shrink-0 rounded-full" />
        <span class="truncate text-[11px] font-[500] text-text-base">{s.authorGithubLogin}</span>
        <Show when={s.voteScore > 0}>
          <span class="font-mono text-[10.5px] text-collab-accent">▲ {s.voteScore}</span>
        </Show>
        <span class="ml-auto font-mono text-[10.5px] text-text-base">{clockTime(epoch(s.createdAt as unknown as string))}</span>
      </div>

      <Show when={props.myRole === "driver"}>
        <div class="mt-1.5 flex items-center gap-3">
          <TextAction
            label={busy() === "approve" ? "Approving…" : "Approve"}
            tone="success"
            disabled={busy() !== null}
            onClick={() => run("approve", () => props.onApprove(s.id))}
          />
          <TextAction
            label={busy() === "reject" ? "Rejecting…" : "Reject"}
            tone="weak"
            disabled={busy() !== null}
            onClick={() => run("reject", () => props.onReject(s.id))}
          />
        </div>
      </Show>

      <Show when={props.myRole !== "driver" && props.myRole !== "viewer"}>
        <Show
          when={props.queueMode === "vote"}
          fallback={<p class="mt-1.5 font-mono text-[10.5px] text-text-base">awaiting driver approval</p>}
        >
          <div class="mt-1.5">
            <TextAction
              label={`▲ Vote${s.votes.includes(props.myLogin) ? "d" : ""}`}
              tone="accent"
              onClick={() => void props.onVote(s.id).catch((e) => setError(String(e)))}
            />
          </div>
        </Show>
      </Show>

      <Show when={props.myRole !== "viewer"}>
        <div class="mt-1.5 flex flex-wrap gap-1">
          <For each={REACTION_BAR}>
            {(emoji) => {
              const reactors = () => s.reactions?.[emoji] ?? []
              const mine = () => reactors().includes(props.myLogin)
              return (
                <button
                  type="button"
                  onClick={() => void props.onReact(s.id, emoji).catch((e) => setError(String(e)))}
                  aria-label={`React with ${emoji}`}
                  aria-pressed={mine()}
                  title={reactors().length > 0 ? reactors().join(", ") : `React with ${emoji}`}
                  classList={{
                    "inline-flex min-h-6 items-center gap-0.5 rounded-full border px-1.5 text-[10px] leading-none transition-colors duration-150 ease-out motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-collab-accent-line":
                      true,
                    "border-collab-accent-line bg-collab-accent-soft text-collab-accent": mine(),
                    "border-border-weak-base text-text-weak hover:bg-surface-base-hover": !mine(),
                  }}
                >
                  <span aria-hidden="true">{emoji}</span>
                  <Show when={reactors().length > 0}>
                    <span class="font-mono">{reactors().length}</span>
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </Show>

      <Show when={error()}>
        <p class="mt-1 text-[11px] text-text-on-critical-base">{error()}</p>
      </Show>
    </>
  )
}

// ── Small shared pieces ──────────────────────────────────────────────────────

function TextAction(props: {
  label: string
  tone: "success" | "weak" | "accent"
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      classList={{
        "inline-flex min-h-6 items-center rounded text-[11px] font-[500] transition-colors duration-150 ease-out motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-collab-accent-line disabled:cursor-not-allowed disabled:text-text-weaker":
          true,
        "text-text-on-success-base": props.tone === "success",
        "text-text-base hover:text-text-strong": props.tone === "weak",
        "text-collab-accent": props.tone === "accent",
      }}
    >
      {props.label}
    </button>
  )
}

function KindChip(props: { kind: TimelineEvent["kind"] }) {
  return (
    <span
      classList={{
        "shrink-0 rounded border px-1 py-px font-mono text-[9.5px] uppercase leading-none tracking-[0.06em]": true,
        "border-transparent bg-surface-inset-base text-text-base": props.kind === "prompt",
        "border-border-success-base text-text-on-success-base": props.kind === "action",
      }}
    >
      {props.kind}
    </span>
  )
}

function EventRow(props: { event: TimelineEvent }) {
  const e = () => props.event
  return (
    <article class="flex min-h-6 items-start gap-2 py-1 pl-6 pr-3 hover:bg-surface-base-hover">
      <Show
        when={e().author}
        fallback={<span class="mt-1 size-4 shrink-0 rounded-full border border-border-weak-base bg-surface-inset-base" aria-hidden="true" />}
      >
        {(login) => <img src={avatarUrl(login(), 24)} alt="" class="mt-0.5 size-4 shrink-0 rounded-full" />}
      </Show>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="truncate text-[11px] font-[500] text-text-strong">{e().author ?? "session"}</span>
          <KindChip kind={e().kind} />
          <span class="ml-auto shrink-0 font-mono text-[10.5px] text-text-base">{clockTime(e().at)}</span>
        </div>
        <p class="line-clamp-2 text-12-regular text-text-base break-words">{renderMentions(e().content)}</p>
        <Show when={e().meta}>
          {(meta) => <p class="truncate font-mono text-[10px] text-text-base">{meta()}</p>}
        </Show>
      </div>
    </article>
  )
}
