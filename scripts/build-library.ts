/**
 * Validates src/data/workflows and regenerates index.json + schemas/workflow.schema.json.
 *   pnpm library:build
 *   pnpm library:import <file.xlsx|csv> --service EMS --category "..." --id ... --name ... --start NODE [--sheet VALIDATION] [--authorized]
 * Imports are always written as status "pending-validation". Promoting to "verified-source" is a
 * deliberate manual edit that must also carry attested provenance (see validateWorkflow).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import readXlsxFile from 'read-excel-file/node'
import { buildIndex, checkLibrary, type LibraryInput } from '../src/domain/library'
import { parseCsv, tableFromGrid, type Table } from '../src/domain/import/table'
import { buildWorkflow, suggestMapping } from '../src/domain/import/workflow'
import { SERVICES } from '../src/types/incident'
import { workflowSchema } from '../src/types/workflow'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../src/data/workflows')
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'))
const write = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n')

function load(): LibraryInput {
  const workflows = SERVICES.flatMap((s) => {
    const dir = join(root, s.toLowerCase())
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ path: relative(root, join(dir, f)), data: readJson(join(dir, f)) }))
  })
  return { workflows, catalogue: readJson(join(root, 'catalogue.json')) }
}

function build() {
  const input = load()
  const lib = checkLibrary(input)
  if (lib.issues.length) fail(lib.issues)
  mkdirSync(join(root, 'schemas'), { recursive: true })
  write(join(root, 'schemas/workflow.schema.json'), z.toJSONSchema(workflowSchema))
  const index = buildIndex(lib, input.workflows)
  write(join(root, 'index.json'), index)
  console.log(`Library OK: ${index.counts.total} workflows ${JSON.stringify(index.counts.byStatus)}; ${lib.catalogue.length} catalogue entries.`)
}

async function importFile(args: string[]) {
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
  const file = args[0]
  const service = SERVICES.find((s) => s === flag('service')?.toUpperCase())
  const [category, id, name, start, sheetArg] = [flag('category'), flag('id'), flag('name'), flag('start'), flag('sheet')]
  if (!file || !service || !category || !id || !name || !start) fail(['usage: library:import <file> --service EMS|PD|FD --category C --id ID --name N --start NODE [--sheet S] [--authorized]'])
  let grid: unknown[][]
  let sheet = ''
  if (file!.toLowerCase().endsWith('.csv')) grid = parseCsv(readFileSync(file!, 'utf8'))
  else {
    const sheets = await readXlsxFile(file!)
    const found = sheets.find((s) => s.sheet.toLowerCase() === (sheetArg ?? 'validation').toLowerCase()) ?? (sheetArg ? undefined : sheets[0])
    if (!found) fail([`worksheet "${sheetArg ?? 'VALIDATION'}" not found; available: ${sheets.map((s) => s.sheet).join(', ')}`])
    grid = found!.data
    sheet = found!.sheet
  }
  const table: Table = tableFromGrid(grid)
  const r = buildWorkflow(table, suggestMapping(table.headers), {
    id: id!, name: name!, start: start!, service, category,
    status: 'pending-validation',
    provenance: { origin: args.includes('--authorized') ? 'authorized-source' : 'user-import', sourceFile: basename(file!), worksheet: sheet || undefined, importedAt: new Date().toISOString() },
    sheet,
  })
  if (!r.definition) fail([...r.rowErrors.map((e) => `row ${e.line}: ${e.message}`), ...r.issues.map((i) => i.message)])
  write(join(root, service!.toLowerCase(), `${id}.json`), r.definition)
  console.log(`Imported ${r.definition!.nodes.length} nodes as pending-validation.`)
  build()
}

function fail(lines: string[]): never {
  console.error(lines.map((l) => `  - ${l}`).join('\n'))
  process.exit(1)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'import') await importFile(rest)
else build()
