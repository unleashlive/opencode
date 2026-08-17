/**
 * /collab/new — the Collab landing page (SKU-1 IA)
 *
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │ Top bar: badge + wordmark, theme toggle, identity, sign out       │
 *  ├──────────────────────────────────────────────────────────────────┤
 *  │ Hero: what this is, in one line                                   │
 *  ├────────────────────────────────────┬─────────────────────────────┤
 *  │ Create session (form card)         │ Rejoin (grouped sessions)   │
 *  └────────────────────────────────────┴─────────────────────────────┘
 *
 * The create form comes first in the DOM, so it is also what a phone shows
 * first: the page exists to start a session, rejoining is the secondary path.
 *
 * Server credentials are one quiet status line at the foot of the form card
 * rather than a banner above it. Nothing about the container's Claude auth
 * blocks creating a session, so it does not get banner weight.
 */

import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import type { CollabSession } from "@opencode-ai/collab"
import { CollabDialog, ConfirmDialog } from "@/components/collab/CollabDialog"
import { Chevron } from "@/components/collab/glyphs"
import { ThemeToggle } from "@/components/collab/ThemeToggle"
import { dayKey } from "@/components/collab/timeline-utils"
import {
  BTN_GHOST,
  BTN_ICON,
  BTN_ICON_CRITICAL,
  BTN_PRIMARY,
  CARD,
  CHIP,
  CHIP_SELECT,
  CHIP_SELECT_OFF,
  CHIP_SELECT_ON,
  FIELD,
  LABEL_MICRO,
  PILL_BRAND,
  SEGMENT_ITEM,
  SEGMENT_ITEM_ACTIVE,
  SEGMENT_ITEM_IDLE,
  SEGMENT_TRACK,
  TEXT_ACTION,
} from "@/components/collab/ui"

interface OrgRepo {
  full_name: string
  name: string
  description?: string | null
  private?: boolean
}

