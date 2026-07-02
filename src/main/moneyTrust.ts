import type { SavingsGoalKind } from '@shared/moneySavings'
import {
  DEFAULT_MONEY_TRUST_SETTINGS,
  MONEY_PRIVACY_COPY,
  type MoneyTrustOverview,
  type MoneyTrustSettings,
  type MoneyTrustSurface
} from '@shared/moneyTrust'
import { currentPeriodKey } from '@shared/money'
import { getDb, getSetting, setSetting } from './database'
import { getBudgetOverview, getInvestmentsOverview, listCashAccounts } from './money'
import { getMoneyFlowGuidance } from './moneyFlow'
import { getSavingsOverview } from './moneySavings'

const QUOTE_STALE_KEY = 'money.trust.quoteStaleMinutes'
const SAVINGS_DEFAULT_KIND_KEY = 'money.trust.defaultSavingsGoalKind'

export function getMoneyTrustSettings(): MoneyTrustSettings {
  const staleRaw = getSetting(QUOTE_STALE_KEY)?.value
  const kindRaw = getSetting(SAVINGS_DEFAULT_KIND_KEY)?.value
  const minutes =
    staleRaw !== undefined && staleRaw !== '' ? Number.parseInt(staleRaw, 10) : 15
  const defaultSavingsGoalKind: SavingsGoalKind =
    kindRaw === 'emergency' ||
    kindRaw === 'cushion' ||
    kindRaw === 'purchase' ||
    kindRaw === 'project' ||
    kindRaw === 'custom'
      ? kindRaw
      : DEFAULT_MONEY_TRUST_SETTINGS.defaultSavingsGoalKind
  return {
    quoteStaleMinutes:
      Number.isFinite(minutes) && minutes > 0
        ? Math.min(24 * 60, Math.max(5, minutes))
        : DEFAULT_MONEY_TRUST_SETTINGS.quoteStaleMinutes,
    defaultSavingsGoalKind
  }
}

export function setMoneyTrustSettings(input: Partial<MoneyTrustSettings>): MoneyTrustSettings {
  const current = getMoneyTrustSettings()
  const next: MoneyTrustSettings = {
    quoteStaleMinutes:
      input.quoteStaleMinutes !== undefined
        ? Math.min(24 * 60, Math.max(5, Math.round(input.quoteStaleMinutes)))
        : current.quoteStaleMinutes,
    defaultSavingsGoalKind: input.defaultSavingsGoalKind ?? current.defaultSavingsGoalKind
  }
  setSetting(QUOTE_STALE_KEY, String(next.quoteStaleMinutes))
  setSetting(SAVINGS_DEFAULT_KIND_KEY, next.defaultSavingsGoalKind)
  return next
}

function countImportedTransactions(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM ledger_transactions WHERE tags LIKE '%"imported"%'`)
    .get() as { count: number }
  return row.count
}

function countLedgerStatus(status: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM ledger_transactions WHERE status = ?`)
    .get(status) as { count: number }
  return row.count
}

