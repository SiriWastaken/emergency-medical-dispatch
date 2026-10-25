import type { CatalogueEntry } from '@/types/catalogue'
import { SERVICES, type Service } from '@/types/incident'
import { slugify, type RowError } from './workflow'
import type { Table } from './table'

export const CATALOGUE_TEMPLATE_CSV = 'service,group,label,workflow_id\nEMS,Example group,Example nature of call,\n'

const COLUMNS = ['service', 'group', 'label', 'workflow_id'] as const

export interface CatalogueResult {
  entries: CatalogueEntry[]
  rowErrors: RowError[]
  /** Problems with the file as a whole (missing columns). */
  issues: string[]
}

/**
 * Column headers must be exactly service, group, label (and optionally workflow_id); nothing is guessed.
 * Imported entries are always marked pending-validation and never replace bundled ones.
 */
export function buildCatalogue(table: Table, existing: CatalogueEntry[], workflows: Map<string, Service | undefined>): CatalogueResult {
  const idx = Object.fromEntries(COLUMNS.map((c) => [c, table.headers.findIndex((h) => h.trim().toLowerCase() === c)])) as Record<(typeof COLUMNS)[number], number>
  const issues = (['service', 'group', 'label'] as const).filter((c) => idx[c] < 0).map((c) => `Missing required column "${c}"`)
  if (issues.length) return { entries: [], rowErrors: [], issues }

  const taken = new Set(existing.map((e) => `${e.service}|${e.label.toLowerCase()}`))
  const entries: CatalogueEntry[] = []
  const rowErrors: RowError[] = []
  for (const { line, cells } of table.rows) {
    const get = (c: (typeof COLUMNS)[number]) => (idx[c] < 0 ? '' : (cells[idx[c]] ?? '').trim())
    const service = SERVICES.find((s) => s === get('service').toUpperCase())
    const [group, label, workflowId] = [get('group'), get('label'), get('workflow_id')]
    const err = (message: string) => rowErrors.push({ line, message })
    if (!service) err(`Service "${get('service')}" must be EMS, PD or FD`)
    else if (!group || !label) err('Group and label are required')
    else if (taken.has(`${service}|${label.toLowerCase()}`)) err(`"${label}" already exists for ${service}`)
    else if (workflowId && !workflows.has(workflowId)) err(`Workflow "${workflowId}" does not exist`)
    else if (workflowId && workflows.get(workflowId) !== service) err(`Workflow "${workflowId}" is not a ${service} workflow`)
    else {
      taken.add(`${service}|${label.toLowerCase()}`)
      entries.push({ id: `custom-${service.toLowerCase()}-${slugify(label)}`, service, group, label, status: 'pending-validation', ...(workflowId && { workflowId }) })
    }
  }
  return { entries, rowErrors, issues }
}
