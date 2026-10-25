import { validateWorkflow } from '@/domain/workflow-engine/validate'
import { catalogueEntrySchema, type CatalogueEntry } from '@/types/catalogue'
import { z } from 'zod'
import type { WorkflowDefinition } from '@/types/workflow'
import type { Db } from './db'

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const [r] = await db.select('SELECT value FROM app_settings WHERE key = ?', [key])
  return r ? String(r.value) : null
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.batch([{ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', params: [key, value] }])
}

export interface StoredWorkflow {
  definition: WorkflowDefinition
  builtin: boolean
}

/**
 * Bundled workflows are (re)written on every launch so shipped changes reach existing installs.
 * Bundled workflows that are no longer shipped are removed unless a saved call still uses them.
 */
export async function seedBuiltinWorkflows(db: Db, bundled: WorkflowDefinition[]): Promise<void> {
  const at = new Date().toISOString()
  await db.batch([
    ...bundled.map((w) => ({
      sql: 'INSERT INTO workflow_definitions (id, name, schema_version, definition_json, builtin, updated_at) VALUES (?, ?, 1, ?, 1, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, definition_json = excluded.definition_json, updated_at = excluded.updated_at WHERE builtin = 1',
      params: [w.id, w.name, JSON.stringify(w), at],
    })),
    {
      sql: `DELETE FROM workflow_definitions WHERE builtin = 1 AND id NOT IN (${bundled.map(() => '?').join(', ') || "''"}) AND id NOT IN (SELECT workflow_id FROM workflow_sessions)`,
      params: bundled.map((w) => w.id),
    },
  ])
}

const extraSchema = z.array(catalogueEntrySchema)
export async function loadCatalogueExtra(db: Db): Promise<CatalogueEntry[]> {
  const raw = await getSetting(db, 'catalogueExtra')
  return raw === null ? [] : extraSchema.parse(JSON.parse(raw))
}
export const saveCatalogueExtra = (db: Db, entries: CatalogueEntry[]) => setSetting(db, 'catalogueExtra', JSON.stringify(extraSchema.parse(entries)))

export async function listWorkflows(db: Db): Promise<{ workflows: StoredWorkflow[]; problems: string[] }> {
  const workflows: StoredWorkflow[] = []
  const problems: string[] = []
  for (const r of await db.select('SELECT id, definition_json, builtin FROM workflow_definitions ORDER BY builtin DESC, name')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(String(r.definition_json))
    } catch {
      problems.push(`Workflow "${String(r.id)}" is not valid JSON and was skipped`)
      continue
    }
    const v = validateWorkflow(parsed)
    if (v.ok) workflows.push({ definition: v.definition, builtin: r.builtin === 1 })
    else problems.push(`Workflow "${String(r.id)}" failed validation and was skipped: ${v.issues[0]?.message ?? 'unknown'}`)
  }
  return { workflows, problems }
}

/** Adds a workflow. Replacing an existing one needs `overwrite`, and built-ins are never replaced. */
export async function saveWorkflow(db: Db, def: WorkflowDefinition, overwrite = false): Promise<void> {
  const v = validateWorkflow(def)
  if (!v.ok) throw new Error(`Invalid workflow: ${v.issues[0]?.message}`)
  const [existing] = await db.select('SELECT builtin FROM workflow_definitions WHERE id = ?', [def.id])
  if (existing?.builtin === 1) throw new Error(`"${def.id}" is a built-in workflow and cannot be replaced`)
  if (existing && !overwrite) throw new Error(`Workflow "${def.id}" already exists`)
  await db.batch([
    {
      sql: 'INSERT INTO workflow_definitions (id, name, schema_version, definition_json, builtin, updated_at) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, schema_version = excluded.schema_version, definition_json = excluded.definition_json, updated_at = excluded.updated_at',
      params: [def.id, def.name, def.schemaVersion, JSON.stringify(def), new Date().toISOString()],
    },
  ])
}

export async function deleteWorkflow(db: Db, id: string): Promise<void> {
  const [used] = await db.select('SELECT COUNT(*) AS n FROM workflow_sessions WHERE workflow_id = ?', [id])
  if (Number(used?.n) > 0) throw new Error(`Workflow is used by ${String(used?.n)} incident(s) and cannot be deleted`)
  await db.batch([{ sql: 'DELETE FROM workflow_definitions WHERE id = ? AND builtin = 0', params: [id] }])
}
