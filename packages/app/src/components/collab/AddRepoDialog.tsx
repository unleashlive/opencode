import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import { CollabDialog } from "./CollabDialog"
import { BTN_PRIMARY, CHIP_SELECT, CHIP_SELECT_OFF, CHIP_SELECT_ON } from "./ui"

interface OrgRepo {
  full_name: string
  name: string
  description?: string | null
  private?: boolean
}

/**
 * Mid-session "Add repositories" dialog (Drivers only).  Lists the org's repos
 * as chip toggles (same picker idiom as the landing page), excludes the ones
 * already linked to this session, and appends the picks via
 * `collab.addRepos` — which clones them onto the session branch, announces them
 * to the LLM, and folds them into the next "Open PR".
 *
 * The repo list is fetched in `onMount` with a plain signal (NOT createResource)
 * so it can never suspend the page-level <Suspense> boundary — an earlier
 * createResource-based picker made the whole session (iframe included) drop to
 * the app loading screen while /collab/repos was in flight.
 *
 * Shell is the host dialog (./CollabDialog.tsx); the caller still hides the
 * editor iframe with visibility:hidden while this is open, since iframes paint
 * in their own composited layer and ignore z-index.
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
    <CollabDialog
      title="Add repositories"
      description="Each pick is cloned onto the collab branch and gets its own pull request when you open PRs."
      onClose={props.onClose}
      fit
    >
      <div class="flex min-h-0 flex-col gap-3 px-5 pb-5">
        <Show when={!loading()} fallback={<p class="py-6 text-center text-12-regular text-text-weak">Loading repositories…</p>}>
          <Show
            when={!loadError()}
            fallback={<p class="py-4 text-12-regular text-text-on-critical-base">{loadError()}</p>}
          >
            <Show
              when={available().length > 0}
              fallback={<p class="py-6 text-center text-12-regular text-text-weak">No more repositories to add.</p>}
            >
              <div class="flex max-h-64 min-h-0 flex-wrap content-start items-start gap-1.5 overflow-y-auto overscroll-contain">
                <For each={available()}>
                  {(repo) => {
                    const on = () => selected().includes(repo.full_name)
                    return (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on()}
                        title={repo.description ?? repo.full_name}
                        onClick={() => toggle(repo.full_name)}
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
                        <span class="truncate">{repo.full_name}</span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </Show>

        <Show when={err()}>
          <p class="text-12-regular text-text-on-critical-base">{err()}</p>
        </Show>
        <Show when={warnings().length > 0}>
          <div class="flex flex-col gap-1">
            <For each={warnings()}>
              {(w) => (
                <p class="rounded-md border border-border-warning-base bg-surface-warning-weak px-2 py-1 text-[11px] text-text-on-warning-base">
                  {w.message}
                </p>
              )}
            </For>
          </div>
        </Show>

        <div class="flex justify-end">
          <button
            type="button"
            class={`${BTN_PRIMARY} h-8 px-3`}
            disabled={selected().length === 0 || adding()}
            onClick={submit}
          >
            {adding() ? "Adding…" : `Add ${selected().length} repo${selected().length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </CollabDialog>
  )
}
