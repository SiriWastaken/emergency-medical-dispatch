import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryDb } from '@/test/memoryDb'
import { launch } from '@/test/harness'
import { HAPPENING, LOCATION, newCall, PHONE, pickNature } from '@/test/flow'
import { CALL_TAKING } from '@/data/call-taking'
import type { Db } from '@/persistence/db'
import { loadIncident } from '@/persistence/incidents'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'

const saved: { name: string; text: string }[] = []
vi.mock('@/app/files', () => ({
  saveTextFile: vi.fn(async (name: string, text: string) => {
    saved.push({ name, text })
    return `/tmp/${name}`
  }),
}))

beforeEach(() => {
  saved.length = 0
})

type User = Awaited<ReturnType<typeof launch>>['user']
const narrative = () => screen.getByTestId('narrative').textContent ?? ''
const fields = () => useCase.getState().incident!.fields
const P = { location: 'Where is the emergency? Give me the address or location.', phone: 'What phone number are you calling from?', happening: 'Tell me exactly what is happening.' }
const textbox = (name: string) => screen.findByRole('textbox', { name })
const startOnly = async (user: User, type: 'EMS' | 'PD' | 'FD') => {
  await user.click(screen.getByRole('button', { name: `New 911 → ${type}` }))
  await textbox(P.location)
}
const heading = (name: string | RegExp) => screen.findByRole('heading', { name })
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('fresh installation', () => {
  it('has an empty queue and no incidents or sessions in the database', async () => {
    const { db } = await launch(memoryDb(), { fixtures: false })
    expect(screen.getByText(/The queue is empty/)).toBeInTheDocument()
    expect(useApp.getState().incidents).toEqual([])
    // Only the workbook's question trees exist (configuration, not data): no sessions or sample cases.
    expect(useApp.getState().workflows.map((w) => w.definition.id).sort()).toEqual(CALL_TAKING.workflows.map((w) => w.id).sort())
    expect(useApp.getState().workflows.every((w) => w.builtin)).toBe(true)
    for (const t of ['incidents', 'incident_fields', 'workflow_sessions']) expect((await db.select(`SELECT COUNT(*) AS n FROM ${t}`))[0]?.n).toBe(0)
    expect(screen.queryByText(/demo|sample|training/i)).not.toBeInTheDocument()
  })
})

