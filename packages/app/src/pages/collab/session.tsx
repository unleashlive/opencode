/**
 * /collab/:id — Collab Session (SKU-1 IA)
 *
 *  ┌──────────────────────────────────────────────────────────────────┐
 *  │ Top bar: identity, repo + branch, people, invite, theme, overflow │
 *  ├────────────┬────────────────────────────────────┬────────────────┤
 *  │  Timeline  │  Agent stage                       │  Team chat     │
 *  │  rail      │    status strip                    │  rail          │
 *  │  (304px)   │    embedded opencode session       │  (296px,       │
 *  │            │    (iframe)                        │  collapsible)  │
 *  └────────────┴────────────────────────────────────┴────────────────┘
 *
 * Three dedicated surfaces replace the single mixed sidebar that used to stack
 * participants, prompt hints, chat, queue, preview, PR, compact, export and
 * repos into one 288px column. Below md the same three surfaces become tabs.
 *
 * The prompt textarea itself lives inside the iframe (so users keep every
 * opencode shortcut); submissions there are intercepted via postMessage and
 * routed through the collab queue. That wiring is unchanged.
 */

import { createSignal, createResource, createEffect, createMemo, onMount, onCleanup, For, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { CollabProvider, useCollab } from "@/context/collab"
import { InviteDialog } from "@/components/collab/InviteDialog"
import { AddRepoDialog } from "@/components/collab/AddRepoDialog"
import { TutorialDialog } from "@/components/collab/TutorialDialog"
import { McpConfigDialog } from "@/components/collab/McpConfigDialog"
import { ParticipantsDialog } from "@/components/collab/ParticipantsDialog"
import { TeamChatRail } from "@/components/collab/TeamNoteComposer"
import { TimelineRail } from "@/components/collab/TimelineRail"
import { SessionTopBar } from "@/components/collab/SessionTopBar"
import { StatusStrip } from "@/components/collab/StatusStrip"
import { base64Encode } from "@opencode-ai/core/util/encode"
import type { CollabRole } from "@opencode-ai/collab"
import { BTN_GHOST } from "@/components/collab/ui"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Me {
  githubId: number
  githubLogin: string
  githubAvatarUrl: string
}

/** Which surface the phone-width layout is showing. */
type MobileView = "timeline" | "editor" | "chat"

// ── Inner component (inside CollabProvider) ────────────────────────────────────

function CollabSessionInner(props: { me: Me }) {
  const collab = useCollab()
  const [showInvite, setShowInvite] = createSignal(false)
  const [showTutorial, setShowTutorial] = createSignal(false)
  const [showMcpConfig, setShowMcpConfig] = createSignal(false)
  const [addRepoOpen, setAddRepoOpen] = createSignal(false)
  const [showParticipants, setShowParticipants] = createSignal(false)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [submitError, setSubmitError] = createSignal<string | null>(null)
  // Mobile only. Desktop (md+) always shows all three surfaces and ignores this.
  const [mobileView, setMobileView] = createSignal<MobileView>("editor")

  const myParticipant = () => collab.session()?.participants.find((p) => p.githubId === props.me.githubId)
  const myRole = (): CollabRole => myParticipant()?.role ?? "viewer"

  /**
   * Anything floating above the editor has to hide it: an iframe renders in its
   * own composited layer and can paint over an overlay regardless of z-index.
   */
  const editorObscured = () =>
    showInvite() || addRepoOpen() || showTutorial() || showMcpConfig() || showParticipants() || menuOpen()

  /**
   * Listen for prompt submissions from inside the opencode iframe.  The
   * iframe's PromptInput posts `opencode:collab-prompt-submit` when in
   * embed mode, instead of dispatching to opencode directly.  We forward
   * the content through the collab API so it gets queue / approval /
   * direct-dispatch routing based on (queueMode, role).
   */
  onMount(() => {
    function onIframeMessage(event: MessageEvent) {
      // Same-origin only — the iframe runs at the same origin as this page.
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!data || typeof data !== "object") return

      // Prompt submission: route through the collab queue.
      if (data.type === "opencode:collab-prompt-submit") {
        const content = typeof data.content === "string" ? data.content.trim() : ""
        // Image attachments uploaded in the iframe prompt — forwarded so the
        // LLM receives them as file parts (collab/router.ts builds the parts).
        const attachments = Array.isArray(data.attachments) ? data.attachments : undefined
        // Allow an image-only prompt (no text), but never a fully empty submit.
        if (!content && (!attachments || attachments.length === 0)) return
        if (myRole() === "viewer") {
          setSubmitError("Viewers cannot send prompts.")
          return
        }
        setSubmitError(null)
        const model = typeof data.model === "string" ? data.model : undefined
        const agent = typeof data.agent === "string" ? data.agent : undefined
        const variant = typeof data.variant === "string" ? data.variant : undefined
        collab.submitPrompt(content, model, agent, variant, attachments).catch((err) => {
          setSubmitError(err instanceof Error ? err.message : String(err))
        })
        return
      }

      // Typing indicator: forward to the server so other participants
      // see it in the team chat rail (when visibilityMode === "typing").
      if (data.type === "opencode:collab-typing") {
        if (myRole() === "viewer") return
        void collab.setTyping(Boolean(data.typing))
        return
      }

      // Native session switched inside the iframe (e.g. opencode's
      // cross-session "go to session" popup).  Swap the whole collab page to
      // the collab session that owns that native session, so the rails match
      // the conversation shown in the middle.
      if (data.type === "opencode:collab-session-changed") {
        const nativeId = typeof data.sessionId === "string" ? data.sessionId : ""
        if (!nativeId) return
        // Already showing this native session → nothing to do (also breaks the
        // post-navigation echo: the freshly-loaded iframe re-announces its id).
        if (nativeId === collab.session()?.sessionId) return
        void (async () => {
          try {
            const res = await fetch("/collab/session")
            if (!res.ok) return
            const list = (await res.json()) as Array<{ id: string; sessionId?: string | null }>
            const target = list.find((s) => s.sessionId === nativeId)
            if (target && target.id !== collab.session()?.id) {
              // Full page nav so CollabProvider remounts with the new session
              // (fresh participants + SSE) — same pattern as the brand lockup.
              window.location.href = `/collab/${target.id}`
            }
          } catch {
            /* best-effort — leave the page as-is if the lookup fails */
          }
        })()
        return
      }
    }
    window.addEventListener("message", onIframeMessage)
    onCleanup(() => window.removeEventListener("message", onIframeMessage))
  })

  return (
    <div class="flex h-dvh flex-col overflow-hidden bg-background-base text-text-base">
      <SessionTopBar
        myRole={myRole()}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        onInvite={() => setShowInvite(true)}
        onTutorial={() => setShowTutorial(true)}
        onMcpConfig={() => setShowMcpConfig(true)}
        onAddRepo={() => setAddRepoOpen(true)}
        onManageParticipants={() => setShowParticipants(true)}
      />

      <div class="flex min-h-0 flex-1">
        <TimelineRail myLogin={props.me.githubLogin} class={mobileView() === "timeline" ? "" : "hidden md:flex"} />

        {/* ── CENTER: agent stage ─────────────────────────────────────────── */}
        <main
          class="relative min-w-0 flex-1 flex-col md:flex"
          classList={{ flex: mobileView() === "editor", hidden: mobileView() !== "editor" }}
        >
          <StatusStrip myRole={myRole()} />

          <Show when={submitError()}>
            {(message) => (
              <div class="flex min-h-8 shrink-0 items-center gap-2 border-b border-border-critical-base bg-surface-critical-weak px-4 py-1">
                <span class="min-w-0 flex-1 text-12-regular text-text-on-critical-base">{message()}</span>
                <button
                  type="button"
                  onClick={() => setSubmitError(null)}
                  aria-label="Dismiss error"
                  class="shrink-0 rounded px-1 text-[11px] font-[500] text-text-base outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-collab-accent-line"
                >
                  Dismiss
                </button>
              </div>
            )}
          </Show>

          {/* Iframe gate: no repos → render the recovery panel instead of the
              iframe.  Server side enforces the same — /<base64>/?cs=<id> with
              an empty-repos session 401s (see cookie-auth.ts).  Both are needed:
              client side for UX (no broken iframe), server side for security
              (no URL-crafting around the gate). */}
          <Show
            when={(collab.session()?.repos.length ?? 0) > 0}
            fallback={
              // A null session = not loaded yet (initial fetch or a reconnect in
              // flight, e.g. during a deploy or an SSE drop) — show the
              // preparing/connecting state, NOT the scary "No repositories
              // linked" panel.  Only a LOADED session with genuinely zero repos
              // gets EmptyReposPanel.  Without this guard a transient blip makes
              // a session that HAS a repo look mis-configured.
              <Show when={collab.session()} fallback={<PreparingWorkspacePanel />}>
                <EmptyReposPanel />
              </Show>
            }
          >
            {/* Triple gate before the iframe mounts:
                  1. initStatus === "ready"  — workspace clone + branch checkout
                                                actually finished on the server.
                  2. nativeSessionDirectory   — set by collab:native_session_linked.
                  3. sessionId                — same SSE event.

                initStatus is the load-bearing one: the gate used to require only
                (2) + (3), which the broken-fallback preWarm could satisfy even
                after a clone failure — the iframe would mount pointing at an
                empty workspace and the prompt input would lock up because
                opencode's InstanceStore had nothing to attach to.  See
                docs/adr/0001 and the fix/session commits.

                initStatus === "failed" → the recovery panel takes over.  Driver
                gets a retry button; everyone else sees the failure reason and
                is told to wait. */}
            <Show
              when={collab.session()?.initStatus === "failed"}
              fallback={
                <Show
                  when={
                    (collab.session()?.initStatus ?? "ready") === "ready" &&
                    collab.nativeSessionDirectory() &&
                    collab.session()?.sessionId
                  }
                  fallback={<PreparingWorkspacePanel />}
                >
                  {(_) => {
                    const dir = collab.nativeSessionDirectory()!
                    const sid = collab.session()!.sessionId!
                    const cid = collab.session()!.id
                    const sessionUrl = `/${base64Encode(dir)}/session/${sid}?embed=collab&cs=${encodeURIComponent(cid)}`
                    return (
                      <iframe
                        src={sessionUrl}
                        class="w-full flex-1 border-0 bg-background-base"
                        title="Unleash Collab session"
                        style={`flex: 1; width: 100%; height: 100%; display: block; ${editorObscured() ? "visibility: hidden;" : ""}`}
                      />
                    )
                  }}
                </Show>
              }
            >
              <WorkspaceFailedPanel />
            </Show>
          </Show>
        </main>

        {/* ── RIGHT: team chat ────────────────────────────────────────────────
            Two instances rather than one: the desktop rail can be collapsed to
            a strip, and that strip must not be what a phone shows when the
            Chat tab is selected. */}
        <TeamChatRail readonly={myRole() === "viewer"} variant="rail" class="hidden md:flex" />
        <TeamChatRail
          readonly={myRole() === "viewer"}
          variant="pane"
          class={mobileView() === "chat" ? "md:hidden" : "hidden"}
        />
      </div>

      {/* Mobile-only surface switcher. Hidden at md+, where all three show. */}
      <div role="tablist" aria-label="Session surfaces" class="flex shrink-0 border-t border-border-weak-base bg-surface-base md:hidden">
        <MobileTab label="Timeline" active={mobileView() === "timeline"} onSelect={() => setMobileView("timeline")} />
        <MobileTab label="Editor" active={mobileView() === "editor"} onSelect={() => setMobileView("editor")} />
        <MobileTab
          label="Chat"
          active={mobileView() === "chat"}
          badge={collab.unreadMentions() > 0}
          onSelect={() => {
            setMobileView("chat")
            collab.clearMentions()
          }}
        />
      </div>

      <Show when={showTutorial()}>
        <TutorialDialog onClose={() => setShowTutorial(false)} />
      </Show>

      <Show when={showInvite()}>
        <InviteDialog onClose={() => setShowInvite(false)} />
      </Show>

      {/* Add-repo dialog — Drivers only.  Opened from the overflow menu; clones
          the picks onto the collab branch mid-session. */}
      <Show when={addRepoOpen() && myRole() === "driver"}>
        <AddRepoDialog onClose={() => setAddRepoOpen(false)} />
      </Show>

      <Show when={showMcpConfig() && myRole() === "driver"}>
        <McpConfigDialog onClose={() => setShowMcpConfig(false)} />
      </Show>

      <Show when={showParticipants()}>
        <ParticipantsDialog onClose={() => setShowParticipants(false)} />
      </Show>
    </div>
  )
}

