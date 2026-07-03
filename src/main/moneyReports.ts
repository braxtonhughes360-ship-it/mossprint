import { randomUUID } from 'node:crypto'
import type { CategoryRecord, CategoryGroupRecord } from '@shared/money'
import { currentPeriodKey, shiftPeriodKey } from '@shared/money'
import type {
  CreateReportPresetInput,
  MoneyReportsOverview,
  ReportCategorySpend,
  ReportComparison,
  ReportEnvelopeProgress,
  ReportEnvelopeWeekPoint,
  ReportFilters,
  ReportNetWorthPoint,
  ReportPeriodPoint,
  ReportPeriodTotals,
  ReportPresetRecord,
  ReportSavingsGlance,
  ReportTransactionSummary
} from '@shared/moneyReports'
import {
  buildComparisonWhy,
  buildEnvelopeProgressWhy,
  EMPTY_REPORT_FILTERS,
  normalizeReportFilters,
  periodEndIso,
  resolveReportRange
} from '@shared/moneyReports'
import { getDb } from './database'
import { getBudgetOverview, listCategories, listPaychecks } from './money'
import { listCashAccounts } from './moneyV2'
import { listCategoryGroups, portfolioTotalsFromHoldings } from './moneyS'
import { getSavingsOverview } from './moneySavings'

function rowToPreset(row: {
  id: string
  name: string
  filters_json: string
  view_mode: string
  created_at: string
}): ReportPresetRecord {
  let filters = EMPTY_REPORT_FILTERS
  try {
    filters = normalizeReportFilters(JSON.parse(row.filters_json))
  } catch {
    /* keep defaults */
  }
  return {
    id: row.id,
    name: row.name,
    filters,
    viewMode: row.view_mode === 'table' ? 'table' : 'chart',
    createdAt: row.created_at
  }
}

