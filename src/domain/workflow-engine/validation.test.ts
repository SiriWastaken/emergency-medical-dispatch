import { describe, expect, it } from 'vitest'
import { applyAnswer, applyFieldEffects, fieldEffects, isMandatory, offeredResponses, optionAvailability, resolve, validateProgress, WorkflowError } from './engine'
import { validateWorkflow } from './validate'
import { buildNarrative } from '@/domain/narrative'
import { BRANCHING, CONDITIONAL, RICH, TYPED } from '@/test/fixtures'
import { emptyField, FIELD_KEYS, type FieldKey, type FieldValue } from '@/types/incident'
import type { Answer, Answers, QuestionNode, WorkflowDefinition } from '@/types/workflow'

const opt = (optionId: string): Answer => ({ kind: 'option', optionId, at: 't' })
const resp = (kind: 'unknown' | 'unavailable' | 'not_asked'): Answer => ({ kind, at: 't' })
const fields = (over: Partial<Record<FieldKey, Partial<FieldValue>>> = {}) => Object.fromEntries(FIELD_KEYS.map((k) => [k, { ...emptyField(), ...over[k] }])) as Record<FieldKey, FieldValue>
const ids = (def: WorkflowDefinition, a: Answers) => resolve(def, a).steps.map((s) => s.node.id)
const answerAll = (def: WorkflowDefinition, list: [string, Answer][]) => list.reduce<Answers>((acc, [n, a]) => applyAnswer(def, acc, n, a).answers, {})
const q = (def: WorkflowDefinition, id: string) => def.nodes.find((n) => n.id === id) as QuestionNode
const withNode = (def: WorkflowDefinition, id: string, patch: object): WorkflowDefinition => ({ ...def, nodes: def.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) as WorkflowDefinition['nodes'] })
const issueCodes = (x: unknown) => { const r = validateWorkflow(x); return r.ok ? [] : r.issues.map((i) => i.code) }

describe('next question for every configured answer', () => {
  it('follows each option, unknown, unavailable and not-asked route exactly as configured', () => {
    const cases: [WorkflowDefinition, [string, Answer][], string][] = [
      [RICH, [['q1', opt('a')]], 'q2'],
      [RICH, [['q1', opt('b')]], 'q3'],
      [RICH, [['q1', opt('c')]], 'q3'],
      [RICH, [['q1', resp('unknown')]], 'q3'],
      [RICH, [['q1', resp('unavailable')]], 'q3'],
      [RICH, [['q1', opt('a')], ['q2', opt('x')]], 'q3'],
      [RICH, [['q1', opt('b')], ['q3', opt('f')]], 'q4'],
      [RICH, [['q1', opt('a')], ['q2', opt('x')], ['q3', resp('not_asked')]], 'q4'],
      [RICH, [['q1', opt('c')], ['q3', opt('m')], ['q4', opt('no')]], 'end'],
      [RICH, [['q1', opt('c')], ['q3', opt('m')], ['q4', resp('not_asked')]], 'end'],
      [BRANCHING, [['setting', opt('indoors')]], 'entrance'],
      [BRANCHING, [['setting', opt('outdoors')]], 'landmark'],
      [BRANCHING, [['setting', resp('unknown')]], 'contact'],
      [CONDITIONAL, [['entry', opt('scenario-c')]], 'c1'],
      [CONDITIONAL, [['entry', resp('unavailable')]], 'end-unavailable'],
    ]
    for (const [def, path, next] of cases) expect(ids(def, answerAll(def, path)).at(-1), JSON.stringify(path)).toBe(next)
  })

  it('every configured transition of every fixture leads to an existing node and every path ends', () => {
    for (const def of [BRANCHING, CONDITIONAL, RICH]) {
      const explore = (answers: Answers, depth: number) => {
        expect(depth).toBeLessThan(20)
        const p = resolve(def, answers) // throws on a missing node or a cycle
        const last = p.steps.at(-1)!
        if (last.type === 'terminal') return
        for (const o of last.node.options) {
          if (optionAvailability(def, answers, last.node.id).has(o.id)) continue
          explore(applyAnswer(def, answers, last.node.id, opt(o.id)).answers, depth + 1)
        }
        const visited = new Set(resolve(def, answers).visited.slice(0, -1))
        for (const r of offeredResponses(last.node, isMandatory(last.node, answers, visited))) explore(applyAnswer(def, answers, last.node.id, resp(r)).answers, depth + 1)
      }
      explore({}, 0)
    }
  })

  it('a different earlier answer reaches a different conditional outcome', () => {
    const a = answerAll(CONDITIONAL, [['entry', opt('scenario-a')], ['a1', opt('yes')], ['shared', opt('yes')]])
    const b = answerAll(CONDITIONAL, [['entry', opt('scenario-b')], ['b1', opt('yes')], ['shared', opt('yes')]])
    expect(ids(CONDITIONAL, a).at(-1)).toBe('end-shared-a')
    expect(ids(CONDITIONAL, b).at(-1)).toBe('end-shared-b')
  })
})

