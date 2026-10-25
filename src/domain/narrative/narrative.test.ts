import { describe, expect, it } from 'vitest'
import { buildNarrative, buildNotes, PLACEHOLDERS } from './index'
import { emptyField, FIELD_KEYS, type FieldKey, type FieldValue, type IncidentType } from '@/types/incident'

const make = (type: IncidentType, over: Partial<Record<FieldKey, Partial<FieldValue>>> = {}) => {
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, { ...emptyField(), ...over[k] }])) as Record<FieldKey, FieldValue>
  return { type, fields }
}
const ans = (value: string): Partial<FieldValue> => ({ state: 'answered', value })
const ems = (over: Partial<Record<FieldKey, Partial<FieldValue>>> = {}) => make('EMS', over)
const pd = (over: Partial<Record<FieldKey, Partial<FieldValue>>> = {}) => make('PD', over)

describe('EMS narrative', () => {
  it('has the eight required labels in order, then the emergency-instructions line', () => {
    const lines = buildNarrative(ems()).split('\n')
    expect(lines).toHaveLength(9)
    expect(lines.map((l) => l.split(':')[0] + ':')).toEqual([
      'PHONE NUMBER:',
      "CALLER'S PROBLEM DESCRIPTION IS:",
      "CALLER'S RELATIONSHIP TO PATIENT:",
      'NUMBER OF HURT/SICK:',
      'PATIENT(S) AGE IS:',
      'PATIENT(S) SEX IS:',
      'PATIENT(S) CONSCIOUS STATUS:',
      'PATIENT(S) BREATHING STATUS:',
      'EMERGENCY INSTRUCTIONS GIVEN:',
    ])
  })

  it('renders every field', () => {
    expect(
      buildNarrative(ems({ callerPhone: ans('555-0100'), complaint: ans('Fall'), description: ans('Slipped on stairs'), callerRelationship: ans('Bystander'), patientCount: ans('2'), patientAge: ans('34'), sex: ans('Female'), consciousStatus: ans('Yes'), breathingStatus: ans('Abnormal') })),
    ).toBe(
      [
        'PHONE NUMBER: 555-0100',
        "CALLER'S PROBLEM DESCRIPTION IS: Fall - Slipped on stairs",
        "CALLER'S RELATIONSHIP TO PATIENT: Bystander",
        'NUMBER OF HURT/SICK: 2',
        'PATIENT(S) AGE IS: 34 YEARS',
        'PATIENT(S) SEX IS: Female',
        'PATIENT(S) CONSCIOUS STATUS: Yes',
        'PATIENT(S) BREATHING STATUS: Abnormal',
        'EMERGENCY INSTRUCTIONS GIVEN: NONE GIVEN',
      ].join('\n'),
    )
  })

  it('keeps unanswered, unknown, not asked and not applicable distinct', () => {
    const text = buildNarrative(ems({ callerPhone: { state: 'unknown' }, patientAge: { state: 'not_asked' }, sex: { state: 'not_applicable' } }))
    expect(text).toContain(`PHONE NUMBER: ${PLACEHOLDERS.unknown}`)
    expect(text).toContain(`PATIENT(S) AGE IS: ${PLACEHOLDERS.not_asked}`)
    expect(text).toContain(`PATIENT(S) SEX IS: ${PLACEHOLDERS.not_applicable}`)
    expect(text).toContain(`NUMBER OF HURT/SICK: ${PLACEHOLDERS.unanswered}`)
  })

  it('never prints null, undefined or blank values', () => {
    const text = buildNarrative(ems({ callerPhone: ans('   '), patientCount: ans('') }))
    expect(text).not.toMatch(/null|undefined/)
    text.split('\n').forEach((l) => expect(l.split(': ')[1]?.trim()).toBeTruthy())
  })

  it('flattens multi-line free text so it can never add lines', () => {
    const text = buildNarrative(ems({ description: ans('line one\n\nline   two') }))
    expect(text.split('\n')).toHaveLength(9)
    expect(text).toContain('line one line two')
  })

  it('uses the nature alone when there is no description, and vice versa', () => {
    expect(buildNarrative(ems({ complaint: ans('Burns') }))).toContain('IS: Burns\n')
    expect(buildNarrative(ems({ description: ans('free text') }))).toContain('IS: free text\n')
  })

  it('does not print an age unit for an invalid age', () => {
    expect(buildNarrative(ems({ patientAge: ans('abc') }))).toContain('PATIENT(S) AGE IS: abc\n')
  })

  it('ignores PD-only data and never includes notes, location or names', () => {
    const text = buildNarrative(ems({ callerName: ans('Caller Person'), patientName: ans('Pat Person'), location: ans('1 Main St'), notes: ans('private note') }))
    for (const s of ['Caller Person', 'Pat Person', '1 Main St', 'private note']) expect(text).not.toContain(s)
  })
})

