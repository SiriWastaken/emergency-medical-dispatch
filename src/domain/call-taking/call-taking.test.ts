import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { beforeAll, describe, expect, it } from 'vitest'
import { CALL_TAKING, CALL_TAKING_ISSUES } from '@/data/call-taking'
import { applyAnswer, resolve, validateProgress } from '@/domain/workflow-engine/engine'
import { validateWorkflow } from '@/domain/workflow-engine/validate'
import { TYPE_CONFIG } from '@/domain/incident-types'
import { buildNarrative } from '@/domain/narrative'
import { emptyField, FIELD_KEYS, INCIDENT_TYPES, type FieldKey, type FieldValue } from '@/types/incident'
import { checkStep, conditionProblem, satisfies } from './rules'
import { parseWorkbook } from './parse'

const root = join(__dirname, '../../..')
type Grid = unknown[][]
let sheets: Record<string, Grid>
const complaints = new Set((JSON.parse(readFileSync(join(root, 'src/data/workflows/catalogue.json'), 'utf8')) as { entries: { label: string }[] }).entries.map((e) => e.label))
const parse = (s: Record<string, Grid> = sheets) => parseWorkbook(s, { workbook: 'test.xlsx', complaints })
/** The real workbook with extra rows appended to some sheets. */
const withRows = (extra: Record<string, unknown[][]>): Record<string, Grid> =>
  Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, [...v, ...(extra[k] ?? [])]]))
const without = (name: string) => Object.fromEntries(Object.entries(sheets).filter(([k]) => k !== name))

beforeAll(async () => {
  sheets = Object.fromEntries((await readXlsxFile(join(root, 'call-taking-workflow.xlsx'))).map((s) => [s.sheet, s.data as Grid]))
})

describe('the workbook', () => {
  it('has every required worksheet with its required columns', () => {
    expect(Object.keys(sheets)).toEqual(expect.arrayContaining(['Case Entry', 'Questions', 'Branches', 'Narratives', 'Validation', 'Workflows', 'Instructions', 'Read Me']))
    const header = (n: string) => sheets[n]![0]!.map(String)
    expect(header('Case Entry')).toEqual(expect.arrayContaining(['Prompt ID', 'Incident Type', 'Prompt', 'Input Type', 'Required', 'Validation', 'Next Step']))
    expect(header('Questions')).toEqual(expect.arrayContaining(['Question ID', 'Incident Type', 'Chief Complaint', 'Question', 'Answer Choices', 'Required', 'Workflow Stage']))
    expect(header('Branches')).toEqual(expect.arrayContaining(['Question ID', 'Answer Choice', 'Next']))
    expect(header('Narratives')).toEqual(expect.arrayContaining(['Incident Type', 'Field ID', 'Display Label', 'Source Answer', 'Output Order']))
    expect(header('Validation')).toEqual(expect.arrayContaining(['Rule ID', 'Applicable Step', 'Validation Condition', 'Error Message']))
  })

  it('is valid, and the definition the app loads is exactly what it produces (nothing hand-edited, nothing stale)', () => {
    const r = parseWorkbook(sheets, { workbook: 'call-taking-workflow.xlsx', complaints })
    expect(r.issues).toEqual([])
    const committed = JSON.parse(readFileSync(join(root, 'src/data/call-taking/definition.json'), 'utf8')) as unknown
    expect(JSON.parse(JSON.stringify(r.definition))).toEqual(committed)
    expect(CALL_TAKING_ISSUES).toEqual([])
  })
})

