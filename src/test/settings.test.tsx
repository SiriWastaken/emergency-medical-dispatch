import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CALL_TAKING } from '@/data/call-taking'
import { FIXTURE_WORKFLOWS } from '@/test/fixtures'
import { launch } from '@/test/harness'
import { TEMPLATE_CSV } from '@/domain/import/workflow'
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

const csvFile = (text: string, name = 'My Flow.csv') => new File([text], name, { type: 'text/csv' })

async function openSettings(user: Awaited<ReturnType<typeof launch>>['user']) {
  await user.keyboard('{Meta>}4{/Meta}')
  await screen.findByRole('heading', { name: 'Import workflow from spreadsheet' })
}

describe('spreadsheet import wizard', () => {
  it('previews, requires an explicit start node, and imports only after confirmation', async () => {
    const { user } = await launch()
    await openSettings(user)
    await user.upload(screen.getByLabelText(/Spreadsheet/), csvFile(TEMPLATE_CSV))
    expect(await screen.findByText(/Detected columns · My Flow.csv · 8 data row/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Node ID/)).toHaveValue('0') // suggested, visible, editable
    const importBtn = screen.getByRole('button', { name: 'Import workflow' })
    expect(importBtn).toBeDisabled() // start node not chosen yet
    await user.selectOptions(screen.getByLabelText(/Start node/), 'q1')
    expect(screen.getByText(/Workflow preview · 6 nodes · starts at q1/)).toBeInTheDocument()
    expect(useApp.getState().workflows).toHaveLength(FIXTURE_WORKFLOWS.length + CALL_TAKING.workflows.length) // nothing imported yet
    await user.click(importBtn)
    await waitFor(() => expect(useApp.getState().workflows.map((w) => w.definition.id)).toContain('my-flow'))
  })

  it('shows row-level errors and blocks the import', async () => {
    const { user } = await launch()
    await openSettings(user)
    const bad = 'node_id,type,prompt,option_label,next_node\nq1,question,Q,Yes,t1\nq1,bogus,Q,No,t1\nt1,terminal,Done,,\n'
    await user.upload(screen.getByLabelText(/Spreadsheet/), csvFile(bad, 'bad.csv'))
    await user.selectOptions(await screen.findByLabelText(/Start node/), 'q1')
    expect(await screen.findByText(/Row 3: Row type "bogus"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import workflow' })).toBeDisabled()
  })

  it('rejects unsupported files visibly', async () => {
    const { user } = await launch()
    await openSettings(user)
    await user.upload(screen.getByLabelText(/Spreadsheet/), new File(['x'], 'notes.txt'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Unsupported file type/)
  })

  it('never replaces an existing workflow without an explicit confirmation', async () => {
    const { user } = await launch()
    await openSettings(user)
    const doImport = async () => {
      await user.upload(screen.getByLabelText(/Spreadsheet/), csvFile(TEMPLATE_CSV, 'dup.csv'))
      await user.selectOptions(await screen.findByLabelText(/Start node/), 'q1')
    }
    await doImport()
    await user.click(screen.getByRole('button', { name: 'Import workflow' }))
    await waitFor(() => expect(useApp.getState().workflows).toHaveLength(FIXTURE_WORKFLOWS.length + CALL_TAKING.workflows.length + 1))
    await doImport()
    expect(screen.getByRole('button', { name: 'Import workflow' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /already exists/ }))
    expect(screen.getByRole('button', { name: 'Import workflow' })).toBeEnabled()
  })
})

describe('backup and restore', () => {
  it('exports a backup, validates a restore file, and replaces data only on confirmation', async () => {
    const { db, user } = await launch()
    await user.click(screen.getByRole('button', { name: 'New 911 → PD' }))
    await user.type(await screen.findByRole('textbox', { name: 'Where is the emergency? Give me the address or location.' }), 'Before Backup')
    const keptId = useCase.getState().incident!.id
    await openSettings(user)
    await user.click(screen.getByRole('button', { name: /Export backup/ }))
    await waitFor(() => expect(saved.at(-1)?.name).toMatch(/^emergency-medical-dispatch-backup-\d{4}-\d{2}-\d{2}\.json$/))
    const backupText = saved.at(-1)!.text

    await user.click(screen.getByRole('button', { name: 'New 911 → EMS' }))
    const laterId = useCase.getState().incident!.id
    await openSettings(user)

    // invalid file is rejected and changes nothing
    await user.upload(screen.getByLabelText('Restore from backup file'), new File(['{"nope":1}'], 'bad.json'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Not a valid backup/)
    expect(await loadIncident(db, laterId)).not.toBeNull()

    await user.upload(screen.getByLabelText('Restore from backup file'), new File([backupText], 'ok.json'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm restore' })
    expect(within(dialog).getByText(/1 incident\(s\)/)).toBeInTheDocument()
    expect(await loadIncident(db, laterId)).not.toBeNull() // not yet
    await user.click(within(dialog).getByRole('button', { name: /Replace current data/ }))
    await waitFor(async () => expect(await loadIncident(db, laterId)).toBeNull())
    expect((await loadIncident(db, keptId))?.fields.location.value).toBe('Before Backup')
  })
})