interface Me {
  githubId: number
  githubLogin: string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** JSON puts Dates on the wire as strings; the types still say Date. */
function epoch(value: Date | string | number | null | undefined): number {
  if (value == null) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function avatarUrl(login: string, size = 48): string {
  return `https://github.com/${login}.png?size=${size}`
}

export default function NewCollabSession() {
  const navigate = useNavigate()
  const [name, setName] = createSignal("")
  const [selectedRepos, setSelectedRepos] = createSignal<string[]>([])
  const [branch, setBranch] = createSignal("")
  const [visibilityMode, setVisibilityMode] = createSignal("typing")
  const [queueMode, setQueueMode] = createSignal("fifo")
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [authed, setAuthed] = createSignal(false)
  // 409-conflict dialog state.  Server returns this when the user typed a
  // branch name like `collab/feature-x` and a linked repo already has a
  // `collab` leaf branch (refs/heads layout collision — see
  // packages/opencode/src/collab/branch-resolve.ts).
  const [branchConflict, setBranchConflict] = createSignal<{
    proposed: string
    suggested: string
    message: string
  } | null>(null)
  // Session the user asked to delete, held until the confirm dialog resolves.
  const [pendingDelete, setPendingDelete] = createSignal<CollabSession | null>(null)
  const [deleteError, setDeleteError] = createSignal<string | null>(null)

  // Check auth immediately on mount — redirect to GitHub OAuth if not logged in
  onMount(async () => {
    const res = await fetch("/collab/me")
    if (res.status === 401) {
      window.location.href = "/collab/auth/github?next=/collab/new"
      return
    }
    setAuthed(true)
  })

  // Load org repos once authenticated
  const [repos] = createResource(authed, async (ready) => {
    if (!ready) return []
    const res = await fetch("/collab/repos")
    if (!res.ok) return []
    return (await res.json()) as OrgRepo[]
  })

  // Load existing sessions for the Rejoin card
  const [sessions, { refetch: refetchSessions }] = createResource(authed, async (ready) => {
    if (!ready) return []
    const res = await fetch("/collab/session")
    if (!res.ok) return []
    return (await res.json()) as CollabSession[]
  })

  // Identify the current user so we can hide the delete control from
  // non-Drivers (the DELETE endpoint enforces this server-side too).
  const [me] = createResource(authed, async (ready) => {
    if (!ready) return null
    const res = await fetch("/collab/me")
    if (!res.ok) return null
    return (await res.json()) as Me
  })

  // Reading a rejected resource re-throws, which would take the whole page to
  // the error boundary over a failed repo list.  These read the error flag
  // first, so a network failure degrades to an empty list plus a message.
  const repoList = () => (repos.error ? [] : (repos() ?? []))
  const sessionList = () => (sessions.error ? [] : (sessions() ?? []))
  const currentUser = () => (me.error ? null : (me() ?? null))

  /** Returns true if the current user has the driver role in `session`. */
  function canDelete(session: CollabSession): boolean {
    const user = currentUser()
    if (!user) return false
    return session.participants?.some((p) => p.githubId === user.githubId && p.role === "driver") ?? false
  }

  /** Soft-delete a collab session.  Server also wipes the workspace clone. */
  async function deleteSession(session: CollabSession) {
    const res = await fetch(`/collab/session/${session.id}`, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      setDeleteError(`Could not delete "${session.name}" (HTTP ${res.status})${body ? `: ${body}` : ""}`)
      return
    }
    refetchSessions()
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!name().trim()) return
    setSubmitting(true)
    setError(null)
    setBranchConflict(null)
    await submitCreate(branch().trim() || undefined)
  }

  /** Inner submit — extracted so the 409 conflict dialog can resubmit with the
   *  server-suggested branch name without re-running the form-validation
   *  guards. */
  async function submitCreate(branchOverride: string | undefined) {
    setSubmitting(true)
    try {
      const res = await fetch("/collab/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name().trim(),
          repos: selectedRepos(),
          visibilityMode: visibilityMode(),
          queueMode: queueMode(),
          branch: branchOverride,
        }),
      })
      if (res.status === 401) {
        window.location.href = "/collab/auth/github?next=/collab/new"
        return
      }
      if (res.status === 409) {
        // Branch collision on a user-typed name.  Surface the suggestion
        // dialog so the user can accept the auto-rewrite or edit their
        // branch input.
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          suggestedBranch?: string
        }
        if (body.suggestedBranch) {
          setBranchConflict({
            proposed: branchOverride ?? "",
            suggested: body.suggestedBranch,
            message: body.error ?? "Branch name conflicts with an existing branch.",
          })
          return
        }
        setError(body.error ?? "Branch name conflict.")
        return
      }
      if (res.status === 502) {
        // GitHub API probe failed.  No DB row was created; user can retry.
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? "Could not reach GitHub to verify the branch name. Please retry in a moment.")
        return
      }
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? "Failed to create session")
        return
      }
      const session = await res.json()
      navigate(`/collab/${session.id}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  /** Driver clicked "Use suggested" in the conflict dialog. */
  async function acceptSuggestedBranch() {
    const conflict = branchConflict()
    if (!conflict) return
    setBranchConflict(null)
    setBranch(conflict.suggested)
    await submitCreate(conflict.suggested)
  }

  function toggleRepo(fullName: string) {
    setSelectedRepos((prev) => (prev.includes(fullName) ? prev.filter((r) => r !== fullName) : [...prev, fullName]))
  }

  async function signOut() {
    await fetch("/collab/auth/logout", { method: "POST" })
    window.location.href = "/collab/auth/github?next=/collab/new"
  }

  return (
    <div class="flex h-dvh flex-col overflow-hidden bg-background-base text-text-base">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border-weak-base bg-surface-base px-3">
        {/* Not a link, unlike the session top bar: /collab/new is this page. */}
        <span class={`${PILL_BRAND} shrink-0`}>Collab</span>
        <span class="text-14-medium text-text-strong">Unleash</span>

        <div class="ml-auto flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <Show when={currentUser()}>
            {(user) => (
              <span class="flex items-center gap-1.5">
                <img
                  src={avatarUrl(user().githubLogin)}
                  alt=""
                  class="size-6 rounded-full border border-border-weak-base bg-surface-inset-base"
                />
                <span class="hidden font-mono text-[10.5px] text-text-base sm:inline">{user().githubLogin}</span>
              </span>
            )}
          </Show>
          <button
            type="button"
            onClick={() => void signOut()}
            aria-label="Sign out and re-authenticate with GitHub"
            title="Sign out and re-authenticate with GitHub"
            class={BTN_ICON}
          >
            <svg class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <main class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-12">
          <div class="mb-8 max-w-2xl">
            <h1 class="text-20-medium text-text-strong">Code together with a shared agent</h1>
            <p class="mt-1.5 text-14-regular text-text-base">
              One session, one branch, everyone sees the same work. Drivers steer, contributors suggest, viewers watch.
            </p>
          </div>

          <Show
            when={authed()}
            fallback={<p class="text-12-regular text-text-base">Signing in…</p>}
          >
            <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              {/* Create form first in the DOM: it is the point of the page, and
                  on a phone it therefore sits above the rejoin list. */}
              <section class={`${CARD} p-5`}>
                <form onSubmit={handleSubmit} class="flex flex-col gap-5">
                  <div class="flex flex-col gap-1.5">
                    <label class={LABEL_MICRO} for="collab-name">
                      Session name
                    </label>
                    <input
                      id="collab-name"
                      type="text"
                      value={name()}
                      onInput={(e) => setName(e.currentTarget.value)}
                      placeholder="Auth refactor sprint"
                      class={FIELD}
                      required
                    />
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-center gap-2">
                      <span class={LABEL_MICRO}>Repositories</span>
                      <span class="font-mono text-[10.5px] text-text-base">optional</span>
                      <Show when={selectedRepos().length > 0}>
                        <span class="ml-auto font-mono text-[10.5px] text-text-weak">
                          {selectedRepos().length} selected
                        </span>
                      </Show>
                    </div>

                    <Show when={repos.loading}>
                      <p class="text-12-regular text-text-base">Loading org repositories…</p>
                    </Show>
                    <Show when={repos.error}>
                      <p class="text-12-regular text-text-base">
                        Could not load the org repositories. You can still create the session and add repos from inside
                        it.
                      </p>
                    </Show>
                    <Show when={!repos.loading && !repos.error && repoList().length === 0}>
                      <p class="text-12-regular text-text-base">No repositories found in this org.</p>
                    </Show>

                    <Show when={repoList().length > 0}>
                      <div
                        class="flex max-h-44 flex-wrap content-start items-start gap-1.5 overflow-y-auto overscroll-contain"
                        role="group"
                        aria-label="Repositories"
                      >
                        <For each={repoList()}>
                          {(repo) => {
                            const on = () => selectedRepos().includes(repo.full_name)
                            return (
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={on()}
                                title={repo.description ?? repo.full_name}
                                onClick={() => toggleRepo(repo.full_name)}
                                classList={{
                                  [CHIP_SELECT]: true,
                                  [CHIP_SELECT_ON]: on(),
                                  [CHIP_SELECT_OFF]: !on(),
                                }}
                              >
                                <Show when={on()}>
                                  <span aria-hidden="true" class="leading-none">
                                    ✓
                                  </span>
                                </Show>
                                <span class="truncate">{repo.name}</span>
                                <Show when={repo.private}>
                                  <span class="font-mono text-[10px] text-text-base">private</span>
                                </Show>
                              </button>
                            )
                          }}
                        </For>
                      </div>
                    </Show>
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-center gap-2">
                      <label class={LABEL_MICRO} for="collab-branch">
                        Git branch
                      </label>
                      <span class="font-mono text-[10.5px] text-text-base">optional</span>
                    </div>
                    <input
                      id="collab-branch"
                      type="text"
                      value={branch()}
                      onInput={(e) => setBranch(e.currentTarget.value)}
                      placeholder="collab/drone-api-refactor"
                      class={`${FIELD} font-mono`}
                    />
                    <p class="text-[11px] text-text-base">
                      Every linked repo is checked out to this branch. Leave it blank and{" "}
                      <code class="font-mono text-[10.5px] text-text-strong">collab/&lt;slug&gt;-&lt;id&gt;</code> is
                      created from the default branch.
                    </p>
                  </div>

                  <div class="grid gap-4 sm:grid-cols-2">
                    <Segmented
                      label="Queue mode"
                      value={queueMode()}
                      onChange={setQueueMode}
                      hint="FIFO runs prompts in order. Vote pool runs the highest scored first."
                      options={[
                        { value: "fifo", label: "FIFO" },
                        { value: "vote", label: "Vote pool" },
                      ]}
                    />
                    <Segmented
                      label="Typing visibility"
                      value={visibilityMode()}
                      onChange={setVisibilityMode}
                      hint="Live shows a dot while someone composes. On submit reveals prompts only when sent."
                      options={[
                        { value: "typing", label: "Live" },
                        { value: "submitted", label: "On submit" },
                      ]}
                    />
                  </div>

                  <Show when={error()}>
                    {(message) => (
                      <p class="rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2 text-12-regular text-text-on-critical-base">
                        {message()}
                      </p>
                    )}
                  </Show>

                  <button
                    type="submit"
                    disabled={submitting() || !name().trim()}
                    class={`${BTN_PRIMARY} h-9 w-full px-3`}
                  >
                    {submitting() ? "Creating…" : "Create session"}
                  </button>
                </form>

                <div class="mt-4 border-t border-border-weak-base pt-3">
                  <ClaudeCredentialsLine />
                </div>
              </section>

              <RejoinCard
                sessions={sessionList()}
                loading={sessions.loading}
                failed={!!sessions.error}
                canDelete={canDelete}
                onOpen={(id) => navigate(`/collab/${id}`)}
                onDelete={(session) => {
                  setDeleteError(null)
                  setPendingDelete(session)
                }}
              />
            </div>
          </Show>
        </div>
      </main>

      {/* Branch-collision dialog: opens when POST /collab/session returns 409.
          The user typed a custom branch name with `/` that conflicts with an
          existing leaf branch in one of the linked repos.  Offer the
          server-suggested slash-flattened name (collab/foo → collab-foo)
          OR let the user edit the input and try again. */}
      <Show when={branchConflict()}>
        {(conflict) => (
          <CollabDialog title="Branch name conflict" onClose={() => setBranchConflict(null)} fit>
            <div class="flex flex-col gap-4 px-5 pb-5">
              <p class="whitespace-pre-wrap text-12-regular text-text-base">{conflict().message}</p>
              <p class="text-12-regular text-text-strong">
                Use <code class="font-mono text-[10.5px]">{conflict().suggested}</code> instead?
              </p>
              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBranch(conflict().proposed)
                    setBranchConflict(null)
                  }}
                  class={`${BTN_GHOST} h-8 px-3`}
                >
                  Edit branch name
                </button>
                <button
                  type="button"
                  autofocus
                  onClick={() => void acceptSuggestedBranch()}
                  disabled={submitting()}
                  class={`${BTN_PRIMARY} h-8 px-3`}
                >
                  {submitting() ? "Creating…" : "Use suggested"}
                </button>
              </div>
            </div>
          </CollabDialog>
        )}
      </Show>

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

// ── Segmented control ─────────────────────────────────────────────────────────

function Segmented(props: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
}) {
  return (
    <div class="flex flex-col gap-1.5">
      <span class={LABEL_MICRO}>{props.label}</span>
      <div class={SEGMENT_TRACK} role="group" aria-label={props.label}>
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              aria-pressed={props.value === option.value}
              onClick={() => props.onChange(option.value)}
              classList={{
                [SEGMENT_ITEM]: true,
                [SEGMENT_ITEM_ACTIVE]: props.value === option.value,
                [SEGMENT_ITEM_IDLE]: props.value !== option.value,
              }}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
      <Show when={props.hint}>{(hint) => <p class="text-[11px] text-text-base">{hint()}</p>}</Show>
    </div>
  )
}

// ── Rejoin card ───────────────────────────────────────────────────────────────

type Recency = "today" | "week" | "earlier"

const RECENCY_LABELS: ReadonlyArray<[Recency, string]> = [
  ["today", "Today"],
  ["week", "This week"],
  ["earlier", "Earlier"],
]

/** Which bucket a session's creation time falls into, relative to `now`. */
function recencyOf(at: number, now: number): Recency {
  if (dayKey(at) === dayKey(now)) return "today"
  return now - at < WEEK_MS ? "week" : "earlier"
}

function RejoinCard(props: {
  sessions: CollabSession[]
  loading: boolean
  /** The session list request failed; say so instead of claiming there are none. */
  failed: boolean
  canDelete: (session: CollabSession) => boolean
  onOpen: (id: string) => void
  onDelete: (session: CollabSession) => void
}) {
  const now = Date.now()
  const [openOverrides, setOpenOverrides] = createSignal<Record<string, boolean>>({})

  const groups = createMemo(() => {
    const byBucket = new Map<Recency, CollabSession[]>()
    for (const session of [...props.sessions].sort((a, b) => epoch(b.createdAt) - epoch(a.createdAt))) {
      const bucket = recencyOf(epoch(session.createdAt), now)
      const list = byBucket.get(bucket)
      if (list) list.push(session)
      else byBucket.set(bucket, [session])
    }
    return RECENCY_LABELS.filter(([key]) => byBucket.has(key)).map(([key, label]) => ({
      key,
      label,
      sessions: byBucket.get(key)!,
    }))
  })

  /** The most recent non-empty group starts expanded; older ones collapse. */
  const defaultOpen = createMemo(() => groups()[0]?.key)

  function isOpen(key: Recency): boolean {
    const override = openOverrides()[key]
    return override === undefined ? key === defaultOpen() : override
  }

  return (
    <section class={`${CARD} flex min-h-0 flex-col overflow-hidden`} aria-label="Rejoin a session">
      <header class="flex shrink-0 items-baseline gap-1.5 border-b border-border-weak-base px-3 py-2.5">
        <h2 class="text-12-medium text-text-strong">Rejoin</h2>
        <p class="text-12-regular text-text-base">your recent sessions</p>
        <span class="ml-auto font-mono text-[10.5px] text-text-weak">{props.sessions.length}</span>
      </header>

      <div class="max-h-[26rem] min-h-0 overflow-y-auto overscroll-contain">
        <Show when={!props.loading} fallback={<p class="px-3 py-4 text-12-regular text-text-base">Loading sessions…</p>}>
          <Show
            when={groups().length > 0}
            fallback={
              <div class="px-3 py-6 text-center">
                <p class="text-12-regular text-text-base">{props.failed ? "Could not load your sessions" : "No sessions yet"}</p>
                <p class="mt-1 font-mono text-[10.5px] text-text-base">
                  {props.failed ? "reload to try again" : "create your first one on the left"}
                </p>
              </div>
            }
          >
            <For each={groups()}>
              {(group) => (
                <section class="border-b border-border-weak-base last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenOverrides((prev) => ({ ...prev, [group.key]: !isOpen(group.key) }))}
                    aria-expanded={isOpen(group.key)}
                    class="flex min-h-8 w-full items-center gap-1.5 px-3 py-1.5 text-left outline-none transition-colors duration-150 ease-out hover:bg-surface-base-hover focus-visible:ring-2 focus-visible:ring-collab-accent-line motion-reduce:transition-none"
                  >
                    <Chevron open={isOpen(group.key)} />
                    <span class={LABEL_MICRO}>{group.label}</span>
                    <span class="ml-auto font-mono text-[10.5px] text-text-weak">{group.sessions.length}</span>
                  </button>

                  <Show when={isOpen(group.key)}>
                    <For each={group.sessions}>
                      {(session) => (
                        <SessionRow
                          session={session}
                          canDelete={props.canDelete(session)}
                          onOpen={() => props.onOpen(session.id)}
                          onDelete={() => props.onDelete(session)}
                        />
                      )}
                    </For>
                  </Show>
                </section>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </section>
  )
}

function SessionRow(props: {
  session: CollabSession
  canDelete: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const session = () => props.session
  const participants = () => session().participants ?? []
  const repos = () => session().repos ?? []

  return (
    // Outer is a div, not a button, because we nest a real <button> for the
    // delete action and nested buttons are invalid HTML.
    <div
      onClick={props.onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return
        e.preventDefault()
        props.onOpen()
      }}
      class="group flex cursor-pointer items-start gap-2 px-3 py-2 outline-none transition-colors duration-150 ease-out hover:bg-surface-base-hover focus-visible:ring-2 focus-visible:ring-collab-accent-line motion-reduce:transition-none"
    >
      <div class="mt-0.5 flex shrink-0 items-center" aria-hidden="true">
        <Show
          when={participants().length > 0}
          fallback={<span class="size-4 rounded-full border border-border-weak-base bg-surface-inset-base" />}
        >
          <For each={participants().slice(0, 3)}>
            {(p, i) => (
              <img
                src={p.githubAvatarUrl || avatarUrl(p.githubLogin, 24)}
                alt=""
                title={p.githubLogin}
                classList={{ "size-4 rounded-full border border-background-base bg-surface-inset-base": true, "-ml-1": i() > 0 }}
              />
            )}
          </For>
        </Show>
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-12-medium text-text-strong">{session().name}</span>
          <span class="shrink-0 font-mono text-[10.5px] text-text-base">{relativeTimeShort(epoch(session().createdAt))}</span>
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-1">
          <Show
            when={repos().length > 0}
            fallback={<span class="font-mono text-[10.5px] text-text-base">no repos linked</span>}
          >
            <For each={repos().slice(0, 2)}>
              {(repo) => (
                <span class={CHIP} title={repo}>
                  {repo.split("/")[1] ?? repo}
                </span>
              )}
            </For>
            <Show when={repos().length > 2}>
              <span class="font-mono text-[10.5px] text-text-weak">+{repos().length - 2}</span>
            </Show>
          </Show>
          <span class={CHIP} title="Prompt queue mode">
            {session().queueMode === "vote" ? "vote" : "fifo"}
          </span>
        </div>
      </div>

      <Show when={props.canDelete}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            props.onDelete()
          }}
          aria-label={`Delete ${session().name}`}
          title="Delete session"
          class={`${BTN_ICON_CRITICAL} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
        >
          <svg class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </Show>
    </div>
  )
}

