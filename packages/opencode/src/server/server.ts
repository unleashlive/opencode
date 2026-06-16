import "./init-projectors"

import { handleCollabRequest } from "@/collab/router"
import { parsePreviewPath, handlePreviewHttp, attachPreviewUpgrade } from "@/collab/preview-router"
import { cookieAuthorizesRequest, lookupCookieIdentity } from "@/collab/cookie-auth"
import { markPreviewTraffic, getActivePreviewPort } from "@/collab/preview-launcher"
import { previewHost } from "@/collab/preview-host"
import { Database } from "@/storage/db"
import { NodeHttpServer } from "@effect/platform-node"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigProvider, Context, Effect, Exit, Layer, Scope, Stream } from "effect"
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import { createServer } from "node:http"
import { MDNS } from "./mdns"
import { HttpApiApp } from "./routes/instance/httpapi/server"
import { disposeMiddleware } from "./routes/instance/httpapi/lifecycle"
import { WebSocketTracker } from "./routes/instance/httpapi/websocket-tracker"
import { PublicApi } from "./routes/instance/httpapi/public"
import type { CorsOptions } from "./cors"
import { lazy } from "@/util/lazy"

// Module load time — used as a coarse server-start time for /healthz uptime.
// Close enough for an ALB health probe; not used for SLA reporting.
const serverStartedAt = Date.now()

// ── Event-loop liveness heartbeat (S5) ──────────────────────────────────────
// A 5-s interval stamps `lastEventLoopTick`.  /healthz compares it against
// now: if the loop has been blocked long enough that the tick is >30 s stale,
// the server is wedged (a long synchronous operation, a tight loop in a
// plugin, a giant JSON.parse on a runaway preview log) even though the HTTP
// listener might still technically accept the connection.  Returning 503 in
// that window lets the ALB pull the task ~1 min sooner than waiting for the
// request to time out.  Unref'd so it never holds the loop open on shutdown.
let lastEventLoopTick = Date.now()
const EVENT_LOOP_STALL_THRESHOLD_MS = 30_000
{
  const tick = setInterval(() => {
    lastEventLoopTick = Date.now()
  }, 5_000)
  if (typeof tick.unref === "function") tick.unref()
}

// ── Collab middleware ──────────────────────────────────────────────────────────
// Intercepts /collab/* requests before the Effect HTTP router's catch-all UI
// route can serve index.html for them. Bridges the standard Web Request/Response
// API used by the collab router into Effect's HttpServerRequest/HttpServerResponse.

// Friendly page shown at the preview host when nothing is running yet.
const NO_PREVIEW_HTML =
  `<!doctype html><meta charset="utf-8"><title>No preview running</title>` +
  `<body style="font:14px system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#27272a">` +
  `<h1 style="font-size:1.1rem">No preview is currently running</h1>` +
  `<p>A collab Driver needs to launch the dev-server preview from the session sidebar. ` +
  `Once it's up, this host serves it at the root.</p></body>`

/**
 * Convert the proxied upstream `Response` from handlePreviewHttp into an
 * Effect HttpServerResponse, streaming the body without buffering (video,
 * large downloads, SSE all work).  Shared by the dedicated-preview-host
 * branch and the legacy `/preview/` path branch.
 */
function previewServerResponse(webResponse: Response) {
  const previewHeaders = new Headers(webResponse.headers)
  if (webResponse.body) {
    const previewStream = Stream.fromAsyncIterable(
      webResponse.body as AsyncIterable<Uint8Array>,
      () => new Error("Preview stream error"),
    )
    return HttpServerResponse.stream(previewStream, {
      status: webResponse.status,
      headers: previewHeaders,
    })
  }
  return HttpServerResponse.raw(new Uint8Array(), {
    status: webResponse.status,
    headers: previewHeaders,
  })
}

