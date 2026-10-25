import { useMemo, useState } from 'react'
import { saveTextFile } from '@/app/files'
import { buildCatalogue, CATALOGUE_TEMPLATE_CSV } from '@/domain/import/catalogue'
import { readTable } from '@/domain/import/file'
import type { Table } from '@/domain/import/table'
import { useApp } from '@/stores/app'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CatalogueImport() {
  const catalogue = useApp((s) => s.catalogue)
  const workflows = useApp((s) => s.workflows)
  const showToast = useApp((s) => s.showToast)
  const [table, setTable] = useState<Table | null>(null)
  const [error, setError] = useState<string | null>(null)
  const counts = (['EMS', 'PD', 'FD'] as const).map((s) => `${s} ${catalogue.filter((e) => e.service === s).length}`).join(' · ')
  const result = useMemo(
    () => (table ? buildCatalogue(table, catalogue, new Map(workflows.map((w) => [w.definition.id, w.definition.service]))) : null),
    [table, catalogue, workflows],
  )

  return (
    <div className="space-y-2 p-3">
      <p className="text-muted">Natures of call available: {counts}. Imported entries are added as AWAITING VALIDATION and never replace bundled ones. Required columns: service, group, label; optional: workflow_id.</p>
      <div className="flex items-end gap-3">
        <div>
          <label htmlFor="cat-file" className="label">Catalogue file (.xlsx or .csv)</label>
          <input id="cat-file" type="file" accept=".xlsx,.csv" onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) readTable(f).then((t) => { setTable(t); setError(null) }, (x: unknown) => { setTable(null); setError(errText(x)) })
          }} />
        </div>
        <button className="btn" onClick={() => saveTextFile('catalogue-template.csv', CATALOGUE_TEMPLATE_CSV).then((p) => p && showToast('Template saved'), (e: unknown) => setError(errText(e)))}>Download template…</button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {result && (
        <div>
          {result.issues.map((i) => <p key={i} role="alert" className="text-danger">{i}</p>)}
          {result.rowErrors.length > 0 && <ul className="max-h-32 overflow-auto text-danger">{result.rowErrors.map((e, k) => <li key={k}>Row {e.line}: {e.message}</li>)}</ul>}
          {result.issues.length === 0 && <p>{result.entries.length} valid entr{result.entries.length === 1 ? 'y' : 'ies'} ready to add{result.rowErrors.length ? `; ${result.rowErrors.length} row(s) with errors will be skipped` : ''}.</p>}
          <button className="btn btn-primary mt-1" disabled={result.entries.length === 0 || result.issues.length > 0} onClick={async () => {
            try {
              await useApp.getState().addCatalogueEntries(result.entries)
              showToast(`${result.entries.length} natures of call added`)
              setTable(null)
            } catch (e) { setError(errText(e)) }
          }}>Add {result.entries.length} entries</button>
        </div>
      )}
    </div>
  )
}
