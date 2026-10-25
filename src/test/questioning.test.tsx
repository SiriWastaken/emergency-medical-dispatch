import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { launch } from '@/test/harness'
import { newCall, pickNature, startRich } from '@/test/flow'
import { memoryDb } from '@/test/memoryDb'
import { loadIncident, loadSession } from '@/persistence/incidents'
import type { Db } from '@/persistence/db'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'

vi.mock('@/app/files', () => ({ saveTextFile: vi.fn(async () => '/tmp/x') }))

const answers = () => useCase.getState().session?.answers ?? {}
const heading = (name: string | RegExp) => screen.findByRole('heading', { name })
const narrative = () => screen.getByTestId('narrative').textContent ?? ''

describe('guided questioning console', () => {
  it('shows one question at a time with its answers, required marker, progress and history', async () => {
    const { user } = await launch()
    await startRich(user)
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Questions answered' })).toHaveAttribute('aria-valuenow', '0')
    const group = screen.getByRole('radiogroup')
    expect(within(group).getAllByRole('radio').map((r) => r.textContent?.replace(/\d$/, ''))).toEqual(['Answer A', 'Answer B', 'Answer C', 'Unknown (caller does not know)', 'Unavailable (cannot be answered right now)'])
    expect(within(group).queryByRole('radio', { name: /Not asked/ })).not.toBeInTheDocument() // mandatory: cannot be skipped
    expect(screen.queryByText('Sex of the patient?')).not.toBeInTheDocument() // later questions are not shown
    expect(within(screen.getByRole('navigation', { name: 'Call history' })).getByText(/First question/)).toBeInTheDocument()
  })

  it('selecting an answer immediately moves to the next applicable question and hides ones that do not apply', async () => {
    const { user } = await launch()
    await startRich(user)
    await user.keyboard('2') // Answer B: the extra question only applies after A
    expect(await heading('Sex of the patient?')).toBeInTheDocument()
    expect(answers().q1).toMatchObject({ kind: 'option', optionId: 'b' })
    const rail = screen.getByRole('navigation', { name: 'Call history' })
    expect(within(rail).getByText(/Skipped \(not applicable\): Extra question/)).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument() // mandatory because the answer was B
    expect(screen.queryByRole('radio', { name: /Not asked/ })).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Questions answered' })).toHaveAttribute('aria-valuenow', '50')
  })

  it('offers "Not asked" only on questions that may be skipped, and explains an option that is not allowed', async () => {
    const { user } = await launch()
    await startRich(user)
    await user.keyboard('3') // Answer C -> sex question is optional and forbids "Other"
    await heading('Sex of the patient?')
    expect(screen.getByText('Optional')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Not asked/ })).toBeInTheDocument()
    const other = screen.getByRole('radio', { name: /Other/ })
    expect(other).toHaveAttribute('aria-disabled', 'true')
    expect(within(other).getByText('Not available: Other is not allowed after Answer C.')).toBeInTheDocument()
    await user.click(other)
    expect(answers().q3).toBeUndefined() // nothing recorded
    await user.click(screen.getByRole('radio', { name: /Not asked/ }))
    expect(answers().q3).toMatchObject({ kind: 'not_asked' })
    expect(useCase.getState().incident?.fields.sex.state).toBe('not_asked') // distinct from unknown and unanswered
  })

  it('records unknown and unavailable distinctly, and 0 chooses unknown only where it is permitted', async () => {
    const { user } = await launch()
    await startRich(user)
    await user.keyboard('0')
    expect(answers().q1).toMatchObject({ kind: 'unknown' })
    await heading('Sex of the patient?')
    await user.click(screen.getByRole('button', { name: /Back/ }))
    await user.click(screen.getByRole('radio', { name: /Unavailable/ }))
    expect(answers().q1).toMatchObject({ kind: 'unavailable' })
    await heading('Sex of the patient?')
    await user.keyboard('0') // sex question defines no unknown route: ignored, nothing invented
    expect(answers().q3).toBeUndefined()
  })

  it('Back keeps answers; changing an earlier answer discards what no longer applies and recomputes the path', async () => {
    const { user } = await launch()
    await startRich(user)
    await user.keyboard('1') // A
    await heading(/Extra question/)
    await user.keyboard('1') // X
    await heading('Sex of the patient?')
    await user.keyboard('1') // Female
    await heading('Optional closing question?')
    await user.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByRole('radio', { name: /Female/ })).toBeChecked() // answer preserved
    await user.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByRole('radio', { name: /^X/ })).toBeChecked()

    await user.click(within(screen.getByRole('navigation', { name: 'Call history' })).getByRole('button', { name: /First question/ }))
    expect(screen.getByRole('radio', { name: /Answer A/ })).toBeChecked()
    await user.keyboard('2') // switch to B: the extra question no longer applies
    expect(screen.getByText(/Path changed: 1 later answer\(s\) were discarded/)).toBeInTheDocument()
    expect(answers().q2).toBeUndefined()
    expect(answers().q3).toMatchObject({ optionId: 'f' }) // still on the path, so still valid
    expect(await heading('Sex of the patient?')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Female/ })).toBeChecked()
  })

  it('Continue moves forward through answered questions; it is not offered past an unanswered one', async () => {
    const { user } = await launch()
    await startRich(user)
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
    await user.keyboard('2')
    await heading('Sex of the patient?')
    await user.click(screen.getByRole('button', { name: /Back/ }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await heading('Sex of the patient?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it('clearly marks the endpoint, and completion follows the rules, not the last screen', async () => {
    const { user } = await launch()
    await startRich(user)
    useCase.getState().setField('callerPhone', { state: 'unanswered', value: '' }) // a required field the call-taker never addressed
    await user.keyboard('2')
    await user.keyboard('1') // Female
    await user.keyboard('1') // optional closing: Yes
    expect(await screen.findByText('Endpoint reached', { selector: 'p.label' })).toBeInTheDocument()
    expect(screen.getByText('All done.')).toBeInTheDocument()
    // The last screen was reached, but the required phone number was never recorded.
    expect(screen.getByText('Not complete: required information is still missing.')).toBeInTheDocument()
    expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0)
    expect(screen.getByText(/Required information not yet recorded: callerPhone/)).toBeInTheDocument()
    useCase.getState().setField('callerPhone', { state: 'answered', value: '555-0100' })
    expect(await screen.findByText('Validation passed: this workflow is complete.')).toBeInTheDocument()
    expect(screen.getAllByText('Complete').length).toBeGreaterThan(0)
    // Changing an earlier answer so a new question opens revalidates automatically.
    await user.click(within(screen.getByRole('navigation', { name: 'Call history' })).getByRole('button', { name: /First question/ }))
    await user.keyboard('1') // A -> the extra question applies and is unanswered
    expect(await heading(/Extra question/)).toBeInTheDocument()
    expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0)
  })

  it('shows the full question and answer history on a review screen', async () => {
    const { user } = await launch()
    await startRich(user)
    await user.keyboard('2')
    await user.keyboard('1')
    await user.click(screen.getByRole('button', { name: /Review answers/ }))
    const list = await screen.findByRole('list', { name: 'Questions and answers' })
    expect(within(list).getByText('First question (required)?')).toBeInTheDocument()
    expect(within(list).getByText('Answer B')).toBeInTheDocument()
    expect(within(list).getByText('Female')).toBeInTheDocument()
    expect(within(list).getByText('Optional closing question?').parentElement).toHaveTextContent('NOT YET ASKED')
    expect(screen.getByText(/Did not apply/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Return to questions/ }))
    expect(await heading('Optional closing question?')).toBeInTheDocument()
  })
})