describe('case entry: exactly the workbook sequence, one prompt at a time', () => {
  it('"New 911" first asks for the incident type, then the location', async () => {
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'New 911' }))
    expect(await heading('Select the incident type.')).toBeInTheDocument()
    expect(within(screen.getByRole('radiogroup')).getAllByRole('radio').map((r) => r.textContent?.replace(/\d$/, ''))).toEqual(['EMS: medical', 'PD: police', 'FD: fire'])
    expect(useCase.getState().incident).toBeNull() // nothing is created until a type is chosen
    await user.keyboard('2') // PD
    expect(await textbox(P.location)).toBeInTheDocument()
    expect(useCase.getState().incident?.type).toBe('PD')
  })

  it.each(['EMS', 'PD', 'FD'] as const)('%s: location, callback number, what is happening, chief complaint, then the question tree', async (type) => {
    const { user } = await launch()
    await startOnly(user, type)
    const sequence = [P.location, P.phone, P.happening]
    const only = (name: string) => {
      // exactly one input on screen: this prompt
      expect(screen.getAllByRole('textbox')).toHaveLength(1)
      expect(screen.getByRole('textbox', { name })).toBeInTheDocument()
      expect(screen.queryByText(/name/i, { selector: 'h2' })).not.toBeInTheDocument()
    }
    for (const [i, prompt] of sequence.entries()) {
      only(prompt)
      expect(screen.getByRole('heading', { name: prompt })).toBeInTheDocument()
      await user.type(screen.getByRole('textbox', { name: prompt }), `${['1 A Street', '555-0199', 'A thing happened'][i]}{Enter}`)
      if (i < 2) await textbox(sequence[i + 1]!)
    }
    expect(await heading('Select the chief complaint.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument() // the chief complaint is chosen from the list
    expect(useCase.getState().session).toBeNull() // the tree starts only once the complaint is chosen
    await pickNature(user, type, type === 'EMS' ? 'abdominal pain' : type === 'PD' ? 'welfare check' : 'structure fire')
    expect(useCase.getState().session?.workflowId).toBe({ EMS: 'ems-abdominal', PD: 'pd-general', FD: 'fd-structure' }[type])
    expect(screen.queryByRole('textbox', { name: /name/i })).not.toBeInTheDocument()
  })

  it('the stage bar and history follow along into the key questions', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    const stages = screen.getByRole('list', { name: 'Call stages' })
    expect(within(stages).getByText(/1\. Case entry/).closest('li')).toHaveAttribute('aria-current', 'step')
    await pickNature(user, 'EMS', 'chest pain')
    expect(within(stages).getByText(/2\. Key questions/).closest('li')).toHaveAttribute('aria-current', 'step')
    expect(await heading('Is the patient awake and responding to you?')).toBeInTheDocument()
    expect((await screen.findAllByText(/ROLEPLAY TRAINING CONTENT/)).length).toBeGreaterThan(0)
    const history = screen.getByRole('navigation', { name: 'Call history' })
    expect(within(history).getByText(LOCATION)).toBeInTheDocument()
    expect(within(history).getByText(PHONE)).toBeInTheDocument()
  })

  it('applies the workbook’s validation rules, with its messages', async () => {
    const { user } = await launch()
    await startOnly(user, 'PD')
    await user.keyboard('{Enter}') // required, empty
    expect(await screen.findByRole('alert')).toHaveTextContent('The location of the emergency is required. If it is not known, mark it Unknown.')
    await user.type(screen.getByRole('textbox'), 'Corner of A and B{Enter}')
    await user.type(await textbox(P.phone), 'call me{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Use digits, spaces and + ( ) - . only (3 to 30 characters).')
    expect(screen.getByRole('textbox', { name: P.phone })).toBeInTheDocument() // did not advance
    await user.clear(screen.getByRole('textbox', { name: P.phone }))
    await user.click(screen.getByRole('button', { name: 'Unknown' })) // a deliberate non-answer is accepted
    expect(fields().callerPhone.state).toBe('unknown')
    expect(await textbox(P.happening)).toBeInTheDocument()
  })

  it('never asks for caller or patient names anywhere in the automatic flow, for any type', async () => {
    const { user } = await launch()
    for (const type of ['EMS', 'PD', 'FD'] as const) {
      await newCall(user, type)
      await pickNature(user, type, 'other')
      const seen = [...screen.queryAllByRole('textbox'), ...screen.queryAllByRole('heading')].map((e) => e.getAttribute('aria-label') ?? e.textContent ?? '')
      expect(seen.join(' | ')).not.toMatch(/\b(caller|patient)('s)? name\b|\bwhat is your name\b/i)
      expect(fields().callerName.state).toBe('unanswered')
      expect(fields().patientName.state).toBe('unanswered')
    }
  })
})

describe('call narratives', () => {
  it('PD: three lines from the workbook; the caller name is never asked, only recorded if the call-taker chooses', async () => {
    const { user } = await launch()
    await newCall(user, 'PD')
    await pickNature(user, 'PD', 'public disturbance')
    await user.keyboard('{Meta>}3{/Meta}')
    expect(await screen.findByText('CALL NARRATIVE', { selector: 'div' })).toBeInTheDocument()
    expect(narrative().split('\n')).toEqual([`PHONE NUMBER: ${PHONE}`, "CALLER'S NAME: NOT YET RECORDED", `CALLER'S PROBLEM DESCRIPTION: Public disturbance - ${HAPPENING}`, 'EMERGENCY INSTRUCTIONS GIVEN: NONE GIVEN'])
    await user.keyboard('{Meta>}2{/Meta}')
    await user.click(await screen.findByRole('button', { name: /Case summary/ }))
    const panel = screen.getByRole('complementary', { name: 'Case summary' })
    await user.type(within(panel).getByLabelText('Caller name'), 'Alex Caller')
    await user.keyboard('{Meta>}3{/Meta}')
    await waitFor(() => expect(narrative()).toContain("CALLER'S NAME: Alex Caller"))
    expect(narrative()).toContain(`PHONE NUMBER: ${PHONE}`)
    expect(fields().patientName.state).toBe('unanswered') // PD has no patient record at all
    expect(narrative().split('\n')).toHaveLength(4)
  })

  it('EMS: the eight lines from the workbook plus the instructions line; unanswered lines show as not recorded', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'fall')
    await user.keyboard('{Meta>}3{/Meta}')
    await screen.findByText('CALL NARRATIVE', { selector: 'div' })
    expect(narrative().split('\n')).toEqual([
      `PHONE NUMBER: ${PHONE}`,
      `CALLER'S PROBLEM DESCRIPTION IS: Fall - ${HAPPENING}`,
      "CALLER'S RELATIONSHIP TO PATIENT: NOT YET RECORDED",
      'NUMBER OF HURT/SICK: NOT YET RECORDED',
      'PATIENT(S) AGE IS: NOT YET RECORDED',
      'PATIENT(S) SEX IS: NOT YET RECORDED',
      'PATIENT(S) CONSCIOUS STATUS: NOT YET RECORDED',
      'PATIENT(S) BREATHING STATUS: NOT YET RECORDED',
      'EMERGENCY INSTRUCTIONS GIVEN: NONE GIVEN',
    ])
  })

  it('follows edits to the phone number, copies, and exports the current text', async () => {
    const { user } = await launch()
    await newCall(user, 'PD')
    await user.keyboard('{Meta>}3{/Meta}')
    await screen.findByText('CALL NARRATIVE', { selector: 'div' })
    expect(narrative()).toContain(`PHONE NUMBER: ${PHONE}`)
    await user.keyboard('{Meta>}2{/Meta}')
    await user.click(within(await screen.findByRole('navigation', { name: 'Call history' })).getByRole('button', { name: new RegExp(PHONE) }))
    const phone = await textbox(P.phone)
    await user.clear(phone)
    await user.type(phone, '555-0001{Enter}') // a corrected value returns straight to where the call was
    expect(await screen.findByRole('combobox', { name: 'Nature of the call (PD)' })).toBeInTheDocument()
    await user.keyboard('{Meta>}3{/Meta}')
    await waitFor(() => expect(narrative()).toContain('PHONE NUMBER: 555-0001'))
    expect(narrative()).not.toContain(PHONE)
    await user.click(screen.getByRole('button', { name: /Copy Narrative/ }))
    expect(await navigator.clipboard.readText()).toBe(narrative())
    await user.click(screen.getByRole('button', { name: /Save as .txt/ }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.text).toBe(narrative() + '\n')
    expect(saved[0]?.name).toMatch(/^PD-.*-narrative\.txt$/)
  })
})

