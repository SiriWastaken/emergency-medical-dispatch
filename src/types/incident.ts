import { z } from 'zod'

/** The discriminator for every call. Each type has its own intake, labels and narrative (domain/incident-types). */
export const INCIDENT_TYPES = ['EMS', 'PD', 'FD'] as const
export type IncidentType = (typeof INCIDENT_TYPES)[number]
/** Workflows and the nature-of-call catalogue are scoped by the same set. */
export const SERVICES = INCIDENT_TYPES
export type Service = IncidentType

/** `unanswered` = never touched; the other three non-answer states are deliberate user choices. */
export const FIELD_STATES = ['unanswered', 'answered', 'unknown', 'not_asked', 'not_applicable'] as const
export type FieldState = (typeof FIELD_STATES)[number]

export const FIELD_KEYS = [
  'callerName',
  'callerPhone',
  'callerRelationship',
  'location',
  'complaint',
  'description',
  'personsInvolved',
  'patientName',
  'patientCount',
  'patientAge',
  'sex',
  'consciousStatus',
  'breathingStatus',
  'notes',
  /** Ids of caller instructions the call-taker has read out, comma separated. */
  'instructionsGiven',
] as const
export type FieldKey = (typeof FIELD_KEYS)[number]

const COMMON_FIELDS: FieldKey[] = ['callerName', 'callerPhone', 'location', 'complaint', 'description', 'notes', 'instructionsGiven']

/** Which incident fields exist for each type (a data-model fact: police calls have no patient fields). */
export const FIELDS_BY_TYPE: Record<IncidentType, readonly FieldKey[]> = {
  EMS: [...COMMON_FIELDS, 'callerRelationship', 'patientName', 'patientCount', 'patientAge', 'sex', 'consciousStatus', 'breathingStatus'],
  PD: [...COMMON_FIELDS, 'personsInvolved'],
  FD: [...COMMON_FIELDS, 'personsInvolved'],
}

export const fieldValueSchema = z.object({
  state: z.enum(FIELD_STATES),
  value: z.string(),
  /** true once the call-taker independently verified the value; otherwise it is caller-reported. */
  verified: z.boolean().optional(),
})
export type FieldValue = z.infer<typeof fieldValueSchema>

export const INCIDENT_STATUSES = ['draft', 'active', 'closed'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]
export const STATUS_LABEL: Record<IncidentStatus, string> = { draft: 'Draft', active: 'Active', closed: 'Closed' }

export interface Incident {
  id: string
  type: IncidentType
  status: IncidentStatus
  createdAt: string
  updatedAt: string
  /** Optimistic-lock counter; a save only succeeds against the revision it was loaded at. */
  revision: number
  fields: Record<FieldKey, FieldValue>
}

export interface IncidentSummary {
  id: string
  type: IncidentType
  status: IncidentStatus
  updatedAt: string
  /** Patient for EMS, caller for PD/FD. */
  name: string
  complaint: string
}

export const emptyField = (): FieldValue => ({ state: 'unanswered', value: '' })
