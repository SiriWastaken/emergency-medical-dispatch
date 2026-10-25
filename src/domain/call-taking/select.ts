import type { IncidentType } from '@/types/incident'
import type { CallTaking } from './schema'

/** The workbook workflow for a chief complaint: the one named for it, else the type's "*" tree. */
export function workbookWorkflowId(ct: Pick<CallTaking, 'workflowMap'>, type: IncidentType, complaint: string): string | undefined {
  const mine = ct.workflowMap.filter((w) => w.incidentType === type)
  return (mine.find((w) => w.complaint === complaint) ?? mine.find((w) => w.complaint === '*'))?.workflowId
}
