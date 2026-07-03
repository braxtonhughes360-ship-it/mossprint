import type { TransactionType } from './money'

/**
 * V2f — Import / export / backup contracts.
 *
 * Goal: zero lock-in. Bring a CSV in (from a bank, Actual, YNAB, a spreadsheet),
 * back the whole budget up to a single file, and restore it — all local, no cloud.
 * File access lives in the main process; the renderer only ever sees parsed rows.
 */

/** Logical destination a CSV column maps onto. */
export type ImportFieldTarget =
  | 'ignore'
  | 'date'
  | 'payee'
  | 'memo'
  | 'amount'
  | 'outflow'
  | 'inflow'
  | 'category'
  | 'account'
  | 'type'
  | 'notes'
  | 'tags'

export const IMPORT_FIELD_TARGETS: ImportFieldTarget[] = [
  'ignore',
  'date',
  'payee',
  'memo',
  'amount',
  'outflow',
  'inflow',
  'category',
  'account',
  'type',
  'notes',
  'tags'
]

/** Plain-language labels for the column mapper — no jargon in the default path. */
export const IMPORT_FIELD_LABELS: Record<ImportFieldTarget, string> = {
  ignore: "Don't import",
  date: 'Date',
  payee: 'Payee',
  memo: 'Description',
  amount: 'Amount (one column)',
  outflow: 'Money out',
  inflow: 'Money in',
  category: 'Envelope',
  account: 'Account',
  type: 'Type',
  notes: 'Notes',
  tags: 'Tags'
}

/** Per-bank / per-app CSV layout presets (V2.5a). */
export type ImportPresetId =
  | 'auto'
  | 'chase'
  | 'bofa'
  | 'wells_fargo'
  | 'amex'
  | 'capital_one'
  | 'apple_card'
  | 'generic'
  | 'mint'
  | 'actual_ynab'
  | 'moss'

export type DateFormatHint = 'auto' | 'mdy' | 'dmy' | 'ymd'
export type AmountSignHint = 'auto' | 'expense_negative' | 'expense_positive'

export interface ImportOptions {
  dateFormat: DateFormatHint
  /** How to read a single signed amount column. Out/in columns ignore this. */
  amountSign: AmountSignHint
  skipDuplicates: boolean
  /** Account assigned to rows with no mapped/recognized account. */
  defaultAccountId: string | null
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  dateFormat: 'auto',
  amountSign: 'expense_negative',
  skipDuplicates: true,
  defaultAccountId: null
}

/** Result of picking + parsing a CSV file (main process reads, renderer maps). */
export interface CsvParseResult {
  canceled: boolean
  fileName: string
  headers: string[]
  rows: string[][]
  rowCount: number
  delimiter: string
  suggestedPreset: ImportPresetId
  suggestedMapping: ImportFieldTarget[]
}

/** Everything main needs to preview or commit an import. */
export interface ImportRequest {
  headers: string[]
  rows: string[][]
  mapping: ImportFieldTarget[]
  options: ImportOptions
}

export type ImportRowStatus = 'ok' | 'duplicate' | 'error'

export interface ImportPreviewRow {
  index: number
  dateIso: string | null
  dateLabel: string
  payee: string
  memo: string
  amountCents: number | null
  amountLabel: string
  type: TransactionType
  categoryName: string | null
  categoryMatched: boolean
  accountName: string | null
  notes: string
  tags: string[]
  status: ImportRowStatus
  /** Error reason or duplicate explanation — plain language. */
  message: string
}

export interface ImportPreview {
  rows: ImportPreviewRow[]
  totalCount: number
  okCount: number
  duplicateCount: number
  errorCount: number
  /** Category names in the file with no matching envelope. */
  unmatchedCategories: string[]
}

export interface ImportCommitResult {
  imported: number
  skippedDuplicates: number
  skippedErrors: number
  message: string
}

export type ExportScope = 'transactions' | 'backup'

export interface ExportResult {
  canceled: boolean
  path?: string
  fileName?: string
  count?: number
  message?: string
}

export interface RestoreResult {
  canceled: boolean
  inserted?: number
  skipped?: number
  tables?: Record<string, number>
  message?: string
}

/** Header row used by Moss's own transaction CSV export. */
export const MOSS_TXN_CSV_COLUMNS = [
  'Date',
  'Payee',
  'Memo',
  'Envelope',
  'Account',
  'Amount',
  'Type',
  'Status',
  'Notes',
  'Tags'
] as const

export const MONEY_BACKUP_VERSION = 1

export interface MoneyBackupFile {
  app: 'moss'
  kind: 'money-backup'
  version: number
  exportedAt: string
  tables: Record<string, { columns: string[]; rows: unknown[][] }>
}

