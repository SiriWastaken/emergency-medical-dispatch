/**
 * Writes the INITIAL call-taking-workflow.xlsx from the authored content in scripts/content. After that the
 * workbook is the maintained source of truth: edit it in a spreadsheet, then run `pnpm workflow:build`.
 * This script refuses to overwrite an existing workbook unless run with --force (which discards manual edits).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import writeXlsxFile from 'write-excel-file/node'
import { emsTrees } from './content/ems'
import { fdTrees } from './content/fd'
import { instructionRows } from './content/instructions'
import { pdTrees } from './content/pd'

const out = join(fileURLToPath(new URL('.', import.meta.url)), '../call-taking-workflow.xlsx')
if (existsSync(out) && !process.argv.includes('--force')) {
  console.error('call-taking-workflow.xlsx already exists; edit it directly (or pass --force to discard it and re-seed).')
  process.exit(1)
}

type Cell = { value: string; fontWeight?: 'bold'; wrap?: boolean }
const head = (cols: string[]): Cell[] => cols.map((value) => ({ value, fontWeight: 'bold' }))
const rows = (...r: string[][]): Cell[][] => r.map((row) => row.map((value) => ({ value, wrap: true })))
const sheet = (name: string, columns: string[], data: string[][], widths: number[]) => ({
  sheet: name,
  data: [head(columns), ...rows(...data)],
  columns: widths.map((width) => ({ width })),
  stickyRowsCount: 1,
})

const PHONE = '^[0-9+()\\-.\\s]{3,30}$'
const NOT_ASKED_AUTOMATICALLY = 'UNASSIGNED: no question supplies this yet'
const FROM_TREES = 'WORKFLOW: asked by the complaint question trees'
const FROM_PANEL = 'INSTRUCTIONS: logged from the caller instructions panel'

const trees = [...emsTrees(), ...pdTrees(), ...fdTrees()]
const built = trees.map((t) => t.rows())

const sheets = [
  sheet(
    'Case Entry',
    ['Prompt ID', 'Incident Type', 'Prompt', 'Input Type', 'Required', 'Validation', 'Next Step', 'Field ID'],
    [
      ['incident-type', 'ALL', 'Select the incident type.', 'select-incident-type', 'Yes', 'V-TYPE', 'location', ''],
      ['location', 'ALL', 'Where is the emergency? Give me the address or location.', 'text-long', 'Yes', 'V-LOCATION', 'callback', 'location'],
      ['callback', 'ALL', 'What phone number are you calling from?', 'phone', 'Yes', 'V-PHONE-REQ, V-PHONE', 'what-happening', 'callerPhone'],
      ['what-happening', 'ALL', 'Tell me exactly what is happening.', 'text-long', 'Yes', 'V-HAPPENING', 'chief-complaint', 'description'],
      ['chief-complaint', 'ALL', 'Select the chief complaint.', 'select-complaint', 'Yes', 'V-COMPLAINT-REQ, V-COMPLAINT', 'WORKFLOW', 'complaint'],
    ],
    [18, 14, 52, 22, 10, 28, 18, 16],
  ),
  sheet(
    'Questions',
    ['Question ID', 'Incident Type', 'Chief Complaint', 'Question', 'Answer Choices', 'Required', 'Workflow Stage', 'Input Type', 'Field ID'],
    built.flatMap((b) => b.questions),
    [18, 14, 28, 52, 40, 10, 20, 12, 16],
  ),
  sheet('Branches', ['Question ID', 'Answer Choice', 'Next', 'Terminal Outcome', 'Terminal Instruction', 'Condition'], built.flatMap((b) => b.branches), [26, 34, 28, 70, 20, 26]),
  sheet(
    'Narratives',
    ['Incident Type', 'Field ID', 'Display Label', 'Source Answer', 'Output Order', 'Format'],
    [
      ['EMS', 'callerPhone', 'PHONE NUMBER:', 'callback', '1', ''],
      ['EMS', 'complaint+description', "CALLER'S PROBLEM DESCRIPTION IS:", 'chief-complaint + what-happening', '2', ''],
      ['EMS', 'callerRelationship', "CALLER'S RELATIONSHIP TO PATIENT:", FROM_TREES, '3', ''],
      ['EMS', 'patientCount', 'NUMBER OF HURT/SICK:', FROM_TREES, '4', ''],
      ['EMS', 'patientAge', 'PATIENT(S) AGE IS:', FROM_TREES, '5', 'suffix: YEARS'],
      ['EMS', 'sex', 'PATIENT(S) SEX IS:', FROM_TREES, '6', ''],
      ['EMS', 'consciousStatus', 'PATIENT(S) CONSCIOUS STATUS:', FROM_TREES, '7', ''],
      ['EMS', 'breathingStatus', 'PATIENT(S) BREATHING STATUS:', FROM_TREES, '8', ''],
      ['EMS', 'instructionsGiven', 'EMERGENCY INSTRUCTIONS GIVEN:', FROM_PANEL, '9', ''],
      ['PD', 'callerPhone', 'PHONE NUMBER:', 'callback', '1', ''],
      ['PD', 'callerName', "CALLER'S NAME:", NOT_ASKED_AUTOMATICALLY, '2', ''],
      ['PD', 'complaint+description', "CALLER'S PROBLEM DESCRIPTION:", 'chief-complaint + what-happening', '3', ''],
      ['PD', 'instructionsGiven', 'EMERGENCY INSTRUCTIONS GIVEN:', FROM_PANEL, '4', ''],
      // ASSUMPTION: no fire-service template was specified; FD uses the PD template.
      ['FD', 'callerPhone', 'PHONE NUMBER:', 'callback', '1', ''],
      ['FD', 'callerName', "CALLER'S NAME:", NOT_ASKED_AUTOMATICALLY, '2', ''],
      ['FD', 'complaint+description', "CALLER'S PROBLEM DESCRIPTION:", 'chief-complaint + what-happening', '3', ''],
      ['FD', 'instructionsGiven', 'EMERGENCY INSTRUCTIONS GIVEN:', FROM_PANEL, '4', ''],
    ],
    [14, 24, 40, 40, 14, 18],
  ),
  sheet(
    'Validation',
    ['Rule ID', 'Applicable Step', 'Validation Condition', 'Error Message'],
    [
      ['V-TYPE', 'incident-type', 'one-of:EMS,PD,FD', 'Select EMS, PD or FD.'],
      ['V-LOCATION', 'location', 'required', 'The location of the emergency is required. If it is not known, mark it Unknown.'],
      ['V-PHONE-REQ', 'callback', 'required', 'A callback number is required. If it is not known, mark it Unknown.'],
      ['V-PHONE', 'callback', `regex:${PHONE}`, 'Use digits, spaces and + ( ) - . only (3 to 30 characters).'],
      ['V-HAPPENING', 'what-happening', 'required', 'Describe what is happening before continuing. If the caller cannot say, mark it Unknown.'],
      ['V-COMPLAINT-REQ', 'chief-complaint', 'required', 'Choose a chief complaint. If it cannot be established, mark it Unknown.'],
      ['V-COMPLAINT', 'chief-complaint', 'in-catalogue', 'Choose a chief complaint from the list.'],
      ...built.flatMap((b) => b.validation),
    ],
    [20, 20, 40, 70],
  ),
  sheet(
    'Workflows',
    ['Workflow ID', 'Incident Type', 'Chief Complaint', 'Name', 'Status', 'Start', 'Source', 'Notes'],
    built.map((b) => b.workflow),
    [22, 10, 40, 48, 24, 30, 40, 40],
  ),
  sheet(
    'Instructions',
    ['Instruction ID', 'Incident Type', 'Title', 'Script', 'Status', 'Source'],
    instructionRows(),
    [20, 12, 40, 100, 14, 50],
  ),
  {
    sheet: 'Read Me',
    data: rows(
      ['CALL-TAKING WORKFLOW WORKBOOK'],
      ['This workbook is the single source of truth for what the app asks. Edit it, then run: pnpm workflow:build (validates it and regenerates the data the app loads).'],
      [''],
      ['Case Entry: the prompts asked before any question tree, in order. Each prompt names the next one; the chief-complaint prompt ends with WORKFLOW (start the question tree). Only these are asked automatically.'],
      ['Questions: one row per question in a complaint-specific tree. Chief Complaint is a chief-complaint label from the list, or * for any complaint of that incident type. Answer Choices are separated by |. Input Type is choice (default), text or integer. Field ID is the incident field the answer fills in (optional).'],
      ['ROLEPLAY CONTENT: the question trees and instruction scripts in this workbook were written for roleplay and training. They are realistic, but they are not a real dispatch protocol and must not be used for real emergencies.'],
      [''],
      ['Branches: one row per answer. Next is a Question ID, or TERMINAL:<name> (then fill Terminal Outcome, and optionally Terminal Instruction = an Instruction ID to read out). Special answers: (unknown), (unavailable), (not asked) route those responses; a typed question uses (answered). A response is offered to the call-taker only if it has a row here. A Required question can never have (not asked). Condition (optional) makes a row apply only when an earlier answer matches, written <question id>=<answer choice>; the row without a condition is the default for that answer.'],
      ['Narratives: the call narrative lines for each incident type, by Output Order. Source Answer names the prompt or question that fills the line, WORKFLOW if the complaint trees ask for it, INSTRUCTIONS for the emergency-instructions line, or UNASSIGNED while nothing asks for it. After the lines, the narrative adds a PRE-ARRIVAL INSTRUCTIONS section whenever a script has been recommended by the questions or given to the caller. Names (caller, patient) are never asked unless a question here asks for them.'],
      ['Validation: rules applied to a prompt or question. Conditions: required | regex:<pattern> | one-of:a,b,c | integer:min-max | max-length:n | in-catalogue.'],
      ['Workflows: which tree handles which chief complaint. Status COMPLETE or COMPLETE - ROLEPLAY needs questions; INCOMPLETE - CONTENT REQUIRED is a marked placeholder that can never validate as complete.'],
      ['Instructions: scripts to read to the caller (for example CPR). Status AUTHORIZED = from an authorized source; ROLEPLAY = written for roleplay (shown with a roleplay label); both need the script AND its source. Otherwise leave it CONTENT REQUIRED.'],
      [''],
      ['EXAMPLE (not loaded; copy the idea, not the wording). Questions row: q-example | EMS | <chief complaint> | <question text> | <choice A>|<choice B> | Yes | Key Questions | choice | . Branches rows: q-example | <choice A> | TERMINAL:done | <outcome text> | ; q-example | <choice B> | q-next | |'],
    ),
    columns: [{ width: 160 }],
  },
]

await writeXlsxFile(sheets as never).toFile(out)
console.log(`Wrote ${out}`)
