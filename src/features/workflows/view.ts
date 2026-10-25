import { isMandatory, offeredResponses, resolve, WorkflowError, type Progress } from '@/domain/workflow-engine/engine'
import { validateWorkflow } from '@/domain/workflow-engine/validate'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import type { Answer, WorkflowDefinition } from '@/types/workflow'

export const UNKNOWN_ID = '__unknown__'
export const UNAVAILABLE_ID = '__unavailable__'
export const NOT_ASKED_ID = '__not_asked__'

export interface WorkflowView {
  def: WorkflowDefinition
  progress: Progress
  /** Index into progress.steps of the step on screen. */
  index: number
}

/** Reads the active workflow, progress and on-screen step from the stores. Null when none is running. */
export function selectWorkflowView(
  session: ReturnType<typeof useCase.getState>['session'],
  viewNodeId: string | null,
  workflows: ReturnType<typeof useApp.getState>['workflows'],
): WorkflowView | null {
  if (!session) return null
  const def = workflows.find((w) => w.definition.id === session.workflowId)?.definition
  if (!def || !validateWorkflow(def).ok) return null // see definitionProblem for why
  const progress = resolve(def, session.answers)
  const found = progress.steps.findIndex((s) => s.node.id === viewNodeId)
  return { def, progress, index: found >= 0 ? found : progress.frontier }
}

/** Why the session's workflow cannot be run, or null when it can. Malformed definitions are never executed. */
export function definitionProblem(session: { workflowId: string } | null, workflows: ReturnType<typeof useApp.getState>['workflows']): string | null {
  if (!session) return null
  const def = workflows.find((w) => w.definition.id === session.workflowId)?.definition
  if (!def) return `Workflow "${session.workflowId}" is not available. Your recorded answers are kept.`
  const check = validateWorkflow(def)
  return check.ok ? null : `Workflow "${def.name}" cannot be run because its definition is invalid: ${check.issues.map((i) => i.message).join('; ')}`
}

export const currentView = () => selectWorkflowView(useCase.getState().session, useCase.getState().viewNodeId, useApp.getState().workflows)

export function stepView(delta: number) {
  const v = currentView()
  const target = v?.progress.steps[v.index + delta]
  if (target) useCase.getState().setView(target.node.id)
}

/**
 * Records an answer, then shows the next step on the new path and reports any answers it discarded.
 * An answer the workflow does not permit is refused with its explanation and nothing is recorded.
 * Returns that explanation, or null on success.
 */
function record(def: WorkflowDefinition, nodeId: string, answer: Answer): string | null {
  const c = useCase.getState()
  let removed: string[]
  try {
    ;({ removed } = c.answer(def, nodeId, answer))
  } catch (e) {
    if (!(e instanceof WorkflowError)) throw e
    c.setNotice(`Not allowed: ${e.message}`)
    return e.message
  }
  const after = currentView()
  if (!after) return null
  const i = after.progress.steps.findIndex((s) => s.node.id === nodeId)
  const next = after.progress.steps[i + 1] ?? after.progress.steps[i]
  c.setView(next?.node.id ?? null)
  const promptOf = (id: string) => {
    const n = def.nodes.find((x) => x.id === id)
    return n?.kind === 'question' ? n.prompt : id
  }
  c.setNotice(removed.length ? `Path changed: ${removed.length} later answer(s) were discarded (${removed.map(promptOf).join('; ')}).` : null)
  return null
}

export function answerNode(def: WorkflowDefinition, nodeId: string, optionId: string) {
  const at = new Date().toISOString()
  record(def, nodeId, optionId === UNKNOWN_ID ? { kind: 'unknown', at } : optionId === UNAVAILABLE_ID ? { kind: 'unavailable', at } : optionId === NOT_ASKED_ID ? { kind: 'not_asked', at } : { kind: 'option', optionId, at })
}

/** The typed answer to an input question. Returns why it was refused, or null. */
export const answerText = (def: WorkflowDefinition, nodeId: string, value: string) => record(def, nodeId, { kind: 'text', value: value.trim(), at: new Date().toISOString() })

/** Keyboard 1–9 pick options in order; 0 picks "unknown" where the question permits it. */
export function chooseAnswer(n: number) {
  const v = currentView()
  const step = v?.progress.steps[v.index]
  if (!v || step?.type !== 'question' || step.node.input) return
  const visited = new Set(v.progress.visited.slice(0, v.progress.visited.indexOf(step.node.id)))
  if (n === 0) return offeredResponses(step.node, isMandatory(step.node, useCase.getState().session?.answers ?? {}, visited)).includes('unknown') ? answerNode(v.def, step.node.id, UNKNOWN_ID) : undefined
  const opt = step.node.options[n - 1]
  if (opt) answerNode(v.def, step.node.id, opt.id)
}
