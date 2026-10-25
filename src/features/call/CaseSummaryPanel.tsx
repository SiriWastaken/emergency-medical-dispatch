import { X } from 'lucide-react'
import { fmtTime } from '@/app/format'
import { TypeBadge } from '@/components/TypeBadge'
import { configOf, labelFor, OPTIONAL_DETAILS } from '@/domain/incident-types'
import { displayValue } from '@/domain/narrative'
import { useCurrentNarrative } from '@/features/call-narrative/current'
import { validateProgress } from '@/domain/workflow-engine/engine'
import { STATE_TEXT } from '@/features/workflows/PathReview'
import { selectWorkflowView } from '@/features/workflows/view'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import { STATUS_LABEL } from '@/types/incident'
import { instructionTitles } from './InstructionCard'

/** The case so far, kept beside the active prompt so the call-taker never has to leave it. */
export function CaseSummaryPanel({ onClose }: { onClose(): void }) {
  const incident = useCase((s) => s.incident)
  const session = useCase((s) => s.session)
  const workflows = useApp((s) => s.workflows)
  const setField = useCase((s) => s.setField)
  const narrative = useCurrentNarrative()
  if (!incident) return null
  const cfg = configOf(incident)
  const view = selectWorkflowView(session, null, workflows)
  const report = view && session ? validateProgress(view.def, session.answers, incident.fields) : null
  const optional = OPTIONAL_DETAILS[incident.type]
  const shown = cfg.summaryFields.filter((k) => k !== 'notes' && k !== 'instructionsGiven' && !optional.includes(k))
  const missing = shown.filter((k) => incident.fields[k].state !== 'answered')
  const given = incident.fields.instructionsGiven
  const notes = incident.fields.notes

  return (
    <aside aria-label="Case summary" className="min-h-0 w-80 shrink-0 overflow-auto border-l border-line bg-surface">
      <div className="panel-title flex items-center justify-between">
        <span>Case summary</span>
        <button className="text-muted hover:text-ink" aria-label="Close case summary" onClick={onClose}><X size={14} /></button>
      </div>
      <dl className="selectable grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 p-3">
        <dt className="text-muted">Type</dt><dd><TypeBadge type={incident.type} /> {cfg.name}</dd>
        <dt className="text-muted">Incident</dt><dd className="font-mono">{incident.id}</dd>
        <dt className="text-muted">Status</dt><dd>{STATUS_LABEL[incident.status]}</dd>
        <dt className="text-muted">Updated</dt><dd>{fmtTime(incident.updatedAt)}</dd>
        {shown.map((k) => {
          const f = incident.fields[k]
          return (
            <div key={k} className="contents">
              <dt className="text-muted">{labelFor(incident.type, k)}</dt>
              <dd className={f.state === 'answered' ? 'whitespace-pre-wrap' : 'text-warn'}>
                {displayValue(f)}
                {f.state === 'answered' && <span className={`ml-2 text-[11px] ${f.verified ? 'text-ok' : 'text-muted'}`}>{f.verified ? 'Verified' : 'Caller-reported'}</span>}
              </dd>
            </div>
          )
        })}
        <dt className="text-muted">Instructions given</dt>
        <dd>{given.state === 'answered' ? instructionTitles(given.value, incident.type).join(', ') : <span className="text-muted">None recorded</span>}</dd>
      </dl>
      {report && <p className="px-3 pb-2">Questions: <strong>{STATE_TEXT[report.state]}</strong></p>}
      <div className="panel-title border-t">Missing or unavailable</div>
      {missing.length === 0 ? <p className="p-3 text-ok">Every field has a recorded value.</p> : (
        <ul className="p-3">{missing.map((k) => <li key={k}>{labelFor(incident.type, k)}: <span className="text-warn">{displayValue(incident.fields[k])}</span></li>)}</ul>
      )}
      <div className="panel-title border-t">Live call narrative</div>
      <pre className="selectable whitespace-pre-wrap p-3 font-mono text-[11px] leading-5">{narrative}</pre>
      <div className="panel-title border-t">Optional details (never asked automatically)</div>
      <div className="space-y-2 p-3">
        {optional.map((k) => (
          <label key={k} className="block">
            <span className="label">{labelFor(incident.type, k)}</span>
            <input className="input" value={incident.fields[k].value} onChange={(e) => setField(k, { state: e.target.value ? 'answered' : 'unanswered', value: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="panel-title border-t">Additional notes (not in the narrative)</div>
      <div className="p-3">
        <textarea aria-label="Additional notes" className="input min-h-16" value={notes.value} onChange={(e) => setField('notes', { state: e.target.value ? 'answered' : 'unanswered', value: e.target.value })} />
      </div>
    </aside>
  )
}