const collabMiddleware: HttpMiddleware.HttpMiddleware = (app) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const pathname = new URL(req.url, "http://localhost").pathname
    // Lower-cased, port-stripped Host for the dedicated-preview-host routing
    // below.  Effect's HttpServerRequest exposes the raw header map.
    const host = (req.headers["host"] ?? "").toLowerCase().split(":")[0]

    // /healthz — ALB / ECS health probe.  Sits ahead of every other route so
    // a degraded collab/preview path can't fail the liveness check on its own.
    // Returns 503 when the SQLite handle is unreachable; the ALB pulls the
    // task out of rotation and ECS replaces it.
    if (pathname === "/healthz") {
      return yield* serveHealthz()
    }

    // Dedicated preview host — root serve.  When the request arrived on
    // `preview.collab…` the ENTIRE host is the single active preview served
    // at root (base href "/"), byte-for-byte like a develop serve.  This
    // MUST come before the `/`→/collab/new landing below, since on the
    // preview host `/` is the preview's index.html, not the collab landing.
    // (/healthz is handled above this, so ALB health checks are unaffected
    // regardless of Host.)
    const ph = previewHost()
    if (ph && host === ph) {
      const webRequest = yield* HttpServerRequest.toWeb(req)
      // Same shell-trust gate as the legacy path (ADR-0001): a valid collab
      // cookie is enough.  cookieAuthorizesRequest now allows when the Host
      // is the preview host (see cookie-auth.ts rule a0).
      if (cookieAuthorizesRequest(webRequest) !== "allow") {
        return HttpServerResponse.raw(new TextEncoder().encode("Forbidden"), {
          status: 403,
          headers: new Headers({ "content-type": "text/plain" }),
        })
      }
      markPreviewTraffic()
      const port = getActivePreviewPort()
      if (port === null) {
        return HttpServerResponse.raw(new TextEncoder().encode(NO_PREVIEW_HTML), {
          status: 200,
          headers: new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }),
        })
      }
      // Root serve: forward the WHOLE pathname (servePath is null now that the
      // frontend builds at base href "/"), so /assets/x.js → /assets/x.js.
      const webResponse = yield* Effect.promise(() => handlePreviewHttp(webRequest, port, pathname || "/"))
      return previewServerResponse(webResponse)
    }

    // GET / and GET /collab — collab landing.  Authenticated users are
    // bounced to /collab/new (which lists their existing sessions in the
    // sidebar + shows the create form).  Unauthenticated users get a small
    // sign-in page rather than the bare opencode home — this deployment is
    // collab-first, the standalone opencode UI never makes sense here.
    // /collab (no trailing path) is included because the SPA's router has
    // no route for it — falling through served a blank shell.
    if (req.method === "GET" && (pathname === "/" || pathname === "/collab")) {
      const webRequest = yield* HttpServerRequest.toWeb(req)
      return yield* Effect.sync(() => HttpServerResponse.fromWeb(serveCollabLanding(webRequest)))
    }

    // Legacy `/preview/...` on the MAIN host, when a dedicated preview host
    // IS configured → 301 to the subdomain root so old links + bookmarks keep
    // working and there's one canonical preview origin.  Done by prefix (not
    // parsePreviewPath) so the redirect fires even when no preview is active
    // (parsePreviewPath's portless form returns null then).  Strip an optional
    // leading `<port>/` segment so the redirect preserves the deep path.
    if (ph && pathname.startsWith("/preview/")) {
      const afterPrefix = pathname.slice("/preview/".length)
      const segs = afterPrefix.split("/")
      const rest = /^\d+$/.test(segs[0] ?? "") ? "/" + segs.slice(1).join("/") : "/" + afterPrefix
      const location = `https://${ph}${rest}${new URL(req.url, "http://localhost").search}`
      return HttpServerResponse.raw(new Uint8Array(), {
        status: 301,
        headers: new Headers({ location, "cache-control": "no-store" }),
      })
    }

    // Legacy `/preview/<port>/<rest>` path-based proxy — only the local-dev
    // fallback now (no preview host configured).  WebSocket upgrades are
    // handled separately by attachPreviewUpgrade.
    const previewParsed = parsePreviewPath(pathname)
    if (previewParsed) {
      const webRequest = yield* HttpServerRequest.toWeb(req)
      // Gate the preview proxy on a valid collab cookie.  Without this,
      // any internet client can hit /preview/<port>/ and reach a dev
      // server inside the container — that's the ADR-0001 hole PR #2
      // didn't close.  Cookie alone is enough (no port↔session binding
      // for v1 — see preview-router.ts:17-22 on the shell-trust model).
      if (cookieAuthorizesRequest(webRequest) !== "allow") {
        return HttpServerResponse.raw(new TextEncoder().encode("Forbidden"), {
          status: 403,
          headers: new Headers({ "content-type": "text/plain" }),
        })
      }
      // Bump the preview-launcher's idle timer.  Authenticated request
      // means someone's actively using the preview; reset the 30-min
      // idle SIGTERM window.  Cheap — single timestamp write.
      markPreviewTraffic()
      const webResponse = yield* Effect.promise(() =>
        handlePreviewHttp(webRequest, previewParsed.port, previewParsed.rest),
      )
      return previewServerResponse(webResponse)
    }

    // V4 — long-lived immutable cache headers on content-hashed static
    // assets.  Vite emits assets under /assets/ and as <name>-<hash>.<ext>;
    // the hash changes whenever the content does, so caching them for a year
    // is safe and cuts repeat-visit + SPA-reload load.  index.html (no hash)
    // is deliberately excluded so a deploy's new asset manifest is always
    // picked up.  We let the upstream UI route produce the response, then
    // stamp the header on success only (don't cache a 404).
    if (req.method === "GET" && isHashedStaticAsset(pathname)) {
      const res = yield* app
      if (res.status >= 200 && res.status < 300) {
        return HttpServerResponse.setHeader(res, "cache-control", "public, max-age=31536000, immutable")
      }
      return res
    }

    // Only intercept collab API/auth/invite paths — let UI routes fall through to index.html
    const isCollabApi =
      pathname === "/collab/auth/github" ||
      pathname.startsWith("/collab/auth/") ||
      pathname.startsWith("/collab/invite/") ||
      pathname === "/collab/repos" ||
      pathname === "/collab/me" ||
      pathname === "/collab/session" ||
      pathname.startsWith("/collab/session/") ||
      pathname === "/collab/claude-creds" ||
      pathname === "/collab/claude-creds/status"
    if (!isCollabApi) return yield* app

    // toWeb converts Effect's HttpServerRequest → standard Web API Request (body included)
    const webRequest = yield* HttpServerRequest.toWeb(req)
    const webResponse = yield* Effect.promise(() => handleCollabRequest(webRequest))

    // HttpServerResponse.fromWeb properly extracts multi-valued Set-Cookie
    // headers via getSetCookie() and stores them in the Effect response's
    // dedicated `cookies` collection.  Going through HttpServerResponse.raw
    // with a Headers object loses them, because Effect's internal Headers
    // type is `Record<string, string>` (single value per key) — multiple
    // Set-Cookies collapse to one (the OAuth callback never set a cookie
    // before this fix, which manifested as an infinite re-auth loop).
    return HttpServerResponse.fromWeb(webResponse)
  })

