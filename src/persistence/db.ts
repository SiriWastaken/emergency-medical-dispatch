import { invoke } from '@tauri-apps/api/core'

export type Param = string | number | null
export type Row = Record<string, unknown>
export interface Stmt {
  sql: string
  params?: Param[]
  /** Abort and roll back the whole batch if this statement changes no rows. */
  expectChanges?: boolean
}

export class ConflictError extends Error {
  constructor() {
    super('This record was changed elsewhere since it was loaded. Reload it before saving again.')
    this.name = 'ConflictError'
  }
}

/** The only door to SQLite. Backed by Tauri commands in the app and node:sqlite in tests. */
export interface Db {
  select(sql: string, params?: Param[]): Promise<Row[]>
  /** All statements run in one transaction. Resolves to rows changed per statement. */
  batch(statements: Stmt[]): Promise<number[]>
  /** Writes a consistent copy of the database before a risky change. Optional so test stores can skip it. */
  backup?(label: string): Promise<void>
}

export const tauriDb: Db = {
  async backup(label) {
    await invoke<string>('db_backup', { label }).catch(rethrow)
  },
  async select(sql, params = []) {
    return invoke<Row[]>('db_select', { sql, params }).catch(rethrow)
  },
  async batch(statements) {
    const payload = statements.map((s) => ({ sql: s.sql, params: s.params ?? [], expect_changes: s.expectChanges ?? false }))
    return invoke<number[]>('db_batch', { statements: payload }).catch(rethrow)
  },
}

function rethrow(e: unknown): never {
  const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)
  throw msg.startsWith('CONFLICT') ? new ConflictError() : new Error(msg)
}