describe('mandatory, optional and conditional questions', () => {
  it('a mandatory question cannot be skipped and offers no not-asked response', () => {
    expect(offeredResponses(q(RICH, 'q1'), true)).toEqual(['unknown', 'unavailable'])
    expect(() => applyAnswer(RICH, {}, 'q1', resp('not_asked'))).toThrow(WorkflowError)
    expect(() => applyAnswer(RICH, {}, 'q1', resp('not_asked'))).toThrow(/does not allow a "not asked" response/)
    expect(validateProgress(RICH, {}).issues.map((i) => i.code)).toContain('unanswered')
  })

  it('a conditionally mandatory question offers "not asked" only while it is not mandatory', () => {
    expect(offeredResponses(q(RICH, 'q3'), true)).toEqual([]) // after B: cannot be skipped
    expect(offeredResponses(q(RICH, 'q3'), false)).toEqual(['not_asked'])
    const b = answerAll(RICH, [['q1', opt('b')]])
    expect(() => applyAnswer(RICH, b, 'q3', resp('not_asked'))).toThrow(/mandatory and cannot be skipped/)
    const c = answerAll(RICH, [['q1', opt('c')]])
    expect(() => applyAnswer(RICH, c, 'q3', resp('not_asked'))).not.toThrow()
    // a stored skip of a now-mandatory question is reported, not followed
    expect(validateProgress(RICH, { q1: opt('b'), q3: resp('not_asked') }).issues).toContainEqual(expect.objectContaining({ code: 'invalid-answer', nodeId: 'q3' }))
  })

  it('a conditionally required question is mandatory only when its condition holds', () => {
    // After B the sex question is mandatory: no skip is possible in the reported progress.
    const b = answerAll(RICH, [['q1', opt('b')]])
    expect(validateProgress(RICH, b).issues[0]?.message).toMatch(/^Required question not yet answered/)
    // After C it is optional and may be skipped.
    const c = answerAll(RICH, [['q1', opt('c')]])
    expect(validateProgress(RICH, c).issues[0]?.message).toMatch(/^Question not yet answered/)
    expect(ids(RICH, answerAll(RICH, [['q1', opt('c')], ['q3', resp('not_asked')]])).at(-1)).toBe('q4')
  })

  it('a question that does not apply is skipped, reported as skipped, and not asked', () => {
    const p = resolve(RICH, answerAll(RICH, [['q1', opt('b')]]))
    expect(p.skipped).toEqual([expect.objectContaining({ nodeId: 'q2' })])
    expect(p.steps.map((s) => s.node.id)).not.toContain('q2')
    expect(ids(RICH, answerAll(RICH, [['q1', opt('a')]]))).toContain('q2')
  })

  it('an optional question may be skipped; skipping is recorded as not asked, never as an answer', () => {
    const a = answerAll(RICH, [['q1', opt('b')], ['q3', opt('f')], ['q4', resp('not_asked')]])
    expect(a.q4).toMatchObject({ kind: 'not_asked' })
    expect(validateProgress(RICH, a, fields({ callerPhone: { state: 'answered', value: '1' } }))).toMatchObject({ state: 'complete', unresolved: [{ nodeId: 'q4', response: 'not_asked' }] })
  })
})

