import { X } from 'lucide-react'
import { CALL_TAKING } from '@/data/call-taking'
import { useCase } from '@/stores/case'
import { InstructionCard } from './InstructionCard'

/** Scripts to read to the caller (for example CPR), available at any point in the call. */
export function InstructionsPanel({ onClose }: { onClose(): void }) {
  const incident = useCase((s) => s.incident)
  if (!incident) return null
  const list = CALL_TAKING.instructions.filter((i) => i.incidentType === incident.type)
  return (
    <aside aria-label="Caller instructions" className="min-h-0 w-96 shrink-0 overflow-auto border-l border-line bg-surface">
      <div className="panel-title flex items-center justify-between">
        <span>Caller instructions</span>
        <button className="text-muted hover:text-ink" aria-label="Close caller instructions" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="space-y-3 p-3">
        {list.length === 0 && <p className="text-muted">No caller instructions are defined for this call type.</p>}
        {list.map((i) => <InstructionCard key={i.id} id={i.id} />)}
      </div>
    </aside>
  )
}
