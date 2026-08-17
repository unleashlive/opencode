/**
 * Light / dark toggle for the Collab top bars (ENG-1).
 *
 * Drives the host theme provider (packages/ui/src/theme/context.tsx), which
 * app.tsx mounts above the router, so this works on every /collab route.
 * setColorScheme writes the choice to localStorage and re-runs applyThemeCss,
 * which is what flips html[data-color-scheme] and therefore the collab accent.
 *
 * The toggle always sets an explicit scheme rather than cycling back through
 * "system": it reads the effective mode and picks the opposite, so one click
 * always does the visible thing.
 *
 * Not mounted anywhere yet; S3 and S4 place it in the session and landing
 * top bars.
 *
 * The host icon registry (packages/ui/src/components/icon.tsx) has no moon or
 * sun glyph, so the half-moon below is inline, drawn on the same 20x20 grid
 * and with the same currentColor stroke as the registry icons.
 */

import { useTheme } from "@opencode-ai/ui/theme/context"
import { BTN_ICON } from "./ui"

export function ThemeToggle(props: { class?: string }) {
  const theme = useTheme()
  const isDark = () => theme.mode() === "dark"

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      aria-pressed={isDark()}
      title={isDark() ? "Switch to light theme" : "Switch to dark theme"}
      class={`${BTN_ICON} ${props.class ?? ""}`}
      onClick={() => theme.setColorScheme(isDark() ? "light" : "dark")}
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="size-4">
        <path
          d="M16.25 12.32A6.67 6.67 0 0 1 7.68 3.75a6.67 6.67 0 1 0 8.57 8.57Z"
          stroke="currentColor"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  )
}
