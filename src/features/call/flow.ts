import { configOf, type IntakeStep } from '@/domain/incident-types'
import { findEntry, workflowFor } from '@/domain/library/select'
import { create } from 'zustand'
import { entryProblem } from '@/domain/call-taking/entry'
import { workbookWorkflowId } from '@/domain/call-taking/select'
import { CALL_TAKING } from '@/data/call-taking'
import type { CatalogueEntry } from '@/types/catalogue'
import type { FieldState } from '@/types/incident'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'

export type Stage = 'entry' | 'questions'

/** Whether the call-taker has tried to move past the current prompt (so "required" can be reported). */
export const useEntryUi = create<{ attempted: boolean }>(() => ({ attempted: false }))

/** What stops the current case-entry answer from being accepted, as the workbook's rules define it. */
export function entryError(showRequired: boolean): string | null {
  const cur = currentEntry()
  const inc = useCase.getState().incident
  if (!cur || !inc) return null
  const labels = new Set(useApp.getState().catalogue.filter((e) => e.service === inc.type && e.status !== 'disabled').map((e) => e.label))
  return entryProblem(CALL_TAKING.rules, cur.step, inc.fields[cur.step.key], { catalogue: labels }, showRequired)
}

/** Moves on if the current answer is acceptable; otherwise shows why it is not. */
export function tryAdvance() {
  if (entryError(true)) useEntryUi.setState({ attempted: true })
  else goStep(1)
}

/** The case-entry question on screen, or null once the call is in its question workflow. */
export function currentEntry(): { step: IntakeStep; index: number; total: number } | null {
  const { incident, step } = useCase.getState()
  if (!incident) return null
  const steps = configOf(incident).steps
  const s = steps[step]
  return s ? { step: s, index: step, total: steps.length } : null
}

export const stageOf = (): Stage => (currentEntry() ? 'entry' : 'questions')

/**
 * Makes sure the call has a question workflow: one imported for its chief complaint, else the
 * workbook's tree for that complaint, else the workbook's tree for the whole incident type.
 * Those trees may be marked placeholders when no authorized content exists.
 */
export function ensureSession() {
  const c = useCase.getState()
  const inc = c.incident
  if (!inc || c.session) return
  const app = useApp.getState()
  const defs = app.workflows.map((w) => w.definition)
  const complaint = inc.fields.complaint.value
  const mapped = workflowFor(findEntry(app.catalogue, inc.type, complaint), defs)
  const fromWorkbook = defs.find((d) => d.id === workbookWorkflowId(CALL_TAKING, inc.type, complaint) && d.status !== 'disabled')
  const wf = mapped ?? fromWorkbook
  if (wf) c.startWorkflow(wf.id)
}

/** Moves forward one case-entry question, or into the question workflow after the last (or back to where a correction began). */
export function goStep(delta: number) {
  useEntryUi.setState({ attempted: false })
  const cur = currentEntry()
  const c = useCase.getState()
  if (!cur) return
  const next = cur.index + delta
  if (next < 0) return
  if (delta > 0 && c.returnTo) {
    // A corrected value: go straight back to where the call-taker was, not through every later question.
    c.popReturn()
    if (!currentEntry()) ensureSession()
    return
  }
  if (next >= cur.total) {
    c.setStatus('active') // no-op unless the call is still a draft
    c.setStep(cur.total)
    ensureSession()
  } else c.setStep(next)
}

/** Records a non-answer state (keeping any typed text) and moves on. */
export function markStep(state: Exclude<FieldState, 'answered' | 'unanswered'>) {
  const cur = currentEntry()
  const c = useCase.getState()
  if (!cur || !c.incident) return
  c.setField(cur.step.key, { state, value: c.incident.fields[cur.step.key].value })
  goStep(1)
}

/** Marks the current answer as independently verified, or back to caller-reported. */
export function setVerified(verified: boolean) {
  const cur = currentEntry()
  const c = useCase.getState()
  if (!cur || !c.incident) return
  const f = c.incident.fields[cur.step.key]
  c.setField(cur.step.key, { ...f, verified })
}

/**
 * Records the chief complaint. Changing it discards the previous workflow's answers (and the
 * incident fields they filled in), because they were collected for a different kind of call.
 */
export function pickNature(entry: CatalogueEntry) {
  const c = useCase.getState()
  const app = useApp.getState()
  if (!c.incident) return
  const unchanged = c.incident.fields.complaint.state === 'answered' && c.incident.fields.complaint.value === entry.label
  if (!unchanged && c.session) c.resetWorkflow(app.workflows.find((w) => w.definition.id === c.session?.workflowId)?.definition)
  useCase.getState().setField('complaint', { state: 'answered', value: entry.label })
  goStep(1)
}

/** Jumps back to a case-entry question to correct it (case-entry values only; the workflow keeps its answers). */
export function editEntry(index: number) {
  useCase.getState().jumpTo(index)
}
