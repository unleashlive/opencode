import { createResource, For, Show } from "solid-js"
import "./admin.css"

// ── Types matching GET /collab/admin/stats response ────────────────────────

interface AdminUser {
  github_id: number
  github_login: string
  github_avatar_url: string
  last_seen_at: number
  session_count: number
  suggestion_count: number
}

interface RecentSession {
  id: string
  name: string
  owner_github_login: string
  created_at: number
  repo_names: string | null
}

interface TopRepo {
  repo_full_name: string
  session_count: number
}

interface ActivePreview {
  sessionId: string
  repoFullName: string
  startedAt: number
  status: string
}

interface CrashSession {
  id: string
  name: string
  preview_crash_count: number
  preview_crash_at: number
}

interface CodeByRepo {
  repo_full_name: string
  commits: number
  additions: number
  deletions: number
}

interface AdminStats {
  serverUptimeSec: number
  serverStartedAt: number
  users: AdminUser[]
  sessions: {
    total: number
    active: number
    recent: RecentSession[]
  }
  topRepos: TopRepo[]
  previews: {
    activeCount: number
    activePreviews: ActivePreview[]
    totalRuntimeMs: number
    crashSessions: CrashSession[]
  }
  llm: { total: number; approved: number; rejected: number }
  code: {
    total: { commits: number | null; additions: number | null; deletions: number | null } | null
    byRepo: CodeByRepo[]
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDuration(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  return parts.length > 0 ? parts.join(" ") : "<1m"
}

function fmtMs(ms: number): string {
  return fmtDuration(Math.floor(ms / 1000))
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function fmtRelative(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return "just now"
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function StatCard(props: { label: string; value: string | number; sub?: string }) {
  return (
    <div data-component="admin-stat-card">
      <div data-slot="value">{props.value}</div>
      <div data-slot="label">{props.label}</div>
      <Show when={props.sub}>
        <div data-slot="sub">{props.sub}</div>
      </Show>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function CollabAdmin() {
  const [stats] = createResource<AdminStats>(async () => {
    const res = await fetch("/collab/admin/stats")
    if (!res.ok) {
      if (res.status === 401) throw new Error("Not authenticated — please log in first.")
      throw new Error(`Failed to load admin stats: HTTP ${res.status}`)
    }
    return res.json() as Promise<AdminStats>
  })

  return (
    <div data-page="collab-admin">
      <header data-component="admin-header">
        <h1>Admin</h1>
        <a href="/collab/new" data-slot="back">← Sessions</a>
      </header>

      <Show when={stats.error}>
        <div data-component="admin-error">{String((stats.error as Error)?.message ?? stats.error)}</div>
      </Show>

      <Show when={stats.loading && !stats()}>
        <div data-component="admin-loading">Loading stats…</div>
      </Show>

      <Show when={stats()}>
        {(s) => (
          <>
            {/* ── Server ── */}
            <section data-component="admin-section">
              <h2>Server</h2>
              <div data-component="admin-stat-grid">
                <StatCard label="Uptime" value={fmtDuration(s().serverUptimeSec)} />
                <StatCard label="Started" value={fmtDate(s().serverStartedAt)} />
                <StatCard label="Active previews" value={s().previews.activeCount} />
                <StatCard label="Total users" value={s().users.length} />
              </div>
            </section>

            {/* ── Sessions ── */}
            <section data-component="admin-section">
              <h2>Sessions</h2>
              <div data-component="admin-stat-grid">
                <StatCard label="Total" value={s().sessions.total} />
                <StatCard label="Active" value={s().sessions.active} />
              </div>
              <Show when={s().sessions.recent.length > 0}>
                <table data-component="admin-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Owner</th>
                      <th>Repos</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={s().sessions.recent}>
                      {(sess) => (
                        <tr>
                          <td>
                            <a href={`/collab/${sess.id}`}>{sess.name}</a>
                          </td>
                          <td>@{sess.owner_github_login}</td>
                          <td data-slot="repos">{sess.repo_names ?? "—"}</td>
                          <td>{fmtRelative(sess.created_at)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </section>

            {/* ── Top repos ── */}
            <Show when={s().topRepos.length > 0}>
              <section data-component="admin-section">
                <h2>Top repos</h2>
                <table data-component="admin-table">
                  <thead>
                    <tr>
                      <th>Repo</th>
                      <th>Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={s().topRepos}>
                      {(repo) => (
                        <tr>
                          <td>{repo.repo_full_name}</td>
                          <td>{repo.session_count}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </section>
            </Show>

            {/* ── Previews ── */}
            <section data-component="admin-section">
              <h2>Preview servers</h2>
              <div data-component="admin-stat-grid">
                <StatCard label="Running now" value={s().previews.activeCount} />
                <StatCard label="Total runtime" value={fmtMs(s().previews.totalRuntimeMs)} />
              </div>
              <Show when={s().previews.activePreviews.length > 0}>
                <table data-component="admin-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Repo</th>
                      <th>Status</th>
                      <th>Running for</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={s().previews.activePreviews}>
                      {(p) => (
                        <tr>
                          <td>
                            <a href={`/collab/${p.sessionId}`}>{p.sessionId.slice(0, 8)}</a>
                          </td>
                          <td>{p.repoFullName}</td>
                          <td data-slot={`status-${p.status}`}>{p.status}</td>
                          <td>{fmtMs(Date.now() - p.startedAt)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </section>

            {/* ── LLM usage ── */}
            <section data-component="admin-section">
              <h2>LLM usage</h2>
              <div data-component="admin-stat-grid">
                <StatCard label="Total prompts" value={s().llm.total} />
                <StatCard label="Approved" value={s().llm.approved} />
                <StatCard label="Rejected" value={s().llm.rejected} />
                <StatCard
                  label="Approval rate"
                  value={
                    s().llm.total > 0
                      ? `${Math.round((s().llm.approved / s().llm.total) * 100)}%`
                      : "—"
                  }
                />
              </div>
            </section>

            {/* ── Code stats ── */}
            <section data-component="admin-section">
              <h2>Code written</h2>
              <div data-component="admin-stat-grid">
                <StatCard label="Commits" value={s().code.total?.commits ?? 0} />
                <StatCard label="Lines added" value={`+${s().code.total?.additions ?? 0}`} />
                <StatCard label="Lines deleted" value={`-${s().code.total?.deletions ?? 0}`} />
              </div>
              <Show when={s().code.byRepo.length > 0}>
                <table data-component="admin-table">
                  <thead>
                    <tr>
                      <th>Repo</th>
                      <th>Commits</th>
                      <th>+Lines</th>
                      <th>-Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={s().code.byRepo}>
                      {(r) => (
                        <tr>
                          <td>{r.repo_full_name}</td>
                          <td>{r.commits}</td>
                          <td data-slot="additions">+{r.additions}</td>
                          <td data-slot="deletions">-{r.deletions}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </section>

            {/* ── Users ── */}
            <section data-component="admin-section">
              <h2>Users</h2>
              <table data-component="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Last seen</th>
                    <th>Sessions</th>
                    <th>Prompts</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={s().users}>
                    {(u) => (
                      <tr>
                        <td data-slot="user">
                          <img
                            src={u.github_avatar_url}
                            alt={u.github_login}
                            width="20"
                            height="20"
                            data-slot="avatar"
                          />
                          <a href={`https://github.com/${u.github_login}`} target="_blank" rel="noopener">
                            @{u.github_login}
                          </a>
                        </td>
                        <td>{fmtRelative(u.last_seen_at)}</td>
                        <td>{u.session_count}</td>
                        <td>{u.suggestion_count}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </section>

            {/* ── Crashes ── */}
            <Show when={s().previews.crashSessions.length > 0}>
              <section data-component="admin-section">
                <h2>Preview crashes</h2>
                <table data-component="admin-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Crashes</th>
                      <th>Last crash</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={s().previews.crashSessions}>
                      {(c) => (
                        <tr>
                          <td>
                            <a href={`/collab/${c.id}`}>{c.name}</a>
                          </td>
                          <td>{c.preview_crash_count}</td>
                          <td>{c.preview_crash_at ? fmtRelative(c.preview_crash_at) : "—"}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </section>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
