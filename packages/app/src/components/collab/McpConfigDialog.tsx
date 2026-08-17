import { createSignal, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import { CollabDialog } from "./CollabDialog"
import { BTN_GHOST, BTN_PRIMARY, FIELD, LABEL_MICRO, TEXT_ACTION } from "./ui"

/**
 * Dialog for the Driver to configure the Unleash Live Cirrus MCP server.
 * Saves an encrypted access token in the DB and writes a per-session
 * .opencode/opencode.json that enables the MCP for the native session.
 *
 * Shell is the host dialog (./CollabDialog.tsx).
 */
export function McpConfigDialog(props: { onClose: () => void }) {
  const collab = useCollab()
  const [token, setToken] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [err, setErr] = createSignal<string | null>(null)
  const [done, setDone] = createSignal(false)

  const isConfigured = () => collab.mcpConfigured()

  async function save() {
    const t = token().trim()
    if (!t) return
    setErr(null)
    setBusy(true)
    try {
      await collab.configureMcp(t)
      setDone(true)
      setTimeout(props.onClose, 1000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setErr(null)
    setBusy(true)
    try {
      await collab.configureMcp(null)
      props.onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CollabDialog
      title="Unleash Live MCP"
      description="Connect this session to the Unleash Live Cirrus platform. The token is encrypted on this server and never leaves it."
      onClose={props.onClose}
      fit
    >
      <div class="flex flex-col gap-4 px-5 pb-5">
        <Show when={isConfigured()}>
          <p class="flex items-center gap-2 rounded-md border border-border-success-base bg-surface-success-weak px-3 py-2 text-12-regular text-text-on-success-base">
            <span aria-hidden="true">✓</span>
            MCP is active for this session.
          </p>
        </Show>

        <div class="flex flex-col gap-1.5">
          <label class={LABEL_MICRO} for="mcp-token">
            Access token
          </label>
          <input
            id="mcp-token"
            type="password"
            autocomplete="off"
            autofocus
            placeholder="ul_pat_..."
            class={`${FIELD} font-mono`}
            value={token()}
            onInput={(e) => setToken(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <p class="text-[11px] text-text-weak">
            Starts with <code class="font-mono">ul_pat_</code>. Stage is fixed to <code class="font-mono">cirrus</code>.
          </p>
        </div>

        <Show when={err()}>
          <p class="rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2 text-12-regular text-text-on-critical-base">
            {err()}
          </p>
        </Show>

        <Show when={done()}>
          <p class="text-center text-12-regular text-text-on-success-base">Saved, MCP enabled.</p>
        </Show>

        <div class="flex items-center gap-2">
          <Show when={isConfigured()}>
            <button
              type="button"
              disabled={busy()}
              onClick={remove}
              class={`${TEXT_ACTION} text-text-on-critical-base hover:text-text-on-critical-strong`}
            >
              Remove token
            </button>
          </Show>
          <div class="ml-auto flex gap-2">
            <button type="button" onClick={props.onClose} class={`${BTN_GHOST} h-8 px-3`}>
              Cancel
            </button>
            <button type="button" disabled={busy() || !token().trim()} onClick={save} class={`${BTN_PRIMARY} h-8 px-3`}>
              {busy() ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </CollabDialog>
  )
}
