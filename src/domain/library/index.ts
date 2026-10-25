import { z } from 'zod'
import { catalogueFileSchema, type CatalogueEntry } from '@/types/catalogue'
import { SERVICES } from '@/types/incident'
import { WORKFLOW_STATUSES, type WorkflowDefinition } from '@/types/workflow'
import { validateWorkflow } from '@/domain/workflow-engine/validate'

export interface LibraryInput {
  /** `path` is relative to the workflows folder, e.g. "ems/demo-x.json". */
  workflows: { path: string; data: unknown }[]
  catalogue: unknown
  index?: unknown
}
export interface Library {
  workflows: WorkflowDefinition[]
  catalogue: CatalogueEntry[]
  issues: string[]
}

export const indexSchema = z.object({
  schemaVersion: z.literal(1),
  workflows: z.array(z.object({ id: z.string(), service: z.enum(SERVICES), category: z.string(), status: z.enum(WORKFLOW_STATUSES), origin: z.string(), path: z.string() })),
  counts: z.object({ total: z.number(), byStatus: z.record(z.string(), z.number()), byService: z.record(z.string(), z.number()) }),
})

/** Validates every bundled workflow, the catalogue, their cross-references and the generated index. */
export function checkLibrary({ workflows: files, catalogue, index }: LibraryInput): Library {
  const issues: string[] = []
  const workflows: WorkflowDefinition[] = []
  const ids = new Set<string>()
  for (const f of files) {
    const v = validateWorkflow(f.data)
    if (!v.ok) {
      issues.push(`${f.path}: ${v.issues.map((i) => i.message).join('; ')}`)
      continue
    }
    const d = v.definition
    const folder = f.path.split('/')[0]
    if (!d.service || !d.category || !d.status || !d.provenance) issues.push(`${f.path}: library workflows need service, category, status and provenance`)
    else if (folder !== d.service.toLowerCase()) issues.push(`${f.path}: service ${d.service} does not match its folder`)
    if (ids.has(d.id)) issues.push(`${f.path}: duplicate workflow id "${d.id}"`)
    ids.add(d.id)
    workflows.push(d)
  }

  const cat = catalogueFileSchema.safeParse(catalogue)
  if (!cat.success) return { workflows, catalogue: [], issues: [...issues, `catalogue: ${cat.error.issues[0]?.path.join('.')} ${cat.error.issues[0]?.message}`] }
  const seen = new Set<string>()
  for (const e of cat.data.entries) {
    const key = `${e.service}|${e.label.toLowerCase()}`
    if (seen.has(key) || seen.has(e.id)) issues.push(`catalogue: duplicate entry ${e.service} "${e.label}"`)
    seen.add(key)
    seen.add(e.id)
    if (!e.workflowId) continue
    const w = workflows.find((x) => x.id === e.workflowId)
    if (!w) issues.push(`catalogue: ${e.service} "${e.label}" points to missing workflow "${e.workflowId}"`)
    else if (w.service !== e.service) issues.push(`catalogue: ${e.service} "${e.label}" points to a ${w.service} workflow`)
    else if (w.status !== e.status) issues.push(`catalogue: "${e.label}" status ${e.status} differs from its workflow status ${w.status}`)
  }

  if (index !== undefined) {
    const idx = indexSchema.safeParse(index)
    if (!idx.success) issues.push('index.json is invalid; run pnpm library:build')
    else {
      const a = idx.data.workflows.map((w) => `${w.id}|${w.status}|${w.path}`).sort().join()
      const b = files.flatMap((f) => { const w = workflows.find((x) => x.id === (f.data as { id?: string }).id); return w ? [`${w.id}|${w.status}|${f.path}`] : [] }).sort().join()
      if (a !== b) issues.push('index.json is out of date; run pnpm library:build')
    }
  }
  return { workflows, catalogue: cat.data.entries, issues }
}

export function buildIndex(lib: Library, files: LibraryInput['workflows']): z.infer<typeof indexSchema> {
  const rows = lib.workflows.map((w) => ({ id: w.id, service: w.service!, category: w.category ?? '', status: w.status!, origin: w.provenance?.origin ?? '', path: files.find((f) => (f.data as { id?: string }).id === w.id)?.path ?? '' })).sort((a, b) => a.id.localeCompare(b.id))
  const tally = (key: 'status' | 'service') => rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + 1 }), {})
  return { schemaVersion: 1, workflows: rows, counts: { total: rows.length, byStatus: tally('status'), byService: tally('service') } }
}