function countUnreconciledCleared(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM ledger_transactions WHERE status = 'cleared'`)
    .get() as { count: number }
  return row.count
}

function investmentQuoteMeta(): { lastQuoteFetchedAt: string | null; manualPriceCount: number } {
  const rows = getDb()
    .prepare(
      `SELECT quote_fetched_at, manual_price_cents FROM investment_holdings`
    )
    .all() as Array<{ quote_fetched_at: string | null; manual_price_cents: number | null }>
  let lastQuoteFetchedAt: string | null = null
  let manualPriceCount = 0
  for (const row of rows) {
    if (row.manual_price_cents !== null) manualPriceCount += 1
    if (row.quote_fetched_at) {
      if (!lastQuoteFetchedAt || row.quote_fetched_at > lastQuoteFetchedAt) {
        lastQuoteFetchedAt = row.quote_fetched_at
      }
    }
  }
  return { lastQuoteFetchedAt, manualPriceCount }
}

function formatQuoteAge(iso: string | null): string {
  if (!iso) return 'never refreshed'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return `${hours} hr ago`
}

export function getMoneyTrustOverview(periodKey?: string): MoneyTrustOverview {
  const period = periodKey ?? currentPeriodKey()
  const settings = getMoneyTrustSettings()
  const accounts = listCashAccounts().filter((account) => !account.archived)
  const pendingCount = countLedgerStatus('pending')
  const unreconciledCount = countUnreconciledCleared()
  const importedCount = countImportedTransactions()

  const budget = getBudgetOverview(period)
  const guidance = getMoneyFlowGuidance(period)
  const savings = getSavingsOverview(period)
  const investments = getInvestmentsOverview()
  const quoteMeta = investmentQuoteMeta()

  const offTrackCount = savings.goals.filter((row) => !row.guidance.onTrackThisPeriod).length

  const ledgerWhy =
    importedCount > 0
      ? `${importedCount} imported row${importedCount === 1 ? '' : 's'} · ${pendingCount} pending · ${unreconciledCount} cleared but not reconciled`
      : pendingCount > 0 || unreconciledCount > 0
        ? `${pendingCount} pending · ${unreconciledCount} cleared but not reconciled`
        : 'Every ledger row is manual — typed or logged here, or brought in via Import.'

  const investmentWhy =
    investments.holdingsTotalCents <= 0
      ? 'Add holdings or snapshots to track portfolio value.'
      : investments.quotesStale
        ? `Quotes ${formatQuoteAge(quoteMeta.lastQuoteFetchedAt)} — refresh or enter manual prices.`
        : quoteMeta.manualPriceCount > 0
          ? `Live quotes where available · ${quoteMeta.manualPriceCount} manual price${quoteMeta.manualPriceCount === 1 ? '' : 's'}.`
          : `Quotes refreshed ${formatQuoteAge(quoteMeta.lastQuoteFetchedAt)}.`

  const savingsWhy =
    !savings.hasGoals
      ? 'Create a goal to see progress from assigned envelope money.'
      : offTrackCount > 0
        ? `${offTrackCount} goal${offTrackCount === 1 ? '' : 's'} need more assigned this month.`
        : 'All goals on track for this month.'

  const surfaces: MoneyTrustSurface[] = [
    {
      id: 'safe-to-spend',
      label: 'Safe to spend',
      kind: 'derived',
      why: guidance.safeToSpend.why
    },
    {
      id: 'safe-to-assign',
      label: 'Still to assign',
      kind: 'derived',
      why: guidance.safeToAssign.why
    },
    {
      id: 'month-flow',
      label: 'Month flow',
      kind: 'derived',
      why: `Income plus ledger activity for ${period}. Paychecks count when you log them.`
    },
    {
      id: 'ledger',
      label: 'Ledger register',
      kind: importedCount > 0 ? 'imported' : 'manual',
      why: ledgerWhy
    },
    {
      id: 'paychecks',
      label: 'Paychecks',
      kind: 'manual',
      why: `${budget.paychecks.length} logged this month — always manual entry.`
    }
  ]

  if (savings.hasGoals) {
    surfaces.push({
      id: 'savings',
      label: 'Savings goals',
      kind: 'derived',
      why: savingsWhy
    })
  }

  if (investments.holdingsTotalCents > 0 || investments.accounts.length > 0) {
    surfaces.push({
      id: 'portfolio',
      label: 'Portfolio',
      kind: investments.quotesStale ? 'stale' : quoteMeta.manualPriceCount > 0 ? 'estimated' : 'current',
      why: investmentWhy
    })
  }

  const reconciliationMismatches = investments.reconciliation.filter((row) => row.diverged).length

  return {
    settings,
    privacyCopy: MONEY_PRIVACY_COPY,
    surfaces,
    ledger: {
      accountCount: accounts.length,
      pendingCount,
      unreconciledCount,
      importedCount,
      why: ledgerWhy
    },
    investments: {
      holdingCount: investments.accounts.reduce((sum, row) => sum + row.holdings.length, 0),
      manualPriceCount: quoteMeta.manualPriceCount,
      quotesStale: investments.quotesStale,
      lastQuoteFetchedAt: quoteMeta.lastQuoteFetchedAt,
      reconciliationMismatches,
      why: investmentWhy
    },
    savings: {
      goalCount: savings.goals.length,
      offTrackCount,
      why: savingsWhy
    }
  }
}