describe('caller-reported vs verified', () => {
  it('marks answers caller-reported by default, lets the call-taker verify them, and shows both in the summary', async () => {
    const { user } = await launch()
    await startOnly(user, 'PD')
    await user.type(screen.getByRole('textbox'), '5 Oak Lane')
    await user.click(screen.getByRole('checkbox', { name: /Independently verified/ }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.type(await textbox(P.phone), '555-0199{Enter}')
    await user.click(screen.getByRole('button', { name: /Case summary/ }))
    const panel = screen.getByRole('complementary', { name: 'Case summary' })
    expect(within(panel).getByText('Incident location').nextElementSibling).toHaveTextContent(/5 Oak Lane\s*Verified/)
    expect(within(panel).getByText('Caller phone number').nextElementSibling).toHaveTextContent(/555-0199\s*Caller-reported/)
    expect(within(panel).queryByText(/^Patient/)).not.toBeInTheDocument() // no medical labels in a PD summary
  })

  it('EMS summary offers the patient name as an optional detail; PD offers only the caller name', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await user.click(screen.getByRole('button', { name: /Case summary/ }))
    const panel = () => screen.getByRole('complementary', { name: 'Case summary' })
    expect(within(panel()).getByLabelText('Patient name')).toBeInTheDocument()
    expect(within(panel()).getByLabelText('Caller name')).toBeInTheDocument()
    await newCall(user, 'PD')
    expect(within(panel()).getByLabelText('Caller name')).toBeInTheDocument()
    expect(within(panel()).queryByLabelText('Patient name')).not.toBeInTheDocument()
  })
})

describe('caller instructions to read out', () => {
  it('lists the scripts for the call, each marked as a roleplay training script, ready to read and log', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await user.click(screen.getByRole('button', { name: /Caller instructions/ }))
    const panel = screen.getByRole('complementary', { name: 'Caller instructions' })
    const cpr = within(panel).getByRole('region', { name: 'CPR instructions (adult or child)' })
    expect(within(cpr).getByText(/ROLEPLAY TRAINING SCRIPT/)).toBeInTheDocument()
    expect(within(cpr).getByText(/center of the chest/)).toBeInTheDocument()
    expect(within(panel).getByRole('region', { name: 'Choking instructions (adult or child, Heimlich)' })).toBeInTheDocument()
    expect(within(panel).getByRole('region', { name: 'CPR instructions (baby under one year)' })).toBeInTheDocument()
    await user.click(within(cpr).getByRole('checkbox', { name: /Given to the caller/ }))
    expect(fields().instructionsGiven).toEqual({ state: 'answered', value: 'cpr' })
    await user.click(screen.getByRole('button', { name: /Case summary/ }))
    expect(within(screen.getByRole('complementary', { name: 'Case summary' })).getByText('CPR instructions (adult or child)')).toBeInTheDocument()
    await useCase.getState().flush()
    expect((await loadIncident((await import('@/stores/db')).getDb(), useCase.getState().incident!.id))?.fields.instructionsGiven.value).toBe('cpr')
  })

  it('a script with no content is shown as CONTENT REQUIRED, offers no wording, and cannot be logged as given', async () => {
    const cpr = CALL_TAKING.instructions.find((i) => i.id === 'cpr' && i.incidentType === 'EMS')!
    const original = { ...cpr }
    Object.assign(cpr, { script: '', status: 'CONTENT REQUIRED', source: undefined })
    try {
      const { user } = await launch()
      await newCall(user, 'EMS')
      await user.click(screen.getByRole('button', { name: /Caller instructions/ }))
      const card = within(screen.getByRole('complementary', { name: 'Caller instructions' })).getByRole('region', { name: 'CPR instructions (adult or child)' })
      expect(within(card).getByText(/CONTENT REQUIRED: no authorized script has been supplied/)).toBeInTheDocument()
      expect(within(card).getByRole('checkbox', { name: /Given to the caller/ })).toBeDisabled()
      expect(within(card).queryByText('Read to the caller')).not.toBeInTheDocument()
    } finally {
      Object.assign(cpr, original)
    }
  })

  it('a workflow endpoint can present its instruction when it is reached', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'fixture instructed')
    await heading('Is an instruction needed?')
    await user.keyboard('1')
    expect(await screen.findByText('Read the instruction to the caller.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'CPR instructions (adult or child)' })).toBeInTheDocument()
  })
})

