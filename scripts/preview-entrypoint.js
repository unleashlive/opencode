#!/usr/bin/env node
/**
 * ECS preview task entrypoint.
 *
 * On startup:
 *   1. Fetch task's private IP from ECS task metadata v4
 *   2. Register with collab server (POST /collab/preview-task/register) — retries 5×
 *   3. Start heartbeat loop (POST /collab/preview-task/heartbeat every 60 s)
 *   4. cd into the session workspace
 *   5. Read .opencode-preview.json for install + start commands (defaults: pnpm i && pnpm run start)
 *   6. Run the commands, piping each stdout/stderr line to POST /collab/preview-task/log
 *
 * Required env vars (injected by ECS container overrides):
 *   COLLAB_SESSION_ID   — collab session this task serves
 *   REPO_FULL_NAME      — e.g. "unleashlive/frontend"
 *   COLLAB_BASE_URL     — e.g. "https://collab.utils.unleashlive.com"
 *
 * Optional:
 *   GITHUB_TOKEN        — OAuth token for private git+https deps
 *   WORKSPACE_ROOT      — default /var/opencode/workspaces
 */

"use strict"

const { spawn } = require("child_process")
const fs = require("fs")
const http = require("http")
const https = require("https")
const path = require("path")

// ── Env ──────────────────────────────────────────────────────────────────────

const SESSION_ID = process.env.COLLAB_SESSION_ID
const REPO_FULL_NAME = process.env.REPO_FULL_NAME
const COLLAB_BASE_URL = (process.env.COLLAB_BASE_URL ?? "").replace(/\/$/, "")
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "/var/opencode/workspaces"

if (!SESSION_ID || !REPO_FULL_NAME || !COLLAB_BASE_URL) {
  console.error("[preview] FATAL: missing required env vars: COLLAB_SESSION_ID, REPO_FULL_NAME, COLLAB_BASE_URL")
  process.exit(1)
}

const WORKSPACE_DIR = path.join(WORKSPACE_ROOT, SESSION_ID, REPO_FULL_NAME)

// ── HTTP helper ───────────────────────────────────────────────────────────────

function post(url, body, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const mod = u.protocol === "https:" ? https : http
    const data = JSON.stringify(body)
    const timer = setTimeout(() => reject(new Error("request timed out")), timeoutMs)
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        clearTimeout(timer)
        let buf = ""
        res.on("data", (c) => (buf += c))
        res.on("end", () => resolve({ status: res.statusCode, body: buf }))
      },
    )
    req.on("error", (err) => { clearTimeout(timer); reject(err) })
    req.write(data)
    req.end()
  })
}

// ── ECS metadata ─────────────────────────────────────────────────────────────

async function getPrivateIp() {
  const metaUri = process.env.ECS_CONTAINER_METADATA_URI_V4
  if (!metaUri) {
    console.warn("[preview] ECS_CONTAINER_METADATA_URI_V4 not set — using 127.0.0.1 (local dev?)")
    return "127.0.0.1"
  }
  return new Promise((resolve) => {
    const req = http.get(`${metaUri}/task`, (res) => {
      let buf = ""
      res.on("data", (c) => (buf += c))
      res.on("end", () => {
        try {
          const meta = JSON.parse(buf)
          for (const container of meta.Containers ?? []) {
            for (const net of container.Networks ?? []) {
              const ip = (net.IPv4Addresses ?? [])[0]
              if (ip) { resolve(ip); return }
            }
          }
        } catch {}
        console.warn("[preview] could not parse ECS task metadata; using 127.0.0.1")
        resolve("127.0.0.1")
      })
    })
    req.on("error", () => {
      console.warn("[preview] ECS metadata fetch failed; using 127.0.0.1")
      resolve("127.0.0.1")
    })
    req.setTimeout(5_000, () => {
      req.destroy()
      console.warn("[preview] ECS metadata timed out; using 127.0.0.1")
      resolve("127.0.0.1")
    })
  })
}

// ── Register with collab server ───────────────────────────────────────────────

