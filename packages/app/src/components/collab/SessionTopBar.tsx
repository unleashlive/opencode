/**
 * Session top bar for /collab/:id (SKU-1).
 *
 * Identity on the left, people and controls on the right, everything else in
 * one overflow menu. Replaces the header, identity strip, participants list and
 * repos block that used to stack down the old mixed sidebar.
 *
 * The menu is a hand-rolled popover on host tokens (S4 migrates the collab
 * surfaces to the host Kobalte primitives). It closes on outside click and on
 * Escape, and it reports its open state upward so the page can hide the editor
 * iframe while it is open: iframes render in their own composited layer and can
 * paint over an absolutely positioned panel no matter what z-index it carries.
 */

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import type { CollabRole } from "@opencode-ai/collab"
import { BTN_GHOST, BTN_ICON, CHIP, ROLE_TEXT_CLASS } from "./ui"
import { BrandMark } from "./BrandMark"
import { ThemeToggle } from "./ThemeToggle"

/** How many avatars fit before the stack collapses into a +N chip. */
const AVATAR_LIMIT = 5

function roleLabel(role: CollabRole) {
  return role === "driver" ? "Driver" : role === "contributor" ? "Contributor" : "Viewer"
}

export function SessionTopBar(props: {
  myRole: CollabRole
  menuOpen: () => boolean
  setMenuOpen: (open: boolean) => void
  onInvite: () => void
  onTutorial: () => void
  onMcpConfig: () => void
  onAddRepo: () => void
  onManageParticipants: () => void
}) {
  const collab = useCollab()

  const participants = () => collab.participants()
  const ordered = () => [...participants()].sort((a, b) => Number(b.isOnline) - Number(a.isOnline))
  const shown = () => ordered().slice(0, AVATAR_LIMIT)
  const overflowCount = () => Math.max(0, participants().length - AVATAR_LIMIT)
  const onlineCount = () => participants().filter((p) => p.isOnline).length

  const repos = () => collab.session()?.repos ?? []
  const primaryRepo = () => repos()[0] ?? null
  const repoShortName = () => {
    const repo = primaryRepo()
    return repo ? (repo.split("/")[1] ?? repo) : null
  }
  const branch = () => {
    const repo = primaryRepo()
    const session = collab.session()
    return (repo ? session?.repoBranches?.[repo] : null) ?? session?.branch ?? null
  }
  const previewRunning = () => collab.previewState()?.status === "running"

  return (
    <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border-weak-base bg-surface-base px-3">
      {/*
        Full page navigation, not an SPA route change: @solidjs/router intercepts
        same-origin anchors and dynamic-imports the target route chunk, whose
        hashed filename rotates on every deploy — a stale bundle then fails with
        "Failed to fetch dynamically imported module".
      */}
      <a
        href="/collab/new"
        title="Back to your collab sessions"
        onClick={(e) => {
          e.preventDefault()
          window.location.href = "/collab/new"
        }}
        class="flex shrink-0 items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-collab-accent-line"
      >
        <BrandMark />
        {/* Hidden below sm: the mark alone identifies the product once the
            row gets crowded, and the session name stays the prominent thing
            in the row rather than competing with the full product name. */}
        <span class="hidden text-14-medium text-text-strong sm:inline">Unleash Collab</span>
      </a>

      <span class="hidden h-4 w-px shrink-0 bg-border-weak-base sm:inline-block" aria-hidden="true" />

      <h1 class="min-w-0 shrink truncate text-14-medium text-text-strong">{collab.session()?.name ?? "Loading…"}</h1>

      <Show when={repoShortName()}>
        {(name) => (
          <span class={`${CHIP} hidden shrink-0 sm:inline-flex`} title={repos().join("\n")}>
            {name()}
            <Show when={repos().length > 1}>
              <span class="text-text-weak">+{repos().length - 1}</span>
            </Show>
          </span>
        )}
      </Show>

      <Show when={branch()}>
        {(name) => (
          <span
            class={`${CHIP} hidden min-w-0 shrink sm:inline-flex`}
            title={previewRunning() ? `${name()} · live preview running` : `Current branch: ${name()}`}
          >
            <Show when={previewRunning()}>
              <span class="size-1.5 shrink-0 rounded-full bg-surface-success-strong" aria-hidden="true" />
            </Show>
            <span class="truncate">{name()}</span>
          </span>
        )}
      </Show>

      <div class="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={props.onManageParticipants}
          title="View participants"
          aria-label={`View participants — ${onlineCount()} of ${participants().length} online`}
          class="hidden items-center rounded-full outline-none transition-opacity duration-150 ease-out hover:opacity-80 focus-visible:ring-2 focus-visible:ring-collab-accent-line sm:flex"
        >
          <For each={shown()}>
            {(p, i) => (
              <img
                src={p.githubAvatarUrl || `https://github.com/${p.githubLogin}.png?size=48`}
                alt={p.githubLogin}
                title={`${p.githubLogin} · ${roleLabel(p.role)} · ${p.isOnline ? "online" : "offline"}`}
                classList={{
                  "size-6 rounded-full border-2 border-background-base bg-surface-inset-base": true,
                  "ring-1 ring-border-success-base": p.isOnline,
                  "-ml-[5px]": i() > 0,
                }}
              />
            )}
          </For>
          <Show when={overflowCount() > 0}>
            <span class="-ml-[5px] inline-flex size-6 items-center justify-center rounded-full border-2 border-background-base bg-surface-inset-base font-mono text-[10px] text-text-weak">
              +{overflowCount()}
            </span>
          </Show>
        </button>

        <span class="hidden font-mono text-[10.5px] text-text-weak md:inline">
          {onlineCount()}/{participants().length} online
        </span>

        <span class={`${CHIP} ${ROLE_TEXT_CLASS[props.myRole]} hidden lg:inline-flex`} title="Your role in this session">
          {props.myRole}
        </span>

        <button type="button" onClick={props.onInvite} class={`${BTN_GHOST} h-7 px-2.5`} title="Invite participants">
          Invite
        </button>

        <ThemeToggle />

        <OverflowMenu
          open={props.menuOpen}
          setOpen={props.setMenuOpen}
          myRole={props.myRole}
          onTutorial={props.onTutorial}
          onMcpConfig={props.onMcpConfig}
          onAddRepo={props.onAddRepo}
          onManageParticipants={props.onManageParticipants}
        />
      </div>
    </header>
  )
}

