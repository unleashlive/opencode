import { createEffect, on, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { isCollabEmbed } from "@/utils/collab-embed"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  // Collab embed: when the iframe's active native session changes — e.g. via
  // opencode's lower-right "go to session" cross-session popup, or the
  // titlebar's own tab strip (TitlebarTabStrip, mounted by <Titlebar> below,
  // is a real @solidjs/router navigation inside THIS iframe's own document) —
  // tell the parent collab page so it can swap to the matching collab
  // session and refresh Timeline / Team chat / Participants.
  //
  // This mirrors the identical bridge in pages/layout.tsx (LegacyLayout).
  // Without it, switching native-session tabs inside the embedded iframe
  // while newLayoutDesigns is on (the default, which routes here) is
  // invisible to the parent /collab/:id page — the outer CollabProvider
  // never remounts because its own params.id never changes; only this
  // iframe's params.id does. `params.id` here is the native session id;
  // `defer` skips the initial mount (the parent is already on the right
  // session then) and prevents an echo loop after the parent navigates.
  const params = useParams<{ id: string }>()
  if (isCollabEmbed()) {
    createEffect(
      on(
        () => params.id,
        (sessionId) => {
          if (!sessionId) return
          try {
            window.parent.postMessage({ type: "opencode:collab-session-changed", sessionId }, window.location.origin)
          } catch {
            /* same-origin postMessage shouldn't throw; ignore if it does */
          }
        },
        { defer: true },
      ),
    )
  }

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <Suspense>{props.children}</Suspense>
      </main>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
