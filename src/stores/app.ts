import { create } from 'zustand'
import { getSetting, listWorkflows, loadCatalogueExtra, saveCatalogueExtra, seedBuiltinWorkflows, setSetting, type StoredWorkflow } from '@/persistence/settings'
import { migrate } from '@/persistence/migrate'
import { LIBRARY } from '@/data/library'
import { CALL_TAKING, CALL_TAKING_ISSUES } from '@/data/call-taking'
import type { CatalogueEntry } from '@/types/catalogue'
import { deleteAllIncidents, deleteIncident, listIncidents } from '@/persistence/incidents'
import type { IncidentStatus, IncidentSummary, IncidentType } from '@/types/incident'
import { getDb } from './db'
import { useCase } from './case'

export const SECTIONS = ['queue', 'call', 'narrative', 'settings'] as const
export type Section = (typeof SECTIONS)[number]
export type Theme = 'dark' | 'light'

interface AppState {
  boot: 'loading' | 'ready' | 'error'
  bootError: string | null
  section: Section
  theme: Theme
  /** A new 911 call has been started but its incident type is not chosen yet. */
  pendingCall: boolean
  startPendingCall(): Promise<void>
  cancelPendingCall(): void
  workflows: StoredWorkflow[]
  workflowProblems: string[]
  catalogue: CatalogueEntry[]
  libraryIssues: string[]
  incidents: IncidentSummary[]
  query: string
  statusFilter: IncidentStatus | 'all'
  typeFilter: IncidentType | 'all'
  toast: string | null
  showToast(msg: string): void
  init(): Promise<void>
  go(s: Section): Promise<void>
  setTheme(t: Theme): Promise<void>
  refreshWorkflows(): Promise<void>
  setQueueFilter(f: { query?: string; statusFilter?: IncidentStatus | 'all'; typeFilter?: IncidentType | 'all' }): Promise<void>
  /** Re-reads the queue from SQLite; called after every create, save and restore. */
  refreshQueue(): Promise<void>
  /** Permanently deletes one call (closing it first if it is the open one). */
  deleteCall(id: string): Promise<void>
  /** Permanently deletes every call. */
  deleteAllCalls(): Promise<void>
  /** Adds user-imported catalogue entries (kept apart from the bundled ones). */
  addCatalogueEntries(entries: CatalogueEntry[]): Promise<void>
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useApp = create<AppState>((set, get) => ({
  boot: 'loading',
  bootError: null,
  section: 'queue',
  theme: 'dark',
  pendingCall: false,
  workflows: [],
  workflowProblems: [],
  catalogue: LIBRARY.catalogue,
  libraryIssues: [...LIBRARY.issues, ...CALL_TAKING_ISSUES],
  incidents: [],
  query: '',
  statusFilter: 'all',
  typeFilter: 'all',
  toast: null,
  showToast(msg) {
    clearTimeout(toastTimer)
    set({ toast: msg })
    toastTimer = setTimeout(() => set({ toast: null }), 2500)
  },

  async init() {
    try {
      const db = getDb()
      await migrate(db)
      // The workbook's question trees (including marked placeholders) plus any bundled authorized workflows.
      await seedBuiltinWorkflows(db, [...LIBRARY.workflows, ...CALL_TAKING.workflows])
      set({ catalogue: [...LIBRARY.catalogue, ...(await loadCatalogueExtra(db))] })
      const theme = (await getSetting(db, 'theme')) === 'light' ? 'light' : 'dark'
      document.documentElement.dataset.theme = theme
      set({ theme })
      await get().refreshWorkflows()
      await get().refreshQueue()
      const last = await getSetting(db, 'activeIncidentId')
      if (last) {
        // Recovery: reopen whatever was open when the app last closed. A missing record is not an error.
        await useCase.getState().open(last)
        if (useCase.getState().incident) set({ section: 'call' })
      }
      set({ boot: 'ready', bootError: null })
    } catch (e) {
      set({ boot: 'error', bootError: e instanceof Error ? e.message : String(e) })
    }
  },

  async go(section) {
    await useCase.getState().flush()
    set({ section })
  },

  async setTheme(theme) {
    document.documentElement.dataset.theme = theme
    set({ theme })
    await setSetting(getDb(), 'theme', theme)
  },

  async startPendingCall() {
    await useCase.getState().flush()
    set({ pendingCall: true, section: 'call' })
  },

  cancelPendingCall: () => set({ pendingCall: false }),

  async addCatalogueEntries(entries) {
    const db = getDb()
    const extra = [...(await loadCatalogueExtra(db)), ...entries]
    await saveCatalogueExtra(db, extra)
    set({ catalogue: [...LIBRARY.catalogue, ...extra] })
  },

  async setQueueFilter(f) {
    set(f)
    await get().refreshQueue()
  },

  async deleteCall(id) {
    const c = useCase.getState()
    await c.flush() // let any save in flight finish so it cannot touch the record afterwards
    if (c.incident?.id === id) {
      c.clear()
      await setSetting(getDb(), 'activeIncidentId', '')
    }
    await deleteIncident(getDb(), id)
    await get().refreshQueue()
    get().showToast('Call deleted')
  },

  async deleteAllCalls() {
    const c = useCase.getState()
    await c.flush()
    c.clear()
    await setSetting(getDb(), 'activeIncidentId', '')
    const n = await deleteAllIncidents(getDb())
    await get().refreshQueue()
    get().showToast(`${n} call${n === 1 ? '' : 's'} deleted`)
  },

  async refreshQueue() {
    const { query, statusFilter, typeFilter } = get()
    set({ incidents: await listIncidents(getDb(), { query, status: statusFilter, type: typeFilter }) })
  },

  async refreshWorkflows() {
    const { workflows, problems } = await listWorkflows(getDb())
    set({ workflows, workflowProblems: problems })
  },


}))
