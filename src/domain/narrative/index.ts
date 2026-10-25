import { CALL_TAKING } from '@/data/call-taking'
import type { NarrativeLine } from '@/domain/call-taking/schema'
import type { FieldKey, FieldValue, Incident } from '@/types/incident'

export const PLACEHOLDERS = {
  unanswered: 'NOT YET RECORDED',
  unknown: 'UNKNOWN',
  not_asked: 'NOT ASKED',
  not_applicable: 'NOT APPLICABLE',
} as const

type Source = Pick<Incident, 'type' | 'fields'>

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The recorded value, or the placeholder for its non-answer state. */
export function displayValue(f: FieldValue): string {
  return f.state === 'answered' && f.value.trim() ? f.value : PLACEHOLDERS[f.state === 'answered' ? 'unanswered' : f.state]
}

const ids = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)
const titleOf = (type: Source['type'], id: string) => CALL_TAKING.instructions.find((i) => i.id === id && i.incidentType === type)?.title ?? id

/** One line's value. Several fields are joined as "first - second"; a deliberate non-answer is shown as such. */
function lineValue(line: NarrativeLine, type: Source['type'], fields: Record<FieldKey, FieldValue>): string {
  if (line.fields.length === 1 && line.fields[0] === 'instructionsGiven') {
    const f = fields.instructionsGiven
    return f.state === 'answered' && ids(f.value).length ? ids(f.value).map((id) => titleOf(type, id)).join('; ') : 'NONE GIVEN'
  }
  const parts = line.fields.map((k) => fields[k])
  const answered = parts.flatMap((f) => (f.state === 'answered' && oneLine(f.value) ? [oneLine(f.value)] : []))
  if (answered.length) {
    const joined = answered.join(' - ')
    // A suffix (for example YEARS) only follows a plain number, never free text.
    return line.suffix && /^\d+$/.test(joined) ? `${joined} ${line.suffix}` : joined
  }
  const chosen = parts.find((f) => f.state !== 'unanswered' && f.state !== 'answered')
  return PLACEHOLDERS[chosen ? (chosen.state as keyof typeof PLACEHOLDERS) : 'unanswered']
}

/**
 * The narrative for the incident's type, exactly as the workbook's Narratives sheet defines it. Free text can
 * never add lines. When a script has been recommended by the questions, or given to the caller, a
 * PRE-ARRIVAL INSTRUCTIONS section follows, saying which were given and which are still to be.
 */
export function buildNarrative(incident: Source, recommended: readonly string[] = []): string {
  const lines = CALL_TAKING.narratives[incident.type]!.map((line) => `${line.label} ${lineValue(line, incident.type, incident.fields)}`)
  const given = new Set(ids(incident.fields.instructionsGiven.state === 'answered' ? incident.fields.instructionsGiven.value : ''))
  const all = [...new Set([...recommended, ...given])]
  if (!all.length) return lines.join('\n')
  const section = all.map((id) => `${titleOf(incident.type, id)}: ${given.has(id) ? 'GIVEN' : 'NOT YET GIVEN'}`)
  return [...lines, '', 'PRE-ARRIVAL INSTRUCTIONS:', ...section].join('\n')
}

/** Optional notes, kept apart from the required lines. Null when nothing was entered. */
export function buildNotes(incident: Pick<Incident, 'fields'>): string | null {
  const n = incident.fields.notes
  return n.state === 'answered' && n.value.trim() ? n.value.trim() : null
}