// —— Bank / app presets (static config — user can still override mapping) ——

export interface BankImportPreset {
  id: ImportPresetId
  label: string
  columns: Array<{ match: string[]; field: ImportFieldTarget }>
  options?: Partial<ImportOptions>
}

export const IMPORT_PRESET_OPTIONS: Array<{ id: ImportPresetId; label: string }> = [
  { id: 'auto', label: 'Detect automatically' },
  { id: 'chase', label: 'Chase' },
  { id: 'bofa', label: 'Bank of America' },
  { id: 'wells_fargo', label: 'Wells Fargo' },
  { id: 'amex', label: 'American Express' },
  { id: 'capital_one', label: 'Capital One' },
  { id: 'apple_card', label: 'Apple Card' },
  { id: 'generic', label: 'Date / Description / Amount' },
  { id: 'mint', label: 'Mint export' },
  { id: 'actual_ynab', label: 'Actual / YNAB export' },
  { id: 'moss', label: 'MOSS export' }
]

const IMPORT_PRESETS: BankImportPreset[] = [
  {
    id: 'chase',
    label: 'Chase',
    columns: [
      { match: ['transaction date', 'trans date'], field: 'date' },
      { match: ['posting date', 'post date', 'posted date'], field: 'date' },
      { match: ['details'], field: 'ignore' },
      { match: ['description'], field: 'payee' },
      { match: ['category'], field: 'category' },
      { match: ['amount'], field: 'amount' },
      { match: ['memo'], field: 'memo' },
      { match: ['type'], field: 'type' }
    ],
    options: { amountSign: 'expense_negative' }
  },
  {
    id: 'bofa',
    label: 'Bank of America',
    columns: [
      { match: ['date'], field: 'date' },
      { match: ['description', 'payee'], field: 'payee' },
      { match: ['amount'], field: 'amount' },
      { match: ['debit'], field: 'outflow' },
      { match: ['credit'], field: 'inflow' },
      { match: ['category'], field: 'category' }
    ],
    options: { amountSign: 'expense_negative' }
  },
  {
    id: 'wells_fargo',
    label: 'Wells Fargo',
    columns: [
      { match: ['date'], field: 'date' },
      { match: ['amount'], field: 'amount' },
      { match: ['description', 'memo'], field: 'payee' },
      { match: ['debit'], field: 'outflow' },
      { match: ['credit'], field: 'inflow' }
    ],
    options: { amountSign: 'expense_negative' }
  },
  {
    id: 'amex',
    label: 'American Express',
    columns: [
      { match: ['date'], field: 'date' },
      { match: ['description', 'payee', 'merchant'], field: 'payee' },
      { match: ['amount'], field: 'amount' },
      { match: ['category'], field: 'category' },
      { match: ['memo', 'reference'], field: 'memo' }
    ],
    options: { amountSign: 'expense_positive' }
  },
  {
    id: 'capital_one',
    label: 'Capital One',
    columns: [
      { match: ['transaction date', 'trans date'], field: 'date' },
      { match: ['posted date', 'post date'], field: 'date' },
      { match: ['description', 'payee'], field: 'payee' },
      { match: ['category'], field: 'category' },
      { match: ['debit'], field: 'outflow' },
      { match: ['credit'], field: 'inflow' },
      { match: ['amount'], field: 'amount' }
    ]
  },
  {
    id: 'apple_card',
    label: 'Apple Card',
    columns: [
      { match: ['transaction date', 'trans date'], field: 'date' },
      { match: ['clearing date'], field: 'ignore' },
      { match: ['merchant', 'description'], field: 'payee' },
      { match: ['category'], field: 'category' },
      { match: ['type'], field: 'type' },
      { match: ['amount'], field: 'amount' }
    ],
    options: { amountSign: 'expense_positive' }
  },
  {
    id: 'generic',
    label: 'Date / Description / Amount',
    columns: [
      { match: ['date', 'posted', 'transaction date', 'posting date'], field: 'date' },
      { match: ['description', 'payee', 'merchant', 'name', 'memo'], field: 'payee' },
      { match: ['amount', 'value'], field: 'amount' },
      { match: ['debit'], field: 'outflow' },
      { match: ['credit'], field: 'inflow' },
      { match: ['category', 'envelope'], field: 'category' }
    ],
    options: { amountSign: 'expense_negative' }
  },
  {
    id: 'mint',
    label: 'Mint export',
    columns: [
      { match: ['date'], field: 'date' },
      { match: ['description', 'original description'], field: 'payee' },
      { match: ['amount'], field: 'amount' },
      { match: ['category'], field: 'category' },
      { match: ['account name', 'account'], field: 'account' },
      { match: ['transaction type', 'type'], field: 'type' },
      { match: ['notes', 'note'], field: 'notes' },
      { match: ['tags', 'labels'], field: 'tags' }
    ],
    options: { amountSign: 'expense_negative' }
  },
  {
    id: 'actual_ynab',
    label: 'Actual / YNAB export',
    columns: [
      { match: ['date'], field: 'date' },
      { match: ['payee'], field: 'payee' },
      { match: ['memo', 'note'], field: 'memo' },
      { match: ['category', 'envelope'], field: 'category' },
      { match: ['outflow', 'debit'], field: 'outflow' },
      { match: ['inflow', 'credit'], field: 'inflow' },
      { match: ['amount'], field: 'amount' },
      { match: ['account'], field: 'account' }
    ]
  },
  {
    id: 'moss',
    label: 'MOSS export',
    columns: [
      { match: ['date'], field: 'date' },
      { match: ['payee'], field: 'payee' },
      { match: ['memo'], field: 'memo' },
      { match: ['envelope', 'category'], field: 'category' },
      { match: ['account'], field: 'account' },
      { match: ['amount'], field: 'amount' },
      { match: ['type'], field: 'type' },
      { match: ['notes'], field: 'notes' },
      { match: ['tags'], field: 'tags' }
    ],
    options: { amountSign: 'expense_negative' }
  }
]