describe('switching incidents never leaks data', () => {
  it('opens each saved call with its own fields and its own type’s narrative', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    const emsId = useCase.getState().incident!.id
    await user.keyboard('{Meta>}1{/Meta}')
    await user.click(screen.getByRole('button', { name: 'New 911 → PD' }))
    await user.type(await textbox(P.location), 'B St{Enter}')
    await user.type(await textbox(P.phone), '222-2222{Enter}')
    const pdId = useCase.getState().incident!.id
    await useCase.getState().flush()

    await user.keyboard('{Meta>}1{/Meta}')
    await user.click(await within(screen.getByRole('table')).findByRole('button', { name: emsId }))
    await user.keyboard('{Meta>}3{/Meta}')
    expect((await screen.findByTestId('narrative')).textContent).toContain(`PHONE NUMBER: ${PHONE}`)
    expect(narrative().split('\n')).toHaveLength(9)
    expect(narrative()).not.toContain('222-2222')

    await user.keyboard('{Meta>}1{/Meta}')
    await user.click(await within(screen.getByRole('table')).findByRole('button', { name: pdId }))
    await user.keyboard('{Meta>}3{/Meta}')
    await waitFor(() => expect(narrative().split('\n')).toHaveLength(4))
    expect(narrative()).toContain('PHONE NUMBER: 222-2222')
    expect(narrative()).not.toContain(PHONE)
  })
})

