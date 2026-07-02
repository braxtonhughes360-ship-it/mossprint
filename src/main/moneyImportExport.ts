import { app, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  CsvParseResult,
  ExportResult,
  ImportCommitResult,
  ImportFieldTarget,
  ImportPreview,
  ImportPreviewRow,
  ImportRequest,
  MoneyBackupFile,
  RestoreResult
} from '@shared/moneyImportExport'
import {
  DEFAULT_IMPORT_OPTIONS,
  MONEY_BACKUP_VERSION,
  MOSS_TXN_CSV_COLUMNS,
  buildCsvParseResult
} from '@shared/moneyImportExport'
import type { DateFormatHint, ImportOptions } from '@shared/moneyImportExport'
import type { TransactionStatus, TransactionType } from '@shared/money'
import {
  defaultTransactionType,
  formatMoneyCents,
  isoToDayKey,
  parseMoneyInput,
  parseTags,
  transactionStatusLabel,
  transactionTypeLabel
} from '@shared/money'
import { getDb } from './database'
import { createTransaction, listCashAccounts, listCategories } from './money'

// Re-export for headless smoke tests and other main-process callers.
export { parseCsv, buildCsvParseResult } from '@shared/moneyImportExport'

export async function pickAndParseCsv(): Promise<CsvParseResult> {
  const result = await dialog.showOpenDialog({
    title: 'Import transactions (.csv)',
    properties: ['openFile'],
    filters: [{ name: 'CSV / spreadsheet export', extensions: ['csv', 'tsv', 'txt'] }]
  })
  if (result.canceled || result.filePaths.length === 0) {
    return {
      canceled: true,
      fileName: '',
      headers: [],
      rows: [],
      rowCount: 0,
      delimiter: ',',
      suggestedPreset: 'generic',
      suggestedMapping: []
    }
  }

  const path = result.filePaths[0]
  const text = readFileSync(path, 'utf8')
  return buildCsvParseResult(basename(path), text)
}

// —— Value parsers ——

function buildNoonIso(year: number, month: number, day: number): string | null {
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString()
}

function parseDateToIso(raw: string, hint: DateFormatHint): string | null {
  const value = raw.trim()
  if (!value) return null

  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (iso) return buildNoonIso(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const parts = value.split(/[/.\-\s]+/).filter(Boolean)
  if (parts.length >= 3 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
    const a = Number(parts[0])
    const b = Number(parts[1])
    let c = Number(parts[2])
    if (parts[2].length === 2) c += c < 70 ? 2000 : 1900
    let order: 'mdy' | 'dmy' | 'ymd'
    if (hint !== 'auto') order = hint
    else if (parts[0].length === 4) order = 'ymd'
    else if (a > 12) order = 'dmy'
    else order = 'mdy'
    if (order === 'ymd') return buildNoonIso(a, b, c)
    if (order === 'dmy') return buildNoonIso(c, b, a)
    return buildNoonIso(c, a, b)
  }

  const parsed = Date.parse(value)
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed)
    return buildNoonIso(d.getFullYear(), d.getMonth() + 1, d.getDate())
  }
  return null
}

/** Parse a money cell to signed cents, honoring accounting parentheses. */
function parseAmountField(raw: string): number | null {
  let value = raw.trim()
  if (!value) return null
  let negative = false
  if (/^\(.*\)$/.test(value)) {
    negative = true
    value = value.slice(1, -1)
  }
  if (value.includes('-')) negative = true
  const cents = parseMoneyInput(value)
  if (cents === null) return null
  const magnitude = Math.abs(cents)
  return negative ? -magnitude : magnitude
}

function normalizeType(raw: string): TransactionType | undefined {
  const value = raw.trim().toLowerCase()
  if (!value) return undefined
  if (value.startsWith('inc') || value === 'deposit') return 'income'
  if (value.startsWith('exp') || value === 'debit' || value === 'withdrawal') return 'expense'
  if (value.startsWith('transf')) return 'transfer'
  if (value.startsWith('adj')) return 'adjustment'
  return undefined
}

interface RowDraft {
  occurredAt: string | null
  payee: string
  memo: string
  amountCents: number | null
  type: TransactionType
  categoryName: string
  accountName: string
  notes: string
  tags: string[]
}

function columnGetter(row: string[], mapping: ImportFieldTarget[]) {
  return (target: ImportFieldTarget): string => {
    const index = mapping.indexOf(target)
    if (index < 0) return ''
    return (row[index] ?? '').trim()
  }
}

