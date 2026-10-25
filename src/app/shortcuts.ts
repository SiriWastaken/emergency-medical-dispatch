import { useEffect } from 'react'

export interface Shortcut {
  id: string
  keys: string
  description: string
  /** Matches on e.key (lowercased) with the given modifiers. */
  key: string
  mod?: boolean
  shift?: boolean
  /** Plain-key shortcuts must not fire while the user is typing. */
  plain?: boolean
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'new', keys: '⌘ N', description: 'New 911 call (choose the type)', key: 'n', mod: true },
  { id: 'new-PD', keys: '⌘ ⇧ P', description: 'New 911 → PD', key: 'p', mod: true, shift: true },
  { id: 'new-EMS', keys: '⌘ ⇧ E', description: 'New 911 → EMS', key: 'e', mod: true, shift: true },
  { id: 'new-FD', keys: '⌘ ⇧ F', description: 'New 911 → FD', key: 'f', mod: true, shift: true },
  { id: 'nav-queue', keys: '⌘ 1', description: 'Incident queue', key: '1', mod: true },
  { id: 'nav-call', keys: '⌘ 2', description: 'Call (case entry and key questions)', key: '2', mod: true },
  { id: 'nav-narrative', keys: '⌘ 3', description: 'Call narrative', key: '3', mod: true },
  { id: 'nav-settings', keys: '⌘ 4', description: 'Settings', key: '4', mod: true },
  { id: 'prev', keys: '⌘ [', description: 'Previous question', key: '[', mod: true },
  { id: 'next', keys: '⌘ ]', description: 'Next question', key: ']', mod: true },
  { id: 'copy', keys: '⌘ ⇧ C', description: 'Copy call narrative', key: 'c', mod: true, shift: true },
  { id: 'help', keys: '?', description: 'Show this reference', key: '?', plain: true },
  { id: 'answer', keys: '1 – 9, 0', description: 'Choose answer 1–9, or 0 for unknown (intake and key questions)', key: '', plain: true },
]

export function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el instanceof HTMLInputElement && !['radio', 'checkbox', 'button'].includes(el.type)
}

/** Resolves a key event to a shortcut id. Modifier shortcuts work anywhere; plain keys only outside text fields. */
export function matchShortcut(e: KeyboardEvent): string | null {
  const mod = e.metaKey || e.ctrlKey
  const typing = isTyping(e.target)
  for (const s of SHORTCUTS) {
    if (!s.key) continue
    if (s.plain ? mod || e.altKey || typing : !mod || !!s.shift !== e.shiftKey) continue
    if (e.key.toLowerCase() === s.key) return s.id
  }
  if (!mod && !e.altKey && !typing && /^[0-9]$/.test(e.key)) return `answer:${e.key}`
  return null
}

export function useShortcuts(handler: (id: string, e: KeyboardEvent) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = matchShortcut(e)
      if (id) handler(id, e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handler])
}
