// Static UI assets the browser fetches without app-managed credentials, e.g.
// the manifest link in <head>. These bypass auth so the page can install/render
// the manifest icons even when a server password is configured.
export const PUBLIC_UI_PATHS = new Set<string>([
  "/",
  "/site.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
  "/oc-theme-preload.js",
])

// SPA shell, collab UI routes, and static bundles must bypass HTTP basic auth
// (OPENCODE_SERVER_PASSWORD) so the page can load and start its own OAuth
// flow.  ADR-0001's password protects the HttpApi (PTY, file API, session
// management) — not the SPA itself.
//
// Safety: the /collab/* API endpoints (auth/me/session/etc.) are intercepted
// by collabMiddleware in server.ts BEFORE the Effect app sees them, so they
// never reach this middleware.  Anything that lands here under /collab/* is
// a client-side SPA route which serveLocalUIEffect resolves to index.html.
const PUBLIC_UI_PREFIXES = ["/collab", "/assets/"]
const PUBLIC_UI_EXTENSIONS = /\.(?:png|jpg|jpeg|gif|svg|ico|webmanifest|js|css|woff|woff2|ttf|map|txt)$/i

export function isPublicUIPath(method: string, pathname: string) {
  if (method !== "GET") return false
  if (PUBLIC_UI_PATHS.has(pathname)) return true
  if (PUBLIC_UI_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true
  if (PUBLIC_UI_EXTENSIONS.test(pathname)) return true
  return false
}