describe('one continuous workspace', () => {
  it('goes from case entry straight into the questions, one prompt at a time, with nothing else to fill in', async () => {
    const { user } = await launch()
    await user.click(screen.getByRole('button', { name: 'New 911 → EMS' }))
    const prompts = ['Where is the emergency? Give me the address or location.', 'What phone number are you calling from?', 'Tell me exactly what is happening.']
    // Case entry: a single focused prompt each time; never the whole form.
    for (const [i, name] of prompts.entries()) {
      expect(await screen.findByRole('textbox', { name })).toBeInTheDocument()
      expect(screen.getAllByRole('textbox')).toHaveLength(1)
      await user.keyboard(`${['1 A St', '555-0123', 'Something'][i]}{Enter}`)
    }
    expect(await screen.findByRole('combobox', { name: 'Nature of the call (EMS)' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Call stages' })).getByText(/1\. Case entry/).closest('li')).toHaveAttribute('aria-current', 'step')
    await user.keyboard('fixture rich{Enter}')
    // Same screen, no navigation: the first key question appears at once.
    expect(await heading('First question (required)?')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Call stages' })).getByText(/2\. Key questions/).closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1)
    expect(screen.queryByText('Sex of the patient?')).not.toBeInTheDocument() // no upcoming questions listed
  })

  it('Back from the first key question returns to case entry; a corrected entry value returns to where the call was', async () => {
    const { user } = await launch()
    await startRich(user)
    await user.keyboard('2') // B -> the sex question
    await heading('Sex of the patient?')
    const nav = screen.getByRole('navigation', { name: 'Call history' })
    await user.click(within(nav).getByRole('button', { name: /555-0100/ })) // fix an earlier value
    const phone = await screen.findByRole('textbox', { name: 'What phone number are you calling from?' })
    expect(phone).toHaveValue('555-0100')
    await user.clear(phone)
    await user.type(phone, '555-0777{Enter}')
    expect(await heading('Sex of the patient?')).toBeInTheDocument() // straight back, answers intact
    expect(answers().q1).toMatchObject({ optionId: 'b' })
    expect(useCase.getState().incident?.fields.callerPhone.value).toBe('555-0777')
    await user.click(screen.getByRole('button', { name: /Back/ }))
    await user.click(screen.getByRole('button', { name: /Back/ }))
    expect(await screen.findByRole('combobox', { name: 'Nature of the call (EMS)' })).toBeInTheDocument()
  })

  it('keeps the case summary beside the active question without replacing it', async () => {
    const { user } = await launch()
    await startRich(user)
    await user.click(screen.getByRole('button', { name: /Case summary/ }))
    const panel = screen.getByRole('complementary', { name: 'Case summary' })
    expect(within(panel).getByText('Fixture rich complaint')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'First question (required)?' })).toBeInTheDocument()
    await user.type(within(panel).getByRole('textbox', { name: 'Additional notes' }), 'note')
    expect(useCase.getState().incident?.fields.notes.value).toBe('note')
    await user.click(screen.getByRole('button', { name: 'Close case summary' }))
    expect(screen.queryByRole('complementary', { name: 'Case summary' })).not.toBeInTheDocument()
  })
})

describe('narrative and incident synchronization', () => {
  it('the CALL NARRATIVE follows the answers and reverts when the path discards them', async () => {
    const { user } = await launch()
    await startRich(user)
    await user.keyboard('2')
    await user.keyboard('2') // Male
    await user.keyboard('{Meta>}3{/Meta}')
    expect(await screen.findByText('CALL NARRATIVE', { selector: 'div' })).toBeInTheDocument()
    expect(narrative()).toContain('PATIENT(S) SEX IS: Male')
    await user.keyboard('{Meta>}2{/Meta}')
    await user.click(within(await screen.findByRole('navigation', { name: 'Call history' })).getByRole('button', { name: /First question/ }))
    await user.keyboard('1') // A -> the extra question opens; the sex answer is off the path
    await heading(/Extra question/)
    await user.keyboard('{Meta>}3{/Meta}')
    await waitFor(() => expect(narrative()).toContain('PATIENT(S) SEX IS: NOT YET RECORDED'))
  })

  it('a field edited by hand after the workflow filled it is not clobbered when the answer is later discarded', async () => {
    const { user } = await launch()
    await startRich(user)
    await user.keyboard('2')
    await user.keyboard('1') // Female
    useCase.getState().setField('sex', { state: 'answered', value: 'Typed by operator' })
    await user.click(within(screen.getByRole('navigation', { name: 'Call history' })).getByRole('button', { name: /First question/ }))
    await user.keyboard('1')
    await heading(/Extra question/)
    expect(useCase.getState().incident?.fields.sex.value).toBe('Typed by operator')
  })
})

describe('persistence and restore', () => {
  it('restores the active question and answers after a restart, and keeps them across tabs', async () => {
    const db = memoryDb()
    const first = await launch(db)
    await startRich(first.user)
    await first.user.keyboard('2')
    await first.user.keyboard('{Meta>}3{/Meta}') // leave the questions...
    await screen.findByText('CALL NARRATIVE', { selector: 'div' })
    await first.user.keyboard('{Meta>}2{/Meta}') // ...and come back
    expect(await heading('Sex of the patient?')).toBeInTheDocument()
    expect(answers().q1).toMatchObject({ optionId: 'b' })
    await useCase.getState().flush()

    await launch(db, { fixtures: false })
    await waitFor(() => expect(answers().q1).toMatchObject({ optionId: 'b' }))
    expect(await heading('Sex of the patient?')).toBeInTheDocument() // the open question, not the first one
    const rail = screen.getByRole('navigation', { name: 'Call history' })
    expect(within(rail).getByText('Answer B')).toBeInTheDocument()
  })

  it('a delayed older write can never restore an earlier answer', async () => {
    const base = memoryDb()
    const slow: Db = { ...base, select: base.select, backup: base.backup, batch: async (s) => { await new Promise((r) => setTimeout(r, 120)); return base.batch(s) } }
    const { user } = await launch(slow)
    await startRich(user)
    await user.keyboard('1') // A ...
    await user.keyboard('{Meta>}2{/Meta}')
    await user.click(within(await screen.findByRole('navigation', { name: 'Call history' })).getByRole('button', { name: /First question/ }))
    await user.keyboard('3') // ... immediately changed to C while the first save may still be in flight
    await useCase.getState().flush()
    await waitFor(() => expect(useCase.getState().saveState).toBe('saved'), { timeout: 4000 })
    const id = useCase.getState().incident!.id
    expect((await loadSession(base, id))?.answers.q1).toMatchObject({ optionId: 'c' })
    expect((await loadIncident(base, id))?.fields.sex.state).toBe('unanswered')
  })

  it('saves answers together with the fields they fill, so a restored narrative is consistent', async () => {
    const db = memoryDb()
    const { user } = await launch(db)
    await startRich(user)
    await user.keyboard('2')
    await user.keyboard('3') // Other
    await useCase.getState().flush()
    const id = useCase.getState().incident!.id
    expect((await loadSession(db, id))?.answers.q3).toMatchObject({ optionId: 'o' })
    expect((await loadIncident(db, id))?.fields.sex).toEqual({ state: 'answered', value: 'Other' })
  })
})

describe('separate EMS and PD workflows', () => {
  it('each type starts, and may be offered, only its own question sets', async () => {
    const { user } = await launch()
    await newCall(user, 'PD')
    await pickNature(user, 'PD', 'welfare check')
    expect(useCase.getState().session?.workflowId).toBe('pd-general')
    expect(await heading('Is anyone in immediate danger or being hurt?')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /patient|conscious|breathing/i })).not.toBeInTheDocument() // no medical questions for police
    useCase.getState().resetWorkflow() // no question set started: the call-taker may choose one
    const names = async () => within(await screen.findByLabelText('Workflow')).getAllByRole('option').map((o) => o.textContent ?? '')
    const pd = await names()
    expect(pd).toContain('Fixture: branching')
    expect(pd).toContain('PD: assault or reported violence')
    expect(pd.some((n) => /^EMS|^FD/.test(n) || /Fixture: (conditional|rich|typed|instruction)/.test(n))).toBe(false)

    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'burns')
    expect(useCase.getState().session?.workflowId).toBe('ems-burns')
    useCase.getState().resetWorkflow()
    const ems = await names()
    expect(ems).toEqual(expect.arrayContaining(['EMS: burns', 'EMS: chest pain or cardiac symptoms', 'Fixture: conditional', 'Fixture: rich rules']))
    expect(ems.some((n) => /^PD|^FD/.test(n) || n === 'Fixture: branching')).toBe(false)
  })

  it('typed answers are asked one at a time in the same workspace, checked by the rules, and fill the narrative', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'fixture typed')
    const textbox = (name: string) => screen.findByRole('textbox', { name })
    expect(await heading('How many people are affected?')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1) // only the current question
    await user.type(await textbox('How many people are affected?'), 'abc{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent(/whole number/)
    expect(fieldsOf().patientCount.state).toBe('unanswered') // nothing invented, nothing stored
    await user.clear(screen.getByRole('textbox', { name: 'How many people are affected?' }))
    await user.type(screen.getByRole('textbox', { name: 'How many people are affected?' }), '2{Enter}')
    await user.type(await textbox('How old is the patient (in years)?'), '200{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an age from 0 to 120.')
    await user.clear(screen.getByRole('textbox', { name: 'How old is the patient (in years)?' }))
    await user.click(screen.getByRole('button', { name: 'Unknown' })) // permitted here; recorded as unknown, not as a number
    expect(fieldsOf().patientAge.state).toBe('unknown')
    await heading('Who is the patient? (optional)')
    await user.click(screen.getByRole('button', { name: 'Not asked' }))
    expect(await screen.findByText('Validation passed: this workflow is complete.')).toBeInTheDocument()
    await user.keyboard('{Meta>}3{/Meta}')
    await screen.findByText('CALL NARRATIVE', { selector: 'div' })
    expect(narrative()).toContain('NUMBER OF HURT/SICK: 2')
    expect(narrative()).toContain('PATIENT(S) AGE IS: UNKNOWN')
    expect(fieldsOf().patientName.state).toBe('not_asked') // the name was offered, never forced, and "not asked" is not "unknown"
  })

  it('a PD call never sees the EMS question sets or medical prompts', async () => {
    const { user } = await launch()
    await newCall(user, 'PD')
    await pickNature(user, 'PD', 'welfare check')
    expect(screen.queryByRole('heading', { name: /patient|conscious|breathing/i })).not.toBeInTheDocument()
    await user.keyboard('{Meta>}3{/Meta}')
    await screen.findByText('CALL NARRATIVE', { selector: 'div' })
    expect(narrative().split('\n')).toHaveLength(4)
  })

  it('malformed workflow definitions are rejected with the reason and never started', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    const bad = { ...useApp.getState().workflows.find((w) => w.definition.id === 'fixture-rich')!.definition, start: 'nope' }
    useApp.setState({ workflows: [...useApp.getState().workflows.filter((w) => w.definition.id !== 'fixture-rich'), { definition: bad, builtin: false }] })
    useCase.getState().startWorkflow('fixture-rich')
    useCase.getState().setStep(4)
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be run|not available|invalid/i)
  })
})

const fieldsOf = () => useCase.getState().incident!.fields
