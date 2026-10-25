import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ConflictError, type Db, type Param } from '@/persistence/db'

/** node:sqlite stand-in for the Tauri bridge, with the same transaction, conflict and backup semantics. */
export function memoryDb(path = ':memory:'): Db & { close(): void; backups: string[] } {
  const sqlite = new DatabaseSync(path)
  sqlite.exec('PRAGMA foreign_keys = ON')
  const backups: string[] = []
  return {
    backups,
    async select(sql, params = []) {
      return sqlite.prepare(sql).all(...(params as Param[])).map((r) => ({ ...r }))
    },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const changes = statements.map((s) => {
          const n = Number(sqlite.prepare(s.sql).run(...(s.params ?? [])).changes)
          if (s.expectChanges && n === 0) throw new ConflictError()
          return n
        })
        sqlite.exec('COMMIT')
        return changes
      } catch (e) {
        sqlite.exec('ROLLBACK')
        throw e
      }
    },
    async backup(label) {
      const file = join(mkdtempSync(join(tmpdir(), 'emd-backup-')), `${label}.sqlite3`)
      sqlite.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`)
      backups.push(file)
    },
    close: () => sqlite.close(),
  }
}
