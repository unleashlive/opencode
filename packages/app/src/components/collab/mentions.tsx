/**
 * Shared @-mention rendering for the Collab UI (ENG-1).
 *
 * One implementation for both the prompt queue (pages/collab/session.tsx) and
 * the team notes feed (./TeamNoteComposer.tsx), which previously carried
 * byte-identical copies styled with inline rgba/hex. The pill now uses the
 * collab accent tokens so it follows the theme.
 */

import type { JSX } from "solid-js"

/** Match GitHub-style @-mentions (1-39 chars from [A-Za-z0-9-], start with
 *  alnum).  Mirrors the server-side MENTION_RE in mentions.ts. */
const MENTION_RE = /(^|\s)(@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g

/** Render free-text content with @-mentions highlighted as inline pills. */
export function renderMentions(text: string): Array<string | JSX.Element> {
  const parts: Array<string | { mention: string }> = []
  let lastIndex = 0
  MENTION_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MENTION_RE.exec(text)) !== null) {
    const start = m.index + m[1]!.length // skip the leading whitespace/start
    if (start > lastIndex) parts.push(text.slice(lastIndex, start))
    parts.push({ mention: m[2]! })
    lastIndex = MENTION_RE.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.map((p) =>
    typeof p === "string" ? (
      p
    ) : (
      <span class="inline-block rounded px-1 font-medium bg-collab-accent-soft text-collab-accent">{p.mention}</span>
    ),
  )
}