describe('case-entry sequence', () => {
  const PROMPTS = [
    ['incident-type', 'Select the incident type.'],
    ['location', 'Where is the emergency? Give me the address or location.'],
    ['callback', 'What phone number are you calling from?'],
    ['what-happening', 'Tell me exactly what is happening.'],
    ['chief-complaint', 'Select the chief complaint.'],
  ]

  it('asks exactly: incident type, location, callback number, what is happening, chief complaint, in that order, for every type', () => {
    for (const type of INCIDENT_TYPES) {
      expect(CALL_TAKING.caseEntry[type]!.map((p) => [p.id, p.prompt]), type).toEqual(PROMPTS)
    }
  })

  it('transitions from the chief complaint directly into the matching question tree', () => {
    for (const type of INCIDENT_TYPES) {
      const seq = CALL_TAKING.caseEntry[type]!
      expect(seq.map((p) => p.next)).toEqual(['location', 'callback', 'what-happening', 'chief-complaint', 'WORKFLOW'])
      expect(seq.at(-1)!.input).toBe('select-complaint')
    }
  })

  it('the app shows these prompts after the incident type has been chosen, and nothing else', () => {
    for (const type of INCIDENT_TYPES) expect(TYPE_CONFIG[type].steps.map((s) => s.id)).toEqual(['location', 'callback', 'what-happening', 'chief-complaint'])
  })

  it('never requests a caller name, patient name or any patient detail automatically', () => {
    const banned: FieldKey[] = ['callerName', 'patientName', 'patientAge', 'sex', 'consciousStatus', 'breathingStatus', 'patientCount', 'callerRelationship', 'personsInvolved']
    // (case entry itself asks for none of the above; the question trees may ask for details, but never for names)
    for (const type of INCIDENT_TYPES) {
      for (const p of CALL_TAKING.caseEntry[type]!) {
        expect(banned, `${type}/${p.id}`).not.toContain(p.field)
        expect(p.prompt).not.toMatch(/\b(name|age|old|sex|gender|conscious|breathing)\b/i)
      }
    }
    const asked = CALL_TAKING.workflows.flatMap((w) => w.nodes.flatMap((n) => (n.kind === 'question' ? [n] : [])))
    expect(asked.length).toBeGreaterThan(100)
    // No shipped question asks for a name, or fills a name field.
    expect(asked.filter((q) => q.field === 'callerName' || q.field === 'patientName')).toEqual([])
    expect(asked.filter((q) => /\bname\b/i.test(q.prompt))).toEqual([])
  })

  it('maps each prompt to its incident field and rejects values that break its rules', () => {
    const rule = (step: string, value: string) => checkStep(CALL_TAKING.rules, step, value, { catalogue: complaints })
    expect(rule('callback', '555-0100')).toBeNull()
    expect(rule('callback', 'call me')).toMatch(/digits/)
    expect(rule('location', '')).toBeTruthy()
    expect(rule('chief-complaint', 'Made-up complaint')).toMatch(/from the list/)
    expect(rule('chief-complaint', 'Abdominal pain')).toBeNull()
    expect(rule('incident-type', 'XX')).toMatch(/EMS, PD or FD/)
  })
})

