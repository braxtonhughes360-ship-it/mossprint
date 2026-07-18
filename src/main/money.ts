import { randomUUID } from 'node:crypto'
import { inferCountsTowardSafeToSpendFromName } from '@shared/moneyEnvelope'
import type {
  AssignmentRecord,
  CategoryBudgetRow,
  CategoryRecord,
  CoverOverspendingInput,
  CreateCategoryInput,
  CreateInvestmentAccountInput,
  CreateInvestmentSnapshotInput,
  CreatePaycheckInput,
  CreateTransactionInput,
  CreateTransferInput,
  DeleteTransactionResult,
  InvestmentAccountRecord,
  InvestmentAccountRow,
  InvestmentSnapshotRecord,
  InvestmentsOverview,
  LedgerAuditAction,
  LedgerAuditRecord,
  MoneyBudgetOverview,
  MoneyDoorSnapshot,
  MoneySummary,
  PaycheckRecord,
  ReconciliationSummary,
  SetAssignmentInput,
  SetCategoryGroupInput,
  SetCategoryRolloverInput,
  SetCategorySpendPolicyInput,
  SetCategoryTargetInput,
  SetTransactionStatusInput,
  TransactionRecord,
  TransactionSplitRecord,
  TransactionType,
  UpdatePaycheckInput,
  UpdateTransactionInput
} from '@shared/money'
import {
  currentPeriodKey,
  defaultTransactionType,
  formatMoneyCents,
  parseTags,
  serializeTags,
  shiftPeriodKey,
  transactionStatusLabel,
  transactionTypeLabel
} from '@shared/money'
import { getDb } from './database'
import {
  listCategoryGroups,
  listHoldingsForAccount,
  portfolioTotalsFromHoldings,
  upsertPayeeByName
} from './moneyS'
import { enrichInvestmentsOverview } from './moneyInvestments'
import { normalizeInvestmentsOverview } from '@shared/money'
import { matchCategoryForTransaction } from './moneyV2'

function periodBounds(periodKey: string): { start: string; end: string } {
  const [year, month] = periodKey.split('-').map(Number)
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0, 23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

function isInPeriod(isoDate: string, periodKey: string): boolean {
  const { start, end } = periodBounds(periodKey)
  return isoDate >= start && isoDate <= end
}

function rowToPaycheck(row: {
  id: string
  label: string
  amount_cents: number
  received_at: string
  account_id?: string | null
  created_at: string
}): PaycheckRecord {
  return {
    id: row.id,
    label: row.label,
    amountCents: row.amount_cents,
    receivedAt: row.received_at,
    accountId: row.account_id ?? null,
    createdAt: row.created_at
  }
}

function rowToCategory(row: {
  id: string
  name: string
  sort_order: number
  group_id: string | null
  target_cents?: number | null
  counts_toward_safe_to_spend?: number | null
  rollover_enabled?: number | null
  rollover_released_cents?: number | null
  created_at: string
}): CategoryRecord {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    groupId: row.group_id,
    targetCents: row.target_cents ?? null,
    countsTowardSafeToSpend: (row.counts_toward_safe_to_spend ?? 1) !== 0,
    rolloverEnabled: (row.rollover_enabled ?? 0) !== 0,
    rolloverReleasedCents: row.rollover_released_cents ?? 0,
    createdAt: row.created_at
  }
}

type TransactionRow = {
  id: string
  amount_cents: number
  type: string
  status: string
  category_id: string | null
  payee_id: string | null
  payee_name?: string | null
  memo: string
  notes: string
  tags: string
  occurred_at: string
  account_id?: string | null
  transfer_account_id?: string | null
  transfer_group_id?: string | null
  updated_at?: string | null
  created_at: string
}

function rowToTransaction(
  row: TransactionRow,
  splits: TransactionSplitRecord[] = []
): TransactionRecord {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    type: (row.type ?? 'expense') as TransactionType,
    status: (row.status ?? 'cleared') as TransactionRecord['status'],
    categoryId: row.category_id,
    payeeId: row.payee_id,
    payeeName: row.payee_name ?? null,
    memo: row.memo,
    notes: row.notes ?? '',
    tags: parseTags(row.tags),
    occurredAt: row.occurred_at,
    accountId: row.account_id ?? null,
    transferAccountId: row.transfer_account_id ?? null,
    transferGroupId: row.transfer_group_id ?? null,
    splits,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null
  }
}

/** Shared SELECT column list (payee name joined). */
const TXN_SELECT = `t.id, t.amount_cents, t.type, t.status, t.category_id, t.payee_id,
       p.name AS payee_name, t.memo, t.notes, t.tags, t.occurred_at, t.account_id,
       t.transfer_account_id, t.transfer_group_id, t.updated_at, t.created_at`

function rowToSplit(row: {
  id: string
  transaction_id: string
  category_id: string | null
  amount_cents: number
  memo: string
  created_at: string
}): TransactionSplitRecord {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    categoryId: row.category_id,
    amountCents: row.amount_cents,
    memo: row.memo,
    createdAt: row.created_at
  }
}

/** Splits for a set of parent transaction ids, grouped by transaction_id (avoids N+1). */
function splitsByTransaction(transactionIds: string[]): Map<string, TransactionSplitRecord[]> {
  const grouped = new Map<string, TransactionSplitRecord[]>()
  if (transactionIds.length === 0) return grouped

  const placeholders = transactionIds.map(() => '?').join(',')
  const rows = getDb()
    .prepare(
      `SELECT id, transaction_id, category_id, amount_cents, memo, created_at
       FROM ledger_transaction_splits
       WHERE transaction_id IN (${placeholders})
       ORDER BY created_at ASC`
    )
    .all(...transactionIds) as Array<{
    id: string
    transaction_id: string
    category_id: string | null
    amount_cents: number
    memo: string
    created_at: string
  }>

  for (const row of rows) {
    const list = grouped.get(row.transaction_id) ?? []
    list.push(rowToSplit(row))
    grouped.set(row.transaction_id, list)
  }

  return grouped
}

export function listPaychecks(): PaycheckRecord[] {
  const rows = getDb()
    .prepare(
      'SELECT id, label, amount_cents, received_at, account_id, created_at FROM budget_paychecks ORDER BY received_at DESC'
    )
    .all() as Array<{
    id: string
    label: string
    amount_cents: number
    received_at: string
    account_id: string | null
    created_at: string
  }>

  return rows.map(rowToPaycheck)
}

export function createPaycheck(input: CreatePaycheckInput): PaycheckRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO budget_paychecks (id, label, amount_cents, received_at, account_id, created_at)
       VALUES (@id, @label, @amountCents, @receivedAt, @accountId, @createdAt)`
    )
    .run({
      id,
      label: input.label.trim(),
      amountCents: input.amountCents,
      receivedAt: input.receivedAt,
      accountId: input.accountId ?? null,
      createdAt
    })

  return rowToPaycheck(
    getDb()
      .prepare(
        'SELECT id, label, amount_cents, received_at, account_id, created_at FROM budget_paychecks WHERE id = ?'
      )
      .get(id) as {
      id: string
      label: string
      amount_cents: number
      received_at: string
      account_id: string | null
      created_at: string
    }
  )
}

export function listCategories(): CategoryRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, sort_order, group_id, target_cents, counts_toward_safe_to_spend, rollover_enabled, rollover_released_cents, created_at FROM budget_categories ORDER BY sort_order ASC, name ASC`
    )
    .all() as Array<{
    id: string
    name: string
    sort_order: number
    group_id: string | null
    target_cents: number | null
    counts_toward_safe_to_spend: number | null
    rollover_enabled: number | null
    rollover_released_cents: number | null
    created_at: string
  }>

  return rows.map(rowToCategory)
}

