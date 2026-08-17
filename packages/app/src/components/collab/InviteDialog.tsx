/**
 * Invite dialog for /collab/:id (SKU-1).
 *
 * Mints a role-scoped invite link (72h) and offers it for copying.  The shell
 * is the host dialog (see ./CollabDialog.tsx); only the body is collab's.
 */

import { createSignal, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import { CollabDialog } from "./CollabDialog"
import { BTN_GHOST, BTN_PRIMARY, FIELD, LABEL_MICRO } from "./ui"

export function InviteDialog(props: { onClose: () => void }) {
  const collab = useCollab()
  const [role, setRole] = createSignal<string>("contributor")
  const [inviteUrl, setInviteUrl] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)

  async function generate() {
    const result = await collab.createInvite(role())
    setInviteUrl(result.url)
  }

  async function copy() {
    const url = inviteUrl()
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <CollabDialog title="Invite to this session" onClose={props.onClose} fit>
      <div class="flex flex-col gap-4 px-5 pb-5">
        <div class="flex flex-col gap-1.5">
          <label class={LABEL_MICRO} for="collab-invite-role">
            Role
          </label>
          <select
            id="collab-invite-role"
            class={FIELD}
            value={role()}
            onChange={(e) => setRole(e.currentTarget.value)}
          >
            <option value="driver">Driver, can create and approve prompts</option>
            <option value="contributor">Contributor, can suggest prompts and vote</option>
            <option value="viewer">Viewer, read only access</option>
          </select>
        </div>

        <Show
          when={inviteUrl()}
          fallback={
            <button type="button" autofocus onClick={generate} class={`${BTN_PRIMARY} h-8 w-full px-3`}>
              Generate invite link
            </button>
          }
        >
          {(url) => (
            <div class="flex flex-col gap-2">
              <div class="rounded-md border border-border-weak-base bg-surface-inset-base px-3 py-2">
                <p class={LABEL_MICRO}>Invite link, expires in 72 hours</p>
                <p class="mt-1 break-all font-mono text-[10.5px] text-text-strong">{url()}</p>
              </div>
              <button type="button" onClick={copy} class={`${BTN_GHOST} h-8 w-full px-3`}>
                {copied() ? "Copied" : "Copy link"}
              </button>
            </div>
          )}
        </Show>
      </div>
    </CollabDialog>
  )
}
