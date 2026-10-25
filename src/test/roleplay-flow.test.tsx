import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { launch } from '@/test/harness'
import { newCall, pickNature } from '@/test/flow'
import { useCase } from '@/stores/case'

vi.mock('@/app/files', () => ({ saveTextFile: vi.fn(async () => '/tmp/x') }))

const heading = (name: string | RegExp) => screen.findByRole('heading', { name })
const narrative = () => screen.getByTestId('narrative').textContent ?? ''

describe('roleplay scenarios, played through the real screens', () => {
  it('EMS cardiac arrest: after two questions the call-taker has the CPR script to read', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'cardiac arrest')
    expect(await heading('Is the patient awake and responding to you?')).toBeInTheDocument()
    await user.keyboard('2') // No
    expect(await heading('Is the patient breathing?')).toBeInTheDocument()
    await user.keyboard('3') // No
    expect((await screen.findAllByText(/Priority 1: Immediate\. Possible cardiac arrest/)).length).toBeGreaterThan(0)
    const cpr = screen.getByRole('region', { name: 'CPR instructions (adult or child)' })
    expect(within(cpr).getByText(/ROLEPLAY TRAINING SCRIPT/)).toBeInTheDocument()
    expect(within(cpr).getByText(/center of the chest/)).toBeInTheDocument()
    await user.click(within(cpr).getByRole('checkbox', { name: /Given to the caller/ }))
    await user.keyboard('{Meta>}3{/Meta}')
    await screen.findByText('CALL NARRATIVE', { selector: 'div' })
    expect(narrative()).toContain('PATIENT(S) CONSCIOUS STATUS: No')
    expect(narrative()).toContain('PATIENT(S) BREATHING STATUS: No')
    expect(narrative()).toContain('EMERGENCY INSTRUCTIONS GIVEN: CPR instructions (adult or child)')
    expect(narrative()).toContain('PRE-ARRIVAL INSTRUCTIONS:\nCPR instructions (adult or child): GIVEN')
  })

  it('EMS chest pain: the common questions, then the chest-pain questions, a priority outcome, and a complete narrative', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'chest pain')
    await heading('Is the patient awake and responding to you?')
    await user.keyboard('1') // awake
    await user.keyboard('1') // breathing normally
    await user.type(await screen.findByRole('textbox', { name: 'How many people are hurt or sick?' }), '1{Enter}')
    await user.type(await screen.findByRole('textbox', { name: /How old is the patient/ }), '58{Enter}')
    await heading('Is the patient male or female?')
    await user.keyboard('1') // male
    await heading('What is your relationship to the patient?')
    await user.keyboard('2') // family member
    await heading('Is the patient having chest pain or pressure right now?')
    await user.keyboard('1')
    await heading('Is the pain spreading to the arm, jaw, neck or back?')
    await user.keyboard('1')
    expect(await screen.findByText(/^Priority 1: Immediate\. Send the highest-priority medical response/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Chest pain care' })).toBeInTheDocument()
    expect(await screen.findByText('Validation passed: this workflow is complete.')).toBeInTheDocument()
    await user.keyboard('{Meta>}3{/Meta}')
    await screen.findByText('CALL NARRATIVE', { selector: 'div' })
    expect(narrative().split('\n').slice(0, 9)).toEqual([
      'PHONE NUMBER: 555-0100',
      "CALLER'S PROBLEM DESCRIPTION IS: Chest pain or cardiac symptoms - Something is happening",
      "CALLER'S RELATIONSHIP TO PATIENT: Family member",
      'NUMBER OF HURT/SICK: 1',
      'PATIENT(S) AGE IS: 58 YEARS',
      'PATIENT(S) SEX IS: Male',
      'PATIENT(S) CONSCIOUS STATUS: Yes',
      'PATIENT(S) BREATHING STATUS: Yes, normally',
      'EMERGENCY INSTRUCTIONS GIVEN: NONE GIVEN',
    ])
    // The chest-pain script was recommended at the endpoint but not ticked as given: the narrative says so.
    expect(narrative()).toContain('PRE-ARRIVAL INSTRUCTIONS:')
    expect(narrative()).toContain('Chest pain care: NOT YET GIVEN')
    expect(useCase.getState().incident!.fields.patientName.state).toBe('unanswered') // the patient's name was never demanded
  })

  it('EMS choking: a baby gets the infant script and an older patient the Heimlich script', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'choking')
    await heading('Can the patient cough, speak or cry?')
    await user.keyboard('2') // No
    await heading('Is the patient a baby under one year old?')
    await user.keyboard('1') // Yes
    expect(await screen.findByRole('region', { name: 'Choking instructions (baby under one year)' })).toBeInTheDocument()
    expect(screen.getByText(/back blows/)).toBeInTheDocument()
  })

  it('PD domestic disturbance: weapons and injuries drive the priority, and officers get the stay-safe script', async () => {
    const { user } = await launch()
    await newCall(user, 'PD')
    await pickNature(user, 'PD', 'domestic')
    await heading('Is anyone being hurt right now?')
    await user.keyboard('2') // No
    await heading('Is anyone threatening to hurt someone, or is there a weapon in the home?')
    await user.keyboard('1') // Yes
    expect(await screen.findByText(/^Priority 1: Officers needed immediately/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Stay safe until officers arrive' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /patient|breathing|conscious/i })).not.toBeInTheDocument()
    await user.keyboard('{Meta>}3{/Meta}')
    await screen.findByText('CALL NARRATIVE', { selector: 'div' })
    expect(narrative().split('\n')).toEqual(['PHONE NUMBER: 555-0100', "CALLER'S NAME: NOT YET RECORDED", "CALLER'S PROBLEM DESCRIPTION: Domestic disturbance - Something is happening", 'EMERGENCY INSTRUCTIONS GIVEN: NONE GIVEN', '', 'PRE-ARRIVAL INSTRUCTIONS:', 'Stay safe until officers arrive: NOT YET GIVEN'])
  })

  it('PD suspect descriptions are typed answers kept with the call', async () => {
    const { user } = await launch()
    await newCall(user, 'PD')
    await pickNature(user, 'PD', 'theft')
    await heading('Is the thief still there or in sight?')
    await user.keyboard('1') // Yes
    await user.type(await screen.findByRole('textbox', { name: 'Describe the person: height, build, clothing, hair.' }), 'Tall, red jacket{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Which way are they going, and on foot or in a vehicle?' }), 'North on foot{Enter}')
    expect(await screen.findByText(/^Priority 2: Urgent/)).toBeInTheDocument()
    expect(useCase.getState().incident!.fields.personsInvolved).toMatchObject({ state: 'answered', value: 'Tall, red jacket' })
  })

  it('FD gas leak: a sick occupant is Priority 1 with the get-out script', async () => {
    const { user } = await launch()
    await newCall(user, 'FD')
    await pickNature(user, 'FD', 'gas leak')
    await heading('Do you smell gas inside a building?')
    await user.keyboard('1')
    await heading('Is anyone dizzy, sick, or feeling faint?')
    await user.keyboard('1')
    expect(await screen.findByText(/^Priority 1: Respond immediately/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Gas leak: get out' })).toBeInTheDocument()
  })

  it('a complaint with no tree of its own falls back to the general questions for that type', async () => {
    const { user } = await launch()
    await newCall(user, 'EMS')
    await pickNature(user, 'EMS', 'dehydration')
    await heading('Is the patient awake and responding to you?')
    expect(useCase.getState().session?.workflowId).toBe('ems-general')
  })
})
