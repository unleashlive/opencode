/**
 * Dialog shell for the Collab surfaces (SKU-1).
 *
 * Composes the host dialog primitives — the Kobalte root, its portal and
 * overlay, and <Dialog> from packages/ui/src/components/dialog.tsx — so every
 * collab modal gets the same behaviour as the rest of opencode: focus trap,
 * Escape to close, focus returned to whatever opened it, and the shared
 * overlay + panel chrome from packages/ui/src/components/dialog.css.  It
 * replaces five hand-rolled backdrops that each carried their own
 * `z-index:99999` inline style.
 *
 * Why this thin wrapper rather than `useDialog().show(...)`:
 * the collab pages hold the open state themselves (`<Show when={showInvite()}>`)
 * and the session page reads those same signals to hide the editor iframe while
 * a dialog is up — an iframe paints in its own composited layer and will cover
 * an overlay whatever z-index it carries.  The imperative dialog store owns the
 * open state internally, so it cannot drive that.  The markup below is exactly
 * what DialogProvider renders, with `open` left in the caller's hands.
 *
 * Sizing follows the host: `fit` for content-height panels, `size` for the
 * fixed 640 / 800 / 960px widths.  The body is a flex column with
 * `overflow: hidden`, so scrolling content needs its own scroll container.
 */

import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import type { JSXElement, ParentProps } from "solid-js"
import { Show } from "solid-js"
import { BTN_GHOST, BTN_PRIMARY } from "./ui"

export function CollabDialog(
  props: ParentProps<{
    title: JSXElement
    description?: JSXElement
    /** Host widths: normal 640px, large 800px, x-large 960px. */
    size?: "normal" | "large" | "x-large"
    /** Height hugs the content instead of the fixed 512px panel. */
    fit?: boolean
    onClose: () => void
  }>,
) {
  return (
    <Kobalte
      modal
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <Kobalte.Portal>
        <Kobalte.Overlay data-component="dialog-overlay" />
        <Dialog title={props.title} description={props.description} size={props.size} fit={props.fit}>
          {props.children}
        </Dialog>
      </Kobalte.Portal>
    </Kobalte>
  )
}

/**
 * Confirm / acknowledge dialog on the same shell, replacing the browser
 * `confirm()` and `alert()` calls in the collab surfaces (which are unstyled,
 * unthemed, and inside the embedded editor get attributed to the wrong frame).
 *
 * Omit `onConfirm` for an acknowledgement: the dialog then shows a single
 * dismiss button instead of a confirm / cancel pair.
 */
export function ConfirmDialog(props: {
  title: JSXElement
  body?: JSXElement
  confirmLabel?: string
  cancelLabel?: string
  /** Label for the single dismiss button when `onConfirm` is omitted. */
  dismissLabel?: string
  /** Confirm button reads as a destructive action. */
  destructive?: boolean
  onConfirm?: () => void
  onClose: () => void
}) {
  return (
    <CollabDialog title={props.title} onClose={props.onClose} fit>
      <div class="flex flex-col gap-4 px-5 pb-5">
        <Show when={props.body}>{(body) => <div class="text-12-regular text-text-base">{body()}</div>}</Show>
        <div class="flex justify-end gap-2">
          <Show when={props.onConfirm}>
            <button type="button" onClick={() => props.onClose()} class={`${BTN_GHOST} h-8 px-3`}>
              {props.cancelLabel ?? "Cancel"}
            </button>
          </Show>
          <Show
            when={props.onConfirm}
            fallback={
              <button type="button" autofocus onClick={() => props.onClose()} class={`${BTN_PRIMARY} h-8 px-3`}>
                {props.dismissLabel ?? "Close"}
              </button>
            }
          >
            {(confirm) => (
              <button
                type="button"
                autofocus
                onClick={() => {
                  confirm()()
                  props.onClose()
                }}
                classList={{
                  [`${BTN_PRIMARY} h-8 px-3`]: !props.destructive,
                  [`${BTN_GHOST} h-8 border-border-critical-base px-3 text-text-on-critical-base hover:text-text-on-critical-strong`]:
                    !!props.destructive,
                }}
              >
                {props.confirmLabel ?? "Confirm"}
              </button>
            )}
          </Show>
        </div>
      </div>
    </CollabDialog>
  )
}
