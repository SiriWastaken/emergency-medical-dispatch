import type { IncidentType } from '@/types/incident'

const TONE: Record<IncidentType, string> = { EMS: 'border-ok text-ok', PD: 'border-accent text-accent', FD: 'border-warn text-warn' }

export function TypeBadge({ type }: { type: IncidentType }) {
  return <span className={`rounded-sm border px-1.5 text-[11px] font-semibold ${TONE[type]}`}>{type}</span>
}
