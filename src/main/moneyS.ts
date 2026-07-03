import { randomUUID } from 'node:crypto'
import type {
  CategoryGroupRecord,
  CreateCategoryGroupInput,
  CreateInvestmentHoldingInput,
  InvestmentHoldingRecord,
  PayeeRecord,
  RenameCategoryGroupInput,
  TransferAssignmentInput,
  UpdateInvestmentHoldingInput
} from '@shared/money'
import { computeHoldingMarketValueCents } from '@shared/money'
import { getDb } from './database'
import { fetchInvestmentQuote, isQuoteStale } from './investmentQuotes'

type HoldingRow = {
  id: string
  account_id: string
  symbol: string
  label: string
  quantity: number
  cost_basis_cents: number
  manual_price_cents: number | null
  quote_price_cents: number | null
  quote_fetched_at: string | null
  quote_day_change_percent: number | null
  allocation_tag: string
  created_at: string
}

const HOLDING_SELECT = `SELECT id, account_id, symbol, label, quantity, cost_basis_cents, manual_price_cents,
              quote_price_cents, quote_fetched_at, quote_day_change_percent, allocation_tag, created_at`

function rowToGroup(row: {
  id: string
  name: string
  sort_order: number
  created_at: string
}): CategoryGroupRecord {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  }
}

function rowToPayee(row: {
  id: string
  name: string
  last_used_at: string
  created_at: string
}): PayeeRecord {
  return {
    id: row.id,
    name: row.name,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at
  }
}

function rowToHolding(row: HoldingRow): InvestmentHoldingRecord {
  const manualPriceCents = row.manual_price_cents
  const quotePriceCents = row.quote_price_cents
  const priceCents = quotePriceCents ?? manualPriceCents ?? 0
  const marketValueCents = computeHoldingMarketValueCents(row.quantity, priceCents)

  return {
    id: row.id,
    accountId: row.account_id,
    symbol: row.symbol,
    label: row.label || row.symbol,
    quantity: row.quantity,
    costBasisCents: row.cost_basis_cents,
    manualPriceCents,
    quotePriceCents,
    quoteFetchedAt: row.quote_fetched_at,
    quoteDayChangePercent: row.quote_day_change_percent,
    marketValueCents,
    gainLossCents: marketValueCents - row.cost_basis_cents,
    quoteStale: isQuoteStale(row.quote_fetched_at),
    allocationTag: row.allocation_tag ?? ''
  }
}

export function listCategoryGroups(): CategoryGroupRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, sort_order, created_at FROM budget_category_groups ORDER BY sort_order ASC, name ASC`
    )
    .all() as Array<{ id: string; name: string; sort_order: number; created_at: string }>

  return rows.map(rowToGroup)
}

export function createCategoryGroup(input: CreateCategoryGroupInput): CategoryGroupRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const sortOrder =
    (getDb()
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM budget_category_groups')
      .get() as { max_order: number }).max_order + 1

  getDb()
    .prepare(
      `INSERT INTO budget_category_groups (id, name, sort_order, created_at)
       VALUES (@id, @name, @sortOrder, @createdAt)`
    )
    .run({ id, name: input.name.trim(), sortOrder, createdAt })

  return rowToGroup(
    getDb()
      .prepare(`SELECT id, name, sort_order, created_at FROM budget_category_groups WHERE id = ?`)
      .get(id) as { id: string; name: string; sort_order: number; created_at: string }
  )
}

export function renameCategoryGroup(input: RenameCategoryGroupInput): CategoryGroupRecord {
  const name = input.name.trim()
  if (!name) throw new Error('Group name is required')
  getDb()
    .prepare('UPDATE budget_category_groups SET name = @name WHERE id = @id')
    .run({ id: input.id, name })
  const row = getDb()
    .prepare(`SELECT id, name, sort_order, created_at FROM budget_category_groups WHERE id = ?`)
    .get(input.id) as { id: string; name: string; sort_order: number; created_at: string } | undefined
  if (!row) throw new Error('Group not found')
  return rowToGroup(row)
}

export function deleteCategoryGroup(id: string): void {
  getDb().prepare('UPDATE budget_categories SET group_id = NULL WHERE group_id = ?').run(id)
  getDb().prepare('DELETE FROM budget_category_groups WHERE id = ?').run(id)
}

export function transferAssignment(input: TransferAssignmentInput): void {
  if (input.fromCategoryId === input.toCategoryId) {
    throw new Error('Cannot transfer to the same envelope')
  }
  if (input.amountCents <= 0) {
    throw new Error('Transfer amount must be positive')
  }

  const db = getDb()
  const fromRow = db
    .prepare(
      `SELECT amount_cents FROM budget_assignments WHERE category_id = ? AND period_key = ?`
    )
    .get(input.fromCategoryId, input.periodKey) as { amount_cents: number } | undefined
  const fromAssigned = fromRow?.amount_cents ?? 0

  if (fromAssigned < input.amountCents) {
    throw new Error('Insufficient assigned funds in source envelope')
  }

  const toRow = db
    .prepare(
      `SELECT amount_cents FROM budget_assignments WHERE category_id = ? AND period_key = ?`
    )
    .get(input.toCategoryId, input.periodKey) as { amount_cents: number } | undefined
  const toAssigned = toRow?.amount_cents ?? 0
  const now = new Date().toISOString()

  const upsert = db.prepare(
    `INSERT INTO budget_assignments (id, category_id, amount_cents, period_key, created_at)
     VALUES (@id, @categoryId, @amountCents, @periodKey, @createdAt)
     ON CONFLICT(category_id, period_key) DO UPDATE SET
       amount_cents = excluded.amount_cents,
       created_at = excluded.created_at`
  )

  const run = db.transaction(() => {
    upsert.run({
      id: randomUUID(),
      categoryId: input.fromCategoryId,
      amountCents: fromAssigned - input.amountCents,
      periodKey: input.periodKey,
      createdAt: now
    })
    upsert.run({
      id: randomUUID(),
      categoryId: input.toCategoryId,
      amountCents: toAssigned + input.amountCents,
      periodKey: input.periodKey,
      createdAt: now
    })
  })

  run()
}

export function listPayees(limit = 40): PayeeRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, last_used_at, created_at FROM payees ORDER BY last_used_at DESC LIMIT ?`
    )
    .all(limit) as Array<{ id: string; name: string; last_used_at: string; created_at: string }>

  return rows.map(rowToPayee)
}

