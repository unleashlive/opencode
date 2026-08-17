/**
 * Agent stage status strip for /collab/:id (SKU-1).
 *
 * One persistent line above the embedded editor: what the session is doing on
 * the left, what you can do about it on the right, with the preview lifecycle
 * rendered as quiet tinted rows underneath instead of stacked banners.
 *
 * What the strip can honestly show, and why:
 *   connection state   collab.isConnected() — the SSE stream is open or it is
 *                      retrying.  This is the only live signal the client has.
 *   agent + model      collab.lastSuggestion() — the agent / model / variant
 *                      the last dispatched prompt carried.
 *   preview            collab.previewState(), via createPreviewController().
 *   pull requests      the POST /collab/session/:id/pr response.
 *
 * What it deliberately does NOT show: whether the agent is busy right now,
 * elapsed turn time, or a running diffstat.  collab:prompt_submitted fires when
 * a prompt is handed to the LLM and nothing fires when the turn ends, so a
 * busy / idle dot would be a guess.  Adding those needs server support.
 */

import { createSignal, For, Show } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useCollab } from "@/context/collab"
import type { CollabRole, RepoPrResult } from "@opencode-ai/collab"
import { BTN_GHOST, CHIP } from "./ui"
import { createPreviewController, PreviewLifecycleRow, PreviewPrimaryAction } from "./PreviewLauncher"

export function StatusStrip(props: { myRole: CollabRole }) {
  const collab = useCollab()
  const preview = createPreviewController()

  const connected = () => collab.isConnected()
  const agentLabel = () => collab.lastSuggestion()?.agent ?? null
  const modelLabel = () => {
    const m = collab.lastSuggestion()?.model
    if (!m) return null
    return m.includes("/") ? m.split("/").slice(1).join("/") : m
  }
  const variantLabel = () => collab.lastSuggestion()?.variant ?? null
  const identity = () => [agentLabel(), modelLabel(), variantLabel()].filter(Boolean).join(" · ")

  const canOpenPr = () => props.myRole === "driver" && (collab.session()?.repos?.length ?? 0) > 0

  const [prResults, setPrResults] = createSignal<RepoPrResult[]>([])
  const [prError, setPrError] = createSignal<string | null>(null)

  const openedPrs = () => prResults().filter((r): r is RepoPrResult & { status: "opened"; url: string } => r.status === "opened")
  const troubledPrs = () => prResults().filter((r) => r.status !== "opened")

  return (
    <>
      <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-weak-base bg-surface-base px-4">
        <span
          classList={{
            "size-1.5 shrink-0 rounded-full": true,
            "bg-surface-success-strong": connected(),
            "bg-surface-warning-strong animate-pulse motion-reduce:animate-none": !connected(),
          }}
          aria-hidden="true"
        />
        <span class="shrink-0 text-12-medium text-text-strong">{connected() ? "Connected" : "Reconnecting"}</span>

        <Show when={identity()}>
          {(text) => (
            <span class={`${CHIP} min-w-0 max-w-[40%]`} title={collab.lastSuggestion()?.model ?? undefined}>
              <span class="truncate">{text()}</span>
            </span>
          )}
        </Show>

        <div class="ml-auto flex shrink-0 items-center gap-2">
          <For each={openedPrs().slice(0, 2)}>
            {(r) => (
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                title={r.url}
                class="inline-flex min-h-6 items-center rounded px-1 font-mono text-[10.5px] text-text-on-success-base outline-none transition-colors duration-150 ease-out hover:underline focus-visible:ring-2 focus-visible:ring-collab-accent-line motion-reduce:transition-none"
              >
                {r.repo.split("/")[1] ?? r.repo} PR
              </a>
            )}
          </For>
          <Show when={openedPrs().length > 2}>
            <span class="font-mono text-[10.5px] text-text-weak">+{openedPrs().length - 2}</span>
          </Show>

          <Show when={canOpenPr()}>
            <OpenPrButton onResults={setPrResults} onError={setPrError} />
          </Show>

          <PreviewPrimaryAction ctl={preview} />
        </div>
      </div>

      <Show when={prError()}>
        {(message) => (
          <div class="flex min-h-8 shrink-0 items-center gap-2 border-b border-border-critical-base bg-surface-critical-weak px-4 py-1">
            <span class="min-w-0 flex-1 whitespace-pre-wrap text-12-regular text-text-on-critical-base">{message()}</span>
          </div>
        )}
      </Show>

      <Show when={troubledPrs().length > 0}>
        <div class="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-weak-base bg-surface-base px-4 py-1">
          <For each={troubledPrs()}>
            {(r) => (
              <span
                classList={{
                  "font-mono text-[10.5px]": true,
                  "text-text-base": r.status === "skipped",
                  "text-text-on-critical-base": r.status === "error",
                }}
                title={r.status === "error" ? r.error : r.status === "skipped" ? r.reason : undefined}
              >
                {r.repo.split("/")[1] ?? r.repo}: {r.status === "skipped" ? "no changes" : "failed"}
              </span>
            )}
          </For>
        </div>
      </Show>

      <PreviewLifecycleRow ctl={preview} />
    </>
  )
}

/**
 * Driver-only. Calls POST /collab/session/:id/pr, which git-pushes the collab
 * branch and opens one pull request per linked repo.
 *
 * The button locks itself out for the rest of the page lifetime when the branch
 * has no commits: the server wraps that case in a friendly 400 and this reads
 * the exact wording, so the Driver cannot re-click into the same message a
 * dozen times. Server and client both guard it — the server stops bad PRs from
 * being created, the client stops the pointless retry loop.
 */
function OpenPrButton(props: { onResults: (results: RepoPrResult[]) => void; onError: (message: string | null) => void }) {
  const collab = useCollab()
  const [busy, setBusy] = createSignal(false)
  const [locked, setLocked] = createSignal(false)

  /** Both the wrapped 400 ("No commits to open a PR with yet.") and the raw
   *  GitHub 422 ("No commits between …") land here, in case anything bypasses
   *  the server-side wrap (older deployments, partial rollouts). */
  function looksLikeEmptyBranch(message: string): boolean {
    return /no commits (to open|between)/i.test(message)
  }

  async function openPr() {
    setBusy(true)
    props.onError(null)
    try {
      const { results } = await collab.openPullRequest()
      props.onResults(results)
      // Lock only when there were repos and every one had no commits — nothing
      // to PR until the LLM commits.  A mix of opened/errored stays clickable.
      if (results.length > 0 && results.every((r) => r.status === "skipped")) setLocked(true)
      // Auto-open just the first opened PR (not one tab per repo).
      const first = results.find((r) => r.status === "opened")
      if (first && first.status === "opened") window.open(first.url, "_blank", "noreferrer")
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      props.onError(message)
      if (looksLikeEmptyBranch(message)) setLocked(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={openPr}
      disabled={busy() || locked()}
      title={locked() ? "No commits on the collab branch yet. Ask the agent to make a commit first." : "Push the collab branch and open a pull request"}
      class={`${BTN_GHOST} h-7 px-2.5`}
    >
      <Show when={!busy()} fallback={<Spinner class="size-3.5" />}>
        <svg class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path stroke-linecap="round" d="M6 8v8M18 8v8" />
        </svg>
      </Show>
      {busy() ? "Opening PR…" : "Open pull request"}
    </button>
  )
}
