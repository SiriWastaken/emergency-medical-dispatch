import { conditionProblem } from './rules'
import { callTakingSchema, INPUT_TYPES, type CallTaking, type EntryPrompt, type Instruction, type NarrativeLine } from './schema'
import { validateWorkflow } from '@/domain/workflow-engine/validate'
import { FIELD_KEYS, INCIDENT_TYPES, type FieldKey, type IncidentType } from '@/types/incident'
import type { WorkflowDefinition } from '@/types/workflow'

export const SHEETS = ['Case Entry', 'Questions', 'Branches', 'Narratives', 'Validation', 'Workflows', 'Instructions'] as const
type Grid = readonly (readonly unknown[])[]
type Row = Record<string, string> & { __row: string }

const text = (c: unknown) => (c instanceof Date ? c.toISOString() : c === null || c === undefined ? '' : String(c).trim())
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const yes = (v: string) => ['yes', 'y', 'true'].includes(v.toLowerCase())
const isYesNo = (v: string) => ['yes', 'y', 'true', 'no', 'n', 'false'].includes(v.toLowerCase())

export interface ParseResult {
  definition: CallTaking | null
  issues: string[]
}

/** Reads one sheet into rows keyed by lower-cased header; reports missing sheets or columns. */
function readSheet(sheets: Record<string, Grid>, name: string, columns: string[], issues: string[]): Row[] {
  const grid = sheets[name]
  if (!grid) {
    issues.push(`Worksheet "${name}" is missing`)
    return []
  }
  const first = grid.findIndex((r) => r.some((c) => text(c)))
  if (first < 0) {
    issues.push(`Worksheet "${name}" is empty`)
    return []
  }
  const header = grid[first]!.map((c) => text(c).toLowerCase())
  const missing = columns.filter((c) => !header.includes(c.toLowerCase()))
  if (missing.length) {
    issues.push(`Worksheet "${name}" is missing column(s): ${missing.join(', ')}`)
    return []
  }
  return grid
    .slice(first + 1)
    .map((r, i): Row => ({ ...Object.fromEntries(header.map((h, k) => [h, text(r[k])])), __row: `${name}!${first + i + 2}` }) as Row)
    .filter((r) => header.some((h) => r[h]))
}

const col = (r: Row, name: string) => r[name.toLowerCase()] ?? ''

const typesOf = (v: string, where: string, issues: string[]): IncidentType[] => {
  if (v.toUpperCase() === 'ALL') return [...INCIDENT_TYPES]
  const t = INCIDENT_TYPES.find((x) => x === v.toUpperCase())
  if (!t) issues.push(`${where}: incident type "${v}" must be EMS, PD, FD or ALL`)
  return t ? [t] : []
}
const fieldOf = (v: string, where: string, issues: string[]): FieldKey | undefined => {
  if (!v) return undefined
  if (!(FIELD_KEYS as readonly string[]).includes(v)) {
    issues.push(`${where}: "${v}" is not an incident field (${FIELD_KEYS.join(', ')})`)
    return undefined
  }
  return v as FieldKey
}

const NON_ANSWERS = { '(unknown)': 'unknownNext', '(unavailable)': 'unavailableNext', '(not asked)': 'notAskedNext' } as const

/**
 * Turns the workbook's sheets into the validated definition the app runs on. Every problem is
 * reported with its sheet and row; nothing is inferred or repaired.
 */
