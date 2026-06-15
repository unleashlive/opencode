/**
 * Frontend live-preview launcher control.
 *
 * Renders in the left panel of /collab/<id>, above the Open Pull Request
 * button.  Hides unless the session has at least one preview-capable repo
 * (computed server-side via `availablePreview` on the session payload).
 *
 * Three visual states driven by `collab.previewState()`:
 *
 *   null            → "Launch Unleash live frontend" button.  Driver-only.
 *                    Also the post-stop and post-idle-timeout state — the
 *                    server's collab:preview_stopped event sets previewState
 *                    back to null so we naturally return to the Launch button.
 *   "installing"    → spinner + last few log lines + Cancel (Driver)
 *   "running"       → 🟢 pill + "Open preview" link + Restart / Stop (Driver)
 *   "failed"        → ❌ banner with error tail + Retry (Driver)
 *
 * Plan: ~/.claude/plans/frontend-live-preview.md
 * Server: packages/opencode/src/collab/preview-launcher.ts
 */

import { createMemo, createSignal, Show, For } from "solid-js"
import { useCollab, type PreviewStateSnapshot, type PreviewHolder } from "@/context/collab"
import { BTN_PRIMARY, BTN_SUCCESS, BTN_SECONDARY } from "./ui"

export function PreviewLauncher() {
  const collab = useCollab()

  // The launcher only shows when the session has a preview-capable repo.
  // Server flags this via `availablePreview` on the session GET response —
  // see packages/opencode/src/collab/router.ts.
  const available = createMemo(() => collab.session()?.availablePreview ?? null)
  const state = createMemo(() => collab.previewState())
  const isDriver = createMemo(() => collab.viewerRole() === "driver")

  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Who holds the single, container-wide preview slot — looked up on demand
  // when a launch fails (typically the "already running in another session"
  // 409) so the Driver can see whom to ask to stop it.  undefined = not looked
  // up yet; null = nobody is running one.
  const [holder, setHolder] = createSignal<PreviewHolder | null | undefined>(undefined)
  const [holderBusy, setHolderBusy] = createSignal(false)

  async function whoHasIt() {
    if (holderBusy()) return
    setHolderBusy(true)
    try {
      setHolder(await collab.previewHolder())
    } finally {
      setHolderBusy(false)
    }
  }

  async function launch() {
    if (busy() || !isDriver()) return
    setBusy(true)
    setError(null)
    setHolder(undefined)
    try {
      await collab.launchPreview()
    } catch (err) {
      setError(humanize(err))
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    if (busy()) return
    setBusy(true)
    setError(null)
    try {
      await collab.stopPreview()
    } catch (err) {
      setError(humanize(err))
    } finally {
      setBusy(false)
    }
  }

  async function restart() {
    if (busy() || !isDriver()) return
    setBusy(true)
    setError(null)
    try {
      await collab.restartPreview()
    } catch (err) {
      setError(humanize(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={available()}>
      <div class="px-3 py-3 border-t border-zinc-800/60 flex-shrink-0 space-y-1.5">
        <Show
          when={state()}
          fallback={
            // No preview running — show the Launch button (Driver only).
            <button
              type="button"
              onClick={launch}
              disabled={busy() || !isDriver()}
              title={!isDriver() ? "Drivers only" : undefined}
              class={`${BTN_PRIMARY} w-full py-2 text-sm`}
            >
              <Show
                when={!busy()}
                fallback={
                  <>
                    <Spinner />
                    Launching…
                  </>
                }
              >
                {/* Rocket icon */}
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                </svg>
                {`Launch ${available()!.label}`}
              </Show>
            </button>
          }
        >
          {(s) => (
            <>
              <Show when={s().status === "installing"}>
                <InstallingBanner
                  state={s()}
                  isDriver={isDriver()}
                  onCancel={stop}
                  busy={busy()}
                />
              </Show>

              <Show when={s().status === "running"}>
                <RunningBanner
                  state={s()}
                  isDriver={isDriver()}
                  onStop={stop}
                  onRestart={restart}
                  busy={busy()}
                />
              </Show>

              <Show when={s().status === "failed"}>
                <FailedBanner
                  state={s()}
                  isDriver={isDriver()}
                  onRetry={launch}
                  busy={busy()}
                />
              </Show>
              {/* No "stopped" branch — collab:preview_stopped clears
                  previewState to null, taking us back to the Launch button
                  via the fallback above.  Idle-timeout stops behave the
                  same (server SIGTERMs + broadcasts stopped + nulls). */}
            </>
          )}
        </Show>

        <Show when={error()}>
          <div class="px-1 space-y-1.5">
            <p class="text-[11px] text-red-400">{error()}</p>
            <button
              type="button"
              onClick={whoHasIt}
              disabled={holderBusy()}
              class={`${BTN_SECONDARY} w-full py-1 text-[11px]`}
              title="Find which collab session is holding the preview slot, and who's in it"
            >
              {holderBusy() ? "Checking…" : "Who has the preview running?"}
            </button>
            <Show when={holder() !== undefined}>
              <Show
                when={holder()}
                fallback={
                  <p class="text-[11px] text-zinc-500">No preview is running right now — try launching again.</p>
                }
              >
                {(h) => (
                  <div class="rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-1.5 space-y-1">
                    <Show
                      when={!h().isSelf}
                      fallback={<p class="text-[11px] text-zinc-300">This session already holds the preview.</p>}
                    >
                      <p class="text-[11px] text-zinc-300">
                        Held by{" "}
                        <span class="font-medium text-zinc-100">{h().sessionName ?? h().collabSessionId}</span>
                        <span class="text-zinc-500"> · {h().repoFullName.split("/").pop()}</span>
                      </p>
                      <Show when={h().participants.length > 0}>
                        <div class="flex flex-wrap gap-1">
                          <For each={h().participants}>
                            {(p) => (
                              <a
                                href={`https://github.com/${p.githubLogin}`}
                                target="_blank"
                                rel="noreferrer"
                                class="inline-flex items-center gap-1 rounded-full border border-zinc-700/50 bg-zinc-900/60 py-0.5 pl-0.5 pr-1.5 text-[10px] hover:border-zinc-500 transition-colors"
                              >
                                <img
                                  src={p.githubAvatarUrl || `https://github.com/${p.githubLogin}.png?size=20`}
                                  alt={p.githubLogin}
                                  class="h-3.5 w-3.5 rounded-full"
                                />
                                <span class="text-zinc-300">@{p.githubLogin}</span>
                                <Show when={p.role === "driver"}>
                                  <span class="text-amber-400/80">driver</span>
                                </Show>
                              </a>
                            )}
                          </For>
                        </div>
                        <p class="text-[10px] text-zinc-500">Ask a Driver above to stop it, or wait for the idle timeout.</p>
                      </Show>
                    </Show>
                  </div>
                )}
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function InstallingBanner(props: {
  state: PreviewStateSnapshot
  isDriver: boolean
  onCancel: () => void
  busy: boolean
}) {
  const lines = () => props.state.recentLog.slice(-5)
  return (
    <div class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-1.5">
      <div class="flex items-center gap-2 text-xs text-amber-200">
        <Spinner />
        <span class="flex-1">Installing dev server…</span>
        <Show when={props.isDriver}>
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.busy}
            class="text-[10px] px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 hover:text-red-300 hover:border-red-500/60 disabled:opacity-50 transition-colors"
            title="SIGTERM the install + dev-server process tree"
          >
            Cancel
          </button>
        </Show>
      </div>
      <p class="text-[10px] text-amber-300/70">
        First launch installs node_modules — this can take a few minutes.  Subsequent
        launches reuse the cache and are near-instant.
      </p>
      <Show when={lines().length > 0}>
        <pre class="text-[10px] text-zinc-400 bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1 overflow-x-auto font-mono leading-tight">
          <For each={lines()}>
            {(l) => (
              <div
                class={l.stream === "stderr" ? "text-red-300/80" : "text-zinc-400"}
              >
                {l.line.slice(0, 200)}
              </div>
            )}
          </For>
        </pre>
      </Show>
    </div>
  )
}

function RunningBanner(props: {
  state: PreviewStateSnapshot
  isDriver: boolean
  onStop: () => void
  onRestart: () => void
  busy: boolean
}) {
  // Server-authoritative preview URL.  The server computes it
  // (preview-host.ts → previewUrl()): an absolute
  // `https://preview.collab…/` when a dedicated preview host is configured
  // (root serve, base href "/"), else the legacy portless `/preview/`.  We
  // link to it verbatim so the SPA never hard-codes the host.  Fallback to
  // `/preview/` only for older servers whose snapshot predates the `url`
  // field.
  const url = () => props.state.url ?? `/preview/`
  return (
    <div class="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 space-y-1.5">
      <div class="flex items-center gap-2 text-xs text-emerald-200">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span class="font-medium flex-1 truncate">{props.state.label} running</span>
      </div>
      <a
        href={url()}
        target="_blank"
        rel="noreferrer"
        class={`${BTN_SUCCESS} w-full px-2 py-1.5 text-xs`}
      >
        Open preview ↗
      </a>
      <Show when={props.isDriver}>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            onClick={props.onRestart}
            disabled={props.busy}
            class="flex-1 text-[11px] py-1 rounded border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white disabled:opacity-50 transition-colors"
            title="SIGTERM the dev server and relaunch with the same config"
          >
            ⟳ Restart
          </button>
          <button
            type="button"
            onClick={props.onStop}
            disabled={props.busy}
            class="flex-1 text-[11px] py-1 rounded border border-zinc-700 hover:border-red-500/60 text-zinc-300 hover:text-red-300 disabled:opacity-50 transition-colors"
          >
            ✕ Stop
          </button>
        </div>
      </Show>
      <p class="text-[10px] text-emerald-300/60 leading-relaxed">
        HMR keeps the preview live as the LLM edits files — no refresh
        needed.  Auto-stops after 30 min of no traffic.
      </p>
    </div>
  )
}

function FailedBanner(props: {
  state: PreviewStateSnapshot
  isDriver: boolean
  onRetry: () => void
  busy: boolean
}) {
  const tailLines = () => props.state.recentLog.slice(-10)
  return (
    <div class="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 space-y-1.5">
      <div class="flex items-center gap-2 text-xs text-red-200 font-medium">
        <span>❌ Preview failed</span>
      </div>
      <Show when={props.state.errorMessage}>
        <p class="text-[11px] text-red-300/90">{props.state.errorMessage}</p>
      </Show>
      <Show when={tailLines().length > 0}>
        <pre class="text-[10px] text-zinc-400 bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1 overflow-x-auto font-mono leading-tight max-h-32 overflow-y-auto">
          <For each={tailLines()}>
            {(l) => (
              <div class={l.stream === "stderr" ? "text-red-300/80" : "text-zinc-400"}>
                {l.line.slice(0, 200)}
              </div>
            )}
          </For>
        </pre>
      </Show>
      <Show
        when={props.isDriver}
        fallback={
          <p class="text-[10px] text-zinc-500">Ask a Driver to retry.</p>
        }
      >
        <button
          type="button"
          onClick={props.onRetry}
          disabled={props.busy}
          class="w-full text-[11px] py-1.5 rounded bg-red-600/30 border border-red-500/50 hover:bg-red-600/40 text-red-100 disabled:opacity-50 transition-colors"
        >
          {props.busy ? "Retrying…" : "Retry"}
        </button>
      </Show>
    </div>
  )
}

function Spinner() {
  return (
    <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function humanize(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // api() throws with the raw response body; collab routes return JSON like
  // {"error":"…","existing":{…}}.  Surface the human message, not the JSON blob.
  try {
    const parsed = JSON.parse(raw) as { error?: unknown }
    if (parsed && typeof parsed.error === "string") return parsed.error
  } catch {
    // not JSON — use as-is
  }
  return raw
}

