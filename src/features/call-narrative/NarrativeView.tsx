import { Copy, FileDown } from 'lucide-react'
import { buildNotes } from '@/domain/narrative'
import { EmptyIncident } from '@/components/EmptyIncident'
import { useCase } from '@/stores/case'
import { copyNarrative, saveNarrativeFile } from './copy'
import { useCurrentNarrative } from './current'

export function NarrativeView() {
  const incident = useCase((s) => s.incident)
  const text = useCurrentNarrative()
  if (!incident || text === null) return <EmptyIncident />
  const notes = buildNotes(incident)

  return (
    <div className="flex h-full flex-col">
      <div className="panel-title">CALL NARRATIVE</div>
      <div className="min-h-0 grow overflow-auto p-3">
        <div className="mb-2 flex items-center gap-2">
          <button className="btn btn-primary" onClick={copyNarrative}><Copy size={14} /> Copy Narrative</button>
          <button className="btn" onClick={saveNarrativeFile}><FileDown size={14} /> Save as .txt</button>
          <span className="text-[11px] text-muted">Built from the case data; instructions you tick as given appear in it.</span>
        </div>
        <pre aria-label="Call narrative" data-testid="narrative" className="selectable whitespace-pre-wrap rounded-sm border border-line bg-surface p-3 font-mono text-[13px] leading-6">
          {text}
        </pre>
        <h3 className="label mt-4">Additional notes (separate from the narrative above)</h3>
        <pre className="selectable min-h-10 whitespace-pre-wrap rounded-sm border border-dashed border-line p-2 font-sans text-[13px]">
          {notes ?? <span className="text-muted">No additional notes entered.</span>}
        </pre>
      </div>
    </div>
  )
}