function MobileTab(props: { label: string; active: boolean; badge?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      role="tab"
      aria-selected={props.active}
      classList={{
        "flex min-h-11 flex-1 items-center justify-center gap-1.5 border-t-2 text-12-medium outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-collab-accent-line motion-reduce:transition-none":
          true,
        "border-t-collab-accent text-text-strong": props.active,
        "border-t-transparent text-text-base hover:text-text-strong": !props.active,
      }}
    >
      {props.label}
      <Show when={props.badge}>
        <span class="size-1.5 rounded-full bg-collab-accent" aria-label="unread mentions" />
      </Show>
    </button>
  )
}

// ── Preparing-workspace placeholder ───────────────────────────────────────────
//
// Rendered while the server clones repos + checks out the collab branch +
// pre-warms the native opencode session.  See the comment above the iframe
// `<Show>` in CollabSessionInner for the reasoning.
//
// Two phases:
//   1. First 4 minutes — rotating status copy.  Big monorepos with submodules
//      and a cold plugin cache can legitimately take a few minutes; a 30s
//      timeout used to rush users into a "stalled" message before the server
//      was actually done.
//   2. After 4 minutes — assumes preWarm has truly stalled; offers a refresh.
//      A reload re-triggers the SPA's data fetch + SSE handshake and the iframe
//      remounts cleanly against whatever state the server has reached.