describe('workflows and content status', () => {
  it('ships a complete roleplay tree for the major complaints of every type, plus a fallback for the rest', () => {
    const map = (t: string) => CALL_TAKING.workflowMap.filter((w) => w.incidentType === t)
    expect(map('EMS').length).toBeGreaterThanOrEqual(15)
    expect(map('PD').length).toBeGreaterThanOrEqual(10)
    expect(map('FD').length).toBeGreaterThanOrEqual(10)
    for (const t of INCIDENT_TYPES) expect(map(t).some((w) => w.complaint === '*'), `${t} fallback`).toBe(true)
    for (const label of ['Cardiac arrest / unresponsive person', 'Chest pain or cardiac symptoms', 'Breathing difficulty', 'Choking', 'Seizure or convulsions', 'Stroke-like symptoms', 'Overdose or poisoning', 'Bleeding', 'Burns', 'Pregnancy or childbirth']) {
      expect(map('EMS').map((w) => w.complaint), label).toContain(label)
    }
    expect(map('PD').map((w) => w.complaint)).toEqual(expect.arrayContaining(['Assault or reported violence', 'Domestic disturbance', 'Break and enter', 'Traffic collision']))
    expect(map('FD').map((w) => w.complaint)).toEqual(expect.arrayContaining(['Structure fire', 'Vehicle fire', 'Carbon monoxide alarm', 'Gas leak or odor']))
  })

  it('labels all of it as roleplay training content, never as authorized or verified', () => {
    for (const w of CALL_TAKING.workflows) {
      expect(validateWorkflow(w).ok, w.id).toBe(true)
      expect(w.status).toBe('pending-validation')
      expect(w.provenance?.origin).toBe('roleplay')
      expect(w.incomplete).toBeUndefined()
    }
    expect(CALL_TAKING.instructions.every((i) => i.status === 'ROLEPLAY' && i.source?.includes('Not a certified protocol'))).toBe(true)
  })

  it('every question tree is well formed: every path ends at a prioritized outcome, every instruction exists, every number is range-checked', () => {
    const instructionIds = new Set(CALL_TAKING.instructions.map((i) => i.id))
    for (const w of CALL_TAKING.workflows) {
      const nodes = new Map(w.nodes.map((n) => [n.id, n]))
      const terminals = w.nodes.filter((n) => n.kind === 'terminal')
      expect(terminals.length, w.id).toBeGreaterThan(0)
      for (const n of terminals) {
        expect(n.outcome, n.id).toMatch(/^Priority [123]: /)
        if (n.instruction) expect(instructionIds.has(n.instruction), `${w.id}: ${n.instruction}`).toBe(true)
      }
      // From every node there must be a way forward, and every way must lead to an outcome (no dead ends).
      const reaches = new Map<string, boolean>()
      const walk = (id: string): boolean => {
        if (reaches.has(id)) return reaches.get(id)!
        reaches.set(id, false) // a loop would never reach an outcome
        const n = nodes.get(id)!
        const next = n.kind === 'terminal' ? [] : [...n.options.flatMap((o) => [o.next, ...(o.nextIf ?? []).map((c) => c.next)]), ...(n.next ? [n.next] : []), n.unknownNext, n.unavailableNext, n.notAskedNext].filter((x): x is string => !!x)
        const ok = n.kind === 'terminal' || (next.length > 0 && next.every(walk))
        reaches.set(id, ok)
        return ok
      }
      expect(walk(w.start), `${w.id}: some path never reaches an outcome`).toBe(true)
      for (const n of w.nodes) {
        if (n.kind === 'question' && n.input?.format === 'integer') expect(n.checks?.some((c) => c.condition.startsWith('integer:')), `${w.id}: ${n.id} needs a range`).toBe(true)
      }
    }
  })

  it('every EMS tree that begins with the common questions fills all six patient narrative fields', () => {
    const FIELDS = ['callerRelationship', 'patientCount', 'patientAge', 'sex', 'consciousStatus', 'breathingStatus']
    for (const w of CALL_TAKING.workflows.filter((x) => x.service === 'EMS' && x.id !== 'ems-choking')) {
      const asked = new Set(w.nodes.flatMap((n) => (n.kind === 'question' && n.field ? [n.field] : [])))
      for (const f of FIELDS) expect(asked.has(f as never), `${w.id} asks for ${f}`).toBe(true)
    }
  })

  it('walks real scenarios to the right outcome and instruction', () => {
    const wf = (id: string) => CALL_TAKING.workflows.find((w) => w.id === id)!
    const run = (id: string, steps: [string, import('@/types/workflow').Answer][]) => {
      void id
      const w = wf(id)
      let a: Parameters<typeof resolve>[1] = {}
      for (const [q, ans] of steps) a = applyAnswer(w, a, `${id}:${id}-${q}`, ans).answers
      return { progress: resolve(w, a), answers: a, w }
    }
    const opt = (o: string) => ({ kind: 'option' as const, optionId: o, at: 't' })
    const end = (r: ReturnType<typeof run>) => r.progress.steps.at(-1)!.node as { kind: 'terminal'; outcome: string; instruction?: string; id: string }

    // Unconscious and not breathing: straight to cardiac arrest handling with the CPR script, before any other question.
    const arrest = run('ems-chest', [['conscious', opt('no')], ['breathing', opt('no')]])
    expect(end(arrest)).toMatchObject({ kind: 'terminal', instruction: 'cpr' })
    expect(end(arrest).outcome).toMatch(/Priority 1.*cardiac arrest/)
    // The same breathing answer from an awake patient does NOT trigger it.
    const awake = run('ems-chest', [['conscious', opt('yes')], ['breathing', opt('no')]])
    expect(awake.progress.steps.at(-1)!.node.id).toBe('ems-chest:ems-chest-count')

    // Chest pain spreading to the arm is Priority 1 with chest-pain care; no pain is Priority 2.
    const common = (): [string, import('@/types/workflow').Answer][] => [['conscious', opt('yes')], ['breathing', opt('yes-normally')], ['count', { kind: 'text', value: '1', at: 't' }], ['age', { kind: 'text', value: '58', at: 't' }], ['sex', opt('male')], ['relationship', opt('family-member')]].map(([q, a]) => [q as string, a as import('@/types/workflow').Answer])
    const chest = run('ems-chest', [...common(), ['pain', opt('yes')], ['spread', opt('yes')]])
    expect(end(chest)).toMatchObject({ instruction: 'chest-pain-care' })
    expect(end(chest).outcome).toMatch(/^Priority 1/)
    const noPain = run('ems-chest', [...common(), ['pain', opt('no')], ['heartmeds', opt('yes')]])
    expect(end(noPain).outcome).toMatch(/^Priority 2/)

    // Choking: a baby gets the infant script, an older patient the Heimlich script, someone who can cough gets neither.
    expect(end(run('ems-choking', [['cough', opt('no')], ['baby', opt('yes')]]))).toMatchObject({ instruction: 'choking-infant' })
    expect(end(run('ems-choking', [['cough', opt('no')], ['baby', opt('no')]]))).toMatchObject({ instruction: 'choking' })
    expect(end(run('ems-choking', [['cough', opt('yes')]])).instruction).toBe('breathing-care')

    // Police: a weapon makes it Priority 1; a quiet report is routine.
    const w = run('pd-assault', [['now', opt('yes')], ['hurt', opt('no')], ['weapon', opt('yes')]])
    expect(end(w).outcome).toMatch(/^Priority 1/)
    expect(end(run('pd-theft', [['there', opt('no')], ['ago', opt('longer-ago')], ['what', { kind: 'text', value: 'A bicycle', at: 't' }]])).outcome).toMatch(/^Priority 3/)
    // Fire: anyone trapped is Priority 1 with the get-out script.
    expect(end(run('fd-structure', [['trapped', opt('yes')]]))).toMatchObject({ instruction: 'fire-evacuate' })
    expect(end(run('fd-gas', [['inside', opt('yes')], ['sick', opt('no')]]))).toMatchObject({ instruction: 'gas-leak-evacuate' })
  })

  it('a workbook placeholder (no content yet) still can never validate as complete', () => {
    const edited = { ...sheets, Workflows: sheets.Workflows!.map((r) => (r[0] === 'ems-general' ? [r[0], r[1], r[2], 'Placeholder', 'INCOMPLETE - CONTENT REQUIRED', '', '', ''] : r)), Questions: sheets.Questions!.filter((r) => !String(r[0]).startsWith('ems-general-')), Branches: sheets.Branches!.filter((r) => !String(r[0]).startsWith('ems-general-')), Validation: sheets.Validation!.filter((r) => !String(r[1]).startsWith('ems-general-')) }
    const r = parse(edited)
    expect(r.issues).toEqual([])
    const w = r.definition!.workflows.find((x) => x.id === 'ems-general')!
    expect(w.incomplete).toMatch(/CONTENT REQUIRED/)
    expect(resolve(w, {}).steps[0]?.type).toBe('terminal') // reaching the end is not completion
    expect(validateProgress(w, {})).toMatchObject({ state: 'incomplete', issues: [expect.objectContaining({ code: 'content-required' })] })
  })

  it('every instruction has words to read, a title, and is labelled roleplay; CPR, infant CPR and choking are among them', () => {
    for (const type of INCIDENT_TYPES) {
      const ids = CALL_TAKING.instructions.filter((i) => i.incidentType === type).map((i) => i.id)
      expect(ids).toEqual(expect.arrayContaining(type === 'PD' ? ['cpr', 'choking', 'pd-stay-safe'] : ['cpr', 'cpr-infant', 'choking', 'choking-infant']))
    }
    for (const i of CALL_TAKING.instructions) {
      expect(i.script.split('\n').length, i.id).toBeGreaterThan(2)
      expect(i.title.length).toBeGreaterThan(5)
    }
    const cpr = CALL_TAKING.instructions.find((i) => i.id === 'cpr')!
    expect(cpr.script).toMatch(/center of the chest/)
    expect(cpr.script).toMatch(/100 to 120/)
    expect(CALL_TAKING.instructions.find((i) => i.id === 'choking')!.script).toMatch(/thrusts/)
  })
})