export function createCategory(input: CreateCategoryInput): CategoryRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const sortOrder =
    (getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM budget_categories')
      .get() as { max_order: number }).max_order + 1

  const countsTowardSafeToSpend =
    input.countsTowardSafeToSpend ?? inferCountsTowardSafeToSpendFromName(input.name)
  // Rollover is opt-in: off by default, so unspent money returns to "to assign" each
  // month. Savings goals and sinking-fund bills turn it on explicitly.
  const rolloverEnabled = input.rolloverEnabled ?? false

  getDb()
    .prepare(
      `INSERT INTO budget_categories (id, name, sort_order, group_id, target_cents, counts_toward_safe_to_spend, rollover_enabled, created_at)
       VALUES (@id, @name, @sortOrder, @groupId, @targetCents, @countsTowardSafeToSpend, @rolloverEnabled, @createdAt)`
    )
    .run({
      id,
      name: input.name.trim(),
      sortOrder,
      groupId: input.groupId ?? null,
      targetCents: input.targetCents ?? null,
      countsTowardSafeToSpend: countsTowardSafeToSpend ? 1 : 0,
      rolloverEnabled: rolloverEnabled ? 1 : 0,
      createdAt
    })

  return rowToCategory(
    getDb()
      .prepare(
        `SELECT id, name, sort_order, group_id, target_cents, counts_toward_safe_to_spend, rollover_enabled, rollover_released_cents, created_at FROM budget_categories WHERE id = ?`
      )
      .get(id) as {
      id: string
      name: string
      sort_order: number
      group_id: string | null
      target_cents: number | null
      counts_toward_safe_to_spend: number
      rollover_enabled: number | null
      rollover_released_cents: number | null
      created_at: string
    }
  )
}

export function setCategoryTarget(input: SetCategoryTargetInput): void {
  getDb()
    .prepare('UPDATE budget_categories SET target_cents = ? WHERE id = ?')
    .run(input.targetCents ?? null, input.categoryId)
}

export function setCategorySpendPolicy(input: SetCategorySpendPolicyInput): void {
  getDb()
    .prepare('UPDATE budget_categories SET counts_toward_safe_to_spend = ? WHERE id = ?')
    .run(input.countsTowardSafeToSpend ? 1 : 0, input.categoryId)
}

export function setCategoryRollover(input: SetCategoryRolloverInput): void {
  const db = getDb()
  const row = db
    .prepare('SELECT rollover_enabled, rollover_released_cents FROM budget_categories WHERE id = ?')
    .get(input.categoryId) as { rollover_enabled: number; rollover_released_cents: number } | undefined
  if (!row) throw new Error('Envelope not found')

  const periodKey = currentPeriodKey()
  const releasedSoFar = row.rollover_released_cents ?? 0

  // Option A: turning rollover off materializes only the rolled pile (carry-in), not this
  // month's assignment — that stays assigned; the pile moves to "to assign".
  if (!input.rolloverEnabled && row.rollover_enabled !== 0) {
    const carryIn = categoryCarryInCents(input.categoryId, periodKey, releasedSoFar)
    if (carryIn !== 0) {
      db.prepare(
        'UPDATE budget_categories SET rollover_released_cents = rollover_released_cents + ? WHERE id = ?'
      ).run(carryIn, input.categoryId)
    }
  }

  // Turning rollover back on is a fresh start — never auto-restore or re-seal balances.
  db.prepare('UPDATE budget_categories SET rollover_enabled = ? WHERE id = ?').run(
    input.rolloverEnabled ? 1 : 0,
    input.categoryId
  )
}

/** Cumulative envelope balance minus prior releases to the pool. */
function categoryAvailableCents(
  categoryId: string,
  periodKey: string,
  releasedCents: number
): number {
  const cumulativeAssigned = cumulativeAssignedByCategory(periodKey).get(categoryId) ?? 0
  const cumulativeSpent = cumulativeSpentByCategory(periodKey).get(categoryId) ?? 0
  return cumulativeAssigned - cumulativeSpent - releasedCents
}

function categoryCarryInCents(
  categoryId: string,
  periodKey: string,
  releasedCents: number
): number {
  const assignedCents = assignmentsForPeriod(periodKey).get(categoryId) ?? 0
  const spentCents = spentByCategoryForPeriod(periodKey).get(categoryId) ?? 0
  const availableCents = categoryAvailableCents(categoryId, periodKey, releasedCents)
  return availableCents - assignedCents + spentCents
}

export function setCategoryGroup(input: SetCategoryGroupInput): void {
  // null is allowed (moves the envelope to "Other"); a non-null group must exist
  // so we never strand an envelope under a deleted group id.
  let groupId = input.groupId
  if (groupId != null) {
    const group = getDb()
      .prepare('SELECT id FROM budget_category_groups WHERE id = ?')
      .get(groupId) as { id: string } | undefined
    if (!group) groupId = null
  }
  getDb()
    .prepare('UPDATE budget_categories SET group_id = ? WHERE id = ?')
    .run(groupId, input.categoryId)
}

