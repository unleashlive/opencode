import { Effect } from "effect"
import { Server } from "../../server/server"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { runCollabMigrations } from "../../collab/migrate"
import path from "node:path"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    // ADR-0001 production-startup gate.  Two valid auth models:
    //   - OPENCODE_SERVER_PASSWORD set (basic auth gate)
    //   - OPENCODE_AUTH_MODE=collab    (OAuth-cookie gate; basic is OFF)
    // Either one in production is enough.  OPENCODE_ALLOW_UNAUTHENTICATED=1
    // overrides both for local dev.
    //
    // Collab mode additionally requires GITHUB_ORG_NAME so the OAuth
    // callback's org-membership probe has something to compare against.
    const authMode = process.env["OPENCODE_AUTH_MODE"] ?? "basic"
    const hasPassword = !!Flag.OPENCODE_SERVER_PASSWORD
    const isCollabMode = authMode === "collab"
    const allowUnauthenticated = process.env["OPENCODE_ALLOW_UNAUTHENTICATED"] === "1"

    if (process.env["NODE_ENV"] === "production" && !allowUnauthenticated) {
      if (!hasPassword && !isCollabMode) {
        console.error(
          "FATAL: no auth configured in production.  Set OPENCODE_SERVER_PASSWORD " +
            "(basic auth) or OPENCODE_AUTH_MODE=collab (OAuth cookie).  Use " +
            "OPENCODE_ALLOW_UNAUTHENTICATED=1 only for private dev boxes.",
        )
        process.exit(1)
      }
      if (isCollabMode && !process.env["GITHUB_ORG_NAME"]) {
        console.error(
          "FATAL: OPENCODE_AUTH_MODE=collab requires GITHUB_ORG_NAME to be set. " +
            "The OAuth callback's org-membership check has nothing to compare against otherwise.",
        )
        process.exit(1)
      }
      // ADR-0001 Phase 4: LLM-auth presence check.  In collab production
      // the server is useless without a working Claude / Anthropic auth
      // path — the first prompt round-trips to api.anthropic.com or fails.
      // Catch the misconfiguration at boot instead of at the user's first
      // submit (which surfaces as the unhelpful "invalid x-api-key" 401).
      //
      // Two valid paths (either one is enough):
      //   1. ANTHROPIC_API_KEY set to a real sk-ant-... value.  Empty
      //      strings AND the literal "dummy" sentinel are treated as
      //      missing — "dummy" is the docker-compose-era placeholder that
      //      lets the provider loader accept a non-empty env so the
      //      claude-auth plugin can take over.  Carrying it into prod is
      //      a misconfiguration, not a valid credential.
      //   2. ~/.claude/.credentials.json exists.  The entrypoint writes
      //      this from CLAUDE_CREDENTIALS_JSON on container start; the
      //      opencode-claude-auth plugin reads it at runtime and supplies
      //      OAuth-based auth.  We only check presence — actual freshness
      //      surfaces as a runtime error from the plugin's refresh.
      if (isCollabMode) {
        const apiKey = process.env["ANTHROPIC_API_KEY"] ?? ""
        const hasRealApiKey = apiKey !== "" && apiKey !== "dummy"
        const credentialsPath = path.join(
          process.env["HOME"] ?? "/home/opencode",
          ".claude",
          ".credentials.json",
        )
        const hasClaudeCreds = yield* Effect.promise(() => Bun.file(credentialsPath).exists())
        if (!hasRealApiKey && !hasClaudeCreds) {
          console.error(
            "FATAL: no LLM auth configured in collab production.  Either set " +
              "ANTHROPIC_API_KEY to a real sk-ant-... value, OR write a Claude " +
              "Code credentials JSON to " +
              credentialsPath +
              " (in container, set CLAUDE_CREDENTIALS_JSON via Secrets Manager — the " +
              "entrypoint writes the file from that env on every start).  The literal " +
              `"dummy" placeholder is treated as missing.`,
          )
          process.exit(1)
        }
      }
    } else if (!hasPassword && !isCollabMode) {
      console.log("Warning: no auth configured; server is unsecured (NODE_ENV != production).")
    }
    // Run collab DB migrations eagerly in collab mode so the auth
    // middleware's `cookieAuthorizesRequest` lookup never races a /collab/*
    // request to create the `collab_auth_session` table.  Without this, any
    // request bearing a `collab_sid` cookie between server start and the
    // first /collab/* call crashes with "no such table: collab_auth_session"
    // (the table is created inside the collab router's `ensureMigrated`
    // hook, which only runs when a /collab/* request lands).
    if (isCollabMode) runCollabMigrations()

    // Refresh the Claude OAuth access token on disk BEFORE the HTTP listener
    // comes up, so the opencode-claude-auth plugin's startup-read picks up
    // a fresh `accessToken` rather than a 15-minute-old one inherited from
    // the previous task instance.  Anthropic's OAuth tokens are short-lived;
    // an idle task replacement followed by a quick prompt would otherwise
    // 401 on the first try.  Fire-and-forget — failure (refresh-token
    // revoked, network glitch, etc.) just means the plugin tries the stale
    // token and either succeeds anyway (if it hasn't actually expired) or
    // falls back to ANTHROPIC_API_KEY env.
    if (isCollabMode) {
      yield* Effect.promise(async () => {
        try {
          const { ensureFreshClaudeToken } = await import("../../collab/claude-token-refresh")
          await ensureFreshClaudeToken()
        } catch (err) {
          console.warn("[collab] claude-token boot refresh skipped:", err)
        }
      })
    }

    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    // After the collab schema is migrated AND the HTTP server is up, ask the
    // preview-launcher to re-spawn the previously-running preview (if any).
    // Fire-and-forget — a stuck preview must not gate the rest of the
    // collab API.  Dynamic import so non-collab modes don't pay the
    // preview-launcher load cost at startup.
    if (isCollabMode) {
      yield* Effect.promise(async () => {
        try {
          const Preview = await import("../../collab/preview-launcher")
          // Don't await — boot continues immediately; preview install can
          // take minutes on a cold cache.
          void Preview.resumePreviewsOnBoot()
        } catch (err) {
          console.warn("[collab] preview-launcher boot resume skipped:", err)
        }
      })
    }

    // Refresh the `prepare-commit-msg` git hook in every active session's
    // workspaces.  Workspaces live on EFS across deploys, so a hook-logic
    // change in the image won't reach an existing workspace until someone
    // manually re-inits it — which is how the 2026-06-12 merge-commit
    // attribution bug shipped silently for so long.  Fire-and-forget so a
    // sweep error doesn't block boot.
    if (isCollabMode) {
      yield* Effect.promise(async () => {
        try {
          const Workspace = await import("../../collab/workspace")
          void Workspace.reinstallCollabHooksOnBoot()
        } catch (err) {
          console.warn("[collab] commit-hook boot sweep skipped:", err)
        }
      })
    }

    // S6 — start the container-RSS monitor.  Pure telemetry: logs a WARNING
    // when total memory crosses 13 GB (leading indicator for the 16 GB task
    // ceiling) so an operator can correlate it with a later OOM.  Never kills
    // anything.  Self-disables on platforms without the cgroup file.
    if (isCollabMode) {
      yield* Effect.promise(async () => {
        try {
          const { startMemoryMonitor } = await import("../../collab/cgroup-memory")
          startMemoryMonitor()
        } catch (err) {
          console.warn("[collab] memory monitor skipped:", err)
        }
      })
    }

    // S7 — sweep orphan workspace directories on EFS (dirs with no live
    // session row, older than the 24 h safety floor).  Reclaims space left
    // by failed cleanups / drift.  Fire-and-forget; per-dir failures log.
    if (isCollabMode) {
      yield* Effect.promise(async () => {
        try {
          const Workspace = await import("../../collab/workspace")
          void Workspace.cleanupOrphanWorkspaces()
        } catch (err) {
          console.warn("[collab] orphan-workspace sweep skipped:", err)
        }
      })
    }

    yield* Effect.never
  }),
})
