import { z } from 'zod'
import { FIELD_KEYS, SERVICES } from './incident'

const id = z.string().trim().min(1)

/** verified-source needs attested provenance; pending-validation never upgrades automatically. */
export const WORKFLOW_STATUSES = ['verified-source', 'pending-validation', 'disabled'] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export const provenanceSchema = z.object({
  /** roleplay = realistic training content written for this app; not a real dispatch protocol. built-in = marked placeholders. */
  origin: z.enum(['authorized-source', 'user-import', 'built-in', 'roleplay']),
  /** Human name of the authorized source (verified-source only). */
  source: z.string().optional(),
  sourceFile: z.string().optional(),
  worksheet: z.string().optional(),
  /** Spreadsheet rows the content came from, e.g. "2-48". */
  rows: z.string().optional(),
  importedAt: z.string().optional(),
  verifiedBy: z.string().optional(),
  verifiedAt: z.string().optional(),
  note: z.string().optional(),
})
export type Provenance = z.infer<typeof provenanceSchema>

/** True when the answer given to an earlier question on the active path is one of `anyOf`. */
export const conditionSchema = z.object({ node: id, anyOf: z.array(id).min(1) })
export type Condition = z.infer<typeof conditionSchema>

export const optionSchema = z.object({
  id,
  label: id,
  next: id,
  /** First matching rule wins; each tests an earlier answer on the active path. Falls back to `next`. */
  nextIf: z.array(z.object({ node: id, option: id, next: id })).optional(),
})

export const questionNodeSchema = z.object({
  kind: z.literal('question'),
  id,
  prompt: id,
  help: z.string().optional(),
  /** Multiple-choice answers. Empty only for an input question (see `input`). */
  options: z.array(optionSchema),
  /** A question answered by typing (free text or a whole number) instead of choosing; needs `field` and `next`. */
  input: z.object({ format: z.enum(['text', 'integer']) }).optional(),
  /** Where an answered input question leads (choice questions route per option). */
  next: id.optional(),
  /** Default true. A mandatory question cannot be skipped; only responses with a defined route are offered. */
  mandatory: z.boolean().optional(),
  /** When present the question is mandatory only while this condition holds; otherwise it may be skipped (notAskedNext). */
  mandatoryIf: conditionSchema.optional(),
  /** When present the question only applies while the condition holds; otherwise the flow goes to `otherwise`. */
  appliesIf: conditionSchema.extend({ otherwise: id }).optional(),
  /** An answer option is invalid while its `when` condition holds; `message` explains why. */
  rules: z.array(z.object({ when: conditionSchema, forbid: z.array(id).min(1), message: id })).optional(),
  /** Routes for non-answers. A response is offered to the call-taker only if its route is defined. */
  unknownNext: id.optional(),
  unavailableNext: id.optional(),
  notAskedNext: id.optional(),
  /** The incident field this question fills in (the chosen option's label), so the call narrative stays in sync. */
  field: z.enum(FIELD_KEYS).optional(),
  /** Validation rules for a typed answer (from the Validation sheet). */
  checks: z.array(z.object({ condition: id, message: id })).optional(),
  /** Stage name shown with the question (for example "Key Questions"). */
  stage: z.string().optional(),
  /** Traceability back to the source spreadsheet, e.g. "VALIDATION!12". */
  sourceRef: z.string().optional(),
})
export const terminalNodeSchema = z.object({
  kind: z.literal('terminal'),
  id,
  outcome: id,
  help: z.string().optional(),
  /** A caller instruction (see the Instructions sheet) to read out when this endpoint is reached. */
  instruction: id.optional(),
  sourceRef: z.string().optional(),
})
export const nodeSchema = z.discriminatedUnion('kind', [questionNodeSchema, terminalNodeSchema])

export const workflowSchema = z.object({
  id,
  name: id,
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  service: z.enum(SERVICES).optional(),
  category: z.string().optional(),
  status: z.enum(WORKFLOW_STATUSES).optional(),
  provenance: provenanceSchema.optional(),
  /** Set when the workflow has no authoritative content yet: why, and what is needed. It can never validate as complete. */
  incomplete: z.string().optional(),
  /** Non-clinical notes shown with the workflow. */
  notes: z.string().optional(),
  /** Incident fields that must have been addressed (answered, or explicitly unknown / not asked / n/a) for completion. */
  requiredFields: z.array(z.enum(FIELD_KEYS)).optional(),
  start: id,
  nodes: z.array(nodeSchema).min(1),
})

export type QuestionNode = z.infer<typeof questionNodeSchema>
export type TerminalNode = z.infer<typeof terminalNodeSchema>
export type WorkflowNode = z.infer<typeof nodeSchema>
export type WorkflowDefinition = z.infer<typeof workflowSchema>

export type Answer =
  | { kind: 'option'; optionId: string; at: string }
  | { kind: 'unknown'; at: string }
  | { kind: 'unavailable'; at: string }
  | { kind: 'not_asked'; at: string }
  /** The typed answer to an input question. */
  | { kind: 'text'; value: string; at: string }
export type Answers = Record<string, Answer>

/** Missing status is treated as awaiting validation, never as verified. */
export const statusOf = (w: Pick<WorkflowDefinition, 'status'>): WorkflowStatus => w.status ?? 'pending-validation'
