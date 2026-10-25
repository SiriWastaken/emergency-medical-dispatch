import { CALL_TAKING } from '@/data/call-taking'
import type { EntryPrompt } from '@/domain/call-taking/schema'
import type { FieldKey, Incident, IncidentType } from '@/types/incident'

/** One case-entry prompt as the call workspace shows it. */
export interface IntakeStep {
  /** Prompt ID from the workbook's Case Entry sheet. */
  id: string
  key: FieldKey
  prompt: string
  kind: 'text' | 'long' | 'nature'
  required: boolean
  /** Rule IDs from the Validation sheet. */
  validation: string[]
}

export interface TypeConfig {
  type: IncidentType
  name: string
  /** Case-entry prompts after the incident type has been chosen, in order. */
  steps: IntakeStep[]
  /** Fields shown in the case summary, in order. */
  summaryFields: FieldKey[]
}

/** Details that are never asked automatically; the call-taker may record them in the case summary. */
export const OPTIONAL_DETAILS: Record<IncidentType, FieldKey[]> = { EMS: ['callerName', 'patientName'], PD: ['callerName'], FD: ['callerName'] }

export const DEFAULT_LABELS: Record<FieldKey, string> = {
  callerName: 'Caller name',
  callerPhone: 'Caller phone number',
  callerRelationship: "Caller's relationship to patient",
  location: 'Incident location',
  complaint: 'Chief complaint',
  description: "What is happening (caller's description)",
  personsInvolved: 'Persons involved',
  patientName: 'Patient name',
  patientCount: 'Number of hurt/sick',
  patientAge: 'Patient age (years)',
  sex: 'Patient sex',
  consciousStatus: 'Patient conscious status',
  breathingStatus: 'Patient breathing status',
  notes: 'Additional notes (optional; not part of the narrative lines)',
  instructionsGiven: 'Caller instructions given',
}

const KIND = { text: 'text', phone: 'text', 'text-long': 'long', 'select-complaint': 'nature' } as const

const stepOf = (p: EntryPrompt): IntakeStep => {
  if (p.input === 'select-incident-type' || !p.field) throw new Error(`Prompt "${p.id}" is not a case-entry question`)
  return { id: p.id, key: p.field, prompt: p.prompt, kind: KIND[p.input], required: p.required, validation: p.validation }
}

const NAMES: Record<IncidentType, string> = { EMS: 'EMS (medical)', PD: 'PD (police)', FD: 'FD (fire)' }

/** Built from the workbook; nothing about a type's questions is written in code. */
const build = (type: IncidentType): TypeConfig => {
  const steps = CALL_TAKING.caseEntry[type]!.filter((p) => p.input !== 'select-incident-type').map(stepOf)
  const narrativeFields = CALL_TAKING.narratives[type]!.flatMap((l) => l.fields)
  const summaryFields = [...new Set<FieldKey>([...steps.map((s) => s.key), ...narrativeFields, ...OPTIONAL_DETAILS[type], 'instructionsGiven', 'notes'])]
  return { type, name: NAMES[type], steps, summaryFields }
}

export const TYPE_CONFIG: Record<IncidentType, TypeConfig> = { EMS: build('EMS'), PD: build('PD'), FD: build('FD') }

export const configOf = (inc: Pick<Incident, 'type'>): TypeConfig => TYPE_CONFIG[inc.type]
export const labelFor = (_type: IncidentType, key: FieldKey): string => DEFAULT_LABELS[key]

/** The prompt that selects the incident type (asked before an incident exists). */
export const incidentTypePrompt = () => CALL_TAKING.caseEntry.EMS![0]!.prompt

/**
 * Where a reopened call resumes: the first required case-entry question never addressed, or
 * `steps.length` (the question stage) when case entry is complete.
 */
export function firstOpenStep(inc: Pick<Incident, 'type' | 'fields'>): number {
  const steps = configOf(inc).steps
  const i = steps.findIndex((st) => st.required && inc.fields[st.key].state === 'unanswered')
  return i < 0 ? steps.length : i
}
