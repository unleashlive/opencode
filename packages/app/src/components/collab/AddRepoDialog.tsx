import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import { BTN_PRIMARY } from "./ui"

interface OrgRepo {
  full_name: string
  name: string
  description?: string | null
  private?: boolean
}

/**
 * Mid-session "Add repositories" dialog (Drivers only).  Lists the org's repos
 * with checkboxes, excludes the ones already linked, and appends the picks via
 * `collab.addRepos` — which clones them onto the session branch, announces them
 * to the LLM, and folds them into the next "Open PR".
 *
 * The repo list is fetched in `onMount` with a plain signal (NOT createResource)
 * so it can never suspend the page-level <Suspense> boundary — an earlier
 * createResource-based picker made the whole session (iframe included) drop to
 * the app loading screen while /collab/repos was in flight.
 *
 * Overlay chrome mirrors InviteDialog (the iframe is hidden by the caller via
 * visibility:hidden while this is open, since iframes ignore z-index).
 */
export function AddRepoDialog(props: { onClose: () => void }) {
  const collab = useCollab()
  const [repos, setRepos] = createSignal<OrgRepo[]>([])
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [selected, setSelected] = createSignal<string[]>([])
  const [adding, setAdding] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)
  const [warnings, setWarnings] = createSignal<Array<{ repo: string; message: string }>>([])

  onMount(async () => {
    try {
      const res = await fetch("/collab/repos")
      if (!res.ok) throw new Error(`Couldn't load repositories (${res.status})`)
      setRepos((await res.json()) as OrgRepo[])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  })

  // Hide repos already linked to this session — they can't be added again.
  const available = createMemo(() => {
    const linked = new Set(collab.session()?.repos ?? [])
    return repos().filter((r) => !linked.has(r.full_name))
  })

  function toggle(fullName: string) {
    setSelected((prev) => (prev.includes(fullName) ? prev.filter((r) => r !== fullName) : [...prev, fullName]))
  }

  async function submit() {
    if (selected().length === 0) return
    setErr(null)
    setWarnings([])
    setAdding(true)
    try {
      const result = await collab.addRepos(selected())
      // Keep the dialog open if the server flagged branch-collision warnings so
      // the Driver sees them; otherwise close.
      if (result.warnings?.length) {
        setWarnings(result.warnings)
        setSelected([])
      } else {
        props.onClose()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div
      class="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style="z-index:99999"
      onClick={props.onClose}
    >
      <div
        class="border border-border-weak-base rounded-xl p-6 w-full max-w-lg shadow-2xl bg-background-base flex flex-col max-h-[80vh]"
        style="position:relative;z-index:100000"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 class="text-base font-semibold text-text-strong mb-1">Add repositories</h2>
        <p class="text-xs text-text-weak mb-4">
          Pick repositories to add to this session. Each is cloned onto the collab branch and gets its own
          pull request when you open PRs.
        </p>

        <Show
          when={!loading()}
          fallback={<div class="text-sm text-text-weak text-center py-8">Loading repositories…</div>}
        >
          <Show when={!loadError()} fallback={<div class="text-sm text-red-400 py-4">{loadError()}</div>}>
            <Show
              when={available().length > 0}
              fallback={<div class="text-sm text-text-weak text-center py-8">No more repositories to add.</div>}
            >
              <div class="flex-1 overflow-y-auto rounded-lg border border-border-weak-base divide-y divide-border-weak-base bg-background-stronger min-h-0">
                <For each={available()}>
                  {(repo) => (
                    <label class="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-background-strong">
                      <input
                        type="checkbox"
                        class="mt-1"
                        checked={selected().includes(repo.full_name)}
                        onChange={() => toggle(repo.full_name)}
                      />
                      <span class="flex-1 min-w-0">
                        <span class="text-sm text-text-strong truncate block">{repo.full_name}</span>
                        <Show when={repo.description}>
                          <span class="text-xs text-text-weak line-clamp-1">{repo.description}</span>
                        </Show>
                      </span>
                    </label>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>

        <Show when={err()}>
          <div class="text-xs text-red-400 mt-3">{err()}</div>
        </Show>
        <Show when={warnings().length > 0}>
          <div class="mt-3 space-y-1">
            <For each={warnings()}>
              {(w) => (
                <div class="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-1">
                  {w.message}
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={props.onClose}
            class="px-3 py-1.5 text-sm rounded-md text-text-weak hover:text-text-strong"
          >
            Close
          </button>
          <button
            type="button"
            class={`${BTN_PRIMARY} px-4 py-1.5 text-sm disabled:opacity-50`}
            disabled={selected().length === 0 || adding()}
            onClick={submit}
          >
            {adding() ? "Adding…" : `Add ${selected().length} repo${selected().length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  )
}