function buildDraft(row: string[], mapping: ImportFieldTarget[], options: ImportOptions): RowDraft {
  const get = columnGetter(row, mapping)
  const occurredAt = parseDateToIso(get('date'), options.dateFormat)
  const payee = get('payee')
  const memo = get('memo') || payee

  let amountCents: number | null = null
  const usesOutIn = mapping.includes('outflow') || mapping.includes('inflow')
  if (usesOutIn) {
    const out = parseAmountField(get('outflow'))
    const inn = parseAmountField(get('inflow'))
    if (out !== null && Math.abs(out) > 0) amountCents = -Math.abs(out)
    else if (inn !== null && Math.abs(inn) > 0) amountCents = Math.abs(inn)
    else amountCents = 0
  } else if (mapping.includes('amount')) {
    const parsed = parseAmountField(get('amount'))
    if (parsed !== null) {
      amountCents = options.amountSign === 'expense_positive' ? -parsed : parsed
    }
  }

  const type = normalizeType(get('type')) ?? (amountCents !== null ? defaultTransactionType(amountCents) : 'expense')

  return {
    occurredAt,
    payee,
    memo,
    amountCents,
    type,
    categoryName: get('category'),
    accountName: get('account'),
    notes: get('notes'),
    tags: parseTags(get('tags').replace(/[;|]/g, ','))
  }
}

// —— Duplicate detection against the existing ledger ——

function dedupeKey(dayIso: string, amountCents: number, descr: string): string {
  return `${dayIso.slice(0, 10)}|${amountCents}|${descr.trim().toLowerCase()}`
}

