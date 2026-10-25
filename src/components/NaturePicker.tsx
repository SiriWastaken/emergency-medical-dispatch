import { useEffect, useMemo, useRef, useState } from 'react'
import { groupedEntries } from '@/domain/library/select'
import type { CatalogueEntry } from '@/types/catalogue'
import type { Service } from '@/types/incident'
import { statusOf, type WorkflowDefinition } from '@/types/workflow'

const TAG = { 'verified-source': 'VERIFIED SOURCE', 'pending-validation': 'AWAITING VALIDATION', disabled: 'DISABLED' } as const

interface Props {
  id: string
  service: Service
  catalogue: CatalogueEntry[]
  workflows: WorkflowDefinition[]
  value: string
  onPick(entry: CatalogueEntry): void
}

/** Searchable, grouped list of one service's natures of call. Enter picks the highlighted entry. */
export function NaturePicker({ id, service, catalogue, workflows, value, onPick }: Props) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => groupedEntries(catalogue, service, query), [catalogue, service, query])
  const flat = groups.flatMap((g) => g.entries)
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((e) => e.label === value)))
  const listRef = useRef<HTMLDivElement>(null)
  const current = Math.min(active, Math.max(flat.length - 1, 0))
  const activeId = flat[current] ? `${id}-opt-${flat[current].id}` : undefined

  useEffect(() => {
    if (activeId) listRef.current?.querySelector(`[id="${activeId}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeId])

  const tagFor = (e: CatalogueEntry) => {
    const w = e.workflowId ? workflows.find((x) => x.id === e.workflowId) : undefined
    return w ? TAG[statusOf(w)] : null
  }

  return (
    <div>
      <input
        id={id}
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls={`${id}-list`}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-label={`Nature of the call (${service})`}
        className="input mb-2 text-[16px]"
        placeholder={`Search ${service} natures of call…`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive(Math.max(0, Math.min(flat.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1))))
          } else if (e.key === 'Enter') {
            e.preventDefault() // also stops this keypress activating whatever gets focus next
            const picked = flat[current]
            if (picked) onPick(picked)
          }
        }}
      />
      <div ref={listRef} id={`${id}-list`} role="listbox" aria-label={`${service} natures of call`} className="max-h-[48vh] overflow-auto rounded-sm border border-line bg-surface">
        {flat.length === 0 && <p className="p-2 text-muted">No {service} nature of call matches "{query}".</p>}
        {groups.map((g) => (
          <div key={g.group} role="group" aria-label={g.group}>
            <div className="sticky top-0 bg-surface-2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.group}</div>
            {g.entries.map((e) => {
              const isActive = flat[current]?.id === e.id
              const tag = tagFor(e)
              return (
                <div
                  key={e.id}
                  id={`${id}-opt-${e.id}`}
                  role="option"
                  aria-selected={e.label === value}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => onPick(e)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1 ${isActive ? 'bg-accent-bg text-white' : 'hover:bg-surface-2'}`}
                >
                  <span className="grow">{e.label}</span>
                  {e.label === value && <span className="text-[11px]">selected</span>}
                  {tag && <span className="rounded-sm border border-current px-1 text-[10px]">{tag}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
