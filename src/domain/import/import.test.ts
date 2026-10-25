import writeXlsxFile from 'write-excel-file/node'
import { describe, expect, it } from 'vitest'
import { parseCsv, tableFromGrid } from './table'
import { readTable } from './file'
import { buildWorkflow, suggestMapping, TEMPLATE_CSV, type Mapping } from './workflow'
import { buildCatalogue } from './catalogue'

const tableOf = (csv: string) => tableFromGrid(parseCsv(csv))
const build = (csv: string, over: Partial<{ start: string }> = {}, mapping?: Mapping) => {
  const t = tableOf(csv)
  return buildWorkflow(t, mapping ?? suggestMapping(t.headers), { id: 'imp', name: 'Imp', start: over.start ?? 'q1' })
}

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas/newlines, CRLF and BOM', () => {
    expect(parseCsv('﻿a,"b,1","c ""q""\nline"\r\nx,y,z\n')).toEqual([['a', 'b,1', 'c "q"\nline'], ['x', 'y', 'z']])
  })
  it('rejects an unterminated quote', () => expect(() => parseCsv('a,"b')).toThrow(/unterminated/))
})

describe('tableFromGrid', () => {
  it('uses the first non-empty row as headers and reports real line numbers', () => {
    const t = tableFromGrid([[], ['A', 'B'], ['1', '2'], [], ['3', '']])
    expect(t.headers).toEqual(['A', 'B'])
    expect(t.rows.map((r) => r.line)).toEqual([3, 5])
  })
  it('rejects empty input', () => expect(() => tableFromGrid([[], ['', '']])).toThrow(/no data/))
})

describe('buildWorkflow', () => {
  it('imports the shipped template with the suggested mapping', () => {
    const r = build(TEMPLATE_CSV)
    expect(r.rowErrors).toEqual([])
    expect(r.issues).toEqual([])
    expect(r.definition?.nodes).toHaveLength(6)
    expect(r.definition?.nodes.find((n) => n.id === 'q1')).toMatchObject({ unknownNext: 't-unclear', options: [{ label: 'Yes', next: 'q2' }, { label: 'No', next: 't-none' }] })
  })

  it('requires every required column to be mapped', () => {
    const t = tableOf(TEMPLATE_CSV)
    const m = suggestMapping(t.headers)
    delete m.next
    const r = buildWorkflow(t, m, { id: 'a', name: 'a', start: 'q1' })
    expect(r.definition).toBeNull()
    expect(r.issues[0]?.message).toMatch(/Next node/)
  })

  it('maps differently-named columns only when the user chooses them', () => {
    const csv = 'A,B,C,D,E\nq1,question,Hi?,Yes,t1\nt1,terminal,Done,,\n'
    const t = tableOf(csv)
    expect(suggestMapping(t.headers)).toEqual({})
    const r = buildWorkflow(t, { nodeId: 0, type: 1, prompt: 2, optionLabel: 3, next: 4 }, { id: 'a', name: 'a', start: 'q1' })
    expect(r.definition?.start).toBe('q1')
  })

  it('reports row-level errors with spreadsheet line numbers and builds nothing', () => {
    const csv = `node_id,type,prompt,option_label,next_node
q1,question,Q one,Yes,t1
q1,question,Q different,No,t1
q1,maybe,Q one,No,t1
,question,x,y,z
q2,question,Q two,,t1
t1,terminal,Done,stray,
`
    const r = build(csv)
    expect(r.definition).toBeNull()
    expect(r.rowErrors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7])
    expect(r.rowErrors[0]?.message).toMatch(/differs from row 2/)
  })

  it('rejects a node used as both question and terminal, and repeated options', () => {
    const csv = `node_id,type,prompt,option_label,next_node
q1,question,Q,Yes,t1
q1,question,Q,yes,t1
t1,terminal,Done,,
t1,question,Q,Yes,t1
`
    const r = build(csv)
    expect(r.rowErrors.map((e) => e.message).join('|')).toMatch(/repeated.*|but a question here/)
    expect(r.rowErrors).toHaveLength(2)
  })

  it('surfaces graph problems (missing target, unreachable, bad start) as issues', () => {
    const csv = `node_id,type,prompt,option_label,next_node
q1,question,Q,Yes,ghost
t1,terminal,Done,,
`
    const codes = build(csv).issues.map((i) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['missing-target', 'unreachable']))
    expect(build(csv, { start: 'zzz' }).issues.map((i) => i.code)).toContain('missing-start')
  })
})

