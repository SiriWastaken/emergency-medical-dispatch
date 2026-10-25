import { validateWorkflow } from './validate'
import type { Answer, Answers, Condition, QuestionNode, TerminalNode, WorkflowDefinition, WorkflowNode } from '@/types/workflow'
import type { FieldKey, FieldValue } from '@/types/incident'
import { emptyField } from '@/types/incident'
import { satisfies } from '@/domain/call-taking/rules'

type Option = QuestionNode['options'][number]
export type Step = { type: 'question'; node: QuestionNode } | { type: 'terminal'; node: TerminalNode }
export type Completion = 'in_progress' | 'completed' | 'ended_unresolved'
export type Response = 'unknown' | 'unavailable' | 'not_asked'

export interface Progress {
  /** Active path from the start node: answered questions, then the open question or terminal. */
  steps: Step[]
  status: Completion
  /** Index of the first step still needing attention (the open question, or the last step when finished). */
  frontier: number
  /** Recorded answers that are not part of the active path. */
  staleNodeIds: string[]
  /** Questions that did not apply (their appliesIf condition was false), with the reason. */
  skipped: { nodeId: string; prompt: string; reason: string }[]
  /** Recorded answers the definition's rules reject given earlier answers. They are not followed. */
  invalid: { nodeId: string; message: string }[]
  /** Every node visited in order, including skipped ones. */
  visited: string[]
}

export class WorkflowError extends Error {
  constructor(
    readonly code: 'not-on-path' | 'unknown-option' | 'forbidden' | 'no-route' | 'mandatory' | 'invalid-text',
    message: string,
  ) {
    super(message)
    this.name = 'WorkflowError'
  }
}

const index = (def: WorkflowDefinition) => new Map<string, WorkflowNode>(def.nodes.map((n) => [n.id, n]))

/** A condition holds when the earlier question was visited and answered with one of the listed options. */
const holds = (c: Condition, answers: Answers, visited: ReadonlySet<string>) => {
  const a = answers[c.node]
  return visited.has(c.node) && a?.kind === 'option' && c.anyOf.includes(a.optionId)
}

export const isMandatory = (n: QuestionNode, answers: Answers, visited: ReadonlySet<string>) =>
  n.mandatoryIf ? holds(n.mandatoryIf, answers, visited) : (n.mandatory ?? true)

const routeFor = (n: QuestionNode, kind: Response): string | undefined =>
  kind === 'unknown' ? n.unknownNext : kind === 'unavailable' ? n.unavailableNext : n.notAskedNext

/**
 * The non-answer responses this question permits right now: only those with a defined route, and
 * never "not asked" while the question is mandatory (a mandatory question cannot be skipped).
 */
export const offeredResponses = (n: QuestionNode, mandatoryNow: boolean): Response[] =>
  (['unknown', 'unavailable', 'not_asked'] as const).filter((r) => routeFor(n, r) && !(r === 'not_asked' && mandatoryNow))

/** Option ids that the node's rules reject given the earlier answers, with the explanation. */
function forbiddenOptions(n: QuestionNode, answers: Answers, visited: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of n.rules ?? []) {
    if (holds(r.when, answers, visited)) for (const f of r.forbid) if (!out.has(f)) out.set(f, r.message)
  }
  return out
}

/** Null when the typed value is acceptable for the input question's field and format. */
export function textProblem(node: QuestionNode, value: string): string | null {
  if (!value.trim()) return 'Enter an answer, or use one of the other responses.'
  if (node.input?.format === 'integer' && !/^\d{1,4}$/.test(value.trim())) return 'Enter a whole number.'
  return node.checks?.find((c) => !satisfies(c.condition, value))?.message ?? null
}