export function parseWorkbook(sheets: Record<string, Grid>, opts: { workbook: string; complaints: ReadonlySet<string> }): ParseResult {
  const issues: string[] = []
  const entryRows = readSheet(sheets, 'Case Entry', ['Prompt ID', 'Incident Type', 'Prompt', 'Input Type', 'Required', 'Validation', 'Next Step', 'Field ID'], issues)
  const questionRows = readSheet(sheets, 'Questions', ['Question ID', 'Incident Type', 'Chief Complaint', 'Question', 'Answer Choices', 'Required', 'Workflow Stage', 'Input Type', 'Field ID'], issues)
  const branchRows = readSheet(sheets, 'Branches', ['Question ID', 'Answer Choice', 'Next', 'Terminal Outcome', 'Terminal Instruction', 'Condition'], issues)
  const narrativeRows = readSheet(sheets, 'Narratives', ['Incident Type', 'Field ID', 'Display Label', 'Source Answer', 'Output Order', 'Format'], issues)
  const ruleRows = readSheet(sheets, 'Validation', ['Rule ID', 'Applicable Step', 'Validation Condition', 'Error Message'], issues)
  const workflowRows = readSheet(sheets, 'Workflows', ['Workflow ID', 'Incident Type', 'Chief Complaint', 'Name', 'Status', 'Start', 'Source', 'Notes'], issues)
  const instructionRows = readSheet(sheets, 'Instructions', ['Instruction ID', 'Incident Type', 'Title', 'Script', 'Status', 'Source'], issues)
  if (issues.length) return { definition: null, issues }

  // ---- Validation rules
  const rules = ruleRows.map((r) => ({ id: col(r, 'Rule ID'), step: col(r, 'Applicable Step'), condition: col(r, 'Validation Condition'), message: col(r, 'Error Message'), row: r.__row }))
  const ruleIds = new Set<string>()
  for (const r of rules) {
    if (!r.id || !r.step || !r.message) issues.push(`${r.row}: a rule needs a Rule ID, an Applicable Step and an Error Message`)
    if (ruleIds.has(r.id)) issues.push(`${r.row}: duplicate rule ID "${r.id}"`)
    ruleIds.add(r.id)
    const bad = conditionProblem(r.condition)
    if (bad) issues.push(`${r.row}: ${bad}`)
  }

  // ---- Case entry, per incident type
  const caseEntry: Partial<Record<IncidentType, EntryPrompt[]>> = {}
  const promptFields = new Map<string, FieldKey | undefined>() // id -> field, for narrative cross-checks
  for (const type of INCIDENT_TYPES) {
    const mine = entryRows.filter((r) => typesOf(col(r, 'Incident Type'), r.__row, []).includes(type))
    const byId = new Map<string, Row>()
    for (const r of mine) {
      const id = col(r, 'Prompt ID')
      if (byId.has(id)) issues.push(`${r.__row}: prompt "${id}" is defined twice for ${type}`)
      byId.set(id, r)
    }
    const sequence: EntryPrompt[] = []
    const seen = new Set<string>()
    let id = 'incident-type'
    while (id !== 'WORKFLOW') {
      const r = byId.get(id)
      if (!r) {
        issues.push(`Case Entry: ${type} sequence points to "${id}", which is not defined`)
        break
      }
      if (seen.has(id)) {
        issues.push(`${r.__row}: ${type} case-entry sequence loops back to "${id}"`)
        break
      }
      seen.add(id)
      const input = col(r, 'Input Type')
      if (!(INPUT_TYPES as readonly string[]).includes(input)) issues.push(`${r.__row}: input type "${input}" must be one of ${INPUT_TYPES.join(', ')}`)
      if (!isYesNo(col(r, 'Required'))) issues.push(`${r.__row}: Required must be Yes or No`)
      const field = fieldOf(col(r, 'Field ID'), r.__row, issues)
      if (input !== 'select-incident-type' && !field) issues.push(`${r.__row}: prompt "${id}" needs a Field ID`)
      const validation = col(r, 'Validation').split(',').map((x) => x.trim()).filter(Boolean)
      for (const v of validation) {
        const rule = rules.find((x) => x.id === v)
        if (!rule) issues.push(`${r.__row}: unknown validation rule "${v}"`)
        else if (rule.step !== id) issues.push(`${r.__row}: rule "${v}" applies to "${rule.step}", not "${id}"`)
      }
      const next = col(r, 'Next Step')
      if (!next) issues.push(`${r.__row}: prompt "${id}" has no Next Step`)
      if (input === 'select-complaint' && next !== 'WORKFLOW') issues.push(`${r.__row}: the chief-complaint prompt must lead to WORKFLOW`)
      promptFields.set(id, field)
      sequence.push({ id, prompt: col(r, 'Prompt'), input: input as EntryPrompt['input'], required: yes(col(r, 'Required')), validation, next, ...(field && { field }) })
      id = next
    }
    if (sequence[0]?.input !== 'select-incident-type') issues.push(`Case Entry: the ${type} sequence must start with a "select-incident-type" prompt with ID "incident-type"`)
    for (const r of mine) if (!seen.has(col(r, 'Prompt ID'))) issues.push(`${r.__row}: prompt "${col(r, 'Prompt ID')}" is never reached from the start of the ${type} sequence`)
    caseEntry[type] = sequence
  }
  for (const r of entryRows) typesOf(col(r, 'Incident Type'), r.__row, issues)

  // ---- Workflows (which tree handles which chief complaint)
  const workflowMap: CallTaking['workflowMap'] = []
  const wfByKey = new Map<string, Row>()
  for (const r of workflowRows) {
    const [type] = typesOf(col(r, 'Incident Type'), r.__row, issues)
    const complaint = col(r, 'Chief Complaint')
    const id = col(r, 'Workflow ID')
    if (!type) continue
    if (!id) issues.push(`${r.__row}: a workflow needs a Workflow ID`)
    if (complaint !== '*' && !opts.complaints.has(complaint)) issues.push(`${r.__row}: chief complaint "${complaint}" is not in the chief-complaint list (use * for any)`)
    const key = `${type}|${complaint}`
    if (wfByKey.has(key)) issues.push(`${r.__row}: ${type} / "${complaint}" already has a workflow`)
    wfByKey.set(key, r)
    if (!['COMPLETE', 'COMPLETE - ROLEPLAY', 'INCOMPLETE - CONTENT REQUIRED'].includes(col(r, 'Status'))) issues.push(`${r.__row}: Status must be COMPLETE, COMPLETE - ROLEPLAY or INCOMPLETE - CONTENT REQUIRED`)
    workflowMap.push({ workflowId: id, incidentType: type, complaint })
  }
  if (new Set(workflowMap.map((w) => w.workflowId)).size !== workflowMap.length) issues.push('Workflows: Workflow IDs must be unique')

  // ---- Questions and branches
  const questionIds = new Set<string>()
  const questions = new Map<string, { row: Row; workflowId: string }>()
  for (const r of questionRows) {
    const id = col(r, 'Question ID')
    const [type] = typesOf(col(r, 'Incident Type'), r.__row, issues)
    if (questionIds.has(id) || promptFields.has(id)) issues.push(`${r.__row}: question ID "${id}" is already used`)
    questionIds.add(id)
    const wf = type ? wfByKey.get(`${type}|${col(r, 'Chief Complaint')}`) : undefined
    if (!wf) issues.push(`${r.__row}: question "${id}" belongs to no workflow (no Workflows row for ${col(r, 'Incident Type')} / "${col(r, 'Chief Complaint')}")`)
    else if (col(wf, 'Status') === 'INCOMPLETE - CONTENT REQUIRED') issues.push(`${r.__row}: workflow "${col(wf, 'Workflow ID')}" is marked incomplete, so it must not have questions yet`)
    else questions.set(id, { row: r, workflowId: col(wf, 'Workflow ID') })
  }
  const branchesByQuestion = new Map<string, Row[]>()
  for (const b of branchRows) {
    const q = col(b, 'Question ID')
    if (!questionIds.has(q)) issues.push(`${b.__row}: branch refers to unknown question "${q}"`)
    branchesByQuestion.set(q, [...(branchesByQuestion.get(q) ?? []), b])
  }

  const nodesByWorkflow = new Map<string, WorkflowDefinition['nodes']>()
  const terminalOutcome = new Map<string, string>()
  const terminalInstruction = new Map<string, string>()
  const targetOf = (b: Row, wfId: string): string | undefined => {
    const next = col(b, 'Next')
    if (!next) {
      issues.push(`${b.__row}: branch has no Next`)
      return undefined
    }
    if (next.startsWith('TERMINAL:')) {
      const tid = `${wfId}:${slug(next.slice(9)) || 'end'}`
      const outcome = col(b, 'Terminal Outcome')
      if (!outcome) issues.push(`${b.__row}: a terminal state needs a Terminal Outcome`)
      const known = terminalOutcome.get(tid)
      if (known !== undefined && known !== outcome) issues.push(`${b.__row}: terminal "${next}" has two different outcomes`)
      terminalOutcome.set(tid, outcome)
      const ins = col(b, 'Terminal Instruction')
      if (terminalInstruction.has(tid) && terminalInstruction.get(tid) !== ins) issues.push(`${b.__row}: terminal "${next}" has two different instructions`)
      terminalInstruction.set(tid, ins)
      return tid
    }
    const q = questions.get(next)
    if (!q) issues.push(`${b.__row}: next question "${next}" does not exist`)
    else if (q.workflowId !== wfId) issues.push(`${b.__row}: next question "${next}" belongs to a different workflow`)
    return q ? `${wfId}:${next}` : undefined
  }

  for (const [qid, { row, workflowId }] of questions) {
    const input = col(row, 'Input Type') || 'choice'
    const required = isYesNo(col(row, 'Required')) ? yes(col(row, 'Required')) : (issues.push(`${row.__row}: Required must be Yes or No`), true)
    const field = fieldOf(col(row, 'Field ID'), row.__row, issues)
    const choices = col(row, 'Answer Choices').split('|').map((c) => c.trim()).filter(Boolean)
    const branches = branchesByQuestion.get(qid) ?? []
    const node: Record<string, unknown> = { kind: 'question', id: `${workflowId}:${qid}`, prompt: col(row, 'Question'), options: [], stage: col(row, 'Workflow Stage') || undefined, mandatory: required, sourceRef: row.__row, ...(field && { field }) }
    if (!['choice', 'text', 'integer'].includes(input)) issues.push(`${row.__row}: input type "${input}" must be choice, text or integer`)
    if (input === 'choice') {
      if (!choices.length) issues.push(`${row.__row}: question "${qid}" has no answer choices`)
      if (new Set(choices.map(slug)).size !== choices.length) issues.push(`${row.__row}: question "${qid}" has duplicate answer choices`)
      node.options = choices.map((label) => {
        const mine = branches.filter((x) => col(x, 'Answer Choice') === label)
        const fallback = mine.find((x) => !col(x, 'Condition'))
        if (!fallback) issues.push(`${row.__row}: answer "${label}" of "${qid}" has no unconditional row in Branches`)
        const nextIf = mine.filter((x) => col(x, 'Condition')).flatMap((x) => {
          const m = /^([^=]+)=(.+)$/.exec(col(x, 'Condition'))
          const target = targetOf(x, workflowId)
          if (!m || !target) {
            if (!m) issues.push(`${x.__row}: condition "${col(x, 'Condition')}" must look like <question id>=<answer choice>`)
            return []
          }
          return [{ node: `${workflowId}:${m[1]!.trim()}`, option: slug(m[2]!), next: target }]
        })
        return { id: slug(label), label, next: fallback ? (targetOf(fallback, workflowId) ?? '') : '', ...(nextIf.length && { nextIf }) }
      })
    } else {
      node.input = { format: input }
      const checks = rules.filter((r) => r.step === qid).map((r) => ({ condition: r.condition, message: r.message }))
      if (checks.length) node.checks = checks
      if (choices.length) issues.push(`${row.__row}: typed question "${qid}" must not list answer choices`)
      const b = branches.find((x) => col(x, 'Answer Choice') === '(answered)')
      if (!b) issues.push(`${row.__row}: typed question "${qid}" needs a Branches row with answer "(answered)"`)
      else node.next = targetOf(b, workflowId)
    }
    const labels = branches.filter((b) => !col(b, 'Condition')).map((b) => col(b, 'Answer Choice'))
    for (const l of new Set(labels.filter((x, i) => labels.indexOf(x) !== i))) issues.push(`${row.__row}: question "${qid}" has more than one Branches row for "${l}"`)
    for (const b of branches) {
      const label = col(b, 'Answer Choice')
      const nonAnswer = NON_ANSWERS[label as keyof typeof NON_ANSWERS]
      if (nonAnswer) node[nonAnswer] = targetOf(b, workflowId)
      else if (label !== '(answered)' && !choices.includes(label)) issues.push(`${b.__row}: "${label}" is not an answer to "${qid}"`)
    }
    nodesByWorkflow.set(workflowId, [...(nodesByWorkflow.get(workflowId) ?? []), node as unknown as WorkflowDefinition['nodes'][number]])
  }

  const workflows: WorkflowDefinition[] = []
  for (const w of workflowMap) {
    const row = wfByKey.get(`${w.incidentType}|${w.complaint}`)!
    const complete = col(row, 'Status') !== 'INCOMPLETE - CONTENT REQUIRED'
    const roleplay = col(row, 'Status') === 'COMPLETE - ROLEPLAY'
    const base = { id: w.workflowId, name: col(row, 'Name') || w.workflowId, schemaVersion: 1 as const, service: w.incidentType, category: w.complaint === '*' ? 'Any chief complaint' : w.complaint, status: 'pending-validation' as const, provenance: { origin: (roleplay ? 'roleplay' : 'built-in') as 'roleplay' | 'built-in', sourceFile: opts.workbook, worksheet: 'Workflows', note: col(row, 'Source') || undefined }, ...(col(row, 'Notes') && { notes: col(row, 'Notes') }) }
    if (!complete) {
      const reason = `CONTENT REQUIRED: no authorized question set has been supplied for ${w.incidentType} ${w.complaint === '*' ? 'calls' : `"${w.complaint}" calls`}. Add its questions to the Questions and Branches sheets of ${opts.workbook}.`
      workflows.push({ ...base, incomplete: reason, start: 'content-required', nodes: [{ kind: 'terminal', id: 'content-required', outcome: reason }] })
      continue
    }
    const questionNodes = nodesByWorkflow.get(w.workflowId) ?? []
    if (!questionNodes.length) issues.push(`${row.__row}: workflow "${w.workflowId}" is COMPLETE but has no questions`)
    const startQ = col(row, 'Start') || (questionNodes[0]?.id.slice(w.workflowId.length + 1) ?? '')
    const terminals = [...terminalOutcome].filter(([tid]) => tid.startsWith(`${w.workflowId}:`)).map(([tid, outcome]) => ({ kind: 'terminal' as const, id: tid, outcome, ...(terminalInstruction.get(tid) ? { instruction: terminalInstruction.get(tid) } : {}) }))
    const def = { ...base, start: `${w.workflowId}:${startQ}`, nodes: [...questionNodes, ...terminals] }
    const v = validateWorkflow(def)
    if (!v.ok) for (const i of v.issues) issues.push(`Workflow "${w.workflowId}": ${i.message}`)
    else workflows.push(v.definition)
  }

  // ---- Narratives
  const narratives: Partial<Record<IncidentType, NarrativeLine[]>> = {}
  for (const r of narrativeRows) {
    const [type] = typesOf(col(r, 'Incident Type'), r.__row, issues)
    if (!type) continue
    const fields = col(r, 'Field ID').split('+').map((f) => fieldOf(f.trim(), r.__row, issues)).filter((f): f is FieldKey => !!f)
    const order = Number(col(r, 'Output Order'))
    if (!Number.isInteger(order) || order < 1) issues.push(`${r.__row}: Output Order must be a whole number from 1`)
    const sourceCell = col(r, 'Source Answer')
    const unassigned = /^UNASSIGNED\b/i.test(sourceCell)
    const sources = unassigned ? null : sourceCell.split('+').map((x) => x.trim()).filter(Boolean)
    if (!unassigned) {
      for (const s of sources ?? []) {
        if (/^INSTRUCTIONS\b/i.test(s)) {
          if (!fields.includes('instructionsGiven')) issues.push(`${r.__row}: source "INSTRUCTIONS" only fills instructionsGiven`)
        } else if (/^WORKFLOW\b/i.test(s)) {
          // Filled by whichever complaint tree asks for it: at least one question must.
          const fed = [...questions.values()].some((q) => fields.includes(col(q.row, 'Field ID') as FieldKey))
          if (!fed) issues.push(`${r.__row}: no workflow question fills ${col(r, 'Field ID')}, so the source "WORKFLOW" is not true yet (write UNASSIGNED)`)
        } else if (!promptFields.has(s) && !questionIds.has(s)) issues.push(`${r.__row}: source "${s}" is not a case-entry prompt or question ID (write UNASSIGNED if nothing supplies it yet)`)
        else if (promptFields.has(s) && promptFields.get(s) && !fields.includes(promptFields.get(s)!)) issues.push(`${r.__row}: source "${s}" fills ${promptFields.get(s)}, not ${col(r, 'Field ID')}`)
      }
    }
    if (!col(r, 'Display Label')) issues.push(`${r.__row}: a narrative line needs a Display Label`)
    narratives[type] = [...(narratives[type] ?? []), { fields, label: col(r, 'Display Label'), sources, ...(unassigned && { unassigned: sourceCell }), order, ...(col(r, 'Format').startsWith('suffix:') && { suffix: col(r, 'Format').slice(7).trim() }) }]
  }
  for (const type of INCIDENT_TYPES) {
    const lines = (narratives[type] ?? []).sort((a, b) => a.order - b.order)
    if (!lines.length) issues.push(`Narratives: ${type} has no narrative lines`)
    if (lines.some((l, i) => l.order !== i + 1)) issues.push(`Narratives: ${type} output orders must run 1, 2, 3… without gaps or repeats`)
    narratives[type] = lines
  }

  // ---- Instructions
  const instructions: Instruction[] = []
  for (const r of instructionRows) {
    for (const type of typesOf(col(r, 'Incident Type'), r.__row, issues)) {
      const status = col(r, 'Status')
      if (!['AUTHORIZED', 'ROLEPLAY', 'CONTENT REQUIRED'].includes(status)) issues.push(`${r.__row}: Status must be AUTHORIZED, ROLEPLAY or CONTENT REQUIRED`)
      if (status !== 'CONTENT REQUIRED' && (!col(r, 'Script') || !col(r, 'Source'))) issues.push(`${r.__row}: an ${status} instruction needs both its script and its source`)
      if (status === 'CONTENT REQUIRED' && col(r, 'Script')) issues.push(`${r.__row}: an instruction with a script must be marked AUTHORIZED or ROLEPLAY, with its source`)
      instructions.push({ id: col(r, 'Instruction ID'), incidentType: type, title: col(r, 'Title'), script: col(r, 'Script'), status: status as Instruction['status'], ...(col(r, 'Source') && { source: col(r, 'Source') }) })
    }
  }
  for (const b of branchRows) {
    const ins = col(b, 'Terminal Instruction')
    if (ins && !instructions.some((i) => i.id === ins)) issues.push(`${b.__row}: terminal instruction "${ins}" is not on the Instructions sheet`)
  }
  if (new Set(instructions.map((i) => `${i.incidentType}|${i.id}`)).size !== instructions.length) issues.push('Instructions: IDs must be unique per incident type')

  // ---- Rules refer to real steps
  for (const r of rules) {
    if (!promptFields.has(r.step) && !questionIds.has(r.step)) issues.push(`${r.row}: rule "${r.id}" applies to unknown step "${r.step}"`)
  }

  if (issues.length) return { definition: null, issues }
  const parsed = callTakingSchema.safeParse({
    schemaVersion: 1,
    workbook: opts.workbook,
    caseEntry,
    rules: rules.map((r) => ({ id: r.id, step: r.step, condition: r.condition, message: r.message })),
    narratives,
    workflowMap,
    workflows,
    instructions,
  })
  return parsed.success ? { definition: parsed.data, issues: [] } : { definition: null, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
}
