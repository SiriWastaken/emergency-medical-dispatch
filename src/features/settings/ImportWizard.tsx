import { useMemo, useState } from 'react'
import { saveTextFile } from '@/app/files'
import { readTable } from '@/domain/import/file'
import type { Table } from '@/domain/import/table'
import type { Service } from '@/types/incident'
import { SERVICES } from '@/types/incident'
import { buildWorkflow, ROLES, slugify, suggestMapping, TEMPLATE_CSV, type Mapping, type RoleKey } from '@/domain/import/workflow'
import { saveWorkflow } from '@/persistence/settings'
import { useApp } from '@/stores/app'
import { getDb } from '@/stores/db'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function ImportWizard() {
  const workflows = useApp((s) => s.workflows)
  const showToast = useApp((s) => s.showToast)
  const [table, setTable] = useState<Table | null>(null)
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<Mapping>({})
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [start, setStart] = useState('')
  const [service, setService] = useState<Service>('EMS')
  const [category, setCategory] = useState('Imported')
  const [sheet, setSheet] = useState<string | undefined>()
  const [file, setFile] = useState<File | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startChoices = useMemo(() => {
    if (!table || mapping.nodeId === undefined) return []
    return [...new Set(table.rows.map((r) => (r.cells[mapping.nodeId!] ?? '').trim()).filter(Boolean))]
  }, [table, mapping.nodeId])

  const result = useMemo(() => (table ? buildWorkflow(table, mapping, { id: id.trim(), name: name.trim(), start, service, category: category.trim() || 'Imported', status: 'pending-validation', provenance: { origin: 'user-import', sourceFile: fileName, worksheet: table.sheet, importedAt: new Date().toISOString() }, sheet: table.sheet }) : null), [table, mapping, id, name, start, service, category, fileName])
  const exists = workflows.find((w) => w.definition.id === id.trim())
  const metaMissing = !name.trim() || !id.trim() || !start

  const pick = async (file: File | undefined, sheetName?: string) => {
    if (!file) return
    try {
      const t = await readTable(file, sheetName)
      setFile(file)
      setSheet(t.sheet)
      const m = suggestMapping(t.headers)
      const base = file.name.replace(/\.[^.]+$/, '')
      setTable(t)
      setFileName(file.name)
      setMapping(m)
      setName(base)
      setId(slugify(base))
      setStart('')
      setOverwrite(false)
      setError(null)
    } catch (e) {
      setTable(null)
      setError(errText(e))
    }
  }

  const doImport = async () => {
    if (!result?.definition) return
    try {
      await saveWorkflow(getDb(), result.definition, overwrite)
      await useApp.getState().refreshWorkflows()
      showToast(`Workflow "${result.definition.name}" imported`)
      setTable(null)
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }

  const setRole = (k: RoleKey, v: string) => {
    const next = { ...mapping }
    if (v === '') delete next[k]
    else next[k] = Number(v)
    setMapping(next)
  }

  return (
    <div className="space-y-3 p-3">
      <p className="text-muted">One row per answer option; terminal rows describe outcomes. Nothing is imported until you confirm below.</p>
      <div className="flex items-end gap-3">
        <div>
          <label htmlFor="import-file" className="label">Spreadsheet (.xlsx or .csv)</label>
          <input id="import-file" type="file" accept=".xlsx,.csv" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <button className="btn" onClick={() => saveTextFile('workflow-template.csv', TEMPLATE_CSV).then((p) => p && showToast('Template saved'), (e: unknown) => setError(errText(e)))}>Download CSV template…</button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {table && result && (
        <>
          <div>
            <h4 className="label">Detected columns · {fileName} · {table.rows.length} data row(s)</h4>
            <div className="overflow-auto rounded-sm border border-line">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-surface-2"><tr><th className="px-2 py-1">Row</th>{table.headers.map((h, i) => <th key={i} className="px-2 py-1">{h || `(column ${i + 1})`}</th>)}</tr></thead>
                <tbody>{table.rows.slice(0, 5).map((r) => <tr key={r.line} className="border-t border-line"><td className="px-2 py-0.5 text-muted">{r.line}</td>{table.headers.map((_, i) => <td key={i} className="px-2 py-0.5">{r.cells[i]}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {ROLES.map((r) => (
              <div key={r.key}>
                <label htmlFor={`map-${r.key}`} className="label">{r.label}{r.required && ' *'}</label>
                <select id={`map-${r.key}`} className="input" value={mapping[r.key] ?? ''} onChange={(e) => setRole(r.key, e.target.value)}>
                  <option value="">— not mapped —</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
                </select>
              </div>
            ))}
          </div>
          {table.sheets && table.sheets.length > 1 && (
            <div className="max-w-xs">
              <label htmlFor="imp-sheet" className="label">Worksheet (VALIDATION is chosen automatically if present)</label>
              <select id="imp-sheet" className="input" value={sheet} onChange={(e) => void pick(file ?? undefined, e.target.value)}>
                {table.sheets.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="imp-service" className="label">Service</label>
              <select id="imp-service" className="input" value={service} onChange={(e) => setService(e.target.value as Service)}>{SERVICES.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
            <div><label htmlFor="imp-cat" className="label">Complaint category</label><input id="imp-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
          </div>
          <p className="text-warn">Imported workflows are always saved as AWAITING VALIDATION with their source file, worksheet and rows recorded. They are never marked verified automatically.</p>
          <div className="grid grid-cols-3 gap-3">
            <div><label htmlFor="imp-name" className="label">Workflow name</label><input id="imp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label htmlFor="imp-id" className="label">Workflow ID</label><input id="imp-id" className="input font-mono" value={id} onChange={(e) => setId(e.target.value)} /></div>
            <div>
              <label htmlFor="imp-start" className="label">Start node (choose explicitly)</label>
              <select id="imp-start" className="input" value={start} onChange={(e) => setStart(e.target.value)}>
                <option value="">— choose —</option>
                {startChoices.map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div aria-live="polite">
            {result.issues.length > 0 && <ul className="text-danger">{result.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
            {result.rowErrors.length > 0 && (
              <div>
                <h4 className="label">{result.rowErrors.length} row error(s)</h4>
                <ul className="max-h-40 overflow-auto text-danger">{result.rowErrors.map((e, k) => <li key={k}>Row {e.line}: {e.message}</li>)}</ul>
              </div>
            )}
            {result.definition && (
              <div>
                <h4 className="label">Workflow preview · {result.definition.nodes.length} nodes · starts at {result.definition.start}</h4>
                <ul className="selectable max-h-48 overflow-auto rounded-sm border border-line p-2 font-mono text-[12px]">
                  {result.definition.nodes.map((n) => (
                    <li key={n.id} className="mb-1">
                      <strong>{n.id}</strong> {n.kind === 'terminal' ? `[END] ${n.outcome}` : n.prompt}
                      {n.kind === 'question' && (
                        <ul className="pl-4">
                          {n.options.map((o) => <li key={o.id}>{o.label} → {o.next}</li>)}
                          {n.unknownNext && <li>(unknown) → {n.unknownNext}</li>}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {exists && (
            <label className="flex items-center gap-2 text-warn">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              A workflow with ID "{id.trim()}" already exists. Replace it with this import.
            </label>
          )}
          <button className="btn btn-primary" disabled={!result.definition || metaMissing || (!!exists && !overwrite)} onClick={doImport}>Import workflow</button>
        </>
      )}
    </div>
  )
}