const serveHealthz = () =>
  Effect.sync(() => {
    const dbOk = pingDatabase()
    const githubStatus = cachedGitHubStatus()
    // S5 — event-loop liveness.  Stale tick = the loop was blocked long
    // enough to miss several 5-s heartbeats, i.e. the server is wedged.
    const eventLoopLagMs = Date.now() - lastEventLoopTick
    const eventLoopOk = eventLoopLagMs <= EVENT_LOOP_STALL_THRESHOLD_MS
    // db + event-loop are the checks that can flip overall ok; github +
    // native_api are informational so a degraded external dep doesn't pull
    // the ALB out from under us (we'd be DoS-ing ourselves if GitHub's HEAD
    // ever 5xx'd).
    const ok = dbOk && eventLoopOk
    const body = {
      ok,
      checks: {
        db: dbOk ? "ok" : "fail",
        event_loop: eventLoopOk ? "ok" : "stalled",
        event_loop_lag_ms: eventLoopLagMs,
        github: githubStatus,
        // native_api is the server itself; if Bun is up enough to answer /healthz
        // then the native API is up too — we just record it for the dashboard.
        native_api: "ok",
      },
      version: process.env["OPENCODE_VERSION"] ?? "unknown",
      uptime_s: Math.floor((Date.now() - serverStartedAt) / 1000),
    }
    if (!eventLoopOk) {
      log.error("/healthz event-loop stall detected", { lagMs: eventLoopLagMs })
    }
    return HttpServerResponse.jsonUnsafe(body, {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    })
  })

