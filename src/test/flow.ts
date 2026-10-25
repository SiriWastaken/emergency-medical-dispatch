import { screen } from '@testing-library/react'
import type { launch } from '@/test/harness'
import type { IncidentType } from '@/types/incident'

type User = Awaited<ReturnType<typeof launch>>['user']

export const LOCATION = '1 Main Street'
export const PHONE = '555-0100'
export const HAPPENING = 'Something is happening'

/** Starts a call of a type and answers location, callback number and what is happening, leaving the chief-complaint prompt. */
export async function newCall(user: User, type: IncidentType) {
  await user.click(screen.getByRole('button', { name: `New 911 → ${type}` }))
  await user.type(await screen.findByRole('textbox', { name: 'Where is the emergency? Give me the address or location.' }), `${LOCATION}{Enter}`)
  await user.type(await screen.findByRole('textbox', { name: 'What phone number are you calling from?' }), `${PHONE}{Enter}`)
  await user.type(await screen.findByRole('textbox', { name: 'Tell me exactly what is happening.' }), `${HAPPENING}{Enter}`)
  await screen.findByRole('combobox', { name: `Nature of the call (${type})` })
}

export const pickNature = async (user: User, type: IncidentType, text: string) =>
  user.type(await screen.findByRole('combobox', { name: `Nature of the call (${type})` }), `${text}{Enter}`)

/** A new EMS call that starts the rich fixture workflow. */
export async function startRich(user: User) {
  await newCall(user, 'EMS')
  await pickNature(user, 'EMS', 'fixture rich')
  await screen.findByRole('heading', { name: 'First question (required)?' })
}
