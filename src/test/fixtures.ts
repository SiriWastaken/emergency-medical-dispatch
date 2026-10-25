import { workflowSchema, type WorkflowDefinition } from '@/types/workflow'
import type { CatalogueEntry } from '@/types/catalogue'

// Test-only data. Nothing here ships in the app.

const q = (id: string, prompt: string, options: [string, string, string, { node: string; option: string; next: string }[]?][], extra: object = {}) => ({
  kind: 'question' as const,
  id,
  prompt,
  options: options.map(([oid, label, next, nextIf]) => ({ id: oid, label, next, ...(nextIf && { nextIf }) })),
  ...extra,
})
const t = (id: string, outcome: string) => ({ kind: 'terminal' as const, id, outcome })

/** Small indoors/outdoors tree used by engine and UI tests. */
export const BRANCHING: WorkflowDefinition = workflowSchema.parse({
  id: 'fixture-branching',
  name: 'Fixture: branching',
  schemaVersion: 1,
  service: 'PD',
  category: 'Fixture',
  status: 'pending-validation',
  start: 'setting',
  nodes: [
    q('setting', 'Is the scenario set indoors or outdoors?', [['indoors', 'Indoors', 'entrance'], ['outdoors', 'Outdoors', 'landmark']], { help: 'Changing this answer later discards the branch below it.', unknownNext: 'contact' }),
    q('entrance', 'Is the building entrance easy to find?', [['yes', 'Yes', 'contact'], ['no', 'No', 'end-entrance']]),
    q('landmark', 'Is the outdoor location marked by a landmark?', [['yes', 'Yes', 'contact'], ['no', 'No', 'end-landmark']]),
    q('contact', 'Is a call-back contact available?', [['yes', 'Yes', 'end-done'], ['no', 'No', 'end-no-contact']], { unknownNext: 'end-no-contact' }),
    t('end-done', 'Complete: all questions answered.'),
    t('end-entrance', 'End: entrance details need follow-up.'),
    t('end-landmark', 'End: landmark details need follow-up.'),
    t('end-no-contact', 'End: no call-back contact recorded.'),
  ],
})

/** Conditional transitions, an unknown route and an unavailable route. Placeholder wording only. */
export const CONDITIONAL: WorkflowDefinition = workflowSchema.parse({
  id: 'fixture-conditional',
  name: 'Fixture: conditional',
  schemaVersion: 1,
  service: 'EMS',
  category: 'Fixture',
  status: 'pending-validation',
  start: 'entry',
  nodes: [
    q('entry', '[PLACEHOLDER] Entry question.', [['scenario-a', 'Scenario A', 'a1'], ['scenario-b', 'Scenario B', 'b1'], ['scenario-c', 'Scenario C', 'c1']], { unknownNext: 'u1', unavailableNext: 'end-unavailable' }),
    q('a1', '[PLACEHOLDER] Follow-up for Scenario A.', [['yes', 'Yes', 'shared'], ['no', 'No', 'end-a-no']]),
    q('b1', '[PLACEHOLDER] Follow-up for Scenario B.', [['yes', 'Yes', 'shared'], ['no', 'No', 'end-b-no']]),
    q('c1', '[PLACEHOLDER] Follow-up for Scenario C.', [['yes', 'Yes', 'end-c-yes'], ['no', 'No', 'end-c-no']]),
    q('shared', '[PLACEHOLDER] Is the condition confirmed?', [['yes', 'Yes', 'end-shared-a', [{ node: 'entry', option: 'scenario-b', next: 'end-shared-b' }]], ['no', 'No', 'end-shared-none']]),
    q('u1', 'The scenario could not be established. Is a follow-up available?', [['yes', 'Yes', 'end-unknown-followup'], ['no', 'No', 'end-unknown-none']]),
    t('end-a-no', 'Outcome A-no (placeholder).'),
    t('end-b-no', 'Outcome B-no (placeholder).'),
    t('end-c-yes', 'Outcome C-yes (placeholder).'),
    t('end-c-no', 'Outcome C-no (placeholder).'),
    t('end-shared-a', 'Outcome shared, reached via Scenario A (placeholder).'),
    t('end-shared-b', 'Outcome shared, reached via Scenario B (placeholder).'),
    t('end-shared-none', 'Outcome shared-not-confirmed (placeholder).'),
    t('end-unknown-followup', 'Outcome: scenario unknown, follow-up available (placeholder).'),
    t('end-unknown-none', 'Outcome: scenario unknown, no follow-up (placeholder).'),
    t('end-unavailable', 'Outcome: entry question unavailable; nothing assumed (placeholder).'),
  ],
})

/**
 * Exercises every rule type: a mandatory first question, a question that only applies after one
 * answer, a question mandatory only after another, a rule that forbids an option, an optional
 * (skippable) question, a field that fills in the call narrative, and a required incident field.
 */