describe('narratives come from the Narratives sheet', () => {
  const fields = (over: Partial<Record<FieldKey, Partial<FieldValue>>>) => Object.fromEntries(FIELD_KEYS.map((k) => [k, { ...emptyField(), ...over[k] }])) as Record<FieldKey, FieldValue>
  it('keeps the EMS (8 lines) and PD/FD (3 lines) formats, in the sheet’s order, each followed by the instructions line', () => {
    expect(CALL_TAKING.narratives.EMS!.map((l) => l.label)).toEqual(['PHONE NUMBER:', "CALLER'S PROBLEM DESCRIPTION IS:", "CALLER'S RELATIONSHIP TO PATIENT:", 'NUMBER OF HURT/SICK:', 'PATIENT(S) AGE IS:', 'PATIENT(S) SEX IS:', 'PATIENT(S) CONSCIOUS STATUS:', 'PATIENT(S) BREATHING STATUS:', 'EMERGENCY INSTRUCTIONS GIVEN:'])
    expect(CALL_TAKING.narratives.PD!.map((l) => l.label)).toEqual(['PHONE NUMBER:', "CALLER'S NAME:", "CALLER'S PROBLEM DESCRIPTION:", 'EMERGENCY INSTRUCTIONS GIVEN:'])
  })
  it('every EMS line is filled by the question trees; only the never-asked caller name is UNASSIGNED', () => {
    expect(CALL_TAKING.narratives.EMS!.filter((l) => l.sources === null)).toEqual([])
    expect(CALL_TAKING.narratives.PD!.filter((l) => l.sources === null).map((l) => l.fields[0])).toEqual(['callerName'])
    const text = buildNarrative({ type: 'EMS', fields: fields({ callerPhone: { state: 'answered', value: '555-0100' }, complaint: { state: 'answered', value: 'Burns' }, description: { state: 'answered', value: 'Scalded' } }) })
    expect(text).toContain('PHONE NUMBER: 555-0100')
    expect(text).toContain("CALLER'S PROBLEM DESCRIPTION IS: Burns - Scalded")
    expect(text).toContain('PATIENT(S) AGE IS: NOT YET RECORDED')
    expect(buildNarrative({ type: 'PD', fields: fields({}) })).toContain("CALLER'S NAME: NOT YET RECORDED")
  })
  it('applies a Format suffix only to a plain number', () => {
    const age = (v: string) => buildNarrative({ type: 'EMS', fields: fields({ patientAge: { state: 'answered', value: v } }) })
    expect(age('34')).toContain('PATIENT(S) AGE IS: 34 YEARS')
    expect(age('about 30')).toContain('PATIENT(S) AGE IS: about 30\n')
  })
})

