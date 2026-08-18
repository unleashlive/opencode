/**
 * Unleash brand mark for the Collab product lockup (SKU-1).
 *
 * Source: packages/app/public/unleash-mark.svg (solid red square, white
 * glyphs). Inlined here rather than rendered as an <img> so it needs no
 * network fetch and can never 404 — the viewBox and paths are copied
 * verbatim from the source file.
 *
 * `rounded-[4px]` plus `overflow-hidden` turns the flat square into
 * something that reads as an app icon; the mark is a fixed brand asset so it
 * carries no color overrides and must never be recolored.
 *
 * Always paired with the adjacent "Unleash Collab" product name, so it is
 * `aria-hidden`: the text carries the accessible name, the mark is
 * decoration.
 */
export function BrandMark(props: { size?: number; class?: string }) {
  const size = () => props.size ?? 18

  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      class={`shrink-0 overflow-hidden rounded-[4px] ${props.class ?? ""}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="512" height="512" fill="#E51728" />
      <path
        d="M201.424 320.368V126.736L200.24 127.408L172.56 143.408L172.144 143.632V334.512L146.064 319.44V158.704L144.88 159.376L117.168 175.376L116.784 175.6V336.368L117.2 336.592L144.88 352.56L145.264 352.816L145.68 352.56L201.04 320.592L201.424 320.368Z"
        fill="white"
      />
      <path
        d="M395.216 239.568L394.832 239.344L229.936 144.112L256.016 129.072L394.032 208.752L395.216 209.456V175.632L394.832 175.408L256.4 95.472L256.016 95.248L255.6 95.472L227.92 111.44L227.536 111.664V112.112L227.472 176.048V176.528L227.856 176.752L394.032 272.688L395.216 273.392V239.568Z"
        fill="white"
      />
      <path
        d="M366.736 287.056L339.408 271.312L339.024 271.056L338.608 271.312L172.56 367.184L171.344 367.856L172.56 368.56L200.24 384.528L200.624 384.784L201.04 384.528L365.936 289.328V319.44L227.92 399.152L226.736 399.824L227.92 400.528L255.6 416.496L256.016 416.752L256.4 416.496L394.832 336.592L395.216 336.368V303.472L394.832 303.248L368.304 287.952L367.536 287.504L366.736 287.056Z"
        fill="white"
      />
    </svg>
  )
}
