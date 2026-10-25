import { CALL_TAKING } from '@/data/call-taking'
import { useCase } from '@/stores/case'

const given = (value: string) => value.split(',').map((x) => x.trim()).filter(Boolean)

/**
 * A caller instruction to read out. Only an AUTHORIZED script is ever shown as words to read;
 * until one is supplied the card says so, and does not offer wording of its own.
 */
export function InstructionCard({ id }: { id: string }) {
  const incident = useCase((s) => s.incident)
  const setField = useCase((s) => s.setField)
  const ins = CALL_TAKING.instructions.find((i) => i.id === id && i.incidentType === incident?.type)
  if (!incident || !ins) return <p className="text-danger" role="alert">Instruction "{id}" is not defined for this call type.</p>
  const field = incident.fields.instructionsGiven
  const list = given(field.state === 'answered' ? field.value : '')
  const authorized = ins.status !== 'CONTENT REQUIRED'
  const toggle = (on: boolean) => {
    const next = on ? [...new Set([...list, ins.id])] : list.filter((x) => x !== ins.id)
    setField('instructionsGiven', { state: next.length ? 'answered' : 'unanswered', value: next.join(', ') })
  }
  return (
    <section aria-label={ins.title} className="rounded-sm border border-line bg-surface p-3">
      <h3 className="mb-1 font-semibold">{ins.title}</h3>
      {authorized ? (
        <>
          <p className="label">Read to the caller</p>
          {ins.status === 'ROLEPLAY' && <p className="mb-1 text-[11px] font-semibold text-warn">ROLEPLAY TRAINING SCRIPT: not a certified protocol</p>}
          <pre className="selectable mb-2 whitespace-pre-wrap font-sans text-[15px] leading-6">{ins.script}</pre>
          {ins.source && <p className="mb-2 text-[11px] text-muted">Source: {ins.source}</p>}
        </>
      ) : (
        <p className="mb-2 text-warn" role="status">
          CONTENT REQUIRED: no authorized script has been supplied for this instruction, so there are no words to read. Add it to the Instructions sheet of call-taking-workflow.xlsx (Status AUTHORIZED, with its Source), then run pnpm workflow:build.
        </p>
      )}
      <label className={`flex items-center gap-2 ${authorized ? '' : 'text-muted'}`}>
        <input type="checkbox" disabled={!authorized} checked={list.includes(ins.id)} onChange={(e) => toggle(e.target.checked)} />
        Given to the caller
      </label>
    </section>
  )
}

export const instructionTitles = (value: string, type: string): string[] =>
  given(value).map((id) => CALL_TAKING.instructions.find((i) => i.id === id && i.incidentType === type)?.title ?? id)
