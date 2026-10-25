import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { memoryDb } from '@/test/memoryDb'
import { BRANCHING, CONDITIONAL } from '@/test/fixtures'
import { ConflictError } from './db'
import { migrate, MIGRATIONS, LATEST_SCHEMA_VERSION } from './migrate'
import { createIncident, listIncidents, loadIncident, loadSession, saveCase } from './incidents'
import { deleteWorkflow, listWorkflows, saveWorkflow, seedBuiltinWorkflows } from './settings'
import { exportBackup, parseBackup, restoreBackup } from './backup'
import type { Incident } from '@/types/incident'

let db: ReturnType<typeof memoryDb>
beforeEach(async () => {
  db = memoryDb()
  await migrate(db)
})

const edit = (i: Incident, patch: Partial<Incident['fields']>): Incident => ({ ...i, fields: { ...i.fields, ...patch } })
const ans = (value: string) => ({ state: 'answered' as const, value })
const count = async (table: string) => Number((await db.select(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n)

describe('fresh install', () => {
  it('starts with no incidents, sessions, workflows or history rows', async () => {
    for (const t of ['incidents', 'incident_fields', 'workflow_sessions', 'session_answers', 'workflow_definitions', 'incident_events']) expect(await count(t), t).toBe(0)
    expect(await listIncidents(db)).toEqual([])
  })
})

describe('migrations', () => {
  it('creates the schema and is idempotent', async () => {
    await migrate(db)
    expect((await db.select('SELECT COUNT(*) AS n FROM schema_migrations'))[0]?.n).toBe(MIGRATIONS.length)
  })

  it('refuses a database from a newer app and leaves it untouched', async () => {
    await db.batch([{ sql: "INSERT INTO schema_migrations VALUES (99, 'future', 'x')" }])
    await expect(migrate(db)).rejects.toThrow(/newer than this app/)
  })

  it('applies a later additive migration without touching data', async () => {
    const inc = await createIncident(db, 'EMS')
    await migrate(db, [...MIGRATIONS, { version: 4, name: 'add-col', sql: 'ALTER TABLE incidents ADD COLUMN note TEXT' }])
    expect(await loadIncident(db, inc.id)).not.toBeNull()
  })

  it('rolls a failing migration back entirely', async () => {
    await expect(migrate(db, [...MIGRATIONS, { version: 4, name: 'bad', sql: 'CREATE TABLE t2 (a); SELECT nope FROM missing' }])).rejects.toThrow()
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 't2'")).toHaveLength(0)
    expect((await db.select('SELECT MAX(version) AS v FROM schema_migrations'))[0]?.v).toBe(LATEST_SCHEMA_VERSION)
  })
})

describe('upgrade from the previous schema (v1) with real user data', () => {
  /** Builds what the previous app version left on disk. */
  async function v1Database() {
    const old = memoryDb()
    await migrate(old, [MIGRATIONS[0]!])
    const t = '2026-10-24T18:00:00.000Z'
    const inc = (id: string, status: string) => ({ sql: 'INSERT INTO incidents (id, status, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 3)', params: [id, status, t, t] })
    const fld = (id: string, field: string, value: string, state = 'answered') => ({ sql: 'INSERT INTO incident_fields (incident_id, field, state, value) VALUES (?, ?, ?, ?)', params: [id, field, state, value] })
    const wf = (id: string, status: string) => ({
      sql: 'INSERT INTO workflow_definitions (id, name, schema_version, definition_json, builtin, updated_at) VALUES (?, ?, 1, ?, 1, ?)',
      params: [id, id, JSON.stringify({ ...BRANCHING, id, status, provenance: { origin: 'original-demo', note: 'demo' } }), t],
    })
    await old.batch([
      inc('INC-20261001-AAAA', 'draft'), // first-generation record: no service field at all
      fld('INC-20261001-AAAA', 'patientName', 'Legacy Patient'),
      fld('INC-20261001-AAAA', 'patientAge', '70'),
      inc('INC-20261002-BBBB', 'open'),
      fld('INC-20261002-BBBB', 'service', 'PD'),
      fld('INC-20261002-BBBB', 'patientName', 'Entered As Patient'),
      fld('INC-20261002-BBBB', 'callerPhone', '555-0000'),
      inc('INC-20261003-CCCC', 'completed'),
      fld('INC-20261003-CCCC', 'service', 'FD'),
      fld('INC-20261003-CCCC', 'sex', '', 'unknown'),
      wf('used-demo', 'demo'),
      wf('unused-demo', 'demo'),
      { sql: "INSERT INTO workflow_sessions (id, incident_id, workflow_id, updated_at) VALUES ('S-1', 'INC-20261002-BBBB', 'used-demo', ?)", params: [t] },
      { sql: "INSERT INTO session_answers (session_id, node_id, kind, option_id, answered_at) VALUES ('S-1', 'setting', 'option', 'indoors', ?)", params: [t] },
    ])
    return old
  }

  it('keeps every incident, id and field; adds the type; maps statuses; does not invent caller names', async () => {
    const old = await v1Database()
    await migrate(old)
    expect(old.backups).toHaveLength(1) // database copied before the destructive step
    expect((await listIncidents(old)).map((i) => [i.id, i.type, i.status]).sort()).toEqual([
      ['INC-20261001-AAAA', 'EMS', 'draft'],
      ['INC-20261002-BBBB', 'PD', 'active'],
      ['INC-20261003-CCCC', 'FD', 'closed'],
    ])
    const legacy = await loadIncident(old, 'INC-20261001-AAAA')
    expect(legacy?.fields.patientName).toEqual({ state: 'answered', value: 'Legacy Patient' })
    expect(legacy?.fields.patientAge.value).toBe('70')
    expect(legacy?.revision).toBe(3)
    const pd = await loadIncident(old, 'INC-20261002-BBBB')
    expect(pd?.fields.callerName.state).toBe('unanswered') // never silently copied from patientName
    expect(pd?.fields.patientName.value).toBe('Entered As Patient') // still stored, just not shown for PD
    expect(pd?.fields.callerPhone.value).toBe('555-0000')
    expect((await loadIncident(old, 'INC-20261003-CCCC'))?.fields.sex.state).toBe('unknown')
    expect(await old.select("SELECT 1 FROM incident_fields WHERE field = 'service'")).toHaveLength(0)
  })

  it('keeps sessions and the workflow they use, drops only unreferenced bundled demos', async () => {
    const old = await v1Database()
    await migrate(old)
    expect((await loadSession(old, 'INC-20261002-BBBB'))?.answers.setting).toMatchObject({ optionId: 'indoors' })
    const { workflows, problems } = await listWorkflows(old)
    expect(problems).toEqual([])
    expect(workflows.map((w) => w.definition.id)).toEqual(['used-demo'])
    expect(workflows[0]).toMatchObject({ builtin: false, definition: { status: 'pending-validation', provenance: { origin: 'user-import' } } })
  })

  it('does not back up a brand-new database (nothing to protect) and a failing backup stops the upgrade', async () => {
    const fresh = memoryDb()
    await migrate(fresh)
    expect(fresh.backups).toHaveLength(0)
    const old = await v1Database()
    old.backup = async () => {
      throw new Error('disk full')
    }
    await expect(migrate(old)).rejects.toThrow(/disk full/)
    expect((await old.select('SELECT MAX(version) AS v FROM schema_migrations'))[0]?.v).toBe(1)
    expect(await old.select('SELECT 1 FROM incidents')).toHaveLength(3)
  })
})

describe('incidents', () => {
  it('creates readable unique ids prefixed by type, as drafts with every field unanswered', async () => {
    const a = await createIncident(db, 'EMS')
    const b = await createIncident(db, 'PD')
    expect(a.id).toMatch(/^EMS-\d{8}-[A-Z0-9]{4}$/)
    expect(b.id).toMatch(/^PD-\d{8}-[A-Z0-9]{4}$/)
    expect(a.status).toBe('draft')
    expect(Object.values(a.fields).every((f) => f.state === 'unanswered')).toBe(true)
    expect(await count('incidents')).toBe(2)
  })

  it('saves edits and reloads them from SQLite after a restart, with distinct states and verified flags', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'emd-')), 'a.sqlite3')
    const file = memoryDb(path)
    await migrate(file)
    const inc = await createIncident(file, 'PD')
    const edited = edit(inc, { callerName: { state: 'answered', value: 'Alex', verified: true }, callerPhone: { state: 'unknown', value: '' }, location: { state: 'not_asked', value: '' } })
    await saveCase(file, { incident: inc, session: null }, { incident: { ...edited, status: 'active' }, session: null })
    file.close()

    const reopened = memoryDb(path)
    await migrate(reopened)
    const loaded = await loadIncident(reopened, inc.id)
    expect(loaded).toMatchObject({ type: 'PD', status: 'active', revision: 2 })
    expect(loaded?.fields.callerName).toEqual({ state: 'answered', value: 'Alex', verified: true })
    expect(loaded?.fields.callerPhone.state).toBe('unknown')
    expect(loaded?.fields.location.state).toBe('not_asked')
    expect(loaded?.fields.description.state).toBe('unanswered')
    reopened.close()
  })

  it('rejects a stale save and writes nothing', async () => {
    const inc = await createIncident(db, 'EMS')
    const saved = { incident: inc, session: null }
    await saveCase(db, saved, { incident: edit(inc, { sex: ans('Female') }), session: null })
    await expect(saveCase(db, saved, { incident: edit(inc, { sex: ans('Male') }), session: null })).rejects.toBeInstanceOf(ConflictError)
    expect((await loadIncident(db, inc.id))?.fields.sex.value).toBe('Female')
  })

  it('saves in order so a newer revision always wins over an older write', async () => {
    const inc = await createIncident(db, 'EMS')
    const s1 = await saveCase(db, { incident: inc, session: null }, { incident: edit(inc, { patientName: ans('One') }), session: null })
    const s2 = await saveCase(db, { incident: edit(inc, { patientName: ans('One') }), session: null }, { incident: edit(s1, { patientName: ans('Two') }), session: null })
    expect(s2.revision).toBe(3)
    // a delayed copy of the first save cannot land after the second
    await expect(saveCase(db, { incident: inc, session: null }, { incident: edit(inc, { patientName: ans('One') }), session: null })).rejects.toBeInstanceOf(ConflictError)
    expect((await loadIncident(db, inc.id))?.fields.patientName.value).toBe('Two')
  })

  it('saves and clears workflow session answers, including unavailable', async () => {
    await saveWorkflow(db, BRANCHING)
    const inc = await createIncident(db, 'PD')
    const session = { workflowId: BRANCHING.id, answers: { setting: { kind: 'unavailable' as const, at: 't1' } } }
    const next = await saveCase(db, { incident: inc, session: null }, { incident: inc, session })
    expect(await loadSession(db, inc.id)).toEqual(session)
    await saveCase(db, { incident: next, session }, { incident: next, session: null })
    expect(await loadSession(db, inc.id)).toBeNull()
  })

  it('saves and reloads typed answers, and the v3 migration keeps existing answers', async () => {
    await saveWorkflow(db, BRANCHING)
    const inc = await createIncident(db, 'PD')
    const session = { workflowId: BRANCHING.id, answers: { setting: { kind: 'text' as const, value: 'Typed answer', at: 't' }, other: { kind: 'option' as const, optionId: 'x', at: 't' } } }
    await saveCase(db, { incident: inc, session: null }, { incident: inc, session })
    expect(await loadSession(db, inc.id)).toEqual(session)

    const old = memoryDb()
    await migrate(old, MIGRATIONS.slice(0, 2)) // the schema before typed answers
    await old.batch([
      { sql: "INSERT INTO incidents (id, incident_type, status, created_at, updated_at, revision) VALUES ('PD-1', 'PD', 'draft', 't', 't', 1)" },
      { sql: "INSERT INTO workflow_definitions (id, name, schema_version, definition_json, builtin, updated_at) VALUES ('w', 'w', 1, '{}', 0, 't')" },
      { sql: "INSERT INTO workflow_sessions (id, incident_id, workflow_id, updated_at) VALUES ('S-PD-1', 'PD-1', 'w', 't')" },
      { sql: "INSERT INTO session_answers (session_id, node_id, kind, option_id, answered_at) VALUES ('S-PD-1', 'n', 'option', 'o', 't')" },
    ])
    await migrate(old)
    expect(await loadSession(old, 'PD-1')).toEqual({ workflowId: 'w', answers: { n: { kind: 'option', optionId: 'o', at: 't' } } })
  })

  it('searches across EMS and PD by id, patient name, caller name, nature, location and description; filters by type and status', async () => {
    const e = await createIncident(db, 'EMS')
    const p = await createIncident(db, 'PD')
    await saveCase(db, { incident: e, session: null }, { incident: { ...edit(e, { patientName: ans('Zed Quill'), complaint: ans('Fall'), location: ans('12 Oak Road') }), status: 'active' }, session: null })
    await saveCase(db, { incident: p, session: null }, { incident: edit(p, { callerName: ans('Mia Caller'), complaint: ans('Noise complaint'), description: ans('Music at 3am') }), session: null })
    const ids = async (f: Parameters<typeof listIncidents>[1]) => (await listIncidents(db, f)).map((i) => i.id).sort()
    expect(await ids({ query: 'quill' })).toEqual([e.id])
    expect(await ids({ query: 'mia' })).toEqual([p.id])
    expect(await ids({ query: 'noise' })).toEqual([p.id])
    expect(await ids({ query: 'oak road' })).toEqual([e.id])
    expect(await ids({ query: 'music' })).toEqual([p.id])
    expect(await ids({ query: p.id.slice(-4) })).toContain(p.id)
    expect(await ids({ type: 'PD' })).toEqual([p.id])
    expect(await ids({ status: 'active' })).toEqual([e.id])
    expect(await ids({ type: 'EMS', status: 'draft' })).toEqual([])
    expect(await ids({ query: '100%' })).toEqual([])
    const rows = await listIncidents(db)
    expect(rows.find((r) => r.id === p.id)).toMatchObject({ type: 'PD', name: 'Mia Caller' })
    expect(rows.find((r) => r.id === e.id)).toMatchObject({ type: 'EMS', name: 'Zed Quill' })
  })
})