describe('rules', () => {
  it('evaluates every condition type', () => {
    expect(satisfies('required', ' ')).toBe(false)
    expect(satisfies('required', 'x')).toBe(true)
    expect(satisfies('regex:^\\d+$', '12')).toBe(true)
    expect(satisfies('regex:^\\d+$', 'a')).toBe(false)
    expect(satisfies('one-of:a, b', 'b')).toBe(true)
    expect(satisfies('one-of:a,b', 'c')).toBe(false)
    expect(satisfies('integer:0-120', '120')).toBe(true)
    expect(satisfies('integer:0-120', '121')).toBe(false)
    expect(satisfies('integer:0-120', 'x')).toBe(false)
    expect(satisfies('max-length:3', 'abcd')).toBe(false)
    expect(satisfies('in-catalogue', 'A', { catalogue: new Set(['A']) })).toBe(true)
    expect(satisfies('in-catalogue', 'B', { catalogue: new Set(['A']) })).toBe(false)
    expect(satisfies('regex:^\\d+$', '')).toBe(true) // an empty value only fails "required"
  })
  it('rejects malformed conditions', () => {
    for (const bad of ['maybe', 'regex:(', 'integer:5', 'max-length:x', 'one-of:']) expect(conditionProblem(bad), bad).toBeTruthy()
    for (const ok of ['required', 'in-catalogue', 'regex:^x$', 'one-of:a,b', 'integer:1-2', 'max-length:5']) expect(conditionProblem(ok), ok).toBeNull()
  })
})