export function setAssignment(input: SetAssignmentInput): AssignmentRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO budget_assignments (id, category_id, amount_cents, period_key, created_at)
       VALUES (@id, @categoryId, @amountCents, @periodKey, @createdAt)
       ON CONFLICT(category_id, period_key) DO UPDATE SET
         amount_cents = excluded.amount_cents,
         created_at = excluded.created_at`
    )
    .run({
      id,
      categoryId: input.categoryId,
      amountCents: input.amountCents,
      periodKey: input.periodKey,
      createdAt
    })

  const row = getDb()
    .prepare(
      `SELECT id, category_id, amount_cents, period_key, created_at
       FROM budget_assignments WHERE category_id = ? AND period_key = ?`
    )
    .get(input.categoryId, input.periodKey) as {
    id: string
    category_id: string
    amount_cents: number
    period_key: string
    created_at: string
  }

  return {
    id: row.id,
    categoryId: row.category_id,
    amountCents: row.amount_cents,
    periodKey: row.period_key,
    createdAt: row.created_at
  }
}

function attachSplits(rows: TransactionRow[]): TransactionRecord[] {
  const grouped = splitsByTransaction(rows.map((row) => row.id))
  return rows.map((row) => rowToTransaction(row, grouped.get(row.id) ?? []))
}

function fetchTransactionById(id: string): TransactionRecord | null {
  const row = getDb()
    .prepare(
      `SELECT ${TXN_SELECT}
       FROM ledger_transactions t
       LEFT JOIN payees p ON p.id = t.payee_id
       WHERE t.id = ?`
    )
    .get(id) as TransactionRow | undefined
  if (!row) return null
  return rowToTransaction(row, splitsByTransaction([id]).get(id) ?? [])
}

export function listTransactions(limit = 100, periodKey?: string): TransactionRecord[] {
  const query = `SELECT ${TXN_SELECT}
         FROM ledger_transactions t
         LEFT JOIN payees p ON p.id = t.payee_id`

  if (periodKey) {
    const { start, end } = periodBounds(periodKey)
    const rows = getDb()
      .prepare(
        `${query}
         WHERE t.occurred_at >= @start AND t.occurred_at <= @end
         ORDER BY t.occurred_at DESC LIMIT @limit`
      )
      .all({ start, end, limit }) as TransactionRow[]
    return attachSplits(rows)
  }

  const rows = getDb()
    .prepare(`${query} ORDER BY t.occurred_at DESC LIMIT ?`)
    .all(limit) as TransactionRow[]

  return attachSplits(rows)
}

/** Append-only edit history so every change stays inspectable and reversible. */
function recordAudit(
  db: ReturnType<typeof getDb>,
  transactionId: string,
  action: LedgerAuditAction,
  summary: string,
  snapshot: unknown
): void {
  db.prepare(
    `INSERT INTO ledger_transaction_audit (id, transaction_id, action, summary, snapshot_json, created_at)
     VALUES (@id, @transactionId, @action, @summary, @snapshot, @createdAt)`
  ).run({
    id: randomUUID(),
    transactionId,
    action,
    summary,
    snapshot: snapshot ? JSON.stringify(snapshot) : '',
    createdAt: new Date().toISOString()
  })
}

/** Insert a single ledger row inside an open transaction (shared by create/transfer). */
function insertTransactionRow(
  db: ReturnType<typeof getDb>,
  values: {
    id: string
    amountCents: number
    type: TransactionType
    status: TransactionRecord['status']
    categoryId: string | null
    payeeId: string | null
    memo: string
    notes: string
    tags: string
    occurredAt: string
    accountId: string | null
    transferAccountId: string | null
    transferGroupId: string | null
    createdAt: string
  }
): void {
  db.prepare(
    `INSERT INTO ledger_transactions
       (id, amount_cents, type, status, category_id, payee_id, memo, notes, tags,
        occurred_at, account_id, transfer_account_id, transfer_group_id, updated_at, created_at)
     VALUES
       (@id, @amountCents, @type, @status, @categoryId, @payeeId, @memo, @notes, @tags,
        @occurredAt, @accountId, @transferAccountId, @transferGroupId, NULL, @createdAt)`
  ).run(values)
}

export function createTransaction(input: CreateTransactionInput): TransactionRecord {
  const db = getDb()
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const payeeName = (input.payeeName ?? input.memo ?? '').trim()
  const payee = payeeName ? upsertPayeeByName(payeeName) : null
  const memo = (input.memo ?? payeeName).trim()
  const type = input.type ?? defaultTransactionType(input.amountCents)
  const status = input.status ?? 'cleared'
  const notes = (input.notes ?? '').trim()
  const tags = serializeTags(input.tags ?? [])

  const splits = (input.splits ?? []).filter((line) => line.amountCents !== 0)
  const isSplit = splits.length > 0

  if (isSplit) {
    const splitTotal = splits.reduce((sum, line) => sum + line.amountCents, 0)
    if (splitTotal !== input.amountCents) {
      throw new Error('Split lines must add up to the transaction amount')
    }
  }

  // A split row carries no parent category. Otherwise, fall back to a matching
  // auto-categorize rule when the user did not pick a category. Only expenses
  // auto-categorize — income, transfers and adjustments stay envelope-free.
  const directCategoryId = isSplit
    ? null
    : input.categoryId ??
      (type === 'expense' ? matchCategoryForTransaction(payeeName, memo) : null) ??
      null

  const run = db.transaction(() => {
    insertTransactionRow(db, {
      id,
      amountCents: input.amountCents,
      type,
      status,
      categoryId: directCategoryId,
      payeeId: payee?.id ?? null,
      memo,
      notes,
      tags,
      occurredAt: input.occurredAt,
      accountId: input.accountId ?? null,
      transferAccountId: null,
      transferGroupId: null,
      createdAt
    })

    if (isSplit) {
      const insertSplit = db.prepare(
        `INSERT INTO ledger_transaction_splits (id, transaction_id, category_id, amount_cents, memo, created_at)
         VALUES (@id, @transactionId, @categoryId, @amountCents, @memo, @createdAt)`
      )
      for (const line of splits) {
        insertSplit.run({
          id: randomUUID(),
          transactionId: id,
          categoryId: line.categoryId ?? null,
          amountCents: line.amountCents,
          memo: (line.memo ?? '').trim(),
          createdAt
        })
      }
    }

    recordAudit(
      db,
      id,
      'created',
      `Logged ${transactionTypeLabel(type).toLowerCase()} ${formatMoneyCents(input.amountCents)}`,
      null
    )
  })

  run()

  const created = fetchTransactionById(id)
  if (!created) throw new Error('Transaction insert failed')
  return created
}

export function updatePaycheck(input: UpdatePaycheckInput): PaycheckRecord {
  const existing = getDb()
    .prepare(
      'SELECT id, label, amount_cents, received_at, account_id, created_at FROM budget_paychecks WHERE id = ?'
    )
    .get(input.id) as
    | {
        id: string
        label: string
        amount_cents: number
        received_at: string
        account_id: string | null
        created_at: string
      }
    | undefined
  if (!existing) throw new Error('Paycheck not found')

  const label = input.label !== undefined ? input.label.trim() : existing.label
  if (!label) throw new Error('Label is required')
  const amountCents =
    input.amountCents !== undefined ? input.amountCents : existing.amount_cents
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive integer')
  }
  const receivedAt = input.receivedAt ?? existing.received_at
  const accountId =
    input.accountId !== undefined ? input.accountId : existing.account_id

  getDb()
    .prepare(
      `UPDATE budget_paychecks
       SET label = @label, amount_cents = @amountCents, received_at = @receivedAt, account_id = @accountId
       WHERE id = @id`
    )
    .run({ id: input.id, label, amountCents, receivedAt, accountId })

  return rowToPaycheck(
    getDb()
      .prepare(
        'SELECT id, label, amount_cents, received_at, account_id, created_at FROM budget_paychecks WHERE id = ?'
      )
      .get(input.id) as {
      id: string
      label: string
      amount_cents: number
      received_at: string
      account_id: string | null
      created_at: string
    }
  )
}

export function deletePaycheck(id: string): void {
  getDb().prepare('DELETE FROM budget_paychecks WHERE id = ?').run(id)
}

export function deleteCategory(id: string): void {
  getDb().prepare('DELETE FROM budget_categories WHERE id = ?').run(id)
}

// —— V2e: raw snapshots for reversible edits / undo ——

const RAW_TXN_COLUMNS = `id, amount_cents, type, status, category_id, payee_id, memo, notes, tags,
  occurred_at, account_id, transfer_account_id, transfer_group_id, updated_at, created_at`

interface RawTxnRow {
  id: string
  amount_cents: number
  type: string
  status: string
  category_id: string | null
  payee_id: string | null
  memo: string
  notes: string
  tags: string
  occurred_at: string
  account_id: string | null
  transfer_account_id: string | null
  transfer_group_id: string | null
  updated_at: string | null
  created_at: string
}

interface RawSplitRow {
  id: string
  transaction_id: string
  category_id: string | null
  amount_cents: number
  memo: string
  created_at: string
}

interface TxnSnapshotEntry {
  txn: RawTxnRow
  splits: RawSplitRow[]
}

type Db = ReturnType<typeof getDb>

function loadRawTransaction(db: Db, id: string): RawTxnRow | undefined {
  return db
    .prepare(`SELECT ${RAW_TXN_COLUMNS} FROM ledger_transactions WHERE id = ?`)
    .get(id) as RawTxnRow | undefined
}

function loadRawSplits(db: Db, transactionId: string): RawSplitRow[] {
  return db
    .prepare(
      `SELECT id, transaction_id, category_id, amount_cents, memo, created_at
       FROM ledger_transaction_splits WHERE transaction_id = ? ORDER BY created_at ASC`
    )
    .all(transactionId) as RawSplitRow[]
}

/** All rows in a transfer group, or just the single row. */
function loadTxnGroup(db: Db, row: RawTxnRow): RawTxnRow[] {
  if (!row.transfer_group_id) return [row]
  return db
    .prepare(`SELECT ${RAW_TXN_COLUMNS} FROM ledger_transactions WHERE transfer_group_id = ?`)
    .all(row.transfer_group_id) as RawTxnRow[]
}

function snapshotEntry(db: Db, id: string): TxnSnapshotEntry | null {
  const txn = loadRawTransaction(db, id)
  if (!txn) return null
  return { txn, splits: loadRawSplits(db, id) }
}

function rowExists(db: Db, table: 'budget_categories' | 'cash_accounts' | 'payees', id: string | null): boolean {
  if (!id) return false
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id))
}

/** Re-insert snapshot rows, nulling any FK target that vanished meanwhile. */
function reinsertSnapshots(db: Db, entries: TxnSnapshotEntry[]): void {
  for (const entry of entries) {
    const txn = entry.txn
    const categoryId = rowExists(db, 'budget_categories', txn.category_id) ? txn.category_id : null
    const accountId = rowExists(db, 'cash_accounts', txn.account_id) ? txn.account_id : null
    const transferAccountId = rowExists(db, 'cash_accounts', txn.transfer_account_id)
      ? txn.transfer_account_id
      : null
    const payeeId = rowExists(db, 'payees', txn.payee_id) ? txn.payee_id : null

    db.prepare(
      `INSERT INTO ledger_transactions
         (id, amount_cents, type, status, category_id, payee_id, memo, notes, tags,
          occurred_at, account_id, transfer_account_id, transfer_group_id, updated_at, created_at)
       VALUES
         (@id, @amountCents, @type, @status, @categoryId, @payeeId, @memo, @notes, @tags,
          @occurredAt, @accountId, @transferAccountId, @transferGroupId, @updatedAt, @createdAt)`
    ).run({
      id: txn.id,
      amountCents: txn.amount_cents,
      type: txn.type,
      status: txn.status,
      categoryId,
      payeeId,
      memo: txn.memo,
      notes: txn.notes,
      tags: txn.tags,
      occurredAt: txn.occurred_at,
      accountId,
      transferAccountId,
      transferGroupId: txn.transfer_group_id,
      updatedAt: txn.updated_at,
      createdAt: txn.created_at
    })

    for (const split of entry.splits) {
      const splitCategory = rowExists(db, 'budget_categories', split.category_id)
        ? split.category_id
        : null
      db.prepare(
        `INSERT INTO ledger_transaction_splits (id, transaction_id, category_id, amount_cents, memo, created_at)
         VALUES (@id, @transactionId, @categoryId, @amountCents, @memo, @createdAt)`
      ).run({
        id: split.id,
        transactionId: split.transaction_id,
        categoryId: splitCategory,
        amountCents: split.amount_cents,
        memo: split.memo,
        createdAt: split.created_at
      })
    }

    recordAudit(db, txn.id, 'restored', 'Restored a removed entry', null)
  }
}

export function deleteTransaction(id: string): DeleteTransactionResult {
  const db = getDb()
  const root = loadRawTransaction(db, id)
  if (!root) return { ok: true, undoToken: '' }

  const groupRows = loadTxnGroup(db, root)
  const entries: TxnSnapshotEntry[] = groupRows.map((txn) => ({
    txn,
    splits: loadRawSplits(db, txn.id)
  }))

  const run = db.transaction(() => {
    for (const entry of entries) {
      recordAudit(
        db,
        entry.txn.id,
        'deleted',
        `Removed ${transactionTypeLabel((entry.txn.type ?? 'expense') as TransactionType).toLowerCase()} ${formatMoneyCents(entry.txn.amount_cents)}`,
        entry
      )
      db.prepare('DELETE FROM ledger_transactions WHERE id = ?').run(entry.txn.id)
    }
  })
  run()

  return { ok: true, undoToken: JSON.stringify({ entries }) }
}

export function restoreDeletedTransaction(undoToken: string): { ok: true } {
  if (!undoToken) return { ok: true }
  let entries: TxnSnapshotEntry[]
  try {
    const parsed = JSON.parse(undoToken) as { entries?: TxnSnapshotEntry[] }
    entries = Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    throw new Error('Could not read undo data')
  }
  if (entries.length === 0) return { ok: true }

  const db = getDb()
  const run = db.transaction(() => {
    // Skip any rows that already exist (double-undo guard).
    const fresh = entries.filter((entry) => !loadRawTransaction(db, entry.txn.id))
    reinsertSnapshots(db, fresh)
  })
  run()
  return { ok: true }
}

function describeEdit(prev: TransactionRecord, next: TransactionRecord): string {
  const parts: string[] = []
  if (prev.amountCents !== next.amountCents) {
    parts.push(`amount ${formatMoneyCents(prev.amountCents)}→${formatMoneyCents(next.amountCents)}`)
  }
  if (prev.type !== next.type) {
    parts.push(`type ${transactionTypeLabel(prev.type)}→${transactionTypeLabel(next.type)}`)
  }
  if (prev.status !== next.status) {
    parts.push(
      `status ${transactionStatusLabel(prev.status)}→${transactionStatusLabel(next.status)}`
    )
  }
  if (prev.categoryId !== next.categoryId) parts.push('category')
  if (prev.occurredAt.slice(0, 10) !== next.occurredAt.slice(0, 10)) parts.push('date')
  if (prev.memo !== next.memo) parts.push('memo')
  if (prev.notes !== next.notes) parts.push('notes')
  if (prev.tags.join(',') !== next.tags.join(',')) parts.push('tags')
  if (prev.accountId !== next.accountId) parts.push('account')
  return parts.length > 0 ? `Edited · ${parts.join(' · ')}` : 'Edited'
}

/** Transfers only allow annotation/date/status edits; structure changes need delete + re-add. */
function updateTransferLeg(
  db: Db,
  prev: TransactionRecord,
  prevSnapshot: TxnSnapshotEntry | null,
  input: UpdateTransactionInput
): TransactionRecord {
  const memo = (input.memo ?? prev.memo).trim()
  const notes = (input.notes ?? '').trim()
  const tags = serializeTags(input.tags ?? [])
  const now = new Date().toISOString()

  const run = db.transaction(() => {
    // Date + status keep both legs in lockstep (same period, same reconcile state).
    db.prepare(
      `UPDATE ledger_transactions SET occurred_at = @occurredAt, status = @status, updated_at = @now
       WHERE transfer_group_id = @group`
    ).run({ occurredAt: input.occurredAt, status: input.status, now, group: prev.transferGroupId })
    // Annotations stay per-leg.
    db.prepare(
      `UPDATE ledger_transactions SET memo = @memo, notes = @notes, tags = @tags, updated_at = @now
       WHERE id = @id`
    ).run({ memo, notes, tags, now, id: prev.id })

    const updated = fetchTransactionById(prev.id)
    recordAudit(db, prev.id, 'edited', updated ? describeEdit(prev, updated) : 'Edited', prevSnapshot)
  })
  run()

  const updated = fetchTransactionById(prev.id)
  if (!updated) throw new Error('Transfer update failed')
  return updated
}

export function updateTransaction(input: UpdateTransactionInput): TransactionRecord {
  const db = getDb()
  const prev = fetchTransactionById(input.id)
  if (!prev) throw new Error('Transaction not found')
  const prevSnapshot = snapshotEntry(db, input.id)

  if (prev.transferGroupId) {
    return updateTransferLeg(db, prev, prevSnapshot, input)
  }

  const type = input.type
  if (type === 'transfer') throw new Error('Use a transfer to move money between accounts')
  if (input.amountCents === 0) throw new Error('Amount cannot be zero')
  if (type === 'income' && input.amountCents < 0) throw new Error('Income must be positive')
  if (type === 'expense' && input.amountCents > 0) throw new Error('Expense must be negative')

  const payeeName = (input.payeeName ?? input.memo ?? '').trim()
  const payee = payeeName ? upsertPayeeByName(payeeName) : null
  const memo = (input.memo ?? payeeName).trim()
  const notes = (input.notes ?? '').trim()
  const tags = serializeTags(input.tags ?? [])

  const splits = (input.splits ?? []).filter((line) => line.amountCents !== 0)
  const isSplit = splits.length > 0
  if (isSplit) {
    const splitTotal = splits.reduce((sum, line) => sum + line.amountCents, 0)
    if (splitTotal !== input.amountCents) {
      throw new Error('Split lines must add up to the transaction amount')
    }
  }
  const categoryId = isSplit ? null : input.categoryId ?? null
  const now = new Date().toISOString()

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE ledger_transactions SET
         amount_cents = @amountCents, type = @type, status = @status, category_id = @categoryId,
         payee_id = @payeeId, memo = @memo, notes = @notes, tags = @tags, occurred_at = @occurredAt,
         account_id = @accountId, updated_at = @now
       WHERE id = @id`
    ).run({
      id: input.id,
      amountCents: input.amountCents,
      type,
      status: input.status,
      categoryId,
      payeeId: payee?.id ?? null,
      memo,
      notes,
      tags,
      occurredAt: input.occurredAt,
      accountId: input.accountId ?? null,
      now
    })

    db.prepare('DELETE FROM ledger_transaction_splits WHERE transaction_id = ?').run(input.id)
    if (isSplit) {
      const insertSplit = db.prepare(
        `INSERT INTO ledger_transaction_splits (id, transaction_id, category_id, amount_cents, memo, created_at)
         VALUES (@id, @transactionId, @categoryId, @amountCents, @memo, @createdAt)`
      )
      for (const line of splits) {
        insertSplit.run({
          id: randomUUID(),
          transactionId: input.id,
          categoryId: line.categoryId ?? null,
          amountCents: line.amountCents,
          memo: (line.memo ?? '').trim(),
          createdAt: now
        })
      }
    }

    const updated = fetchTransactionById(input.id)
    recordAudit(db, input.id, 'edited', updated ? describeEdit(prev, updated) : 'Edited', prevSnapshot)
  })
  run()

  const updated = fetchTransactionById(input.id)
  if (!updated) throw new Error('Transaction update failed')
  return updated
}

