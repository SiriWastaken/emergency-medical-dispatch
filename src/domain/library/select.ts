import type { CatalogueEntry } from '@/types/catalogue'
import type { Service } from '@/types/incident'
import { statusOf, type WorkflowDefinition } from '@/types/workflow'

export interface EntryGroup {
  group: string
  entries: CatalogueEntry[]
}

/** Entries for one service only, grouped, filtered by a case-insensitive search of label or group. */
export function groupedEntries(catalogue: CatalogueEntry[], service: Service, query = ''): EntryGroup[] {
  const q = query.trim().toLowerCase()
  const groups = new Map<string, CatalogueEntry[]>()
  for (const e of catalogue) {
    if (e.service !== service || e.status === 'disabled') continue
    if (q && !e.label.toLowerCase().includes(q) && !e.group.toLowerCase().includes(q)) continue
    groups.set(e.group, [...(groups.get(e.group) ?? []), e])
  }
  return [...groups].map(([group, entries]) => ({ group, entries }))
}

export const findEntry = (catalogue: CatalogueEntry[], service: Service, label: string) =>
  catalogue.find((e) => e.service === service && e.label === label)

/** The workflow a nature of call starts, if it exists and is not disabled. */
export function workflowFor(entry: CatalogueEntry | undefined, workflows: WorkflowDefinition[]): WorkflowDefinition | undefined {
  const w = entry?.workflowId ? workflows.find((x) => x.id === entry.workflowId) : undefined
  return w && statusOf(w) !== 'disabled' ? w : undefined
}
