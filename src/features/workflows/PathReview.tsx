import { answerLabel, resolve, type Report } from '@/domain/workflow-engine/engine'
import type { Answers, WorkflowDefinition } from '@/types/workflow'

const TONE = { complete: 'text-ok', incomplete: 'text-warn', blocked: 'text-danger' } as const
export const STATE_TEXT = { complete: 'Complete', incomplete: 'Incomplete', blocked: 'Cannot proceed' } as const

/** The questions actually asked, in order, with each answer, plus skipped questions and the validation result. */
export function PathReview({ def, answers, report, onJump }: { def: WorkflowDefinition; answers: Answers; report: Report; onJump?: (nodeId: string) => void }) {
  const p = resolve(def, answers)
  return (
    <div className="selectable">
      <p className={`mb-2 font-semibold ${TONE[report.state]}`}>{STATE_TEXT[report.state]}</p>
      {report.issues.length > 0 && (
        <ul className="mb-3 list-disc pl-5">
          {report.issues.map((i, k) => <li key={k} className={i.code === 'unanswered' || i.code === 'missing-field' ? 'text-warn' : 'text-danger'}>{i.message}</li>)}
        </ul>
      )}
      <ol aria-label="Questions and answers" className="mb-3 list-decimal pl-5">
        {p.steps.map((s) => {
          if (s.type === 'terminal') return <li key={s.node.id}><span className="text-muted">Outcome:</span> {s.node.outcome}</li>
          const a = answers[s.node.id]
          return (
            <li key={s.node.id} className="mb-1">
              {onJump ? <button className="text-left text-accent hover:underline" onClick={() => onJump(s.node.id)}>{s.node.prompt}</button> : s.node.prompt}
              <br />
              {a ? (
                <strong className={a.kind === 'option' ? '' : 'text-warn'}>{answerLabel(s.node, a)}</strong>
              ) : (
                <span className="text-warn">NOT YET ASKED</span>
              )}
            </li>
          )
        })}
      </ol>
      {p.skipped.length > 0 && (
        <>
          <h4 className="label">Did not apply</h4>
          <ul className="mb-3 text-muted">{p.skipped.map((s) => <li key={s.nodeId}>{s.prompt} ({s.reason})</li>)}</ul>
        </>
      )}
      {report.unresolved.length > 0 && (
        <>
          <h4 className="label">Answered without information</h4>
          <ul className="text-warn">{report.unresolved.map((u) => <li key={u.nodeId}>{u.prompt}: {u.response.replace('_', ' ')}</li>)}</ul>
        </>
      )}
    </div>
  )
}
