/**
 * Frontend live-preview launcher (Driver-clicks-button → dev server runs in
 * the workspace).
 *
 * Two modes, selected by whether ECS_CLUSTER_ARN is set at runtime:
 *
 * ── Process mode (local dev / no ECS_CLUSTER_ARN) ──────────────────────────
 *   One preview per session, run as a child process inside this container.
 *   Exactly as before — pnpm install → pnpm run start, SIGTERM on stop.
 *
 * ── ECS mode (production, ECS_CLUSTER_ARN set) ─────────────────────────────
 *   One ECS Fargate task per session.  The collab container proxies HTTP and
 *   WebSocket traffic to the task's private IP on port 8080.  The task is
 *   started via RunTask (with COLLAB_SESSION_ID, REPO_FULL_NAME, etc. in the
 *   container overrides) and stopped via StopTask.  The task itself runs
 *   scripts/preview-entrypoint.js which:
 *     1. Fetches its own private IP from ECS task metadata
 *     2. POSTs to POST /collab/preview-task/register
 *     3. Sends heartbeats every 60 s to POST /collab/preview-task/heartbeat
 *     4. Pipes stdout/stderr lines to POST /collab/preview-task/log
 *
 * Multiple sessions can run previews simultaneously in ECS mode (the
 * per-session Map replaces the old singleton).  Idle shutdown (30 min),
 * lifetime cap (2 h), and install-hang detection work in both modes.
 *
 * Lifecycle:
 *
 *   launchPreview(...)  →  "installing"  →  ready → "running"
 *   stopPreview(sid)    →  ECS StopTask / SIGTERM child
 *   restartPreview(sid) →  stop + relaunch with same args
 *
 * URL routing: the collab proxy in preview-router.ts uses the session's
 * privateIp (ECS mode) or 127.0.0.1 (process mode) to forward requests.
 * The SPA appends `?cs=<sessionId>` on first load to the preview host URL;
 * the proxy reads it, sets a `preview_sid` cookie, and routes subsequent
 * requests to the right ECS task.
 */

import { spawn, type ChildProcess } from "child_process"
import { existsSync, readFileSync, statSync, readdirSync } from "fs"
import { join } from "path"
import { repoWorkspacePath } from "./workspace"
import { previewUrl } from "./preview-host"
import type { CollabEvent } from "@opencode-ai/collab"

// ── ECS SDK (lazy — only imported when ECS_CLUSTER_ARN is set) ─────────────

type ECSClientType = import("@aws-sdk/client-ecs").ECSClient
type RunTaskCommandType = typeof import("@aws-sdk/client-ecs").RunTaskCommand
type StopTaskCommandType = typeof import("@aws-sdk/client-ecs").StopTaskCommand

let _ecsClient: ECSClientType | null = null

async function getEcsClient(): Promise<ECSClientType> {
  if (_ecsClient) return _ecsClient
  const { ECSClient } = await import("@aws-sdk/client-ecs")
  _ecsClient = new ECSClient({ region: process.env.AWS_REGION ?? "ap-southeast-2" })
  return _ecsClient
}

function isEcsMode(): boolean {
  return !!process.env.ECS_CLUSTER_ARN
}

// ── Configuration ──────────────────────────────────────────────────────────

/** Frontend defaults — applied when no `.opencode-preview.json` is present. */
const FRONTEND_DEFAULTS: PreviewConfig = {
  installCommand: "pnpm i --shamefully-hoist=true",
  command: "pnpm run start",
  port: 8080,
  label: "Unleash live frontend",
  readyPattern: undefined,
  upstreamScheme: "http",
}

/** Idle window — no traffic for this long → stop the preview. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

/** Absolute lifetime cap for a single preview run. */
const MAX_LIFETIME_MS = 2 * 60 * 60 * 1000

/** Memory circuit-breaker — process mode only.  ECS tasks have isolated memory. */
const MEMORY_CAP_BYTES = 12 * 1024 * 1024 * 1024

/** Install-hang watchdog — if the task/process has emitted nothing (ECS: no
 *  heartbeat; process mode: no stdout/stderr) for this long while still in
 *  the "installing" phase, presume the install is wedged and stop it. */
const INSTALL_SILENCE_TIMEOUT_MS = 5 * 60 * 1000

/** Crash-loop breaker — refuse to auto-resume after this many install crashes. */
const BREAKER_CRASH_THRESHOLD = 3
const BREAKER_WINDOW_MS = 60 * 60 * 1000

/** How often the sweep runs (idle / lifetime / memory / install-hang checks). */
const SWEEP_INTERVAL_MS = 60 * 1000

/** Cap on retained install / run log lines. */
const LOG_LINES_RETAINED = 200

// ── Types ──────────────────────────────────────────────────────────────────

export interface PreviewConfig {
  readonly installCommand?: string
  readonly command: string
  readonly port: number
  readonly label: string
  readonly readyPattern?: string
  readonly upstreamScheme?: "http" | "https"
  readonly servePath?: string
}

