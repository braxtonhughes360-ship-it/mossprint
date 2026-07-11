import { randomUUID } from 'node:crypto'
import type {
  CreateInvestmentActivityInput,
  InvestmentAccountRow,
  InvestmentActivityRecord,
  InvestmentActivityType,
  InvestmentAllocationSlice,
  InvestmentDividendRow,
  InvestmentPerformanceReadout,
  InvestmentPerformanceWindow,
  InvestmentReconciliationReadout,
  InvestmentsOverview
} from '@shared/money'
import { getDb } from './database'
import { listHoldingsForAccount, portfolioTotalsFromHoldings } from './moneyS'

const ACTIVITY_TYPES = new Set<InvestmentActivityType>([
  'buy',
  'sell',
  'dividend',
  'fee',
  'interest'
])

const PERFORMANCE_WINDOWS: Array<{ window: InvestmentPerformanceWindow; label: string }> = [
  { window: 'today', label: 'Today' },
  { window: 'wtd', label: 'WTD' },
  { window: 'mtd', label: 'MTD' },
  { window: 'ytd', label: 'YTD' },
  { window: '1y', label: '1Y' },
  { window: 'max', label: 'All time' }
]

type ActivityRow = {
  id: string
  account_id: string
  type: string
  symbol: string | null
  quantity: number | null
  amount_cents: number
  occurred_at: string
  memo: string
  created_at: string
}

function rowToActivity(row: ActivityRow): InvestmentActivityRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type as InvestmentActivityType,
    symbol: row.symbol,
    quantity: row.quantity,
    amountCents: row.amount_cents,
    occurredAt: row.occurred_at,
    memo: row.memo,
    createdAt: row.created_at
  }
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function windowStart(window: InvestmentPerformanceWindow, now = new Date()): Date | null {
  switch (window) {
    case 'today':
      return startOfLocalDay(now)
    case 'wtd': {
      const day = startOfLocalDay(now)
      const weekday = day.getDay()
      day.setDate(day.getDate() - weekday)
      return day
    }
    case 'mtd':
      return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
    case 'ytd':
      return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0)
    case '1y': {
      const yearAgo = new Date(now)
      yearAgo.setFullYear(yearAgo.getFullYear() - 1)
      return yearAgo
    }
    case 'max':
      return null
    default:
      return null
  }
}

function snapshotTotalAsOf(isoCutoff: string): { cents: number; hasData: boolean } {
  const accounts = getDb()
    .prepare(`SELECT id FROM investment_accounts`)
    .all() as Array<{ id: string }>

  let total = 0
  let hasData = false

  for (const account of accounts) {
    const row = getDb()
      .prepare(
        `SELECT value_cents FROM investment_snapshots
         WHERE account_id = ? AND as_of <= ?
         ORDER BY as_of DESC, created_at DESC
         LIMIT 1`
      )
      .get(account.id, isoCutoff) as { value_cents: number } | undefined

    if (row) {
      total += row.value_cents
      hasData = true
    }
  }

  return { cents: total, hasData }
}

function earliestSnapshotIso(): string | null {
  const row = getDb()
    .prepare(`SELECT MIN(as_of) AS earliest FROM investment_snapshots`)
    .get() as { earliest: string | null } | undefined
  return row?.earliest ?? null
}

function currentPortfolioCents(holdingsTotal: number, snapshotTotal: number): number {
  return holdingsTotal > 0 ? holdingsTotal : snapshotTotal
}

function portfolioValueAt(
  isoCutoff: string,
  holdingsTotal: number,
  isNow: boolean
): { cents: number; estimated: boolean } {
  if (isNow && holdingsTotal > 0) {
    return { cents: holdingsTotal, estimated: false }
  }

  const snapshot = snapshotTotalAsOf(isoCutoff)
  if (snapshot.hasData) {
    return { cents: snapshot.cents, estimated: false }
  }

  if (holdingsTotal > 0) {
    return {
      cents: holdingsTotal,
      estimated: true
    }
  }

  return { cents: 0, estimated: true }
}

