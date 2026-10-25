import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkLibrary } from '@/domain/library'
import { findEntry, groupedEntries, workflowFor } from '@/domain/library/select'
import { validateWorkflow } from '@/domain/workflow-engine/validate'
import { BRANCHING, CONDITIONAL, FIXTURE_CATALOGUE } from '@/test/fixtures'
import { SERVICES } from '@/types/incident'
import { LIBRARY } from './library'

const dir = join(__dirname, 'workflows')
const files = SERVICES.flatMap((s) => readdirSync(join(dir, s.toLowerCase())).filter((f) => f.endsWith('.json')).map((f) => ({ path: `${s.toLowerCase()}/${f}`, data: JSON.parse(readFileSync(join(dir, s.toLowerCase(), f), 'utf8')) as unknown })))
const catalogue = JSON.parse(readFileSync(join(dir, 'catalogue.json'), 'utf8')) as unknown

describe('bundled library', () => {
  it('loads with no validation issues, entirely from bundled data (offline)', () => {
    expect(LIBRARY.issues).toEqual([])
    expect(LIBRARY.workflows.length).toBe(files.length)
    const real = globalThis.fetch
    globalThis.fetch = (() => { throw new Error('network used') }) as typeof fetch
    try {
      expect(checkLibrary({ workflows: files, catalogue }).issues).toEqual([])
    } finally {
      globalThis.fetch = real
    }
  })

  it('ships no demo or sample workflows, and no workflow that is not verified or pending review', () => {
    expect(JSON.stringify(LIBRARY)).not.toMatch(/demo|sample|fictional/i)
    for (const w of LIBRARY.workflows) expect(['verified-source', 'pending-validation']).toContain(w.status)
  })

  it('catalogue entries carry plain labels and never a clinical code or workflow link to nothing', () => {
    expect(LIBRARY.catalogue.every((e) => !/\b\d{1,2}-?[A-Z]-?\d{1,2}\b/.test(e.label))).toBe(true)
    expect(LIBRARY.catalogue.every((e) => e.status === 'pending-validation' && !e.workflowId)).toBe(true)
  })
})

describe('complaint catalogues', () => {
  const labels = (s: (typeof SERVICES)[number]) => groupedEntries(LIBRARY.catalogue, s).flatMap((g) => g.entries.map((e) => e.label))

  it('contain the required EMS, PD and FD categories', () => {
    expect(labels('EMS')).toEqual(expect.arrayContaining(['Cardiac arrest / unresponsive person', 'Chest pain or cardiac symptoms', 'Breathing difficulty', 'Abdominal pain', 'Seizure or convulsions', 'Stroke-like symptoms', 'Allergic reaction', 'Overdose or poisoning', 'Burns', 'Diabetic emergency', 'Psychiatric or behavioral crisis', 'Other medical complaint']))
    expect(labels('PD')).toEqual(expect.arrayContaining(['Suspicious activity', 'Theft or shoplifting', 'Assault or reported violence', 'Domestic disturbance', 'Break and enter', 'Missing person', 'Traffic collision', 'Welfare check', 'Other police complaint']))
    expect(labels('FD')).toEqual(expect.arrayContaining(['Structure fire', 'Vehicle fire', 'Brush or grass fire', 'Smoke or burning smell', 'Fire alarm activation', 'Carbon monoxide alarm', 'Hazardous-material concern', 'Rescue or trapped person', 'Electrical hazard', 'Other fire-service incident']))
  })

  it('keep the three services separate', () => {
    const [ems, pd, fd] = (['EMS', 'PD', 'FD'] as const).map(labels)
    expect(ems!.filter((l) => pd!.includes(l) || fd!.includes(l))).toEqual([])
    expect(pd!.filter((l) => fd!.includes(l))).toEqual([])
  })

  it('are grouped and searchable by label or group', () => {
    expect(groupedEntries(LIBRARY.catalogue, 'EMS').length).toBeGreaterThan(8)
    expect(groupedEntries(LIBRARY.catalogue, 'EMS', 'ABDOMINAL').flatMap((g) => g.entries.map((e) => e.label))).toContain('Abdominal pain')
    expect(groupedEntries(LIBRARY.catalogue, 'FD', 'zzzz')).toEqual([])
  })

  it('map complaints to workflows of the same service, only when one exists and is not disabled', () => {
    const all = [...LIBRARY.catalogue, ...FIXTURE_CATALOGUE]
    const wf = (s: 'EMS' | 'PD' | 'FD', l: string) => workflowFor(findEntry(all, s, l), [BRANCHING, CONDITIONAL])?.id
    expect(wf('EMS', 'Fixture medical complaint')).toBe(CONDITIONAL.id)
    expect(wf('PD', 'Fixture police complaint')).toBe(BRANCHING.id)
    expect(wf('EMS', 'Burns')).toBeUndefined()
    expect(workflowFor(findEntry(all, 'EMS', 'Fixture medical complaint'), [{ ...CONDITIONAL, status: 'disabled' }])).toBeUndefined()
    expect(groupedEntries([{ ...LIBRARY.catalogue[0]!, status: 'disabled' }], LIBRARY.catalogue[0]!.service)).toEqual([])
  })
})

