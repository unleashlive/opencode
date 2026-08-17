/**
 * Frontend live-preview control for the agent stage (SKU-1).
 *
 * Hides entirely unless the session has a preview-capable repo (computed
 * server-side via `availablePreview` on the session payload).
 *
 * The control is split in two so the status strip can place each half where it
 * belongs, while both halves share one piece of state:
 *
 *   createPreviewController()  the state + actions (launch / stop / restart /
 *                              "who holds the slot").
 *   PreviewPrimaryAction       the single primary button, shown only while no
 *                              preview is running.  Lives in the strip.
 *   PreviewLifecycleRow        the installing / running / failed rows, drawn as
 *                              quiet tinted lines under the strip rather than
 *                              stacked banners.
 *
 * Lifecycle states driven by `collab.previewState()`:
 *   null          → Launch button (Driver only).  Also the post-stop and
 *                   post-idle-timeout state: collab:preview_stopped nulls the
 *                   snapshot, so we return here on our own.
 *   "installing"  → spinner + log tail + Cancel (Driver)
 *   "running"     → success row + Open preview + Restart / Stop (Driver)
 *   "failed"      → critical row + log tail + Retry (Driver)
 *
 * Server: packages/opencode/src/collab/preview-launcher.ts
 */

import { createMemo, createSignal, Show, For, type Accessor } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useCollab, type PreviewStateSnapshot, type PreviewHolder } from "@/context/collab"
import type { AvailablePreview } from "@opencode-ai/collab"
import { BTN_PRIMARY, BTN_GHOST } from "./ui"

export interface PreviewController {
  available: Accessor<AvailablePreview | null>
  state: Accessor<PreviewStateSnapshot | null>
  isDriver: Accessor<boolean>
  busy: Accessor<boolean>
  error: Accessor<string | null>
  /** undefined = never looked up; null = nobody holds the slot. */
  holder: Accessor<PreviewHolder | null | undefined>
  holderBusy: Accessor<boolean>
  launch: () => void
  stop: () => void
  restart: () => void
  whoHasIt: () => void
}

export function createPreviewController(): PreviewController {
  const collab = useCollab()

  const available = createMemo(() => collab.session()?.availablePreview ?? null)
  const state = createMemo(() => collab.previewState())
  const isDriver = createMemo(() => collab.viewerRole() === "driver")

  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  // Who holds the single, container-wide preview slot — looked up on demand
  // when a launch fails (typically the "already running in another session"
  // 409) so the Driver can see whom to ask to stop it.
  const [holder, setHolder] = createSignal<PreviewHolder | null | undefined>(undefined)
  const [holderBusy, setHolderBusy] = createSignal(false)

  async function guard(fn: () => Promise<void>) {
    if (busy()) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(humanize(err))
    } finally {
      setBusy(false)
    }
  }

  return {
    available,
    state,
    isDriver,
    busy,
    error,
    holder,
    holderBusy,
    launch: () => {
      if (!isDriver()) return
      setHolder(undefined)
      void guard(() => collab.launchPreview())
    },
    stop: () => void guard(() => collab.stopPreview()),
    restart: () => {
      if (!isDriver()) return
      void guard(() => collab.restartPreview())
    },
    whoHasIt: () => {
      if (holderBusy()) return
      setHolderBusy(true)
      void collab
        .previewHolder()
        .then((h) => setHolder(h))
        .finally(() => setHolderBusy(false))
    },
  }
}

/** The one primary action on the agent stage, while nothing is running. */
export function PreviewPrimaryAction(props: { ctl: PreviewController }) {
  const ctl = props.ctl
  return (
    <Show when={ctl.available() && !ctl.state()}>
      <button
        type="button"
        onClick={ctl.launch}
        disabled={ctl.busy() || !ctl.isDriver()}
        title={ctl.isDriver() ? `Start ${ctl.available()!.label}` : "Drivers only"}
        class={`${BTN_PRIMARY} h-7 px-2.5`}
      >
        <Show when={!ctl.busy()} fallback={<Spinner class="size-3.5" />}>
          <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
        </Show>
        {ctl.busy() ? "Launching…" : "Launch live preview"}
      </button>
    </Show>
  )
}

