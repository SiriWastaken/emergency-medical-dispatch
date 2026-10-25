import * as Dialog from '@radix-ui/react-dialog'
import { ClipboardList, FileText, HelpCircle, Moon, Settings, Sun, UserPen, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { fmtTime } from './format'
import { useApp, type Section } from '@/stores/app'
import { useCase } from '@/stores/case'
import { chooseAnswer, stepView } from '@/features/workflows/view'
import { copyNarrative } from '@/features/call-narrative/copy'
import { CallWorkspace } from '@/features/call/CallWorkspace'
import { stageOf } from '@/features/call/flow'
import { NewCallButtons, startCall } from '@/components/NewCallButtons'
import { NarrativeView } from '@/features/call-narrative/NarrativeView'
import { SettingsView } from '@/features/settings/SettingsView'
import { TypeBadge } from '@/components/TypeBadge'
import { QueueView } from '@/features/incidents/QueueView'
import { INCIDENT_STATUSES, INCIDENT_TYPES, STATUS_LABEL, type IncidentStatus, type IncidentType } from '@/types/incident'
import { SHORTCUTS, useShortcuts } from './shortcuts'

const NAV: { section: Section; label: string; icon: ReactNode }[] = [
  { section: 'queue', label: 'Incident queue', icon: <ClipboardList size={15} /> },
  { section: 'call', label: 'Call', icon: <UserPen size={15} /> },
  { section: 'narrative', label: 'Call narrative', icon: <FileText size={15} /> },
  { section: 'settings', label: 'Settings', icon: <Settings size={15} /> },
]

const VIEWS: Record<Section, () => ReactNode> = {
  queue: QueueView,
  call: CallWorkspace,
  narrative: NarrativeView,
  settings: SettingsView,
}

export function App() {
  const { boot, bootError, section, theme, setTheme } = useApp()
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    void useApp.getState().init()
  }, [])

  const onShortcut = useCallback((id: string, e: KeyboardEvent) => {
    e.preventDefault()
    const app = useApp.getState()
    if (id === 'new') void app.startPendingCall()
    else if (id.startsWith('new-')) void startCall(id.slice(4) as IncidentType)
    else if (id.startsWith('nav-')) void app.go(id.slice(4) as Section)
    else if (id === 'prev' || id === 'next') {
      if (app.section === 'call' && stageOf() === 'questions') stepView(id === 'prev' ? -1 : 1)
    } else if (id === 'copy') void copyNarrative()
    else if (id === 'help') setHelpOpen(true)
    else if (id.startsWith('answer:') && app.section === 'call') {
      const n = Number(id.slice(7))
      if (app.pendingCall && !useCase.getState().incident) {
        const t = INCIDENT_TYPES[n - 1]
        if (t) void startCall(t)
      } else if (stageOf() === 'questions') chooseAnswer(n)
    }
  }, [])
  useShortcuts(onShortcut)

  if (boot === 'loading') return <div className="grid h-full place-items-center text-muted">Opening local database…</div>
  if (boot === 'error') {
    return (
      <div className="grid h-full place-items-center p-6">
        <div role="alert" className="max-w-lg">
          <h1 className="mb-2 text-[16px] font-semibold text-danger">The local database could not be opened</h1>
          <p className="selectable mb-2 font-mono">{bootError}</p>
          <p className="text-muted">Your data has not been modified. Quit and reopen the app; if this persists, restore a backup after reinstalling.</p>
        </div>
      </div>
    )
  }

  const View = VIEWS[section]
  return (
    <div className="grid h-full grid-cols-[200px_minmax(0,1fr)] grid-rows-[38px_auto_auto_minmax(0,1fr)_24px]">
      <header className="col-span-2 row-start-1 flex items-center gap-2 border-b border-line bg-surface px-3">
        <strong className="tracking-wide">EMERGENCY MEDICAL DISPATCH</strong>
        <span className="grow" />
        <button className="btn !py-0.5 btn-primary" onClick={() => void useApp.getState().startPendingCall()}>New 911</button>
        <NewCallButtons compact />
        <button className="btn !px-1.5 !py-0.5" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button className="btn !px-1.5 !py-0.5" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(true)}><HelpCircle size={14} /></button>
      </header>
      <CaseBar />
      <SaveBanner />
      <Sidebar />
      <main className="col-start-2 row-start-4 min-h-0 min-w-0 border-x border-line" aria-label={NAV.find((n) => n.section === section)?.label}>
        <View />
      </main>
      <StatusBar />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}