export function listReportPresets(): ReportPresetRecord[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, name, filters_json, view_mode, created_at
         FROM report_presets ORDER BY created_at DESC`
      )
      .all() as Array<{
      id: string
      name: string
      filters_json: string
      view_mode: string
      created_at: string
    }>
    return rows.map(rowToPreset)
  } catch {
    return []
  }
}

export function createReportPreset(input: CreateReportPresetInput): ReportPresetRecord {
  const name = input.name.trim()
  if (!name) throw new Error('Preset name is required')

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const filters = normalizeReportFilters(input.filters)
  const viewMode = input.viewMode === 'table' ? 'table' : 'chart'

  getDb()
    .prepare(
      `INSERT INTO report_presets (id, name, filters_json, view_mode, created_at)
       VALUES (@id, @name, @filtersJson, @viewMode, @createdAt)`
    )
    .run({
      id,
      name,
      filtersJson: JSON.stringify(filters),
      viewMode,
      createdAt
    })

  return { id, name, filters, viewMode, createdAt }
}

export function deleteReportPreset(id: string): { ok: true } {
  getDb().prepare('DELETE FROM report_presets WHERE id = ?').run(id)
  return { ok: true }
}

function paycheckIncomeForPeriod(periodKey: string, accountId: string | null): number {
  return listPaychecks()
    .filter((paycheck) => {
      const key = paycheck.receivedAt.slice(0, 7)
      if (key !== periodKey) return false
      if (accountId && paycheck.accountId !== accountId) return false
      return true
    })
    .reduce((sum, paycheck) => sum + paycheck.amountCents, 0)
}

function ledgerNetForPeriod(periodKey: string, filters: ReportFilters): number {
  const range = resolveReportRange({ ...filters, rangePreset: 'this_month' }, periodKey)
  const rows = fetchFilteredExpenseIncomeRows(range.fromIso, range.toIso, filters)
  return rows.reduce((sum, row) => sum + row.amountCents, 0)
}

function periodTotals(periodKey: string, filters: ReportFilters): ReportPeriodTotals {
  const budget = getBudgetOverview(periodKey)
  const incomeCents = paycheckIncomeForPeriod(periodKey, filters.accountId)
  const spentCents = budget.categories.reduce((sum, row) => sum + row.spentCents, 0)
  const netFlowCents = incomeCents + ledgerNetForPeriod(periodKey, filters)
  return {
    incomeCents,
    spentCents,
    netFlowCents,
    assignedCents: budget.assignedTotalCents
  }
}

interface FilteredTxnRow {
  id: string
  amountCents: number
  type: string
  categoryId: string | null
  payeeId: string | null
  tags: string
  occurredAt: string
}

function rowMatchesTag(tagsRaw: string, tag: string): boolean {
  const needle = tag.toLowerCase()
  try {
    const parsed = JSON.parse(tagsRaw) as string[]
    if (Array.isArray(parsed) && parsed.some((entry) => entry.toLowerCase() === needle)) return true
  } catch {
    /* fall through */
  }
  return tagsRaw.toLowerCase().includes(needle)
}

function fetchFilteredExpenseIncomeRows(
  fromIso: string,
  toIso: string,
  filters: ReportFilters
): FilteredTxnRow[] {
  const db = getDb()
  const params: Record<string, unknown> = { fromIso, toIso }
  const clauses = ['t.occurred_at >= @fromIso', 't.occurred_at <= @toIso', "t.type != 'transfer'"]

  if (filters.accountId) {
    clauses.push('t.account_id = @accountId')
    params.accountId = filters.accountId
  }
  if (filters.payeeId) {
    clauses.push('t.payee_id = @payeeId')
    params.payeeId = filters.payeeId
  }
  if (filters.type !== 'all') {
    clauses.push('t.type = @type')
    params.type = filters.type
  }
  if (filters.minCents !== null) {
    clauses.push('ABS(t.amount_cents) >= @minCents')
    params.minCents = filters.minCents
  }
  if (filters.maxCents !== null) {
    clauses.push('ABS(t.amount_cents) <= @maxCents')
    params.maxCents = filters.maxCents
  }

  const rows = db
    .prepare(
      `SELECT t.id, t.amount_cents AS amountCents, t.type, t.category_id AS categoryId,
              t.payee_id AS payeeId, t.tags, t.occurred_at AS occurredAt
       FROM ledger_transactions t
       WHERE ${clauses.join(' AND ')}`
    )
    .all(params) as FilteredTxnRow[]

  const categories = listCategories()
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  return rows.filter((row) => {
    if (filters.categoryId && row.categoryId !== filters.categoryId) return false
    if (filters.groupId) {
      const cat = row.categoryId ? categoryById.get(row.categoryId) : null
      if (!cat || cat.groupId !== filters.groupId) return false
    }
    if (filters.tag && !rowMatchesTag(row.tags, filters.tag)) return false
    return true
  })
}

function aggregateSpendingByCategory(
  fromIso: string,
  toIso: string,
  filters: ReportFilters,
  categories: CategoryRecord[],
  groups: CategoryGroupRecord[]
): ReportCategorySpend[] {
  const db = getDb()
  const groupById = new Map(groups.map((g) => [g.id, g.name]))
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const params: Record<string, unknown> = { fromIso, toIso }
  const accountClause = filters.accountId ? 'AND t.account_id = @accountId' : ''
  if (filters.accountId) params.accountId = filters.accountId

  const direct = db
    .prepare(
      `SELECT t.category_id AS categoryId, COALESCE(SUM(ABS(t.amount_cents)), 0) AS spent
       FROM ledger_transactions t
       WHERE t.occurred_at >= @fromIso AND t.occurred_at <= @toIso
         AND t.amount_cents < 0 AND t.type IN ('expense', 'adjustment')
         AND t.category_id IS NOT NULL ${accountClause}
       GROUP BY t.category_id`
    )
    .all(params) as Array<{ categoryId: string; spent: number }>

  const split = db
    .prepare(
      `SELECT s.category_id AS categoryId, COALESCE(SUM(ABS(s.amount_cents)), 0) AS spent
       FROM ledger_transaction_splits s
       JOIN ledger_transactions t ON t.id = s.transaction_id
       WHERE t.occurred_at >= @fromIso AND t.occurred_at <= @toIso
         AND s.amount_cents < 0 AND s.category_id IS NOT NULL ${accountClause}
       GROUP BY s.category_id`
    )
    .all(params) as Array<{ categoryId: string; spent: number }>

  const totals = new Map<string, number>()
  for (const row of [...direct, ...split]) {
    totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0) + row.spent)
  }

  const rows: ReportCategorySpend[] = []
  for (const [categoryId, spentCents] of Array.from(totals.entries())) {
    const category = categoryById.get(categoryId)
    if (!category) continue
    if (filters.categoryId && filters.categoryId !== categoryId) continue
    if (filters.groupId && category.groupId !== filters.groupId) continue
    rows.push({
      categoryId,
      categoryName: category.name,
      groupId: category.groupId,
      groupName: category.groupId ? (groupById.get(category.groupId) ?? null) : null,
      spentCents
    })
  }

  return rows.sort((a, b) => b.spentCents - a.spentCents)
}

interface CategorySpendEvent {
  categoryId: string
  amountCents: number
  occurredAt: string
}

function weekBucketsForPeriod(periodKey: string): Array<{
  label: string
  endDay: string
  endIso: string
}> {
  const [year, month] = periodKey.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  const buckets: Array<{ label: string; endDay: string; endIso: string }> = []
  for (let start = 1; start <= lastDay; start += 7) {
    const end = Math.min(start + 6, lastDay)
    const endDay = `${periodKey}-${String(end).padStart(2, '0')}`
    const endIso = new Date(endDay + 'T23:59:59.999').toISOString()
    const label =
      buckets.length === 0 && end >= lastDay
        ? 'Month'
        : `W${buckets.length + 1}`
    buckets.push({ label, endDay, endIso })
  }
  return buckets
}

function fetchCategorySpendEventsInPeriod(
  periodKey: string,
  filters: ReportFilters
): CategorySpendEvent[] {
  const range = resolveReportRange({ ...filters, rangePreset: 'this_month' }, periodKey)
  const db = getDb()
  const params: Record<string, unknown> = { fromIso: range.fromIso, toIso: range.toIso }
  const accountClause = filters.accountId ? 'AND t.account_id = @accountId' : ''
  if (filters.accountId) params.accountId = filters.accountId

  const direct = db
    .prepare(
      `SELECT t.category_id AS categoryId, ABS(t.amount_cents) AS amountCents, t.occurred_at AS occurredAt
       FROM ledger_transactions t
       WHERE t.occurred_at >= @fromIso AND t.occurred_at <= @toIso
         AND t.amount_cents < 0 AND t.type IN ('expense', 'adjustment')
         AND t.category_id IS NOT NULL ${accountClause}`
    )
    .all(params) as CategorySpendEvent[]

  const split = db
    .prepare(
      `SELECT s.category_id AS categoryId, ABS(s.amount_cents) AS amountCents, t.occurred_at AS occurredAt
       FROM ledger_transaction_splits s
       JOIN ledger_transactions t ON t.id = s.transaction_id
       WHERE t.occurred_at >= @fromIso AND t.occurred_at <= @toIso
         AND s.amount_cents < 0 AND s.category_id IS NOT NULL ${accountClause}`
    )
    .all(params) as CategorySpendEvent[]

  const categories = listCategories()
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  return [...direct, ...split].filter((row) => {
    if (filters.categoryId && row.categoryId !== filters.categoryId) return false
    if (filters.groupId) {
      const cat = categoryById.get(row.categoryId)
      if (!cat || cat.groupId !== filters.groupId) return false
    }
    return true
  })
}

function buildEnvelopeProgress(
  periodKey: string,
  filters: ReportFilters,
  groups: CategoryGroupRecord[]
): ReportEnvelopeProgress[] {
  const budget = getBudgetOverview(periodKey)
  const weekBuckets = weekBucketsForPeriod(periodKey)
  const spendEvents = fetchCategorySpendEventsInPeriod(periodKey, filters)
  const groupById = new Map(groups.map((g) => [g.id, g.name]))

  const rows: ReportEnvelopeProgress[] = []

  for (const row of budget.categories) {
    const { assignedCents, spentCents, remainingCents } = row
    if (filters.categoryId && row.category.id !== filters.categoryId) continue
    if (filters.groupId && row.category.groupId !== filters.groupId) continue
    if (assignedCents === 0 && spentCents === 0) continue

    const weeklySeries: ReportEnvelopeWeekPoint[] = weekBuckets.map((bucket) => {
      let cumulative = 0
      for (const evt of spendEvents) {
        if (evt.categoryId !== row.category.id) continue
        if (evt.occurredAt <= bucket.endIso) cumulative += evt.amountCents
      }
      return {
        label: bucket.label,
        spentCents: cumulative,
        assignedCents
      }
    })

    rows.push({
      categoryId: row.category.id,
      categoryName: row.category.name,
      groupId: row.category.groupId,
      groupName: row.category.groupId ? (groupById.get(row.category.groupId) ?? null) : null,
      assignedCents,
      spentCents,
      remainingCents,
      weeklySeries,
      why: buildEnvelopeProgressWhy(assignedCents, spentCents, weeklySeries)
    })
  }

  return rows.sort((a, b) => {
    const aScore = a.spentCents + a.assignedCents
    const bScore = b.spentCents + b.assignedCents
    return bScore - aScore
  })
}

function cashBalanceAsOf(endIso: string, accountId: string | null): number {
  const db = getDb()
  const accounts = listCashAccounts().filter((account) => !account.archived)
  const ids = accountId
    ? accounts.filter((a) => a.id === accountId).map((a) => a.id)
    : accounts.map((a) => a.id)

  if (ids.length === 0) {
    const paychecks = (
      db
        .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM budget_paychecks WHERE received_at <= ?')
        .get(endIso) as { total: number }
    ).total
    const ledger = (
      db
        .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_transactions WHERE occurred_at <= ?')
        .get(endIso) as { total: number }
    ).total
    return paychecks + ledger
  }

  let total = 0
  for (const id of ids) {
    const starting = (
      db.prepare('SELECT starting_balance_cents AS v FROM cash_accounts WHERE id = ?').get(id) as
        | { v: number }
        | undefined
    )?.v ?? 0
    const ledger = (
      db
        .prepare(
          'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_transactions WHERE account_id = ? AND occurred_at <= ?'
        )
        .get(id, endIso) as { total: number }
    ).total
    const paychecks = (
      db
        .prepare(
          'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM budget_paychecks WHERE account_id = ? AND received_at <= ?'
        )
        .get(id, endIso) as { total: number }
    ).total
    total += starting + ledger + paychecks
  }
  return total
}

function investmentValueAsOf(endIso: string, isCurrent: boolean): { cents: number; estimated: boolean } {
  if (isCurrent) {
    const portfolio = portfolioTotalsFromHoldings()
    return { cents: portfolio.totalCents, estimated: portfolio.quotesStale }
  }

  const db = getDb()
  const accounts = db
    .prepare('SELECT id FROM investment_accounts')
    .all() as Array<{ id: string }>

  let total = 0
  let hasSnapshot = false
  for (const account of accounts) {
    const row = db
      .prepare(
        `SELECT value_cents FROM investment_snapshots
         WHERE account_id = ? AND as_of <= ?
         ORDER BY as_of DESC LIMIT 1`
      )
      .get(account.id, endIso) as { value_cents: number } | undefined
    if (row) {
      total += row.value_cents
      hasSnapshot = true
    }
  }

  if (hasSnapshot) return { cents: total, estimated: false }

  const portfolio = portfolioTotalsFromHoldings()
  return { cents: portfolio.totalCents, estimated: portfolio.totalCents > 0 }
}

function transactionSummary(
  fromIso: string,
  toIso: string,
  filters: ReportFilters
): ReportTransactionSummary {
  const rows = fetchFilteredExpenseIncomeRows(fromIso, toIso, filters)
  let incomeCents = 0
  let expenseCents = 0
  for (const row of rows) {
    if (row.amountCents >= 0) incomeCents += row.amountCents
    else expenseCents += Math.abs(row.amountCents)
  }
  return {
    count: rows.length,
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents
  }
}

function buildCashFlowSeries(periodKeys: string[], filters: ReportFilters): ReportPeriodPoint[] {
  return periodKeys.map((periodKey) => {
    const totals = periodTotals(periodKey, filters)
    const [year, month] = periodKey.split('-').map(Number)
    const label = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(
      new Date(year, month - 1, 1)
    )
    return {
      periodKey,
      label,
      incomeCents: totals.incomeCents,
      assignedCents: totals.assignedCents,
      spentCents: totals.spentCents,
      netFlowCents: totals.netFlowCents
    }
  })
}

function netWorthChartPeriodKeys(periodKeys: string[], anchorPeriodKey: string): string[] {
  if (periodKeys.length >= 3) return periodKeys
  const endKey = periodKeys[periodKeys.length - 1] ?? anchorPeriodKey
  const keys: string[] = []
  for (let offset = 2; offset >= 0; offset -= 1) {
    keys.push(shiftPeriodKey(endKey, -offset))
  }
  return keys
}

function buildNetWorthSeries(
  periodKeys: string[],
  filters: ReportFilters,
  anchorPeriodKey: string
): ReportNetWorthPoint[] {
  const chartKeys = netWorthChartPeriodKeys(periodKeys, anchorPeriodKey)
  return chartKeys.map((periodKey) => {
    const endIso = periodEndIso(periodKey)
    const isCurrent = periodKey === anchorPeriodKey
    const cashCents = cashBalanceAsOf(endIso, filters.accountId)
    const investment = investmentValueAsOf(endIso, isCurrent)
    const [year, month] = periodKey.split('-').map(Number)
    const label = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(
      new Date(year, month - 1, 1)
    )
    return {
      periodKey,
      label,
      cashCents,
      investmentCents: investment.cents,
      totalCents: cashCents + investment.cents,
      estimated: investment.estimated
    }
  })
}

function buildSavingsGlance(periodKey: string): ReportSavingsGlance[] {
  const overview = getSavingsOverview(periodKey)
  return overview.goals.map((row) => ({
    goalId: row.goal.id,
    name: row.goal.name,
    savedCents: row.savedCents,
    targetCents: row.goal.targetCents,
    progress: row.progress,
    onTrack: row.guidance.onTrackThisPeriod,
    why: row.guidance.onTrackThisPeriod ? row.guidance.onTrackWhy : row.guidance.why
  }))
}

export function getMoneyReportsOverview(
  filtersInput: ReportFilters,
  anchorPeriodKey = currentPeriodKey()
): MoneyReportsOverview {
  const filters = normalizeReportFilters(filtersInput)
  const range = resolveReportRange(filters, anchorPeriodKey)
  const categories = listCategories()
  const groups = listCategoryGroups()

  const current = periodTotals(range.comparisonCurrentKey, filters)
  const prior = periodTotals(range.comparisonPriorKey, filters)

  const comparison: ReportComparison = {
    currentPeriodKey: range.comparisonCurrentKey,
    priorPeriodKey: range.comparisonPriorKey,
    current,
    prior,
    deltaIncomeCents: current.incomeCents - prior.incomeCents,
    deltaSpentCents: current.spentCents - prior.spentCents,
    deltaNetFlowCents: current.netFlowCents - prior.netFlowCents,
    why: buildComparisonWhy(current, prior, 'This month', 'last month')
  }

  const spendingByCategory = aggregateSpendingByCategory(
    range.fromIso,
    range.toIso,
    filters,
    categories,
    groups
  )
  const envelopeProgress = buildEnvelopeProgress(range.comparisonCurrentKey, filters, groups)
  const cashFlowSeries = buildCashFlowSeries(range.periodKeys, filters)
  const netWorthSeries = buildNetWorthSeries(range.periodKeys, filters, anchorPeriodKey)
  const savingsGlance = buildSavingsGlance(anchorPeriodKey)
  const transactionSummaryResult = transactionSummary(range.fromIso, range.toIso, filters)

  const hasData =
    spendingByCategory.length > 0 ||
    envelopeProgress.length > 0 ||
    cashFlowSeries.some(
      (p) => p.incomeCents > 0 || p.spentCents > 0 || p.assignedCents > 0
    ) ||
    netWorthSeries.some((p) => p.totalCents !== 0) ||
    savingsGlance.length > 0 ||
    transactionSummaryResult.count > 0

  return {
    filters,
    rangeLabel: range.rangeLabel,
    fromDay: range.fromDay,
    toDay: range.toDay,
    periodKeys: range.periodKeys,
    comparison,
    spendingByCategory,
    envelopeProgress,
    cashFlowSeries,
    netWorthSeries,
    savingsGlance,
    transactionSummary: transactionSummaryResult,
    hasData,
    emptyWhy: 'Add paychecks, ledger entries, or savings goals to see reports here.'
  }
}