describe('readTable', () => {
  it('reads CSV files', async () => {
    const t = await readTable(new File([TEMPLATE_CSV], 'wf.csv'))
    expect(t.headers[0]).toBe('node_id')
  })

  it('reads .xlsx files', async () => {
    const data = [['node_id', 'type', 'prompt', 'option_label', 'next_node'], ['q1', 'question', 'Q?', 'Yes', 't1'], ['t1', 'terminal', 'Done', null, null]]
    const buf = await writeXlsxFile(data.map((r) => r.map((v) => (v === null ? { value: '' } : { value: v })))).toBuffer()
    const t = await readTable(new File([new Uint8Array(buf)], 'wf.xlsx'))
    expect(t.rows).toHaveLength(2)
    expect(buildWorkflow(t, suggestMapping(t.headers), { id: 'x', name: 'x', start: 'q1' }).definition).not.toBeNull()
  })

  it('rejects unsupported and oversized files', async () => {
    await expect(readTable(new File(['x'], 'a.txt'))).rejects.toThrow(/Unsupported/)
    await expect(readTable(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.csv'))).rejects.toThrow(/5 MB/)
  })
})

describe('provenance and traceability', () => {
  it('records service, status, source file, worksheet, row range and per-node source rows', () => {
    const t = tableOf(TEMPLATE_CSV)
    const r = buildWorkflow(t, suggestMapping(t.headers), {
      id: 'p', name: 'p', start: 'q1', service: 'EMS', category: 'Cat', status: 'pending-validation', sheet: 'VALIDATION',
      provenance: { origin: 'user-import', sourceFile: 'book.xlsx', worksheet: 'VALIDATION' },
    })
    expect(r.definition).toMatchObject({ service: 'EMS', category: 'Cat', status: 'pending-validation', provenance: { sourceFile: 'book.xlsx', worksheet: 'VALIDATION', rows: '2-9' } })
    expect(r.definition?.nodes.find((n) => n.id === 'q2')).toMatchObject({ sourceRef: 'VALIDATION!4' })
  })

  it('refuses to produce a verified workflow without attested provenance', () => {
    const t = tableOf(TEMPLATE_CSV)
    const r = buildWorkflow(t, suggestMapping(t.headers), { id: 'v', name: 'v', start: 'q1', status: 'verified-source', provenance: { origin: 'user-import' } })
    expect(r.definition).toBeNull()
    expect(r.issues.map((i) => i.code)).toContain('provenance')
  })

  it('picks the VALIDATION worksheet of an .xlsx automatically', async () => {
    const hdr = ['node_id', 'type', 'prompt', 'option_label', 'next_node'].map((value) => ({ value }))
    const rows = [[{ value: 'q1' }, { value: 'question' }, { value: 'Q?' }, { value: 'Yes' }, { value: 't1' }], [{ value: 't1' }, { value: 'terminal' }, { value: 'Done' }, { value: '' }, { value: '' }]]
    const buf = await writeXlsxFile([
      { sheet: 'Notes', data: [[{ value: 'nothing here' }]] },
      { sheet: 'VALIDATION', data: [hdr, ...rows] },
    ]).toBuffer()
    const t = await readTable(new File([new Uint8Array(buf)], 'book.xlsx'))
    expect(t.sheet).toBe('VALIDATION')
    expect(t.sheets).toEqual(['Notes', 'VALIDATION'])
    expect(t.rows).toHaveLength(2)
  })
})

describe('catalogue import', () => {
  const existing = [{ id: 'e1', service: 'PD' as const, group: 'G', label: 'Welfare check', status: 'pending-validation' as const }]
  const wfs = new Map<string, 'EMS' | 'PD' | 'FD' | undefined>([['wf-pd', 'PD'], ['wf-fd', 'FD']])
  const run = (csv: string) => buildCatalogue(tableOf(csv), existing, wfs)

  it('adds valid rows as pending-validation', () => {
    const r = run('service,group,label,workflow_id\nems,Cardiac,Odd chest complaint,\nPD,Disorder,Loud party,wf-pd\n')
    expect(r.rowErrors).toEqual([])
    expect(r.entries.map((e) => [e.service, e.label, e.status, e.workflowId])).toEqual([['EMS', 'Odd chest complaint', 'pending-validation', undefined], ['PD', 'Loud party', 'pending-validation', 'wf-pd']])
  })

  it('reports row errors for bad service, duplicates, and wrong or missing workflows', () => {
    const r = run('service,group,label,workflow_id\nXX,G,A,\nPD,G,welfare CHECK,\nPD,G,B,nope\nPD,G,C,wf-fd\nPD,G,,\nPD,G,D,\nPD,G,d,\n')
    expect(r.rowErrors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 8])
    expect(r.entries.map((e) => e.label)).toEqual(['D'])
  })

  it('does not guess columns: required headers must be present', () => {
    expect(run('Category,Name\nA,B\n').issues).toEqual(['Missing required column "service"', 'Missing required column "group"', 'Missing required column "label"'])
  })
})

describe('validation columns', () => {
  const csv = (rows: string) => `node_id,type,prompt,option_label,next_node,unknown_next,unavailable_next,not_asked_next,mandatory,field\n${rows}`
  const ok = csv(
    [
      'q1,question,First?,Yes,q2,q2,q2,,yes,',
      'q1,question,First?,No,q2,q2,q2,,yes,',
      'q2,question,Sex?,Female,t,,,t,no,sex',
      'q2,question,Sex?,Male,t,,,t,no,sex',
      't,terminal,Done,,,,,,,',
    ].join('\n') + '\n',
  )

  it('imports routes for every response, mandatory flags and narrative field mapping', () => {
    const t = tableOf(ok)
    const r = buildWorkflow(t, suggestMapping(t.headers), { id: 'v', name: 'v', start: 'q1', service: 'EMS' })
    expect(r.rowErrors).toEqual([])
    expect(r.issues).toEqual([])
    expect(r.definition?.nodes.find((n) => n.id === 'q1')).toMatchObject({ unknownNext: 'q2', unavailableNext: 'q2', mandatory: true })
    expect(r.definition?.nodes.find((n) => n.id === 'q2')).toMatchObject({ notAskedNext: 't', mandatory: false, field: 'sex' })
  })

  it('reports an optional question with no skip route, instead of inventing one', () => {
    const t = tableOf(csv('q1,question,Q?,Yes,t,,,,no,\nt,terminal,Done,,,,,,,\n'))
    const r = buildWorkflow(t, suggestMapping(t.headers), { id: 'v', name: 'v', start: 'q1' })
    expect(r.definition).toBeNull()
    expect(r.issues.map((i) => i.code)).toContain('optional-unskippable')
  })

  it('reports a skippable mandatory question, a bad mandatory value and an unknown field as row errors or issues', () => {
    let t = tableOf(csv('q1,question,Q?,Yes,t,,,t,yes,\nt,terminal,Done,,,,,,,\n'))
    expect(buildWorkflow(t, suggestMapping(t.headers), { id: 'v', name: 'v', start: 'q1' }).issues.map((i) => i.code)).toContain('mandatory-skippable')
    t = tableOf(csv('q1,question,Q?,Yes,t,,,,maybe,\nt,terminal,Done,,,,,,,\n'))
    expect(buildWorkflow(t, suggestMapping(t.headers), { id: 'v', name: 'v', start: 'q1' }).rowErrors[0]?.message).toMatch(/must be yes or no/)
    t = tableOf(csv('q1,question,Q?,Yes,t,,,,yes,favourite_colour\nt,terminal,Done,,,,,,,\n'))
    expect(buildWorkflow(t, suggestMapping(t.headers), { id: 'v', name: 'v', start: 'q1' }).rowErrors[0]?.message).toMatch(/not an incident field/)
  })

  it('reports a field that does not exist for the service', () => {
    const t = tableOf(csv('q1,question,Q?,Yes,t,,,,yes,patientAge\nt,terminal,Done,,,,,,,\n'))
    expect(buildWorkflow(t, suggestMapping(t.headers), { id: 'v', name: 'v', start: 'q1', service: 'PD' }).issues.map((i) => i.code)).toContain('bad-field')
  })
})

describe('typed-answer (input) rows', () => {
  const csv = `node_id,type,prompt,option_label,next_node,unknown_next,format,field,mandatory,not_asked_next
q1,input,How many are hurt?,,t,t,integer,patientCount,,
q2,input,Name?,,t,,text,patientName,no,t
t,terminal,Done,,,,,,,
`
  it('imports input questions with their format, field and routes', () => {
    const t = tableOf(csv.replace('q2,input,Name?,,t,,text,patientName,no,t\n', ''))
    const r = buildWorkflow(t, suggestMapping(t.headers), { id: 'i', name: 'i', start: 'q1', service: 'EMS' })
    expect(r.rowErrors).toEqual([])
    expect(r.issues).toEqual([])
    expect(r.definition?.nodes[0]).toMatchObject({ kind: 'question', options: [], input: { format: 'integer' }, next: 't', field: 'patientCount', unknownNext: 't' })
  })
  it('imports an optional input question only with a skip route', () => {
    const t = tableOf(csv.replace('q1,input,How many are hurt?,,t,t,integer,patientCount,,\n', 'q1,input,How many are hurt?,,q2,,integer,patientCount,,\n'))
    expect(buildWorkflow(t, suggestMapping(t.headers), { id: 'i', name: 'i', start: 'q1', service: 'EMS' }).issues).toEqual([])
  })
  it('reports incomplete or contradictory input rows instead of guessing', () => {
    const bad = (row: string) => buildWorkflow(tableOf(`node_id,type,prompt,option_label,next_node,unknown_next,format,field\n${row}\nt,terminal,Done,,,,,\n`), suggestMapping(['node_id', 'type', 'prompt', 'option_label', 'next_node', 'unknown_next', 'format', 'field']), { id: 'i', name: 'i', start: 'q1' }).rowErrors[0]?.message
    expect(bad('q1,input,Q?,,t,,integer,')).toMatch(/needs a next node and the incident field/)
    expect(bad('q1,input,Q?,,,,integer,patientCount')).toMatch(/needs a next node/)
    expect(bad('q1,input,Q?,Yes,t,,integer,patientCount')).toMatch(/must not have an option label/)
    expect(bad('q1,input,Q?,,t,,float,patientCount')).toMatch(/must be text or integer/)
  })
})
