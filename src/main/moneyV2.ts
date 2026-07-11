import { randomUUID } from 'node:crypto'
import type {
  BudgetRuleRecord,
  CashAccountBalance,
  CashAccountRecord,
  CreateBudgetRuleInput,
  CreateCashAccountInput,
  CreateScheduleInput,
  ScheduleRecord
} from '@shared/money'
import { advanceScheduleDate } from '@shared/money'
import { getDb } from './database'
import { upsertPayeeByName } from './moneyS'

const CASH_ACCOUNT_TYPES = new Set(['checking', 'savings', 'cash', 'credit', 'other'])
const SCHEDULE_KINDS = new Set(['income', 'bill'])
const SCHEDULE_CADENCES = new Set(['weekly', 'biweekly', 'monthly'])
const RULE_FIELDS = new Set(['payee', 'memo'])
const RULE_TYPES = new Set(['contains', 'equals'])

/** Local noon ISO for a YYYY-MM-DD occurrence date (keeps it inside the right period). */
function occurrenceIso(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0).toISOString()
}

// —— Cash accounts ——

function rowToCashAccount(row: {
  id: string
  name: string
  type: string
  starting_balance_cents: number
  sort_order: number
  archived: number
  created_at: string
}): CashAccountRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CashAccountRecord['type'],
    startingBalanceCents: row.starting_balance_cents,
    sortOrder: row.sort_order,
    archived: row.archived === 1,
    createdAt: row.created_at
  }
}

function accountActivityCents(accountId: string): number {
  const ledger = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_transactions WHERE account_id = ?`
    )
    .get(accountId) as { total: number }
  const paychecks = getDb()
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM budget_paychecks WHERE account_id = ?`
    )
    .get(accountId) as { total: number }
  return ledger.total + paychecks.total
}

export function listCashAccounts(): CashAccountBalance[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, type, starting_balance_cents, sort_order, archived, created_at
       FROM cash_accounts ORDER BY sort_order ASC, created_at ASC`
    )
    .all() as Array<{
    id: string
    name: string
    type: string
    starting_balance_cents: number
    sort_order: number
    archived: number
    created_at: string
  }>

  return rows.map((row) => {
    const account = rowToCashAccount(row)
    return {
      ...account,
      balanceCents: account.startingBalanceCents + accountActivityCents(account.id)
    }
  })
}

export function createCashAccount(input: CreateCashAccountInput): CashAccountRecord {
  if (!CASH_ACCOUNT_TYPES.has(input.type)) {
    throw new Error('Invalid cash account type')
  }

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const sortOrder =
    (getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM cash_accounts')
      .get() as { max_order: number }).max_order + 1

  getDb()
    .prepare(
      `INSERT INTO cash_accounts (id, name, type, starting_balance_cents, sort_order, archived, created_at)
       VALUES (@id, @name, @type, @startingBalanceCents, @sortOrder, 0, @createdAt)`
    )
    .run({
      id,
      name: input.name.trim(),
      type: input.type,
      startingBalanceCents: input.startingBalanceCents ?? 0,
      sortOrder,
      createdAt
    })

  return rowToCashAccount(
    getDb()
      .prepare(
        `SELECT id, name, type, starting_balance_cents, sort_order, archived, created_at
         FROM cash_accounts WHERE id = ?`
      )
      .get(id) as {
      id: string
      name: string
      type: string
      starting_balance_cents: number
      sort_order: number
      archived: number
      created_at: string
    }
  )
}

export function deleteCashAccount(id: string): void {
  // account_id on transactions/paychecks was added via ensureColumn (no real FK),
  // so detach those rows explicitly — keep their history, just drop the account link.
  const db = getDb()
  const run = db.transaction(() => {
    db.prepare('UPDATE ledger_transactions SET account_id = NULL WHERE account_id = ?').run(id)
    db.prepare(
      'UPDATE ledger_transactions SET transfer_account_id = NULL WHERE transfer_account_id = ?'
    ).run(id)
    db.prepare('UPDATE budget_paychecks SET account_id = NULL WHERE account_id = ?').run(id)
    db.prepare('DELETE FROM cash_accounts WHERE id = ?').run(id)
  })
  run()
}

// —— Schedules (income & recurring bills) ——

function rowToSchedule(row: {
  id: string
  kind: string
  label: string
  amount_cents: number
  category_id: string | null
  account_id: string | null
  cadence: string
  next_date: string
  last_posted_at: string | null
  created_at: string
}): ScheduleRecord {
  return {
    id: row.id,
    kind: row.kind as ScheduleRecord['kind'],
    label: row.label,
    amountCents: row.amount_cents,
    categoryId: row.category_id,
    accountId: row.account_id,
    cadence: row.cadence as ScheduleRecord['cadence'],
    nextDate: row.next_date,
    lastPostedAt: row.last_posted_at,
    createdAt: row.created_at
  }
}

const SCHEDULE_COLUMNS = `id, kind, label, amount_cents, category_id, account_id, cadence, next_date, last_posted_at, created_at`

export function listSchedules(): ScheduleRecord[] {
  const rows = getDb()
    .prepare(`SELECT ${SCHEDULE_COLUMNS} FROM budget_schedules ORDER BY next_date ASC, created_at ASC`)
    .all() as Parameters<typeof rowToSchedule>[0][]
  return rows.map(rowToSchedule)
}

export function createSchedule(input: CreateScheduleInput): ScheduleRecord {
  if (!SCHEDULE_KINDS.has(input.kind)) throw new Error('Invalid schedule kind')
  if (!SCHEDULE_CADENCES.has(input.cadence)) throw new Error('Invalid schedule cadence')
  if (input.amountCents <= 0) throw new Error('Schedule amount must be positive')

  const id = randomUUID()
  const createdAt = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO budget_schedules
       (id, kind, label, amount_cents, category_id, account_id, cadence, next_date, last_posted_at, created_at)
       VALUES (@id, @kind, @label, @amountCents, @categoryId, @accountId, @cadence, @nextDate, NULL, @createdAt)`
    )
    .run({
      id,
      kind: input.kind,
      label: input.label.trim(),
      amountCents: input.amountCents,
      categoryId: input.kind === 'bill' ? input.categoryId ?? null : null,
      accountId: input.accountId ?? null,
      cadence: input.cadence,
      nextDate: input.nextDate.slice(0, 10),
      createdAt
    })

  return rowToSchedule(
    getDb()
      .prepare(`SELECT ${SCHEDULE_COLUMNS} FROM budget_schedules WHERE id = ?`)
      .get(id) as Parameters<typeof rowToSchedule>[0]
  )
}