export type PreviewStatus = "installing" | "running" | "stopped" | "failed"

export interface PreviewStateSnapshot {
  readonly collabSessionId: string
  readonly repoFullName: string
  readonly port: number
  readonly label: string
  readonly status: PreviewStatus
  readonly startedAt: number
  readonly lastTraffic: number
  readonly recentLog: ReadonlyArray<{ stream: "stdout" | "stderr"; line: string; ts: number }>
  readonly errorMessage?: string
  readonly url: string
  /** Private IP of the ECS task (ECS mode) or null (process mode). */
  readonly privateIp: string | null
}

interface ActiveState {
  // ── Identity ──────────────────────────────────────────────────────────
  collabSessionId: string
  repoFullName: string
  port: number
  label: string
  // ── Status (mutable) ──────────────────────────────────────────────────
  status: PreviewStatus
  startedAt: number
  lastTraffic: number
  errorMessage?: string
  url: string
  // ── Common internals ──────────────────────────────────────────────────
  _log: Array<{ stream: "stdout" | "stderr"; line: string; ts: number }>
  _stopRequested: boolean
  _gitAccessToken: string | null
  _upstreamScheme: "http" | "https"
  _servePath: string | null
  // ── ECS-mode fields (null in process mode) ────────────────────────────
  taskArn: string | null
  privateIp: string | null
  /** Last heartbeat received from the ECS task (ECS mode) or last stdout/
   *  stderr line emitted by the child (process mode).  Used by the install-
   *  hang watchdog to detect silence in the "installing" phase. */
  _lastHeartbeat: number
  // ── Process-mode fields (null in ECS mode) ────────────────────────────
  _child: ChildProcess | null
  config: PreviewConfig | null
}

// ── Module state ───────────────────────────────────────────────────────────

/** Active previews keyed by collab session ID.  Multiple entries are allowed
 *  in ECS mode; process mode still allows only one at a time (enforced in
 *  launchPreview).  The Map replaces the old `active: ActiveState | null`
 *  singleton so the rest of the system can support concurrent previews. */
const active = new Map<string, ActiveState>()

let sweepTimer: ReturnType<typeof setInterval> | null = null

/** Pending restart timers, one per session. */
const pendingRestarts = new Map<string, ReturnType<typeof setTimeout>>()

/** Last-known git HEAD per session (branch-change auto-restart, process mode). */
const lastKnownHeads = new Map<string, string>()

type Broadcaster = (collabSessionId: string, event: CollabEvent) => void
let broadcast: Broadcaster = () => {}

export function setPreviewBroadcaster(fn: Broadcaster): void {
  broadcast = fn
}

// ── Internal helpers ───────────────────────────────────────────────────────