/** Pure and deterministic: the same definition and answers always give the same progress. */
export function resolve(def: WorkflowDefinition, answers: Answers): Progress {
  const nodes = index(def)
  const steps: Step[] = []
  const visited: string[] = []
  const seen = new Set<string>()
  const skipped: Progress['skipped'] = []
  const invalid: Progress['invalid'] = []
  let status: Completion = 'in_progress'
  let id: string | undefined = def.start
  while (id !== undefined) {
    const node = nodes.get(id)
    if (!node) throw new Error(`Unknown node "${id}" in workflow "${def.id}"`)
    if (seen.has(id)) throw new Error(`Cycle at node "${id}" in workflow "${def.id}"`)
    const before = new Set(seen) // what had been visited when this node was reached
    seen.add(id)
    visited.push(id)
    if (node.kind === 'terminal') {
      steps.push({ type: 'terminal', node })
      status = 'completed'
      break
    }
    if (node.appliesIf && !holds(node.appliesIf, answers, before)) {
      skipped.push({ nodeId: node.id, prompt: node.prompt, reason: `Does not apply: requires "${node.appliesIf.node}" to be ${node.appliesIf.anyOf.join(' or ')}` })
      id = node.appliesIf.otherwise
      continue
    }
    steps.push({ type: 'question', node })
    const a: Answer | undefined = answers[id]
    if (!a) break
    if (a.kind === 'not_asked' && isMandatory(node, answers, before)) {
      invalid.push({ nodeId: node.id, message: 'This question is mandatory and cannot be skipped.' })
      break
    }
    if (a.kind === 'text') {
      const problem = node.input ? textProblem(node, a.value) : 'This question is not answered by typing.'
      if (problem || !node.next) {
        invalid.push({ nodeId: node.id, message: problem ?? 'No next question is defined.' })
        break
      }
      id = node.next
      continue
    }
    if (a.kind !== 'option') {
      // unknown, unavailable and not-asked are different facts with separate routes; none invents an answer.
      const route: string | undefined = routeFor(node, a.kind)
      if (!route) {
        status = 'ended_unresolved'
        break
      }
      id = route
      continue
    }
    const opt: Option | undefined = node.options.find((o) => o.id === a.optionId)
    if (!opt) break // answer no longer matches the definition: treat as unanswered
    const why = forbiddenOptions(node, answers, before).get(opt.id)
    if (why) {
      invalid.push({ nodeId: node.id, message: why })
      break
    }
    const hit = opt.nextIf?.find((c) => seen.has(c.node) && answers[c.node]?.kind === 'option' && (answers[c.node] as { optionId: string }).optionId === c.option)
    id = hit?.next ?? opt.next
  }
  const onPath = new Set(steps.map((s) => s.node.id))
  return {
    steps,
    status,
    frontier: steps.length - 1,
    staleNodeIds: Object.keys(answers).filter((k) => !onPath.has(k) || (k === steps.at(-1)?.node.id && status === 'in_progress')),
    skipped,
    invalid,
    visited,
  }
}

/** Why each option of an open question is or is not selectable right now. */
export function optionAvailability(def: WorkflowDefinition, answers: Answers, nodeId: string): Map<string, string> {
  const node = index(def).get(nodeId)
  if (node?.kind !== 'question') return new Map()
  const p = resolve(def, answers)
  const before = new Set(p.visited.slice(0, p.visited.indexOf(nodeId)))
  return forbiddenOptions(node, answers, before)
}