export function computeInvestmentPerformance(
  holdingsTotal: number,
  snapshotTotal: number
): InvestmentPerformanceReadout[] {
  const now = new Date()
  const current = currentPortfolioCents(holdingsTotal, snapshotTotal)

  return PERFORMANCE_WINDOWS.map(({ window, label }) => {
    const start = windowStart(window, now)
    const cutoffIso =
      start?.toISOString() ??
      earliestSnapshotIso() ??
      now.toISOString()

    const then = portfolioValueAt(cutoffIso, holdingsTotal, false)
    const estimated = then.estimated || (holdingsTotal > 0 && !then.cents)

    if (!then.cents || current === 0) {
      return {
        window,
        label,
        changeCents: null,
        changePercent: null,
        estimated,
        why:
          window === 'max' && !earliestSnapshotIso()
            ? 'Log a balance snapshot to track performance over time.'
            : 'No earlier balance on record for this window — log snapshots for honest history.'
      }
    }

    const changeCents = current - then.cents
    const changePercent = Math.round((changeCents / then.cents) * 1000) / 10

    let why = `Compared to ${formatShortDate(cutoffIso)} balance of ${formatCentsPlain(then.cents)}.`
    if (estimated) {
      why += ' Estimated — no snapshot at window start; using best available data.'
    }
    if (holdingsTotal > 0) {
      why += ' Current total uses live holdings when quotes are fresh.'
    }

    return {
      window,
      label,
      changeCents,
      changePercent,
      estimated,
      why
    }
  })
}

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(iso))
}

function formatCentsPlain(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(cents / 100)
}

export function computeInvestmentAllocation(
  accounts: InvestmentAccountRow[],
  totalCents: number
): InvestmentAllocationSlice[] {
  if (totalCents <= 0) return []

  const byTag = new Map<string, number>()

  for (const row of accounts) {
    for (const holding of row.holdings) {
      if (holding.marketValueCents <= 0) continue
      const tag = (holding.allocationTag ?? '').trim() || 'Unclassified'
      byTag.set(tag, (byTag.get(tag) ?? 0) + holding.marketValueCents)
    }
  }

  if (byTag.size === 0) return []

  return Array.from(byTag.entries())
    .map(([tag, cents]) => ({
      tag,
      cents,
      percent: Math.round((cents / totalCents) * 1000) / 10
    }))
    .sort((a, b) => b.cents - a.cents)
}

export function computeInvestmentReconciliation(
  accounts: InvestmentAccountRow[]
): InvestmentReconciliationReadout[] {
  // Holdings are the live source of truth; snapshots are optional manual history for
  // performance. They are never an alarm to reconcile, so divergence is never flagged —
  // refreshing quotes moves holdings without ever "breaking" against an old snapshot.
  return accounts
    .map((row) => {
      const holdingsCents = row.holdings.reduce((sum, h) => sum + h.marketValueCents, 0)
      const snapshotCents = row.latestSnapshot?.valueCents ?? null
      const deltaCents = snapshotCents === null ? 0 : holdingsCents - snapshotCents

      return {
        accountId: row.account.id,
        holdingsCents,
        snapshotCents,
        diverged: false,
        deltaCents,
        why:
          row.holdings.length === 0
            ? 'Snapshot is this account’s balance record.'
            : 'Live holdings are the current value; snapshots are optional history for performance.'
      }
    })
    .filter((row) => row.holdingsCents > 0 || row.snapshotCents !== null)
}