const PREPARING_TIMEOUT_MS = 4 * 60 * 1000

/** Rotating status messages, cycled every ~3.5s. There is no real progress
 *  signal from the server, so this is the honest stand-in: it names the step
 *  the server is likely on rather than drawing a fake progress bar. */
const PREPARING_TIPS: ReadonlyArray<string> = [
  "Cloning your repositories",
  "Checking out the collab branch",
  "Installing the prepare-commit-msg hook",
  "Warming up the editor",
  "Bootstrapping the agent session",
  "Setting up the prompt queue",
] as const

function PreparingWorkspacePanel() {
  const [stalled, setStalled] = createSignal(false)
  const [tipIndex, setTipIndex] = createSignal(0)

  // Stalled fallback timer.  Lifetime-tied to the component so navigating
  // away cleans up automatically.
  createEffect(() => {
    const handle = setTimeout(() => setStalled(true), PREPARING_TIMEOUT_MS)
    onCleanup(() => clearTimeout(handle))
  })

  createEffect(() => {
    if (stalled()) return
    const interval = setInterval(() => setTipIndex((i) => (i + 1) % PREPARING_TIPS.length), 3500)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-3 bg-background-base px-6 text-center">
      <Show
        when={!stalled()}
        fallback={
          <>
            <p class="text-14-medium text-text-strong">Still working on it</p>
            <p class="max-w-sm text-12-regular text-text-base">
              Your workspace is taking longer than usual to come up. This happens with very large repos or on a cold
              worker. Refreshing reconnects you; your session and chat history are safe on the server.
            </p>
            <button type="button" onClick={() => window.location.reload()} class={`${BTN_GHOST} h-7 px-3`}>
              Refresh
            </button>
          </>
        }
      >
        <Spinner class="size-5 text-icon-base" />
        <p class="text-14-medium text-text-strong">Preparing your collab session</p>
        <p class="h-4 text-12-regular text-text-base" aria-live="polite">
          {PREPARING_TIPS[tipIndex()]}
        </p>
        <p class="max-w-sm font-mono text-[10.5px] text-text-base">
          usually 30 seconds to a few minutes
        </p>
      </Show>
    </div>
  )
}

// ── Workspace-init-failed recovery panel ──────────────────────────────────────
//
// Renders when the server-side workspace init (clone + branch checkout)
// failed.  The collab session row still exists; only the workspace clone is
// broken.  A Driver can hit "Retry initialization" to POST /collab/session/:id/reinit,
// which wipes /var/opencode/workspaces/<id>/ on the server and re-runs the
// clone.  Non-Drivers see the failure reason and are told to wait.

function WorkspaceFailedPanel() {
  const collab = useCollab()
  const isDriver = () => collab.viewerRole() === "driver"
  const [retrying, setRetrying] = createSignal(false)
  const [retryErr, setRetryErr] = createSignal<string | null>(null)

  async function retry() {
    if (retrying()) return
    setRetrying(true)
    setRetryErr(null)
    try {
      await collab.reinitWorkspace()
      // The optimistic flip to "pending" in reinitWorkspace() already swapped
      // this panel out for the PreparingWorkspacePanel.  Server will broadcast
      // workspace_ready / workspace_failed when it's done.
    } catch (err) {
      setRetryErr(err instanceof Error ? err.message : String(err))
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-3 bg-background-base px-6 text-center">
      <Icon name="warning" class="size-6 text-text-on-critical-base" />
      <p class="text-14-medium text-text-strong">Workspace setup failed</p>
      <p class="max-w-md text-12-regular text-text-base">
        The server could not finish preparing this session's workspace. Most often this is a transient git or network
        issue and a retry clears it.
      </p>

      <Show when={collab.session()?.initError}>
        <pre class="max-w-md overflow-x-auto whitespace-pre-wrap rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2 text-left font-mono text-[10.5px] text-text-on-critical-base">
          {collab.session()!.initError}
        </pre>
      </Show>

      <Show
        when={isDriver()}
        fallback={
          <p class="max-w-sm text-12-regular text-text-base">
            Only a Driver can retry workspace setup. Hang tight while someone with Driver access kicks it off.
          </p>
        }
      >
        <button type="button" onClick={retry} disabled={retrying()} class={`${BTN_GHOST} h-7 px-3`}>
          {retrying() ? "Retrying…" : "Retry initialization"}
        </button>

        <Show when={retryErr()}>
          <p class="text-[11px] text-text-on-critical-base">{retryErr()}</p>
        </Show>

        <p class="max-w-sm text-12-regular text-text-base">
          Retry wipes the server-side workspace and re-runs the shallow clone and branch checkout. Your session,
          prompts and chat history are unaffected.
        </p>
      </Show>
    </div>
  )
}

// ── Empty-repos fallback panel ────────────────────────────────────────────────
//
// Renders in place of the iframe when the collab session has no linked repos.
// Server side enforces the same gate (cookie-auth iframe rule); this panel
// is the in-UI recovery path so a Driver can fix it without deleting and
// re-creating the session.

interface FallbackRepo {
  full_name: string
  name: string
  description?: string | null
  private?: boolean
}

/**
 * Repo multi-select + "Add" action.  Shared by the empty-session recovery
 * panel and the mid-session add flow.  `exclude` hides repos already linked to
 * the session; `onDone` fires after a clean add (no warnings) so a popover can
 * close itself.  Surfaces any per-repo branch-collision warnings returned by
 * the server.
 */
function RepoPicker(props: { exclude?: string[]; onDone?: () => void }) {
  const collab = useCollab()

  const [repos] = createResource<FallbackRepo[]>(async () => {
    const res = await fetch("/collab/repos")
    if (!res.ok) return []
    return res.json()
  })
  const available = createMemo(() => {
    const ex = new Set(props.exclude ?? [])
    return (repos() ?? []).filter((r) => !ex.has(r.full_name))
  })
  const [selected, setSelected] = createSignal<string[]>([])
  const [adding, setAdding] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)
  const [warnings, setWarnings] = createSignal<Array<{ repo: string; message: string }>>([])

  function toggle(repoFullName: string) {
    setSelected((prev) =>
      prev.includes(repoFullName) ? prev.filter((r) => r !== repoFullName) : [...prev, repoFullName],
    )
  }

  async function submit() {
    if (selected().length === 0) return
    setErr(null)
    setWarnings([])
    setAdding(true)
    try {
      const res = await collab.addRepos(selected())
      setWarnings(res.warnings ?? [])
      setSelected([])
      // Keep the picker open when there are warnings so the Driver sees them;
      // otherwise let the caller dismiss it.
      if (!res.warnings?.length) props.onDone?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Show
      when={available().length > 0}
      fallback={
        <p class="py-2 text-center text-12-regular text-text-base">
          {repos.loading ? "Loading repositories…" : "No more repositories to add."}
        </p>
      }
    >
      <div class="max-h-96 divide-y divide-border-weak-base overflow-y-auto rounded-md border border-border-weak-base bg-surface-base">
        <For each={available()}>
          {(repo) => (
            <label class="flex min-h-9 cursor-pointer items-start gap-3 px-3 py-2 hover:bg-surface-base-hover">
              <input
                type="checkbox"
                class="mt-1 accent-collab-accent"
                checked={selected().includes(repo.full_name)}
                onChange={() => toggle(repo.full_name)}
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-12-medium text-text-strong">{repo.full_name}</span>
                <Show when={repo.description}>
                  <span class="line-clamp-1 text-12-regular text-text-base">{repo.description}</span>
                </Show>
              </span>
            </label>
          )}
        </For>
      </div>

      <Show when={err()}>
        <p class="mt-2 text-12-regular text-text-on-critical-base">{err()}</p>
      </Show>
      <Show when={warnings().length > 0}>
        <div class="mt-2 space-y-1">
          <For each={warnings()}>
            {(w) => (
              <p class="rounded-md border border-border-warning-base bg-surface-warning-weak px-2 py-1 text-[11px] text-text-on-warning-base">
                {w.message}
              </p>
            )}
          </For>
        </div>
      </Show>

      <div class="mt-3 flex justify-end">
        <button type="button" class={`${BTN_GHOST} h-7 px-3`} disabled={selected().length === 0 || adding()} onClick={submit}>
          {adding() ? "Adding…" : `Add ${selected().length} repo${selected().length === 1 ? "" : "s"}`}
        </button>
      </div>
    </Show>
  )
}

function EmptyReposPanel() {
  const collab = useCollab()
  const isDriver = () => collab.viewerRole() === "driver"

  return (
    <div class="flex flex-1 flex-col items-center justify-center overflow-auto bg-background-base p-8">
      <div class="w-full max-w-2xl rounded-lg border border-dashed border-border-weak-base p-6">
        <div class="mb-5 text-center">
          <h2 class="text-14-medium text-text-strong">No repositories linked</h2>
          <p class="mt-1 text-12-regular text-text-base">
            <Show
              when={isDriver()}
              fallback="A Driver of this session needs to add a repository before the workspace can open."
            >
              Pick at least one repository to add to this collab session. The workspace and editor open once it is
              cloned.
            </Show>
          </p>
        </div>

        <Show when={isDriver()}>
          <RepoPicker />
        </Show>
      </div>
    </div>
  )
}

// ── Page root ─────────────────────────────────────────────────────────────────

export default function CollabSessionPage() {
  const params = useParams<{ id: string }>()

  // Force a full remount of everything below (the `/collab/me` fetch AND
  // CollabProvider) whenever the route's :id changes, rather than relying on
  // every switch path happening to force a hard `window.location.href`
  // reload. Mirrors the identical per-id-provider pattern in
  // pages/session.tsx (`<Show when={... ? params.id : undefined} keyed>`).
  // Without this, an SPA-internal transition between two already-visited
  // `/collab/:id` URLs (e.g. browser back/forward) would leave CollabProvider
  // mounted and let its onMount-hydrated, append-only signals (queue, notes,
  // promptLog, activityLog) leak state from the old session into the new one.
  return (
    <Show when={params.id} keyed>
      {(id) => <CollabSessionPageBody id={id} />}
    </Show>
  )
}

function CollabSessionPageBody(props: { id: string }) {
  const [me, setMe] = createSignal<Me | null>(null)

  onMount(async () => {
    const res = await fetch("/collab/me")
    if (res.status === 401) {
      window.location.href = `/collab/auth/github?next=/collab/${props.id}`
      return
    }
    setMe(await res.json())
  })

  return (
    <Show
      when={me()}
      fallback={
        <div class="flex h-dvh items-center justify-center bg-background-base">
          <div class="flex items-center gap-2 text-12-regular text-text-base">
            <Spinner class="size-4" />
            Loading…
          </div>
        </div>
      }
    >
      {(meVal) => (
        <CollabProvider collabSessionId={props.id} meGithubId={meVal().githubId}>
          <CollabSessionInner me={meVal()} />
        </CollabProvider>
      )}
    </Show>
  )
}
