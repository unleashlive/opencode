import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import * as Log from "@opencode-ai/core/util/log"
import path from "node:path"
import { existsSync } from "node:fs"

const log = Log.create({ service: "plugin.graphify" })

// Graphify (https://github.com/safishamsi/graphify) turns a repo into a queryable
// knowledge graph. This built-in plugin makes the fork "Graphify-aware" for every
// project opened through opencode:
//   1. Auto-init: on first open of a git repo, build a code-only (offline, no API
//      key) knowledge graph in the background.
//   2. Query-first nudge: before the agent greps/globs/reads files one-by-one to
//      answer codebase questions, remind it that a graph exists and `graphify
//      query` is usually faster. This mirrors Graphify's documented OpenCode hook.
//
// Everything is best-effort: if the `graphify` CLI is not installed, or the
// directory is not a git repo, the plugin silently no-ops. Behaviour is tunable
// via env vars (see below) so it never gets in the way.

const OUT_DIR = "graphify-out"
const GRAPH_FILE = path.join(OUT_DIR, "graph.json")

// Tools that signal the agent is hunting through raw files for a codebase
// question — the moment a graph query is usually the better move.
const SEARCH_TOOLS = new Set(["grep", "glob"])

const disabled = (() => {
  const v = process.env["OPENCODE_GRAPHIFY_DISABLE"]
  return v === "1" || v === "true"
})()

const autoInitEnabled = (() => {
  const v = process.env["OPENCODE_GRAPHIFY_AUTO_INIT"]
  // Default on; only "0"/"false" disables.
  return v !== "0" && v !== "false"
})()

export const GraphifyPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  if (disabled) return {}

  const root = input.worktree || input.directory
  if (!root) return {}

  // Track whether this project has a usable graph so the nudge only fires when
  // there is actually something to query.
  let hasGraph = existsSync(path.join(root, GRAPH_FILE))

  // Fire-and-forget one-time init. We never block plugin load on extraction.
  if (autoInitEnabled && !hasGraph) {
    void autoInit(input, root).then((built) => {
      if (built) hasGraph = true
    })
  }

  // Nudge the agent toward the graph instead of brute-force searching. Mutating
  // the args/tool is risky across opencode versions, so we keep this advisory:
  // we only emit a log breadcrumb. The persistent guidance lives in the shipped
  // built-in skill so the model actually changes behaviour.
  let nudged = false
  const hooks: Hooks = {
    "tool.execute.before": async (info) => {
      if (!hasGraph) return
      if (!SEARCH_TOOLS.has(info.tool)) return
      if (nudged) return
      nudged = true
      log.info("graph available; prefer `graphify query` over raw search", {
        tool: info.tool,
        graph: GRAPH_FILE,
      })
    },
  }

  return hooks
}

// Resolve a runnable graphify invocation: prefer the `graphify` binary on PATH,
// fall back to `python -m graphify`. Returns the argv prefix or undefined if
// neither is available.
async function resolveGraphify(input: PluginInput): Promise<string[] | undefined> {
  const probe = async (cmd: string[]) => {
    try {
      // `.quiet().nothrow()` keeps probing silent and non-fatal.
      const res = await input.$`${cmd} --version`.quiet().nothrow()
      return res.exitCode === 0
    } catch {
      return false
    }
  }

  if (await probe(["graphify"])) return ["graphify"]
  if (await probe(["python3", "-m", "graphify"])) return ["python3", "-m", "graphify"]
  if (await probe(["python", "-m", "graphify"])) return ["python", "-m", "graphify"]
  return undefined
}

async function autoInit(input: PluginInput, root: string): Promise<boolean> {
  // Only operate on git repos — that is what "any repo I pull" means here.
  if (!existsSync(path.join(root, ".git"))) return false

  const argv = await resolveGraphify(input)
  if (!argv) {
    log.info("graphify CLI not found; skipping auto-init", { root })
    return false
  }

  // Code-only / offline graph build: `graphify update` re-extracts code files
  // via AST (tree-sitter) and clusters them with no LLM call — nothing leaves
  // the machine and no API key is needed. (`extract` would attempt semantic
  // LLM extraction and require a backend, which we deliberately avoid here.)
  log.info("auto-initializing graphify knowledge graph", { root })
  try {
    const res = await input.$`${argv} update ${root}`.cwd(root).quiet().nothrow()
    if (res.exitCode !== 0) {
      log.warn("graphify update failed", { root, exitCode: res.exitCode })
      return false
    }
  } catch (err) {
    log.warn("graphify auto-init errored", { root, error: err })
    return false
  }

  const built = existsSync(path.join(root, GRAPH_FILE))
  if (built) log.info("graphify knowledge graph ready", { graph: GRAPH_FILE })
  return built
}