describe('PD narrative', () => {
  it('has the three base fields in order, using the caller name, then the emergency-instructions line', () => {
    expect(buildNarrative(pd({ callerPhone: ans('555-0142'), callerName: ans('Alex Caller'), complaint: ans('Public disturbance'), description: ans('Loud argument outside') }))).toBe(
      ['PHONE NUMBER: 555-0142', "CALLER'S NAME: Alex Caller", "CALLER'S PROBLEM DESCRIPTION: Public disturbance - Loud argument outside", 'EMERGENCY INSTRUCTIONS GIVEN: NONE GIVEN'].join('\n'),
    )
    expect(buildNarrative(pd()).split('\n')).toHaveLength(4)
  })

  it('shows distinct placeholders and never null/undefined', () => {
    const text = buildNarrative(pd({ callerName: { state: 'unknown' }, callerPhone: { state: 'not_asked' } }))
    expect(text).toBe(['PHONE NUMBER: NOT ASKED', "CALLER'S NAME: UNKNOWN", "CALLER'S PROBLEM DESCRIPTION: NOT YET RECORDED", 'EMERGENCY INSTRUCTIONS GIVEN: NONE GIVEN'].join('\n'))
    expect(text).not.toMatch(/null|undefined/)
  })

  it('takes the name from the caller record, never the patient record', () => {
    const text = buildNarrative(pd({ callerName: ans('Real Caller'), patientName: ans('Stale Patient') }))
    expect(text).toContain("CALLER'S NAME: Real Caller")
    expect(text).not.toContain('Stale Patient')
  })

  it('contains no medical-only labels or EMS data', () => {
    const text = buildNarrative(pd({ patientAge: ans('40'), sex: ans('Male'), consciousStatus: ans('Yes'), breathingStatus: ans('Yes'), patientCount: ans('3'), callerRelationship: ans('Self'), location: ans('Elm St'), personsInvolved: ans('Two men') }))
    expect(text).not.toMatch(/PATIENT|HURT\/SICK|CONSCIOUS|BREATHING|RELATIONSHIP|Elm St|Two men|40|Male/)
  })

  it('updates when the caller name or phone is edited', () => {
    const a = pd({ callerPhone: ans('111'), callerName: ans('First') })
    const b = { ...a, fields: { ...a.fields, callerName: { state: 'answered' as const, value: 'Second' }, callerPhone: { state: 'answered' as const, value: '222' } } }
    expect(buildNarrative(a)).toContain("CALLER'S NAME: First")
    expect(buildNarrative(b)).toContain("CALLER'S NAME: Second")
    expect(buildNarrative(b)).toContain('PHONE NUMBER: 222')
  })

  it('FD uses the same caller-report template as PD', () => {
    expect(buildNarrative(make('FD', { callerName: ans('F'), callerPhone: ans('1'), description: ans('smoke') }))).toBe("PHONE NUMBER: 1\nCALLER'S NAME: F\nCALLER'S PROBLEM DESCRIPTION: smoke\nEMERGENCY INSTRUCTIONS GIVEN: NONE GIVEN")
  })
})

describe('emergency instructions and the pre-arrival section', () => {
  const given = (value: string) => ({ instructionsGiven: { state: 'answered' as const, value } })
  it('lists the titles of the instructions given, and nothing else when none were', () => {
    expect(buildNarrative(ems(given('cpr, choking')))).toContain('EMERGENCY INSTRUCTIONS GIVEN: CPR instructions (adult or child); Choking instructions (adult or child, Heimlich)')
    expect(buildNarrative(ems())).not.toContain('PRE-ARRIVAL INSTRUCTIONS')
    expect(buildNarrative(pd())).not.toContain('PRE-ARRIVAL INSTRUCTIONS')
  })
  it('adds a PRE-ARRIVAL INSTRUCTIONS section marking each instruction as given or not yet given', () => {
    const text = buildNarrative(ems(given('cpr')), ['cpr', 'recovery-position'])
    expect(text.split('\n').slice(-4)).toEqual(['', 'PRE-ARRIVAL INSTRUCTIONS:', 'CPR instructions (adult or child): GIVEN', 'Unresponsive but breathing: recovery position: NOT YET GIVEN'])
    expect(text.split('\n').slice(0, 9)).toHaveLength(9) // the required lines are unchanged and still come first
  })
  it('lists an instruction that was given even if no question recommended it, and one recommended but not yet given', () => {
    expect(buildNarrative(pd(given('pd-stay-safe')))).toContain('PRE-ARRIVAL INSTRUCTIONS:\nStay safe until officers arrive: GIVEN')
    expect(buildNarrative(pd(), ['pd-stay-safe'])).toContain('Stay safe until officers arrive: NOT YET GIVEN')
    expect(buildNarrative(pd(), ['pd-stay-safe'])).toContain('EMERGENCY INSTRUCTIONS GIVEN: NONE GIVEN')
  })
  it('never lists the same instruction twice', () => {
    expect(buildNarrative(ems(given('cpr')), ['cpr']).match(/CPR instructions \(adult or child\): GIVEN/g)).toHaveLength(1)
  })
})

describe('buildNotes', () => {
  it('returns null when empty and trimmed text otherwise', () => {
    expect(buildNotes(ems())).toBeNull()
    expect(buildNotes(ems({ notes: ans('  hello ') }))).toBe('hello')
  })
})