/** Installing / running / failed, plus the launch-error recovery block. */
export function PreviewLifecycleRow(props: { ctl: PreviewController }) {
  const ctl = props.ctl
  return (
    <Show when={ctl.available()}>
      <Show when={ctl.state()}>
        {(s) => (
          <>
            <Show when={s().status === "installing"}>
              <QuietRow tone="neutral">
                <Spinner class="size-3.5 shrink-0 text-icon-base" />
                <span class="shrink-0 text-12-medium text-text-strong">Installing dev server</span>
                <LogTail lines={s().recentLog.slice(-2)} />
                <Show when={ctl.isDriver()}>
                  <Actions>
                    <TextAction label="Cancel" disabled={ctl.busy()} onClick={ctl.stop} />
                  </Actions>
                </Show>
              </QuietRow>
            </Show>

            <Show when={s().status === "running"}>
              <QuietRow tone="success">
                <span class="size-1.5 shrink-0 rounded-full bg-surface-success-strong" aria-hidden="true" />
                <span class="truncate text-12-medium text-text-strong">{s().label} running</span>
                <span class="shrink-0 font-mono text-[10.5px] text-text-weak">:{s().port}</span>
                <Actions>
                  <a
                    href={s().url ?? "/preview/"}
                    target="_blank"
                    rel="noreferrer"
                    class={`${BTN_GHOST} h-6 shrink-0 px-2 text-text-on-success-base`}
                  >
                    Open preview
                  </a>
                  <Show when={ctl.isDriver()}>
                    <TextAction label="Restart" disabled={ctl.busy()} onClick={ctl.restart} />
                    <TextAction label="Stop" disabled={ctl.busy()} onClick={ctl.stop} />
                  </Show>
                </Actions>
              </QuietRow>
            </Show>

            <Show when={s().status === "failed"}>
              <QuietRow tone="critical">
                <span class="shrink-0 text-12-medium text-text-on-critical-base">Preview failed</span>
                <Show when={s().errorMessage}>
                  {(message) => <span class="shrink-0 truncate text-12-regular text-text-base">{message()}</span>}
                </Show>
                <LogTail lines={s().recentLog.slice(-2)} />
                <Actions>
                  <Show
                    when={ctl.isDriver()}
                    fallback={<span class="font-mono text-[10px] text-text-base">ask a driver to retry</span>}
                  >
                    <TextAction label={ctl.busy() ? "Retrying…" : "Retry"} disabled={ctl.busy()} onClick={ctl.launch} />
                  </Show>
                </Actions>
              </QuietRow>
            </Show>
          </>
        )}
      </Show>

      <Show when={ctl.error()}>
        {(message) => (
          <QuietRow tone="critical">
            <span class="min-w-0 flex-1 truncate text-12-regular text-text-on-critical-base" title={message()}>
              {message()}
            </span>
            <Actions>
              <TextAction label={ctl.holderBusy() ? "Checking…" : "Who has it?"} disabled={ctl.holderBusy()} onClick={ctl.whoHasIt} />
            </Actions>
          </QuietRow>
        )}
      </Show>

      <Show when={ctl.holder() !== undefined}>
        <QuietRow tone="neutral">
          <Show
            when={ctl.holder()}
            fallback={<span class="text-12-regular text-text-base">No preview is running right now. Try launching again.</span>}
          >
            {(h) => (
              <Show
                when={!h().isSelf}
                fallback={<span class="text-12-regular text-text-base">This session already holds the preview.</span>}
              >
                <span class="shrink-0 text-12-regular text-text-base">
                  Held by <span class="text-text-strong">{h().sessionName ?? h().collabSessionId}</span>
                </span>
                <span class="shrink-0 font-mono text-[10.5px] text-text-base">{h().repoFullName.split("/").pop()}</span>
                <div class="flex min-w-0 flex-wrap items-center gap-1">
                  <For each={h().participants}>
                    {(p) => (
                      <a
                        href={`https://github.com/${p.githubLogin}`}
                        target="_blank"
                        rel="noreferrer"
                        title={`${p.githubLogin} · ${p.role}`}
                        class="inline-flex min-h-6 items-center gap-1 rounded-full border border-border-weak-base py-0.5 pl-0.5 pr-1.5 outline-none transition-colors duration-150 ease-out hover:bg-surface-base-hover focus-visible:ring-2 focus-visible:ring-collab-accent-line motion-reduce:transition-none"
                      >
                        <img
                          src={p.githubAvatarUrl || `https://github.com/${p.githubLogin}.png?size=20`}
                          alt=""
                          class="size-4 rounded-full"
                        />
                        <span class="font-mono text-[10px] text-text-base">@{p.githubLogin}</span>
                      </a>
                    )}
                  </For>
                </div>
              </Show>
            )}
          </Show>
        </QuietRow>
      </Show>
    </Show>
  )
}

// ── Row primitives ───────────────────────────────────────────────────────────

/** A single-line tinted strip under the status bar. Never a stacked banner. */
function QuietRow(props: { tone: "neutral" | "success" | "critical"; children: any }) {
  return (
    <div
      classList={{
        "flex min-h-8 shrink-0 items-center gap-2 border-b px-4 py-1": true,
        "border-border-weak-base bg-surface-base": props.tone === "neutral",
        "border-border-success-base bg-surface-success-weak": props.tone === "success",
        "border-border-critical-base bg-surface-critical-weak": props.tone === "critical",
      }}
    >
      {props.children}
    </div>
  )
}

/** The last couple of log lines, inline and clipped — a tail, not a console. */
function LogTail(props: { lines: ReadonlyArray<{ stream: "stdout" | "stderr"; line: string }> }) {
  return (
    <Show when={props.lines.length > 0}>
      <span class="min-w-0 flex-1 truncate font-mono text-[10px] text-text-base" title={props.lines.map((l) => l.line).join("\n")}>
        {props.lines[props.lines.length - 1]!.line.slice(0, 200)}
      </span>
    </Show>
  )
}

/** Right-aligned trailing controls of a quiet row. */
function Actions(props: { children: any }) {
  return <span class="ml-auto flex shrink-0 items-center gap-2">{props.children}</span>
}

function TextAction(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      class="inline-flex min-h-6 shrink-0 items-center rounded px-1 text-[11px] font-[500] text-text-base outline-none transition-colors duration-150 ease-out hover:text-text-strong focus-visible:ring-2 focus-visible:ring-collab-accent-line disabled:cursor-not-allowed disabled:text-text-weaker motion-reduce:transition-none"
    >
      {props.label}
    </button>
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
