import { AnswerGroup } from '@/features/workflows/AnswerGroup'
import { incidentTypePrompt } from '@/domain/incident-types'
import { startCall } from '@/components/NewCallButtons'
import { useApp } from '@/stores/app'
import { INCIDENT_TYPES, type IncidentType } from '@/types/incident'

const NAMES: Record<IncidentType, string> = { EMS: 'EMS: medical', PD: 'PD: police', FD: 'FD: fire' }

/** The first prompt of a new 911 call: which kind of incident it is. Choosing one creates the incident. */
export function SelectTypePrompt() {
  const cancel = useApp((s) => s.cancelPendingCall)
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-lg">
        <p className="label">New 911 call</p>
        <h2 className="mb-3 text-[20px] font-semibold">{incidentTypePrompt()}</h2>
        <AnswerGroup
          label={incidentTypePrompt()}
          focusKey="incident-type"
          selectedId={null}
          choices={INCIDENT_TYPES.map((t, i) => ({ id: t, label: NAMES[t], hint: String(i + 1) }))}
          onSelect={(id) => void startCall(id as IncidentType)}
        />
        <button className="btn mt-3" onClick={cancel}>Cancel</button>
      </div>
    </div>
  )
}
