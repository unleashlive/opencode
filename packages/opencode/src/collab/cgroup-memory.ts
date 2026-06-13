/**
 * Container memory introspection via the cgroups v2 interface that AWS
 * Fargate (platform version 1.4+) exposes at /sys/fs/cgroup/memory.current.
 *
 * The value is the WHOLE container's current memory usage in bytes —
 * opencode + any spawned preview dev-server + everything else in the task.
 * That's exactly the figure the kernel OOM-killer accounts against, so it's
 * the right number to watch when the goal is "stop gracefully BEFORE the
 * kernel takes the whole task down."
 *
 * Returns null on platforms where the file isn't present (macOS dev, older
 * kernels, cgroups v1) — callers treat null as "skip the memory check".
 *
 * NOTE: preview-launcher.ts carries a private copy of this read for its own
 * 12 GB preview memory cap (shipped in PR #34, before this util existed).
 * Consolidating the two onto this shared util is a deferred cleanup — kept
 * separate for now so this telemetry PR doesn't conflict with the in-flight
 * preview-launcher hardening PR.  Both read the same file; no behavioural
 * difference.
 */
import { readFileSync } from "fs"

/** Total container RSS in bytes, or null when the cgroup file is unreadable. */
export function readContainerMemoryBytes(): number | null {
  try {
    const raw = readFileSync("/sys/fs/cgroup/memory.current", "utf8").trim()
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** Soft warning threshold — leading indicator logged before the kernel
 *  OOM-killer's hard ceiling (16 GB task).  13 GB leaves ~3 GB of headroom;
 *  crossing it means something (a preview compile, a runaway plugin, SSE
 *  broadcaster accumulation) is trending toward the danger zone and is worth
 *  a CloudWatch breadcrumb so an operator can correlate it with a later OOM. */
const MEMORY_WARN_BYTES = 13 * 1024 * 1024 * 1024

/** How often the monitor samples.  60 s matches the preview sweep cadence;
 *  memory pressure builds over minutes, not milliseconds. */
const MONITOR_INTERVAL_MS = 60 * 1000

/**
 * Start a best-effort background monitor that logs a WARNING whenever total
 * container RSS crosses MEMORY_WARN_BYTES, and an INFO line when it recovers
 * back below.  Pure telemetry — it never kills anything (the preview memory
 * cap in preview-launcher.ts is the actor; this is the leading indicator for
 * the WHOLE task, including opencode itself).
 *
 * Returns a stop function; the interval is unref'd so it never keeps the
 * event loop alive on shutdown.  No-ops (logs once) on platforms without the
 * cgroup file so non-Linux dev doesn't spam.
 */
export function startMemoryMonitor(): () => void {
  if (readContainerMemoryBytes() === null) {
    console.log("[collab.memory] cgroup memory file unavailable — RSS monitor disabled (non-Linux/cgroups-v1)")
    return () => {}
  }

  let warned = false
  const timer = setInterval(() => {
    const used = readContainerMemoryBytes()
    if (used === null) return
    const usedMB = Math.round(used / (1024 * 1024))
    const warnMB = Math.round(MEMORY_WARN_BYTES / (1024 * 1024))
    if (used > MEMORY_WARN_BYTES) {
      if (!warned) {
        warned = true
        console.warn(
          `[collab.memory] WARNING container RSS ${usedMB}MB crossed ${warnMB}MB — ` +
            `approaching the 16 GB task ceiling; watch for OOM. Leading indicator only.`,
        )
      }
    } else if (warned) {
      warned = false
      console.log(`[collab.memory] container RSS recovered to ${usedMB}MB (below ${warnMB}MB)`)
    }
  }, MONITOR_INTERVAL_MS)
  if (typeof timer.unref === "function") timer.unref()
  return () => clearInterval(timer)
}
