import { create } from 'zustand'
import { configOf, firstOpenStep } from '@/domain/incident-types'
import { applyAnswer, applyFieldEffects, fieldEffects, pruneStale } from '@/domain/workflow-engine/engine'
import { ConflictError } from '@/persistence/db'
import { createIncident, loadIncident, loadSession, saveCase, type SessionState } from '@/persistence/incidents'
import { setSetting } from '@/persistence/settings'
import type { FieldKey, FieldValue, Incident, IncidentStatus, IncidentType } from '@/types/incident'
import type { Answer, WorkflowDefinition } from '@/types/workflow'
import { getDb } from './db'
import { useApp } from './app'

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
const DEBOUNCE_MS = 400

interface CaseState {
  incident: Incident | null
  session: SessionState | null
  saved: { incident: Incident; session: SessionState | null } | null
  saveState: SaveState
  error: string | null
  lastSavedAt: string | null
  /** Question currently on screen (UI only, not persisted). */
  viewNodeId: string | null
  /**
   * Position in the call (UI only): 0..n-1 is a case-entry question; n (the number of case-entry
   * questions) means the question workflow stage.
   */
  step: number
  /** Where to come back to after correcting an earlier case-entry value. */
  returnTo: { step: number; viewNodeId: string | null } | null
  notice: string | null
  create(type: IncidentType): Promise<void>
  /** Closes the open case without saving (callers flush first when needed). */
  clear(): void
  /** Throws away unsaved edits and reloads the stored record (recovery from a save error). */
  discardAndReload(): Promise<void>
  open(id: string): Promise<void>
  setField(key: FieldKey, value: FieldValue): void
  setStatus(status: IncidentStatus): void
  startWorkflow(workflowId: string): void
  /** Clears the session. Pass the definition so fields the answers filled in are cleared too. */
  resetWorkflow(def?: WorkflowDefinition): void
  answer(def: WorkflowDefinition, nodeId: string, answer: Answer): { removed: string[] }
  setView(nodeId: string | null): void
  setStep(n: number): void
  /** Goes to an earlier case-entry question to correct it, remembering where the call-taker was. */
  jumpTo(step: number): void
  /** Goes back to where the call-taker was before a correction; null if there was no correction in progress. */
  popReturn(): { step: number; viewNodeId: string | null } | null
  setNotice(n: string | null): void
  flush(): Promise<void>
}

let timer: ReturnType<typeof setTimeout> | undefined
let chain: Promise<void> = Promise.resolve()

