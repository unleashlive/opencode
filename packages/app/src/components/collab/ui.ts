/**
 * Shared visual language for the Collab UI.
 *
 * Centralises the button / pill styling that was previously copy-pasted as
 * one-off Tailwind strings across new.tsx, session.tsx, PreviewLauncher.tsx and
 * CollabEmbedSidebar.tsx, so the look stays cohesive and is tuned in one place.
 *
 * Palette — deliberately aligned with opencode's own design tokens (see
 * packages/ui/src/styles/theme.css) so collab doesn't clash with the embedded
 * IDE:
 *   - interactive / primary  → blue   (theme `--*-interactive-*`, ~#034cff)
 *   - success / live         → emerald+green (theme `--*-success-*`, ~#12c905)
 *   - accent / brand         → indigo→violet (theme lilac/info, ~#a753ae)
 *
 * The primary action carries a subtle blue→indigo→violet gradient (a restrained
 * nod to Gemini's signature sweep) with a soft lift on hover; success keeps the
 * green family; secondary is a quiet zinc. Sizing (width / padding / text size)
 * is intentionally left to the call site — compose e.g.
 * `class={`${BTN_PRIMARY} w-full py-2.5 text-sm`}`.
 */

/** Base appearance only — no width / padding / text-size (caller composes those). */
export const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg transition-all duration-200 ease-out " +
  "focus:outline-none disabled:cursor-not-allowed disabled:translate-y-0"

/** Primary CTA — blue→indigo→violet gradient, soft elevation + hover lift. */
export const BTN_PRIMARY =
  BTN_BASE +
  " font-semibold text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600" +
  " shadow-lg shadow-indigo-950/40 ring-1 ring-inset ring-white/10" +
  " hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 hover:shadow-xl hover:shadow-indigo-800/40 hover:-translate-y-px" +
  " active:translate-y-0 active:shadow-md" +
  " focus-visible:ring-2 focus-visible:ring-violet-400/70" +
  " disabled:from-zinc-700 disabled:via-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:shadow-none disabled:ring-white/5"

/** Success / live action — emerald→green, matches preview-running + Open PR semantics. */
export const BTN_SUCCESS =
  BTN_BASE +
  " font-medium text-white bg-gradient-to-r from-emerald-600 to-green-600" +
  " shadow-lg shadow-emerald-950/40 ring-1 ring-inset ring-white/10" +
  " hover:from-emerald-500 hover:to-green-500 hover:shadow-xl hover:shadow-emerald-800/40 hover:-translate-y-px" +
  " active:translate-y-0 active:shadow-md" +
  " focus-visible:ring-2 focus-visible:ring-emerald-400/70" +
  " disabled:from-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500 disabled:shadow-none"

/** Quiet secondary — zinc fill with a faint indigo focus accent. */
export const BTN_SECONDARY =
  BTN_BASE +
  " font-medium text-zinc-200 bg-zinc-800/80 ring-1 ring-inset ring-white/10" +
  " hover:bg-zinc-700/80 hover:text-white hover:ring-white/15" +
  " focus-visible:ring-2 focus-visible:ring-indigo-400/60" +
  " disabled:opacity-50"

/** "Collab" brand pill — subtle blue→violet wash. */
export const PILL_BRAND =
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider" +
  " text-indigo-200 bg-gradient-to-r from-blue-500/20 to-violet-500/20 ring-1 ring-inset ring-indigo-400/30" +
  " transition-colors hover:from-blue-500/30 hover:to-violet-500/30 hover:text-white"

/** Selected/active row accent (e.g. the current session in the embed sidebar). */
export const ROW_ACTIVE =
  "bg-gradient-to-r from-blue-500/10 to-violet-500/10 border-l-2 border-l-violet-400"
