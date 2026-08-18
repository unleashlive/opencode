/**
 * Timeline grouping for the Collab session rail (SKU-1).
 *
 * Pure functions, no Solid and no DOM, so the rail component stays a thin
 * renderer and the bucketing rules are testable on their own
 * (./timeline-utils.test.ts).
 *
 * The rail shows an audit trail: every prompt and every session action as one
 * event, newest first, grouped by day and then by hour bucket. Both levels
 * carry counts and collapse independently.
 *
 * Month names are spelled out here rather than taken from Intl so the labels
 * are stable across locales and across test machines.
 */

export type TimelineKind = "prompt" | "action"

/** One row in the timeline. */
export interface TimelineEvent {
  /** Stable across re-renders: suggestion id, or a per-page activity id. */
  id: string
  kind: TimelineKind
  /** Epoch milliseconds. */
  at: number
  /** GitHub login, or null for events the server performed on its own. */
  author: string | null
  /** Body text, clamped to two lines by the renderer. */
  content: string
  /** Optional mono meta (agent, model, status) shown beside the author. */
  meta?: string
}

/** Events that fall inside one clock hour of one day. */
export interface TimelineHour {
  /** `2026-08-17T14` — unique across the whole timeline. */
  key: string
  /** `14:00` */
  label: string
  promptCount: number
  actionCount: number
  events: TimelineEvent[]
}

/** Every hour bucket of one calendar day. */
export interface TimelineDay {
  /** `2026-08-17` */
  key: string
  /** `Today · 17 Aug` / `Yesterday · 16 Aug` / `15 Aug` */
  label: string
  /** Total events across the day's hour buckets. */
  count: number
  hours: TimelineHour[]
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Local-time calendar day key, `YYYY-MM-DD`. */
export function dayKey(at: number | Date): string {
  const d = at instanceof Date ? at : new Date(at)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Local-time hour key, `YYYY-MM-DDTHH`. */
export function hourKey(at: number | Date): string {
  const d = at instanceof Date ? at : new Date(at)
  return `${dayKey(d)}T${pad2(d.getHours())}`
}

/** `14:00` — the label on an hour bucket header. */
export function hourLabel(at: number | Date): string {
  const d = at instanceof Date ? at : new Date(at)
  return `${pad2(d.getHours())}:00`
}

/** `14:32` — the mono timestamp on an event row. */
export function clockTime(at: number | Date): string {
  const d = at instanceof Date ? at : new Date(at)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * `Today · 17 Aug` for the current day, `Yesterday · 16 Aug` for the one
 * before, `15 Aug` for anything older.
 *
 * Yesterday is derived by stepping the date component rather than
 * subtracting 24h, so a daylight-saving boundary can't fold two days into one.
 */
export function dayLabel(at: number | Date, now: number | Date): string {
  const d = at instanceof Date ? at : new Date(at)
  const stamp = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  const key = dayKey(d)
  const nowDate = now instanceof Date ? new Date(now.getTime()) : new Date(now)
  if (key === dayKey(nowDate)) return `Today · ${stamp}`
  const yesterday = new Date(nowDate.getTime())
  yesterday.setDate(yesterday.getDate() - 1)
  if (key === dayKey(yesterday)) return `Yesterday · ${stamp}`
  return stamp
}

/** `3 prompts · 1 action`, skipping whichever side is zero. */
export function bucketMeta(bucket: { promptCount: number; actionCount: number }): string {
  const parts: string[] = []
  if (bucket.promptCount > 0) parts.push(`${bucket.promptCount} ${bucket.promptCount === 1 ? "prompt" : "prompts"}`)
  if (bucket.actionCount > 0) parts.push(`${bucket.actionCount} ${bucket.actionCount === 1 ? "action" : "actions"}`)
  return parts.join(" · ")
}

/**
 * Bucket events into days and hours, newest first at every level.
 *
 * Duplicate ids are dropped (the same prompt can arrive both from the history
 * fetch and from the live SSE stream); the first occurrence wins.
 */
export function groupTimeline(events: readonly TimelineEvent[], now: number | Date): TimelineDay[] {
  const seen = new Set<string>()
  const unique: TimelineEvent[] = []
  for (const e of events) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    unique.push(e)
  }
  unique.sort((a, b) => b.at - a.at)

  const days: TimelineDay[] = []
  let day: TimelineDay | undefined
  let hour: TimelineHour | undefined

  for (const e of unique) {
    const dk = dayKey(e.at)
    if (!day || day.key !== dk) {
      day = { key: dk, label: dayLabel(e.at, now), count: 0, hours: [] }
      days.push(day)
      hour = undefined
    }
    const hk = hourKey(e.at)
    if (!hour || hour.key !== hk) {
      hour = { key: hk, label: hourLabel(e.at), promptCount: 0, actionCount: 0, events: [] }
      day.hours.push(hour)
    }
    hour.events.push(e)
    if (e.kind === "prompt") hour.promptCount++
    else hour.actionCount++
    day.count++
  }

  return days
}

/**
 * The day and hour bucket that start expanded: whatever is happening now.
 * Everything else collapses so a long session opens as a short list.
 */
export function openByDefault(now: number | Date): { day: string; hour: string } {
  return { day: dayKey(now), hour: hourKey(now) }
}