export const useCase = create<CaseState>((set, get) => {
  const markDirty = () => {
    set({ saveState: 'dirty', error: null })
    clearTimeout(timer)
    timer = setTimeout(() => void get().flush(), DEBOUNCE_MS)
  }

  async function doSave() {
    const s = get()
    // 'error' is retried too, so Retry and later navigation can recover from a failed save.
    if ((s.saveState !== 'dirty' && s.saveState !== 'error') || !s.incident || !s.saved) return
    const snapshot = { incident: s.incident, session: s.session }
    set({ saveState: 'saving' })
    try {
      const done = await saveCase(getDb(), s.saved, snapshot)
      const now = get()
      const edited = now.incident !== snapshot.incident || now.session !== snapshot.session
      set({
        saved: { incident: done, session: snapshot.session },
        // Keep edits made while the save was running; only adopt the new revision.
        incident: now.incident && now.incident.id === done.id ? { ...now.incident, revision: done.revision, updatedAt: done.updatedAt } : now.incident,
        saveState: edited ? 'dirty' : 'saved',
        lastSavedAt: done.updatedAt,
        error: null,
      })
      if (edited) markDirty()
      void useApp.getState().refreshQueue()
    } catch (e) {
      set({
        saveState: 'error',
        error: e instanceof ConflictError ? e.message : `Save failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  /** Flushes until nothing is pending, so a switch can never drop or misfile an edit. */
  async function settle() {
    for (let i = 0; i < 10; i++) {
      await get().flush()
      if (get().saveState !== 'dirty' && get().saveState !== 'saving') return
    }
  }

  return {
    incident: null,
    session: null,
    saved: null,
    saveState: 'idle',
    error: null,
    lastSavedAt: null,
    viewNodeId: null,
    step: 0,
    returnTo: null,
    notice: null,

    async create(type) {
      await settle()
      if (get().saveState === 'error') return
      const incident = await createIncident(getDb(), type)
      await setSetting(getDb(), 'activeIncidentId', incident.id)
      // Edits typed while the new record was being created still belong to the old one.
      await settle()
      if (get().saveState === 'error') return
      set({ incident, session: null, saved: { incident, session: null }, saveState: 'saved', error: null, lastSavedAt: incident.updatedAt, viewNodeId: null, step: 0, returnTo: null, notice: null })
      await useApp.getState().refreshQueue()
    },

    clear() {
      clearTimeout(timer)
      set({ incident: null, session: null, saved: null, saveState: 'idle', error: null, viewNodeId: null, returnTo: null, notice: null })
    },

    async discardAndReload() {
      const id = get().incident?.id
      set({ saveState: 'idle', error: null })
      if (id) await get().open(id)
    },

    async open(id) {
      await settle()
      if (get().saveState === 'error') return // do not leave an unsaved case behind
      // Always read from SQLite, never from a copy.
      const incident = await loadIncident(getDb(), id)
      if (!incident) return
      const session = await loadSession(getDb(), id)
      await setSetting(getDb(), 'activeIncidentId', id)
      await settle() // edits made during the reads above are saved to the case being left
      if (get().saveState === 'error') return
      set({ incident, session, saved: { incident, session }, saveState: 'saved', error: null, lastSavedAt: incident.updatedAt, viewNodeId: null, // A call with questions underway resumes at its open question; skipped entry questions are not re-asked.
        step: session ? configOf(incident).steps.length : firstOpenStep(incident),
        returnTo: null, notice: null })
    },

    setField(key, value) {
      const { incident } = get()
      if (!incident) return
      set({ incident: { ...incident, fields: { ...incident.fields, [key]: value } } })
      markDirty()
    },

    setStatus(status) {
      const { incident } = get()
      if (!incident || incident.status === status) return
      set({ incident: { ...incident, status } })
      markDirty()
    },

    startWorkflow(workflowId) {
      if (!get().incident) return
      set({ session: { workflowId, answers: {} }, viewNodeId: null, notice: null })
      markDirty()
    },

    resetWorkflow(def) {
      const { incident, session } = get()
      const fields = incident && session && def ? applyFieldEffects(incident.fields, fieldEffects(def, session.answers), {}) : incident?.fields
      set({ session: null, viewNodeId: null, notice: null, ...(incident && fields ? { incident: { ...incident, fields } } : {}) })
      markDirty()
    },

    answer(def, nodeId, answer) {
      const { session, incident } = get()
      if (!session || !incident) throw new Error('No workflow session is active')
      const { answers, removed } = applyAnswer(def, session.answers, nodeId, answer)
      const pruned = pruneStale(def, answers)
      // One update: the answers and the incident fields they fill in change together, so the narrative never lags.
      const fields = applyFieldEffects(incident.fields, fieldEffects(def, session.answers), fieldEffects(def, pruned))
      set({ session: { ...session, answers: pruned }, incident: { ...incident, fields } })
      markDirty()
      return { removed }
    },

    setView: (viewNodeId) => set({ viewNodeId }),
    setStep: (step) => set({ step }),
    jumpTo(step) {
      const { step: here, viewNodeId, returnTo } = get()
      set({ step, returnTo: returnTo ?? (step === here ? null : { step: here, viewNodeId }) })
    },
    popReturn() {
      const r = get().returnTo
      if (r) set({ step: r.step, viewNodeId: r.viewNodeId, returnTo: null })
      return r
    },
    setNotice: (notice) => set({ notice }),

    /** Resolves once everything edited so far is written (or has visibly failed). */
    flush() {
      clearTimeout(timer)
      chain = chain.then(doSave)
      return chain
    },
  }
})