export function listInvestmentActivities(limit = 80): InvestmentActivityRecord[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, account_id, type, symbol, quantity, amount_cents, occurred_at, memo, created_at
         FROM investment_activities
         ORDER BY occurred_at DESC, created_at DESC
         LIMIT ?`
      )
      .all(limit) as ActivityRow[]

    return rows.map(rowToActivity)
  } catch {
    return []
  }
}

export function listInvestmentDividends(limit = 24): InvestmentDividendRow[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, account_id, symbol, amount_cents, occurred_at, memo
         FROM investment_activities
         WHERE type = 'dividend'
         ORDER BY occurred_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: string
      account_id: string
      symbol: string | null
      amount_cents: number
      occurred_at: string
      memo: string
    }>

    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      symbol: row.symbol,
      amountCents: row.amount_cents,
      occurredAt: row.occurred_at,
      memo: row.memo
    }))
  } catch {
    return []
  }
}

function applyActivityToHoldings(input: CreateInvestmentActivityInput): void {
  const symbol = input.symbol?.trim().toUpperCase()
  if (!symbol || input.type === 'dividend' || input.type === 'fee' || input.type === 'interest') {
    return
  }

  const qty = input.quantity
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
    return
  }

  const existing = getDb()
    .prepare(
      `SELECT id, quantity, cost_basis_cents FROM investment_holdings
       WHERE account_id = ? AND symbol = ? COLLATE NOCASE
       LIMIT 1`
    )
    .get(input.accountId, symbol) as
    | { id: string; quantity: number; cost_basis_cents: number }
    | undefined

  if (input.type === 'buy') {
    if (existing) {
      const newQty = existing.quantity + qty
      const newCost = existing.cost_basis_cents + input.amountCents
      getDb()
        .prepare(
          `UPDATE investment_holdings SET quantity = ?, cost_basis_cents = ? WHERE id = ?`
        )
        .run(newQty, newCost, existing.id)
    } else {
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      getDb()
        .prepare(
          `INSERT INTO investment_holdings
           (id, account_id, symbol, label, quantity, cost_basis_cents, created_at)
           VALUES (@id, @accountId, @symbol, @label, @quantity, @costBasisCents, @createdAt)`
        )
        .run({
          id,
          accountId: input.accountId,
          symbol,
          label: symbol,
          quantity: qty,
          costBasisCents: input.amountCents,
          createdAt
        })
    }
    return
  }

  if (input.type === 'sell' && existing) {
    const newQty = Math.max(0, existing.quantity - qty)
    if (newQty === 0) {
      getDb().prepare(`DELETE FROM investment_holdings WHERE id = ?`).run(existing.id)
    } else {
      const soldRatio = qty / existing.quantity
      const newCost = Math.round(existing.cost_basis_cents * (1 - soldRatio))
      getDb()
        .prepare(`UPDATE investment_holdings SET quantity = ?, cost_basis_cents = ? WHERE id = ?`)
        .run(newQty, newCost, existing.id)
    }
  }
}

export function createInvestmentActivity(
  input: CreateInvestmentActivityInput
): InvestmentActivityRecord {
  if (!ACTIVITY_TYPES.has(input.type)) {
    throw new Error('Invalid activity type')
  }

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const symbol = input.symbol?.trim().toUpperCase() || null
  const quantity =
    typeof input.quantity === 'number' && Number.isFinite(input.quantity)
      ? input.quantity
      : null

  getDb()
    .prepare(
      `INSERT INTO investment_activities
       (id, account_id, type, symbol, quantity, amount_cents, occurred_at, memo, created_at)
       VALUES (@id, @accountId, @type, @symbol, @quantity, @amountCents, @occurredAt, @memo, @createdAt)`
    )
    .run({
      id,
      accountId: input.accountId,
      type: input.type,
      symbol,
      quantity,
      amountCents: input.amountCents,
      occurredAt: input.occurredAt,
      memo: (input.memo ?? '').trim(),
      createdAt
    })

  applyActivityToHoldings({ ...input, symbol })

  return rowToActivity(
    getDb()
      .prepare(
        `SELECT id, account_id, type, symbol, quantity, amount_cents, occurred_at, memo, created_at
         FROM investment_activities WHERE id = ?`
      )
      .get(id) as ActivityRow
  )
}

export function deleteInvestmentActivity(id: string): void {
  getDb().prepare(`DELETE FROM investment_activities WHERE id = ?`).run(id)
}

export function enrichInvestmentsOverview(
  base: Omit<
    InvestmentsOverview,
    'performance' | 'allocation' | 'reconciliation' | 'dividends' | 'activities'
  >
): InvestmentsOverview {
  const snapshotTotal = base.accounts.reduce(
    (sum, row) => sum + (row.latestSnapshot?.valueCents ?? 0),
    0
  )

  return {
    ...base,
    performance: computeInvestmentPerformance(base.holdingsTotalCents, snapshotTotal),
    allocation: computeInvestmentAllocation(base.accounts, base.totalCents),
    reconciliation: computeInvestmentReconciliation(base.accounts),
    dividends: listInvestmentDividends(),
    activities: listInvestmentActivities()
  }
}

export function accountHoldingsValue(accountId: string): number {
  return listHoldingsForAccount(accountId).reduce((sum, h) => sum + h.marketValueCents, 0)
}

export { portfolioTotalsFromHoldings }
