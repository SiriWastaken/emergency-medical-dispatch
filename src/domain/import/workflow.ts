import { validateWorkflow, type WorkflowIssue } from '@/domain/workflow-engine/validate'
import { FIELD_KEYS, type FieldKey, type Service } from '@/types/incident'
import type { Provenance, WorkflowDefinition, WorkflowNode, WorkflowStatus } from '@/types/workflow'
import type { Table } from './table'

export const ROLES = [
  { key: 'nodeId', label: 'Node ID', required: true, synonyms: ['node_id', 'node', 'id', 'question_id', 'qid'] },
  { key: 'type', label: 'Row type (question / terminal)', required: true, synonyms: ['type', 'node_type', 'kind'] },
  { key: 'prompt', label: 'Prompt / outcome text', required: true, synonyms: ['prompt', 'question', 'text', 'outcome'] },
  { key: 'optionLabel', label: 'Answer option label', required: true, synonyms: ['option_label', 'option', 'answer', 'answer_label'] },
  { key: 'next', label: 'Next node ID', required: true, synonyms: ['next_node', 'next', 'goto', 'target', 'transition'] },
  { key: 'unknownNext', label: 'Unknown-answer next node ID', required: false, synonyms: ['unknown_next', 'on_unknown'] },
  { key: 'unavailableNext', label: 'Unavailable-answer next node ID', required: false, synonyms: ['unavailable_next', 'on_unavailable'] },
  { key: 'notAskedNext', label: 'Not-asked (skip) next node ID', required: false, synonyms: ['not_asked_next', 'skip_next', 'on_skip'] },
  { key: 'mandatory', label: 'Mandatory (yes / no)', required: false, synonyms: ['mandatory', 'required'] },
  { key: 'format', label: 'Typed-answer format (text / integer)', required: false, synonyms: ['format', 'input_format'] },
  { key: 'field', label: 'Incident field this fills in', required: false, synonyms: ['field', 'narrative_field', 'maps_to'] },
  { key: 'help', label: 'Explanatory text', required: false, synonyms: ['help', 'note', 'explanation', 'description'] },
] as const
export type RoleKey = (typeof ROLES)[number]['key']
export type Mapping = Partial<Record<RoleKey, number>>

const mandatoryText0 = (v: string): boolean | undefined => (['yes', 'true'].includes(v.toLowerCase()) ? true : ['no', 'false'].includes(v.toLowerCase()) ? false : undefined)
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/** A suggestion only: exact header-name matches. The user always confirms the mapping. */
export function suggestMapping(headers: string[]): Mapping {
  const m: Mapping = {}
  const taken = new Set<number>()
  for (const r of ROLES) {
    const i = headers.findIndex((h, idx) => !taken.has(idx) && r.synonyms.some((s) => s === norm(h)))
    if (i >= 0) {
      m[r.key] = i
      taken.add(i)
    }
  }
  return m
}

export const slugify = (s: string) => norm(s).replaceAll('_', '-')

export interface RowError {
  line: number
  message: string
}
export interface BuildMeta {
  id: string
  name: string
  start: string
  service?: Service
  category?: string
  /** Imports are never verified; callers pass pending-validation. */
  status?: WorkflowStatus
  provenance?: Provenance
  /** Worksheet name, used for per-node source references. */
  sheet?: string
}
export interface BuildResult {
  definition: WorkflowDefinition | null
  rowErrors: RowError[]
  issues: WorkflowIssue[]
}