// V4 — identify a content-hashed static asset (immutable-cacheable).
//   - anything under /assets/  (Vite's default hashed-asset directory), OR
//   - a top-level file with a `-<hash>` segment before a known static
//     extension, e.g. /index-DTT-8kNv.js, /chunk-AB12cd34.css
// index.html and other un-hashed paths return false → not long-cached, so a
// deploy's fresh asset manifest is always fetched.
const HASHED_ASSET_RE = /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|avif|gif|ico|wasm|map)$/i
function isHashedStaticAsset(pathname: string): boolean {
  if (pathname.startsWith("/assets/")) return true
  return HASHED_ASSET_RE.test(pathname)
}

function pingDatabase(): boolean {
  try {
    Database.use((db) => db.run("SELECT 1"))
    return true
  } catch (err) {
    log.error("/healthz db ping failed", { error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

/**
 * GET / handler.
 *   - cookie present + valid → 302 /collab/new (the session list / create form)
 *   - else                   → 200 sign-in landing page
 *
 * The standalone opencode home page (HomeRoute in packages/app) doesn't
 * apply to this deployment — every user goes through collab.
 */
function serveCollabLanding(req: Request): Response {
  const id = lookupCookieIdentity(req)
  if (id) {
    return new Response(null, { status: 302, headers: { location: "/collab/new" } })
  }
  return new Response(SIGN_IN_LANDING_HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  })
}

// Minimal inline HTML — no SPA bundle needed, no asset fetches, no client-
// side router involved.  Dark-mode-only to match the SPA's default theme.
// `next` is hardcoded to /collab/new because that page already shows the
// "Rejoin Session" sidebar with the user's existing sessions.
const SIGN_IN_LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>unleashlive collab — sign in</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
  <link rel="shortcut icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/collab.webmanifest" />
  <meta name="theme-color" content="#09090b" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Collab" />
  <style>
    :root { color-scheme: dark; }
    html, body { margin: 0; padding: 0; height: 100%; background: #0a0a0a; color: #e4e4e7; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .page { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .card { max-width: 28rem; width: 100%; text-align: center; }
    h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; font-weight: 600; color: #fafafa; }
    p { margin: 0 0 1.5rem 0; color: #a1a1aa; }
    .btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1.1rem; background: #18181b; border: 1px solid #3f3f46; border-radius: 0.5rem; color: #fafafa; text-decoration: none; font-weight: 500; transition: background 120ms ease, border-color 120ms ease; }
    .btn:hover { background: #27272a; border-color: #52525b; }
    .btn svg { width: 18px; height: 18px; }
    .foot { margin-top: 2rem; font-size: 12px; color: #71717a; }
    .foot code { background: #18181b; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <h1>unleashlive collab</h1>
      <p>Sign in with GitHub to create or join a collaborative coding session.</p>
      <a class="btn" href="/collab/auth/github?next=/collab/new">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.11.83-.26.83-.58v-2c-3.34.73-4.04-1.61-4.04-1.61-.54-1.4-1.34-1.77-1.34-1.77-1.1-.74.08-.72.08-.72 1.21.09 1.85 1.25 1.85 1.25 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.45 11.45 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.87.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3"/></svg>
        Sign in with GitHub
      </a>
      <p class="foot">Only members of <code>unleashlive</code> can sign in.  This is a developer-only environment.</p>
    </div>
  </div>
</body>
</html>
`

// GitHub status — cached for 5 minutes so /healthz doesn't HEAD api.github.com
// on every probe (ECS hits this every 15 s).  Async probe runs lazily; the
// healthz call returns whatever the last sample said.  A first-call result of
// "unknown" is acceptable for a brand-new task — by the time the ALB has
// looked twice it's settled.
let githubProbe: { ts: number; status: "ok" | "degraded" | "unknown" } = { ts: 0, status: "unknown" }
const GITHUB_PROBE_TTL_MS = 5 * 60 * 1000

function cachedGitHubStatus(): "ok" | "degraded" | "unknown" {
  const now = Date.now()
  if (now - githubProbe.ts > GITHUB_PROBE_TTL_MS) {
    // Fire-and-forget; the next /healthz picks up the result.
    void refreshGitHubProbe().catch(() => {
      githubProbe = { ts: now, status: "degraded" }
    })
  }
  return githubProbe.status
}

async function refreshGitHubProbe(): Promise<void> {
  try {
    const res = await fetch("https://api.github.com/", { method: "HEAD", signal: AbortSignal.timeout(3000) })
    githubProbe = { ts: Date.now(), status: res.ok ? "ok" : "degraded" }
  } catch {
    githubProbe = { ts: Date.now(), status: "degraded" }
  }
}

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

const log = Log.create({ service: "server" })

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

type ServerApp = {
  fetch(request: Request): Response | Promise<Response>
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>
}

type ListenOptions = CorsOptions & {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
}
type ListenerState = {
  scope: Scope.Scope
  server: Context.Service.Shape<typeof HttpServer.HttpServer>
  http: ListenerServer
  websockets: WebSocketTracker.Interface
}
type EffectListener = Omit<Listener, "stop"> & {
  stop: (close?: boolean) => Effect.Effect<void>
}

interface ListenerServer {
  readonly closeAll: Effect.Effect<void>
}

class ListenerServerService extends Context.Service<ListenerServerService, ListenerServer>()(
  "@opencode/ListenerServer",
) {}

export const Default = lazy(() => {
  const handler = HttpApiApp.webHandler().handler
  const app: ServerApp = {
    fetch: (request: Request) => {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/collab/")) {
        return handleCollabRequest(request)
      }
      return handler(request, HttpApiApp.context)
    },
    request(input, init) {
      return app.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
  return { app }
})

export async function openapi() {
  return OpenApi.fromApi(PublicApi)
}

export let url: URL

export async function listen(opts: ListenOptions): Promise<Listener> {
  const listener = await Effect.runPromise(listenEffect(opts))
  return {
    hostname: listener.hostname,
    port: listener.port,
    url: listener.url,
    stop: (close?: boolean) => Effect.runPromiseExit(listener.stop(close)).then(() => undefined),
  }
}

const listenEffect: (opts: ListenOptions) => Effect.Effect<EffectListener, unknown> = Effect.fn("Server.listen")(
  function* (opts: ListenOptions) {
    const state = yield* startWithPortFallback(opts)
    const address = yield* tcpAddress(state)
    const listenerUrl = makeURL(opts.hostname, address.port)
    url = listenerUrl

    const unpublishMdns = yield* setupMdns(opts, address.port, state.scope)

    return {
      hostname: opts.hostname,
      port: address.port,
      url: listenerUrl,
      stop: yield* makeStop(state, unpublishMdns),
    }
  },
)

function listenerLayer(opts: ListenOptions, port: number) {
  return HttpRouter.serve(HttpApiApp.createRoutes(opts), {
    // collabMiddleware intercepts /collab/* before the catch-all uiRoute serves index.html
    middleware: (app) => disposeMiddleware(collabMiddleware(app)),
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.provideMerge(WebSocketTracker.layer),
    Layer.provideMerge(serverLayer({ port, hostname: opts.hostname })),
    // Install a fresh `ConfigProvider` per listener so `Config.string(...)`
    // reads reflect the current `process.env`. Effect's default
    // `ConfigProvider` snapshots `process.env` on first read and caches the
    // result on a module-singleton Reference; without overriding it here,
    // every later `Server.listen()` keeps observing that initial snapshot.
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
  )
}

function startWithPortFallback(opts: ListenOptions) {
  if (opts.port !== 0) return startListener(opts, opts.port)
  // Match the legacy listener port-resolution behavior: explicit `0` prefers
  // 4096 first, then any free port.
  return startListener(opts, 4096).pipe(Effect.catch(() => startListener(opts, 0)))
}

function startListener(opts: ListenOptions, port: number) {
  const scope = Scope.makeUnsafe()
  return Layer.buildWithMemoMap(listenerLayer(opts, port), Layer.makeMemoMapUnsafe(), scope).pipe(
    Effect.provide(HttpApiApp.context),
    Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
    Effect.map(
      (ctx): ListenerState => ({
        scope,
        server: Context.get(ctx, HttpServer.HttpServer),
        http: Context.get(ctx, ListenerServerService),
        websockets: Context.get(ctx, WebSocketTracker.Service),
      }),
    ),
  )
}

function tcpAddress(state: ListenerState) {
  return Effect.gen(function* () {
    if (state.server.address._tag === "TcpAddress") return state.server.address
    yield* Scope.close(state.scope, Exit.void).pipe(Effect.ignore)
    return yield* Effect.die(new Error(`Unexpected HttpServer address tag: ${state.server.address._tag}`))
  })
}

function makeURL(hostname: string, port: number) {
  const result = new URL("http://localhost")
  result.hostname = hostname
  result.port = String(port)
  return result
}

function setupMdns(opts: ListenOptions, port: number, scope: Scope.Scope) {
  return Effect.gen(function* () {
    const publish =
      opts.mdns && port && opts.hostname !== "127.0.0.1" && opts.hostname !== "localhost" && opts.hostname !== "::1"
    if (publish) {
      const unpublish = yield* Effect.cached(Effect.sync(() => MDNS.unpublish()))
      yield* Effect.sync(() => MDNS.publish(port, opts.mdnsDomain))
      yield* Scope.addFinalizer(scope, unpublish)
      return unpublish
    }
    if (opts.mdns) log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    return Effect.void
  })
}

function makeStop(state: ListenerState, unpublishMdns: Effect.Effect<void>) {
  return Effect.gen(function* () {
    const forceCloseOnce = yield* Effect.cached(forceClose(state).pipe(Effect.ignore))
    const closeScopeOnce = yield* Effect.cached(Scope.close(state.scope, Exit.void).pipe(Effect.ignore))

    return (close?: boolean) =>
      Effect.gen(function* () {
        yield* unpublishMdns
        if (close) yield* forceCloseOnce
        yield* closeScopeOnce
      })
  })
}

function forceClose(state: ListenerState) {
  return Effect.all([state.http.closeAll, state.websockets.closeAll], { concurrency: "unbounded", discard: true })
}

function serverLayer(opts: { port: number; hostname: string }) {
  const server = createServer()
  const serverRef = { closeStarted: false, forceStop: false }
  const close = server.close.bind(server)
  // Keep shutdown owned by NodeHttpServer, but honor listener.stop(true) by
  // force-closing active HTTP sockets when its finalizer calls server.close().
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Node's overloads don't preserve a monkey-patched method assignment.
  server.close = ((callback?: Parameters<typeof server.close>[0]) => {
    serverRef.closeStarted = true
    const result = close(callback)
    if (serverRef.forceStop) server.closeAllConnections()
    return result
  }) as typeof server.close

  // /preview/<port>/* WebSocket upgrades — must hook into the raw Node
  // server's `upgrade` event, ahead of any other ws handlers, because by
  // the time Effect's HTTP layer sees a request the upgrade chance is
  // gone.  Non-/preview upgrades fall through to opencode's own ws routes.
  attachPreviewUpgrade(server)

  return Layer.mergeAll(
    NodeHttpServer.layer(() => server, { port: opts.port, host: opts.hostname, gracefulShutdownTimeout: "1 second" }),
    Layer.succeed(ListenerServerService)(
      ListenerServerService.of({
        closeAll: Effect.sync(() => {
          serverRef.forceStop = true
          if (serverRef.closeStarted) server.closeAllConnections()
        }),
      }),
    ),
  )
}

export * as Server from "./server"
