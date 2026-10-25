import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '@/app/App'
import { memoryDb } from '@/test/memoryDb'
import { FIXTURE_CATALOGUE, FIXTURE_WORKFLOWS } from '@/test/fixtures'
import type { Db } from '@/persistence/db'
import { migrate } from '@/persistence/migrate'
import { saveCatalogueExtra, saveWorkflow } from '@/persistence/settings'
import { setDb } from '@/stores/db'
import { useApp } from '@/stores/app'
import { useCase } from '@/stores/case'

/**
 * Fresh stores around a database, as if the app had just launched. Pass a db to simulate a restart.
 * `fixtures: true` (default for a new db) installs test workflows and natures of call that start them,
 * the way a user would after importing; `false` leaves the database as a fresh install.
 */
export async function launch(db: Db = memoryDb(), { fixtures = true }: { fixtures?: boolean } = {}) {
  cleanup()
  useApp.setState(useApp.getInitialState(), true)
  useCase.setState(useCase.getInitialState(), true)
  setDb(db)
  if (fixtures) {
    await migrate(db)
    for (const w of FIXTURE_WORKFLOWS) await saveWorkflow(db, w, true)
    await saveCatalogueExtra(db, FIXTURE_CATALOGUE)
  }
  const user = userEvent.setup({ applyAccept: false })
  render(<App />)
  await screen.findByRole('navigation', { name: 'Sections' })
  return { db, user }
}
