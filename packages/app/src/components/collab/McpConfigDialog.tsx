import { createSignal, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import { CollabDialog } from "./CollabDialog"
import { BTN_GHOST, BTN_PRIMARY, FIELD, LABEL_MICRO, TEXT_ACTION } from "./ui"

/**
 * MCP management panel for collab sessions.
 *
 * Shows three rows — headroom (always on), playwright (toggleable),
 * and unleash-live (token-based).  Drivers and Contributors can configure
 * all three; Viewers cannot open this dialog.
 */
export function McpConfigDialog(props: { onClose: () => void }) {
  const collab = useCollab()

  // ── GitHub Packages (server-wide npm token) ───────────────────────────────
  const [npmToken, setNpmToken] = createSignal("")
  const [npmBusy, setNpmBusy] = createSignal(false)
  const [npmErr, setNpmErr] = createSignal<string | null>(null)
  const [npmDone, setNpmDone] = createSignal(false)

  const npmConfigured = () => collab.serverNpmTokenConfigured()

  async function saveNpmToken() {
    const t = npmToken().trim()
    if (!t) return
    setNpmErr(null)
    setNpmBusy(true)
    try {
      await collab.setServerNpmToken(t)
      setNpmDone(true)
      setNpmToken("")
      setTimeout(() => setNpmDone(false), 2000)
    } catch (e) {
      setNpmErr(e instanceof Error ? e.message : String(e))
    } finally {
      setNpmBusy(false)
    }
  }

  async function removeNpmToken() {
    setNpmErr(null)
    setNpmBusy(true)
    try {
      await collab.setServerNpmToken(null)
    } catch (e) {
      setNpmErr(e instanceof Error ? e.message : String(e))
    } finally {
      setNpmBusy(false)
    }
  }

  // ── Unleash Live ──────────────────────────────────────────────────────────
  const [token, setToken] = createSignal("")
  const [ulBusy, setUlBusy] = createSignal(false)
  const [ulErr, setUlErr] = createSignal<string | null>(null)
  const [ulDone, setUlDone] = createSignal(false)

  const isConfigured = () => collab.mcpConfigured()

  async function saveToken() {
    const t = token().trim()
    if (!t) return
    setUlErr(null)
    setUlBusy(true)
    try {
      await collab.configureMcp(t)
      setUlDone(true)
      setTimeout(() => setUlDone(false), 2000)
    } catch (e) {
      setUlErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUlBusy(false)
    }
  }

  async function removeToken() {
    setUlErr(null)
    setUlBusy(true)
    try {
      await collab.configureMcp(null)
    } catch (e) {
      setUlErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUlBusy(false)
    }
  }

  // ── Playwright ────────────────────────────────────────────────────────────
  const [pwBusy, setPwBusy] = createSignal(false)
  const [pwErr, setPwErr] = createSignal<string | null>(null)
  const playwrightEnabled = () => collab.mcpPlaywrightEnabled()

  async function togglePlaywright() {
    setPwErr(null)
    setPwBusy(true)
    try {
      await collab.togglePlaywright(!playwrightEnabled())
    } catch (e) {
      setPwErr(e instanceof Error ? e.message : String(e))
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <CollabDialog
      title="MCP Connectors"
      description="Manage the Model Context Protocol servers available to this session."
      onClose={props.onClose}
      fit
    >
      <div class="flex flex-col divide-y divide-border-weak-base px-5 pb-5">

        {/* ── Headroom (always on) ─────────────────────────────────────────── */}
        <div class="flex items-start gap-3 py-4">
          <span class="mt-0.5 size-2 shrink-0 rounded-full bg-surface-success-strong" aria-label="Active" />
          <div class="flex min-w-0 flex-col gap-0.5">
            <p class="text-12-medium text-text-strong">Headroom</p>
            <p class="text-[11px] text-text-weak">
              Token compression — always active. Compresses large tool outputs to reduce context usage.
            </p>
          </div>
          <span class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-success-weak text-text-on-success-base">
            Always on
          </span>
        </div>

        {/* ── Playwright (toggle) ──────────────────────────────────────────── */}
        <div class="flex items-start gap-3 py-4">
          <span
            class={`mt-0.5 size-2 shrink-0 rounded-full transition-colors ${playwrightEnabled() ? "bg-surface-success-strong" : "bg-surface-inset-base"}`}
            aria-label={playwrightEnabled() ? "Active" : "Inactive"}
          />
          <div class="flex min-w-0 flex-col gap-0.5">
            <p class="text-12-medium text-text-strong">Playwright</p>
            <p class="text-[11px] text-text-weak">
              Headless Chromium browser automation. Use to verify the live preview, inspect pages, or reproduce UI bugs.
            </p>
            <Show when={pwErr()}>
              <p class="mt-1 text-[11px] text-text-on-critical-base">{pwErr()}</p>
            </Show>
          </div>
          <button
            type="button"
            disabled={pwBusy()}
            onClick={() => void togglePlaywright()}
            class={[
              "ml-auto h-7 shrink-0 rounded px-2.5 text-[11px] font-medium transition-colors",
              playwrightEnabled()
                ? "bg-surface-inset-base text-text-base hover:bg-surface-inset-hover"
                : "bg-collab-accent-weak text-collab-accent-base hover:bg-collab-accent-weak/80",
            ].join(" ")}
          >
            {pwBusy() ? "…" : playwrightEnabled() ? "Disable" : "Enable"}
          </button>
        </div>

        {/* ── GitHub Packages (server-wide npm token) ─────────────────────── */}
        <div class="flex flex-col gap-3 py-4">
          <div class="flex items-start gap-3">
            <span
              class={`mt-0.5 size-2 shrink-0 rounded-full ${npmConfigured() ? "bg-surface-success-strong" : "bg-surface-inset-base"}`}
              aria-label={npmConfigured() ? "Active" : "Inactive"}
            />
            <div class="flex min-w-0 flex-col gap-0.5">
              <p class="text-12-medium text-text-strong">GitHub Packages</p>
              <p class="text-[11px] text-text-weak">
                Server-wide classic PAT for <code class="font-mono">npm.pkg.github.com</code>. Used by all sessions and the preview server to install <code class="font-mono">@unleashlive</code> packages. Must be SSO-authorized for the org.
              </p>
            </div>
            <Show when={npmConfigured()}>
              <span class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-success-weak text-text-on-success-base">
                Active
              </span>
            </Show>
          </div>

          <div class="flex flex-col gap-1.5 pl-5">
            <label class={LABEL_MICRO} for="npm-token">
              Classic PAT
            </label>
            <input
              id="npm-token"
              type="password"
              autocomplete="off"
              placeholder="ghp_..."
              class={`${FIELD} font-mono`}
              value={npmToken()}
              onInput={(e) => setNpmToken(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveNpmToken()}
            />
            <p class="text-[11px] text-text-base">
              Needs <code class="font-mono">read:packages</code> scope and SSO authorization for the <code class="font-mono">unleashlive</code> org.
            </p>
          </div>

          <Show when={npmErr()}>
            <p class="ml-5 rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2 text-12-regular text-text-on-critical-base">
              {npmErr()}
            </p>
          </Show>

          <Show when={npmDone()}>
            <p class="ml-5 text-12-regular text-text-on-success-base">Saved — GitHub Packages auth active.</p>
          </Show>

          <div class="flex items-center gap-2 pl-5">
            <Show when={npmConfigured()}>
              <button
                type="button"
                disabled={npmBusy()}
                onClick={() => void removeNpmToken()}
                class={`${TEXT_ACTION} text-text-on-critical-base hover:text-text-on-critical-strong`}
              >
                Remove token
              </button>
            </Show>
            <div class="ml-auto flex gap-2">
              <button
                type="button"
                disabled={npmBusy() || !npmToken().trim()}
                onClick={() => void saveNpmToken()}
                class={`${BTN_PRIMARY} h-8 px-3`}
              >
                {npmBusy() ? "Saving…" : "Save token"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Unleash Live (token) ─────────────────────────────────────────── */}
        <div class="flex flex-col gap-3 py-4">
          <div class="flex items-start gap-3">
            <span
              class={`mt-0.5 size-2 shrink-0 rounded-full ${isConfigured() ? "bg-surface-success-strong" : "bg-surface-inset-base"}`}
              aria-label={isConfigured() ? "Active" : "Inactive"}
            />
            <div class="flex min-w-0 flex-col gap-0.5">
              <p class="text-12-medium text-text-strong">Unleash Live</p>
              <p class="text-[11px] text-text-weak">
                Connect to the Unleash Live Cirrus platform. Token is encrypted on this server and never leaves it.
              </p>
            </div>
            <Show when={isConfigured()}>
              <span class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-success-weak text-text-on-success-base">
                Active
              </span>
            </Show>
          </div>

          <div class="flex flex-col gap-1.5 pl-5">
            <label class={LABEL_MICRO} for="mcp-token">
              Access token
            </label>
            <input
              id="mcp-token"
              type="password"
              autocomplete="off"
              placeholder="ul_pat_..."
              class={`${FIELD} font-mono`}
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveToken()}
            />
            <p class="text-[11px] text-text-base">
              Starts with <code class="font-mono">ul_pat_</code>. Stage is fixed to <code class="font-mono">cirrus</code>.
            </p>
          </div>

          <Show when={ulErr()}>
            <p class="ml-5 rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2 text-12-regular text-text-on-critical-base">
              {ulErr()}
            </p>
          </Show>

          <Show when={ulDone()}>
            <p class="ml-5 text-12-regular text-text-on-success-base">Saved — Unleash Live MCP enabled.</p>
          </Show>

          <div class="flex items-center gap-2 pl-5">
            <Show when={isConfigured()}>
              <button
                type="button"
                disabled={ulBusy()}
                onClick={() => void removeToken()}
                class={`${TEXT_ACTION} text-text-on-critical-base hover:text-text-on-critical-strong`}
              >
                Remove token
              </button>
            </Show>
            <div class="ml-auto flex gap-2">
              <button type="button" onClick={props.onClose} class={`${BTN_GHOST} h-8 px-3`}>
                Close
              </button>
              <button
                type="button"
                disabled={ulBusy() || !token().trim()}
                onClick={() => void saveToken()}
                class={`${BTN_PRIMARY} h-8 px-3`}
              >
                {ulBusy() ? "Saving…" : "Save token"}
              </button>
            </div>
          </div>
        </div>

      </div>
    </CollabDialog>
  )
}
