import { randomUUID } from 'node:crypto'
import type { ScheduleRecord } from '@shared/money'
import {
  buildLedgerFlowSnapshot,
  computeMoneyFlowGuidance,
  DEFAULT_MONEY_FLOW_SETTINGS,
  normalizeMoneyFlowGuidance,
  type CreateExpectedPaycheckInput,
  type ExpectedPaycheckRecord,
  type MoneyFlowGuidance,
  type MoneyFlowSettings
} from '@shared/moneyFlow'
import { getDb, getSetting, setSetting } from './database'
import { getBudgetOverview, listTransactions } from './money'
import { listSavingsCategoryIds } from './moneySavings'
import { listSchedules } from './moneyV2'

const HOLD_BUFFER_KEY = 'money.flow.holdBufferCents'
const LOWEST_BASELINE_KEY = 'money.flow.useLowestPaycheckBaseline'

const EXPECTED_COLUMNS = 'id, label, amount_cents, expected_date, created_at'

function rowToExpectedPaycheck(row: {
  id: string
  label: string
  amount_cents: number
  expected_date: string
  created_at: string
}): ExpectedPaycheckRecord {
  return {
    id: row.id,
    label: row.label,
    amountCents: row.amount_cents,
    expectedDate: row.expected_date,
    createdAt: row.created_at
  }
}

export function getMoneyFlowSettings(): MoneyFlowSettings {
  const holdRaw = getSetting(HOLD_BUFFER_KEY)?.value
  const baselineRaw = getSetting(LOWEST_BASELINE_KEY)?.value
  const holdBufferCents =
    holdRaw !== undefined && holdRaw !== '' ? Number.parseInt(holdRaw, 10) : 0
  return {
    holdBufferCents: Number.isFinite(holdBufferCents) ? Math.max(0, holdBufferCents) : 0,
    useLowestPaycheckBaseline: baselineRaw === 'true'
  }
}

export function setMoneyFlowSettings(input: Partial<MoneyFlowSettings>): MoneyFlowSettings {
  const current = getMoneyFlowSettings()
  const next: MoneyFlowSettings = {
    holdBufferCents:
      input.holdBufferCents !== undefined
        ? Math.max(0, Math.round(input.holdBufferCents))
        : current.holdBufferCents,
    useLowestPaycheckBaseline:
      input.useLowestPaycheckBaseline ?? current.useLowestPaycheckBaseline
  }
  setSetting(HOLD_BUFFER_KEY, String(next.holdBufferCents))
  setSetting(LOWEST_BASELINE_KEY, next.useLowestPaycheckBaseline ? 'true' : 'false')
  return next
}

export function listExpectedPaychecks(): ExpectedPaycheckRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT ${EXPECTED_COLUMNS} FROM budget_expected_paychecks ORDER BY expected_date ASC, created_at ASC`
    )
    .all() as Array<{
    id: string
    label: string
    amount_cents: number
    expected_date: string
    created_at: string
  }>
  return rows.map(rowToExpectedPaycheck)
}

export function createExpectedPaycheck(input: CreateExpectedPaycheckInput): ExpectedPaycheckRecord {
  const label = input.label.trim()
  if (!label) throw new Error('Label is required')
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('amountCents must be a positive integer')
  }
  const expectedDate = input.expectedDate.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) {
    throw new Error('expectedDate must be YYYY-MM-DD')
  }

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO budget_expected_paychecks (id, label, amount_cents, expected_date, created_at)
       VALUES (@id, @label, @amountCents, @expectedDate, @createdAt)`
    )
    .run({ id, label, amountCents: input.amountCents, expectedDate, createdAt })

  return {
    id,
    label,
    amountCents: input.amountCents,
    expectedDate,
    createdAt
  }
}

export function deleteExpectedPaycheck(id: string): void {
  getDb().prepare('DELETE FROM budget_expected_paychecks WHERE id = ?').run(id)
}

export function getMoneyFlowGuidance(periodKey?: string): MoneyFlowGuidance {
  const budget = getBudgetOverview(periodKey)
  const transactions = listTransactions(500, budget.periodKey)
  const ledgerNetCents = transactions
    .filter((txn) => txn.type !== 'transfer')
    .reduce((sum, txn) => sum + txn.amountCents, 0)
  const monthFlowCents = budget.paycheckTotalCents + ledgerNetCents
  const schedules: ScheduleRecord[] = listSchedules()
  const expectedPaychecks = listExpectedPaychecks()
  const settings = getMoneyFlowSettings()
  const ledger = buildLedgerFlowSnapshot(transactions)

  return normalizeMoneyFlowGuidance(
    computeMoneyFlowGuidance({
      budget,
      monthFlowCents,
      ledgerNetCents,
      ledger,
      schedules,
      expectedPaychecks,
      settings: settings ?? DEFAULT_MONEY_FLOW_SETTINGS,
      savingsCategoryIds: listSavingsCategoryIds()
    })
  )!
}
