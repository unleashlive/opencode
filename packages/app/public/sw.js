// Minimal service worker for the Unleash Collab PWA.
//
// Purpose: installability + standalone display ONLY.  It must never interfere
// with the auth-cookie flow, the SSE stream, or any dynamic collab API, so the
// fetch handler is a thin pass-through with an opportunistic cache ONLY for
// Vite's content-hashed, immutable `/assets/*` (and the static PWA icons) —
// safe to cache forever because their filename changes whenever the content
// does.  No HTML / navigation / `/collab/*` / `/pty/*` / `/preview/*` is ever
// cached or intercepted; those go straight to the network.

const CACHE = "collab-assets-v1"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/web-app-manifest-") ||
    url.pathname === "/apple-touch-icon-v3.png"
  )
}

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  // Same-origin immutable static assets only — everything else (HTML
  // navigations, /collab/* API + SSE, /pty/*, /preview/*) is left untouched so
  // the browser handles it over the network exactly as before.
  if (url.origin !== self.location.origin || !isImmutableAsset(url)) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res && res.status === 200 && res.type === "basic") {
        cache.put(req, res.clone())
      }
      return res
    })(),
  )
})
