import { buildNarrative } from '@/domain/narrative'
import { selectWorkflowView } from '@/features/workflows/view'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import type { Incident } from '@/types/incident'
import type { StoredWorkflow } from '@/persistence/settings'

/** Scripts the call's questions have told the call-taker to give (the instruction at the endpoint reached). */
export function recommendedInstructions(session: ReturnType<typeof useCase.getState>['session'], workflows: StoredWorkflow[]): string[] {
  const last = selectWorkflowView(session, null, workflows)?.progress.steps.at(-1)
  return last?.type === 'terminal' && last.node.instruction ? [last.node.instruction] : []
}

/** The narrative for an incident as it stands now, including any pre-arrival instructions section. */
export const narrativeOf = (incident: Incident, session: ReturnType<typeof useCase.getState>['session'], workflows: StoredWorkflow[]) =>
  buildNarrative(incident, recommendedInstructions(session, workflows))

export function useCurrentNarrative(): string | null {
  const incident = useCase((s) => s.incident)
  const session = useCase((s) => s.session)
  const workflows = useApp((s) => s.workflows)
  return incident ? narrativeOf(incident, session, workflows) : null
}

/** Same, read once from the stores (for copy and export). */
export function currentNarrative(): string | null {
  const { incident, session } = useCase.getState()
  return incident ? narrativeOf(incident, session, useApp.getState().workflows) : null
}
