/**
 * One-click "Open PR" for a collab session — one PR per linked repo.
 *
 * Driver hits the button → server, for EACH repo linked to the session:
 *   1. skip the repo if its collab branch has no commits ahead of the repo's
 *      default branch (`git rev-list --count <base>..HEAD` === 0)
 *   2. `git push -u origin HEAD` from that repo's cloned workspace (credentials
 *      already baked into the clone URL at session-init time)
 *   3. `POST /repos/<org>/<repo>/pulls` against GitHub's REST API using the
 *      Driver's OAuth access token (ADR-0005 Option B — no server PAT)
 *
 * Returns one `RepoPrResult` per repo so the client can render a row each:
 * opened (with URL), skipped (no changes), or error (e.g. no write access).
 * A failure on one repo never aborts the others.
 *
 * Body of each PR is auto-composed from the collab session state:
 *   - Title = collab session name
 *   - Link back to /collab/<id>
 *   - List of commits with their Collaborative-Commit trailers
 *   - Table of participants + roles
 */

import { spawn } from "node:child_process"
import type { CollabSession, RepoPrResult } from "@opencode-ai/collab"
import { repoWorkspacePath } from "./workspace"

/**
 * Push + open a PR for EVERY repo linked to the session.  Repos with no
 * commits on the collab branch are skipped (not pushed, no empty PR).  Runs
 * the repos sequentially — pushes are cheap and serial avoids hammering one
 * OAuth token / tripping GitHub secondary rate limits.
 */
export async function openCollabPullRequests(
  collabSession: CollabSession,
  baseUrl: string,
  userAccessToken: string,
): Promise<{ results: RepoPrResult[] }> {
  if (collabSession.repos.length === 0) {
    return { results: [] }
  }
  if (!userAccessToken) {
    return {
      results: collabSession.repos.map((repo) => ({
        repo,
        status: "error" as const,
        error: "No GitHub access token in session.",
      })),
    }
  }

  const results: RepoPrResult[] = []
  for (const repo of collabSession.repos) {
    results.push(await openPullRequestForRepo(repo, collabSession, baseUrl, userAccessToken))
  }
  return { results }
}

/**
 * Push the collab branch and open a PR for a single repo.  Never throws —
 * every failure path returns a structured `RepoPrResult`.
 */
export async function openPullRequestForRepo(
  repoFull: string, // "<org>/<repo>"
  collabSession: CollabSession,
  baseUrl: string,
  userAccessToken: string,
): Promise<RepoPrResult> {
  const repoPath = repoWorkspacePath(collabSession.id, repoFull)
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" }

  // Resolve current branch (prefer the session's configured branch).
  let branch = collabSession.branch ?? ""
  if (!branch) {
    try {
      branch = (await runAsyncCapture("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], env)).trim()
    } catch {
      return { repo: repoFull, status: "error", error: "Couldn't determine current git branch." }
    }
  }

  // Resolve the repo's default branch (the PR base).
  let defaultBranch = "main"
  try {
    const head = (
      await runAsyncCapture("git", ["-C", repoPath, "symbolic-ref", "refs/remotes/origin/HEAD"], env)
    ).trim()
    // head looks like "refs/remotes/origin/main"
    const parts = head.split("/")
    defaultBranch = parts[parts.length - 1] || "main"
  } catch {
    // fall back to "main"
  }

  // Skip repos with nothing to PR.  `rev-list --count <base>..HEAD` is 0 when
  // the collab branch hasn't diverged from the default branch in this repo.
  // If the count can't be computed (shallow base missing etc.), fall through
  // and let GitHub's "No commits between" 422 catch it as a skip — defence in
  // depth, never a hard failure.
  try {
    const count = (
      await runAsyncCapture("git", ["-C", repoPath, "rev-list", "--count", `${defaultBranch}..HEAD`], env)
    ).trim()
    if (count === "0") {
      return { repo: repoFull, status: "skipped", reason: "no changes" }
    }
  } catch {
    // proceed — the GitHub 422 path below will skip if truly empty
  }

  // Push the current branch.  Clone URL already carries the token (baked in by
  // initSessionWorkspace), so no extra credential handling here.
  try {
    await runAsyncCapture("git", ["-C", repoPath, "push", "-u", "origin", "HEAD"], env)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { repo: repoFull, status: "error", error: `git push failed: ${message}` }
  }

  // Compose the PR body from the session state.
  let log = ""
  try {
    log = await runAsyncCapture(
      "git",
      ["-C", repoPath, "log", `${defaultBranch}..HEAD`, "--format=- %h %s", "--no-decorate"],
      env,
    )
  } catch {
    // empty log is fine — branch may have just been created
  }
  const participants = collabSession.participants.map((p) => `| @${p.githubLogin} | ${p.role} |`).join("\n")
  const body = [
    `Created from a [collab session](${baseUrl}/collab/${collabSession.id}).`,
    "",
    `**Commits**`,
    "",
    log.trim() || "_(no commits yet)_",
    "",
    `**Participants**`,
    "",
    "| GitHub | Role |",
    "|---|---|",
    participants || "| — | — |",
    "",
    `<sub>Every commit on this branch is auto-tagged with \`Collaborative-Commit: true\` and \`Collab-Session-Id: ${collabSession.id}\`.</sub>`,
  ].join("\n")

  // Open the PR.
  const res = await fetch(`https://api.github.com/repos/${repoFull}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "opencode-collab",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: collabSession.name,
      head: branch,
      base: defaultBranch,
      body,
      draft: false,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    // 422 "A pull request already exists for …" — surface the existing PR URL.
    if (res.status === 422 && /pull request already exists/i.test(detail)) {
      try {
        const list = await fetch(
          `https://api.github.com/repos/${repoFull}/pulls?head=${repoFull.split("/")[0]}:${encodeURIComponent(branch)}&state=open`,
          {
            headers: {
              Authorization: `Bearer ${userAccessToken}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "opencode-collab",
            },
          },
        )
        if (list.ok) {
          const arr = (await list.json()) as Array<{ html_url: string }>
          if (arr[0]?.html_url) return { repo: repoFull, status: "opened", url: arr[0].html_url }
        }
      } catch {
        /* fall through */
      }
    }
    // 422 "No commits between <base> and <head>" — the collab branch has zero
    // commits ahead.  In multi-repo land this is a per-repo skip, not an error.
    if (res.status === 422 && /no commits between/i.test(detail)) {
      return { repo: repoFull, status: "skipped", reason: "no changes" }
    }
    return { repo: repoFull, status: "error", error: detail || `GitHub returned ${res.status}` }
  }

  const data = (await res.json()) as { html_url?: string; number?: number }
  if (!data.html_url) {
    return { repo: repoFull, status: "error", error: "GitHub didn't return an html_url for the new PR." }
  }
  return { repo: repoFull, status: "opened", url: data.html_url }
}

function runAsyncCapture(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env })
    let out = ""
    let err = ""
    child.stdout?.on("data", (b: Buffer) => (out += b.toString()))
    child.stderr?.on("data", (b: Buffer) => (err += b.toString()))
    child.on("close", (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || `${cmd} ${args.join(" ")} exited ${code}`))
    })
    child.on("error", reject)
  })
}
