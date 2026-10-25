import { describe, expect, it } from 'vitest'
import { BRANCHING as DEMO_WORKFLOW } from '@/test/fixtures'
import { applyAnswer, pruneStale, resolve, summarize } from './engine'
import { validateWorkflow } from './validate'
import type { Answer, Answers, WorkflowDefinition } from '@/types/workflow'

const opt = (optionId: string): Answer => ({ kind: 'option', optionId, at: 't' })
const unknown: Answer = { kind: 'unknown', at: 't' }
const ids = (a: Answers) => Object.keys(a).sort()
const stepIds = (a: Answers) => resolve(DEMO_WORKFLOW, a).steps.map((s) => s.node.id)

describe('resolve', () => {
  it('starts at the start node with nothing answered', () => {
    const p = resolve(DEMO_WORKFLOW, {})
    expect(p.status).toBe('in_progress')
    expect(p.steps.map((s) => s.node.id)).toEqual(['setting'])
  })

  it('follows answers to a terminal and reports completion', () => {
    const a = { setting: opt('indoors'), entrance: opt('yes'), contact: opt('yes') }
    const p = resolve(DEMO_WORKFLOW, a)
    expect(stepIds(a)).toEqual(['setting', 'entrance', 'contact', 'end-done'])
    expect(p.status).toBe('completed')
    expect(p.frontier).toBe(3)
  })

  it('routes unknown through unknownNext without inventing an answer', () => {
    const a = { setting: unknown }
    expect(stepIds(a)).toEqual(['setting', 'contact'])
    expect(a.setting.kind).toBe('unknown')
  })

  it('ends unresolved when unknown has no unknownNext', () => {
    const p = resolve(DEMO_WORKFLOW, { setting: opt('indoors'), entrance: unknown })
    expect(p.status).toBe('ended_unresolved')
    expect(p.steps.at(-1)?.node.id).toBe('entrance')
  })

  it('is deterministic', () => {
    const a = { setting: opt('outdoors') }
    expect(resolve(DEMO_WORKFLOW, a)).toEqual(resolve(DEMO_WORKFLOW, a))
  })

  it('treats an answer whose option no longer exists as unanswered', () => {
    const p = resolve(DEMO_WORKFLOW, { setting: opt('gone') })
    expect(p.status).toBe('in_progress')
    expect(p.staleNodeIds).toContain('setting')
  })
})

describe('applyAnswer', () => {
  it('invalidates the old branch when an earlier answer changes', () => {
    let a: Answers = {}
    for (const [n, o] of [['setting', 'indoors'], ['entrance', 'yes'], ['contact', 'yes']] as const) {
      a = applyAnswer(DEMO_WORKFLOW, a, n, opt(o)).answers
    }
    const r = applyAnswer(DEMO_WORKFLOW, a, 'setting', opt('outdoors'))
    // The new path stops at the unanswered 'landmark', so everything downstream is discarded.
    expect(r.removed.sort()).toEqual(['contact', 'entrance'])
    expect(ids(r.answers)).toEqual(['setting'])
    expect(stepIds(r.answers)).toEqual(['setting', 'landmark'])
  })

  it('drops answers that the new path no longer reaches', () => {
    let a: Answers = {}
    for (const [n, o] of [['setting', 'indoors'], ['entrance', 'no']] as const) a = applyAnswer(DEMO_WORKFLOW, a, n, opt(o)).answers
    const r = applyAnswer(DEMO_WORKFLOW, a, 'entrance', opt('yes'))
    expect(ids(r.answers)).toEqual(['entrance', 'setting'])
    const r2 = applyAnswer(DEMO_WORKFLOW, r.answers, 'setting', unknown)
    expect(r2.removed).toEqual(['entrance'])
  })

  it('rejects answering a node that is not on the active path', () => {
    expect(() => applyAnswer(DEMO_WORKFLOW, {}, 'contact', opt('yes'))).toThrow(/not on the active path/)
  })

  it('does not mutate its input', () => {
    const a: Answers = { setting: opt('indoors') }
    const copy = structuredClone(a)
    applyAnswer(DEMO_WORKFLOW, a, 'entrance', opt('yes'))
    expect(a).toEqual(copy)
  })
})

describe('pruneStale', () => {
  it('removes off-path answers', () => {
    const a = { setting: opt('outdoors'), entrance: opt('yes') }
    expect(ids(pruneStale(DEMO_WORKFLOW, a))).toEqual(['setting'])
  })
})