function headerMatches(header: string, patterns: string[]): boolean {
  const h = header.trim().toLowerCase()
  if (!h) return false
  // Exact match first — avoids "Description" falsely matching pattern "details".
  for (const pattern of patterns) {
    if (h === pattern) return true
  }
  // Phrase patterns only (e.g. "posting date", "transaction date").
  return patterns.some((pattern) => pattern.includes(' ') && h.includes(pattern))
}

function presetById(id: ImportPresetId): BankImportPreset | undefined {
  return IMPORT_PRESETS.find((preset) => preset.id === id)
}

function mappingFromPreset(presetId: ImportPresetId, headers: string[]): ImportFieldTarget[] {
  const preset = presetById(presetId)
  if (!preset) return guessMapping(headers)
  const raw = headers.map((header) => {
    for (const col of preset.columns) {
      if (headerMatches(header, col.match)) return col.field
    }
    return 'ignore'
  })
  return resolveMappingConflicts(raw)
}

/** Apply a preset (or auto-detect) to headers — returns mapping + import options. */
export function applyImportPreset(
  presetId: ImportPresetId,
  headers: string[]
): { mapping: ImportFieldTarget[]; options: ImportOptions } {
  const resolvedId = presetId === 'auto' ? detectPreset(headers) : presetId
  const preset = presetById(resolvedId)
  const mapping =
    preset && resolvedId !== 'generic' ? mappingFromPreset(resolvedId, headers) : guessMapping(headers)
  const merged = { ...DEFAULT_IMPORT_OPTIONS, ...preset?.options }
  // When out/in columns are mapped, amount-sign hint is irrelevant.
  const usesOutIn = mapping.includes('outflow') || mapping.includes('inflow')
  if (usesOutIn) merged.amountSign = 'auto'
  return { mapping, options: merged }
}

/** Plain-language import summary for the preview step. */
export function formatImportSummary(preview: ImportPreview): string {
  const parts = [`${preview.totalCount} row${preview.totalCount === 1 ? '' : 's'}`]
  if (preview.duplicateCount > 0) {
    parts.push(`${preview.duplicateCount} duplicate${preview.duplicateCount === 1 ? '' : 's'} skipped`)
  }
  if (preview.errorCount > 0) {
    parts.push(`${preview.errorCount} need${preview.errorCount === 1 ? 's' : ''} a look`)
  }
  parts.push(`${preview.okCount} to import`)
  return parts.join(' · ')
}

// —— Pure mapping helpers (shared so preview + commit guess identically) ——

const HEADER_HINTS: Array<[ImportFieldTarget, string[]]> = [
  ['date', ['posted date', 'posting date', 'transaction date', 'trans date', 'post date', 'date', 'posted', 'time']],
  ['outflow', ['outflow', 'debit', 'withdrawal', 'spent', 'money out', 'paid out', 'debits']],
  ['inflow', ['inflow', 'credit', 'deposit', 'received', 'money in', 'paid in', 'credits']],
  ['amount', ['amount (usd)', 'amount', 'value']],
  ['payee', ['payee', 'merchant', 'original description', 'name', 'who', 'description', 'desc']],
  ['category', ['category', 'envelope', 'group']],
  ['account', ['account name', 'account', 'acct']],
  ['type', ['transaction type', 'type']],
  ['notes', ['notes', 'note', 'comment']],
  ['memo', ['memo', 'details', 'detail', 'reference', 'particular']],
  ['tags', ['tags', 'tag', 'labels', 'label']]
]

