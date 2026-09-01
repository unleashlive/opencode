/**
 * Shared visual language for the Collab UI (ENG-1).
 *
 * Contract: host semantic tokens plus the collab accent, nothing else — with
 * one deliberate, scoped exception restored per product feedback: BTN_PRIMARY
 * and BTN_SUCCESS carry the pre-uplift blue→violet / emerald→green gradient
 * treatment (see .collab-btn-primary / .collab-btn-success in ./collab.css),
 * because the monochrome host button read as too quiet for the app's two
 * "hero" actions. Everything else keeps the ENG-1 rule:
 *   - No stock Tailwind palette classes (zinc / indigo / emerald / blue / …).
 *   - No raw hex, no rgba at the call site — colour lives in ./collab.css,
 *     one recolour point per mode.
 *   - Surfaces, text, borders and success / warning / critical intents come
 *     from packages/ui/src/styles/theme.css via the Tailwind bridge in
 *     packages/ui/src/styles/tailwind/colors.css.
 *   - The only colour Collab owns is --collab-accent-* / --collab-primary-* /
 *     --collab-success-*, declared in ./collab.css.
 *
 * "One primary action per view, everything else quiet" still holds — the
 * gradient treatment is intentionally limited to BTN_PRIMARY and BTN_SUCCESS,
 * not applied to every button, so it reads as emphasis rather than noise.
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
 * The one primary action per view. Blue→violet gradient with a soft glow and
 * hover lift — see .collab-btn-primary in ./collab.css for the fill, shadow
 * and motion (BTN_BASE still owns shape, focus ring and motion-reduce).
 */
export const BTN_PRIMARY = BTN_BASE + " collab-btn-primary font-[600]"

/** Ghost structure without a text colour, so variants can set their own ink. */
const GHOST_SHELL =
  BTN_BASE + " bg-transparent border-border-base hover:bg-surface-base-hover active:bg-surface-base-active"

/** Default non-primary action: transparent, hairline border, quiet hover. */
export const BTN_GHOST = GHOST_SHELL + " text-text-base hover:text-text-strong disabled:text-text-weak"

/** Kept as an alias so existing call sites keep working; ghost is the shape. */
export const BTN_SECONDARY = BTN_GHOST

/**
 * Positive / live action (Launch preview). Emerald→green gradient — restored
 * from the pre-uplift design, which reserved this family for exactly this
 * semantic ("approve / live preview"), distinct from BTN_PRIMARY's blue.
 * See .collab-btn-success in ./collab.css for the fill, shadow and motion.
 */
export const BTN_SUCCESS = BTN_BASE + " collab-btn-success font-[600]"

/** 28px square ghost icon button (top bar, rail headers, composer actions). */
export const BTN_ICON =
  BTN_BASE +
  " size-7 shrink-0 gap-0 p-0 border-transparent bg-transparent text-icon-base" +
  " hover:bg-surface-base-hover hover:text-icon-strong-base active:bg-surface-base-active" +
  " disabled:text-icon-disabled"

/**
 * Destructive icon button (delete a session from a list row).  Same 28px
 * square as BTN_ICON with critical ink on hover; kept as its own recipe rather
 * than BTN_ICON plus an override, so two `hover:text-*` utilities never race.
 */
export const BTN_ICON_CRITICAL =
  BTN_BASE +
  " size-7 shrink-0 gap-0 p-0 border-transparent bg-transparent text-icon-base" +
  " hover:bg-surface-critical-weak hover:text-text-on-critical-base active:bg-surface-base-active" +
  " disabled:text-icon-disabled"

/** Selected / active row accent (current session in the embed sidebar). */
export const ROW_ACTIVE = "bg-collab-accent-soft border-l-2 border-l-collab-accent"

/** Mono meta chip: repo, branch, mode, counts. Machine truth, quietly. */
export const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-border-weak-base px-1.5 py-0.5 " +
  "font-mono text-[10.5px] leading-none text-text-base"

/**
 * Role accent ink — restored from the pre-uplift roleColor() helper: driver
 * (amber, "holds the wheel") / contributor (blue, "proposing"). Viewer stays
 * unaccented on purpose (no special standing). Pair with CHIP for a role
 * pill, e.g. `class={`${CHIP} ${ROLE_TEXT_CLASS[role]}`}`, or apply directly
 * to a plain label.
 */
export const ROLE_TEXT_CLASS: Record<"driver" | "contributor" | "viewer", string> = {
  driver: "collab-role-driver font-[600]",
  contributor: "collab-role-contributor font-[600]",
  viewer: "text-text-base",
}

/** Rail section label: 11px, uppercase, tracked out. */
export const LABEL_MICRO = "text-[11px] font-[600] uppercase leading-none tracking-[0.06em] text-text-base"

/**
 * Card surface (landing page panels, dialog sub-panels).
 *
 * The hairline comes from --shadow-xs-border-base, whose first layer is a 1px
 * ring in --border-weak-base — the same colour a `border-border-weak-base`
 * would draw. Adding both stacks two hairlines, so the shadow carries it alone.
 */
export const CARD = "rounded-lg bg-surface-base shadow-xs-border-base"

/** Text input / textarea: inset field, hairline, accent focus ring. */
export const FIELD =
  "w-full rounded-md border border-border-weak-base bg-surface-inset-base px-2.5 py-1.5 " +
  "text-12-regular text-text-strong outline-none placeholder:text-text-weak " +
  "transition-colors duration-150 ease-out motion-reduce:transition-none " +
  "hover:border-border-weak-hover focus-visible:ring-2 focus-visible:ring-collab-accent-line " +
  "disabled:cursor-not-allowed disabled:text-text-weak"

/**
 * Segmented control (queue mode, typing visibility).  An inset track holds the
 * options; the selected one is lifted onto the panel surface.
 */
export const SEGMENT_TRACK = "flex w-full gap-0.5 rounded-md border border-border-weak-base bg-surface-inset-base p-0.5"

/** Structure shared by both segment states; pair with one of the two below. */
export const SEGMENT_ITEM =
  "inline-flex min-h-7 flex-1 items-center justify-center rounded px-2 text-12-regular " +
  "transition-colors duration-150 ease-out motion-reduce:transition-none " +
  "outline-none focus-visible:ring-2 focus-visible:ring-collab-accent-line"

export const SEGMENT_ITEM_ACTIVE = "bg-surface-raised-base font-[500] text-text-strong shadow-xs-border-base"
export const SEGMENT_ITEM_IDLE = "text-text-base hover:text-text-strong"

/** Multi-select pill (repository picker).  Structure only; add a state below. */
export const CHIP_SELECT =
  "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-12-regular " +
  "transition-colors duration-150 ease-out motion-reduce:transition-none " +
  "outline-none focus-visible:ring-2 focus-visible:ring-collab-accent-line"

export const CHIP_SELECT_ON = "border-collab-accent-line bg-collab-accent-soft text-collab-accent"
export const CHIP_SELECT_OFF =
  "border-border-weak-base text-text-base hover:bg-surface-base-hover hover:text-text-strong"

/** Quiet inline action rendered as text (Replace, Edit branch name, Retry). */
export const TEXT_ACTION =
  "inline-flex min-h-6 items-center rounded text-[11px] font-[500] text-text-base " +
  "transition-colors duration-150 ease-out motion-reduce:transition-none " +
  "outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-collab-accent-line " +
  "disabled:cursor-not-allowed disabled:text-text-weaker"
