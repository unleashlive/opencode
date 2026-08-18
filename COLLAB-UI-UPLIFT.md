# Collab UI Uplift (SKU-1)

Execution plan for the approved redesign of the Collab surfaces. Design review and
prototype signed off 17 Aug 2026. Linear: SKU-1 in project "Unleash Live Collab" (team Skunkworks).
Work branch: `hojae-collab-ui-uplift`. Approved prototype:
https://claude.ai/code/artifact/456c4fe3-c4e4-4fa5-8b19-a8d7746addc4

## Direction (locked)

One blended direction: the host opencode design system's discipline, a cobalt accent,
monospace for machine truth, warmth in the human areas. Concretely:

- Build ON the host semantic tokens (`packages/ui/src/styles/theme.css`,
  Tailwind bridge in `packages/ui/src/styles/tailwind/`). No stock-Tailwind numeric
  colors, no forced dark, no gradients.
- Collab-specific tokens live in one file (`packages/app/src/components/collab/collab.css`)
  keyed to the host theme mechanism, light and dark both:
  - accent: `#4D6AE3` light / `#7E8DFF` dark, with soft (10-14% alpha) and line (35-40%) variants
  - success/warn/error come from host intent tokens, never raw hex
  - machine text (branches, timestamps, counts, diffstats, ids): host mono stack, 10-11px
- One primary action per view (near-black light / near-white dark, host button style).
  Everything else ghost or overflow. Focus-visible ring and motion-reduce guards on all
  interactive recipes.
- Type scale: 13px chrome, 12px secondary, 11px labels (600, uppercase, 0.06em),
  10-10.5px mono meta. Weights 400/500/600 only.

## Session page IA (locked)

Three dedicated surfaces replace the single mixed sidebar:

1. **Top bar (47px)**: Collab badge, session name, repo+branch mono chips, then right:
   participant avatar stack with presence, online count, Invite, theme toggle,
   overflow menu (Compact context, Configure MCP, Export session, Admin).
2. **Timeline rail (~300px, left)**: the audit trail. Every prompt and action is an
   event with author avatar, name, kind chip (prompt/action), and mono time.
   Grouped by day, then hour buckets, both collapsible with counts. Pending queue
   pinned above history in an accent-soft card (Approve/Reject as text actions for
   Drivers, vote for contributors). Filter chips: All / Prompts / Actions.
3. **Agent stage (center)**: the embedded editor (iframe) with a persistent status
   strip above it: live dot + agent state, current activity, elapsed mono, running
   diffstat (+adds in success color, -dels in error color, file count), then the work
   actions: Open pull request (ghost), Launch live preview (primary).
   Preview lifecycle states (installing/running/failed) render inside the strip
   area as quiet tinted rows, not stacked banners.
4. **Team chat rail (~296px, right)**: dedicated chat: day dividers, author+time rows,
   accent mention pills, typing line, composer with mono hint. Collapsible.

Mobile: three tabs (Timeline / Editor / Chat).

## Landing page IA (locked)

- Top bar: badge + wordmark, right: theme toggle + identity.
- Hero copy: "Code together with a shared agent" + one line on roles.
- Grid: create-form card (name input, repositories as chip-select with check state,
  branch input with mono placeholder + helper, two segmented controls: Queue mode
  FIFO/Vote pool and Typing visibility Live/On submit, full-width primary CTA) and
  a Rejoin card (sessions grouped Today / This week / Earlier, collapsible, rows with
  avatar stack, name, repo + mode mono chips, relative mono time).
- Credentials: one quiet status line with a dot (ok/warn) and a Replace action,
  not a banner. The paste flow opens from there.

## Execution steps

Each step is one agent run, sequential (same branch, same working tree), verified in
the local dev env before the next starts. Commits are small and scoped; every commit
message body references SKU-1.

- **S1 cleanup** (no design changes): delete the four never-imported components
  (ParticipantList, PromptQueuePanel, CollabPromptInput, CollabBadge); fix invented
  token names in dialog-connect-provider.tsx and prompt-input.tsx; give
  pages/collab/admin.tsx its missing stylesheet using host tokens.
- **S2 foundation**: create collab.css (tokens above); rewrite
  components/collab/ui.ts as token-based recipes (primary/ghost/icon buttons, chips,
  labels, role tags, avatars, rails) with focus + motion-reduce built in; add the
  theme toggle wired to the host ThemeProvider; single shared renderMentions.