describe('conditional branching from the workbook', () => {
  // A complete test tree, written as workbook rows. It exists only in this test.
  const tree = (extra: Partial<Record<string, unknown[][]>> = {}) =>
    withRows({
      Workflows: [['t-wf', 'EMS', 'Dehydration', 'Test tree', 'COMPLETE', '', 'test', '']],
      Questions: [
        ['q-a', 'EMS', 'Dehydration', 'First test question?', 'Alpha|Beta|Gamma', 'Yes', 'Key Questions', 'choice', ''],
        ['q-b', 'EMS', 'Dehydration', 'Follow-up for Alpha?', 'Yes|No', 'Yes', 'Key Questions', 'choice', 'sex'],
        ['q-c', 'EMS', 'Dehydration', 'Optional follow-up?', 'Yes|No', 'No', 'Key Questions', 'choice', ''],
        ['q-t', 'EMS', 'Dehydration', 'Type a number', '', 'Yes', 'Key Questions', 'integer', 'patientCount'],
        ...(extra.Questions ?? []),
      ],
      Branches: [
        ['q-a', 'Alpha', 'q-b', '', ''],
        ['q-a', 'Beta', 'q-c', '', ''],
        ['q-a', 'Gamma', 'TERMINAL:gamma', 'Gamma outcome', 'cpr'],
        ['q-a', '(unknown)', 'q-t', '', ''],
        ['q-b', 'Yes', 'TERMINAL:done', 'Done outcome', ''],
        ['q-b', 'No', 'q-c', '', ''],
        ['q-c', 'Yes', 'TERMINAL:done', 'Done outcome', ''],
        ['q-c', 'No', 'TERMINAL:done', 'Done outcome', ''],
        ['q-c', '(not asked)', 'TERMINAL:done', 'Done outcome', ''],
        ['q-t', '(answered)', 'TERMINAL:done', 'Done outcome', ''],
        ...(extra.Branches ?? []),
      ],
    })

  it('builds a validated workflow, attaches it to its chief complaint, and branches on each answer', () => {
    const r = parse(tree())
    expect(r.issues).toEqual([])
    const def = r.definition!
    const wf = def.workflows.find((w) => w.id === 't-wf')!
    expect(def.workflowMap).toContainEqual({ workflowId: 't-wf', incidentType: 'EMS', complaint: 'Dehydration' })
    expect(validateWorkflow(wf).ok).toBe(true)
    const at = (answers: Parameters<typeof resolve>[1]) => resolve(wf, answers).steps.map((s) => s.node.id.replace('t-wf:', ''))
    const opt = (optionId: string) => ({ kind: 'option' as const, optionId, at: 't' })
    expect(at({})).toEqual(['q-a'])
    expect(at({ 't-wf:q-a': opt('alpha') })).toEqual(['q-a', 'q-b'])
    expect(at({ 't-wf:q-a': opt('beta') })).toEqual(['q-a', 'q-c'])
    expect(at({ 't-wf:q-a': opt('gamma') })).toEqual(['q-a', 'gamma'])
    expect(at({ 't-wf:q-a': { kind: 'unknown', at: 't' } })).toEqual(['q-a', 'q-t'])
    expect(at({ 't-wf:q-a': opt('alpha'), 't-wf:q-b': opt('no') })).toEqual(['q-a', 'q-b', 'q-c'])
  })

  it('carries required/optional, typed answers, field mapping, stage, terminals and instructions through', () => {
    const wf = parse(tree()).definition!.workflows.find((w) => w.id === 't-wf')!
    const q = (id: string) => wf.nodes.find((n) => n.id === `t-wf:${id}`) as Extract<(typeof wf.nodes)[number], { kind: 'question' }>
    expect(q('q-a')).toMatchObject({ mandatory: true, stage: 'Key Questions', options: [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma' }] })
    expect(q('q-c')).toMatchObject({ mandatory: false, notAskedNext: 't-wf:done' })
    expect(q('q-b').field).toBe('sex')
    expect(q('q-t')).toMatchObject({ input: { format: 'integer' }, field: 'patientCount', next: 't-wf:done' })
    expect(wf.nodes.find((n) => n.id === 't-wf:gamma')).toMatchObject({ kind: 'terminal', outcome: 'Gamma outcome', instruction: 'cpr' })
    expect(applyAnswer(wf, {}, 't-wf:q-a', { kind: 'unknown', at: 't' }).answers).toBeDefined()
  })

  it.each([
    ['an answer with no Branches row', { Branches: [] as unknown[][], Questions: [['q-x', 'EMS', 'Dehydration', 'Q?', 'One|Two', 'Yes', '', 'choice', '']] }, /answer "One" of "q-x" has no unconditional row in Branches/],
    ['a branch to a question that does not exist', { Questions: [['q-n', 'EMS', 'Dehydration', 'Q?', 'X', 'Yes', '', 'choice', '']], Branches: [['q-n', 'X', 'nope', '', '']] }, /next question "nope" does not exist/],
    ['two Branches rows for one answer', { Branches: [['q-a', 'Alpha', 'q-c', '', '']] }, /more than one Branches row for "Alpha"/],
    ['a terminal with no outcome', { Branches: [['q-z', 'Yes', 'TERMINAL:x', '', '']] }, /unknown question|needs a Terminal Outcome/],
    ['a branch for an answer that is not a choice', { Branches: [['q-a', 'Delta', 'q-b', '', '']] }, /"Delta" is not an answer to "q-a"/],
    ['a required question that can be skipped', { Branches: [['q-a', '(not asked)', 'q-b', '', '']] }, /must not define a not-asked route/],
    ['an optional question that cannot be skipped', { Questions: [['q-o', 'EMS', 'Dehydration', 'Optional?', 'Y|N', 'No', '', 'choice', '']], Branches: [['q-o', 'Y', 'TERMINAL:done', 'Done outcome', ''], ['q-o', 'N', 'TERMINAL:done', 'Done outcome', '']] }, /defines no not-asked route/],
    ['a question for a complaint that has no workflow', { Questions: [['q-w', 'PD', 'Welfare check', 'Q?', 'A|B', 'Yes', '', 'choice', '']] }, /belongs to no workflow/],
    ['a typed question that mixes in choices', { Questions: [['q-y', 'EMS', 'Dehydration', 'Type', 'A|B', 'Yes', '', 'text', 'description']] }, /must not list answer choices/],
  ])('rejects %s', (_name, extra, message) => {
    const r = parse(tree(extra))
    expect(r.definition).toBeNull()
    expect(r.issues.join('\n')).toMatch(message)
  })
})

describe('workbook errors are reported with where they are', () => {
  it('reports a missing worksheet, a missing column, and an unknown chief complaint', () => {
    expect(parse(without('Narratives')).issues).toEqual(['Worksheet "Narratives" is missing'])
    const noCol = { ...sheets, Validation: sheets.Validation!.map((r) => r.slice(0, 3)) }
    expect(parse(noCol).issues.join()).toMatch(/Worksheet "Validation" is missing column\(s\): Error Message/)
    const r = parse(withRows({ Workflows: [['w2', 'EMS', 'Not a real complaint', 'x', 'COMPLETE', '', '', '']] }))
    expect(r.issues.join()).toMatch(/Workflows!\d+: chief complaint "Not a real complaint" is not in the chief-complaint list/)
  })
  it('reports a case-entry sequence that loops, dangles, or leaves a prompt unreachable', () => {
    const edit = (id: string, col: number, value: string) => ({ ...sheets, 'Case Entry': sheets['Case Entry']!.map((r) => (r[0] === id ? r.map((c, i) => (i === col ? value : c)) : r)) })
    expect(parse(edit('callback', 6, 'location')).issues.join()).toMatch(/loops back to "location"/)
    expect(parse(edit('callback', 6, 'nowhere')).issues.join()).toMatch(/points to "nowhere", which is not defined/)
    expect(parse(edit('location', 6, 'what-happening')).issues.join()).toMatch(/"callback" is never reached/)
    expect(parse(edit('chief-complaint', 6, 'location')).issues.join()).toMatch(/must lead to WORKFLOW/)
    expect(parse(edit('callback', 5, 'V-NOPE')).issues.join()).toMatch(/unknown validation rule "V-NOPE"/)
  })
  it('reports bad narrative sources, field ids and order, and bad instructions', () => {
    const rows = (name: string, f: (r: unknown[]) => unknown[]) => ({ ...sheets, [name]: sheets[name]!.map((r, i) => (i === 0 ? r : f(r))) })
    expect(parse(rows('Narratives', (r) => (r[1] === 'callerPhone' ? [r[0], r[1], r[2], 'made-up', r[4], r[5]] : r))).issues.join()).toMatch(/source "made-up" is not a case-entry prompt or question ID/)
    expect(parse(rows('Narratives', (r) => (r[1] === 'callerPhone' ? [r[0], 'phoneNumber', r[2], r[3], r[4], r[5]] : r))).issues.join()).toMatch(/"phoneNumber" is not an incident field/)
    expect(parse(rows('Narratives', (r) => (r[2] === 'PHONE NUMBER:' && r[0] === 'EMS' ? [r[0], r[1], r[2], r[3], 5, r[5]] : r))).issues.join()).toMatch(/output orders must run 1, 2, 3/)
    expect(parse(rows('Instructions', (r) => (r[0] === 'cpr' ? [r[0], r[1], r[2], 'Some words', 'AUTHORIZED', ''] : r))).issues.join()).toMatch(/AUTHORIZED instruction needs both its script and its source/)
    expect(parse(rows('Instructions', (r) => (r[0] === 'cpr' ? [r[0], r[1], r[2], 'Some words', 'CONTENT REQUIRED', ''] : r))).issues.join()).toMatch(/must be marked AUTHORIZED/)
    expect(parse(rows('Validation', (r) => (r[0] === 'V-PHONE' ? [r[0], r[1], 'regex:(', r[3]] : r))).issues.join()).toMatch(/Invalid regular expression/)
  })
  it('an AUTHORIZED instruction with a script and source is accepted and available to read out', () => {
    const edited = { ...sheets, Instructions: sheets.Instructions!.map((r) => (r[0] === 'cpr' ? [r[0], r[1], r[2], 'Test script text', 'AUTHORIZED', 'Test source'] : r)) }
    const r = parse(edited)
    expect(r.issues).toEqual([])
    expect(r.definition!.instructions.filter((i) => i.id === 'cpr').every((i) => i.script === 'Test script text' && i.source === 'Test source')).toBe(true)
  })
})