export function deleteSchedule(id: string): void {
  getDb().prepare('DELETE FROM budget_schedules WHERE id = ?').run(id)
}

/**
 * Post the current occurrence of a schedule: income becomes a paycheck, a bill
 * becomes a ledger expense — then the schedule advances to its next date.
 * Explicit, user-triggered — MOSS never moves money on its own (SPEC §2.2).
 */
export function postSchedule(id: string, options?: { amountCents?: number }): ScheduleRecord {
  const db = getDb()
  const existing = db
    .prepare(`SELECT ${SCHEDULE_COLUMNS} FROM budget_schedules WHERE id = ?`)
    .get(id) as Parameters<typeof rowToSchedule>[0] | undefined
  if (!existing) throw new Error('Schedule not found')

  const schedule = rowToSchedule(existing)
  const postedAmountCents =
    options?.amountCents !== undefined && options.amountCents > 0
      ? options.amountCents
      : schedule.amountCents
  const occurredAt = occurrenceIso(schedule.nextDate)
  const now = new Date().toISOString()
  const payee = schedule.kind === 'bill' ? upsertPayeeByName(schedule.label) : null
  const nextDate = advanceScheduleDate(schedule.nextDate, schedule.cadence)

  const run = db.transaction(() => {
    if (schedule.kind === 'income') {
      db.prepare(
        `INSERT INTO budget_paychecks (id, label, amount_cents, received_at, account_id, created_at)
         VALUES (@id, @label, @amountCents, @receivedAt, @accountId, @createdAt)`
      ).run({
        id: randomUUID(),
        label: schedule.label,
        amountCents: postedAmountCents,
        receivedAt: occurredAt,
        accountId: schedule.accountId,
        createdAt: now
      })
    } else {
      db.prepare(
        `INSERT INTO ledger_transactions
         (id, amount_cents, category_id, payee_id, memo, occurred_at, account_id, created_at)
         VALUES (@id, @amountCents, @categoryId, @payeeId, @memo, @occurredAt, @accountId, @createdAt)`
      ).run({
        id: randomUUID(),
        amountCents: -postedAmountCents,
        categoryId: schedule.categoryId,
        payeeId: payee?.id ?? null,
        memo: schedule.label,
        occurredAt,
        accountId: schedule.accountId,
        createdAt: now
      })
    }

    db.prepare(
      `UPDATE budget_schedules SET next_date = @nextDate, last_posted_at = @now WHERE id = @id`
    ).run({ id, nextDate, now })
  })

  run()

  return rowToSchedule(
    db
      .prepare(`SELECT ${SCHEDULE_COLUMNS} FROM budget_schedules WHERE id = ?`)
      .get(id) as Parameters<typeof rowToSchedule>[0]
  )
}

