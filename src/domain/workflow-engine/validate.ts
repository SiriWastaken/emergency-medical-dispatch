import { FIELDS_BY_TYPE } from '@/types/incident'
import { workflowSchema, type Condition, type WorkflowDefinition, type WorkflowNode } from '@/types/workflow'

export interface WorkflowIssue {
  code:
    | 'schema' | 'bad-input' | 'provenance' | 'bad-condition' | 'bad-field' | 'bad-rule' | 'mandatory-skippable' | 'optional-unskippable'
    | 'duplicate-node' | 'duplicate-option' | 'missing-start' | 'missing-target' | 'unreachable' | 'cycle' | 'no-terminal'
  message: string
  nodeId?: string
}

export type ValidationResult =
  | { ok: true; definition: WorkflowDefinition }
  | { ok: false; issues: WorkflowIssue[] }

export function targetsOf(n: WorkflowNode): string[] {
  if (n.kind === 'terminal') return []
  return [
    ...n.options.flatMap((o) => [o.next, ...(o.nextIf ?? []).map((c) => c.next)]),
    ...(n.next ? [n.next] : []),
    ...(n.unknownNext ? [n.unknownNext] : []),
    ...(n.unavailableNext ? [n.unavailableNext] : []),
    ...(n.notAskedNext ? [n.notAskedNext] : []),
    ...(n.appliesIf ? [n.appliesIf.otherwise] : []),
  ]
}

/** Structural (zod) then semantic checks. Never mutates or repairs the input. */
export function validateWorkflow(input: unknown): ValidationResult {
  const parsed = workflowSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ code: 'schema', message: `${i.path.join('.') || 'workflow'}: ${i.message}` })),
    }
  }
  const def = parsed.data
  const issues: WorkflowIssue[] = []
  const byId = new Map<string, WorkflowNode>()
  for (const n of def.nodes) {
    if (byId.has(n.id)) issues.push({ code: 'duplicate-node', message: `Duplicate node id "${n.id}"`, nodeId: n.id })
    else byId.set(n.id, n)
    if (n.kind === 'question') {
      const seen = new Set<string>()
      for (const o of n.options) {
        if (seen.has(o.id)) issues.push({ code: 'duplicate-option', message: `Node "${n.id}" repeats option id "${o.id}"`, nodeId: n.id })
        seen.add(o.id)
      }
    }
  }
  if (!byId.has(def.start)) issues.push({ code: 'missing-start', message: `Start node "${def.start}" does not exist` })
  for (const n of byId.values()) {
    for (const t of targetsOf(n)) {
      if (!byId.has(t)) issues.push({ code: 'missing-target', message: `Node "${n.id}" points to missing node "${t}"`, nodeId: n.id })
    }
  }
  if (!def.nodes.some((n) => n.kind === 'terminal')) issues.push({ code: 'no-terminal', message: 'Workflow has no terminal node' })

  const allowedFields: ReadonlySet<string> | undefined = def.service ? new Set(FIELDS_BY_TYPE[def.service]) : undefined
  const checkCondition = (c: Condition, where: string, nodeId: string) => {
    const ref = byId.get(c.node)
    if (ref?.kind !== 'question') return issues.push({ code: 'bad-condition', message: `${where} refers to "${c.node}", which is not a question`, nodeId })
    for (const o of c.anyOf) {
      if (!ref.options.some((x) => x.id === o)) issues.push({ code: 'bad-condition', message: `${where} refers to unknown answer "${c.node}=${o}"`, nodeId })
    }
  }
  for (const n of byId.values()) {
    if (n.kind !== 'question') continue
    if (n.input) {
      if (n.options.length) issues.push({ code: 'bad-input', message: `Input question "${n.id}" must not have answer options`, nodeId: n.id })
      if (!n.next) issues.push({ code: 'bad-input', message: `Input question "${n.id}" needs a next node`, nodeId: n.id })
    } else {
      if (!n.options.length) issues.push({ code: 'bad-input', message: `Question "${n.id}" has no answer options`, nodeId: n.id })
      if (n.next) issues.push({ code: 'bad-input', message: `Question "${n.id}" has a next node but is not an input question`, nodeId: n.id })
    }
    for (const o of n.options) {
      for (const c of o.nextIf ?? []) checkCondition({ node: c.node, anyOf: [c.option] }, `Option "${o.id}" of "${n.id}"`, n.id)
    }
    if (n.appliesIf) checkCondition(n.appliesIf, `Applicability of "${n.id}"`, n.id)
    if (n.mandatoryIf) checkCondition(n.mandatoryIf, `Mandatory rule of "${n.id}"`, n.id)
    for (const r of n.rules ?? []) {
      checkCondition(r.when, `A rule on "${n.id}"`, n.id)
      for (const f of r.forbid) {
        if (!n.options.some((o) => o.id === f)) issues.push({ code: 'bad-rule', message: `A rule on "${n.id}" forbids unknown option "${f}"`, nodeId: n.id })
      }
      if (r.forbid.length >= n.options.length && n.options.every((o) => r.forbid.includes(o.id))) {
        issues.push({ code: 'bad-rule', message: `A rule on "${n.id}" forbids every option`, nodeId: n.id })
      }
    }
    // A mandatory question may not be skippable; an optional one must say where skipping leads.
    const alwaysMandatory = (n.mandatory ?? true) && !n.mandatoryIf
    if (alwaysMandatory && n.notAskedNext) issues.push({ code: 'mandatory-skippable', message: `Mandatory question "${n.id}" must not define a not-asked route`, nodeId: n.id })
    if (!alwaysMandatory && !n.notAskedNext) issues.push({ code: 'optional-unskippable', message: `Question "${n.id}" can be skipped but defines no not-asked route`, nodeId: n.id })
    if (n.field && allowedFields && !allowedFields.has(n.field)) {
      issues.push({ code: 'bad-field', message: `Question "${n.id}" fills "${n.field}", which a ${def.service} incident does not have`, nodeId: n.id })
    }
  }
  for (const f of def.requiredFields ?? []) {
    if (allowedFields && !allowedFields.has(f)) issues.push({ code: 'bad-field', message: `Required field "${f}" does not exist for ${def.service} incidents` })
  }
  issues.push(...provenanceIssues(def))

  if (byId.has(def.start)) {
    const reached = new Set<string>()
    const onStack = new Set<string>()
    const visit = (id: string) => {
      const n = byId.get(id)
      if (!n) return
      if (onStack.has(id)) {
        issues.push({ code: 'cycle', message: `Cycle through node "${id}" (loops are not supported)`, nodeId: id })
        return
      }
      if (reached.has(id)) return
      reached.add(id)
      onStack.add(id)
      targetsOf(n).forEach(visit)
      onStack.delete(id)
    }
    visit(def.start)
    for (const id of byId.keys()) {
      if (!reached.has(id)) issues.push({ code: 'unreachable', message: `Node "${id}" cannot be reached from the start node`, nodeId: id })
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, definition: def }
}

/** Status must be backed by matching provenance; verified-source is never reachable by default. */
function provenanceIssues(def: WorkflowDefinition): WorkflowIssue[] {
  const p = def.provenance
  const bad = (message: string): WorkflowIssue[] => [{ code: 'provenance', message }]
  if (def.status === 'verified-source') {
    if (p?.origin !== 'authorized-source') return bad('verified-source content must have origin "authorized-source"')
    const missing = (['source', 'sourceFile', 'worksheet', 'verifiedBy', 'verifiedAt'] as const).filter((k) => !p[k])
    return missing.length ? bad(`verified-source content is missing provenance: ${missing.join(', ')}`) : []
  }
  return []
}
