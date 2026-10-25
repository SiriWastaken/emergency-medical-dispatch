import { z } from 'zod'
import { emptyField, fieldValueSchema, FIELD_KEYS, INCIDENT_STATUSES, INCIDENT_TYPES, type Incident, type IncidentStatus, type IncidentSummary, type IncidentType } from '@/types/incident'
import type { Answers } from '@/types/workflow'
import type { Db, Param, Stmt } from './db'

export interface SessionState {
  workflowId: string
  answers: Answers
}

const incidentRow = z.object({
  id: z.string(),
  incident_type: z.enum(INCIDENT_TYPES),
  status: z.enum(INCIDENT_STATUSES),
  created_at: z.string(),
  updated_at: z.string(),
  revision: z.number(),
})
const fieldRow = z.object({ field: z.enum(FIELD_KEYS), state: fieldValueSchema.shape.state, value: z.string(), verified: z.number() })
const answerRow = z.object({ node_id: z.string(), kind: z.enum(['option', 'unknown', 'unavailable', 'not_asked', 'text']), option_id: z.string().nullable(), text_value: z.string().nullable(), answered_at: z.string() })
const summaryRow = z.object({
  id: z.string(),
  incident_type: z.enum(INCIDENT_TYPES),
  status: z.enum(INCIDENT_STATUSES),
  updated_at: z.string(),
  patient: z.string().nullable(),
  caller: z.string().nullable(),
  complaint: z.string().nullable(),
})

const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
/** Readable and unique: type, date, and a random suffix (the primary key is the final guard). */
export function newIncidentId(type: IncidentType, now: Date): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  const suffix = Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
  return `${type}-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${suffix}`
}

export const blankFields = (): Incident['fields'] =>
  Object.fromEntries(FIELD_KEYS.map((k) => [k, emptyField()])) as Incident['fields']

const sessionId = (incidentId: string) => `S-${incidentId}`

export async function createIncident(db: Db, type: IncidentType, now = new Date()): Promise<Incident> {
  for (let attempt = 0; ; attempt++) {
    const id = newIncidentId(type, now)
    const at = now.toISOString()
    try {
      await db.batch([{ sql: 'INSERT INTO incidents (id, incident_type, status, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, 1)', params: [id, type, 'draft', at, at] }])
      return { id, type, status: 'draft', createdAt: at, updatedAt: at, revision: 1, fields: blankFields() }
    } catch (e) {
      // Primary-key collision on a random suffix: try a fresh id.
      if (attempt < 5 && e instanceof Error && /UNIQUE|constraint/i.test(e.message)) continue
      throw e
    }
  }
}

/** Always reads from SQLite; nothing here is cached. */
export async function loadIncident(db: Db, id: string): Promise<Incident | null> {
  const [row] = await db.select('SELECT * FROM incidents WHERE id = ?', [id])
  if (!row) return null
  const inc = incidentRow.parse(row)
  const fields = blankFields()
  for (const r of await db.select('SELECT field, state, value, verified FROM incident_fields WHERE incident_id = ?', [id])) {
    const f = fieldRow.parse(r)
    fields[f.field] = { state: f.state, value: f.value, ...(f.verified ? { verified: true } : {}) }
  }
  return { id: inc.id, type: inc.incident_type, status: inc.status, createdAt: inc.created_at, updatedAt: inc.updated_at, revision: inc.revision, fields }
}

export async function loadSession(db: Db, incidentId: string): Promise<SessionState | null> {
  const [s] = await db.select('SELECT id, workflow_id FROM workflow_sessions WHERE incident_id = ?', [incidentId])
  if (!s) return null
  const answers: Answers = {}
  for (const r of await db.select('SELECT node_id, kind, option_id, text_value, answered_at FROM session_answers WHERE session_id = ?', [String(s.id)])) {
    const a = answerRow.parse(r)
    if (a.kind === 'option') {
      if (a.option_id === null) throw new Error(`Saved answer for "${a.node_id}" has no option`)
      answers[a.node_id] = { kind: 'option', optionId: a.option_id, at: a.answered_at }
    } else if (a.kind === 'text') {
      if (a.text_value === null) throw new Error(`Saved answer for "${a.node_id}" has no text`)
      answers[a.node_id] = { kind: 'text', value: a.text_value, at: a.answered_at }
    } else answers[a.node_id] = { kind: a.kind, at: a.answered_at }
  }
  return { workflowId: String(s.workflow_id), answers }
}

export interface SavedCase {
  incident: Incident
  session: SessionState | null
}

const same = (a: Incident['fields'][keyof Incident['fields']], b: typeof a) => a.state === b.state && a.value === b.value && !!a.verified === !!b.verified

/**
 * Writes the incident, its changed fields and the workflow session in one transaction. Fails with
 * ConflictError if the stored revision differs from `next.incident.revision`, so an older copy can
 * never overwrite newer data.
 */