// ── Claude credentials status line ────────────────────────────────────────────
//
// Surfaces whether the server currently has a usable Claude auth file.  Any
// authenticated org member can paste a fresh credentials JSON (overwrites
// container-wide).  Why is this here rather than baked into session creation:
// the opencode-claude-auth plugin is process-wide — there's exactly one
// active Claude auth file per container, shared by every collab session.
// Per-session credentials would require spawning one opencode process per
// session (large architectural change); the per-container model is the
// realistic shape.
//
// It is one status line rather than a banner: missing credentials do not block
// creating a session (the model picker still offers free fallbacks), so this
// reports state and offers the paste flow, and otherwise stays out of the way.
//
// Operator runbook for getting credentials JSON on a Mac:
//   security find-generic-password -s "Claude Code-credentials" -w
//
// The clipboard output of that command is exactly what goes in the textarea.

interface CredentialsStatus {
  present: boolean
  email?: string
  mtime?: number
  bytes?: number
}

function ClaudeCredentialsLine() {
  const [status, setStatus] = createSignal<CredentialsStatus | null>(null)
  const [showUpload, setShowUpload] = createSignal(false)
  const [json, setJson] = createSignal("")
  const [uploading, setUploading] = createSignal(false)
  const [uploadErr, setUploadErr] = createSignal<string | null>(null)

  async function refresh() {
    try {
      const res = await fetch("/collab/claude-creds/status", { cache: "no-store" })
      if (!res.ok) {
        setStatus({ present: false })
        return
      }
      setStatus((await res.json()) as CredentialsStatus)
    } catch {
      setStatus({ present: false })
    }
  }

  onMount(() => {
    void refresh()
  })

  async function upload(e: Event) {
    e.preventDefault()
    if (uploading() || !json().trim()) return
    setUploading(true)
    setUploadErr(null)
    try {
      const res = await fetch("/collab/claude-creds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialsJson: json() }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setUploadErr(body.error ?? `Server returned ${res.status}`)
      } else {
        setJson("")
        setShowUpload(false)
        await refresh()
      }
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  const present = () => status()?.present === true
  const machineStatus = () => {
    if (status() === null) return "checking…"
    if (!present()) return "none · uploads needed"
    const refreshed = status()?.mtime ? ` · ${relativeTimeShort(status()!.mtime!)}` : ""
    return `Claude · active${refreshed}`
  }

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span
          aria-hidden="true"
          classList={{
            "size-1.5 shrink-0 rounded-full": true,
            "bg-surface-success-strong": present(),
            "bg-surface-warning-strong": !present(),
          }}
        />
        <span class="shrink-0 text-12-regular text-text-base">Server credentials</span>
        <span class="min-w-0 truncate font-mono text-[10.5px] text-text-base" title={status()?.email ?? undefined}>
          {machineStatus()}
        </span>
        <button
          type="button"
          onClick={() => {
            setShowUpload((v) => !v)
            setUploadErr(null)
          }}
          aria-expanded={showUpload()}
          class={`${TEXT_ACTION} ml-auto shrink-0`}
        >
          {showUpload() ? "Cancel" : present() ? "Replace" : "Paste credentials"}
        </button>
      </div>

      <Show when={showUpload()}>
        <form onSubmit={upload} class="flex flex-col gap-2">
          <details class="text-[11px] text-text-base">
            <summary class="cursor-pointer outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-collab-accent-line">
              How to get the JSON (Mac)
            </summary>
            <pre class="mt-1 overflow-x-auto rounded-md border border-border-weak-base bg-surface-inset-base px-2 py-1.5 font-mono text-[10.5px] text-text-strong">
{`security find-generic-password -s "Claude Code-credentials" -w`}
            </pre>
            <p class="mt-1">
              Copy the entire output and paste it below. Three shapes are accepted: Mac keychain dump (nested{" "}
              <code class="font-mono">claudeAiOauth</code>), flat camelCase{" "}
              <code class="font-mono">{`{accessToken, refreshToken}`}</code>, or flat snake_case{" "}
              <code class="font-mono">{`{access_token, refresh_token}`}</code>. Stored on the server's EFS at{" "}
              <code class="font-mono">~/.local/share/opencode/claude-credentials.json</code>, visible only to the
              running container.
            </p>
          </details>

          <p class="rounded-md border border-border-warning-base bg-surface-warning-weak px-2 py-1.5 text-[11px] text-text-on-warning-base">
            <strong>Shared across all collab sessions.</strong> These credentials authenticate every collab session on
            this server. LLM usage is billed to your Claude account until someone else uploads their own. Per-session
            isolation is tracked in{" "}
            <a
              href="https://github.com/unleashlive/opencode/issues/15"
              target="_blank"
              rel="noreferrer"
              class="underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-collab-accent-line"
            >
              issue #15
            </a>
            .
          </p>

          <textarea
            value={json()}
            onInput={(e) => setJson(e.currentTarget.value)}
            placeholder='{"claudeAiOauth":{"accessToken":"sk-ant-...","refreshToken":"sk-ant-..."}}'
            rows={5}
            class={`${FIELD} resize-y font-mono`}
            spellcheck={false}
            autocomplete="off"
          />

          <Show when={uploadErr()}>
            {(message) => <p class="text-[11px] text-text-on-critical-base">{message()}</p>}
          </Show>

          <div class="flex items-center gap-2">
            <button type="submit" disabled={uploading() || !json().trim()} class={`${BTN_GHOST} h-7 px-3`}>
              {uploading() ? "Uploading…" : present() ? "Overwrite with these" : "Use these credentials"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowUpload(false)
                setJson("")
                setUploadErr(null)
              }}
              disabled={uploading()}
              class={TEXT_ACTION}
            >
              Cancel
            </button>
          </div>
        </form>
      </Show>
    </div>
  )
}

/** Cheap relative-time formatter — "5m ago", "2h ago", "Jun 14". */
function relativeTimeShort(mtimeMs: number): string {
  if (!mtimeMs) return "unknown"
  const diff = (Date.now() - mtimeMs) / 1000
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(mtimeMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