export function setTransactionStatus(input: SetTransactionStatusInput): TransactionRecord {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare('UPDATE ledger_transactions SET status = @status, updated_at = @now WHERE id = @id').run({
    status: input.status,
    now,
    id: input.id
  })
  const updated = fetchTransactionById(input.id)
  if (!updated) throw new Error('Transaction not found')
  return updated
}

export function createTransfer(input: CreateTransferInput): TransactionRecord[] {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error('Choose two different accounts')
  }
  if (input.amountCents <= 0) {
    throw new Error('Transfer amount must be positive')
  }

  const db = getDb()
  const fromName = (
    db.prepare('SELECT name FROM cash_accounts WHERE id = ?').get(input.fromAccountId) as
      | { name: string }
      | undefined
  )?.name
  const toName = (
    db.prepare('SELECT name FROM cash_accounts WHERE id = ?').get(input.toAccountId) as
      | { name: string }
      | undefined
  )?.name
  if (!fromName || !toName) throw new Error('Transfer account not found')

  const groupId = randomUUID()
  const fromId = randomUUID()
  const toId = randomUUID()
  const createdAt = new Date().toISOString()
  const status = input.status ?? 'cleared'
  const notes = (input.notes ?? '').trim()
  const tags = serializeTags(input.tags ?? [])
  const userMemo = (input.memo ?? '').trim()

  const run = db.transaction(() => {
    insertTransactionRow(db, {
      id: fromId,
      amountCents: -input.amountCents,
      type: 'transfer',
      status,
      categoryId: null,
      payeeId: null,
      memo: userMemo || `Transfer to ${toName}`,
      notes,
      tags,
      occurredAt: input.occurredAt,
      accountId: input.fromAccountId,
      transferAccountId: input.toAccountId,
      transferGroupId: groupId,
      createdAt
    })
    insertTransactionRow(db, {
      id: toId,
      amountCents: input.amountCents,
      type: 'transfer',
      status,
      categoryId: null,
      payeeId: null,
      memo: userMemo || `Transfer from ${fromName}`,
      notes,
      tags,
      occurredAt: input.occurredAt,
      accountId: input.toAccountId,
      transferAccountId: input.fromAccountId,
      transferGroupId: groupId,
      createdAt
    })
    const summary = `Transfer ${formatMoneyCents(input.amountCents)} · ${fromName} → ${toName}`
    recordAudit(db, fromId, 'created', summary, null)
    recordAudit(db, toId, 'created', summary, null)
  })
  run()

  return [fetchTransactionById(fromId), fetchTransactionById(toId)].filter(
    (txn): txn is TransactionRecord => txn !== null
  )
}

