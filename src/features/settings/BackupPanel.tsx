import { useState } from 'react'
import { saveTextFile } from '@/app/files'
import { exportBackup, parseBackup, restoreBackup, type Backup } from '@/persistence/backup'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'
import { getDb } from '@/stores/db'
import { fmtTime } from '@/app/format'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function BackupPanel() {
  const showToast = useApp((s) => s.showToast)
  const [pending, setPending] = useState<{ backup: Backup; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doExport = async () => {
    try {
      await useCase.getState().flush()
      const b = await exportBackup(getDb())
      const path = await saveTextFile(`emergency-medical-dispatch-backup-${b.createdAt.slice(0, 10)}.json`, JSON.stringify(b, null, 2))
      if (path) showToast('Backup saved')
      setError(null)
    } catch (e) {
      setError(`Backup failed: ${errText(e)}`)
    }
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setPending({ backup: parseBackup(await file.text()), name: file.name })
      setError(null)
    } catch (e) {
      setPending(null)
      setError(errText(e))
    }
  }

  const doRestore = async () => {
    if (!pending) return
    try {
      await useCase.getState().flush()
      await restoreBackup(getDb(), pending.backup)
      useCase.getState().clear()
      await useApp.getState().init()
      setPending(null)
      showToast('Backup restored')
    } catch (e) {
      setError(`Restore failed, current data was not changed: ${errText(e)}`)
    }
  }

  return (
    <section>
      <h3 className="panel-title">Backup and restore</h3>
      <div className="space-y-3 p-3">
        <div>
          <button className="btn" onClick={doExport}>Export backup…</button>
          <span className="ml-2 text-muted">Saves every incident, workflow and setting to one JSON file.</span>
        </div>
        <div>
          <label htmlFor="restore-file" className="label">Restore from backup file</label>
          <input id="restore-file" type="file" accept=".json,application/json" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        {pending && (
          <div className="rounded-sm border border-warn p-2" role="alertdialog" aria-label="Confirm restore">
            <p className="mb-1"><strong>{pending.name}</strong> is a valid backup from {fmtTime(pending.backup.createdAt)}: {pending.backup.tables.incidents.length} incident(s), {pending.backup.tables.workflow_definitions.length} workflow(s).</p>
            <p className="mb-2 text-warn">Restoring replaces ALL current incidents, workflows and settings. Export a backup first if you may need the current data.</p>
            <button className="btn btn-danger" onClick={doRestore}>Replace current data with this backup</button>
            <button className="btn ml-2" onClick={() => setPending(null)}>Cancel</button>
          </div>
        )}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </section>
  )
}