function makeSnapshot(st: ActiveState): PreviewStateSnapshot {
  return {
    collabSessionId: st.collabSessionId,
    repoFullName: st.repoFullName,
    port: st.port,
    label: st.label,
    status: st.status,
    startedAt: st.startedAt,
    lastTraffic: st.lastTraffic,
    recentLog: st._log.slice(-LOG_LINES_RETAINED),
    errorMessage: st.errorMessage,
    url: previewUrl(),
    privateIp: st.privateIp,
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export function previewConfigForRepo(
  collabSessionId: string,
  repoFullName: string,
): PreviewConfig {
  const path = join(repoWorkspacePath(collabSessionId, repoFullName), ".opencode-preview.json")
  if (!existsSync(path)) return FRONTEND_DEFAULTS
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PreviewConfig>
    if (typeof raw.command !== "string" || typeof raw.port !== "number") {
      console.warn(`[collab.preview] ${path} missing required command/port — using defaults`)
      return FRONTEND_DEFAULTS
    }
    if (!Number.isInteger(raw.port) || raw.port < 1024 || raw.port > 65535) {
      console.warn(`[collab.preview] ${path} port=${raw.port} outside 1024-65535 — using defaults`)
      return FRONTEND_DEFAULTS
    }
    let readyPattern: string | undefined = undefined
    if (typeof raw.readyPattern === "string") {
      try {
        new RegExp(raw.readyPattern)
        readyPattern = raw.readyPattern
      } catch (e) {
        console.warn(`[collab.preview] ${path} readyPattern is not a valid regex; ignoring:`, e)
      }
    }
    let upstreamScheme: "http" | "https" = FRONTEND_DEFAULTS.upstreamScheme ?? "http"
    if (raw.upstreamScheme !== undefined) {
      if (raw.upstreamScheme === "http" || raw.upstreamScheme === "https") {
        upstreamScheme = raw.upstreamScheme
      } else {
        console.warn(
          `[collab.preview] ${path} upstreamScheme=${JSON.stringify(raw.upstreamScheme)} ` +
            `is not "http" or "https"; falling back to "${upstreamScheme}"`,
        )
      }
    }
    let servePath: string | undefined = undefined
    if (raw.servePath !== undefined) {
      if (typeof raw.servePath === "string" && raw.servePath.startsWith("/") && raw.servePath !== "/") {
        servePath = raw.servePath
      } else if (raw.servePath !== "" && raw.servePath !== "/") {
        console.warn(
          `[collab.preview] ${path} servePath=${JSON.stringify(raw.servePath)} ` +
            `must be a string starting with "/" (e.g. "/preview/"); ignoring`,
        )
      }
    }
    return {
      command: raw.command,
      port: raw.port,
      label: typeof raw.label === "string" ? raw.label : FRONTEND_DEFAULTS.label,
      installCommand:
        typeof raw.installCommand === "string" ? raw.installCommand : FRONTEND_DEFAULTS.installCommand,
      readyPattern,
      upstreamScheme,
      servePath,
    }
  } catch (err) {
    console.warn(`[collab.preview] ${path} parse failed; using defaults:`, err)
    return FRONTEND_DEFAULTS
  }
}

export function repoHasPreview(collabSessionId: string, repoFullName: string): boolean {
  const dest = repoWorkspacePath(collabSessionId, repoFullName)
  if (!existsSync(dest)) return false
  const name = repoFullName.split("/").pop() ?? repoFullName
  if (name === "frontend") return true
  return existsSync(join(dest, ".opencode-preview.json"))
}

/**
 * Snapshot for SSE / GET state.
 * With sessionId: returns that session's state or null.
 * Without sessionId: returns the first active preview (backward-compat for
 *   the /preview/holder endpoint which wants "any active preview").
 */
export function getPreviewState(sessionId?: string): PreviewStateSnapshot | null {
  if (sessionId !== undefined) {
    const st = active.get(sessionId)
    return st ? makeSnapshot(st) : null
  }
  for (const st of active.values()) {
    return makeSnapshot(st)
  }
  return null
}

/**
 * Bump lastTraffic for a session (or all sessions when sessionId is omitted).
 * Called from preview-router.ts on every proxied HTTP request.
 */
export function markPreviewTraffic(sessionId?: string): void {
  const now = Date.now()
  if (sessionId !== undefined) {
    const st = active.get(sessionId)
    if (st) st.lastTraffic = now
    return
  }
  for (const st of active.values()) {
    st.lastTraffic = now
  }
}

export function getActiveUpstreamScheme(port: number, sessionId?: string): "http" | "https" {
  if (sessionId !== undefined) {
    const st = active.get(sessionId)
    return st ? st._upstreamScheme : "http"
  }
  for (const st of active.values()) {
    if (st.port === port) return st._upstreamScheme
  }
  return "http"
}

export function getActivePreviewPort(sessionId?: string): number | null {
  if (sessionId !== undefined) {
    return active.get(sessionId)?.port ?? null
  }
  for (const st of active.values()) {
    return st.port
  }
  return null
}

export function getActiveServePath(port: number, sessionId?: string): string | null {
  if (sessionId !== undefined) {
    return active.get(sessionId)?._servePath ?? null
  }
  for (const st of active.values()) {
    if (st.port === port) return st._servePath
  }
  return null
}

/** Get the private IP for a session's ECS task (ECS mode), or null (process mode / not running). */
export function getPreviewPrivateIp(sessionId: string): string | null {
  return active.get(sessionId)?.privateIp ?? null
}

export type LaunchResult =
  | { ok: true; state: PreviewStateSnapshot }
  | { ok: false; status: 409; error: string; existing: PreviewStateSnapshot }
  | { ok: false; status: 400 | 404 | 500; error: string }

/**
 * Launch a preview for the given session.
 *
 * ECS mode: spawns an ECS Fargate task; returns immediately with status
 *   "installing".  The task will POST /preview-task/register once it starts.
 *
 * Process mode: spawns a child process inside this container; same behaviour
 *   as before.  Only one process-mode preview per container (first wins).
 */
export function launchPreview(
  collabSessionId: string,
  repoFullName: string,
  gitAccessToken?: string | null,
): LaunchResult {
  // Reject duplicate launches for the same session.
  if (active.has(collabSessionId)) {
    return {
      ok: false,
      status: 409,
      error: `Preview already running for session ${collabSessionId} repo ${repoFullName}.`,
      existing: makeSnapshot(active.get(collabSessionId)!),
    }
  }

  // Process mode: only one preview per container.
  if (!isEcsMode() && active.size > 0) {
    const existing = active.values().next().value as ActiveState
    return {
      ok: false,
      status: 409,
      error: `Preview already running in session ${existing.collabSessionId} for ${existing.repoFullName}.  Ask that session's Driver to stop it first.`,
      existing: makeSnapshot(existing),
    }
  }

  const cwd = repoWorkspacePath(collabSessionId, repoFullName)
  if (!existsSync(cwd)) {
    return { ok: false, status: 404, error: `Workspace for ${repoFullName} not cloned yet.` }
  }

  const config = previewConfigForRepo(collabSessionId, repoFullName)
  const now = Date.now()

  if (isEcsMode()) {
    return launchPreviewEcs(collabSessionId, repoFullName, config, gitAccessToken ?? null, now)
  } else {
    return launchPreviewProcess(collabSessionId, repoFullName, config, gitAccessToken ?? null, cwd, now)
  }
}

// ── ECS launch ─────────────────────────────────────────────────────────────

function launchPreviewEcs(
  collabSessionId: string,
  repoFullName: string,
  config: PreviewConfig,
  gitAccessToken: string | null,
  now: number,
): LaunchResult {
  const state: ActiveState = {
    collabSessionId,
    repoFullName,
    port: 8080, // ECS tasks always bind to port 8080
    label: config.label,
    status: "installing",
    startedAt: now,
    lastTraffic: now,
    _log: [],
    _stopRequested: false,
    _gitAccessToken: gitAccessToken,
    _upstreamScheme: config.upstreamScheme ?? "http",
    _servePath: config.servePath ?? null,
    errorMessage: undefined,
    url: previewUrl(),
    taskArn: null,
    privateIp: null,
    _lastHeartbeat: now,
    _child: null,
    config,
  }
  active.set(collabSessionId, state)

  console.log(
    `[collab.preview] launching ECS task session=${collabSessionId} repo=${repoFullName}`,
  )

  // Fire-and-forget ECS RunTask; the task will register itself on boot.
  void ecsRunTask(collabSessionId, repoFullName, gitAccessToken).then((taskArn) => {
    const st = active.get(collabSessionId)
    if (!st || st !== state) return // stopped before task started
    state.taskArn = taskArn
    console.log(`[collab.preview] ECS task started arn=${taskArn} session=${collabSessionId}`)
  }).catch((err) => {
    const st = active.get(collabSessionId)
    if (!st || st !== state) return
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[collab.preview] ECS RunTask failed for session=${collabSessionId}: ${msg}`)
    active.delete(collabSessionId)
    broadcast(collabSessionId, {
      type: "collab:preview_failed",
      collabSessionId,
      error: `Failed to start ECS task: ${msg}`,
    })
    if (active.size === 0) stopSweepLoop()
  })

  startSweepLoop()
  broadcast(collabSessionId, { type: "collab:preview_started", state: makeSnapshot(state) })
  return { ok: true, state: makeSnapshot(state) }
}

async function ecsRunTask(
  collabSessionId: string,
  repoFullName: string,
  gitAccessToken: string | null,
): Promise<string> {
  const { RunTaskCommand } = await import("@aws-sdk/client-ecs")
  const cluster = process.env.ECS_CLUSTER_ARN!
  const taskDef = process.env.ECS_PREVIEW_TASK_DEFINITION!
  const subnets = (process.env.ECS_PREVIEW_SUBNETS ?? "").split(",").filter(Boolean)
  const sg = process.env.ECS_PREVIEW_SECURITY_GROUP!
  const collabBaseUrl = process.env.COLLAB_BASE_URL ?? ""

  const envOverrides: Array<{ name: string; value: string }> = [
    { name: "COLLAB_SESSION_ID", value: collabSessionId },
    { name: "REPO_FULL_NAME", value: repoFullName },
    { name: "COLLAB_BASE_URL", value: collabBaseUrl },
  ]
  if (gitAccessToken) {
    envOverrides.push({ name: "GITHUB_TOKEN", value: gitAccessToken })
  }

  const client = await getEcsClient()
  const result = await client.send(
    new RunTaskCommand({
      cluster,
      taskDefinition: taskDef,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups: [sg],
          assignPublicIp: "DISABLED",
        },
      },
      overrides: {
        containerOverrides: [{ name: "preview", environment: envOverrides }],
      },
    }),
  )

  const task = result.tasks?.[0]
  if (!task?.taskArn) {
    const failures = result.failures?.map((f) => `${f.reason}: ${f.detail}`).join("; ")
    throw new Error(`ECS RunTask returned no task. Failures: ${failures ?? "unknown"}`)
  }
  return task.taskArn
}

async function ecsStopTask(taskArn: string, collabSessionId: string): Promise<void> {
  try {
    const { StopTaskCommand } = await import("@aws-sdk/client-ecs")
    const client = await getEcsClient()
    await client.send(
      new StopTaskCommand({
        cluster: process.env.ECS_CLUSTER_ARN!,
        task: taskArn,
        reason: `Stopped by collab server for session ${collabSessionId}`,
      }),
    )
  } catch (err) {
    console.warn(`[collab.preview] ecsStopTask failed for ${taskArn}:`, err)
  }
}

// ── ECS task callbacks (called from router.ts) ─────────────────────────────

/**
 * Called when the ECS preview task POSTs to /preview-task/register.
 * Stores the private IP so the proxy can route requests to this task.
 */
export function registerPreviewTask(
  collabSessionId: string,
  privateIp: string,
  taskArn: string,
): void {
  const st = active.get(collabSessionId)
  if (!st) {
    console.warn(
      `[collab.preview] registerPreviewTask: no active preview for session=${collabSessionId} — task may have been stopped before it registered`,
    )
    return
  }
  st.privateIp = privateIp
  if (taskArn && taskArn !== "local") st.taskArn = taskArn
  console.log(
    `[collab.preview] preview task registered session=${collabSessionId} ip=${privateIp} arn=${st.taskArn}`,
  )
  // Don't broadcast an extra "started" event here — we already sent one when
  // the launch began.  The proxy will start working as soon as privateIp is set.
}

/**
 * Called when the ECS preview task POSTs to /preview-task/heartbeat.
 * Resets the install-hang watchdog clock.
 */
export function receiveHeartbeat(collabSessionId: string): void {
  const st = active.get(collabSessionId)
  if (st) st._lastHeartbeat = Date.now()
}

/**
 * Called when the ECS preview task POSTs to /preview-task/log.
 * Stores the log line and detects the "ready" transition.
 */
export function receivePreviewLog(
  collabSessionId: string,
  stream: "stdout" | "stderr",
  line: string,
): void {
  const st = active.get(collabSessionId)
  if (!st) return

  // Every log line resets the heartbeat clock (counts as liveness evidence).
  st._lastHeartbeat = Date.now()

  st._log.push({ stream, line, ts: Date.now() })
  if (st._log.length > LOG_LINES_RETAINED * 2) {
    st._log.splice(0, st._log.length - LOG_LINES_RETAINED)
  }

  console[stream === "stderr" ? "error" : "log"](
    `[collab.preview/${collabSessionId}/${stream}] ${line.slice(0, 1_024)}`,
  )

  // Status transition: "installing" → "running" when ready pattern matches.
  if (st.status === "installing") {
    let ready = false
    try {
      ready =
        (st.config?.readyPattern !== undefined &&
          new RegExp(st.config.readyPattern).test(line)) ||
        /\b(local|ready|listening|started server on)\b/i.test(line)
    } catch {}
    if (ready) {
      st.status = "running"
      void import("./session")
        .then((Session) => Session.clearPreviewCrashCount(collabSessionId))
        .catch((err) => console.warn("[collab.preview] clearPreviewCrashCount failed:", err))
      broadcast(collabSessionId, { type: "collab:preview_started", state: makeSnapshot(st) })
    }
  }

  broadcast(collabSessionId, { type: "collab:preview_log", line: line.slice(0, 2_000), stream })
}

// ── Process launch ─────────────────────────────────────────────────────────

function launchPreviewProcess(
  collabSessionId: string,
  repoFullName: string,
  config: PreviewConfig,
  gitAccessToken: string | null,
  cwd: string,
  now: number,
): LaunchResult {
  const shellCmd = config.installCommand
    ? `${config.installCommand} && ${config.command}`
    : config.command

  console.log(
    `[collab.preview] launching session=${collabSessionId} repo=${repoFullName} ` +
      `port=${config.port} scheme=${config.upstreamScheme ?? "http"} cwd=${cwd}\n` +
      `[collab.preview]   shellCmd: ${shellCmd}`,
  )

  const env: NodeJS.ProcessEnv = { ...process.env, OPENCODE_PREVIEW: "1", PORT: String(config.port) }
  if (gitAccessToken) {
    env.GITHUB_TOKEN = gitAccessToken
  } else {
    delete env.GITHUB_TOKEN
  }

  let child: ChildProcess
  try {
    child = spawn("sh", ["-c", shellCmd], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 500, error: `Failed to spawn dev server: ${msg}` }
  }

  if (!child.pid) {
    return { ok: false, status: 500, error: "Spawned process has no pid (immediate crash?)." }
  }

  const state: ActiveState = {
    collabSessionId,
    repoFullName,
    port: config.port,
    label: config.label,
    status: "installing",
    startedAt: now,
    lastTraffic: now,
    _log: [],
    _lastHeartbeat: now,
    errorMessage: undefined,
    url: previewUrl(),
    _stopRequested: false,
    _gitAccessToken: gitAccessToken,
    _upstreamScheme: config.upstreamScheme ?? "http",
    _servePath: config.servePath ?? null,
    // ECS fields — unused in process mode
    taskArn: null,
    privateIp: null,
    // Process fields
    _child: child,
    config,
  }
  active.set(collabSessionId, state)
  lastKnownHeads.delete(collabSessionId)

  logPreviewCacheState(cwd)
  wireChildStreams(state)
  startSweepLoop()

  broadcast(collabSessionId, { type: "collab:preview_started", state: makeSnapshot(state) })
  return { ok: true, state: makeSnapshot(state) }
}

// ── Stop / restart ─────────────────────────────────────────────────────────

export function stopIfOwnedBySession(collabSessionId: string): void {
  if (active.has(collabSessionId)) {
    stopPreview(collabSessionId, `session ${collabSessionId} deleted`)
  }
}

export function stopPreview(collabSessionId: string, reason: string = "explicit"): void {
  // Cancel any pending restart for this session.
  const pendingTimer = pendingRestarts.get(collabSessionId)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingRestarts.delete(collabSessionId)
  }

  const st = active.get(collabSessionId)
  if (!st) return

  st._stopRequested = true
  active.delete(collabSessionId)
  lastKnownHeads.delete(collabSessionId)

  if (st._child) {
    // Process mode — SIGTERM the group, SIGKILL after 5 s.
    const child = st._child
    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig)
      } catch {
        try { child.kill(sig) } catch {}
      }
    }
    killGroup("SIGTERM")
    const killTimer = setTimeout(() => killGroup("SIGKILL"), 5_000)
    child.once("exit", () => clearTimeout(killTimer))
  } else if (st.taskArn) {
    // ECS mode — StopTask is async; fire-and-forget.
    void ecsStopTask(st.taskArn, collabSessionId)
  }

  console.log(`[collab.preview] stopped (${reason}) for session ${collabSessionId}`)
  if (active.size === 0) stopSweepLoop()

  broadcast(collabSessionId, { type: "collab:preview_stopped", collabSessionId })
}

export function restartPreview(collabSessionId: string): LaunchResult {
  const st = active.get(collabSessionId)
  if (!st) {
    return { ok: false, status: 404, error: "No preview is currently running." }
  }
  const { repoFullName, port, label } = st
  const cachedToken = st._gitAccessToken

  const installing: PreviewStateSnapshot = {
    collabSessionId,
    repoFullName,
    port,
    label,
    status: "installing",
    startedAt: Date.now(),
    lastTraffic: Date.now(),
    recentLog: [],
    url: previewUrl(),
    privateIp: null,
  }

  stopPreview(collabSessionId, "restart")

  const timer = setTimeout(() => {
    pendingRestarts.delete(collabSessionId)
    const result = launchPreview(collabSessionId, repoFullName, cachedToken)
    if (!result.ok) {
      console.error(`[collab.preview] restart relaunch failed: ${result.error}`)
      broadcast(collabSessionId, {
        type: "collab:preview_failed",
        collabSessionId,
        error: result.error,
      })
    }
  }, 100)
  pendingRestarts.set(collabSessionId, timer)

  return { ok: true, state: installing }
}

// ── Branch-change auto-restart (process mode) ──────────────────────────────

export async function maybeRestartOnBranchChange(): Promise<void> {
  // Iterate all process-mode previews in "running" state.
  for (const [sessionId, st] of active.entries()) {
    if (!st._child || st.status !== "running") continue
    const { repoFullName } = st
    try {
      const { readRepoBranch } = await import("./workspace")
      const head = await readRepoBranch(sessionId, repoFullName)
      if (!head) continue
      const prev = lastKnownHeads.get(sessionId)
      if (prev === undefined) {
        lastKnownHeads.set(sessionId, head)
        continue
      }
      if (head !== prev) {
        console.log(`[collab.preview] HEAD changed (${prev} → ${head}) session=${sessionId}; restarting`)
        lastKnownHeads.set(sessionId, head)
        restartPreview(sessionId)
      }
    } catch (err) {
      console.warn(`[collab.preview] HEAD check failed session=${sessionId}:`, err)
    }
  }
}

// ── Internal: process mode wiring ─────────────────────────────────────────

function logPreviewCacheState(cwd: string): void {
  try {
    const cacheDir = join(cwd, ".angular", "cache")
    if (!existsSync(cacheDir)) {
      console.log(`[collab.preview] framework cache: absent at ${cacheDir} (cold compile expected)`)
      return
    }
    const entries = readdirSync(cacheDir)
    const mtime = statSync(cacheDir).mtimeMs
    const ageMin = Math.round((Date.now() - mtime) / 60_000)
    console.log(
      `[collab.preview] framework cache: present (${entries.length} top-level entr${entries.length === 1 ? "y" : "ies"}, last-modified ${ageMin}m ago) — warm compile expected`,
    )
  } catch (err) {
    console.warn("[collab.preview] framework cache probe failed (non-fatal):", err)
  }
}

function wireChildStreams(state: ActiveState): void {
  const child = state._child
  if (!child) return

  const onLine = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
    const currentState = active.get(state.collabSessionId)
    if (currentState !== state) return // replaced by a restart

    state._lastHeartbeat = Date.now()

    const lines = chunk.toString("utf8").split("\n").filter(Boolean)
    for (const line of lines) {
      state._log.push({ stream, line, ts: Date.now() })
      if (state._log.length > LOG_LINES_RETAINED * 2) {
        state._log.splice(0, state._log.length - LOG_LINES_RETAINED)
      }

      const consoleFn = stream === "stderr" ? console.error : console.log
      consoleFn(`[collab.preview/${state.collabSessionId}/${stream}] ${line.slice(0, 1024)}`)

      if (/husky - Git hooks installed/i.test(line)) {
        void import("./workspace").then((Workspace) =>
          Workspace.reinstallCollabHookForRepo(state.collabSessionId, state.repoFullName).then(
            () =>
              console.log(
                `[collab.preview] re-installed prepare-commit-msg hook after husky overwrote it (session=${state.collabSessionId} repo=${state.repoFullName})`,
              ),
          ),
        ).catch((err) => console.warn("[collab.preview] post-husky hook reinstall failed:", err))
      }

      if (state.status === "installing") {
        let ready = false
        try {
          ready =
            (state.config?.readyPattern !== undefined &&
              new RegExp(state.config.readyPattern).test(line)) ||
            /\b(local|ready|listening|started server on)\b/i.test(line)
        } catch (e) {
          console.warn("[collab.preview] readyPattern match threw:", e)
        }
        if (ready) {
          state.status = "running"
          void import("./session")
            .then((Session) => Session.clearPreviewCrashCount(state.collabSessionId))
            .catch((err) => console.warn("[collab.preview] clearPreviewCrashCount failed:", err))
          broadcast(state.collabSessionId, {
            type: "collab:preview_started",
            state: makeSnapshot(state),
          })
        }
      }

      broadcast(state.collabSessionId, {
        type: "collab:preview_log",
        line: line.slice(0, 2000),
        stream,
      })
    }
  }

  child.stdout?.on("data", onLine("stdout"))
  child.stderr?.on("data", onLine("stderr"))

  child.once("exit", (code, signal) => {
    const currentState = active.get(state.collabSessionId)
    if (currentState !== state) return // already replaced
    const wasStopped = state._stopRequested
    console.log(
      `[collab.preview] child exit session=${state.collabSessionId} ` +
        `code=${code} signal=${signal} wasStopped=${wasStopped} status=${state.status}`,
    )

    if (wasStopped) return // stopPreview already handled broadcast + cleanup

    if (code === 0 && signal === null) {
      console.log(`[collab.preview] process exited cleanly on its own for session ${state.collabSessionId}`)
      broadcast(state.collabSessionId, {
        type: "collab:preview_stopped",
        collabSessionId: state.collabSessionId,
      })
      active.delete(state.collabSessionId)
      lastKnownHeads.delete(state.collabSessionId)
      if (active.size === 0) stopSweepLoop()
      return
    }

    const msg = `Preview process exited with code ${code} ${signal ? `(signal ${signal})` : ""}`
    console.error(`[collab.preview] ${msg}`)

    if (state.status === "installing") {
      void import("./session")
        .then((Session) => Session.recordPreviewCrash(state.collabSessionId))
        .catch((err) => console.warn("[collab.preview] recordPreviewCrash failed:", err))
    }

    state.status = "failed"
    state.errorMessage = msg
    broadcast(state.collabSessionId, {
      type: "collab:preview_failed",
      collabSessionId: state.collabSessionId,
      error: msg,
    })
    active.delete(state.collabSessionId)
    lastKnownHeads.delete(state.collabSessionId)
    if (active.size === 0) stopSweepLoop()
  })
}

// ── Internal: memory probe (process mode only) ─────────────────────────────

function readContainerMemoryBytes(): number | null {
  try {
    return Number(readFileSync("/sys/fs/cgroup/memory.current", "utf8").trim())
  } catch {
    return null
  }
}

// ── Internal: sweep loop ───────────────────────────────────────────────────

function startSweepLoop(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    if (active.size === 0) { stopSweepLoop(); return }
    const now = Date.now()

    for (const [sessionId, st] of active.entries()) {
      // 1. Idle cap.
      if (now - st.lastTraffic > IDLE_TIMEOUT_MS) {
        stopPreview(sessionId, `idle ${Math.round(IDLE_TIMEOUT_MS / 60_000)}m`)
        continue
      }

      // 2. Install-hang watchdog: "installing" + no heartbeat/output for too long.
      if (st.status === "installing" && now - st._lastHeartbeat > INSTALL_SILENCE_TIMEOUT_MS) {
        if (st._child) {
          // Process mode: record the crash so the breaker can engage.
          const sid = sessionId
          void import("./session")
            .then((Session) => Session.recordPreviewCrash(sid))
            .catch((err) => console.warn("[collab.preview] recordPreviewCrash (hang) failed:", err))
        }
        stopPreview(
          sessionId,
          `install hung — no ${st._child ? "output" : "heartbeat"} for ${Math.round(INSTALL_SILENCE_TIMEOUT_MS / 60_000)}m`,
        )
        continue
      }

      // 3. Lifetime cap.
      if (now - st.startedAt > MAX_LIFETIME_MS) {
        stopPreview(
          sessionId,
          `lifetime cap ${Math.round(MAX_LIFETIME_MS / 60_000)}m exceeded — Driver can re-Launch`,
        )
        continue
      }

      // 4. Memory circuit-breaker (process mode only; ECS tasks have isolated memory).
      if (st._child) {
        const used = readContainerMemoryBytes()
        if (used !== null && used > MEMORY_CAP_BYTES) {
          const usedMB = Math.round(used / (1024 * 1024))
          const capMB = Math.round(MEMORY_CAP_BYTES / (1024 * 1024))
          stopPreview(sessionId, `memory cap ${capMB}MB exceeded (current ${usedMB}MB)`)
          continue
        }
      }
    }
  }, SWEEP_INTERVAL_MS)
  if (typeof sweepTimer.unref === "function") sweepTimer.unref()
}

function stopSweepLoop(): void {
  if (!sweepTimer) return
  clearInterval(sweepTimer)
  sweepTimer = null
}

// ── Boot resume ────────────────────────────────────────────────────────────

/**
 * Re-spawn previews on container boot.
 *
 * Reads `collab_session.preview_intent` rows.  In ECS mode, each fresh intent
 * launches a new ECS task.  In process mode, only the most-recent eligible
 * intent is resumed (first-launch-wins).  Both modes apply the same freshness
 * cap (24 h) and crash-loop breaker.
 */
export async function resumePreviewsOnBoot(): Promise<void> {
  let session: typeof import("./session")
  try {
    session = await import("./session")
  } catch (err) {
    console.warn("[collab.preview] resumePreviewsOnBoot: session module import failed; skipping:", err)
    return
  }

  let intents: Array<{
    collabSessionId: string
    repoFullName: string
    at: number
    crashCount: number
    crashAt: number
  }>
  try {
    intents = session.listPreviewIntents()
  } catch (err) {
    console.warn("[collab.preview] resumePreviewsOnBoot: listPreviewIntents threw; skipping:", err)
    return
  }
  if (intents.length === 0) return

  const MAX_INTENT_AGE_MS = 24 * 60 * 60 * 1000
  const now = Date.now()

  // Partition into stale / fresh.
  const stale: typeof intents = []
  const fresh: typeof intents = []
  for (const i of intents) {
    if (now - i.at > MAX_INTENT_AGE_MS) stale.push(i)
    else fresh.push(i)
  }
  if (stale.length > 0) {
    console.log(`[collab.preview] resumePreviewsOnBoot: ${stale.length} stale intent(s) — clearing`)
    for (const s of stale) {
      try { session.setPreviewIntent(s.collabSessionId, null) } catch {}
    }
  }
  if (fresh.length === 0) return

  // Apply crash-loop breaker.
  const eligible = fresh.filter((i) => {
    const recentlyTripped = i.crashAt > 0 && now - i.crashAt < BREAKER_WINDOW_MS
    if (i.crashCount >= BREAKER_CRASH_THRESHOLD && recentlyTripped) {
      console.warn(
        `[collab.preview] resumePreviewsOnBoot: session=${i.collabSessionId} skipped — crash-loop breaker (${i.crashCount} crashes). Driver must Launch manually.`,
      )
      return false
    }
    return true
  })
  if (eligible.length === 0) return

  // In process mode, only one preview per container.
  const toResume = isEcsMode() ? eligible : [eligible[0]!]

  console.log(
    `[collab.preview] resumePreviewsOnBoot: resuming ${toResume.length} intent(s) (${isEcsMode() ? "ECS" : "process"} mode)`,
  )

  const cookieAuth = await import("./cookie-auth").catch(() => null)

  for (const pick of toResume) {
    let gitAccessToken: string | null = null
    try {
      const cs = session.getCollabSession(pick.collabSessionId)
      if (cs && cookieAuth) {
        gitAccessToken = cookieAuth.latestAccessTokenForGithubId(cs.ownerGithubId)
      }
    } catch {}

    let result: LaunchResult
    try {
      result = launchPreview(pick.collabSessionId, pick.repoFullName, gitAccessToken)
    } catch (err) {
      console.error(`[collab.preview] resumePreviewsOnBoot: launchPreview threw session=${pick.collabSessionId}:`, err)
      continue
    }

    if (!result.ok) {
      console.warn(
        `[collab.preview] resumePreviewsOnBoot: launchPreview status=${result.status} "${result.error}" session=${pick.collabSessionId}`,
      )
      continue
    }
    console.log(
      `[collab.preview] resumePreviewsOnBoot: re-spawned session=${pick.collabSessionId} port=${result.state.port}`,
    )
  }
}