describe('invalid transitions and answers', () => {
  it('refuses a forbidden option with the configured explanation and records nothing', () => {
    const answers = answerAll(RICH, [['q1', opt('c')]])
    expect(optionAvailability(RICH, answers, 'q3').get('o')).toBe('Other is not allowed after Answer C.')
    expect(() => applyAnswer(RICH, answers, 'q3', opt('o'))).toThrow('Other is not allowed after Answer C.')
    expect(() => applyAnswer(RICH, answers, 'q3', opt('f'))).not.toThrow()
    expect(answers.q3).toBeUndefined()
  })

  it('refuses unknown options, and nodes that are not on the active path', () => {
    expect(() => applyAnswer(RICH, {}, 'q1', opt('zzz'))).toThrow(/not an answer to this question/)
    expect(() => applyAnswer(RICH, {}, 'q3', opt('f'))).toThrow(/not on the active path/)
  })

  it('a stored answer that now violates a rule blocks the workflow instead of being followed', () => {
    const stored: Answers = { q1: opt('c'), q3: opt('o') } // e.g. written before the rule existed
    expect(ids(RICH, stored).at(-1)).toBe('q3') // the path does not continue past it
    const report = validateProgress(RICH, stored)
    expect(report.state).toBe('blocked')
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'invalid-answer', message: 'Other is not allowed after Answer C.' }))
  })

  it('refuses a response with no defined route and reports a stored one as unable to proceed', () => {
    expect(() => applyAnswer(BRANCHING, answerAll(BRANCHING, [['setting', opt('indoors')]]), 'entrance', resp('unknown'))).toThrow(WorkflowError)
    const stored: Answers = { setting: opt('indoors'), entrance: resp('unknown') }
    expect(validateProgress(BRANCHING, stored)).toMatchObject({ state: 'blocked', issues: [expect.objectContaining({ code: 'no-route' })] })
  })
})

describe('changing an earlier answer', () => {
  it('discards answers that no longer apply and keeps a re-reached later answer only if it is still on the path', () => {
    const a = answerAll(RICH, [['q1', opt('a')], ['q2', opt('x')], ['q3', opt('f')]])
    const r = applyAnswer(RICH, a, 'q1', opt('b'))
    expect(r.removed).toEqual(['q2']) // q2 no longer applies
    expect(r.answers.q3).toMatchObject({ optionId: 'f' }) // q3 is still on the new path and still valid
    const r2 = applyAnswer(RICH, a, 'q1', opt('c')) // q3 'f' is allowed after C as well
    expect(r2.answers.q3).toBeDefined()
  })

  it('does not mutate the previous answers', () => {
    const a = answerAll(RICH, [['q1', opt('a')]])
    const snapshot = structuredClone(a)
    applyAnswer(RICH, a, 'q1', opt('b'))
    expect(a).toEqual(snapshot)
  })
})

describe('definition validation', () => {
  const base = () => structuredClone(RICH)
  it('accepts every fixture', () => expect([BRANCHING, CONDITIONAL, RICH].every((w) => validateWorkflow(w).ok)).toBe(true))
  it('rejects a skippable mandatory question and an unskippable optional one', () => {
    expect(issueCodes(withNode(base(), 'q1', { notAskedNext: 'q3' }))).toContain('mandatory-skippable')
    expect(issueCodes(withNode(base(), 'q4', { notAskedNext: undefined }))).toContain('optional-unskippable')
    expect(issueCodes(withNode(base(), 'q3', { notAskedNext: undefined }))).toContain('optional-unskippable')
  })
  it('rejects missing nodes and targets in every route type', () => {
    for (const patch of [{ unknownNext: 'nope' }, { unavailableNext: 'nope' }, { notAskedNext: 'nope' }]) expect(issueCodes(withNode(base(), 'q3', patch))).toContain('missing-target')
    expect(issueCodes(withNode(base(), 'q2', { appliesIf: { node: 'q1', anyOf: ['a'], otherwise: 'nope' } }))).toContain('missing-target')
    expect(issueCodes({ ...base(), start: 'nope' })).toContain('missing-start')
  })
  it('rejects bad conditions, bad rules and fields that do not exist for the service', () => {
    expect(issueCodes(withNode(base(), 'q2', { appliesIf: { node: 'q1', anyOf: ['zzz'], otherwise: 'q3' } }))).toContain('bad-condition')
    expect(issueCodes(withNode(base(), 'q3', { mandatoryIf: { node: 'end', anyOf: ['x'] } }))).toContain('bad-condition')
    expect(issueCodes(withNode(base(), 'q3', { rules: [{ when: { node: 'q1', anyOf: ['c'] }, forbid: ['f', 'm', 'o'], message: 'all' }] }))).toContain('bad-rule')
    expect(issueCodes(withNode(base(), 'q3', { rules: [{ when: { node: 'q1', anyOf: ['c'] }, forbid: ['zzz'], message: 'x' }] }))).toContain('bad-rule')
    expect(issueCodes(withNode(base(), 'q3', { field: 'personsInvolved' }))).toContain('bad-field') // not an EMS field
    expect(issueCodes({ ...base(), requiredFields: ['personsInvolved'] })).toContain('bad-field')
  })
  it('detects loops and unreachable nodes through the new route types', () => {
    expect(issueCodes(withNode(base(), 'q4', { notAskedNext: 'q1' }))).toContain('cycle')
    expect(issueCodes({ ...base(), nodes: [...base().nodes, { kind: 'terminal', id: 'orphan', outcome: 'x' }] })).toContain('unreachable')
  })
  it('reports a malformed definition as blocked rather than throwing', () => {
    const report = validateProgress({ ...base(), start: 'nope' }, {})
    expect(report.state).toBe('blocked')
    expect(report.issues[0]?.code).toBe('invalid-definition')
  })
})