export function getTransactionAudit(transactionId: string): LedgerAuditRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, transaction_id, action, summary, created_at
       FROM ledger_transaction_audit WHERE transaction_id = ? ORDER BY created_at DESC, rowid DESC`
    )
    .all(transactionId) as Array<{
    id: string
    transaction_id: string
    action: string
    summary: string
    created_at: string
  }>

  return rows.map((row) => ({
    id: row.id,
    transactionId: row.transaction_id,
    action: row.action as LedgerAuditAction,
    summary: row.summary,
    createdAt: row.created_at
  }))
}

/** Roll a row back to the state captured before its most recent edit. */
export function revertTransaction(id: string): TransactionRecord {
  const db = getDb()
  const auditRow = db
    .prepare(
      `SELECT snapshot_json FROM ledger_transaction_audit
       WHERE transaction_id = ? AND action = 'edited' AND snapshot_json != ''
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(id) as { snapshot_json: string } | undefined
  if (!auditRow) throw new Error('No earlier version to revert to')

  let snapshot: TxnSnapshotEntry
  try {
    snapshot = JSON.parse(auditRow.snapshot_json) as TxnSnapshotEntry
  } catch {
    throw new Error('Could not read the earlier version')
  }
  if (!snapshot.txn) throw new Error('Could not read the earlier version')

  const run = db.transaction(() => {
    const txn = snapshot.txn
    const categoryId = rowExists(db, 'budget_categories', txn.category_id) ? txn.category_id : null
    const accountId = rowExists(db, 'cash_accounts', txn.account_id) ? txn.account_id : null
    const transferAccountId = rowExists(db, 'cash_accounts', txn.transfer_account_id)
      ? txn.transfer_account_id
      : null
    const payeeId = rowExists(db, 'payees', txn.payee_id) ? txn.payee_id : null

    db.prepare(
      `UPDATE ledger_transactions SET
         amount_cents = @amountCents, type = @type, status = @status, category_id = @categoryId,
         payee_id = @payeeId, memo = @memo, notes = @notes, tags = @tags, occurred_at = @occurredAt,
         account_id = @accountId, transfer_account_id = @transferAccountId,
         transfer_group_id = @transferGroupId, updated_at = @now
       WHERE id = @id`
    ).run({
      id: txn.id,
      amountCents: txn.amount_cents,
      type: txn.type,
      status: txn.status,
      categoryId,
      payeeId,
      memo: txn.memo,
      notes: txn.notes,
      tags: txn.tags,
      occurredAt: txn.occurred_at,
      accountId,
      transferAccountId,
      transferGroupId: txn.transfer_group_id,
      now: new Date().toISOString()
    })

    db.prepare('DELETE FROM ledger_transaction_splits WHERE transaction_id = ?').run(id)
    for (const split of snapshot.splits ?? []) {
      const splitCategory = rowExists(db, 'budget_categories', split.category_id)
        ? split.category_id
        : null
      db.prepare(
        `INSERT INTO ledger_transaction_splits (id, transaction_id, category_id, amount_cents, memo, created_at)
         VALUES (@id, @transactionId, @categoryId, @amountCents, @memo, @createdAt)`
      ).run({
        id: split.id,
        transactionId: split.transaction_id,
        categoryId: splitCategory,
        amountCents: split.amount_cents,
        memo: split.memo,
        createdAt: split.created_at
      })
    }

    recordAudit(db, id, 'restored', 'Reverted to an earlier version', null)
  })
  run()

  const reverted = fetchTransactionById(id)
  if (!reverted) throw new Error('Revert failed')
  return reverted
}

