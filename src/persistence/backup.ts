import { z } from 'zod'
import { FIELD_KEYS, FIELD_STATES, INCIDENT_STATUSES, INCIDENT_TYPES } from '@/types/incident'
import { validateWorkflow } from '@/domain/workflow-engine/validate'
import type { Db, Stmt } from './db'
import { LATEST_SCHEMA_VERSION } from './migrate'

/** Parent tables first; restore deletes in reverse order. */
const TABLES = {
  app_settings: ['key', 'value'],
  workflow_definitions: ['id', 'name', 'schema_version', 'definition_json', 'builtin', 'updated_at'],
  incidents: ['id', 'status', 'created_at', 'updated_at', 'revision', 'incident_type'],
  incident_fields: ['incident_id', 'field', 'state', 'value', 'verified'],
  workflow_sessions: ['id', 'incident_id', 'workflow_id', 'updated_at'],
  session_answers: ['session_id', 'node_id', 'kind', 'option_id', 'answered_at', 'text_value'],
  incident_events: ['id', 'incident_id', 'at', 'kind', 'detail'],
} as const
type TableName = keyof typeof TABLES

const cell = z.union([z.string(), z.number(), z.null()])
const tableSchema = (t: TableName) => z.array(z.strictObject(Object.fromEntries(TABLES[t].map((c) => [c, cell]))))

const backupSchema = z.object({
  format: z.literal('dispatch-desk-backup'),
  schemaVersion: z.number().int(),
  createdAt: z.string(),
  tables: z.strictObject({
    app_settings: tableSchema('app_settings'),
    workflow_definitions: tableSchema('workflow_definitions'),
    incidents: tableSchema('incidents'),
    incident_fields: tableSchema('incident_fields'),
    workflow_sessions: tableSchema('workflow_sessions'),
    session_answers: tableSchema('session_answers'),
    incident_events: tableSchema('incident_events'),
  }),
})
export type Backup = z.infer<typeof backupSchema>

export async function exportBackup(db: Db): Promise<Backup> {
  const tables: Record<string, unknown[]> = {}
  for (const t of Object.keys(TABLES) as TableName[]) {
    tables[t] = await db.select(`SELECT ${TABLES[t].join(', ')} FROM ${t} ORDER BY 1, 2`)
  }
  return backupSchema.parse({ format: 'dispatch-desk-backup', schemaVersion: LATEST_SCHEMA_VERSION, createdAt: new Date().toISOString(), tables })
}

/** Validates shape, schema version, enum values and embedded workflows. Throws a readable Error. */
export function parseBackup(text: string): Backup {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Not a valid backup file (not JSON)')
  }
  const r = backupSchema.safeParse(json)
  if (!r.success) throw new Error(`Not a valid backup file: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`)
  const b = r.data
  if (b.schemaVersion !== LATEST_SCHEMA_VERSION) {
    throw new Error(`Backup is schema v${b.schemaVersion}; this app uses v${LATEST_SCHEMA_VERSION}`)
  }
  const statuses = new Set<string>(INCIDENT_STATUSES)
  const states = new Set<string>(FIELD_STATES)
  const keys = new Set<string>(FIELD_KEYS)
  const types = new Set<string>(INCIDENT_TYPES)
  if (b.tables.incidents.some((i) => !statuses.has(String(i.status)))) throw new Error('Backup contains an unknown incident status')
  if (b.tables.incidents.some((i) => !types.has(String(i.incident_type)))) throw new Error('Backup contains an unknown incident type')
  if (b.tables.incident_fields.some((f) => !states.has(String(f.state)) || !keys.has(String(f.field)))) throw new Error('Backup contains an unknown field or field state')
  for (const w of b.tables.workflow_definitions) {
    let def: unknown
    try {
      def = JSON.parse(String(w.definition_json))
    } catch {
      throw new Error(`Backup workflow "${String(w.id)}" is not valid JSON`)
    }
    const v = validateWorkflow(def)
    if (!v.ok) throw new Error(`Backup workflow "${String(w.id)}" is invalid: ${v.issues[0]?.message}`)
  }
  return b
}

/** Replaces ALL application data atomically; any failure leaves the current data untouched. */
export async function restoreBackup(db: Db, backup: Backup): Promise<void> {
  const names = Object.keys(TABLES) as TableName[]
  const stmts: Stmt[] = [...[...names].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }))]
  for (const t of names) {
    const cols = TABLES[t]
    const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    for (const row of backup.tables[t]) stmts.push({ sql, params: cols.map((c) => row[c as keyof typeof row] ?? null) })
  }
  await db.batch(stmts)
}
