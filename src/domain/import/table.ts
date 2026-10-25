/** Whatever the spreadsheet reader yields for a cell; normalised to text by cellText. */
export type Cell = unknown

export interface Table {
  /** Worksheet the rows came from (xlsx only) and every worksheet in the file. */
  sheet?: string
  sheets?: string[]
  headers: string[]
  /** `line` is the 1-based spreadsheet row, so errors point at what the user sees. */
  rows: { line: number; cells: string[] }[]
}

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^\u{FEFF}/u, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      out.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field')
  if (field !== '' || row.length) {
    row.push(field)
    out.push(row)
  }
  return out
}

const cellText = (c: Cell): string => {
  if (c instanceof Date) return c.toISOString()
  return typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean' ? String(c).trim() : ''
}

/** First non-empty row is the header row; fully empty rows are skipped. */
export function tableFromGrid(grid: Cell[][]): Table {
  const text = grid.map((r) => r.map(cellText))
  const h = text.findIndex((r) => r.some(Boolean))
  if (h < 0) throw new Error('The file has no data')
  const headers = text[h]!
  const rows = text
    .map((cells, i) => ({ line: i + 1, cells }))
    .slice(h + 1)
    .filter((r) => r.cells.some(Boolean))
  if (!rows.length) throw new Error('The file has a header row but no data rows')
  return { headers, rows }
}