export function getReconciliationSummary(accountId: string): ReconciliationSummary {
  const db = getDb()
  const account = db
    .prepare('SELECT starting_balance_cents FROM cash_accounts WHERE id = ?')
    .get(accountId) as { starting_balance_cents: number } | undefined
  if (!account) throw new Error('Account not found')

  const starting = account.starting_balance_cents
  const ledgerAll = (
    db
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_transactions WHERE account_id = ?')
      .get(accountId) as { total: number }
  ).total
  const ledgerCleared = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_transactions
         WHERE account_id = ? AND status IN ('cleared', 'reconciled')`
      )
      .get(accountId) as { total: number }
  ).total
  const pending = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS count
       FROM ledger_transactions WHERE account_id = ? AND status = 'pending'`
    )
    .get(accountId) as { total: number; count: number }
  const unreconciled = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM ledger_transactions WHERE account_id = ? AND status = 'cleared'`
      )
      .get(accountId) as { count: number }
  ).count
  // Paychecks deposited to this account are recorded income — always cleared.
  const paychecks = (
    db
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM budget_paychecks WHERE account_id = ?')
      .get(accountId) as { total: number }
  ).total

  return {
    accountId,
    workingBalanceCents: starting + ledgerAll + paychecks,
    clearedBalanceCents: starting + ledgerCleared + paychecks,
    pendingCents: pending.total,
    pendingCount: pending.count,
    unreconciledCount: unreconciled
  }
}

/** Lock every cleared row on an account as reconciled (account-wide, not just one period). */
export function reconcileClearedForAccount(accountId: string): { ok: true; count: number } {
  const result = getDb()
    .prepare(
      `UPDATE ledger_transactions SET status = 'reconciled', updated_at = @now
       WHERE account_id = @accountId AND status = 'cleared'`
    )
    .run({ now: new Date().toISOString(), accountId })
  return { ok: true, count: result.changes }
}

function sumPaychecksForPeriod(periodKey: string): number {
  return listPaychecks()
    .filter((paycheck) => isInPeriod(paycheck.receivedAt, periodKey))
    .reduce((sum, paycheck) => sum + paycheck.amountCents, 0)
}

function assignmentsForPeriod(periodKey: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      'SELECT category_id, amount_cents FROM budget_assignments WHERE period_key = ?'
    )
    .all(periodKey) as Array<{ category_id: string; amount_cents: number }>

  return new Map(rows.map((row) => [row.category_id, row.amount_cents]))
}

function spentByCategoryForPeriod(periodKey: string): Map<string, number> {
  // SQL aggregates, not a row scan — a LIMIT here would silently under-report
  // envelope spending once a month passes that many transactions.
  const { start, end } = periodBounds(periodKey)
  const db = getDb()
  const spent = new Map<string, number>()
  const add = (categoryId: string | null, amount: number): void => {
    if (!categoryId || amount <= 0) return
    spent.set(categoryId, (spent.get(categoryId) ?? 0) + amount)
  }

  // Split parents carry no category, so direct + split lines never double-count.
  const direct = db
    .prepare(
      `SELECT category_id, COALESCE(SUM(ABS(amount_cents)), 0) AS spent
       FROM ledger_transactions
       WHERE category_id IS NOT NULL AND amount_cents < 0
         AND occurred_at >= ? AND occurred_at <= ?
       GROUP BY category_id`
    )
    .all(start, end) as Array<{ category_id: string; spent: number }>
  for (const row of direct) add(row.category_id, row.spent)

  const split = db
    .prepare(
      `SELECT s.category_id AS category_id, COALESCE(SUM(ABS(s.amount_cents)), 0) AS spent
       FROM ledger_transaction_splits s
       JOIN ledger_transactions t ON t.id = s.transaction_id
       WHERE s.category_id IS NOT NULL AND s.amount_cents < 0
         AND t.occurred_at >= ? AND t.occurred_at <= ?
       GROUP BY s.category_id`
    )
    .all(start, end) as Array<{ category_id: string; spent: number }>
  for (const row of split) add(row.category_id, row.spent)

  return spent
}

/**
 * Carry-forward (true envelope / Actual-style) cumulative helpers. period_key is
 * "YYYY-MM" so a lexical `<=` is a chronological "up to and including this period".
 * Ledger spend and paychecks are dated, so they use the period's end timestamp.
 */
function cumulativeAssignedByCategory(periodKey: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT category_id, COALESCE(SUM(amount_cents), 0) AS total
       FROM budget_assignments WHERE period_key <= ? GROUP BY category_id`
    )
    .all(periodKey) as Array<{ category_id: string; total: number }>
  return new Map(rows.map((row) => [row.category_id, row.total]))
}

function cumulativeAssignedTotal(periodKey: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM budget_assignments WHERE period_key <= ?`
    )
    .get(periodKey) as { total: number }
  return row.total
}

function cumulativePaycheckTotal(periodKey: string): number {
  const { end } = periodBounds(periodKey)
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM budget_paychecks WHERE received_at <= ?`)
    .get(end) as { total: number }
  return row.total
}

function cumulativeSpentByCategory(periodKey: string): Map<string, number> {
  const { end } = periodBounds(periodKey)
  const db = getDb()
  const spent = new Map<string, number>()
  const add = (categoryId: string | null, amount: number): void => {
    if (!categoryId || amount <= 0) return
    spent.set(categoryId, (spent.get(categoryId) ?? 0) + amount)
  }

  const direct = db
    .prepare(
      `SELECT category_id, COALESCE(SUM(ABS(amount_cents)), 0) AS spent
       FROM ledger_transactions
       WHERE category_id IS NOT NULL AND amount_cents < 0 AND occurred_at <= ?
       GROUP BY category_id`
    )
    .all(end) as Array<{ category_id: string; spent: number }>
  for (const row of direct) add(row.category_id, row.spent)

  const split = db
    .prepare(
      `SELECT s.category_id AS category_id, COALESCE(SUM(ABS(s.amount_cents)), 0) AS spent
       FROM ledger_transaction_splits s
       JOIN ledger_transactions t ON t.id = s.transaction_id
       WHERE s.category_id IS NOT NULL AND s.amount_cents < 0 AND t.occurred_at <= ?
       GROUP BY s.category_id`
    )
    .all(end) as Array<{ category_id: string; spent: number }>
  for (const row of split) add(row.category_id, row.spent)

  return spent
}

const ROLLOVER_ON_SEAL_HEAL_KEY = 'money_heal_rollover_on_seal_v1'

/**
 * Heal profiles corrupted by pre-5af8bd0 rollover ON-toggle that sealed full available into
 * rollover_released_cents (assignment looked eaten / phantom rollover). One-shot per profile:
 * guarded by ROLLOVER_ON_SEAL_HEAL_KEY so budget reads stay read-only afterwards.
 */
