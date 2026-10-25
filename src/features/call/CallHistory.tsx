import { configOf, labelFor } from '@/domain/incident-types'
import { displayValue } from '@/domain/narrative'
import { answerLabel } from '@/domain/workflow-engine/engine'
import { selectWorkflowView } from '@/features/workflows/view'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import { editEntry } from './flow'

const item = (active: boolean) => `w-full rounded-sm px-2 py-1 text-left hover:bg-surface-2 ${active ? 'bg-surface-2' : ''}`

/** Everything asked so far in one list: case entry answers, then the question path. Click to go back and change one. */
export function CallHistory() {
  const incident = useCase((s) => s.incident)
  const session = useCase((s) => s.session)
  const step = useCase((s) => s.step)
  const viewNodeId = useCase((s) => s.viewNodeId)
  const workflows = useApp((s) => s.workflows)
  if (!incident) return null
  const entries = configOf(incident).steps
  const view = selectWorkflowView(session, viewNodeId, workflows)
  const inQuestions = step >= entries.length

  return (
    <nav aria-label="Call history" className="min-h-0 w-64 shrink-0 overflow-auto border-r border-line bg-surface">
      <div className="panel-title">Case entry</div>
      <ol className="p-1.5">
        <li className="px-2 py-1">
          <span className="block text-[11px] text-muted">Incident type</span>
          <span className="block">{incident.type}</span>
        </li>
        {entries.map((e, i) => {
          if (i > step && incident.fields[e.key].state === 'unanswered') return null
          return (
            <li key={e.key}>
              <button className={item(i === step)} aria-current={i === step ? 'step' : undefined} onClick={() => editEntry(i)}>
                <span className="block truncate text-[11px] text-muted">{labelFor(incident.type, e.key)}</span>
                <span className={`block truncate ${incident.fields[e.key].state === 'answered' ? '' : 'text-warn'}`}>{displayValue(incident.fields[e.key])}</span>
              </button>
            </li>
          )
        })}
      </ol>
      {view && (
        <>
          <div className="panel-title border-t">Key questions</div>
          <ol className="p-1.5">
            {view.progress.steps.map((s, i) => {
              const a = s.type === 'question' ? session?.answers[s.node.id] : undefined
              const text = s.type === 'terminal' ? s.node.outcome : s.node.prompt
              const current = inQuestions && s.node.id === view.progress.steps[view.index]?.node.id
              return (
                <li key={s.node.id}>
                  <button
                    className={item(current)}
                    aria-current={current ? 'step' : undefined}
                    onClick={() => {
                      useCase.getState().setStep(entries.length)
                      useCase.getState().setView(s.node.id)
                    }}
                  >
                    <span className="block truncate">{i + 1}. {text}</span>
                    <span className={`block text-[11px] ${a && a.kind !== 'option' && a.kind !== 'text' ? 'text-warn' : 'text-muted'}`}>
                      {s.type === 'terminal' ? 'Endpoint' : a && s.type === 'question' ? answerLabel(s.node, a) : 'Not yet asked'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          {view.progress.skipped.length > 0 && (
            <ul className="border-t border-line p-2 text-[11px] text-muted">
              {view.progress.skipped.map((s) => <li key={s.nodeId}>Skipped (not applicable): {s.prompt}</li>)}
            </ul>
          )}
        </>
      )}
    </nav>
  )
}