/** Never guesses: every ambiguity (bad type, conflicting prompt, stray cell) becomes a row error. */
export function buildWorkflow(table: Table, mapping: Mapping, meta: BuildMeta): BuildResult {
  const rowErrors: RowError[] = []
  const missing = ROLES.filter((r) => r.required && mapping[r.key] === undefined)
  if (missing.length) {
    return { definition: null, rowErrors, issues: missing.map((r) => ({ code: 'schema', message: `Map a column to "${r.label}"` })) }
  }
  const nodes = new Map<string, { node: WorkflowNode; line: number }>()
  const ref = (line: number) => `${meta.sheet ? meta.sheet + '!' : 'row '}${line}`
  const err = (line: number, message: string) => rowErrors.push({ line, message })

  for (const { line, cells } of table.rows) {
    const get = (k: RoleKey) => (mapping[k] === undefined ? '' : (cells[mapping[k]] ?? '').trim())
    const id = get('nodeId')
    const type = get('type').toLowerCase()
    const prompt = get('prompt')
    if (!id) {
      err(line, 'Node ID is empty')
      continue
    }
    if (type !== 'question' && type !== 'terminal' && type !== 'input') {
      err(line, `Row type "${get('type')}" must be "question", "input" or "terminal"`)
      continue
    }
    if (!prompt) {
      err(line, `${type === 'question' ? 'Prompt' : 'Outcome text'} is empty`)
      continue
    }
    const existing = nodes.get(id)
    if (existing && existing.node.kind !== (type === 'input' ? 'question' : type)) {
      err(line, `Node "${id}" is a ${existing.node.kind} on row ${existing.line} but a ${type} here`)
      continue
    }
    if (type === 'terminal') {
      if (get('optionLabel') || get('next')) err(line, 'A terminal row must not have an option label or next node')
      else if (existing) err(line, `Terminal "${id}" is already defined on row ${existing.line}`)
      else nodes.set(id, { node: { kind: 'terminal', id, outcome: prompt, sourceRef: ref(line), ...(get('help') && { help: get('help') }) }, line })
      continue
    }
    if (type === 'input') {
      const format = get('format').toLowerCase() || 'text'
      const fieldName = get('field')
      if (existing) err(line, `Input question "${id}" is already defined on row ${existing.line}`)
      else if (!['text', 'integer'].includes(format)) err(line, `Format "${get('format')}" must be text or integer`)
      else if (!get('next') || !fieldName) err(line, 'An input row needs a next node and the incident field it fills in')
      else if (get('optionLabel')) err(line, 'An input row must not have an option label')
      else {
        nodes.set(id, {
          node: {
            kind: 'question', id, prompt, options: [], input: { format: format as 'text' | 'integer' }, next: get('next'), sourceRef: ref(line),
            ...(get('help') && { help: get('help') }), ...(get('unknownNext') && { unknownNext: get('unknownNext') }), ...(get('unavailableNext') && { unavailableNext: get('unavailableNext') }), ...(get('notAskedNext') && { notAskedNext: get('notAskedNext') }),
            ...(mandatoryText0(get('mandatory')) !== undefined && { mandatory: mandatoryText0(get('mandatory')) }), field: fieldName as FieldKey,
          },
          line,
        })
      }
      continue
    }
    const label = get('optionLabel')
    const next = get('next')
    if (!label || !next) {
      err(line, 'A question row needs an option label and a next node')
      continue
    }
    const unknownNext = get('unknownNext')
    const unavailableNext = get('unavailableNext')
    const notAskedNext = get('notAskedNext')
    const help = get('help')
    const mandatoryText = get('mandatory').toLowerCase()
    const fieldText = get('field')
    if (mandatoryText && !['yes', 'no', 'true', 'false'].includes(mandatoryText)) {
      err(line, `Mandatory "${get('mandatory')}" must be yes or no`)
      continue
    }
    if (fieldText && !(FIELD_KEYS as readonly string[]).includes(fieldText)) {
      err(line, `Field "${fieldText}" is not an incident field (${FIELD_KEYS.join(', ')})`)
      continue
    }
    let q = existing?.node
    if (!q) {
      q = {
        kind: 'question', id, prompt, options: [], sourceRef: ref(line),
        ...(help && { help }), ...(unknownNext && { unknownNext }), ...(unavailableNext && { unavailableNext }), ...(notAskedNext && { notAskedNext }),
        ...(mandatoryText && { mandatory: mandatoryText === 'yes' || mandatoryText === 'true' }), ...(fieldText && { field: fieldText as FieldKey }),
      }
      nodes.set(id, { node: q, line })
    }
    if (q.kind !== 'question') continue
    if (q.prompt !== prompt) err(line, `Prompt for "${id}" differs from row ${existing?.line}`)
    for (const [value, key, name] of [[unknownNext, 'unknownNext', 'Unknown-answer'], [unavailableNext, 'unavailableNext', 'Unavailable-answer'], [notAskedNext, 'notAskedNext', 'Not-asked']] as const) {
      if (value && q[key] && q[key] !== value) err(line, `${name} target for "${id}" conflicts with an earlier row`)
      else if (value && !q[key]) q[key] = value
    }
    if (help && q.help && q.help !== help) err(line, `Explanatory text for "${id}" differs from an earlier row`)
    else if (help && !q.help) q.help = help
    const optId = slugify(label)
    if (!optId) err(line, `Option label "${label}" has no usable characters`)
    else if (q.options.some((o) => o.id === optId)) err(line, `Option "${label}" is repeated for "${id}"`)
    else q.options.push({ id: optId, label, next })
  }
  if (rowErrors.length) return { definition: null, rowErrors, issues: [] }
  const lines = table.rows.map((r) => r.line)
  const candidate = {
    id: meta.id,
    name: meta.name,
    schemaVersion: 1,
    start: meta.start,
    ...(meta.service && { service: meta.service }),
    ...(meta.category && { category: meta.category }),
    ...(meta.status && { status: meta.status }),
    ...(meta.provenance && { provenance: { ...meta.provenance, rows: `${Math.min(...lines)}-${Math.max(...lines)}` } }),
    nodes: [...nodes.values()].map((n) => n.node),
  }
  const v = validateWorkflow(candidate)
  return v.ok ? { definition: v.definition, rowErrors, issues: [] } : { definition: null, rowErrors, issues: v.issues }
}

export const TEMPLATE_CSV = `node_id,type,prompt,option_label,next_node,unknown_next,help
q1,question,Is the example item present?,Yes,q2,t-unclear,Fictional example row
q1,question,Is the example item present?,No,t-none,t-unclear,
q2,question,Is a second example item present?,Yes,t-both,,
q2,question,Is a second example item present?,No,t-one,,
t-both,terminal,Example outcome: both items present,,,,
t-one,terminal,Example outcome: one item present,,,,
t-none,terminal,Example outcome: no items present,,,,
t-unclear,terminal,Example outcome: unclear,,,,
`
