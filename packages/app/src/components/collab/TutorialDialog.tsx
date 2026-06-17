import { createSignal, For, Show } from "solid-js"

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
    <div
      class="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style="z-index:99999"
      onClick={props.onClose}
    >
      <div
        class="border border-border-weak-base rounded-xl w-full max-w-2xl shadow-2xl bg-background-base flex flex-col"
        style="position:relative;z-index:100000;max-height:88vh"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
          <div>
            <h2 class="text-base font-semibold text-text-strong">Unleash Collab — quick start</h2>
            <p class="text-xs text-text-weak mt-0.5">Everything you need to know to collaborate in one place.</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            class="p-1.5 rounded hover:bg-background-strong text-text-weak hover:text-text-strong transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab strip */}
        <div class="flex gap-1 px-6 pb-3 border-b border-border-weak-base flex-shrink-0">
          <button
            type="button"
            onClick={() => setTab("features")}
            class={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              tab() === "features"
                ? "bg-background-strong text-text-strong"
                : "text-text-weak hover:text-text-strong"
            }`}
          >
            Features
          </button>
          <button
            type="button"
            onClick={() => setTab("shortcuts")}
            class={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              tab() === "shortcuts"
                ? "bg-background-strong text-text-strong"
                : "text-text-weak hover:text-text-strong"
            }`}
          >
            Keyboard shortcuts
          </button>
        </div>

        {/* Body */}
        <div class="flex-1 overflow-y-auto min-h-0">
          <Show when={tab() === "features"}>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-6">
              <For each={FEATURES}>
                {(f) => (
                  <div class="rounded-lg border border-border-weak-base bg-background-stronger p-3">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-base leading-none">{f.emoji}</span>
                      <span class="text-xs font-semibold text-text-strong">{f.title}</span>
                    </div>
                    <p class="text-[11px] text-text-weak leading-relaxed">{f.body}</p>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={tab() === "shortcuts"}>
            <div class="p-6 space-y-6">
              <p class="text-[11px] text-text-weak -mt-2">
                Shortcuts below apply <strong class="text-text-strong">inside the editor pane</strong> (the opencode iframe on the right). The leader key is{" "}
                <kbd class="px-1 py-0.5 rounded bg-background-strong text-text-strong font-mono text-[10px]">Ctrl+X</kbd>
                {" "}— press it first, then the next key. Hit{" "}
                <kbd class="px-1 py-0.5 rounded bg-background-strong text-text-strong font-mono text-[10px]">Ctrl+Alt+K</kbd>{" "}
                inside the editor to see every shortcut.
              </p>
              <For each={SHORTCUT_GROUPS}>
                {(group) => (
                  <div>
                    <h3 class="text-[10px] uppercase tracking-wider font-semibold text-text-weak mb-2">
                      {group.title}
                    </h3>
                    <div class="rounded-lg border border-border-weak-base overflow-hidden divide-y divide-border-weak-base">
                      <For each={group.rows}>
                        {(row) => (
                          <div class="flex items-center justify-between px-3 py-2 bg-background-stronger">
                            <span class="text-[11px] text-text-weak">{row.label}</span>
                            <div class="flex items-center gap-1 flex-shrink-0 ml-3">
                              <For each={row.keys}>
                                {(k, i) => (
                                  <>
                                    <Show when={i() > 0}>
                                      <span class="text-[10px] text-text-weak">/</span>
                                    </Show>
                                    <kbd class="px-1.5 py-0.5 rounded bg-background-strong text-text-strong font-mono text-[10px] border border-border-weak-base whitespace-nowrap">
                                      {k}
                                    </kbd>
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

              <div class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                <p class="text-[11px] text-amber-300/80 leading-relaxed">
                  <strong class="text-amber-300">Tip:</strong> Customize any keybind in{" "}
                  <code class="font-mono text-[10px]">~/.config/opencode/opencode.json</code> under{" "}
                  <code class="font-mono text-[10px]">keybinds</code>. Set a value to{" "}
                  <code class="font-mono text-[10px]">"none"</code> to disable it.
                </p>
              </div>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="flex justify-between items-center px-6 py-3 border-t border-border-weak-base flex-shrink-0">
          <a
            href="https://opencode.ai/docs/keybinds/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[11px] text-text-weak hover:text-text-strong underline-offset-2 hover:underline transition-colors"
          >
            Full keybinds reference ↗
          </a>
          <button
            type="button"
            onClick={props.onClose}
            class="px-3 py-1.5 text-xs rounded-md text-text-weak hover:text-text-strong transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
