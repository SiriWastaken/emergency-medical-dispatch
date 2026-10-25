import { z } from 'zod'
import { FIELD_KEYS, INCIDENT_TYPES } from '@/types/incident'
import { workflowSchema } from '@/types/workflow'

export const INPUT_TYPES = ['select-incident-type', 'text', 'text-long', 'phone', 'select-complaint'] as const
export type EntryInput = (typeof INPUT_TYPES)[number]

export const entryPromptSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  input: z.enum(INPUT_TYPES),
  required: z.boolean(),
  /** Rule ids that apply to this prompt (from the Validation sheet). */
  validation: z.array(z.string()),
  /** The next prompt, or WORKFLOW to start the complaint-specific question tree. */
  next: z.string().min(1),
  /** The incident field the answer is stored in (none for the incident type itself). */
  field: z.enum(FIELD_KEYS).optional(),
})
export type EntryPrompt = z.infer<typeof entryPromptSchema>

export const narrativeLineSchema = z.object({
  /** One incident field, or two joined with "+" (shown as "first - second"). */
  fields: z.array(z.enum(FIELD_KEYS)).min(1),
  label: z.string().min(1),
  /** The prompt or question ids that fill it, or null while no question supplies it yet. */
  sources: z.array(z.string()).nullable(),
  unassigned: z.string().optional(),
  order: z.number().int().positive(),
  suffix: z.string().optional(),
})
export type NarrativeLine = z.infer<typeof narrativeLineSchema>

export const instructionSchema = z.object({
  id: z.string().min(1),
  incidentType: z.enum(INCIDENT_TYPES),
  title: z.string().min(1),
  /** The words to read to the caller. Empty until authorized content is supplied. */
  script: z.string(),
  status: z.enum(['AUTHORIZED', 'ROLEPLAY', 'CONTENT REQUIRED']),
  source: z.string().optional(),
})
export type Instruction = z.infer<typeof instructionSchema>

export const callTakingSchema = z.object({
  schemaVersion: z.literal(1),
  /** Workbook this was built from. */
  workbook: z.string(),
  /** Case-entry prompts per incident type, in the order they are asked. */
  caseEntry: z.record(z.enum(INCIDENT_TYPES), z.array(entryPromptSchema).min(1)),
  rules: z.array(z.object({ id: z.string(), step: z.string(), condition: z.string(), message: z.string() })),
  narratives: z.record(z.enum(INCIDENT_TYPES), z.array(narrativeLineSchema).min(1)),
  /** Which workflow handles which chief complaint ("*" = any chief complaint of the type). */
  workflowMap: z.array(z.object({ workflowId: z.string(), incidentType: z.enum(INCIDENT_TYPES), complaint: z.string() })),
  workflows: z.array(workflowSchema),
  instructions: z.array(instructionSchema),
})
export type CallTaking = z.infer<typeof callTakingSchema>