describe('autosave and navigation', () => {
  it('does not lose an edit when navigating immediately, before the debounce fires', async () => {
    const { db, user } = await launch()
    await startOnly(user, 'PD')
    await user.type(screen.getByRole('textbox'), 'Quick Edit')
    await user.keyboard('{Meta>}1{/Meta}') // leave straight away
    const id = useApp.getState().incidents[0]!.id
    await waitFor(async () => expect((await loadIncident(db, id))?.fields.location.value).toBe('Quick Edit'))
  })

  it('keeps edits typed while an earlier save is still in flight, and never lets the older value win', async () => {
    const base = memoryDb()
    const slow: Db = { ...base, select: base.select, backup: base.backup, batch: async (s) => { await new Promise((r) => setTimeout(r, 150)); return base.batch(s) } }
    const { user } = await launch(slow)
    await startOnly(user, 'PD')
    const input = screen.getByRole('textbox', { name: P.location })
    await user.type(input, 'ab')
    await waitFor(() => expect(useCase.getState().saveState).toBe('saving'), { timeout: 2000 })
    await user.type(input, 'cd') // typed during the in-flight save
    await useCase.getState().flush()
    await waitFor(() => expect(useCase.getState().saveState).toBe('saved'), { timeout: 3000 })
    expect((await loadIncident(base, useCase.getState().incident!.id))?.fields.location.value).toBe('abcd')
  })

  it('shows a conflict when the stored record is newer, and Retry / Discard recover', async () => {
    const { db, user } = await launch()
    await startOnly(user, 'PD')
    const id = useCase.getState().incident!.id
    await db.batch([{ sql: 'UPDATE incidents SET revision = revision + 1 WHERE id = ?', params: [id] }])
    await user.type(screen.getByRole('textbox', { name: P.location }), 'Late edit')
    expect(await screen.findByText(/changed elsewhere/, undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getAllByText('Save failed').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Retry save' }))
    expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Discard unsaved changes/ }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: P.location })).toHaveValue(''))
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument()
  })
})

describe('restart recovery', () => {
  it('reopens the same call after a restart, resuming at the first prompt not yet answered', async () => {
    const db = memoryDb()
    const first = await launch(db)
    await startOnly(first.user, 'PD')
    await first.user.type(screen.getByRole('textbox'), '9 Elm{Enter}')
    await useCase.getState().flush()
    const id = useCase.getState().incident!.id

    await launch(db, { fixtures: false })
    await waitFor(() => expect(useCase.getState().incident?.id).toBe(id))
    expect(await textbox(P.phone)).toBeInTheDocument()
    expect(fields().location.value).toBe('9 Elm')
    expect(useCase.getState().incident?.type).toBe('PD')
  })

  it('does not restore anything for an empty database', async () => {
    await launch(memoryDb(), { fixtures: false })
    expect(useCase.getState().incident).toBeNull()
  })
})

