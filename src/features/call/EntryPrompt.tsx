import { ArrowLeft, ArrowRight } from 'lucide-react'
import { NaturePicker } from '@/components/NaturePicker'
import { configOf } from '@/domain/incident-types'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import { currentEntry, entryError, goStep, markStep, pickNature, setVerified, tryAdvance, useEntryUi } from './flow'

const STATE_NOTE = { unknown: 'UNKNOWN', not_asked: 'NOT ASKED', not_applicable: 'NOT APPLICABLE' } as const

/** The case-entry question on screen: a focused prompt, never a form of several fields. */
export function EntryPrompt() {
  const incident = useCase((s) => s.incident)
  useCase((s) => s.step)
  const catalogue = useApp((s) => s.catalogue)
  const workflows = useApp((s) => s.workflows)
  const setField = useCase((s) => s.setField)
  const cur = currentEntry()
  const attempted = useEntryUi((s) => s.attempted)
  if (!incident || !cur) return null
  const { step } = cur
  const field = incident.fields[step.key]
  const set = (value: string) => {
    setField(step.key, { state: value === '' ? 'unanswered' : 'answered', value })
    useEntryUi.setState({ attempted: false })
  }
  // Format errors show as soon as there is text; "required" only once the call-taker tries to move on.
  const error = entryError(attempted)

  return (
    <div className="max-w-2xl">
      <p className="label">Case entry · {configOf(incident).name}</p>
      <h2 className="mb-3 text-[20px] font-semibold leading-snug">{step.prompt}</h2>
      {step.kind === 'nature' ? (
        <NaturePicker key={`${incident.id}-nature`} id="nature" service={incident.type} catalogue={catalogue} workflows={workflows.map((w) => w.definition)} value={field.state === 'answered' ? field.value : ''} onPick={pickNature} />
      ) : step.kind === 'long' ? (
        <textarea
          key={step.key}
          autoFocus
          aria-label={step.prompt}
          className="input min-h-24 text-[16px]"
          value={field.value}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return
            e.preventDefault()
            tryAdvance()
          }}
        />
      ) : (
        <input
          key={step.key}
          autoFocus
          aria-label={step.prompt}
          aria-invalid={!!error}
          className="input text-[16px]"
          value={field.value}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault() // otherwise this keypress would also activate the next prompt's first control
            tryAdvance()
          }}
        />
      )}
      {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
      {field.state in STATE_NOTE && <p className="mt-1 text-warn">Marked {STATE_NOTE[field.state as keyof typeof STATE_NOTE]}. Entering a value replaces this.</p>}
      {field.state === 'answered' && (
        <label className="mt-2 flex items-center gap-2 text-muted">
          <input type="checkbox" checked={!!field.verified} onChange={(e) => setVerified(e.target.checked)} />
          Independently verified (unchecked = caller-reported)
        </label>
      )}
      <p className="mt-2 text-[11px] text-muted">Enter for next{step.kind === 'long' ? ' (Shift+Enter for a new line)' : ''}.</p>
    </div>
  )
}

export function EntryActions() {
  const incident = useCase((s) => s.incident)
  useCase((s) => s.step)
  const cur = currentEntry()
  if (!incident || !cur) return null
  return (
    <>
      <button className="btn" disabled={cur.index === 0} onClick={() => goStep(-1)}><ArrowLeft size={14} /> Back</button>
      <button className="btn" onClick={() => markStep('unknown')}>Unknown</button>
      <button className="btn" onClick={() => markStep('not_asked')}>Not asked</button>
      <button className="btn" onClick={() => markStep('not_applicable')}>Not applicable</button>
      <span className="grow" />
      <button className="btn btn-primary" onClick={tryAdvance}>{cur.index === cur.total - 1 ? 'Start key questions' : 'Next'} <ArrowRight size={14} /></button>
    </>
  )
}
