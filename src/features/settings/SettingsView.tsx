import { useState } from 'react'
import { deleteWorkflow } from '@/persistence/settings'
import { useApp } from '@/stores/app'
import { getDb } from '@/stores/db'
import { BackupPanel } from './BackupPanel'
import { ImportWizard } from './ImportWizard'
import { CatalogueImport } from './CatalogueImport'
import { statusLabel } from '@/components/StatusBanner'
import { LIBRARY } from '@/data/library'

export function SettingsView() {
  const { theme, setTheme, workflows, workflowProblems, refreshWorkflows, libraryIssues } = useApp()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="h-full overflow-auto">
      <div className="panel-title">Settings</div>
      <section>
        <h3 className="panel-title">Appearance</h3>
        <div className="p-3">
          <label htmlFor="theme" className="label">Theme</label>
          <select id="theme" className="input !w-40" value={theme} onChange={(e) => setTheme(e.target.value === 'light' ? 'light' : 'dark')}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
      </section>
      <section>
        <h3 className="panel-title">Natures of call ({LIBRARY.catalogue.length} built in)</h3>
        <CatalogueImport />
      </section>
      <section>
        <h3 className="panel-title">Workflows</h3>
        <ul className="p-3">
          {workflows.map(({ definition: d, builtin }) => (
            <li key={d.id} className="flex items-center gap-2 py-0.5">
              <span>{d.name}</span>
              <span className="font-mono text-[11px] text-muted">{d.service ?? '—'} · {d.id} · {d.nodes.length} nodes{builtin ? ' · bundled' : ''}</span>
              <span className="text-[11px] text-warn">{statusLabel(d)}</span>
              {!builtin && (
                <button className="btn ml-auto" onClick={async () => {
                  try { await deleteWorkflow(getDb(), d.id); await refreshWorkflows(); setError(null) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
                }}>Delete</button>
              )}
            </li>
          ))}
        </ul>
        {libraryIssues.map((p) => <p key={p} role="alert" className="px-3 text-danger">Bundled library problem: {p}</p>)}
        {workflowProblems.map((p) => <p key={p} role="alert" className="px-3 text-danger">{p}</p>)}
        {error && <p role="alert" className="px-3 text-danger">{error}</p>}
        <h3 className="panel-title">Import workflow from spreadsheet</h3>
        <ImportWizard />
      </section>
      <BackupPanel />
      <section>
        <h3 className="panel-title">About</h3>
        <p className="p-3 text-muted">All data stays on this Mac in the app data folder (~/Library/Application Support/dev.dispatchdesk.app). No account, network or telemetry. Natures of call are plain labels, not validated triage classifications or dispatch codes.</p>
      </section>
    </div>
  )
}