describe('no hidden browser-storage cache', () => {
  it('never reads or writes localStorage / sessionStorage, and ignores planted copies of incidents', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem')
    const set = vi.spyOn(Storage.prototype, 'setItem')
    localStorage.clear()
    const { user } = await launch()
    await startOnly(user, 'PD')
    await user.type(screen.getByRole('textbox'), 'Real')
    await useCase.getState().flush()
    expect(set).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    get.mockRestore()
    set.mockRestore()

    localStorage.setItem('incidents', JSON.stringify([{ id: 'PD-FAKE', location: 'Planted' }]))
    sessionStorage.setItem('activeIncident', 'PD-FAKE')
    await launch(memoryDb(), { fixtures: false })
    expect(screen.getByText(/The queue is empty/)).toBeInTheDocument()
    expect(screen.queryByText(/Planted|PD-FAKE/)).not.toBeInTheDocument()
    localStorage.clear()
    sessionStorage.clear()
  })
})

describe('incident queue', () => {
  const seed = async (user: User) => {
    await newCall(user, 'EMS')
    await newCall(user, 'PD')
    await user.keyboard('{Meta>}1{/Meta}')
    await waitFor(() => expect(rows()).toHaveLength(2))
  }

  it('lists both types with a badge, filters by type, status and search, newest first', async () => {
    const { user } = await launch()
    await seed(user)
    expect(within(rows()[0]!).getByText('PD')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Type'), 'EMS')
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(within(rows()[0]!).getByText('EMS')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Type'), 'all')
    await user.type(screen.getByLabelText('Search'), HAPPENING.toLowerCase().slice(0, 9))
    await waitFor(() => expect(rows()).toHaveLength(2)) // the description is searchable
    await user.clear(screen.getByLabelText('Search'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Closed')
    await waitFor(() => expect(screen.getByText(/No incidents match/)).toBeInTheDocument())
  })

  it('refreshes after the status changes, and reopens a closed call', async () => {
    const { user } = await launch()
    await seed(user)
    const pdRow = () => rows().find((r) => within(r).queryByText('PD'))!
    expect(within(pdRow()).getByText('Draft')).toBeInTheDocument()
    await user.click(within(pdRow()).getByRole('button', { name: /^PD-/ }))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Incident status' }), 'Closed')
    await useCase.getState().flush()
    await user.keyboard('{Meta>}1{/Meta}')
    await waitFor(() => expect(within(pdRow()).getByText('Closed')).toBeInTheDocument())
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Closed')
    await waitFor(() => expect(rows()).toHaveLength(1))
    await user.click(within(rows()[0]!).getByRole('button', { name: /^PD-/ }))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Incident status' }), 'Active')
    expect(useCase.getState().incident?.status).toBe('active')
  })
})

describe('keyboard', () => {
  it('⌘N, ⌘⇧P/E/F start calls and ⌘1..4 navigate even while typing, without losing input', async () => {
    const { user } = await launch()
    await user.keyboard('{Meta>}n{/Meta}')
    expect(await heading('Select the incident type.')).toBeInTheDocument()
    await user.keyboard('{Meta>}{Shift>}f{/Shift}{/Meta}')
    await textbox(P.location)
    expect(useCase.getState().incident?.type).toBe('FD')
    await user.type(screen.getByRole('textbox', { name: P.location }), 'Typing')
    await user.keyboard('{Meta>}3{/Meta}')
    expect(await screen.findByText('CALL NARRATIVE', { selector: 'div' })).toBeInTheDocument()
    await user.keyboard('{Meta>}2{/Meta}')
    expect(await textbox(P.location)).toHaveValue('Typing')
  })

  it('single-key shortcuts are ignored while typing in a field', async () => {
    const { user } = await launch()
    await startOnly(user, 'PD')
    await user.type(screen.getByRole('textbox', { name: P.location }), '?1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: P.location })).toHaveValue('?1')
    await user.click(document.body)
    await user.keyboard('?')
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('⌘⇧C copies the narrative from any section', async () => {
    const { user } = await launch()
    await newCall(user, 'PD')
    await user.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}')
    await waitFor(async () => expect(await navigator.clipboard.readText()).toContain(`PHONE NUMBER: ${PHONE}`))
  })
})
