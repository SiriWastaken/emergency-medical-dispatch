import { ArrowLeft, ArrowRight, ClipboardCheck } from 'lucide-react'
import { useState } from 'react'
import { configOf } from '@/domain/incident-types'
import { ensureSession } from './flow'
import { InstructionCard } from './InstructionCard'
import { statusOf } from '@/types/workflow'
import { findEntry, workflowFor } from '@/domain/library/select'
import type { Report } from '@/domain/workflow-engine/engine'
import { PathReview } from '@/features/workflows/PathReview'
import { QuestionPanel } from '@/features/workflows/QuestionPanel'
import { definitionProblem, stepView, type WorkflowView } from '@/features/workflows/view'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'

const TONE = { complete: 'text-ok', incomplete: 'text-warn', blocked: 'text-danger' } as const

export interface QuestionState {
  view: WorkflowView | null
  report: Report | null
  reviewing: boolean
  setReviewing(v: boolean | ((r: boolean) => boolean)): void
}

/** The centre of the question stage: the active question, the endpoint, a review, or why there is nothing to ask. */
export function QuestionCenter({ view, report, reviewing, setReviewing }: QuestionState) {
  const incident = useCase((s) => s.incident)
  const session = useCase((s) => s.session)
  const workflows = useApp((s) => s.workflows)
  const catalogue = useApp((s) => s.catalogue)
  const go = useApp((s) => s.go)
  const [pick, setPick] = useState('')
  if (!incident) return null

  if (!session) {
    const available = workflows.map((w) => w.definition).filter((w) => w.service === incident.type && statusOf(w) !== 'disabled')
    const mapped = workflowFor(findEntry(catalogue, incident.type, incident.fields.complaint.value), available)
    const chosen = pick || mapped?.id || available[0]?.id || ''
    return (
      <div className="max-w-xl">
        <p className="label">Key questions</p>
        <h2 className="mb-2 text-[20px] font-semibold">No question set was started for this call</h2>
        <p className="mb-3 text-muted">{available.length ? 'Choose the question set to ask this caller:' : `There are no ${incident.type} question sets. Import an authorized workflow in Settings.`}</p>
        {available.length > 0 && (
          <>
            <label htmlFor="wf-pick" className="label">Workflow</label>
            <select id="wf-pick" className="input mb-2" value={chosen} onChange={(e) => setPick(e.target.value)}>
              {available.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button className="btn btn-primary mr-2" disabled={!chosen} onClick={() => useCase.getState().startWorkflow(chosen)}>Start questions</button>
          </>
        )}
        <button className="btn" onClick={() => go('narrative')}>Go to call narrative</button>
      </div>
    )
  }
  if (!view || !report) return <div className="text-danger" role="alert">{definitionProblem(session, workflows) ?? 'The workflow cannot be shown.'}</div>
  const { def, progress, index } = view
  const step = progress.steps[index]!
  const jump = (nodeId: string) => {
    useCase.getState().setView(nodeId)
    setReviewing(false)
  }

  if (reviewing) {
    return (
      <>
        <h2 className="mb-2 text-[16px] font-semibold">Review of questions and answers</h2>
        <PathReview def={def} answers={session.answers} report={report} onJump={jump} />
      </>
    )
  }
  if (step.type === 'terminal') {
    return (
      <div className="max-w-2xl">
        <p className="label">Endpoint reached</p>
        <p className="selectable mb-2 text-[18px]">{step.node.outcome}</p>
        {step.node.help && <p className="mb-3 text-muted">{step.node.help}</p>}
        {step.node.instruction && <div className="mb-3"><InstructionCard id={step.node.instruction} /></div>}
        <p className={`mb-2 font-semibold ${TONE[report.state]}`}>
          {report.state === 'complete' ? 'Validation passed: this workflow is complete.' : report.issues.some((i) => i.code === 'content-required') ? 'Not complete: this question set has no authorized content yet.' : report.state === 'incomplete' ? 'Not complete: required information is still missing.' : 'This workflow cannot proceed as configured.'}
        </p>
        {report.issues.length > 0 && (
          <ul className="mb-3 list-disc pl-5">{report.issues.map((i, k) => <li key={k} className={i.code === 'missing-field' ? 'text-warn' : 'text-danger'}>{i.message}</li>)}</ul>
        )}
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => go('narrative')}>Call narrative</button>
          <button className="btn" onClick={() => setReviewing(true)}>Review answers</button>
        </div>
      </div>
    )
  }
  return <QuestionPanel def={def} node={step.node} answers={session.answers} progress={progress} />
}

/** Footer controls for the question stage. */
export function QuestionActions({ view, reviewing, setReviewing }: QuestionState) {
  const incident = useCase((s) => s.incident)
  const session = useCase((s) => s.session)
  const [confirmReset, setConfirmReset] = useState(false)
  if (!incident) return null
  const atStart = !view || view.index === 0
  return (
    <>
      <button
        className="btn"
        onClick={() => {
          setReviewing(false)
          // Before the first question, Back returns to the last case-entry question.
          if (atStart) useCase.getState().setStep(configOf(incident).steps.length - 1)
          else stepView(-1)
        }}
      >
        <ArrowLeft size={14} /> Back
      </button>
      {view && (
        <>
          <button className="btn btn-primary" disabled={reviewing ? false : view.index >= view.progress.steps.length - 1} onClick={() => (reviewing ? setReviewing(false) : stepView(1))}>
            {reviewing ? 'Return to questions' : 'Continue'} <ArrowRight size={14} />
          </button>
          <button className="btn" onClick={() => setReviewing((r) => !r)}><ClipboardCheck size={14} /> {reviewing ? 'Hide review' : 'Review answers'}</button>
        </>
      )}
      <span className="grow" />
      {session &&
        (confirmReset ? (
          <>
            <span className="text-warn">Clear all question answers and start over?</span>
            <button
              className="btn btn-danger"
              onClick={() => {
                useCase.getState().resetWorkflow(view?.def)
                ensureSession()
                setConfirmReset(false)
              }}
            >
              Clear answers
            </button>
            <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirmReset(true)}>Restart questions</button>
        ))}
    </>
  )
}
