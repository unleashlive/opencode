/**
 * Small inline glyphs shared by the Collab surfaces (SKU-1).
 *
 * The host icon registry (packages/ui/src/components/icon.tsx) has no
 * disclosure chevron, so it is drawn here on the same 20x20 grid and with the
 * same currentColor stroke as the registry icons, and shared rather than
 * copied into every rail and card that collapses a group.
 */

export function Chevron(props: { open: boolean; class?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      class={`size-3 shrink-0 text-icon-base transition-transform duration-150 ease-out motion-reduce:transition-none ${
        props.open ? "rotate-90" : ""
      } ${props.class ?? ""}`}
    >
      <path
        d="M7.5 4.5 13 10l-5.5 5.5"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}