- **S3 session IA**: restructure pages/collab/session.tsx to the layout above.
  Timeline assembles from existing client data (queue items across statuses, session
  events, preview/PR state). No server schema changes in this pass; gaps get noted,
  not invented.
- **S4 landing + dialogs**: restructure pages/collab/new.tsx; replace the five
  hand-rolled modals with the host Kobalte Dialog; remove the stock-palette
  re-injection from packages/app/src/index.css once nothing references it; sweep
  remaining zinc classes; contrast and touch-target pass.

## S3 data gaps (found, not invented)

The timeline and the status strip render only what the client can already get.
These are the gaps that showed up while building them. None are worked around
in the UI; each needs server work in a later pass.

- **No prompt-history endpoint.** `GET /collab/session/:id/queue` and the
  `collab:queue_update` event both return `collabDb.getPendingPool()`, i.e. only
  rows with `status = 'pending'`. The rail therefore reads history from
  `GET /collab/session/:id/export` (`getAllSuggestionsForSession`, all statuses,
  ordered by `collab_suggestion.created_at`). That endpoint is unpaginated and
  returns whole prompt bodies, so it is a one-shot fetch per page load, not a
  poll. A paginated `/history` would replace it.
- **No action history.** Joins, role changes, approvals, vote resolutions,
  workspace ready/failed, repo adds and preview lifecycle exist only as
  transient SSE events. Nothing persists them and no endpoint replays them, so
  the timeline's action track is in-memory and starts empty after a reload.
- **No timestamps on SSE events.** `CollabEvent` carries no `at` field, so
  action rows are stamped with client receive time. Two participants can
  therefore show slightly different clocks for the same action.
- **No turn-completion signal.** `collab:prompt_submitted` is broadcast just
  before `prompt_async` is awaited and nothing is broadcast when the turn ends
  (`registerQueueExecutor` in `collab/router.ts`). The client cannot tell
  whether the agent is working, so the status strip shows SSE connection state
  instead of the busy/idle dot in the locked IA.
- **No elapsed time or diffstat.** The locked strip calls for elapsed turn time
  and a running `+adds / -dels / files` count. Neither exists on the collab
  wire: no turn start/end timestamps, and no diff summary is broadcast from the
  workspace. Both were left out rather than approximated.
- **Suggestion status transitions are not timestamped.** `collab_suggestion`
  has `created_at` only, so a prompt is placed on the timeline at authoring
  time, not at approval or dispatch time.

## S4 decisions (made, not deferred)

- **Dialogs use the host shell, not a replacement.** `components/collab/CollabDialog.tsx`
  composes the Kobalte root, its portal and overlay, and `<Dialog>` from
  packages/ui, which is exactly the markup `DialogProvider` renders. The
  imperative `useDialog().show()` API was not used because the collab pages own
  the open state themselves and the session page reads those same signals to
  hide the editor iframe while a dialog is up. All five hand-rolled modals and
  both `confirm()` / `alert()` pairs are on it, and no inline z-index remains.
- **dialog.css overlay: reverted to upstream.** The fully opaque backdrop was a
  project-wide change made to match the collab modals' own backdrops. Those
  modals are gone and the collab dialogs read fine on the translucent overlay,
  so the shared file goes back to `hsl(from var(--background-base) h s l / 0.2)`.
- **session.tsx resize range: kept.** The page also renders inside the collab
  iframe, where `window.innerWidth` is the iframe's. The stage is roughly the
  viewport minus the two rails, so upstream's max of 45vw lands below its own
  450px min and the handle has no usable range. The reason is now in the code.
- **Stock-palette re-injection: removed.** Only the collab accent bridge remains
  in `packages/app/src/index.css`. A source grep over packages/app and
  packages/ui finds no numeric colour class left, and a Tailwind build confirms
  the collab utilities still emit while no palette utility does.

## Verification

Local dev (see .env.example; unauthenticated local mode + seeded dev cookie):
opencode server on :4096, vite app on :3000 with the /collab dev proxy.
Check each step in both themes before moving on. Screenshots accompany each
step's review.

## Constraints

- Never push or merge to `collab` or upstream branches; only `hojae-collab-ui-uplift`.
- No AI attribution in commits, PRs, or content.
- Two shared-package edits from the original collab branch (dialog overlay opacity in
  packages/ui/src/components/dialog.css, resize range in pages/session.tsx) get
  reviewed in S4: keep only if collab still needs them after migration.
- No em dashes in UI copy.
