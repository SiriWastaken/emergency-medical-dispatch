import { z } from 'zod'
import { SERVICES } from './incident'
import { WORKFLOW_STATUSES } from './workflow'

export const catalogueEntrySchema = z.object({
  id: z.string().min(1),
  service: z.enum(SERVICES),
  group: z.string().trim().min(1),
  label: z.string().trim().min(1),
  /** Question workflow started when this nature of call is chosen. */
  workflowId: z.string().min(1).optional(),
  status: z.enum(WORKFLOW_STATUSES),
})
export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>

export const catalogueFileSchema = z.object({ schemaVersion: z.literal(1), note: z.string().optional(), entries: z.array(catalogueEntrySchema) })