function healLegacyRolloverOnSeal(periodKey: string): void {
  const db = getDb()
  const alreadyHealed = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(ROLLOVER_ON_SEAL_HEAL_KEY) as { value: string } | undefined
  if (alreadyHealed?.value === '1') return

  const categories = listCategories()
  const assignments = assignmentsForPeriod(periodKey)
  const spent = spentByCategoryForPeriod(periodKey)
  const cumulativeAssigned = cumulativeAssignedByCategory(periodKey)
  const cumulativeSpent = cumulativeSpentByCategory(periodKey)
  const heal = db.prepare(
    'UPDATE budget_categories SET rollover_released_cents = rollover_released_cents - ? WHERE id = ?'
  )

  for (const category of categories) {
    if (!category.rolloverEnabled || category.rolloverReleasedCents <= 0) continue

    const assignedCents = assignments.get(category.id) ?? 0
    const spentCents = spent.get(category.id) ?? 0
    const availableCents =
      (cumulativeAssigned.get(category.id) ?? 0) -
      (cumulativeSpent.get(category.id) ?? 0) -
      category.rolloverReleasedCents
    const periodSurplus = assignedCents - spentCents
    if (periodSurplus <= 0 || availableCents >= periodSurplus) continue

    const healAmount = Math.min(category.rolloverReleasedCents, periodSurplus - availableCents)
    if (healAmount > 0) {
      heal.run(healAmount, category.id)
    }
  }

  // Mark the profile healed whether or not anything needed adjusting, so this
  // never runs (or writes) on a budget read again.
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(ROLLOVER_ON_SEAL_HEAL_KEY, '1', new Date().toISOString())
}

export function coverOverspending(input: CoverOverspendingInput): void {
  const overview = getBudgetOverview(input.periodKey)
  const targetRow = overview.categories.find((row) => row.category.id === input.categoryId)
  if (!targetRow || targetRow.remainingCents >= 0) return

  const need = Math.abs(targetRow.remainingCents)
  const targetAssigned = targetRow.assignedCents

  if (input.source === 'pool') {
    const amount = Math.min(need, Math.max(0, overview.unassignedCents))
    if (amount <= 0) return
    setAssignment({
      categoryId: input.categoryId,
      periodKey: input.periodKey,
      amountCents: targetAssigned + amount
    })
    return
  }

  if (!input.sourceCategoryId) throw new Error('Source envelope required')

  const sourceRow = overview.categories.find((row) => row.category.id === input.sourceCategoryId)
  if (!sourceRow) throw new Error('Source envelope not found')

  const amount = Math.min(need, sourceRow.remainingCents)
  if (amount <= 0) throw new Error('Insufficient funds in source envelope')

  const db = getDb()
  const run = db.transaction(() => {
    setAssignment({
      categoryId: input.sourceCategoryId!,
      periodKey: input.periodKey,
      amountCents: sourceRow.assignedCents - amount
    })
    setAssignment({
      categoryId: input.categoryId,
      periodKey: input.periodKey,
      amountCents: targetAssigned + amount
    })
  })
  run()
}

export function getBudgetOverview(periodKey = currentPeriodKey()): MoneyBudgetOverview {
  healLegacyRolloverOnSeal(periodKey)
  const categories = listCategories()
  const assignments = assignmentsForPeriod(periodKey) // this period only
  const spent = spentByCategoryForPeriod(periodKey) // this period only
  const cumulativeAssigned = cumulativeAssignedByCategory(periodKey)
  const cumulativeSpent = cumulativeSpentByCategory(periodKey)
  const paycheckTotalCents = sumPaychecksForPeriod(periodKey) // this period income

  // Rollover is opt-in. released_cents = pile permanently moved to "to assign" when
  // rollover was turned off. Default-off envelopes still virtual-return carryIn each period.
  const releasedPoolCents = categories.reduce((sum, category) => sum + category.rolloverReleasedCents, 0)
  let returnedToPoolCents = 0
  const categoryRows: CategoryBudgetRow[] = categories.map((category) => {
    const assignedCents = assignments.get(category.id) ?? 0
    const spentCents = spent.get(category.id) ?? 0
    const availableCents =
      (cumulativeAssigned.get(category.id) ?? 0) -
      (cumulativeSpent.get(category.id) ?? 0) -
      category.rolloverReleasedCents
    const carryInCents = availableCents - assignedCents + spentCents
    if (category.rolloverEnabled) {
      return {
        category,
        assignedCents,
        spentCents,
        carryInCents,
        remainingCents: availableCents,
        targetCents: category.targetCents
      }
    }
    // Rollover off: this period stands alone. Default-off envelopes virtual-return carryIn;
    // materialized releases (rollover_released_cents) already credit the pool — skip carryIn.
    if (category.rolloverReleasedCents === 0) {
      returnedToPoolCents += carryInCents
    }
    return {
      category,
      assignedCents,
      spentCents,
      carryInCents,
      remainingCents: assignedCents - spentCents,
      targetCents: category.targetCents
    }
  })

  const assignedTotalCents = categoryRows.reduce((sum, row) => sum + row.assignedCents, 0)
  const unassignedCents =
    cumulativePaycheckTotal(periodKey) -
    cumulativeAssignedTotal(periodKey) +
    releasedPoolCents +
    returnedToPoolCents
  const overspent = categoryRows
    .filter((row) => row.remainingCents < 0)
    .map((row) => ({
      categoryId: row.category.id,
      name: row.category.name,
      remainingCents: row.remainingCents
    }))

  return {
    periodKey,
    paycheckTotalCents,
    assignedTotalCents,
    unassignedCents,
    groups: listCategoryGroups(),
    categories: categoryRows,
    overspent,
    paychecks: listPaychecks().filter((paycheck) => isInPeriod(paycheck.receivedAt, periodKey))
  }
}

