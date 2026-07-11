import type { SavingsGoalKind } from './moneySavings'

/** How a number or row entered the system — shown as plain-language badges. */
export type MoneyDataTrustKind =
  | 'manual'
  | 'derived'
  | 'imported'
  | 'estimated'
  | 'current'
  | 'reconciled'
  | 'stale'

export const MONEY_DATA_TRUST_LABELS: Record<MoneyDataTrustKind, string> = {
  manual: 'You entered this',
  derived: 'Calculated',
  imported: 'Imported',
  estimated: 'Estimated',
  current: 'Up to date',
  reconciled: 'Reconciled',
  stale: 'May be stale'
}

export const MONEY_DATA_TRUST_SHORT: Record<MoneyDataTrustKind, string> = {
  manual: 'Manual',
  derived: 'Calculated',
  imported: 'Imported',
  estimated: 'Est.',
  current: 'Current',
  reconciled: 'Reconciled',
  stale: 'Stale'
}

export interface MoneyTrustSettings {
  /** Minutes before a market quote is treated as stale. */
  quoteStaleMinutes: number
  /** Default template when creating a new savings goal. */
  defaultSavingsGoalKind: SavingsGoalKind
}

export const DEFAULT_MONEY_TRUST_SETTINGS: MoneyTrustSettings = {
  quoteStaleMinutes: 15,
  defaultSavingsGoalKind: 'emergency'
}

export interface MoneyTrustSurface {
  id: string
  label: string
  kind: MoneyDataTrustKind
  why: string
}

export interface MoneyTrustLedgerState {
  accountCount: number
  pendingCount: number
  unreconciledCount: number
  importedCount: number
  why: string
}

export interface MoneyTrustInvestmentState {
  holdingCount: number
  manualPriceCount: number
  quotesStale: boolean
  lastQuoteFetchedAt: string | null
  reconciliationMismatches: number
  why: string
}

export interface MoneyTrustSavingsState {
  goalCount: number
  offTrackCount: number
  why: string
}

export interface MoneyTrustOverview {
  settings: MoneyTrustSettings
  privacyCopy: string
  surfaces: MoneyTrustSurface[]
  ledger: MoneyTrustLedgerState
  investments: MoneyTrustInvestmentState
  savings: MoneyTrustSavingsState
}

export const MONEY_PRIVACY_COPY =
  'Your budget, ledger, and savings live only on this device. MOSS does not sell your data, show ads, or require a cloud account. Market quotes are fetched when you refresh holdings — nothing financial is uploaded.'

export function trustChipClass(kind: MoneyDataTrustKind): string {
  switch (kind) {
    case 'current':
    case 'reconciled':
      return 'money-chip money-chip--accent'
    case 'stale':
    case 'estimated':
      return 'money-chip money-chip--warn'
    case 'derived':
      return 'money-chip money-chip--quiet'
    default:
      return 'money-chip'
  }
}

export function normalizeMoneyTrustSettings(raw: unknown): MoneyTrustSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_MONEY_TRUST_SETTINGS }
  }
  const input = raw as Partial<MoneyTrustSettings>
  const minutes =
    typeof input.quoteStaleMinutes === 'number' && Number.isFinite(input.quoteStaleMinutes)
      ? Math.round(input.quoteStaleMinutes)
      : DEFAULT_MONEY_TRUST_SETTINGS.quoteStaleMinutes
  const kind = input.defaultSavingsGoalKind
  const defaultSavingsGoalKind: SavingsGoalKind =
    kind === 'emergency' ||
    kind === 'cushion' ||
    kind === 'purchase' ||
    kind === 'project' ||
    kind === 'custom'
      ? kind
      : DEFAULT_MONEY_TRUST_SETTINGS.defaultSavingsGoalKind
  return {
    quoteStaleMinutes: Math.min(24 * 60, Math.max(5, minutes)),
    defaultSavingsGoalKind
  }
}

export function normalizeMoneyTrustOverview(raw: unknown): MoneyTrustOverview {
  if (!raw || typeof raw !== 'object') {
    return {
      settings: { ...DEFAULT_MONEY_TRUST_SETTINGS },
      privacyCopy: MONEY_PRIVACY_COPY,
      surfaces: [],
      ledger: {
        accountCount: 0,
        pendingCount: 0,
        unreconciledCount: 0,
        importedCount: 0,
        why: 'Ledger rows are manual unless you import a file.'
      },
      investments: {
        holdingCount: 0,
        manualPriceCount: 0,
        quotesStale: false,
        lastQuoteFetchedAt: null,
        reconciliationMismatches: 0,
        why: 'No holdings yet.'
      },
      savings: { goalCount: 0, offTrackCount: 0, why: 'No savings goals yet.' }
    }
  }
  const input = raw as Partial<MoneyTrustOverview>
  return {
    settings: normalizeMoneyTrustSettings(input.settings),
    privacyCopy:
      typeof input.privacyCopy === 'string' && input.privacyCopy.trim()
        ? input.privacyCopy
        : MONEY_PRIVACY_COPY,
    surfaces: Array.isArray(input.surfaces) ? input.surfaces : [],
    ledger:
      input.ledger && typeof input.ledger === 'object'
        ? {
            accountCount: Number(input.ledger.accountCount) || 0,
            pendingCount: Number(input.ledger.pendingCount) || 0,
            unreconciledCount: Number(input.ledger.unreconciledCount) || 0,
            importedCount: Number(input.ledger.importedCount) || 0,
            why:
              typeof input.ledger.why === 'string'
                ? input.ledger.why
                : 'Ledger rows are manual unless you import a file.'
          }
        : {
            accountCount: 0,
            pendingCount: 0,
            unreconciledCount: 0,
            importedCount: 0,
            why: 'Ledger rows are manual unless you import a file.'
          },
    investments:
      input.investments && typeof input.investments === 'object'
        ? {
            holdingCount: Number(input.investments.holdingCount) || 0,
            manualPriceCount: Number(input.investments.manualPriceCount) || 0,
            quotesStale: Boolean(input.investments.quotesStale),
            lastQuoteFetchedAt:
              typeof input.investments.lastQuoteFetchedAt === 'string'
                ? input.investments.lastQuoteFetchedAt
                : null,
            reconciliationMismatches: Number(input.investments.reconciliationMismatches) || 0,
            why:
              typeof input.investments.why === 'string'
                ? input.investments.why
                : 'No holdings yet.'
          }
        : {
            holdingCount: 0,
            manualPriceCount: 0,
            quotesStale: false,
            lastQuoteFetchedAt: null,
            reconciliationMismatches: 0,
            why: 'No holdings yet.'
          },
    savings:
      input.savings && typeof input.savings === 'object'
        ? {
            goalCount: Number(input.savings.goalCount) || 0,
            offTrackCount: Number(input.savings.offTrackCount) || 0,
            why:
              typeof input.savings.why === 'string' ? input.savings.why : 'No savings goals yet.'
          }
        : { goalCount: 0, offTrackCount: 0, why: 'No savings goals yet.' }
  }
}
