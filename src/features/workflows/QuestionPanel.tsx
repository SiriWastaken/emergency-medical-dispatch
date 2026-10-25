import { useState } from 'react'
import { isMandatory, offeredResponses, optionAvailability, type Progress } from '@/domain/workflow-engine/engine'
import type { Answers, QuestionNode, WorkflowDefinition } from '@/types/workflow'
import { AnswerGroup, type AnswerChoice } from './AnswerGroup'
import { answerNode, answerText, NOT_ASKED_ID, UNAVAILABLE_ID, UNKNOWN_ID } from './view'

const RESPONSE = {
  unknown: { id: UNKNOWN_ID, label: 'Unknown (caller does not know)', hint: '0' },
  unavailable: { id: UNAVAILABLE_ID, label: 'Unavailable (cannot be answered right now)' },
  not_asked: { id: NOT_ASKED_ID, label: 'Not asked (skip this question)' },
} as const

/** The active question: selectable answers, or a text box only when the question genuinely needs typing. */
export function QuestionPanel({ def, node, answers, progress }: { def: WorkflowDefinition; node: QuestionNode; answers: Answers; progress: Progress }) {
  const answer = answers[node.id]
  const visited = new Set(progress.visited.slice(0, progress.visited.indexOf(node.id)))
  const required = isMandatory(node, answers, visited)
  const responses = offeredResponses(node, required).map((r) => RESPONSE[r])
  const rejected = progress.invalid.find((i) => i.nodeId === node.id)

  return (
    <div className="max-w-2xl">
      <p className="label">
        {node.stage && <span className="mr-2 normal-case">{node.stage} ·</span>}
        {required ? <span className="text-warn">Required</span> : <span>Optional</span>}
        {node.field && <span className="ml-2 normal-case text-muted">fills the call narrative</span>}
      </p>
      <h2 className="selectable mb-1 text-[20px] font-semibold leading-snug">{node.prompt}</h2>
      {node.help && <p className="mb-3 text-muted">{node.help}</p>}
      {rejected && <p role="alert" className="mb-2 text-danger">The saved answer is not valid: {rejected.message}</p>}
      {node.input ? (
        <TextAnswer key={`${node.id}-${answer?.kind === 'text' ? answer.value : ''}`} def={def} node={node} initial={answer?.kind === 'text' ? answer.value : ''} responses={responses} selected={answer && answer.kind !== 'text' ? answer.kind : null} />
      ) : (
        <ChoiceAnswer def={def} node={node} answers={answers} progress={progress} responses={responses} />
      )}
      {!answer && required && <p className="mt-3 text-[12px] text-muted">An answer is required before the next question.</p>}
    </div>
  )
}

function ChoiceAnswer({ def, node, answers, responses }: { def: WorkflowDefinition; node: QuestionNode; answers: Answers; progress: Progress; responses: AnswerChoice[] }) {
  const answer = answers[node.id]
  const blocked = optionAvailability(def, answers, node.id)
  const selectedId = !answer || answer.kind === 'text' ? null : answer.kind === 'option' ? answer.optionId : (RESPONSE[answer.kind] as AnswerChoice).id
  const choices: AnswerChoice[] = [...node.options.map((o, i): AnswerChoice => ({ id: o.id, label: o.label, hint: i < 9 ? String(i + 1) : undefined, disabledReason: blocked.get(o.id) })), ...responses]
  return <AnswerGroup label={node.prompt} focusKey={node.id} selectedId={selectedId} choices={choices} onSelect={(id) => answerNode(def, node.id, id)} />
}

function TextAnswer({ def, node, initial, responses, selected }: { def: WorkflowDefinition; node: QuestionNode; initial: string; responses: AnswerChoice[]; selected: string | null }) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const submit = () => setError(answerText(def, node.id, value))
  return (
    <div>
      <textarea
        autoFocus
        aria-label={node.prompt}
        aria-invalid={!!error}
        className="input min-h-20 text-[16px]"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return
          e.preventDefault() // also stops this keypress activating whatever is focused next
          submit()
        }}
      />
      {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={submit}>Next question</button>
        {responses.map((r) => (
          <button key={r.id} className={`btn ${selected && RESPONSE[selected as keyof typeof RESPONSE]?.id === r.id ? 'border-accent' : ''}`} onClick={() => answerNode(def, node.id, r.id)}>
            {r.label.split(' (')[0]}
          </button>
        ))}
        <span className="text-[11px] text-muted">Enter submits (Shift+Enter for a new line).</span>
      </div>
    </div>
  )
}