describe('completion is decided by the rules, not by the last screen', () => {
  const phone = fields({ callerPhone: { state: 'answered', value: '555' } })
  const done: Answers = answerAll(RICH, [['q1', opt('b')], ['q3', opt('f')], ['q4', opt('yes')]])

  it('complete only at the end, with every rule satisfied', () => {
    expect(validateProgress(RICH, done, phone).state).toBe('complete')
  })
  it('incomplete at the endpoint when a required incident field is missing, then complete once it is recorded', () => {
    expect(resolve(RICH, done).status).toBe('completed') // the last screen was reached...
    const report = validateProgress(RICH, done, fields())
    expect(report.state).toBe('incomplete') // ...but that is not enough
    expect(report.issues).toEqual([expect.objectContaining({ code: 'missing-field', field: 'callerPhone' })])
    expect(validateProgress(RICH, done, fields({ callerPhone: { state: 'unknown' } })).state).toBe('complete') // explicitly unknown counts as addressed
  })
  it('incomplete while a question is open; revalidates immediately when an answer changes', () => {
    expect(validateProgress(RICH, answerAll(RICH, [['q1', opt('b')]]), phone).state).toBe('incomplete')
    const changed = applyAnswer(RICH, done, 'q4', opt('no')).answers
    expect(validateProgress(RICH, changed, phone).state).toBe('complete')
    const reopened = applyAnswer(RICH, done, 'q1', opt('a')).answers // A adds the q2 question, which is unanswered
    expect(validateProgress(RICH, reopened, phone).state).toBe('incomplete')
    expect(validateProgress(RICH, reopened, phone).issues[0]?.nodeId).toBe('q2')
  })
  it('blocked is distinct from incomplete', () => {
    expect(validateProgress(BRANCHING, { setting: opt('indoors'), entrance: resp('unknown') }).state).toBe('blocked')
    expect(validateProgress(BRANCHING, {}).state).toBe('incomplete')
    expect(validateProgress(BRANCHING, answerAll(BRANCHING, [['setting', opt('indoors')], ['entrance', opt('no')]])).state).toBe('complete')
  })
  it('reports answers given as unknown or unavailable as unresolved, not as information', () => {
    const r = validateProgress(CONDITIONAL, answerAll(CONDITIONAL, [['entry', resp('unknown')], ['u1', opt('no')]]))
    expect(r.state).toBe('complete')
    expect(r.unresolved).toEqual([expect.objectContaining({ nodeId: 'entry', response: 'unknown' })])
  })
})