export function upsertPayeeByName(name: string): PayeeRecord {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Payee name required')
  }

  const now = new Date().toISOString()
  const existing = getDb()
    .prepare(`SELECT id, name, last_used_at, created_at FROM payees WHERE name = ? COLLATE NOCASE`)
    .get(trimmed) as { id: string; name: string; last_used_at: string; created_at: string } | undefined

  if (existing) {
    getDb().prepare(`UPDATE payees SET last_used_at = ? WHERE id = ?`).run(now, existing.id)
    return rowToPayee({ ...existing, last_used_at: now })
  }

  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO payees (id, name, last_used_at, created_at) VALUES (@id, @name, @lastUsedAt, @createdAt)`
    )
    .run({ id, name: trimmed, lastUsedAt: now, createdAt: now })

  return rowToPayee(
    getDb()
      .prepare(`SELECT id, name, last_used_at, created_at FROM payees WHERE id = ?`)
      .get(id) as { id: string; name: string; last_used_at: string; created_at: string }
  )
}

export function listHoldingsForAccount(accountId: string): InvestmentHoldingRecord[] {
  const rows = getDb()
    .prepare(
      `${HOLDING_SELECT}
       FROM investment_holdings WHERE account_id = ? ORDER BY symbol ASC`
    )
    .all(accountId) as HoldingRow[]

  return rows.map(rowToHolding)
}

export function createInvestmentHolding(input: CreateInvestmentHoldingInput): InvestmentHoldingRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO investment_holdings
       (id, account_id, symbol, label, quantity, cost_basis_cents, manual_price_cents, allocation_tag, created_at)
       VALUES (@id, @accountId, @symbol, @label, @quantity, @costBasisCents, @manualPriceCents, @allocationTag, @createdAt)`
    )
    .run({
      id,
      accountId: input.accountId,
      symbol: input.symbol.trim().toUpperCase(),
      label: (input.label ?? input.symbol).trim(),
      quantity: input.quantity,
      costBasisCents: input.costBasisCents,
      manualPriceCents: input.manualPriceCents ?? null,
      allocationTag: (input.allocationTag ?? '').trim(),
      createdAt
    })

  return rowToHolding(
    getDb()
      .prepare(
        `${HOLDING_SELECT}
         FROM investment_holdings WHERE id = ?`
      )
      .get(id) as HoldingRow
  )
}

export function updateInvestmentHolding(input: UpdateInvestmentHoldingInput): InvestmentHoldingRecord {
  const existing = getDb()
    .prepare(
      `${HOLDING_SELECT}
       FROM investment_holdings WHERE id = ?`
    )
    .get(input.id) as HoldingRow | undefined

  if (!existing) {
    throw new Error('Holding not found')
  }

  const allocationTag =
    input.allocationTag !== undefined ? input.allocationTag.trim() : existing.allocation_tag
  const manualPriceCents =
    input.manualPriceCents !== undefined ? input.manualPriceCents : existing.manual_price_cents

  getDb()
    .prepare(
      `UPDATE investment_holdings
       SET allocation_tag = @allocationTag, manual_price_cents = @manualPriceCents
       WHERE id = @id`
    )
    .run({
      id: input.id,
      allocationTag,
      manualPriceCents
    })

  return rowToHolding(
    getDb()
      .prepare(
        `${HOLDING_SELECT}
         FROM investment_holdings WHERE id = ?`
      )
      .get(input.id) as HoldingRow
  )
}

export function deleteInvestmentHolding(id: string): void {
  getDb().prepare('DELETE FROM investment_holdings WHERE id = ?').run(id)
}

export async function refreshInvestmentQuotes(): Promise<{ updated: number; stale: boolean }> {
  const rows = getDb()
    .prepare(`SELECT id, symbol FROM investment_holdings`)
    .all() as Array<{ id: string; symbol: string }>

  let updated = 0
  let anyStale = false
  const now = new Date().toISOString()

  for (const row of rows) {
    const quote = await fetchInvestmentQuote(row.symbol)
    if (quote === null) {
      anyStale = true
      continue
    }

    getDb()
      .prepare(
        `UPDATE investment_holdings
         SET quote_price_cents = ?, quote_fetched_at = ?, quote_day_change_percent = ?
         WHERE id = ?`
      )
      .run(quote.priceCents, now, quote.dayChangePercent, row.id)
    updated += 1
  }

  if (rows.length > 0 && updated === 0) {
    anyStale = true
  }

  return { updated, stale: anyStale }
}

export function portfolioTotalsFromHoldings(): { totalCents: number; quotesStale: boolean } {
  const holdings = getDb()
    .prepare(
      `${HOLDING_SELECT} FROM investment_holdings`
    )
    .all() as HoldingRow[]

  if (holdings.length === 0) {
    return { totalCents: 0, quotesStale: false }
  }

  let total = 0
  let quotesStale = false

  for (const row of holdings) {
    const holding = rowToHolding(row)
    total += holding.marketValueCents
    if (holding.quoteStale && !holding.manualPriceCents) {
      quotesStale = true
    }
  }

  return { totalCents: total, quotesStale }
}