export function getMoneySummary(periodKey = currentPeriodKey()): MoneySummary {
  const budget = getBudgetOverview(periodKey)
  // Net flow = income minus spending. Transfers between own accounts are excluded
  // (they're internal moves, not income/expense) so the figure stays honest.
  // SQL SUM over the whole period — never a LIMITed row scan.
  const { start, end } = periodBounds(periodKey)
  const ledgerNetCents = (
    getDb()
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_transactions
         WHERE type != 'transfer' AND occurred_at >= ? AND occurred_at <= ?`
      )
      .get(start, end) as { total: number }
  ).total
  const monthFlowCents = budget.paycheckTotalCents + ledgerNetCents
  const portfolio = portfolioTotalsFromHoldings()

  const hasData =
    budget.paychecks.length > 0 ||
    budget.categories.some((row) => row.assignedCents > 0 || row.spentCents > 0) ||
    ledgerNetCents !== 0 ||
    portfolio.totalCents > 0

  let headline = 'Position · flow · confidence'
  if (hasData) {
    if (budget.unassignedCents > 0 && budget.paycheckTotalCents > 0) {
      headline = 'Safe to assign'
    } else if (monthFlowCents >= 0) {
      headline = 'Positive flow continues'
    } else {
      headline = 'Spending ahead this month'
    }
  }

  const doorParts: string[] = []
  if (hasData) {
    doorParts.push(headline)
    if (budget.paycheckTotalCents > 0) {
      doorParts.push(`${formatMoneyCents(budget.unassignedCents)} to assign`)
    }
    doorParts.push(`${formatMoneyCents(monthFlowCents)} flow`)
  }

  return {
    periodKey,
    monthFlowCents,
    ledgerNetCents,
    unassignedCents: budget.unassignedCents,
    paycheckTotalCents: budget.paycheckTotalCents,
    assignedTotalCents: budget.assignedTotalCents,
    hasData,
    headline,
    doorDetail: hasData ? doorParts.join(' · ') : headline
  }
}

export function getMoneyDoorSnapshot(periodKey = currentPeriodKey()): MoneyDoorSnapshot {
  const budget = getBudgetOverview(periodKey)
  const summary = getMoneySummary(periodKey)

  const assignedRows = budget.categories
    .filter((row) => row.assignedCents > 0)
    .sort((a, b) => b.assignedCents - a.assignedCents)

  const envelopes = assignedRows.slice(0, 3).map((row) => ({
    categoryId: row.category.id,
    name: row.category.name,
    assignedCents: row.assignedCents,
    spentCents: row.spentCents,
    remainingCents: row.remainingCents
  }))

  const allocation =
    budget.assignedTotalCents > 0
      ? assignedRows.slice(0, 5).map((row) => ({
          categoryId: row.category.id,
          name: row.category.name,
          assignedCents: row.assignedCents,
          percent: Math.round((row.assignedCents / budget.assignedTotalCents) * 100)
        }))
      : undefined

  const income = budget.paycheckTotalCents
  const retentionPct =
    income > 0
      ? Math.round(Math.max(0, Math.min(100, (summary.monthFlowCents / income) * 100)))
      : undefined

  const flowTrendCents: number[] = []
  for (let offset = 5; offset >= 0; offset -= 1) {
    const key = shiftPeriodKey(periodKey, -offset)
    const periodBudget = offset === 0 ? budget : getBudgetOverview(key)
    const periodSummary = offset === 0 ? summary : getMoneySummary(key)
    if (periodBudget.paycheckTotalCents > 0 || periodSummary.ledgerNetCents !== 0) {
      flowTrendCents.push(periodSummary.monthFlowCents)
    }
  }

  const portfolio = portfolioTotalsFromHoldings()

  return {
    summary,
    envelopes,
    portfolioTotalCents: portfolio.totalCents,
    quotesStale: portfolio.quotesStale,
    retentionPct,
    allocation,
    flowTrendCents: flowTrendCents.length >= 2 ? flowTrendCents : undefined
  }
}

const INVESTMENT_ACCOUNT_TYPES = new Set(['401k', 'brokerage', 'ira', 'other'])

function rowToInvestmentAccount(row: {
  id: string
  label: string
  account_type: string
  notes: string
  created_at: string
}): InvestmentAccountRecord {
  return {
    id: row.id,
    label: row.label,
    accountType: row.account_type as InvestmentAccountRecord['accountType'],
    notes: row.notes,
    createdAt: row.created_at
  }
}

function rowToInvestmentSnapshot(row: {
  id: string
  account_id: string
  value_cents: number
  as_of: string
  memo: string
  created_at: string
}): InvestmentSnapshotRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    valueCents: row.value_cents,
    asOf: row.as_of,
    memo: row.memo,
    createdAt: row.created_at
  }
}

function latestSnapshotForAccount(accountId: string): InvestmentSnapshotRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, account_id, value_cents, as_of, memo, created_at
       FROM investment_snapshots
       WHERE account_id = ?
       ORDER BY as_of DESC, created_at DESC
       LIMIT 1`
    )
    .get(accountId) as
    | {
        id: string
        account_id: string
        value_cents: number
        as_of: string
        memo: string
        created_at: string
      }
    | undefined

  return row ? rowToInvestmentSnapshot(row) : null
}

export function getInvestmentsOverview(): InvestmentsOverview {
  const accounts = listInvestmentAccounts()
  const portfolio = portfolioTotalsFromHoldings()

  const rows: InvestmentAccountRow[] = accounts.map((account) => {
    const holdings = listHoldingsForAccount(account.id)
    const holdingsValue = holdings.reduce((sum, h) => sum + h.marketValueCents, 0)
    const snapshotValue = latestSnapshotForAccount(account.id)?.valueCents ?? 0
    const valueCents = holdings.length > 0 ? holdingsValue : snapshotValue

    return {
      account,
      latestSnapshot: latestSnapshotForAccount(account.id),
      holdings,
      valueCents
    }
  })

  const snapshotTotal = rows.reduce(
    (sum, row) => sum + (row.latestSnapshot?.valueCents ?? 0),
    0
  )
  const holdingsTotal = portfolio.totalCents
  const totalCents = holdingsTotal > 0 ? holdingsTotal : snapshotTotal

  return normalizeInvestmentsOverview(
    enrichInvestmentsOverview({
      accounts: rows,
      totalCents,
      holdingsTotalCents: holdingsTotal,
      quotesStale: portfolio.quotesStale
    })
  )
}

export function listInvestmentAccounts(): InvestmentAccountRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, label, account_type, notes, created_at
       FROM investment_accounts
       ORDER BY label ASC`
    )
    .all() as Array<{
    id: string
    label: string
    account_type: string
    notes: string
    created_at: string
  }>

  return rows.map(rowToInvestmentAccount)
}

export function listInvestmentSnapshots(accountId: string, limit = 12): InvestmentSnapshotRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, account_id, value_cents, as_of, memo, created_at
       FROM investment_snapshots
       WHERE account_id = ?
       ORDER BY as_of DESC, created_at DESC
       LIMIT ?`
    )
    .all(accountId, limit) as Array<{
    id: string
    account_id: string
    value_cents: number
    as_of: string
    memo: string
    created_at: string
  }>

  return rows.map(rowToInvestmentSnapshot)
}

export function createInvestmentAccount(input: CreateInvestmentAccountInput): InvestmentAccountRecord {
  if (!INVESTMENT_ACCOUNT_TYPES.has(input.accountType)) {
    throw new Error('Invalid investment account type')
  }

  const id = randomUUID()
  const createdAt = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO investment_accounts (id, label, account_type, notes, created_at)
       VALUES (@id, @label, @accountType, @notes, @createdAt)`
    )
    .run({
      id,
      label: input.label.trim(),
      accountType: input.accountType,
      notes: (input.notes ?? '').trim(),
      createdAt
    })

  return rowToInvestmentAccount(
    getDb()
      .prepare(
        `SELECT id, label, account_type, notes, created_at FROM investment_accounts WHERE id = ?`
      )
      .get(id) as {
      id: string
      label: string
      account_type: string
      notes: string
      created_at: string
    }
  )
}

export function createInvestmentSnapshot(
  input: CreateInvestmentSnapshotInput
): InvestmentSnapshotRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO investment_snapshots (id, account_id, value_cents, as_of, memo, created_at)
       VALUES (@id, @accountId, @valueCents, @asOf, @memo, @createdAt)`
    )
    .run({
      id,
      accountId: input.accountId,
      valueCents: input.valueCents,
      asOf: input.asOf,
      memo: (input.memo ?? '').trim(),
      createdAt
    })

  return rowToInvestmentSnapshot(
    getDb()
      .prepare(
        `SELECT id, account_id, value_cents, as_of, memo, created_at
         FROM investment_snapshots WHERE id = ?`
      )
      .get(id) as {
      id: string
      account_id: string
      value_cents: number
      as_of: string
      memo: string
      created_at: string
    }
  )
}

export function deleteInvestmentAccount(id: string): void {
  getDb().prepare('DELETE FROM investment_accounts WHERE id = ?').run(id)
}

export function deleteInvestmentSnapshot(id: string): void {
  getDb().prepare('DELETE FROM investment_snapshots WHERE id = ?').run(id)
}

export {
  createCategoryGroup,
  createInvestmentHolding,
  deleteCategoryGroup,
  deleteInvestmentHolding,
  listPayees,
  refreshInvestmentQuotes,
  renameCategoryGroup,
  transferAssignment,
  updateInvestmentHolding
} from './moneyS'

export {
  createInvestmentActivity,
  deleteInvestmentActivity
} from './moneyInvestments'

export {
  createCashAccount,
  createBudgetRule,
  createSchedule,
  deleteBudgetRule,
  deleteCashAccount,
  deleteSchedule,
  listBudgetRules,
  listCashAccounts,
  listSchedules,
  postSchedule
} from './moneyV2'

export {
  contributeToSavingsGoal,
  createSavingsGoal,
  deleteSavingsGoal,
  getSavingsOverview,
  listSavingsCategoryIds,
  listSavingsGoals
} from './moneySavings'

export {
  createReportPreset,
  deleteReportPreset,
  getMoneyReportsOverview,
  listReportPresets
} from './moneyReports'
