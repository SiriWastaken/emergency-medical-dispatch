import { statusOf, type WorkflowDefinition } from '@/types/workflow'

/** Always shown with a workflow so unvalidated content can never pass as an official protocol. */
export function bannerText(w: WorkflowDefinition): string {
  if (w.provenance?.origin === 'roleplay' && statusOf(w) === 'pending-validation') return 'ROLEPLAY TRAINING CONTENT: realistic, but not a real dispatch protocol'
  if (w.incomplete) return 'INCOMPLETE — CONTENT REQUIRED: no authorized questions have been supplied for this call yet'
  const status = statusOf(w)
  if (status === 'verified-source') return `VERIFIED SOURCE: ${w.provenance?.source ?? ''} (${w.provenance?.sourceFile ?? ''}, verified by ${w.provenance?.verifiedBy ?? ''})`
  if (status === 'disabled') return 'DISABLED: not available for call-taking'
  return 'AWAITING VALIDATION — not authorized for operational use'
}

export const statusLabel = (w: WorkflowDefinition) => w.provenance?.origin === 'roleplay' ? 'ROLEPLAY' : w.incomplete ? 'CONTENT REQUIRED' : ({ 'verified-source': 'VERIFIED SOURCE', 'pending-validation': 'AWAITING VALIDATION', disabled: 'DISABLED' })[statusOf(w)]

export function StatusBanner({ workflow }: { workflow: WorkflowDefinition }) {
  const status = statusOf(workflow)
  const tone = status === 'verified-source' ? 'border-ok text-ok' : 'border-warn text-warn'
  return (
    <div role="note" className={`border-b px-3 py-1 text-[11px] font-semibold tracking-wide ${tone}`}>
      {bannerText(workflow)}
    </div>
  )
}