function existingDedupeKeys(): Set<string> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT lt.occurred_at AS occurredAt, lt.amount_cents AS amountCents,
              COALESCE(p.name, lt.memo, '') AS descr
       FROM ledger_transactions lt
       LEFT JOIN payees p ON p.id = lt.payee_id`
    )
    .all() as Array<{ occurredAt: string; amountCents: number; descr: string }>
  const keys = new Set<string>()
  for (const row of rows) {
    keys.add(dedupeKey(row.occurredAt, row.amountCents, row.descr))
  }
  return keys
}

// —— Preview ——

export function previewImport(request: ImportRequest): ImportPreview {
  const options = { ...DEFAULT_IMPORT_OPTIONS, ...request.options }
  const categories = listCategories()
  const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]))
  const accounts = listCashAccounts().filter((a) => !a.archived)
  const accountByName = new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a]))
  const existingKeys = existingDedupeKeys()
  const unmatched = new Set<string>()

  const rows: ImportPreviewRow[] = request.rows.map((raw, index) => {
    const draft = buildDraft(raw, request.mapping, options)
    const matchedCategory = draft.categoryName
      ? categoryByName.get(draft.categoryName.trim().toLowerCase())
      : undefined
    if (draft.categoryName && !matchedCategory) unmatched.add(draft.categoryName)
    const matchedAccount = draft.accountName
      ? accountByName.get(draft.accountName.trim().toLowerCase())
      : undefined

    let status: ImportPreviewRow['status'] = 'ok'
    let message = ''
    if (!draft.occurredAt) {
      status = 'error'
      message = 'Could not read a date'
    } else if (draft.amountCents === null) {
      status = 'error'
      message = 'Could not read an amount'
    } else if (draft.amountCents === 0) {
      status = 'error'
      message = 'Amount is zero'
    } else if (existingKeys.has(dedupeKey(draft.occurredAt, draft.amountCents, draft.payee || draft.memo))) {
      status = 'duplicate'
      message = 'Already in your ledger'
    }

    return {
      index,
      dateIso: draft.occurredAt,
      dateLabel: draft.occurredAt ? isoToDayKey(draft.occurredAt) : '—',
      payee: draft.payee,
      memo: draft.memo,
      amountCents: draft.amountCents,
      amountLabel: draft.amountCents !== null ? formatMoneyCents(draft.amountCents) : '—',
      type: draft.type,
      categoryName: draft.categoryName || null,
      categoryMatched: Boolean(matchedCategory),
      accountName: matchedAccount?.name ?? draft.accountName ?? null,
      notes: draft.notes,
      tags: draft.tags,
      status,
      message
    }
  })

  return {
    rows,
    totalCount: rows.length,
    okCount: rows.filter((r) => r.status === 'ok').length,
    duplicateCount: rows.filter((r) => r.status === 'duplicate').length,
    errorCount: rows.filter((r) => r.status === 'error').length,
    unmatchedCategories: Array.from(unmatched)
  }
}

// —— Commit ——

export function commitImport(request: ImportRequest): ImportCommitResult {
  const options = { ...DEFAULT_IMPORT_OPTIONS, ...request.options }
  const db = getDb()
  const categories = listCategories()
  const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]))
  const accounts = listCashAccounts().filter((a) => !a.archived)
  const accountByName = new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a]))
  const existingKeys = existingDedupeKeys()

  let imported = 0
  let skippedDuplicates = 0
  let skippedErrors = 0

  const run = db.transaction(() => {
    for (const raw of request.rows) {
      const draft = buildDraft(raw, request.mapping, options)
      if (!draft.occurredAt || draft.amountCents === null || draft.amountCents === 0) {
        skippedErrors += 1
        continue
      }
      const key = dedupeKey(draft.occurredAt, draft.amountCents, draft.payee || draft.memo)
      if (options.skipDuplicates && existingKeys.has(key)) {
        skippedDuplicates += 1
        continue
      }
      const category = draft.categoryName
        ? categoryByName.get(draft.categoryName.trim().toLowerCase())
        : undefined
      const account = draft.accountName
        ? accountByName.get(draft.accountName.trim().toLowerCase())
        : undefined

      const tags = draft.tags.includes('imported') ? draft.tags : [...draft.tags, 'imported']

      createTransaction({
        amountCents: draft.amountCents,
        type: draft.type,
        status: 'cleared',
        categoryId: category?.id ?? null,
        payeeName: draft.payee || undefined,
        memo: draft.memo,
        notes: draft.notes,
        tags,
        occurredAt: draft.occurredAt,
        accountId: account?.id ?? options.defaultAccountId ?? null
      })
      existingKeys.add(key)
      imported += 1
    }
  })
  run()

  const bits: string[] = [`Imported ${imported} transaction${imported === 1 ? '' : 's'}`]
  if (skippedDuplicates > 0) bits.push(`skipped ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? '' : 's'}`)
  if (skippedErrors > 0) bits.push(`skipped ${skippedErrors} unreadable row${skippedErrors === 1 ? '' : 's'}`)

  return {
    imported,
    skippedDuplicates,
    skippedErrors,
    message: `${bits.join(' · ')}.`
  }
}

// —— CSV escaping + export ——

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function toCsv(headerRow: readonly string[], dataRows: string[][]): string {
  const lines = [headerRow.map(csvCell).join(',')]
  for (const row of dataRows) {
    lines.push(row.map(csvCell).join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}

function downloadsPath(fileName: string): string {
  try {
    return join(app.getPath('downloads'), fileName)
  } catch {
    return fileName
  }
}

export async function exportTransactionsCsv(): Promise<ExportResult> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT lt.occurred_at AS occurredAt,
              COALESCE(p.name, '') AS payee,
              lt.memo AS memo,
              COALESCE(c.name, '') AS category,
              COALESCE(a.name, '') AS account,
              lt.amount_cents AS amountCents,
              lt.type AS type,
              lt.status AS status,
              lt.notes AS notes,
              lt.tags AS tags
       FROM ledger_transactions lt
       LEFT JOIN payees p ON p.id = lt.payee_id
       LEFT JOIN budget_categories c ON c.id = lt.category_id
       LEFT JOIN cash_accounts a ON a.id = lt.account_id
       ORDER BY lt.occurred_at DESC`
    )
    .all() as Array<{
    occurredAt: string
    payee: string
    memo: string
    category: string
    account: string
    amountCents: number
    type: TransactionType
    status: string
    notes: string
    tags: string
  }>

  const today = isoToDayKey(new Date().toISOString())
  const fileName = `moss-transactions-${today}.csv`
  const result = await dialog.showSaveDialog({
    title: 'Export transactions (.csv)',
    defaultPath: downloadsPath(fileName),
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  const dataRows = rows.map((r) => [
    isoToDayKey(r.occurredAt),
    r.payee,
    r.memo,
    r.category,
    r.account,
    (r.amountCents / 100).toFixed(2),
    transactionTypeLabel(r.type),
    transactionStatusLabel(r.status as TransactionStatus),
    r.notes,
    parseTags(r.tags).join('; ')
  ])
  writeFileSync(result.filePath, toCsv(MOSS_TXN_CSV_COLUMNS, dataRows), 'utf8')
  return {
    canceled: false,
    path: result.filePath,
    fileName: basename(result.filePath),
    count: rows.length,
    message: `Exported ${rows.length} transaction${rows.length === 1 ? '' : 's'}.`
  }
}

// —— Full backup (JSON, all money tables, re-importable) ——

const BACKUP_TABLES = [
  'budget_category_groups',
  'budget_categories',
  'cash_accounts',
  'payees',
  'budget_paychecks',
  'budget_assignments',
  'investment_accounts',
  'investment_holdings',
  'investment_snapshots',
  'investment_activities',
  'savings_goals',
  'savings_contributions',
  'ledger_transactions',
  'ledger_transaction_splits',
  'budget_schedules',
  'budget_rules',
  'budget_expected_paychecks',
  'report_presets'
] as const

function tableColumns(table: string): string[] {
  const db = getDb()
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return info.map((c) => c.name)
}

function tableExists(table: string): boolean {
  const db = getDb()
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(table)
  return Boolean(row)
}

export function buildBackup(): MoneyBackupFile {
  const db = getDb()
  const tables: MoneyBackupFile['tables'] = {}
  for (const table of BACKUP_TABLES) {
    if (!tableExists(table)) continue
    const columns = tableColumns(table)
    const objects = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
    tables[table] = {
      columns,
      rows: objects.map((obj) => columns.map((col) => obj[col] ?? null))
    }
  }
  return {
    app: 'moss',
    kind: 'money-backup',
    version: MONEY_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables
  }
}

export async function exportFullBackup(): Promise<ExportResult> {
  const backup = buildBackup()
  const today = isoToDayKey(new Date().toISOString())
  const fileName = `moss-money-backup-${today}.json`
  const result = await dialog.showSaveDialog({
    title: 'Save full backup (.json)',
    defaultPath: downloadsPath(fileName),
    filters: [{ name: 'Moss backup', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }

  writeFileSync(result.filePath, JSON.stringify(backup, null, 2), 'utf8')
  const count = Object.values(backup.tables).reduce((sum, t) => sum + t.rows.length, 0)
  return {
    canceled: false,
    path: result.filePath,
    fileName: basename(result.filePath),
    count,
    message: `Backed up ${count} record${count === 1 ? '' : 's'} across ${Object.keys(backup.tables).length} tables.`
  }
}

export async function restoreFullBackup(): Promise<RestoreResult> {
  const picked = await dialog.showOpenDialog({
    title: 'Restore from backup (.json)',
    properties: ['openFile'],
    filters: [{ name: 'Moss backup', extensions: ['json'] }]
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }

  let backup: MoneyBackupFile
  try {
    backup = JSON.parse(readFileSync(picked.filePaths[0], 'utf8')) as MoneyBackupFile
  } catch {
    return { canceled: false, message: "That file isn't readable as a Moss backup." }
  }
  if (!backup || backup.kind !== 'money-backup' || typeof backup.tables !== 'object') {
    return { canceled: false, message: "That file isn't a Moss money backup." }
  }

  const db = getDb()
  const perTable: Record<string, number> = {}
  let inserted = 0
  let skipped = 0

  // Defer FK checks to COMMIT so parent/child insert order can't fail mid-restore.
  db.pragma('defer_foreign_keys = ON')
  const run = db.transaction(() => {
    for (const table of BACKUP_TABLES) {
      const payload = backup.tables[table]
      if (!payload || !tableExists(table)) continue
      const liveColumns = new Set(tableColumns(table))
      const useColumns = payload.columns.filter((col) => liveColumns.has(col))
      if (useColumns.length === 0) continue
      const placeholders = useColumns.map(() => '?').join(', ')
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO ${table} (${useColumns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`
      )
      let tableInserted = 0
      for (const row of payload.rows) {
        const values = payload.columns
          .map((col, i) => ({ col, value: row[i] }))
          .filter(({ col }) => liveColumns.has(col))
          .map(({ value }) => (value === undefined ? null : (value as never)))
        const info = stmt.run(...values)
        if (info.changes > 0) {
          tableInserted += 1
          inserted += 1
        } else {
          skipped += 1
        }
      }
      if (tableInserted > 0) perTable[table] = tableInserted
    }
  })
  run()

  return {
    canceled: false,
    inserted,
    skipped,
    tables: perTable,
    message:
      inserted > 0
        ? `Restored ${inserted} new record${inserted === 1 ? '' : 's'}${skipped > 0 ? ` · ${skipped} already present` : ''}.`
        : 'Everything in that backup was already in your data — nothing to add.'
  }
}
