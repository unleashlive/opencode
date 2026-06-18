import { createSignal, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import { BTN_PRIMARY } from "./ui"

/**
 * Dialog for the Driver to configure the Unleash Live Cirrus MCP server.
 * Saves an encrypted access token in the DB and writes a per-session
 * .opencode/opencode.json that enables the MCP for the native session.
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
    <div
      class="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style="z-index:99999"
      onClick={props.onClose}
    >
      <div
        class="border border-border-weak-base rounded-xl p-6 w-full max-w-md shadow-2xl bg-background-base flex flex-col gap-4"
        style="position:relative;z-index:100000"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 class="text-base font-semibold text-text-strong">Unleash Live MCP</h2>
          <p class="text-xs text-text-weak mt-1">
            Connect this collab session to the Unleash Live Cirrus platform. Enter your personal
            access token (starts with <code class="font-mono">ul_pat_</code>). The token is
            encrypted and stored securely — it never leaves this server.
          </p>
        </div>

        <Show when={isConfigured()}>
          <div class="flex items-center gap-2 text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg px-3 py-2">
            <span>✓</span>
            <span>MCP is active for this session.</span>
          </div>
        </Show>

        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-text-weak" for="mcp-token">
            Access token
          </label>
          <input
            id="mcp-token"
            type="password"
            autocomplete="off"
            placeholder="ul_pat_..."
            class="w-full rounded-lg border border-border-weak-base bg-background-stronger text-sm text-text-strong px-3 py-2 font-mono placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={token()}
            onInput={(e) => setToken(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <p class="text-[11px] text-text-weak">Stage is fixed to <code class="font-mono">cirrus</code>.</p>
        </div>

        <Show when={err()}>
          <div class="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{err()}</div>
        </Show>

        <Show when={done()}>
          <div class="text-xs text-emerald-400 text-center">Saved — MCP enabled.</div>
        </Show>

        <div class="flex items-center justify-between gap-2 pt-1">
          <Show when={isConfigured()}>
            <button
              type="button"
              disabled={busy()}
              onClick={remove}
              class="px-3 py-1.5 text-xs rounded-md text-red-400 hover:text-red-300 hover:bg-red-400/10 disabled:opacity-50"
            >
              Remove token
            </button>
          </Show>
          <div class="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={props.onClose}
              class="px-3 py-1.5 text-sm rounded-md text-text-weak hover:text-text-strong"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy() || !token().trim()}
              onClick={save}
              class={`${BTN_PRIMARY} text-sm px-4 py-1.5 disabled:opacity-50`}
            >
              {busy() ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