describe('checkLibrary rejects bad data', () => {
  const good = { ...BRANCHING, provenance: { origin: 'user-import' as const } }
  const run = (mutate: (f: { path: string; data: unknown }[], c: { entries: Record<string, unknown>[] }) => void) => {
    const f = [{ path: 'pd/x.json', data: structuredClone(good) as unknown }]
    const c = structuredClone(catalogue) as { entries: Record<string, unknown>[] }
    mutate(f, c)
    return checkLibrary({ workflows: f, catalogue: c }).issues.join('\n')
  }

  it('accepts a well-formed workflow', () => expect(run(() => {})).toBe(''))
  it('workflow in the wrong service folder', () => expect(run((f) => { f[0]!.path = 'fd/x.json' })).toMatch(/folder/))
  it('missing provenance', () => expect(run((f) => { delete (f[0]!.data as Record<string, unknown>).provenance })).toMatch(/need service, category, status and provenance/))
  it('catalogue pointing at a missing workflow', () => expect(run((_f, c) => { c.entries[0]!.workflowId = 'nope' })).toMatch(/missing workflow/))
  it('catalogue pointing at another service’s workflow', () => expect(run((_f, c) => { c.entries.find((e) => e.service === 'EMS')!.workflowId = good.id })).toMatch(/PD workflow/))
  it('duplicate catalogue entries', () => expect(run((_f, c) => { c.entries.push({ ...c.entries[0]! }) })).toMatch(/duplicate/))
  it('stale index', () => expect(checkLibrary({ workflows: files, catalogue, index: { schemaVersion: 1, workflows: [{ id: 'x', service: 'PD', category: 'c', status: 'pending-validation', origin: 'user-import', path: 'pd/x.json' }], counts: { total: 1, byStatus: {}, byService: {} } } }).issues.join()).toMatch(/out of date/))
})

describe('provenance and status enforcement', () => {
  const issues = (w: unknown) => { const r = validateWorkflow(w); return r.ok ? '' : r.issues.map((i) => i.message).join('\n') }
  const attested = { origin: 'authorized-source', source: 'Authorized source', sourceFile: 'f.xlsx', worksheet: 'VALIDATION', verifiedBy: 'Reviewer', verifiedAt: '2026-01-01' }

  it('verified-source needs authorized-source origin plus source, file, worksheet and verifier', () => {
    expect(issues({ ...BRANCHING, status: 'verified-source' })).toMatch(/authorized-source/)
    expect(issues({ ...BRANCHING, status: 'verified-source', provenance: { origin: 'authorized-source' } })).toMatch(/missing provenance: source, sourceFile, worksheet, verifiedBy, verifiedAt/)
    expect(issues({ ...BRANCHING, status: 'verified-source', provenance: { ...attested, origin: 'user-import' } })).toMatch(/authorized-source/)
    expect(issues({ ...BRANCHING, status: 'verified-source', provenance: attested })).toBe('')
  })

  it('there is no demo status or origin any more', () => {
    expect(issues({ ...BRANCHING, status: 'demo' })).toMatch(/status/)
    expect(issues({ ...BRANCHING, provenance: { origin: 'original-demo' } })).toMatch(/provenance/)
  })

  it('pending-validation is never upgraded by validation', () => {
    const r = validateWorkflow(BRANCHING)
    expect(r.ok && r.definition.status).toBe('pending-validation')
  })
})
