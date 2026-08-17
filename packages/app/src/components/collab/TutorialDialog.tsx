/**
 * Quick-start dialog for the Collab session page (SKU-1).
 *
 * Two tabs of reference material: what the session surfaces do, and the
 * keyboard shortcuts that work inside the embedded editor.  Shell is the host
 * dialog (./CollabDialog.tsx); the tab strip and body are collab's.
 */

import { createSignal, For, Show } from "solid-js"
import { CollabDialog } from "./CollabDialog"
import { LABEL_MICRO, SEGMENT_ITEM, SEGMENT_ITEM_ACTIVE, SEGMENT_ITEM_IDLE, SEGMENT_TRACK } from "./ui"

type Tab = "features" | "shortcuts"

interface Feature {
  emoji: string
  title: string
  body: string
}

interface ShortcutGroup {
  title: string
  rows: { keys: string[]; label: string }[]
}

const FEATURES: Feature[] = [
  {
    emoji: "🎭",
    title: "Roles",
    body: "Driver — creates and approves prompts, manages repos and invites. Contributor — suggests prompts (Driver must approve in vote mode). Viewer — read-only, watches the session live.",
  },
  {
    emoji: "📬",
    title: "Prompt queue",
    body: "FIFO mode: Driver prompts run immediately; Contributor prompts queue and run in order. Vote mode: all suggestions sit in a pool — the one with the most 👍 wins when the Driver resolves. Drivers can also approve or reject individual suggestions.",
  },
  {
    emoji: "🤖",
    title: "Agents & Models",
    body: "Cycle agents with Tab (Build → Plan → …) inside the editor. Build has all tools; Plan restricts edits for safe analysis. Hit Ctrl+A to switch model/provider. F2 cycles your recent models. Ctrl+T cycles quality variants (e.g. claude max).",
  },
  {
    emoji: "📁",
    title: "Multi-repo",
    body: "A session can link multiple GitHub repos. Each gets its own branch (collab/<slug>) and a separate PR when you click Open PR. Repos with no commits on the branch are skipped automatically.",
  },
  {
    emoji: "➕",
    title: "Add repo mid-session",
    body: "Drivers can click + Add in the Repos section to add a new repo while the session is live. It clones, creates the collab branch, and the LLM is notified automatically.",
  },
  {
    emoji: "🖥️",
    title: "Live preview",
    body: "For sessions linked to a frontend repo (or any repo with .opencode-preview.json), the Launch preview button spins up the dev server inside the workspace. All participants share the same preview URL.",
  },
  {
    emoji: "💬",
    title: "Team notes",
    body: "The Notes section is a lightweight team chat separate from the LLM prompt queue — use it for @mentions, quick comments, or coordination without burning a coding turn.",
  },
  {
    emoji: "🔀",
    title: "Open PRs",
    body: "Click Open PR to push the collab branch and create a GitHub pull request for every linked repo that has commits. The PR body links back to this session. Already-open PRs are detected and linked rather than duplicated.",
  },
  {
    emoji: "😄",
    title: "Reactions",
    body: "React to any prompt suggestion with 👍 👎 🔥 🚀 ❤️ 😄. In vote mode reactions directly influence which prompt wins the pool.",
  },
  {
    emoji: "🔔",
    title: "@Mentions",
    body: "Type @username in a prompt suggestion or team note to ping a participant. They get a notification badge in their collab panel.",
  },
]

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Prompt & input",
    rows: [
      { keys: ["Enter"], label: "Submit prompt" },
      { keys: ["Shift+Enter", "Ctrl+Enter", "Alt+Enter"], label: "New line in prompt" },
      { keys: ["Ctrl+K"], label: "Delete to end of line" },
      { keys: ["Ctrl+U"], label: "Delete to start of line" },
      { keys: ["Ctrl+W"], label: "Delete previous word" },
      { keys: ["Alt+D"], label: "Delete next word" },
      { keys: ["Ctrl+A"], label: "Start of line" },
      { keys: ["Ctrl+E"], label: "End of line" },
      { keys: ["Ctrl+-", "⌘Z"], label: "Undo in input" },
      { keys: ["Ctrl+G"], label: "Cancel popover / abort response" },
    ],
  },
  {
    title: "Agents & models",
    rows: [
      { keys: ["Tab"], label: "Cycle agents (Build → Plan → …)" },
      { keys: ["Shift+Tab"], label: "Cycle agents (reverse)" },
      { keys: ["Ctrl+A"], label: "Model / provider selector" },
      { keys: ["F2"], label: "Cycle recent models" },
      { keys: ["Ctrl+T"], label: "Cycle model variants (e.g. max)" },
      { keys: ["Ctrl+X → A"], label: "Open full agent list" },
      { keys: ["Ctrl+X → M"], label: "Open full model list" },
    ],
  },
  {
    title: "Session management",
    rows: [
      { keys: ["Escape"], label: "Interrupt / stop LLM response" },
      { keys: ["Ctrl+X → N"], label: "New native session" },
      { keys: ["Ctrl+X → C"], label: "Compact context (reduce token usage)" },
      { keys: ["Ctrl+X → U"], label: "Undo last message" },
      { keys: ["Ctrl+X → R"], label: "Redo undone message" },
      { keys: ["Ctrl+X → Y"], label: "Copy conversation" },
      { keys: ["Ctrl+X → X"], label: "Export session" },
      { keys: ["Ctrl+X → L"], label: "Session list" },
      { keys: ["Ctrl+X → G"], label: "Session timeline" },
      { keys: ["Ctrl+R"], label: "Rename session" },
    ],
  },
  {
    title: "Navigation & UI",
    rows: [
      { keys: ["Ctrl+P"], label: "Command palette" },
      { keys: ["PageUp / PageDown"], label: "Scroll messages" },
      { keys: ["Ctrl+Alt+B / Ctrl+Alt+F"], label: "Page up / down in messages" },
      { keys: ["Ctrl+Alt+K"], label: "Which-key menu (all shortcuts)" },
      { keys: ["Ctrl+X → B"], label: "Toggle sidebar" },
      { keys: ["Ctrl+X → T"], label: "Switch theme" },
      { keys: ["Ctrl+X → H"], label: "Toggle tips" },
      { keys: ["Home / End"], label: "Jump to first / last message" },
    ],
  },
]