async function register(privateIp, taskArn) {
  const body = { collabSessionId: SESSION_ID, privateIp, taskArn }
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await post(`${COLLAB_BASE_URL}/collab/preview-task/register`, body)
      if (res.status === 200) {
        console.log(`[preview] registered with collab server (ip=${privateIp} taskArn=${taskArn})`)
        return true
      }
      console.warn(`[preview] register attempt ${attempt}/5 → HTTP ${res.status}: ${res.body}`)
    } catch (err) {
      console.warn(`[preview] register attempt ${attempt}/5 failed: ${err.message}`)
    }
    // Exponential back-off: 2s, 4s, 6s, 8s
    await new Promise((r) => setTimeout(r, 2_000 * attempt))
  }
  return false
}

// ── Heartbeat loop ────────────────────────────────────────────────────────────

function startHeartbeat() {
  const interval = setInterval(async () => {
    try {
      await post(`${COLLAB_BASE_URL}/collab/preview-task/heartbeat`, { collabSessionId: SESSION_ID })
    } catch (err) {
      // Heartbeat failures are non-fatal — the sweep loop on the collab
      // server will detect the silence and stop the task if needed.
      console.warn(`[preview] heartbeat failed: ${err.message}`)
    }
  }, 60_000)
  if (typeof interval.unref === "function") interval.unref()
  return interval
}

// ── Log forwarding ────────────────────────────────────────────────────────────

async function postLog(stream, line) {
  try {
    await post(
      `${COLLAB_BASE_URL}/collab/preview-task/log`,
      { collabSessionId: SESSION_ID, stream, line: line.slice(0, 2_000) },
      5_000,
    )
  } catch {
    // Non-fatal — line is already on stdout/stderr for CloudWatch.
  }
}

// ── Resolve dev-server command ────────────────────────────────────────────────

function resolveCommand() {
  const defaults = { install: "pnpm i --shamefully-hoist=true", start: "pnpm run start" }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(WORKSPACE_DIR, ".opencode-preview.json"), "utf8"))
    const start = typeof raw.command === "string" ? raw.command : defaults.start
    const install = raw.installCommand === undefined
      ? defaults.install
      : (typeof raw.installCommand === "string" ? raw.installCommand : "")
    return install ? `${install} && ${start}` : start
  } catch {
    return `${defaults.install} && ${defaults.start}`
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Private IP + task ARN
  const privateIp = await getPrivateIp()
  const taskArn = process.env.ECS_CONTAINER_METADATA_URI_V4 ?? "local"

  // 2. Register
  const ok = await register(privateIp, taskArn)
  if (!ok) {
    console.error("[preview] could not register after 5 attempts — exiting")
    process.exit(1)
  }

  // 3. Heartbeat
  startHeartbeat()

  // 4. cd into workspace
  if (!fs.existsSync(WORKSPACE_DIR)) {
    console.error(`[preview] workspace not found: ${WORKSPACE_DIR}`)
    process.exit(1)
  }
  process.chdir(WORKSPACE_DIR)

  // 5. Resolve command
  const cmd = resolveCommand()
  console.log(`[preview] launching: ${cmd}`)
  console.log(`[preview] cwd: ${WORKSPACE_DIR}`)

  // 6. Spawn
  const env = { ...process.env, PORT: "8080", OPENCODE_PREVIEW: "1" }
  if (GITHUB_TOKEN) {
    env.GITHUB_TOKEN = GITHUB_TOKEN
  } else {
    delete env.GITHUB_TOKEN
  }

  const child = spawn("sh", ["-c", cmd], {
    cwd: WORKSPACE_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })

  const onLine = (stream) => (chunk) => {
    const lines = chunk.toString("utf8").split("\n").filter(Boolean)
    for (const line of lines) {
      const fn = stream === "stderr" ? console.error : console.log
      fn(`[preview/${stream}] ${line.slice(0, 1_024)}`)
      postLog(stream, line) // fire-and-forget
    }
  }

  child.stdout.on("data", onLine("stdout"))
  child.stderr.on("data", onLine("stderr"))

  child.once("exit", (code, signal) => {
    console.log(`[preview] child exited code=${code} signal=${signal}`)
    process.exit(code ?? 1)
  })

  // Forward signals to the child process group
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      console.log(`[preview] received ${sig} — forwarding to child`)
      try {
        if (child.pid) process.kill(-child.pid, sig)
      } catch {
        try { child.kill(sig) } catch {}
      }
    })
  }
}

main().catch((err) => {
  console.error("[preview] fatal:", err)
  process.exit(1)
})
