import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { launch } from '@/test/harness'
import { newCall, pickNature } from '@/test/flow'
import { memoryDb } from '@/test/memoryDb'
import { loadSession } from '@/persistence/incidents'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'

vi.mock('@/app/files', () => ({ saveTextFile: vi.fn(async () => '/tmp/x') }))

describe('chief complaint picker', () => {
  it('is searchable, grouped, keyboard operable, and shows which entries have a workflow', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    const list = await screen.findByRole('listbox', { name: 'EMS natures of call' })
    expect(within(list).getByRole('group', { name: 'Psychiatric & behavioral' })).toBeInTheDocument()
    expect(within(list).getByRole('group', { name: 'Abdominal & digestive' })).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: /Fixture medical complaint.*AWAITING VALIDATION/ })).toBeInTheDocument()
    await user.keyboard('abdom')
    expect(within(list).getAllByRole('group')).toHaveLength(1)
    expect(within(list).getByRole('option', { name: 'Abdominal pain' })).toBeInTheDocument()
    await user.keyboard('{Control>}a{/Control}{Backspace}zzzz')
    expect(within(list).getByText(/No EMS nature of call matches/)).toBeInTheDocument()
  })

  it('with no imported workflow, the call goes straight into the workbook tree for its chief complaint', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'abdominal pain')
    expect(useCase.getState().incident?.fields.complaint.value).toBe('Abdominal pain')
    expect(useCase.getState().session?.workflowId).toBe('ems-abdominal')
    expect(await screen.findByRole('heading', { name: 'Is the patient awake and responding to you?' })).toBeInTheDocument()
    expect((await screen.findAllByText(/ROLEPLAY TRAINING CONTENT/)).length).toBeGreaterThan(0)
  })
})

describe('complaint to workflow', () => {
  it('starts the workflow mapped to the chief complaint immediately, in the same workspace', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'fixture medical')
    expect((await screen.findAllByText('AWAITING VALIDATION — not authorized for operational use')).length).toBeGreaterThan(0)
    expect(useCase.getState().session?.workflowId).toBe('fixture-conditional')
    expect(screen.getByRole('heading', { name: /\[PLACEHOLDER\] Entry question/ })).toBeInTheDocument()
    await user.keyboard('2') // Scenario B
    expect(await screen.findByRole('heading', { name: /Scenario B/ })).toBeInTheDocument()
    await user.keyboard('1')
    await user.keyboard('1') // shared confirmation: Yes -> conditional terminal for B
    expect(await screen.findByText(/reached via Scenario B/, { selector: 'p' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Case summary/ }))
    expect(await within(screen.getByRole('complementary', { name: 'Case summary' })).findByText('Fixture medical complaint')).toBeInTheDocument()
  })

  it('uses the PD workflow mapped to a police chief complaint', async () => {
    const { user } = await launch()
    await newCall(user, 'PD')
    await pickNature(user, 'PD', 'fixture police')
    expect(useCase.getState().session?.workflowId).toBe('fixture-branching')
    expect(await screen.findByRole('heading', { name: /indoors or outdoors/ })).toBeInTheDocument()
  })

  it('every type gets its workbook tree: its own for a major complaint, the general one otherwise', async () => {
    const { user } = await launch()
    await newCall(user, 'PD')
    await pickNature(user, 'PD', 'welfare check') // no tree of its own: the type's general tree
    expect(useCase.getState().session?.workflowId).toBe('pd-general')
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'burns')
    expect(useCase.getState().session?.workflowId).toBe('ems-burns')
  })

  it('records unknown and unavailable as different answers and persists both', async () => {
    const { db, user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'fixture medical')
    await screen.findByRole('radiogroup')
    await user.keyboard('0')
    expect(useCase.getState().session?.answers.entry?.kind).toBe('unknown')
    expect(await screen.findByRole('heading', { name: /scenario could not be established/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Back/ }))
    await user.click(screen.getByRole('radio', { name: /Unavailable/ }))
    expect(useCase.getState().session?.answers.entry?.kind).toBe('unavailable')
    expect(await screen.findByText(/entry question unavailable; nothing assumed/, { selector: 'p' })).toBeInTheDocument()
    await useCase.getState().flush()
    expect((await loadSession(db, useCase.getState().incident!.id))?.answers.entry?.kind).toBe('unavailable')
  })

  it('discards workflow answers when the chief complaint is corrected', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'fixture medical')
    await screen.findByRole('radiogroup')
    await user.keyboard('1')
    expect(Object.keys(useCase.getState().session!.answers)).toEqual(['entry'])
    // correct the chief complaint from the history list
    await user.click(within(screen.getByRole('navigation', { name: 'Call history' })).getByRole('button', { name: /Fixture medical complaint/ }))
    await pickNature(user, 'EMS', 'burns')
    expect(useCase.getState().incident?.fields.complaint.value).toBe('Burns')
    expect(useCase.getState().session?.workflowId).toBe('ems-burns') // the old answers were discarded; the right tree started
    expect(Object.keys(useCase.getState().session!.answers)).toEqual([])
  })

  it('resumes an interrupted workflow session at the right question after restart', async () => {
    const db = memoryDb()
    const first = await launch(db)
    await newCall(first.user, 'EMS')
    await pickNature(first.user, 'EMS', 'fixture medical')
    await screen.findByRole('radiogroup')
    await first.user.keyboard('1')
    await useCase.getState().flush()
    await launch(db, { fixtures: false })
    await waitFor(() => expect(useCase.getState().session?.answers.entry).toMatchObject({ kind: 'option', optionId: 'scenario-a' }))
    expect(await screen.findByRole('heading', { name: /Scenario A/ })).toBeInTheDocument()
  })
})

describe('catalogue import', () => {
  it('adds valid natures of call as awaiting validation, reports bad rows, and survives restart', async () => {
    const db = memoryDb()
    const { user } = await launch(db)
    await user.keyboard('{Meta>}4{/Meta}')
    const file = new File(['service,group,label,workflow_id\nEMS,Cardiac & circulatory,Odd chest sensation,\nXX,G,Bad,\nPD,Disorder,Welfare check,\n'], 'cat.csv')
    await user.upload(await screen.findByLabelText(/Catalogue file/), file)
    expect(await screen.findByText(/1 valid entry ready to add; 2 row\(s\) with errors/)).toBeInTheDocument()
    expect(screen.getByText(/Row 3: Service "XX"/)).toBeInTheDocument()
    expect(screen.getByText(/Row 4: "Welfare check" already exists/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add 1 entries' }))
    await waitFor(() => expect(useApp.getState().catalogue.some((e) => e.label === 'Odd chest sensation' && e.status === 'pending-validation')).toBe(true))

    await launch(db, { fixtures: false }) // restart: nothing re-installed
    expect(useApp.getState().catalogue.some((e) => e.label === 'Odd chest sensation')).toBe(true)
  })

  it('rejects a catalogue file with missing columns', async () => {
    const { user } = await launch()
    await user.keyboard('{Meta>}4{/Meta}')
    await user.upload(await screen.findByLabelText(/Catalogue file/), new File(['name\nx\n'], 'bad.csv'))
    expect(await screen.findByText('Missing required column "service"')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add \d/ })).toBeDisabled()
  })
})
