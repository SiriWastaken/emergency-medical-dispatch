/**
 * Validates call-taking-workflow.xlsx and writes the data the app loads (src/data/call-taking/definition.json).
 *   pnpm workflow:build
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import readXlsxFile from 'read-excel-file/node'
import { parseWorkbook } from '../src/domain/call-taking/parse'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const workbook = join(root, 'call-taking-workflow.xlsx')
const catalogue = JSON.parse(readFileSync(join(root, 'src/data/workflows/catalogue.json'), 'utf8')) as { entries: { label: string }[] }

const sheets = Object.fromEntries((await readXlsxFile(workbook)).map((s) => [s.sheet, s.data]))
const { definition, issues } = parseWorkbook(sheets, { workbook: 'call-taking-workflow.xlsx', complaints: new Set(catalogue.entries.map((e) => e.label)) })
if (!definition) {
  console.error('call-taking-workflow.xlsx is not valid:\n' + issues.map((i) => `  - ${i}`).join('\n'))
  process.exit(1)
}
mkdirSync(join(root, 'src/data/call-taking'), { recursive: true })
writeFileSync(join(root, 'src/data/call-taking/definition.json'), JSON.stringify(definition, null, 2) + '\n')
const complete = definition.workflows.filter((w) => !w.incomplete).length
console.log(`Workbook OK: ${definition.workflows.length} workflow(s) (${complete} complete, ${definition.workflows.length - complete} awaiting content), ${definition.instructions.length} instruction(s).`)