/** Type, number, status and last-updated time of the open call, visible in every section. */
function CaseBar() {
  const incident = useCase((s) => s.incident)
  const saveState = useCase((s) => s.saveState)
  if (!incident) return null
  return (
    <div className="col-span-2 row-start-2 flex items-center gap-3 border-b border-line bg-surface-2 px-3 py-1">
      <TypeBadge type={incident.type} />
      <span className="font-mono">{incident.id}</span>
      <label className="flex items-center gap-1.5 text-muted">
        Status
        <select aria-label="Incident status" className="input !w-auto !py-0" value={incident.status} onChange={(e) => useCase.getState().setStatus(e.target.value as IncidentStatus)}>
          {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      <span className="text-muted">Started {fmtTime(incident.createdAt)} · Updated {fmtTime(incident.updatedAt)}</span>
      <span className={`ml-auto text-[11px] ${saveState === 'error' ? 'text-danger' : saveState === 'saved' ? 'text-ok' : 'text-warn'}`}>{saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'error' ? 'Save failed' : ''}</span>
    </div>
  )
}

function SaveBanner() {
  const { saveState, error } = useCase()
  if (saveState !== 'error' || !error) return null
  return (
    <div role="alert" className="col-span-2 row-start-3 flex items-center gap-3 border-b border-danger bg-surface-2 px-3 py-1 text-danger">
      <span>{error}</span>
      <button className="btn !py-0" onClick={() => void useCase.getState().flush()}>Retry save</button>
      <button className="btn !py-0" onClick={() => void useCase.getState().discardAndReload()}>Discard unsaved changes and reload</button>
    </div>
  )
}

function Sidebar() {
  const { section, go } = useApp()
  return (
    <nav aria-label="Sections" className="col-start-1 row-start-4 min-h-0 bg-surface">
      <ul className="p-1.5">
        {NAV.map((n, i) => (
          <li key={n.section}>
            <button
              aria-current={section === n.section ? 'page' : undefined}
              onClick={() => go(n.section)}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2 ${section === n.section ? 'bg-surface-2 text-accent' : ''}`}
            >
              {n.icon}
              <span className="grow">{n.label}</span>
              <span className="kbd">⌘{i + 1}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function StatusBar() {
  const { saveState, lastSavedAt, incident } = useCase()
  const toast = useApp((s) => s.toast)
  const section = useApp((s) => s.section)
  const text =
    saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'error' ? 'Save failed' : saveState === 'saved' && lastSavedAt ? `All changes saved · ${fmtTime(lastSavedAt)}` : 'No call open'
  return (
    <footer className="col-span-2 row-start-5 flex items-center gap-4 border-t border-line bg-surface px-3 text-[11px] text-muted">
      <span className={saveState === 'error' ? 'text-danger' : saveState === 'dirty' || saveState === 'saving' ? 'text-warn' : ''}>{text}</span>
      <span>Call: <span className="font-mono">{incident ? `${incident.type} · ${incident.id}` : '—'}</span></span>
      <span>{NAV.find((n) => n.section === section)?.label}</span>
      <span className="grow" />
      <span role="status" aria-live="polite" className="text-ok">{toast}</span>
      <span>Local only · SQLite</span>
    </footer>
  )
}

function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-sm border border-line bg-surface p-4">
          <div className="mb-2 flex items-center">
            <Dialog.Title className="grow text-[14px] font-semibold">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close className="btn !px-1" aria-label="Close"><X size={14} /></Dialog.Close>
          </div>
          <Dialog.Description className="mb-2 text-muted">⌘ shortcuts work anywhere. Single-key shortcuts are ignored while typing in a field.</Dialog.Description>
          <table className="w-full">
            <tbody>
              {SHORTCUTS.map((s) => <tr key={s.id} className="border-t border-line"><td className="py-1 pr-3"><span className="kbd">{s.keys}</span></td><td>{s.description}</td></tr>)}
            </tbody>
          </table>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

