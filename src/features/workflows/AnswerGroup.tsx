import { useEffect, useRef } from 'react'

export interface AnswerChoice {
  id: string
  label: string
  hint?: string
  /** Why this choice cannot be selected right now. */
  disabledReason?: string
}

interface Props {
  label: string
  choices: AnswerChoice[]
  selectedId: string | null
  onSelect(id: string): void
  /** Changes when a different question is shown, so focus can move to it. */
  focusKey: string
}

/** Radio group where arrows only move focus; Enter/Space commits (so arrowing never answers by accident). */
export function AnswerGroup({ label, choices, selectedId, onSelect, focusKey }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = Math.max(0, choices.findIndex((c) => c.id === selectedId))

  useEffect(() => {
    refs.current[selectedIndex]?.focus()
  }, [focusKey]) // eslint-disable-line react-hooks/exhaustive-deps -- only on question change

  const move = (from: number, step: number) => refs.current[(from + step + choices.length) % choices.length]?.focus()

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      {choices.map((c, i) => {
        const checked = c.id === selectedId
        return (
          <button
            key={c.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={c.disabledReason ? true : undefined}
            tabIndex={i === selectedIndex ? 0 : -1}
            onClick={() => !c.disabledReason && onSelect(c.id)}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
              if (!step) return
              e.preventDefault()
              move(i, step)
            }}
            className={`flex items-center gap-3 rounded-sm border px-4 py-2.5 text-left text-[15px] ${
              c.disabledReason ? 'cursor-not-allowed border-line text-muted opacity-70' : 'hover:border-accent'
            } ${checked ? 'border-accent bg-accent-bg/20' : 'border-line bg-surface'}`}
          >
            <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-full border ${checked ? 'border-accent' : 'border-muted'}`}>
              {checked && <span className="size-2 rounded-full bg-accent" />}
            </span>
            <span className="grow">
              {c.label}
              {c.disabledReason && <span className="block text-[12px] text-warn">Not available: {c.disabledReason}</span>}
            </span>
            {c.hint && <span className="kbd">{c.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
