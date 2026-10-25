import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import { INCIDENT_TYPES, type IncidentType } from '@/types/incident'

export async function startCall(type: IncidentType) {
  await useCase.getState().create(type)
  useApp.getState().cancelPendingCall()
  if (useCase.getState().incident) await useApp.getState().go('call')
}

export function NewCallButtons({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex gap-2">
      {INCIDENT_TYPES.map((s) => (
        <button key={s} className={`btn btn-primary ${compact ? '!py-0.5' : ''}`} onClick={() => startCall(s)}>
          New 911 → {s}
        </button>
      ))}
    </div>
  )
}
