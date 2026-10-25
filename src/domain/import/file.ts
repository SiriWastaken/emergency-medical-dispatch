import readXlsxFile from 'read-excel-file/browser'
import { parseCsv, tableFromGrid, type Table } from './table'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

/**
 * Reads a .csv, or one worksheet of an .xlsx. For xlsx the requested sheet is used, else a sheet
 * named VALIDATION if present, else the first. Rejects other types and oversized files.
 */
export async function readTable(file: File, sheetName?: string): Promise<Table> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File is larger than 5 MB')
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return tableFromGrid(parseCsv(await file.text()))
  if (!name.endsWith('.xlsx')) throw new Error('Unsupported file type. Use .xlsx or .csv')
  const sheets = await readXlsxFile(file)
  const pick =
    sheets.find((s) => s.sheet === sheetName) ?? sheets.find((s) => s.sheet.toLowerCase() === 'validation') ?? sheets[0]
  if (!pick) throw new Error('The workbook has no worksheets')
  return { ...tableFromGrid(pick.data), sheet: pick.sheet, sheets: sheets.map((s) => s.sheet) }
}
