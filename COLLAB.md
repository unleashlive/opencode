# Collab Sessions — How It Works

## TL;DR for teammates

**You do not need to install anything.** Just click an invite link, sign in with GitHub, and you're in the session — in your browser.

---

## Architecture: who needs what

```
┌─────────────────────────────────┐      invite link      ┌──────────────────┐
│  Server admin (Hanno)           │ ───────────────────▶  │  Teammate        │
│  • Runs Docker on their Mac     │                        │  • Browser only  │
│  • Holds the Claude API creds   │  ◀── browser access ─ │  • GitHub login  │
│  • Manages collab sessions      │       via ngrok        │  • No install    │
└─────────────────────────────────┘                        └──────────────────┘
```

**The server holds the LLM credentials.** Every prompt in a Collab Session — whether sent by the Driver or approved from a Contributor suggestion — is executed by the server using the server's Claude API key. Teammates' own Claude or Anthropic accounts are not involved and not needed.

This is intentional: it's a *shared coding environment*, not a billing relay. One team subscription powers the shared session.

---

## For teammates: joining a session

1. **Receive an invite link** from the session Driver (looks like `https://corrosive-cola-chalice.ngrok-free.dev/collab/invite/abc123`)
2. **Open it in your browser** — no install needed
3. **Sign in with GitHub** (OAuth popup — this only verifies you're in the `unleashlive` org)
4. You're in. What you can do depends on your role:

| Role | Can do |
|------|--------|
| **Driver** | Send prompts directly to the LLM, approve/reject Contributor suggestions, manage roles |
| **Contributor** | Submit prompt suggestions (Driver reviews before execution), vote in Vote Pool mode |
| **Viewer** | Read-only — see all messages and queue updates in real time |

Your role is set in the invite link. The Driver can change roles live from the session UI.

---

## For the server admin: running the server

### Prerequisites

- Docker (OrbStack recommended on Mac M-series)
- ngrok account (free tier works)
- A GitHub OAuth App registered at https://github.com/settings/developers
  - Callback URL: `https://your-ngrok-url/collab/auth/github/callback`
- Either an Anthropic API key **or** Claude Code subscription credentials

### Quick start

```bash
git clone https://github.com/unleashlive/opencode
cd opencode
cp .env.example .env        # then fill in the values
ngrok http 4096 &           # note your https URL
docker compose up --build -d
```

### Required `.env` values

```bash
# GitHub OAuth App (created at github.com/settings/developers)
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...

# GitHub org membership check
GITHUB_ORG_NAME=unleashlive
GITHUB_TOKEN=ghp_...        # PAT with read:org scope

# Public URL (ngrok URL for local testing, domain for production)
OPENCODE_BASE_URL=https://YOUR-NGROK-ID.ngrok-free.dev

# Random secret: openssl rand -hex 32
SESSION_SECRET=...

# LLM credentials — one of:
# Option A (default): Claude Code subscription — see "Credentials" section below
# Option B: API key (metered $)
# ANTHROPIC_API_KEY=sk-ant-...
```

### LLM credentials: two options

#### Option A — Claude Code subscription (recommended)
Leave `ANTHROPIC_API_KEY` unset (or absent from `.env`). The server uses the `opencode-claude-auth` plugin (already configured in the Docker image).
In production (ECS) the literal placeholder `ANTHROPIC_API_KEY=dummy` is **rejected** — ADR-0001 Phase 4 treats `"dummy"` as missing and refuses to boot.

On macOS, extract your credentials once:

```bash
# Run on the Mac that runs Docker:
security find-generic-password -s "Claude Code-credentials" -w > ~/.claude/.credentials.json
```

The `docker-compose.yml` bind-mounts `~/.claude/.credentials.json` into the container (read-only). If the token expires, run the command again — no container restart needed.

> **Important:** This shares *your* Claude subscription with the server — all LLM usage is billed to your account. Teammates do not need and cannot use their own Claude subscriptions through this path. If you want per-user billing, use the API key option with an org-level key.

#### Option B — Anthropic API key (metered $)
Set `ANTHROPIC_API_KEY=sk-ant-...` in `.env`. All LLM costs are billed to that key. The presence of a non-empty, non-`"dummy"` value bypasses the `opencode-claude-auth` plugin entirely.

---

## Creating a Collab Session (Driver flow)

1. Go to `http://localhost:4096/collab/new` (or your ngrok URL)
2. Sign in with your GitHub account
3. Fill in:
   - **Session name** — e.g. "Auth refactor sprint"
   - **Visibility while typing** — how much others see before you submit
   - **Prompt queue mode** — FIFO (first-come) or Vote Pool (democratic)
4. Click **Create Collab Session**
5. In the session view, click **Invite** → pick a role → copy the link
6. Share the link with teammates

---

## Does everyone need to commit / install from GitHub?

**Collaborators: No.** They only need a browser and the invite link. Nothing to clone or install.

**Anyone who wants to run their own server: Yes.** Clone this repo, copy `.env.example`, fill in credentials, and run `docker compose up --build -d`. The entire server is self-contained in Docker.

---

## Persisted data

| What | Where | Survives restart? |
|------|-------|-------------------|
| Sessions, messages, participants | Named volume `opencode-data` | ✅ Yes |
| Server-side repo workspaces | Named volume `collab-workspaces` | ✅ Yes |
| In-memory SSE connections | Container RAM | ❌ Reconnects on reload |
| Cookie sessions (GitHub auth) | Container RAM | ❌ Re-auth on restart |

---

## Updating ngrok URL

If your ngrok URL changes, update two things:

1. `.env` → `OPENCODE_BASE_URL=https://NEW-URL.ngrok-free.dev`
2. Your GitHub OAuth App's callback URL → `https://NEW-URL.ngrok-free.dev/collab/auth/github/callback`

Then: `docker compose up -d --force-recreate`

---

## What gets committed to GitHub

All source code changes are committed. Secrets are **never** committed.

```
.gitignore / .dockerignore already exclude:
  .env
  ~/.claude/.credentials.json  (bind-mounted from host, not in repo)
```

The `.env.example` file documents all required variables without values.

---

## Forge — LLM-driven development workflow

Forge is a structured workflow framework baked into every collab session. It replaces ad-hoc prompting with typed markdown artifacts — Feature Contexts, Implementation Contexts, plans, tasks — that persist in git, survive session restarts, and can be fed back to any LLM to resume work exactly where a previous session stopped.

### Pre-installed in every session

No manual setup needed. Every collab ECS container ships with:

| Path | Contents |
|---|---|
| `~/.config/opencode/commands/` | 28 Forge slash commands, auto-loaded by opencode |
| `~/.forge/` | Full Forge checkout (scripts, prompts, templates, adapters) |
| `~/.local/bin/forge` | The `forge` CLI, on PATH |

The Forge version installed is printed in the ECS build logs as `[forge-install] installed N Forge commands (version)`.

> **Note:** Forge commands are loaded at session startup. If you deployed a new image, start a **new** collab session to get them — existing sessions won't pick them up.

### The 3-layer model

```
FEAT-NNN (what & why)  →  IMPL-NNN (how, per stack)  →  plan · tasks · verify (do it)
```

- **FEAT-NNN** — Feature Context: product brief, user stories, success metrics. Lives in the vault under `features/`.
- **IMPL-NNN** — Implementation Context: technical spec for one stack, synthesised from a FEAT. Lives in `implementations/`. This is what you work against in a session.
- **Vault** — a git repo (or folder) holding all FEAT and IMPL artifacts. Auto-discovered from `git config forge.vault` or a `forge-vault/` sibling directory.
- **Execution artifacts** — `plan.md`, `tasks.md`, `verification.md`. Local to `<repo>/.forge/current/`, gitignored. Persisted to the vault via `/forge-snapshot`.

### Typical session workflow

```bash
# Brand-new implementation
/forge-status                  # see what's in the vault
/forge-plan   IMPL-042         # scaffold plan + tasks
/forge-loop   IMPL-042         # implement until all tasks done
/forge-verify IMPL-042         # verify acceptance criteria
/forge-pr     IMPL-042         # open PR with vault-derived body

# Picking up someone else's work
/forge-resume IMPL-042         # restore vault snapshot → ready to /forge-work
```

**Step-by-step:**

1. **Orient** — `/forge-status` or `/forge-status IMPL-NNN` for a single artifact. Run at session start.
2. **Resume** *(if continuing work)* — `/forge-resume IMPL-NNN` pulls the vault, restores execution artifacts from the latest snapshot, and reports the active task.
3. **Plan** *(if starting fresh)* — `/forge-plan IMPL-NNN` scaffolds `plan.md` + `tasks.md` and records a constitution baseline.
4. **Implement** — `/forge-work IMPL-NNN` picks the next pending task, implements it end-to-end, commits, and checkpoints. `/forge-loop` iterates until all tasks are terminal.
5. **Verify** — `/forge-verify IMPL-NNN` checks acceptance criteria and marks them green in `verification.md`.
6. **PR** — `/forge-pr IMPL-NNN` pushes the impl branch and opens a GitHub PR with a vault-derived body.
7. **Snapshot** *(handoff)* — `/forge-snapshot IMPL-NNN` saves current execution state to the vault so another session can resume from this exact point.

### Core commands reference

| Command | What it does | Argument |
|---|---|---|
| `/forge-status` | Vault-wide overview or single-artifact detail. Suggests next command based on state. | `[FEAT-NNN\|IMPL-NNN]` |
| `/forge-resume` | Restore a saved session: pull vault, checkout branch, restore execution artifacts. | `IMPL-NNN [--force]` |
| `/forge-plan` | Scaffold `plan.md`, `tasks.md`, `verification.md` for an Implementation Context. | `IMPL-NNN` |
| `/forge-work` | Expand and implement the next pending task end-to-end, commit, checkpoint. | `IMPL-NNN` |
| `/forge-loop` | Iterate `/forge-work` until all tasks are terminal. | `IMPL-NNN` |
| `/forge-verify` | Verify implementation against acceptance criteria; marks ACs green with evidence. | `IMPL-NNN` |
| `/forge-pr` | Push impl branch and open a GitHub PR with vault-derived body. | `IMPL-NNN` |
| `/forge-snapshot` | Commit execution artifacts to the vault so another session can resume. | `IMPL-NNN [-m "msg"]` |
| `/forge-specify` | Turn a rough idea into a structured Feature Context. | `feature idea` |
| `/forge-synthesize` | Synthesise an Implementation Context from a FEAT for a given repo/stack. | `FEAT-NNN --repo owner/repo` |
| `/forge-doctor` | Health check: vault link, branch state, forge version, required tooling. | — |
| `/forge-audit` | Scan diff for constitution anti-patterns and style violations. | — |

Full command reference (28 commands across 5 groups) is in the [Forge · Collab Session Reference](https://claude.ai/code/artifact/5b1acf08-7ab7-43cf-ac7b-b3ee8d199597) artifact.

### Vault & artifact paths

Forge auto-discovers the vault by looking for:
- `git config forge.vault` — explicit path set during `/forge-repo-init`
- A `forge-vault/` directory adjacent to the current repo checkout

Execution artifacts are gitignored in the target repo and shared between sessions only through vault snapshots:

```
<repo>/.forge/current/
  ├── plan.md           # implementation approach, design decisions
  ├── tasks.md          # task list with status, ACs, file list
  └── verification.md   # acceptance criteria, test plan, evidence

# After /forge-snapshot:
implementations/IMPL-NNN-slug/snapshot/
  ├── plan.md
  ├── tasks.md
  └── verification.md
```