function guessFieldForHeader(header: string): ImportFieldTarget {
  const h = header.trim().toLowerCase()
  if (!h) return 'ignore'
  for (const [target, needles] of HEADER_HINTS) {
    if (needles.some((needle) => h === needle || h.includes(needle))) {
      return target
    }
  }
  return 'ignore'
}

function resolveMappingConflicts(raw: ImportFieldTarget[]): ImportFieldTarget[] {
  const hasOut = raw.includes('outflow')
  const hasIn = raw.includes('inflow')
  const singleUse = new Set<ImportFieldTarget>(['date', 'amount', 'payee', 'category', 'account', 'type'])
  const seen = new Set<ImportFieldTarget>()

  return raw.map((target) => {
    if (target === 'amount' && hasOut && hasIn) return 'ignore'
    if (target === 'ignore') return target
    if (singleUse.has(target)) {
      if (seen.has(target)) {
        if (target === 'payee' && !seen.has('memo')) {
          seen.add('memo')
          return 'memo'
        }
        if (target === 'date') return 'ignore'
        return 'ignore'
      }
      seen.add(target)
    }
    return target
  })
}

/** Auto-map headers to fields, resolving conflicts so single-value fields appear once. */
export function guessMapping(headers: string[]): ImportFieldTarget[] {
  return resolveMappingConflicts(headers.map(guessFieldForHeader))
}

export function detectPreset(headers: string[]): ImportPresetId {
  const lower = headers.map((h) => h.trim().toLowerCase())
  const mossCols = MOSS_TXN_CSV_COLUMNS.map((c) => c.toLowerCase())
  if (mossCols.every((c) => lower.includes(c))) return 'moss'
  if (lower.some((h) => h.includes('clearing date')) && lower.some((h) => h.includes('merchant'))) {
    return 'apple_card'
  }
  if (lower.includes('debit') && lower.includes('credit') && lower.some((h) => h.includes('transaction date'))) {
    return 'capital_one'
  }
  if (lower.includes('original description') || (lower.includes('transaction type') && lower.includes('account name'))) {
    return 'mint'
  }
  if (lower.some((h) => h.includes('outflow')) && lower.some((h) => h.includes('inflow')) && lower.includes('payee')) {
    return 'actual_ynab'
  }
  if (lower.some((h) => h.includes('running bal'))) return 'bofa'
  if (lower.some((h) => h.includes('posting date')) && lower.some((h) => h.includes('description'))) {
    return 'chase'
  }
  if (lower.some((h) => h.includes('card member'))) return 'amex'
  if (lower.includes('*')) return 'wells_fargo'
  if (lower.includes('payee') && lower.includes('category') && (lower.includes('amount') || lower.includes('outflow'))) {
    return 'actual_ynab'
  }
  return 'generic'
}

// —— CSV parsing (RFC4180-ish; shared so drag-drop can preview in renderer) ——

function sniffDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestCount = -1
  for (const delim of candidates) {
    const count = headerLine.split(delim).length - 1
    if (count > bestCount) {
      bestCount = count
      best = delim
    }
  }
  return best
}

export function parseCsv(text: string): { headers: string[]; rows: string[][]; delimiter: string } {
  const clean = text.replace(/^﻿/, '')
  const firstBreak = clean.search(/\r\n|\n|\r/)
  const headerLine = firstBreak === -1 ? clean : clean.slice(0, firstBreak)
  const delimiter = sniffDelimiter(headerLine)

  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      record.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[i + 1] === '\n') i += 1
      record.push(field)
      records.push(record)
      field = ''
      record = []
    } else {
      field += char
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field)
    records.push(record)
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim().length > 0))
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim())
  const rows = nonEmpty.map((r) => {
    const next = r.slice(0, headers.length)
    while (next.length < headers.length) next.push('')
    return next
  })
  return { headers, rows, delimiter }
}

/** Build a parse result from raw CSV text (file picker or drag-drop). */
export function buildCsvParseResult(fileName: string, text: string): CsvParseResult {
  const { headers, rows, delimiter } = parseCsv(text)
  const suggestedPreset = detectPreset(headers)
  const applied = applyImportPreset(suggestedPreset, headers)
  return {
    canceled: false,
    fileName,
    headers,
    rows,
    rowCount: rows.length,
    delimiter,
    suggestedPreset,
    suggestedMapping: applied.mapping
  }
}