/** Records an answer, then drops every answer the new path no longer reaches. Throws WorkflowError if the answer is not permitted. */
export function applyAnswer(
  def: WorkflowDefinition,
  answers: Answers,
  nodeId: string,
  answer: Answer,
): { answers: Answers; removed: string[] } {
  const before = resolve(def, answers)
  const step = before.steps.find((s) => s.type === 'question' && s.node.id === nodeId)
  if (step?.type !== 'question') throw new WorkflowError('not-on-path', `Node "${nodeId}" is not on the active path`)
  const node = step.node
  if (answer.kind === 'text') {
    if (!node.input) throw new WorkflowError('unknown-option', 'This question is not answered by typing')
    const problem = textProblem(node, answer.value)
    if (problem) throw new WorkflowError('invalid-text', problem)
  } else if (answer.kind === 'option') {
    if (!node.options.some((o) => o.id === answer.optionId)) throw new WorkflowError('unknown-option', `"${answer.optionId}" is not an answer to this question`)
    const why = optionAvailability(def, answers, nodeId).get(answer.optionId)
    if (why) throw new WorkflowError('forbidden', why)
  } else if (!routeFor(node, answer.kind)) {
    throw new WorkflowError('no-route', `This question does not allow a "${answer.kind.replace('_', ' ')}" response`)
  } else if (answer.kind === 'not_asked' && isMandatory(node, answers, new Set(before.visited.slice(0, before.visited.indexOf(nodeId))))) {
    throw new WorkflowError('mandatory', 'This question is mandatory and cannot be skipped')
  }
  const next = { ...answers, [nodeId]: answer }
  const after = resolve(def, next)
  const keep = new Set(after.steps.map((s) => s.node.id))
  const pruned: Answers = {}
  const removed: string[] = []
  for (const [k, v] of Object.entries(next)) {
    if (keep.has(k)) pruned[k] = v
    else removed.push(k)
  }
  return { answers: pruned, removed }
}

/** Drops answers that are not on the active path (used when restoring older saved sessions). */
export function pruneStale(def: WorkflowDefinition, answers: Answers): Answers {
  const keep = new Set(resolve(def, answers).steps.map((s) => s.node.id))
  return Object.fromEntries(Object.entries(answers).filter(([k]) => keep.has(k)))
}

/** Display text for a recorded answer; unknown, unavailable and not-asked stay distinct from any option. */
export const answerLabel = (n: QuestionNode, a: Answer): string =>
  a.kind === 'text' ? a.value : a.kind === 'unknown' ? 'Unknown' : a.kind === 'unavailable' ? 'Unavailable' : a.kind === 'not_asked' ? 'Not asked' : (n.options.find((o) => o.id === a.optionId)?.label ?? 'Not recorded')

/** One line per step on the active path: recorded answers, or an explicit "not yet asked". */
export function summarize(def: WorkflowDefinition, answers: Answers): string[] {
  return resolve(def, answers).steps.map((s) => {
    if (s.type === 'terminal') return `Outcome: ${s.node.outcome}`
    const a = answers[s.node.id]
    return `${s.node.prompt} -> ${a ? answerLabel(s.node, a) : 'NOT YET ASKED'}`
  })
}

// ---------------------------------------------------------------- validation

export type CompletionState = 'complete' | 'incomplete' | 'blocked'
export interface ReportIssue {
  code: 'invalid-definition' | 'content-required' | 'cannot-resolve' | 'invalid-answer' | 'no-route' | 'unanswered' | 'missing-field'
  message: string
  nodeId?: string
  field?: FieldKey
}
export interface Report {
  /** complete: every rule satisfied. incomplete: can continue by answering. blocked: cannot proceed as configured. */
  state: CompletionState
  issues: ReportIssue[]
  /** Answered with unknown / unavailable / not asked (permitted, but not information). */
  unresolved: { nodeId: string; prompt: string; response: Response }[]
}

/**
 * Decides whether the case may be considered finished under the workflow's own rules.
 * Reaching the last screen is not enough; recomputed from scratch on every call.
 */