describe('keeping the call narrative in sync', () => {
  it('fills incident fields from answers, with unknown and not-asked kept distinct, and never invents values', () => {
    const o = answerAll(RICH, [['q1', opt('b')], ['q3', opt('m')]])
    expect(fieldEffects(RICH, o)).toEqual({ sex: { state: 'answered', value: 'Male' } })
    expect(fieldEffects(RICH, answerAll(RICH, [['q1', opt('c')], ['q3', resp('not_asked')]]))).toEqual({ sex: { state: 'not_asked', value: '' } })
    expect(fieldEffects(RICH, answerAll(RICH, [['q1', resp('unknown')]]))).toEqual({}) // q3 not answered yet: nothing is filled
  })

  it('applies and reverts effects, but never overwrites or clears a value the operator edited', () => {
    const before = fieldEffects(RICH, answerAll(RICH, [['q1', opt('b')], ['q3', opt('m')]]))
    const filled = applyFieldEffects(fields(), {}, before)
    expect(filled.sex).toEqual({ state: 'answered', value: 'Male' })
    expect(applyFieldEffects(filled, before, {}).sex).toEqual(emptyField()) // answer removed -> cleared
    const edited = { ...filled, sex: { state: 'answered' as const, value: 'Typed by hand' } }
    expect(applyFieldEffects(edited, before, {}).sex.value).toBe('Typed by hand') // manual edit survives
  })

  it('the EMS narrative reflects the answers and reverts when the path changes', () => {
    const inc = (f: Record<FieldKey, FieldValue>) => ({ type: 'EMS' as const, fields: f })
    let f = fields()
    let answers: Answers = {}
    const step = (n: string, a: Answer) => {
      const before = fieldEffects(RICH, answers)
      answers = applyAnswer(RICH, answers, n, a).answers
      f = applyFieldEffects(f, before, fieldEffects(RICH, answers))
    }
    step('q1', opt('b'))
    step('q3', opt('f'))
    expect(buildNarrative(inc(f))).toContain('PATIENT(S) SEX IS: Female')
    step('q1', opt('a')) // A makes q2 apply and open; q3 is no longer on the path, so its answer is discarded
    expect(answers.q3).toBeUndefined()
    expect(buildNarrative(inc(f))).toContain('PATIENT(S) SEX IS: NOT YET RECORDED')
    step('q2', opt('x'))
    step('q3', opt('m'))
    expect(buildNarrative(inc(f))).toContain('PATIENT(S) SEX IS: Male')
  })
})

describe('type-specific workflows', () => {
  it('a PD workflow may not fill medical fields and an EMS one may not fill PD-only fields', () => {
    expect(issueCodes({ ...BRANCHING, nodes: BRANCHING.nodes.map((n) => (n.id === 'setting' ? { ...n, field: 'patientAge' } : n)) })).toContain('bad-field')
    expect(issueCodes(withNode(RICH, 'q1', { field: 'location' }))).toEqual([]) // location exists for EMS
    expect(issueCodes(withNode(RICH, 'q1', { field: 'personsInvolved' }))).toContain('bad-field')
  })
})

describe('input (typed) questions', () => {
  const text = (value: string): Answer => ({ kind: 'text', value, at: 't' })
  it('accepts typed answers, routes to the next question and fills the incident field', () => {
    const a = answerAll(TYPED, [['count', text(' 2 ')], ['age', text('34')], ['who', resp('not_asked')]])
    expect(ids(TYPED, a).at(-1)).toBe('end')
    expect(fieldEffects(TYPED, a)).toMatchObject({ patientCount: { state: 'answered', value: '2' }, patientAge: { state: 'answered', value: '34' }, patientName: { state: 'not_asked', value: '' } })
  })
  it('refuses empty text, non-numbers and out-of-range values with an explanation, recording nothing', () => {
    expect(() => applyAnswer(TYPED, {}, 'count', text('   '))).toThrow(/Enter an answer/)
    expect(() => applyAnswer(TYPED, {}, 'count', text('abc'))).toThrow(/whole number/)
    expect(() => applyAnswer(TYPED, {}, 'count', text('0'))).toThrow(/1 to 999/)
    const upToAge = answerAll(TYPED, [['count', text('1')]])
    expect(() => applyAnswer(TYPED, upToAge, 'age', text('200'))).toThrow(/0 to 120/)
    expect(() => applyAnswer(RICH, {}, 'q1', text('hello'))).toThrow(/not answered by typing/)
  })
  it('validates input definitions', () => {
    const bad = (patch: object) => issueCodes(withNode(TYPED, 'count', patch))
    expect(bad({ next: undefined })).toContain('bad-input')
    expect(bad({ options: [{ id: 'x', label: 'X', next: 'end' }] })).toContain('bad-input')
    expect(issueCodes(withNode(RICH, 'q1', { next: 'q2' }))).toContain('bad-input')
  })
  it('a stored invalid typed answer blocks instead of being followed', () => {
    expect(validateProgress(TYPED, { count: text('lots') }).state).toBe('blocked')
  })
})
