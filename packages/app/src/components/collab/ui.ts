/**
 * Shared visual language for the Collab UI (ENG-1).
 *
 * Contract: host semantic tokens plus the collab accent, nothing else.
 *   - No stock Tailwind palette classes (zinc / indigo / emerald / blue / …).
 *   - No raw hex, no rgba, no gradients, no coloured shadows, no hover lift.
 *   - Surfaces, text, borders and success / warning / critical intents come
 *     from packages/ui/src/styles/theme.css via the Tailwind bridge in
 *     packages/ui/src/styles/tailwind/colors.css.
 *   - The only colour Collab owns is --collab-accent-*, declared in
 *     ./collab.css and bridged to utilities in packages/app/src/index.css.
 *
 * Every interactive recipe carries a focus-visible ring (never a bare
 * outline-none) and a motion-reduce guard.
 *
 * Sizing (width / padding) is deliberately left to the call site so one
 * recipe serves both a rail button and a full width CTA:
 *   class={`${BTN_GHOST} w-full px-3 py-1.5`}
 */

/** Structure, type and focus behaviour shared by every button recipe. */
export const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md border select-none whitespace-nowrap " +
  "text-12-medium transition-colors duration-150 ease-out motion-reduce:transition-none " +
  "outline-none focus-visible:ring-2 focus-visible:ring-collab-accent-line " +
  "disabled:cursor-not-allowed"

/**
 * The one primary action per view: the host's own quiet solid button.
 * --button-primary-base is near-black in light and near-white in dark, with
 * --icon-invert-base as its ink, so this inverts correctly with the theme.
 */
export const BTN_PRIMARY =
  BTN_BASE +
  " bg-(--button-primary-base) text-icon-invert-base border-border-weak-base" +
  " hover:bg-icon-strong-hover active:bg-icon-strong-active" +
  " disabled:bg-icon-strong-disabled"

/** Ghost structure without a text colour, so variants can set their own ink. */
const GHOST_SHELL =
  BTN_BASE + " bg-transparent border-border-base hover:bg-surface-base-hover active:bg-surface-base-active"

/** Default non-primary action: transparent, hairline border, quiet hover. */
export const BTN_GHOST = GHOST_SHELL + " text-text-base hover:text-text-strong disabled:text-text-weak"

/** Kept as an alias so existing call sites keep working; ghost is the shape. */
export const BTN_SECONDARY = BTN_GHOST

/**
 * Positive action (open PR, launch preview). Still a ghost button: the intent
 * is carried by the success text token, not by a green fill.
 */
export const BTN_SUCCESS = GHOST_SHELL + " text-text-on-success-base disabled:text-text-weak"

/** 28px square ghost icon button (top bar, rail headers, composer actions). */
export const BTN_ICON =
  BTN_BASE +
  " size-7 shrink-0 gap-0 p-0 border-transparent bg-transparent text-icon-base" +
  " hover:bg-surface-base-hover hover:text-icon-strong-base active:bg-surface-base-active" +
  " disabled:text-icon-disabled"

/** The "Collab" badge. The only place the accent is used as a fill. */
export const PILL_BRAND =
  "inline-flex items-center gap-1 rounded-md border border-collab-accent-line px-1.5 py-0.5 " +
  "bg-collab-accent-soft text-collab-accent " +
  "text-[9.5px] font-[600] uppercase leading-none tracking-[0.08em]"

/** Selected / active row accent (current session in the embed sidebar). */
export const ROW_ACTIVE = "bg-collab-accent-soft border-l-2 border-l-collab-accent"

/** Mono meta chip: repo, branch, mode, counts. Machine truth, quietly. */
export const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-border-weak-base px-1.5 py-0.5 " +
  "font-mono text-[10.5px] leading-none text-text-weak"

/** Rail section label: 11px, uppercase, tracked out. */
export const LABEL_MICRO = "text-[11px] font-[600] uppercase leading-none tracking-[0.06em] text-text-weak"
