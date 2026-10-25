import type { Db, Stmt } from './db'
import init from '../../src-tauri/migrations/0001_init.sql?raw'
import incidentTypes from '../../src-tauri/migrations/0002_incident_types.sql?raw'
import textAnswers from '../../src-tauri/migrations/0003_text_answers.sql?raw'

export interface Migration {
  version: number
  name: string
  sql: string
  /** Rewrites or removes existing rows: the database is copied first. */
  destructive?: boolean
}

/** Append-only. Never edit a shipped migration; add a new one. Migrations must not drop user data. */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: init },
  { version: 2, name: 'incident_types', sql: incidentTypes, destructive: true },
  { version: 3, name: 'text_answers', sql: textAnswers },
]
export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0

const statements = (sql: string): Stmt[] =>
  sql
    .replace(/^\s*--.*$/gm, '') // comment lines may contain semicolons
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ sql: s }))

export async function migrate(db: Db, migrations: Migration[] = MIGRATIONS): Promise<void> {
  await db.batch([
    { sql: 'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)' },
  ])
  const rows = await db.select('SELECT MAX(version) AS v FROM schema_migrations')
  const current = Number(rows[0]?.v ?? 0)
  const latest = migrations.at(-1)?.version ?? 0
  if (current > latest) {
    throw new Error(`Database schema v${current} is newer than this app (v${latest}). Update the app; data was left untouched.`)
  }
  for (const m of migrations.filter((m) => m.version > current)) {
    // A database that has data gets a copy first; a failed backup stops the upgrade.
    if (m.destructive && current > 0) await db.backup?.(`before-v${m.version}`)
    // Each migration and its bookkeeping row commit together or not at all.
    await db.batch([
      ...statements(m.sql),
      { sql: 'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', params: [m.version, m.name, new Date().toISOString()] },
    ])
  }
}