export function TutorialDialog(props: { onClose: () => void }) {
  const [tab, setTab] = createSignal<Tab>("features")

  return (
    <CollabDialog
      title="Unleash Collab quick start"
      description="Everything you need to collaborate, in one place."
      size="large"
      onClose={props.onClose}
    >
      <div class="flex min-h-0 flex-1 flex-col">
        {/* Tab strip */}
        <div class="shrink-0 px-5 pb-3" role="tablist" aria-label="Quick start sections">
          <div class={SEGMENT_TRACK}>
            <For
              each={
                [
                  ["features", "Features"],
                  ["shortcuts", "Keyboard shortcuts"],
                ] as const
              }
            >
              {([value, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === value}
                  onClick={() => setTab(value)}
                  classList={{
                    [SEGMENT_ITEM]: true,
                    [SEGMENT_ITEM_ACTIVE]: tab() === value,
                    [SEGMENT_ITEM_IDLE]: tab() !== value,
                  }}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Body */}
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border-weak-base">
          <Show when={tab() === "features"}>
            <div class="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
              <For each={FEATURES}>
                {(f) => (
                  <div class="rounded-md border border-border-weak-base bg-surface-inset-base p-3">
                    <div class="mb-1 flex items-center gap-2">
                      <span aria-hidden="true" class="text-14-regular leading-none">
                        {f.emoji}
                      </span>
                      <span class="text-12-medium text-text-strong">{f.title}</span>
                    </div>
                    <p class="text-[11px] leading-relaxed text-text-base">{f.body}</p>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={tab() === "shortcuts"}>
            <div class="flex flex-col gap-5 p-5">
              <p class="text-[11px] leading-relaxed text-text-base">
                These apply <strong class="text-text-strong">inside the editor pane</strong>. The leader key is{" "}
                <Key>Ctrl+X</Key>: press it first, then the next key. Hit <Key>Ctrl+Alt+K</Key> inside the editor to see
                every shortcut.
              </p>
              <For each={SHORTCUT_GROUPS}>
                {(group) => (
                  <div>
                    <h3 class={`${LABEL_MICRO} mb-2`}>{group.title}</h3>
                    <div class="divide-y divide-border-weak-base overflow-hidden rounded-md border border-border-weak-base">
                      <For each={group.rows}>
                        {(row) => (
                          <div class="flex items-center justify-between gap-3 bg-surface-inset-base px-3 py-2">
                            <span class="text-[11px] text-text-base">{row.label}</span>
                            <div class="flex shrink-0 items-center gap-1">
                              <For each={row.keys}>
                                {(k, i) => (
                                  <>
                                    <Show when={i() > 0}>
                                      <span class="text-[10px] text-text-weak">/</span>
                                    </Show>
                                    <Key>{k}</Key>
                                  </>
                                )}
                              </For>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>

              <p class="rounded-md border border-border-warning-base bg-surface-warning-weak px-3 py-2.5 text-[11px] leading-relaxed text-text-on-warning-base">
                <strong>Tip:</strong> customize any keybind in{" "}
                <code class="font-mono text-[10px]">~/.config/opencode/opencode.json</code> under{" "}
                <code class="font-mono text-[10px]">keybinds</code>. Set a value to{" "}
                <code class="font-mono text-[10px]">"none"</code> to disable it.
              </p>

              <a
                href="https://opencode.ai/docs/keybinds/"
                target="_blank"
                rel="noopener noreferrer"
                class="text-[11px] text-text-base underline-offset-2 outline-none transition-colors duration-150 ease-out hover:text-text-strong hover:underline focus-visible:ring-2 focus-visible:ring-collab-accent-line motion-reduce:transition-none"
              >
                Full keybinds reference
              </a>
            </div>
          </Show>
        </div>
      </div>
    </CollabDialog>
  )
}

/** Keycap: mono, inset, hairline. */
function Key(props: { children: string }) {
  return (
    <kbd class="whitespace-nowrap rounded border border-border-weak-base bg-surface-inset-strong px-1.5 py-0.5 font-mono text-[10px] text-text-strong">
      {props.children}
    </kbd>
  )
}
