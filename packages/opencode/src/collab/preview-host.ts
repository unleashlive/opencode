/**
 * Resolution of the dedicated host the single active preview is served at.
 *
 * The collab control-plane SPA owns `/` on the main collab host, so the
 * frontend preview can't take that root — it gets its own host
 * (e.g. `preview.collab.utils.unleashlive.com`) and is served there at root
 * (base href "/"), byte-for-byte like a develop-style serve, with no
 * `/preview/` prefix rewriting.
 *
 * Leaf module — imports nothing else in collab/, so server.ts, cookie-auth.ts,
 * preview-router.ts and preview-launcher.ts can all import it without the
 * import cycles that would arise from hanging this off preview-router (which
 * imports from cookie-auth) or preview-launcher.
 */

/**
 * The preview host, lower-cased + port-stripped for direct comparison against
 * an incoming request's `Host` header.  Resolution order:
 *
 *   1. `COLLAB_PREVIEW_HOST` env — explicit override.
 *   2. `preview.${COLLAB_DOMAIN}` — derived from the main collab domain.
 *   3. `null` — no preview host configured (local dev): callers fall back to
 *      the legacy path-based `/preview/` serving.
 */
export function previewHost(): string | null {
  const explicit = process.env["COLLAB_PREVIEW_HOST"]
  if (explicit && explicit.trim()) return explicit.trim().toLowerCase().split(":")[0]!
  const domain = process.env["COLLAB_DOMAIN"]
  if (domain && domain.trim()) return `preview.${domain.trim().toLowerCase().split(":")[0]!}`
  return null
}

/**
 * Absolute URL the SPA links to for opening the preview.  Root of the
 * dedicated preview host when one is configured, else the legacy portless
 * `/preview/` path (relative — resolved against the current origin by the
 * browser).
 */
export function previewUrl(): string {
  const host = previewHost()
  return host ? `https://${host}/` : "/preview/"
}