export function validateProgress(def: WorkflowDefinition, answers: Answers, fields?: Partial<Record<FieldKey, FieldValue>>): Report {
  const check = validateWorkflow(def)
  if (!check.ok) return { state: 'blocked', issues: check.issues.map((i) => ({ code: 'invalid-definition', message: i.message, nodeId: i.nodeId })), unresolved: [] }
  let p: Progress
  try {
    p = resolve(def, answers)
  } catch (e) {
    return { state: 'blocked', issues: [{ code: 'cannot-resolve', message: e instanceof Error ? e.message : String(e) }], unresolved: [] }
  }
  const issues: ReportIssue[] = []
  const unresolved: Report['unresolved'] = []
  for (const i of p.invalid) issues.push({ code: 'invalid-answer', message: i.message, nodeId: i.nodeId })
  let blocked = issues.length > 0
  // A placeholder for content nobody has supplied can never count as a finished workflow.
  if (def.incomplete) issues.push({ code: 'content-required', message: def.incomplete })
  for (const s of p.steps) {
    if (s.type !== 'question') continue
    const a = answers[s.node.id]
    if (a && a.kind !== 'option' && a.kind !== 'text') unresolved.push({ nodeId: s.node.id, prompt: s.node.prompt, response: a.kind })
  }
  if (p.status === 'ended_unresolved') {
    const last = p.steps.at(-1)
    const q = last?.type === 'question' ? last.node : undefined
    blocked = true
    issues.push({ code: 'no-route', nodeId: q?.id, message: `"${q?.prompt ?? ''}" was answered with a response that has no defined route, so the workflow cannot continue. Change the answer.` })
  } else if (p.status === 'in_progress') {
    const last = p.steps.at(-1)
    if (last?.type === 'question' && !p.invalid.some((i) => i.nodeId === last.node.id)) {
      const visited = new Set(p.visited.slice(0, p.visited.indexOf(last.node.id)))
      issues.push({ code: 'unanswered', nodeId: last.node.id, message: `${isMandatory(last.node, answers, visited) ? 'Required question' : 'Question'} not yet answered: ${last.node.prompt}` })
    }
  }
  if (fields && def.requiredFields) {
    for (const f of def.requiredFields) {
      if (fields[f]?.state === undefined || fields[f]?.state === 'unanswered') issues.push({ code: 'missing-field', field: f, message: `Required information not yet recorded: ${f}` })
    }
  }
  return { state: blocked ? 'blocked' : issues.length ? 'incomplete' : 'complete', issues, unresolved }
}

// ------------------------------------------------------- incident field sync

/** Incident fields the answers on the active path fill in (so the call narrative follows the questioning). */
export function fieldEffects(def: WorkflowDefinition, answers: Answers): Partial<Record<FieldKey, FieldValue>> {
  const out: Partial<Record<FieldKey, FieldValue>> = {}
  for (const s of resolve(def, answers).steps) {
    if (s.type !== 'question' || !s.node.field) continue
    const a = answers[s.node.id]
    if (!a) continue
    // "Unavailable" is recorded on the incident as unknown: the information could not be obtained.
    out[s.node.field] =
      a.kind === 'text' ? { state: 'answered', value: a.value.trim() } : a.kind === 'option' ? { state: 'answered', value: s.node.options.find((o) => o.id === a.optionId)?.label ?? '' } : a.kind === 'not_asked' ? { state: 'not_asked', value: '' } : { state: 'unknown', value: '' }
  }
  return out
}

const sameField = (a: FieldValue, b: FieldValue) => a.state === b.state && a.value === b.value

/**
 * Moves incident fields from the effects of the old answers to those of the new ones. A field the
 * workflow filled is cleared when its answer is removed, unless the operator has since edited it.
 */
export function applyFieldEffects(
  fields: Record<FieldKey, FieldValue>,
  before: Partial<Record<FieldKey, FieldValue>>,
  after: Partial<Record<FieldKey, FieldValue>>,
): Record<FieldKey, FieldValue> {
  const next = { ...fields }
  for (const [k, v] of Object.entries(before) as [FieldKey, FieldValue][]) {
    if (!(k in after) && sameField(fields[k], v)) next[k] = emptyField()
  }
  for (const [k, v] of Object.entries(after) as [FieldKey, FieldValue][]) next[k] = { ...v }
  return next
}