describe('workflow storage', () => {
  it('protects bundled workflows from overwrite and requires explicit overwrite for custom ones', async () => {
    await seedBuiltinWorkflows(db, [BRANCHING])
    await expect(saveWorkflow(db, BRANCHING, true)).rejects.toThrow(/built-in/)
    const w = { ...CONDITIONAL, id: 'custom', name: 'Custom' }
    await saveWorkflow(db, w)
    await expect(saveWorkflow(db, { ...w, name: 'Changed' })).rejects.toThrow(/already exists/)
    await saveWorkflow(db, { ...w, name: 'Changed' }, true)
    expect((await listWorkflows(db)).workflows.find((x) => x.definition.id === 'custom')?.definition.name).toBe('Changed')
  })

  it('refuses to delete a workflow that sessions use', async () => {
    await saveWorkflow(db, { ...BRANCHING, id: 'custom' })
    const inc = await createIncident(db, 'PD')
    await saveCase(db, { incident: inc, session: null }, { incident: inc, session: { workflowId: 'custom', answers: {} } })
    await expect(deleteWorkflow(db, 'custom')).rejects.toThrow(/used by/)
  })
})

describe('backup and restore', () => {
  it('round-trips all data through JSON, including type and verified flags', async () => {
    await saveWorkflow(db, BRANCHING)
    const inc = await createIncident(db, 'PD')
    const edited = edit(inc, { callerName: { state: 'answered', value: 'Backup Caller', verified: true } })
    await saveCase(db, { incident: inc, session: null }, { incident: edited, session: { workflowId: BRANCHING.id, answers: { setting: { kind: 'unknown', at: 't' } } } })
    const text = JSON.stringify(await exportBackup(db))
    const fresh = memoryDb()
    await migrate(fresh)
    await restoreBackup(fresh, parseBackup(text))
    const back = await loadIncident(fresh, inc.id)
    expect(back?.type).toBe('PD')
    expect(back?.fields.callerName).toEqual({ state: 'answered', value: 'Backup Caller', verified: true })
    expect((await loadSession(fresh, inc.id))?.answers.setting).toEqual({ kind: 'unknown', at: 't' })
  })

  it('restore replaces current data', async () => {
    const keep = await createIncident(db, 'EMS')
    const backup = parseBackup(JSON.stringify(await exportBackup(db)))
    const later = await createIncident(db, 'PD')
    await restoreBackup(db, backup)
    expect(await loadIncident(db, keep.id)).not.toBeNull()
    expect(await loadIncident(db, later.id)).toBeNull()
  })

  it.each([
    ['not json', 'nope'],
    ['wrong format', JSON.stringify({ format: 'x' })],
    ['missing tables', JSON.stringify({ format: 'dispatch-desk-backup', schemaVersion: 2, createdAt: 'x', tables: {} })],
  ])('rejects invalid backup: %s', (_n, text) => {
    expect(() => parseBackup(text)).toThrow()
  })

  it('rejects wrong schema version, unknown enums, and invalid embedded workflows', async () => {
    await saveWorkflow(db, BRANCHING)
    await createIncident(db, 'EMS')
    const good = await exportBackup(db)
    expect(() => parseBackup(JSON.stringify({ ...good, schemaVersion: 7 }))).toThrow(/schema/)
    const badStatus = structuredClone(good)
    badStatus.tables.incidents[0]!.status = 'bogus'
    expect(() => parseBackup(JSON.stringify(badStatus))).toThrow(/status/)
    const badType = structuredClone(good)
    badType.tables.incidents[0]!.incident_type = 'XX'
    expect(() => parseBackup(JSON.stringify(badType))).toThrow(/type/)
    const badWf = structuredClone(good)
    badWf.tables.workflow_definitions[0]!.definition_json = '{"id":"x"}'
    expect(() => parseBackup(JSON.stringify(badWf))).toThrow(/invalid/)
  })

  it('a failing restore leaves existing data intact', async () => {
    const inc = await createIncident(db, 'EMS')
    const backup = structuredClone(await exportBackup(db))
    backup.tables.incident_fields.push({ incident_id: 'EMS-MISSING', field: 'sex', state: 'answered', value: 'x', verified: 0 })
    await expect(restoreBackup(db, backup)).rejects.toThrow()
    expect(await loadIncident(db, inc.id)).not.toBeNull()
  })
})
