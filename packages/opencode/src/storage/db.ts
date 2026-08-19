import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
export * from "drizzle-orm"
import { LocalContext } from "@/util/local-context"
import { Global } from "@opencode-ai/core/global"
import { NamedError } from "@opencode-ai/core/util/error"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import type { Database as BunDatabase } from "bun:sqlite"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { EffectBridge } from "@/effect/bridge"
import { init } from "#db"
import { Schema } from "effect"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create("NotFoundError", {
  message: Schema.String,
})

const log = {
  info: (msg: string, meta?: unknown) => console.info("[db]", msg, meta ?? ""),
}

export function getPath(): string {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return path.join(Global.Path.data, Flag.OPENCODE_DB)
  }
  // Mirror the channel-aware path that packages/core/src/database/database.ts
  // uses so both systems open the same SQLite file.  Pre-PR72, db.ts already
  // did this via getChannelPath; losing the suffix caused ECS deployments to
  // open a fresh opencode.db while the production data lived in opencode-local.db.
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env["OPENCODE_DISABLE_CHANNEL_DB"] === "1" ||
    process.env["OPENCODE_DISABLE_CHANNEL_DB"] === "true"
  )
    return path.join(Global.Path.data, "opencode.db")
  const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `opencode-${safe}.db`)
}

type Journal = { sql: string; timestamp: number; name: string }[]

// Drizzle's migrate overloads trigger expensive variance checks here; narrow to the journal overload we actually use.
const migrateFromJournal = migrate as unknown as (db: SQLiteBunDatabase, entries: Journal) => void

function applyMigrations(db: SQLiteBunDatabase, entries: Journal) {
  migrateFromJournal(db, entries)
}

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function migrations(dir: string): Journal {
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const sql = dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter(Boolean) as Journal

  return sql.sort((a, b) => a.timestamp - b.timestamp)
}

// Drizzle 1.0.0-rc.2 moved $client to private; re-expose it as public so
// collab code can access the underlying bun:sqlite handle directly.
export type TxOrDb = ReturnType<typeof init> & { readonly $client: BunDatabase }

let client: TxOrDb | undefined
let loaded = false

export const Client = Object.assign(
  (): TxOrDb => {
    if (loaded) return client as TxOrDb

    const dbPath = getPath()
    log.info("opening database", { path: dbPath })

    const db = init(dbPath)

    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA cache_size = -64000")
    db.run("PRAGMA foreign_keys = ON")
    db.run("PRAGMA wal_checkpoint(PASSIVE)")

    // Apply schema migrations
    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      // Drizzle beta.19 (used before the upstream sync to rc.2) tracked applied
      // migrations in a "migration" table with column "id" = folder name.
      // rc.2 switched to "__drizzle_migrations" with a "name" column.  On an
      // existing EFS database the old table is present but the new one is not,
      // so rc.2 sees all migrations as unapplied and tries to re-run them —
      // which then crashes because the schema columns already exist.
      // Fix: seed "__drizzle_migrations" from the legacy "migration" table
      // before handing off to applyMigrations so rc.2 skips already-done work.
      const hasLegacyTable = (db as unknown as TxOrDb).$client
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='migration'")
        .get()
      if (hasLegacyTable) {
        const oldRows = (db as unknown as TxOrDb).$client
          .prepare("SELECT id FROM migration")
          .all() as Array<{ id: string }>
        const oldNames = new Set(oldRows.map((r) => r.id));
        (db as unknown as TxOrDb).$client.exec(`
          CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
            id INTEGER PRIMARY KEY,
            hash text NOT NULL,
            created_at numeric,
            name text,
            applied_at TEXT
          )
        `)
        const insert = (db as unknown as TxOrDb).$client.prepare(
          `INSERT OR IGNORE INTO "__drizzle_migrations" (hash, created_at, name, applied_at) VALUES (?, ?, ?, ?)`,
        )
        const now = Date.now()
        let seeded = 0
        for (const entry of entries) {
          if (oldNames.has(entry.name)) {
            insert.run("legacy", now, entry.name, new Date().toISOString())
            seeded++
          }
        }
        if (seeded > 0)
          log.info("seeded legacy migration records into __drizzle_migrations", { count: seeded })
      }
      applyMigrations(db, entries)
    }

    client = db as TxOrDb
    loaded = true
    return client
  },
  {
    reset: () => {
      loaded = false
      client = undefined
    },
    loaded: () => loaded,
  },
)

export function close() {
  if (!Client.loaded()) return
  Client().$client.close()
  Client.reset()
}

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => any | Promise<any>) {
  const bound = EffectBridge.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const txCallback = EffectBridge.bind((tx: any) => ctx.provide({ tx, effects }, () => callback(tx as TxOrDb)))
      const result = Client().transaction(txCallback, { behavior: options?.behavior })
      for (const effect of effects) effect()
      return result as NotPromise<T>
    }
    throw err
  }
}

export * as Database from "./db"