// ── Overflow menu ────────────────────────────────────────────────────────────

function OverflowMenu(props: {
  open: () => boolean
  setOpen: (open: boolean) => void
  myRole: CollabRole
  onTutorial: () => void
  onMcpConfig: () => void
  onAddRepo: () => void
  onManageParticipants: () => void
}) {
  const collab = useCollab()
  const isDriver = () => props.myRole === "driver"

  const [compactState, setCompactState] = createSignal<"idle" | "busy" | "done">("idle")
  const [exportBusy, setExportBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  let panelRef: HTMLDivElement | undefined
  let triggerRef: HTMLButtonElement | undefined

  createEffect(() => {
    if (!props.open()) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef?.contains(target) || triggerRef?.contains(target)) return
      props.setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      props.setOpen(false)
      triggerRef?.focus()
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  /** Run an action and close, keeping any failure visible in the menu. */
  function pick(fn: () => void) {
    setError(null)
    fn()
    props.setOpen(false)
  }

  async function compact() {
    if (compactState() === "busy") return
    setCompactState("busy")
    setError(null)
    try {
      await collab.compact()
      setCompactState("done")
      setTimeout(() => setCompactState("idle"), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCompactState("idle")
    }
  }

  async function exportSession() {
    const session = collab.session()
    if (!session || exportBusy()) return
    setExportBusy(true)
    setError(null)
    try {
      const res = await fetch(`/collab/session/${session.id}/export`)
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const markdown = formatExportMarkdown(await res.json())
      const blob = new Blob([markdown], { type: "text/markdown" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `collab-${session.name?.replace(/[^a-z0-9]/gi, "-").toLowerCase() ?? session.id}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke on a later task: revoking in the same task as the click can
      // cancel the download in some browsers before it has actually started.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      props.setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExportBusy(false)
    }
  }

  async function signOut() {
    await fetch("/collab/auth/logout", { method: "POST" })
    window.location.href = `/collab/auth/github?next=/collab/${collab.session()?.id ?? ""}`
  }

  return (
    <div class="relative">
      <button
        ref={(el) => (triggerRef = el)}
        type="button"
        onClick={() => props.setOpen(!props.open())}
        aria-label="More session actions"
        aria-haspopup="true"
        aria-expanded={props.open()}
        class={BTN_ICON}
      >
        <span aria-hidden="true" class="text-[15px] leading-none">
          &#8943;
        </span>
      </button>

      <Show when={props.open()}>
        <div
          ref={(el) => (panelRef = el)}
          role="list"
          aria-label="Session actions"
          class="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-border-weak-base bg-surface-raised-base py-1"
        >
          <MenuItem
            label="Manage participants"
            hint="View roles, invite, or remove people"
            onSelect={() => pick(props.onManageParticipants)}
          />

          <Show when={isDriver() && !!collab.session()?.sessionId}>
            <MenuItem
              label={compactState() === "busy" ? "Compacting…" : compactState() === "done" ? "Context compacted" : "Compact context"}
              hint="Summarise older messages to free context tokens"
              disabled={compactState() === "busy"}
              onSelect={() => void compact()}
            />
          </Show>

          <Show when={isDriver()}>
            <MenuItem
              label={collab.mcpConfigured() ? "Unleash MCP active" : "Configure MCP"}
              hint="Unleash Live MCP credentials for this session"
              onSelect={() => pick(props.onMcpConfig)}
            />
            <MenuItem label="Add repository" hint="Clone another repo onto the collab branch" onSelect={() => pick(props.onAddRepo)} />
          </Show>

          <MenuItem
            label={exportBusy() ? "Exporting…" : "Export session"}
            hint="Download the prompt history as markdown"
            disabled={exportBusy()}
            onSelect={() => void exportSession()}
          />
          <MenuItem label="Help and shortcuts" onSelect={() => pick(props.onTutorial)} />

          <div class="my-1 border-t border-border-weak-base" role="separator" />
          <MenuItem label="Sign out" onSelect={() => void signOut()} />

          <Show when={error()}>
            {(message) => <p class="px-3 py-1.5 text-[11px] text-text-on-critical-base">{message()}</p>}
          </Show>
        </div>
      </Show>
    </div>
  )
}

function MenuItem(props: { label: string; hint?: string; disabled?: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="listitem"
      disabled={props.disabled}
      onClick={props.onSelect}
      title={props.hint}
      class="flex min-h-8 w-full items-center px-3 py-1.5 text-left text-12-regular text-text-base outline-none transition-colors duration-150 ease-out hover:bg-surface-base-hover hover:text-text-strong focus-visible:bg-surface-base-hover focus-visible:text-text-strong disabled:cursor-not-allowed disabled:text-text-weaker motion-reduce:transition-none"
    >
      {props.label}
    </button>
  )
}

// ── Markdown export ──────────────────────────────────────────────────────────

export function formatExportMarkdown(data: {
  session: {
    id: string
    name: string
    branch: string | null
    repos: string[]
    createdAt: Date
    participants: Array<{ githubLogin: string; role: string }>
  }
  suggestions: Array<{
    authorGithubLogin: string
    content: string
    status: string
    model?: string
    agent?: string
    variant?: string
    createdAt: Date
  }>
}): string {
  const { session, suggestions } = data
  const date = new Date(session.createdAt).toISOString().split("T")[0]
  const repoList = session.repos.join(", ") || "none"

  const lines: string[] = [
    `# Unleash Collab Session: ${session.name}`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Branch | \`${session.branch ?? "none"}\` |`,
    `| Repos | ${repoList} |`,
    `| Created | ${date} |`,
    `| Participants | ${session.participants.map((p) => `@${p.githubLogin} (${p.role})`).join(", ")} |`,
    ``,
    `---`,
    ``,
    `## Prompt History`,
    ``,
  ]

  const submitted = suggestions.filter(
    (s) => s.status === "submitted" || s.status === "approved" || s.status === "in_flight",
  )

  if (submitted.length === 0) {
    lines.push("_No prompts submitted yet._")
  } else {
    for (const s of submitted) {
      const ts = new Date(s.createdAt).toISOString().replace("T", " ").slice(0, 16)
      const modelLabel = s.model ? s.model.split("/").pop() : null
      const meta = [modelLabel, s.variant, s.agent ? `agent:${s.agent}` : null].filter(Boolean).join(" · ")
      lines.push(`### [${ts}] @${s.authorGithubLogin}${meta ? `  ·  ${meta}` : ""}`)
      lines.push(``)
      for (const line of s.content.split("\n")) lines.push(`> ${line}`)
      lines.push(``)
      lines.push(`---`)
      lines.push(``)
    }
  }

  return lines.join("\n")
}
