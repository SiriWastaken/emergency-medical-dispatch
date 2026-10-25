import { Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { fmtTime } from '@/app/format'
import { TypeBadge } from '@/components/TypeBadge'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import { INCIDENT_STATUSES, INCIDENT_TYPES, STATUS_LABEL, type IncidentStatus, type IncidentType } from '@/types/incident'

export function QueueView() {
  const { incidents, query, statusFilter, typeFilter, setQueueFilter, go, deleteCall, deleteAllCalls } = useApp()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (f: () => Promise<void>) => {
    try {
      setError(null)
      await f()
    } catch (e) {
      setError(`Could not delete: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setConfirmId(null)
      setConfirmAll(false)
    }
  }
  const active = useCase((s) => s.incident?.id)
  const openIncident = async (id: string) => {
    await useCase.getState().open(id)
    if (useCase.getState().incident?.id === id) await go('call')
  }
  const filtered = query || statusFilter !== 'all' || typeFilter !== 'all'

  return (
    <div className="flex h-full flex-col">
      <div className="panel-title">Incident queue</div>
      <div className="flex items-end gap-2 border-b border-line p-3">
        <div className="grow">
          <label htmlFor="q-search" className="label">Search</label>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1.5 text-muted" aria-hidden />
            <input id="q-search" className="input !pl-7" placeholder="Incident number, name, nature of call, location or description" value={query} onChange={(e) => setQueueFilter({ query: e.target.value })} />
          </div>
        </div>
        <div>
          <label htmlFor="q-type" className="label">Type</label>
          <select id="q-type" className="input" value={typeFilter} onChange={(e) => setQueueFilter({ typeFilter: e.target.value as IncidentType | 'all' })}>
            <option value="all">All</option>
            {INCIDENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="q-status" className="label">Status</label>
          <select id="q-status" className="input" value={statusFilter} onChange={(e) => setQueueFilter({ statusFilter: e.target.value as IncidentStatus | 'all' })}>
            <option value="all">All</option>
            {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <button className="btn btn-danger" disabled={incidents.length === 0 && !filtered} onClick={() => setConfirmAll(true)}><Trash2 size={14} /> Clear all calls…</button>
      </div>
      {confirmAll && (
        <div role="alertdialog" aria-label="Confirm clear all calls" className="flex items-center gap-3 border-b border-danger bg-surface-2 px-3 py-2 text-danger">
          <span>
            Permanently delete {filtered ? 'ALL calls, including any hidden by the filters' : `all ${incidents.length} call${incidents.length === 1 ? '' : 's'}`}? This cannot be undone. Export a backup in Settings first if you may need them.
          </span>
          <button className="btn btn-danger" onClick={() => run(deleteAllCalls)}>Delete all calls</button>
          <button className="btn" onClick={() => setConfirmAll(false)}>Cancel</button>
        </div>
      )}
      {error && <p role="alert" className="border-b border-line px-3 py-1 text-danger">{error}</p>}
      <div className="min-h-0 grow overflow-auto">
        {incidents.length === 0 ? (
          <p className="p-4 text-muted">{filtered ? 'No incidents match the current search.' : 'The queue is empty. Start a call with New 911 → EMS, PD or FD.'}</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wide text-muted">
              <tr>{['Type', 'Incident', 'Name', 'Nature of call', 'Status', 'Last updated', ''].map((h) => <th key={h} className="border-b border-line px-3 py-1.5 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id} className={`cursor-pointer border-b border-line hover:bg-surface-2 ${i.id === active ? 'bg-surface-2' : ''}`} onDoubleClick={() => openIncident(i.id)}>
                  <td className="px-3 py-1.5"><TypeBadge type={i.type} /></td>
                  <td className="px-3 py-1.5 font-mono"><button className="text-accent underline-offset-2 hover:underline" onClick={() => openIncident(i.id)}>{i.id}</button></td>
                  <td className="px-3 py-1.5">{i.name || <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-1.5">{i.complaint || <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-1.5">{STATUS_LABEL[i.status]}</td>
                  <td className="px-3 py-1.5 text-muted">{fmtTime(i.updatedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {confirmId === i.id ? (
                      <span className="inline-flex items-center gap-1.5" role="group" aria-label={`Confirm delete ${i.id}`}>
                        <span className="text-danger">Delete this call?</span>
                        <button className="btn btn-danger !py-0" onClick={() => run(() => deleteCall(i.id))}>Delete</button>
                        <button className="btn !py-0" onClick={() => setConfirmId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button className="btn !py-0" aria-label={`Delete ${i.id}`} onClick={() => setConfirmId(i.id)}><Trash2 size={13} /> Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