describe('validateWorkflow', () => {
  const base = () => structuredClone(DEMO_WORKFLOW) as unknown as Record<string, unknown> & { nodes: Record<string, unknown>[] }
  const codes = (x: unknown) => {
    const r = validateWorkflow(x)
    return r.ok ? [] : r.issues.map((i) => i.code)
  }

  it('accepts the demo workflow', () => expect(validateWorkflow(DEMO_WORKFLOW).ok).toBe(true))

  it('rejects structurally invalid input', () => expect(codes({ id: 'x' })).toContain('schema'))

  it('detects duplicate node ids', () => {
    const w = base()
    w.nodes.push({ ...w.nodes[4] })
    expect(codes(w)).toContain('duplicate-node')
  })

  it('detects duplicate option ids', () => {
    const w = base()
    ;(w.nodes[0]!.options as { id: string }[])[1]!.id = 'indoors'
    expect(codes(w)).toContain('duplicate-option')
  })

  it('detects missing transition targets', () => {
    const w = base()
    ;(w.nodes[0]!.options as { next: string }[])[0]!.next = 'nowhere'
    expect(codes(w)).toContain('missing-target')
  })

  it('detects a missing start node', () => {
    const w = base()
    w.start = 'nope'
    expect(codes(w)).toContain('missing-start')
  })

  it('detects unreachable nodes', () => {
    const w = base()
    w.nodes.push({ kind: 'terminal', id: 'orphan', outcome: 'x' })
    expect(codes(w)).toContain('unreachable')
  })

  it('detects cycles', () => {
    const w = base()
    ;(w.nodes[3]!.options as { next: string }[])[0]!.next = 'setting'
    expect(codes(w)).toContain('cycle')
  })

  it('requires a terminal node', () => {
    const w = base()
    w.nodes = w.nodes.filter((n) => n.kind !== 'terminal')
    expect(codes(w)).toContain('no-terminal')
  })
})

describe('conditional transitions and unavailable answers', () => {
  const cond: WorkflowDefinition = {
    id: 'c',
    name: 'c',
    schemaVersion: 1,
    start: 'entry',
    nodes: [
      { kind: 'question', id: 'entry', prompt: 'e', options: [{ id: 'a', label: 'A', next: 'shared' }, { id: 'b', label: 'B', next: 'shared' }], unknownNext: 'end-unknown', unavailableNext: 'end-unavail' },
      { kind: 'question', id: 'shared', prompt: 's', options: [{ id: 'yes', label: 'Yes', next: 'end-default', nextIf: [{ node: 'entry', option: 'b', next: 'end-b' }] }] },
      { kind: 'terminal', id: 'end-default', outcome: 'd' },
      { kind: 'terminal', id: 'end-b', outcome: 'b' },
      { kind: 'terminal', id: 'end-unknown', outcome: 'u' },
      { kind: 'terminal', id: 'end-unavail', outcome: 'x' },
    ],
  }
  const last = (a: Answers) => resolve(cond, a).steps.at(-1)?.node.id

  it('same answer leads to different nodes depending on an earlier answer', () => {
    expect(last({ entry: opt('a'), shared: opt('yes') })).toBe('end-default')
    expect(last({ entry: opt('b'), shared: opt('yes') })).toBe('end-b')
  })

  it('changing the earlier answer re-routes downstream while keeping the still-valid answer', () => {
    const r = applyAnswer(cond, { entry: opt('a'), shared: opt('yes') }, 'entry', opt('b'))
    expect(r.removed).toEqual([])
    expect(last(r.answers)).toBe('end-b')
  })

  it('keeps unknown and unavailable as distinct answers with separate routes', () => {
    expect(last({ entry: unknown })).toBe('end-unknown')
    expect(last({ entry: { kind: 'unavailable', at: 't' } })).toBe('end-unavail')
    expect(resolve(cond, { entry: unknown }).staleNodeIds).toEqual([])
  })

  it('ends unresolved when the route for unavailable is not defined', () => {
    const noRoute = { ...cond, nodes: cond.nodes.map((n) => (n.id === 'entry' && n.kind === 'question' ? { ...n, unavailableNext: undefined } : n)) }
    expect(resolve(noRoute, { entry: { kind: 'unavailable', at: 't' } }).status).toBe('ended_unresolved')
  })

  it('validates condition references', () => {
    const bad = structuredClone(cond)
    ;(bad.nodes[1] as { options: { nextIf: { option: string }[] }[] }).options[0]!.nextIf[0]!.option = 'zzz'
    const r = validateWorkflow(bad)
    expect(r.ok ? [] : r.issues.map((i) => i.code)).toContain('bad-condition')
    expect(validateWorkflow(cond).ok).toBe(true)
  })

  it('summarizes answers without presenting unasked questions as facts', () => {
    expect(summarize(cond, { entry: opt('a') })).toEqual(['e -> A', 's -> NOT YET ASKED'])
    expect(summarize(cond, { entry: unknown })).toEqual(['e -> Unknown', 'Outcome: u'])
  })
})