export const RICH: WorkflowDefinition = workflowSchema.parse({
  id: 'fixture-rich',
  name: 'Fixture: rich rules',
  schemaVersion: 1,
  service: 'EMS',
  category: 'Fixture',
  status: 'pending-validation',
  requiredFields: ['callerPhone'],
  start: 'q1',
  nodes: [
    q('q1', 'First question (required)?', [['a', 'Answer A', 'q2'], ['b', 'Answer B', 'q2'], ['c', 'Answer C', 'q2']], { unknownNext: 'q2', unavailableNext: 'q2', help: 'Only Answer A makes the next question apply.' }),
    q('q2', 'Extra question that only applies after A?', [['x', 'X', 'q3'], ['y', 'Y', 'q3']], { appliesIf: { node: 'q1', anyOf: ['a'], otherwise: 'q3' } }),
    q('q3', 'Sex of the patient?', [['f', 'Female', 'q4'], ['m', 'Male', 'q4'], ['o', 'Other', 'q4']], {
      field: 'sex',
      mandatoryIf: { node: 'q1', anyOf: ['b'] },
      notAskedNext: 'q4',
      rules: [{ when: { node: 'q1', anyOf: ['c'] }, forbid: ['o'], message: 'Other is not allowed after Answer C.' }],
    }),
    q('q4', 'Optional closing question?', [['yes', 'Yes', 'end'], ['no', 'No', 'end']], { mandatory: false, notAskedNext: 'end' }),
    t('end', 'All done.'),
  ],
})

/** Typed answers (whole numbers and optional text), each checked by rules like the workbook's Validation sheet. */
export const TYPED: WorkflowDefinition = workflowSchema.parse({
  id: 'fixture-typed',
  name: 'Fixture: typed answers',
  schemaVersion: 1,
  service: 'EMS',
  category: 'Fixture',
  status: 'pending-validation',
  requiredFields: ['callerPhone', 'complaint'],
  start: 'count',
  nodes: [
    { kind: 'question', id: 'count', prompt: 'How many people are affected?', options: [], input: { format: 'integer' }, next: 'age', field: 'patientCount', unknownNext: 'age', unavailableNext: 'age', checks: [{ condition: 'integer:1-999', message: 'Enter 1 to 999.' }] },
    { kind: 'question', id: 'age', prompt: 'How old is the patient (in years)?', options: [], input: { format: 'integer' }, next: 'who', field: 'patientAge', unknownNext: 'who', unavailableNext: 'who', checks: [{ condition: 'integer:0-120', message: 'Enter an age from 0 to 120.' }] },
    { kind: 'question', id: 'who', prompt: 'Who is the patient? (optional)', options: [], input: { format: 'text' }, next: 'end', field: 'patientName', mandatory: false, notAskedNext: 'end' },
    t('end', 'Typed fixture complete.'),
  ],
})

/** A workflow whose endpoint tells the call-taker to read out an instruction. */
export const INSTRUCTED: WorkflowDefinition = workflowSchema.parse({
  id: 'fixture-instructed',
  name: 'Fixture: instruction at the endpoint',
  schemaVersion: 1,
  service: 'EMS',
  category: 'Fixture',
  status: 'pending-validation',
  start: 'ask',
  nodes: [
    q('ask', 'Is an instruction needed?', [['yes', 'Yes', 'give'], ['no', 'No', 'none']]),
    { kind: 'terminal', id: 'give', outcome: 'Read the instruction to the caller.', instruction: 'cpr' },
    t('none', 'No instruction needed.'),
  ],
})

export const FIXTURE_WORKFLOWS = [BRANCHING, CONDITIONAL, RICH, TYPED, INSTRUCTED]

/** Natures of call that start the fixture workflows. */
export const FIXTURE_CATALOGUE: CatalogueEntry[] = [
  { id: 'fx-instr', service: 'EMS', group: 'Fixture', label: 'Fixture instructed complaint', workflowId: INSTRUCTED.id, status: 'pending-validation' },
  { id: 'fx-typed', service: 'EMS', group: 'Fixture', label: 'Fixture typed complaint', workflowId: TYPED.id, status: 'pending-validation' },
  { id: 'fx-rich', service: 'EMS', group: 'Fixture', label: 'Fixture rich complaint', workflowId: RICH.id, status: 'pending-validation' },
  { id: 'fx-ems', service: 'EMS', group: 'Fixture', label: 'Fixture medical complaint', workflowId: CONDITIONAL.id, status: 'pending-validation' },
  { id: 'fx-pd', service: 'PD', group: 'Fixture', label: 'Fixture police complaint', workflowId: BRANCHING.id, status: 'pending-validation' },
]
