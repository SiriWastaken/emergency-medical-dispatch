import { FileText, HandHelping, PanelRightOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyIncident } from '@/components/EmptyIncident'
import { StatusBanner } from '@/components/StatusBanner'
import { configOf } from '@/domain/incident-types'
import { validateProgress } from '@/domain/workflow-engine/engine'
import { STATE_TEXT } from '@/features/workflows/PathReview'
import { selectWorkflowView } from '@/features/workflows/view'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import { CallHistory } from './CallHistory'
import { CaseSummaryPanel } from './CaseSummaryPanel'
import { EntryActions, EntryPrompt } from './EntryPrompt'
import { QuestionActions, QuestionCenter } from './QuestionStage'
import { InstructionsPanel } from './InstructionsPanel'
import { SelectTypePrompt } from './SelectTypePrompt'

const TONE = { complete: 'text-ok', incomplete: 'text-warn', blocked: 'text-danger' } as const

/**
 * One continuous workspace for the whole call: case entry, then key questions, with the history
 * and case summary beside the active prompt. Only the current prompt is ever shown.
 */
export function CallWorkspace() {
  const incident = useCase((s) => s.incident)
  const session = useCase((s) => s.session)
  const step = useCase((s) => s.step)
  const viewNodeId = useCase((s) => s.viewNodeId)
  const notice = useCase((s) => s.notice)
  const workflows = useApp((s) => s.workflows)
  const go = useApp((s) => s.go)
  const pendingCall = useApp((s) => s.pendingCall)
  const [reviewing, setReviewing] = useState(false)
  const [panel, setPanel] = useState<'summary' | 'instructions' | null>(null)
  const view = selectWorkflowView(session, viewNodeId, workflows)
  const report = useMemo(() => (view && session && incident ? validateProgress(view.def, session.answers, incident.fields) : null), [view, session, incident])
  if (!incident) return pendingCall ? <SelectTypePrompt /> : <EmptyIncident />

  const total = configOf(incident).steps.length
  const inEntry = step < total
  const done = report?.state === 'complete' && view?.progress.steps[view.index]?.type === 'terminal'
  const stages = [
    { name: 'Case entry', active: inEntry },
    { name: 'Key questions', active: !inEntry && !done },
    { name: 'Complete', active: !inEntry && !!done },
  ]
  const answered = view ? view.progress.steps.filter((s) => s.type === 'question' && session?.answers[s.node.id]).length : 0
  const last = view?.progress.steps[view.index]
  const pct = inEntry ? Math.round((step / total) * 100) : Math.round((answered / Math.max((view?.progress.steps.length ?? 1) - (last?.type === 'terminal' ? 1 : 0), 1)) * 100)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-3 py-1.5">
        <ol aria-label="Call stages" className="flex items-center gap-1">
          {stages.map((s, i) => (
            <li key={s.name} aria-current={s.active ? 'step' : undefined} className={`rounded-sm border px-2 py-0.5 text-[12px] ${s.active ? 'border-accent text-accent' : 'border-line text-muted'}`}>
              {i + 1}. {s.name}
            </li>
          ))}
        </ol>
        <span className="text-[12px] text-muted">
          {inEntry ? `Question ${step + 1} of ${total}. Next: ${step + 1 < total ? configOf(incident).steps[step + 1]!.prompt : 'key questions'}` : view ? `${view.def.name} · ${answered} answered` : 'No question set'}
        </span>
        <div role="progressbar" aria-label={inEntry ? 'Case entry progress' : 'Questions answered'} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-32 overflow-hidden rounded-sm bg-surface-2">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        {!inEntry && report && <span className={`text-[12px] font-semibold ${TONE[report.state]}`}>{STATE_TEXT[report.state]}</span>}
        <span className="grow" />
        <button className="btn !py-0.5" aria-expanded={panel === 'instructions'} onClick={() => setPanel((p) => (p === 'instructions' ? null : 'instructions'))}><HandHelping size={14} /> Caller instructions</button>
        <button className="btn !py-0.5" aria-expanded={panel === 'summary'} onClick={() => setPanel((p) => (p === 'summary' ? null : 'summary'))}><PanelRightOpen size={14} /> Case summary</button>
        <button className="btn !py-0.5" onClick={() => go('narrative')}><FileText size={14} /> Call narrative</button>
      </div>
      {!inEntry && view && <StatusBanner workflow={view.def} />}
      {notice && !inEntry && <div role="status" className="border-b border-line bg-surface-2 px-3 py-1.5 text-warn">{notice}</div>}
      <div className="flex min-h-0 grow">
        <CallHistory />
        <div className="min-h-0 min-w-0 grow overflow-auto p-5">
          {inEntry ? <EntryPrompt /> : <QuestionCenter view={view} report={report} reviewing={reviewing} setReviewing={setReviewing} />}
        </div>
        {panel === 'summary' && <CaseSummaryPanel onClose={() => setPanel(null)} />}
        {panel === 'instructions' && <InstructionsPanel onClose={() => setPanel(null)} />}
      </div>
      <div className="flex items-center gap-2 border-t border-line p-2">
        {inEntry ? <EntryActions /> : <QuestionActions view={view} report={report} reviewing={reviewing} setReviewing={setReviewing} />}
      </div>
    </div>
  )
}
