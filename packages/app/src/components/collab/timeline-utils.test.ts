import { describe, expect, test } from "bun:test"
import {
  bucketMeta,
  clockTime,
  dayKey,
  dayLabel,
  groupTimeline,
  hourKey,
  hourLabel,
  openByDefault,
  type TimelineEvent,
} from "./timeline-utils"

/** Local-time constructor so the tests read the same clock the utils do. */
function at(day: number, hour: number, minute = 0): number {
  return new Date(2026, 7, day, hour, minute, 0, 0).getTime()
}

function prompt(id: string, when: number): TimelineEvent {
  return { id, kind: "prompt", at: when, author: "alice", content: `prompt ${id}` }
}

function action(id: string, when: number): TimelineEvent {
  return { id, kind: "action", at: when, author: null, content: `action ${id}` }
}

const NOW = at(17, 14, 30)

describe("keys and labels", () => {
  test("day and hour keys are zero padded local dates", () => {
    expect(dayKey(at(7, 9))).toBe("2026-08-07")
    expect(hourKey(at(7, 9))).toBe("2026-08-07T09")
    expect(hourLabel(at(7, 9))).toBe("09:00")
    expect(clockTime(at(7, 9, 5))).toBe("09:05")
  })

  test("day labels name today and yesterday, then fall back to the date", () => {
    expect(dayLabel(at(17, 2), NOW)).toBe("Today · 17 Aug")
    expect(dayLabel(at(16, 23), NOW)).toBe("Yesterday · 16 Aug")
    expect(dayLabel(at(15, 23), NOW)).toBe("15 Aug")
  })

  test("bucket meta drops the empty side", () => {
    expect(bucketMeta({ promptCount: 3, actionCount: 1 })).toBe("3 prompts · 1 action")
    expect(bucketMeta({ promptCount: 1, actionCount: 0 })).toBe("1 prompt")
    expect(bucketMeta({ promptCount: 0, actionCount: 2 })).toBe("2 actions")
  })
})

describe("groupTimeline", () => {
  test("groups by day then hour, newest first at every level", () => {
    const days = groupTimeline(
      [prompt("a", at(15, 9)), prompt("b", at(17, 9, 10)), action("c", at(17, 14, 1)), prompt("d", at(17, 14, 20))],
      NOW,
    )

    expect(days.map((d) => d.key)).toEqual(["2026-08-17", "2026-08-15"])
    expect(days[0]!.label).toBe("Today · 17 Aug")
    expect(days[0]!.count).toBe(3)
    expect(days[0]!.hours.map((h) => h.label)).toEqual(["14:00", "09:00"])
    // Newest event first inside the bucket.
    expect(days[0]!.hours[0]!.events.map((e) => e.id)).toEqual(["d", "c"])
  })

  test("counts prompts and actions per hour bucket", () => {
    const days = groupTimeline([prompt("a", at(17, 14)), action("b", at(17, 14, 5)), action("c", at(17, 14, 9))], NOW)
    const bucket = days[0]!.hours[0]!
    expect(bucket.promptCount).toBe(1)
    expect(bucket.actionCount).toBe(2)
    expect(bucketMeta(bucket)).toBe("1 prompt · 2 actions")
  })

  test("drops duplicate ids, keeping the first occurrence", () => {
    const days = groupTimeline([prompt("a", at(17, 14)), { ...prompt("a", at(17, 14)), content: "later copy" }], NOW)
    expect(days[0]!.count).toBe(1)
    expect(days[0]!.hours[0]!.events[0]!.content).toBe("prompt a")
  })

  test("returns nothing for an empty feed", () => {
    expect(groupTimeline([], NOW)).toEqual([])
  })
})

test("openByDefault points at the current day and hour", () => {
  expect(openByDefault(NOW)).toEqual({ day: "2026-08-17", hour: "2026-08-17T14" })
})