export async function saveCase(db: Db, saved: SavedCase, next: SavedCase, now = new Date()): Promise<Incident> {
  const at = now.toISOString()
  const inc = next.incident
  const stmts: Stmt[] = [
    {
      sql: 'UPDATE incidents SET status = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?',
      params: [inc.status, at, inc.id, inc.revision],
      expectChanges: true,
    },
  ]
  for (const k of FIELD_KEYS) {
    if (same(saved.incident.fields[k], inc.fields[k])) continue
    const f = inc.fields[k]
    stmts.push({
      sql: 'INSERT INTO incident_fields (incident_id, field, state, value, verified) VALUES (?, ?, ?, ?, ?) ON CONFLICT(incident_id, field) DO UPDATE SET state = excluded.state, value = excluded.value, verified = excluded.verified',
      params: [inc.id, k, f.state, f.value, f.verified ? 1 : 0],
    })
  }
  stmts.push(...sessionStatements(inc.id, at, saved.session, next.session))
  await db.batch(stmts)
  return { ...inc, updatedAt: at, revision: inc.revision + 1 }
}

function sessionStatements(incidentId: string, at: string, before: SessionState | null, after: SessionState | null): Stmt[] {
  const sid = sessionId(incidentId)
  if (!after) return before ? [{ sql: 'DELETE FROM workflow_sessions WHERE id = ?', params: [sid] }] : []
  if (before && before.workflowId === after.workflowId && JSON.stringify(before.answers) === JSON.stringify(after.answers)) return []
  const out: Stmt[] = [
    {
      sql: 'INSERT INTO workflow_sessions (id, incident_id, workflow_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET workflow_id = excluded.workflow_id, updated_at = excluded.updated_at',
      params: [sid, incidentId, after.workflowId, at],
    },
    { sql: 'DELETE FROM session_answers WHERE session_id = ?', params: [sid] },
  ]
  for (const [nodeId, a] of Object.entries(after.answers)) {
    out.push({
      sql: 'INSERT INTO session_answers (session_id, node_id, kind, option_id, text_value, answered_at) VALUES (?, ?, ?, ?, ?, ?)',
      params: [sid, nodeId, a.kind, a.kind === 'option' ? a.optionId : null, a.kind === 'text' ? a.value : null, a.at],
    })
  }
  return out
}

export interface IncidentFilter {
  query?: string
  status?: IncidentStatus | 'all'
  type?: IncidentType | 'all'
}

/** Newest first. Search covers id, patient and caller names, nature of the call, location and description. */
export async function listIncidents(db: Db, { query = '', status = 'all', type = 'all' }: IncidentFilter = {}): Promise<IncidentSummary[]> {
  const where: string[] = []
  const params: Param[] = []
  if (status !== 'all') {
    where.push('i.status = ?')
    params.push(status)
  }
  if (type !== 'all') {
    where.push('i.incident_type = ?')
    params.push(type)
  }
  const q = query.trim()
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
    where.push(`(i.id LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM incident_fields s WHERE s.incident_id = i.id AND s.state = 'answered' AND s.field IN ('patientName','callerName','complaint','location','description') AND s.value LIKE ? ESCAPE '\\'))`)
    params.push(like, like)
  }
  const field = (f: string) => `(SELECT value FROM incident_fields WHERE incident_id = i.id AND field = '${f}' AND state = 'answered')`
  const sql = `SELECT i.id, i.incident_type, i.status, i.updated_at, ${field('patientName')} AS patient, ${field('callerName')} AS caller, ${field('complaint')} AS complaint
    FROM incidents i ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY i.updated_at DESC, i.id`
  return (await db.select(sql, params)).map((r) => {
    const s = summaryRow.parse(r)
    return { id: s.id, type: s.incident_type, status: s.status, updatedAt: s.updated_at, name: (s.incident_type === 'EMS' ? s.patient || s.caller : s.caller) ?? '', complaint: s.complaint ?? '' }
  })
}

const DELETE_CALL = (where: string): string[] => [
  `DELETE FROM session_answers WHERE session_id IN (SELECT id FROM workflow_sessions WHERE incident_id ${where})`,
  `DELETE FROM workflow_sessions WHERE incident_id ${where}`,
  `DELETE FROM incident_events WHERE incident_id ${where}`,
  `DELETE FROM incident_fields WHERE incident_id ${where}`,
  `DELETE FROM incidents WHERE id ${where}`,
]

/** Permanently removes one call and everything recorded about it, in one transaction. */
export async function deleteIncident(db: Db, id: string): Promise<void> {
  await db.batch(DELETE_CALL('= ?').map((sql) => ({ sql, params: [id] })))
}

/** Permanently removes every call. Workflows, the chief-complaint list and settings are left alone. */
export async function deleteAllIncidents(db: Db): Promise<number> {
  const [row] = await db.select('SELECT COUNT(*) AS n FROM incidents')
  await db.batch(DELETE_CALL('IS NOT NULL').map((sql) => ({ sql })))
  return Number(row?.n ?? 0)
}