// —— Auto-categorize rules ——

function rowToRule(row: {
  id: string
  match_field: string
  match_type: string
  match_value: string
  category_id: string
  category_name: string | null
  sort_order: number
  created_at: string
}): BudgetRuleRecord {
  return {
    id: row.id,
    matchField: row.match_field as BudgetRuleRecord['matchField'],
    matchType: row.match_type as BudgetRuleRecord['matchType'],
    matchValue: row.match_value,
    categoryId: row.category_id,
    categoryName: row.category_name,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  }
}

export function listBudgetRules(): BudgetRuleRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.match_field, r.match_type, r.match_value, r.category_id,
              c.name AS category_name, r.sort_order, r.created_at
       FROM budget_rules r
       LEFT JOIN budget_categories c ON c.id = r.category_id
       ORDER BY r.sort_order ASC, r.created_at ASC`
    )
    .all() as Parameters<typeof rowToRule>[0][]
  return rows.map(rowToRule)
}

export function createBudgetRule(input: CreateBudgetRuleInput): BudgetRuleRecord {
  if (!RULE_FIELDS.has(input.matchField)) throw new Error('Invalid rule field')
  if (!RULE_TYPES.has(input.matchType)) throw new Error('Invalid rule type')
  const value = input.matchValue.trim()
  if (!value) throw new Error('Rule text required')

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const sortOrder =
    (getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM budget_rules')
      .get() as { max_order: number }).max_order + 1

  getDb()
    .prepare(
      `INSERT INTO budget_rules (id, match_field, match_type, match_value, category_id, sort_order, created_at)
       VALUES (@id, @matchField, @matchType, @matchValue, @categoryId, @sortOrder, @createdAt)`
    )
    .run({
      id,
      matchField: input.matchField,
      matchType: input.matchType,
      matchValue: value,
      categoryId: input.categoryId,
      sortOrder,
      createdAt
    })

  const row = getDb()
    .prepare(
      `SELECT r.id, r.match_field, r.match_type, r.match_value, r.category_id,
              c.name AS category_name, r.sort_order, r.created_at
       FROM budget_rules r
       LEFT JOIN budget_categories c ON c.id = r.category_id
       WHERE r.id = ?`
    )
    .get(id) as Parameters<typeof rowToRule>[0]
  return rowToRule(row)
}

export function deleteBudgetRule(id: string): void {
  getDb().prepare('DELETE FROM budget_rules WHERE id = ?').run(id)
}

/** First rule whose pattern matches the payee/memo, or null. Case-insensitive. */
export function matchCategoryForTransaction(
  payeeName: string,
  memo: string
): string | null {
  const payee = payeeName.trim().toLowerCase()
  const note = memo.trim().toLowerCase()
  if (!payee && !note) return null

  const rules = getDb()
    .prepare(
      `SELECT match_field, match_type, match_value, category_id
       FROM budget_rules ORDER BY sort_order ASC, created_at ASC`
    )
    .all() as Array<{
    match_field: string
    match_type: string
    match_value: string
    category_id: string
  }>

  for (const rule of rules) {
    const haystack = rule.match_field === 'memo' ? note : payee
    if (!haystack) continue
    const needle = rule.match_value.trim().toLowerCase()
    if (!needle) continue
    const hit = rule.match_type === 'equals' ? haystack === needle : haystack.includes(needle)
    if (hit) return rule.category_id
  }

  return null
}
