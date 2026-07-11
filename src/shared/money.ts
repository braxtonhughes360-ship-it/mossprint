export interface PaycheckRecord {
  id: string
  label: string
  amountCents: number
  receivedAt: string
  accountId: string | null
  createdAt: string
}

export interface CategoryRecord {
  id: string
  name: string
  sortOrder: number
  groupId: string | null
  /** Optional monthly funding goal (Actual-style target). null = no target set. */
  targetCents: number | null
  /** When false, remaining balance is excluded from safe-to-spend (bills, savings). */
  countsTowardSafeToSpend: boolean
  /** When true, unspent balance carries forward (sinking fund). When false (default),
   * leftover returns to the "to assign" pool each period. */
  rolloverEnabled: boolean
  /** Pile permanently released to "to assign" when rollover was turned off (Option A). */
  rolloverReleasedCents: number
  createdAt: string
}

export interface CategoryGroupRecord {
  id: string
  name: string
  sortOrder: number
  createdAt: string
}

export interface PayeeRecord {
  id: string
  name: string
  lastUsedAt: string
  createdAt: string
}

export interface AssignmentRecord {
  id: string
  categoryId: string
  amountCents: number
  periodKey: string
  createdAt: string
}

export interface TransactionSplitRecord {
  id: string
  transactionId: string
  categoryId: string | null
  amountCents: number
  memo: string
  createdAt: string
}

/**
 * Explicit transaction type. Sign still lives in `amountCents`, but the type
 * makes intent legible: an `income` row is positive, `expense` negative, a
 * `transfer` is one leg of a two-row money move between cash accounts, and an
 * `adjustment` is a manual balance correction (reconciliation).
 */
export type TransactionType = 'income' | 'expense' | 'transfer' | 'adjustment'

/** Where a row sits in the clear/reconcile lifecycle. */
export type TransactionStatus = 'pending' | 'cleared' | 'reconciled'

export interface TransactionRecord {
  id: string
  amountCents: number
  type: TransactionType
  status: TransactionStatus
  categoryId: string | null
  payeeId: string | null
  payeeName: string | null
  memo: string
  /** Free-form note, distinct from the short payee/memo label. */
  notes: string
  /** Lightweight labels for filtering and grouping. */
  tags: string[]
  occurredAt: string
  accountId: string | null
  /** The other account when this row is one leg of a transfer; else null. */
  transferAccountId: string | null
  /** Links the two legs of a transfer; else null. */
  transferGroupId: string | null
  /** Category lines when this row is split; empty when single-category. */
  splits: TransactionSplitRecord[]
  createdAt: string
  /** Last edit timestamp; null until first edit. */
  updatedAt: string | null
}

export interface CategoryBudgetRow {
  category: CategoryRecord
  /** Money assigned to this envelope **this period** only. */
  assignedCents: number
  /** Money spent against this envelope **this period** only. */
  spentCents: number
  /**
   * Balance rolled in from prior periods (available at the end of last period).
   * Positive = leftover carried forward; negative = overspend carried forward.
   * Always computed — UI hides this on the collapsed row when rollover is off.
   */
  carryInCents: number
  /** Available now = carryIn + assignedThisPeriod − spentThisPeriod (envelope "X left"). */
  remainingCents: number
  /** Convenience mirror of category.targetCents for the budget surface. */
  targetCents: number | null
}

export interface MoneyBudgetOverview {
  periodKey: string
  paycheckTotalCents: number
  assignedTotalCents: number
  unassignedCents: number
  groups: CategoryGroupRecord[]
  categories: CategoryBudgetRow[]
  overspent: Array<{ categoryId: string; name: string; remainingCents: number }>
  paychecks: PaycheckRecord[]
}

export interface MoneySummary {
  periodKey: string
  /** Paychecks + ledger entries — full month cash flow. */
  monthFlowCents: number
  /** Ledger register only (expenses + ledger income). */
  ledgerNetCents: number
  unassignedCents: number
  paycheckTotalCents: number
  assignedTotalCents: number
  hasData: boolean
  headline: string
  doorDetail: string
}

export interface MoneyEnvelopeGlance {
  categoryId: string
  name: string
  assignedCents: number
  spentCents: number
  remainingCents: number
}

export interface MoneyDoorAllocationSlice {
  categoryId: string
  name: string
  assignedCents: number
  percent: number
}

export interface MoneyDoorSnapshot {
  summary: MoneySummary
  envelopes: MoneyEnvelopeGlance[]
  portfolioTotalCents: number
  quotesStale: boolean
  /** V2c flow glance — safe-to-spend headline + one-word status. */
  flowStatusLabel?: string
  flowStatus?: 'on_track' | 'tight' | 'over'
  safeToSpendCents?: number
  /** Plain-English safe-to-spend breakdown for door tooltip. */
  safeToSpendWhy?: string
  /** V2.75a — ties hero to subordinate figures without competing big numbers. */
  relationshipLine?: string
  rentGlanceWhy?: string
  /** Month flow retained after ledger, as % of income (V2h door ring). */
  retentionPct?: number
  /** Top envelope slices for door allocation strip (V2h). */
  allocation?: MoneyDoorAllocationSlice[]
  /** Recent month-flow cents for door sparkline when ≥2 months of data exist. */
  flowTrendCents?: number[]
}

export interface CreatePaycheckInput {
  label: string
  amountCents: number
  receivedAt: string
  accountId?: string | null
}

export interface UpdatePaycheckInput {
  id: string
  label?: string
  amountCents?: number
  receivedAt?: string
  accountId?: string | null
}

export interface PostScheduleInput {
  /** Override template amount for this occurrence (positive cents). */
  amountCents?: number
}

export interface CreateCategoryInput {
  name: string
  groupId?: string | null
  targetCents?: number | null
  countsTowardSafeToSpend?: boolean
  /** Defaults to !countsTowardSafeToSpend (bills/savings carry forward, spending resets). */
  rolloverEnabled?: boolean
}

export interface SetCategorySpendPolicyInput {
  categoryId: string
  countsTowardSafeToSpend: boolean
}

export interface SetCategoryGroupInput {
  categoryId: string
  /** null moves the envelope to "Other" (no group). */
  groupId: string | null
}

export interface SetCategoryRolloverInput {
  categoryId: string
  rolloverEnabled: boolean
}

export interface SetCategoryTargetInput {
  categoryId: string
  /** null clears the target. */
  targetCents: number | null
}

export interface CreateCategoryGroupInput {
  name: string
}

export interface RenameCategoryGroupInput {
  id: string
  name: string
}

export interface TransferAssignmentInput {
  fromCategoryId: string
  toCategoryId: string
  periodKey: string
  amountCents: number
}

export interface CoverOverspendingInput {
  categoryId: string
  periodKey: string
  /** Pull from unassigned pool or another envelope */
  source: 'pool' | 'category'
  sourceCategoryId?: string
}

export interface SetAssignmentInput {
  categoryId: string
  periodKey: string
  amountCents: number
}

export interface TransactionSplitInput {
  categoryId: string | null
  amountCents: number
  memo?: string
}

export interface CreateTransactionInput {
  amountCents: number
  /** Defaults from the sign of amountCents when omitted. */
  type?: TransactionType
  /** Defaults to 'cleared'. */
  status?: TransactionStatus
  categoryId?: string | null
  payeeName?: string
  memo?: string
  notes?: string
  tags?: string[]
  occurredAt: string
  accountId?: string | null
  /** When present and non-empty, the row is split — signed amounts must sum to amountCents. */
  splits?: TransactionSplitInput[]
}

export interface UpdateTransactionInput {
  id: string
  amountCents: number
  type: TransactionType
  status: TransactionStatus
  categoryId?: string | null
  payeeName?: string
  memo?: string
  notes?: string
  tags?: string[]
  occurredAt: string
  accountId?: string | null
  splits?: TransactionSplitInput[]
}

export interface SetTransactionStatusInput {
  id: string
  status: TransactionStatus
}

/** Two-leg cash transfer between accounts. Amount is a positive magnitude. */
export interface CreateTransferInput {
  fromAccountId: string
  toAccountId: string
  amountCents: number
  occurredAt: string
  memo?: string
  notes?: string
  tags?: string[]
  status?: TransactionStatus
}

export type LedgerAuditAction = 'created' | 'edited' | 'deleted' | 'restored'

/** One inspectable entry in a transaction's edit history. */
export interface LedgerAuditRecord {
  id: string
  transactionId: string
  action: LedgerAuditAction
  summary: string
  createdAt: string
}

/** Returned from a delete so the UI can offer a one-click undo. */
export interface DeleteTransactionResult {
  ok: true
  /** Opaque JSON snapshot of the removed row(s) — pass back to restore. */
  undoToken: string
}

/** Per-account clear/reconcile state for the reconciliation surface. */
export interface ReconciliationSummary {
  accountId: string
  /** Starting balance + every posted row, pending included. */
  workingBalanceCents: number
  /** Starting balance + cleared and reconciled rows only. */
  clearedBalanceCents: number
  /** Signed sum of still-pending rows. */
  pendingCents: number
  pendingCount: number
  /** Cleared but not yet reconciled. */
  unreconciledCount: number
}

// —— Cash accounts (checking / savings / cash) + credit cards (liability) ——

export type CashAccountType = 'checking' | 'savings' | 'cash' | 'credit' | 'other'

/** A credit card is a liability account — its balance is negative when money is owed. */
export function isCreditAccountType(type: CashAccountType): boolean {
  return type === 'credit'
}

/** Amount owed on a liability account (0 when paid off or in credit). */
export function accountOwedCents(balanceCents: number): number {
  return Math.max(0, -balanceCents)
}

export interface CashAccountRecord {
  id: string
  name: string
  type: CashAccountType
  startingBalanceCents: number
  sortOrder: number
  archived: boolean
  createdAt: string
}

export interface CashAccountBalance extends CashAccountRecord {
  /** startingBalanceCents + posted paycheck/ledger activity. */
  balanceCents: number
}

export interface CreateCashAccountInput {
  name: string
  type: CashAccountType
  startingBalanceCents?: number
}

// —— Scheduled income & recurring bills ——

export type ScheduleKind = 'income' | 'bill'
export type ScheduleCadence = 'weekly' | 'biweekly' | 'monthly'

export interface ScheduleRecord {
  id: string
  kind: ScheduleKind
  label: string
  /** Positive magnitude; sign comes from kind. */
  amountCents: number
  categoryId: string | null
  accountId: string | null
  cadence: ScheduleCadence
  nextDate: string
  lastPostedAt: string | null
  createdAt: string
}

export interface CreateScheduleInput {
  kind: ScheduleKind
  label: string
  amountCents: number
  categoryId?: string | null
  accountId?: string | null
  cadence: ScheduleCadence
  /** ISO date (YYYY-MM-DD) of the next occurrence. */
  nextDate: string
}

// —— Auto-categorize rules ——

export type RuleMatchField = 'payee' | 'memo'
export type RuleMatchType = 'contains' | 'equals'

export interface BudgetRuleRecord {
  id: string
  matchField: RuleMatchField
  matchType: RuleMatchType
  matchValue: string
  categoryId: string
  categoryName: string | null
  sortOrder: number
  createdAt: string
}

export interface CreateBudgetRuleInput {
  matchField: RuleMatchField
  matchType: RuleMatchType
  matchValue: string
  categoryId: string
}

export type InvestmentAccountType = '401k' | 'brokerage' | 'ira' | 'other'

export interface InvestmentAccountRecord {
  id: string
  label: string
  accountType: InvestmentAccountType
  notes: string
  createdAt: string
}

export interface InvestmentSnapshotRecord {
  id: string
  accountId: string
  valueCents: number
  asOf: string
  memo: string
  createdAt: string
}

export interface InvestmentAccountRow {
  account: InvestmentAccountRecord
  latestSnapshot: InvestmentSnapshotRecord | null
  holdings: InvestmentHoldingRecord[]
  valueCents: number
}

export type InvestmentActivityType = 'buy' | 'sell' | 'dividend' | 'fee' | 'interest'

export interface InvestmentActivityRecord {
  id: string
  accountId: string
  type: InvestmentActivityType
  symbol: string | null
  quantity: number | null
  amountCents: number
  occurredAt: string
  memo: string
  createdAt: string
}

export type InvestmentPerformanceWindow = 'today' | 'wtd' | 'mtd' | 'ytd' | '1y' | 'max'

export interface InvestmentPerformanceReadout {
  window: InvestmentPerformanceWindow
  label: string
  changeCents: number | null
  changePercent: number | null
  estimated: boolean
  why: string
}

export interface InvestmentReconciliationReadout {
  accountId: string
  holdingsCents: number
  snapshotCents: number | null
  diverged: boolean
  deltaCents: number
  why: string
}

export interface InvestmentAllocationSlice {
  tag: string
  cents: number
  percent: number
}

export interface InvestmentDividendRow {
  id: string
  accountId: string
  symbol: string | null
  amountCents: number
  occurredAt: string
  memo: string
}

export interface InvestmentHoldingRecord {
  id: string
  accountId: string
  symbol: string
  label: string
  quantity: number
  costBasisCents: number
  manualPriceCents: number | null
  quotePriceCents: number | null
  quoteFetchedAt: string | null
  /** Intraday % change from the last quote refresh; null when unavailable. */
  quoteDayChangePercent: number | null
  marketValueCents: number
  gainLossCents: number
  quoteStale: boolean
  allocationTag: string
}

export interface InvestmentsOverview {
  accounts: InvestmentAccountRow[]
  totalCents: number
  holdingsTotalCents: number
  quotesStale: boolean
  performance: InvestmentPerformanceReadout[]
  allocation: InvestmentAllocationSlice[]
  reconciliation: InvestmentReconciliationReadout[]
  dividends: InvestmentDividendRow[]
  activities: InvestmentActivityRecord[]
}

export interface CreateInvestmentHoldingInput {
  accountId: string
  symbol: string
  label?: string
  quantity: number
  costBasisCents: number
  manualPriceCents?: number | null
  allocationTag?: string
}

export interface CreateInvestmentActivityInput {
  accountId: string
  type: InvestmentActivityType
  symbol?: string | null
  quantity?: number | null
  amountCents: number
  occurredAt: string
  memo?: string
}

export interface UpdateInvestmentHoldingInput {
  id: string
  allocationTag?: string
  manualPriceCents?: number | null
}

export interface CreateInvestmentAccountInput {
  label: string
  accountType: InvestmentAccountType
  notes?: string
}

export interface CreateInvestmentSnapshotInput {
  accountId: string
  valueCents: number
  asOf: string
  memo?: string
}

const EMPTY_INVESTMENTS_OVERVIEW: InvestmentsOverview = {
  accounts: [],
  totalCents: 0,
  holdingsTotalCents: 0,
  quotesStale: false,
  performance: [],
  allocation: [],
  reconciliation: [],
  dividends: [],
  activities: []
}

function normalizeInvestmentHolding(raw: unknown): InvestmentHoldingRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<InvestmentHoldingRecord>
  if (typeof row.id !== 'string' || typeof row.symbol !== 'string') return null
  const quantity = typeof row.quantity === 'number' ? row.quantity : 0
  const costBasisCents = typeof row.costBasisCents === 'number' ? row.costBasisCents : 0
  const marketValueCents =
    typeof row.marketValueCents === 'number'
      ? row.marketValueCents
      : computeHoldingMarketValueCents(
          quantity,
          holdingPriceCents({
            manualPriceCents: row.manualPriceCents ?? null,
            quotePriceCents: row.quotePriceCents ?? null
          })
        )
  return {
    id: row.id,
    accountId: typeof row.accountId === 'string' ? row.accountId : '',
    symbol: row.symbol,
    label: typeof row.label === 'string' ? row.label : row.symbol,
    quantity,
    costBasisCents,
    manualPriceCents: row.manualPriceCents ?? null,
    quotePriceCents: row.quotePriceCents ?? null,
    quoteFetchedAt: row.quoteFetchedAt ?? null,
    quoteDayChangePercent:
      typeof row.quoteDayChangePercent === 'number' && Number.isFinite(row.quoteDayChangePercent)
        ? row.quoteDayChangePercent
        : null,
    marketValueCents,
    gainLossCents:
      typeof row.gainLossCents === 'number' ? row.gainLossCents : marketValueCents - costBasisCents,
    quoteStale: Boolean(row.quoteStale),
    allocationTag: typeof row.allocationTag === 'string' ? row.allocationTag : ''
  }
}

/** Coerce IPC payloads — partial/stale responses must not crash the renderer. */
export function normalizeInvestmentsOverview(raw: unknown): InvestmentsOverview {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_INVESTMENTS_OVERVIEW }
  }

  const input = raw as Partial<InvestmentsOverview>
  const accounts = Array.isArray(input.accounts)
    ? input.accounts
        .map((row) => {
          if (!row || typeof row !== 'object') return null
          const partial = row as Partial<InvestmentAccountRow>
          if (!partial.account || typeof partial.account !== 'object') return null
          const holdings = Array.isArray(partial.holdings)
            ? partial.holdings
                .map(normalizeInvestmentHolding)
                .filter((holding): holding is InvestmentHoldingRecord => holding !== null)
            : []
          return {
            account: partial.account,
            latestSnapshot: partial.latestSnapshot ?? null,
            holdings,
            valueCents: typeof partial.valueCents === 'number' ? partial.valueCents : 0
          } satisfies InvestmentAccountRow
        })
        .filter((row): row is InvestmentAccountRow => row !== null)
    : []

  return {
    accounts,
    totalCents: typeof input.totalCents === 'number' ? input.totalCents : 0,
    holdingsTotalCents:
      typeof input.holdingsTotalCents === 'number' ? input.holdingsTotalCents : 0,
    quotesStale: Boolean(input.quotesStale),
    performance: Array.isArray(input.performance) ? input.performance : [],
    allocation: Array.isArray(input.allocation) ? input.allocation : [],
    reconciliation: Array.isArray(input.reconciliation) ? input.reconciliation : [],
    dividends: Array.isArray(input.dividends) ? input.dividends : [],
    activities: Array.isArray(input.activities) ? input.activities : []
  }
}

export function holdingPriceCents(holding: Pick<
  InvestmentHoldingRecord,
  'manualPriceCents' | 'quotePriceCents'
>): number {
  return holding.quotePriceCents ?? holding.manualPriceCents ?? 0
}

export function computeHoldingMarketValueCents(
  quantity: number,
  priceCents: number
): number {
  return Math.round(quantity * priceCents)
}

export function currentPeriodKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function shiftPeriodKey(periodKey: string, deltaMonths: number): string {
  const [year, month] = periodKey.split('-').map(Number)
  const date = new Date(year, month - 1 + deltaMonths, 1)
  return currentPeriodKey(date)
}

export function periodMidpointIso(periodKey: string): string {
  const [year, month] = periodKey.split('-').map(Number)
  return new Date(year, month - 1, 15, 12, 0, 0, 0).toISOString()
}

export function formatPeriodLabel(periodKey: string): string {
  const [year, month] = periodKey.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date(year, month - 1, 1)
  )
}

export function formatMoneyDoorDetail(summary: MoneySummary): string {
  if (!summary.hasData) {
    return 'Position · flow · confidence'
  }

  const parts: string[] = [summary.headline]
  if (summary.paycheckTotalCents > 0) {
    parts.push(`${formatMoneyCents(summary.unassignedCents)} to assign`)
  }
  parts.push(`${formatMoneyCents(summary.monthFlowCents)} flow`)
  return parts.join(' · ')
}

export function computeLedgerNetCents(
  transactions: Pick<TransactionRecord, 'amountCents' | 'type'>[]
): number {
  // Transfers move money between your own accounts — not income or spending — so they
  // never count toward net flow (and would otherwise just be a wash anyway).
  return transactions
    .filter((txn) => txn.type !== 'transfer')
    .reduce((sum, txn) => sum + txn.amountCents, 0)
}

export function computeMonthFlowCents(paycheckTotalCents: number, ledgerNetCents: number): number {
  const paychecks = Number.isFinite(paycheckTotalCents) ? paycheckTotalCents : 0
  const ledger = Number.isFinite(ledgerNetCents) ? ledgerNetCents : 0
  return paychecks + ledger
}

export function formatMoneyCents(cents: number, currency = 'USD'): string {
  const safe = Number.isFinite(cents) ? cents : 0
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(safe / 100)
}

/** Plain-English action errors — strip Electron IPC wrapper text from UI. */
export function formatMoneyUserError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const ipcMatch = raw.match(/Error invoking remote method '[^']+':\s*(?:Error:\s*)?(.+)$/i)
  const message = (ipcMatch?.[1] ?? raw).replace(/^Error:\s*/i, '').trim()
  return message || 'Something went wrong — try again.'
}

export function parseMoneyInput(raw: string): number | null {
  const normalized = raw.replace(/[^0-9.-]/g, '')
  if (!normalized) return null
  const value = Number.parseFloat(normalized)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

/**
 * Register entry kinds for the manual-entry form. Transfer needs two accounts.
 * Data-driven so tests can assert Transfer/Adjust stay reachable behind the
 * Manual entry disclosure (LocalAI plan §2.5 — they are manual-only, never NL).
 */
export const MONEY_ENTRY_KINDS: Array<{
  value: TransactionType
  label: string
  needsTwoAccounts: boolean
}> = [
  { value: 'expense', label: 'Out', needsTwoAccounts: false },
  { value: 'income', label: 'In', needsTwoAccounts: false },
  { value: 'transfer', label: 'Transfer', needsTwoAccounts: true },
  { value: 'adjustment', label: 'Adjust', needsTwoAccounts: false }
]

export function availableEntryKinds(accountCount: number): typeof MONEY_ENTRY_KINDS {
  return MONEY_ENTRY_KINDS.filter((kind) => !kind.needsTwoAccounts || accountCount >= 2)
}

/** Local YYYY-MM-DD for a date — used for schedule next-occurrence dates. */
export function dateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Local YYYY-MM-DD → noon-local ISO (keeps a dated row inside the right period). */
export function dayKeyToIso(day: string): string {
  const [year, month, date] = day.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, date, 12, 0, 0, 0).toISOString()
}

/** ISO timestamp → local YYYY-MM-DD (inverse of dayKeyToIso for date inputs). */
export function isoToDayKey(iso: string): string {
  return dateKey(new Date(iso))
}

/** Advance a YYYY-MM-DD date by one cadence step, clamping month-end overflow. */
export function advanceScheduleDate(isoDate: string, cadence: ScheduleCadence): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  if (cadence === 'weekly' || cadence === 'biweekly') {
    const base = new Date(year, month - 1, day)
    base.setDate(base.getDate() + (cadence === 'weekly' ? 7 : 14))
    return dateKey(base)
  }
  // monthly — keep the day-of-month, clamp to the target month's last day
  const targetMonthIndex = month // 0-based next month
  const lastDay = new Date(year, targetMonthIndex + 1, 0).getDate()
  return dateKey(new Date(year, targetMonthIndex, Math.min(day, lastDay)))
}

/** Income adds to the pool/account; a bill is an outflow. */
export function scheduleSignedAmountCents(
  schedule: Pick<ScheduleRecord, 'kind' | 'amountCents'>
): number {
  return schedule.kind === 'income' ? schedule.amountCents : -schedule.amountCents
}

/** A schedule is due when its next occurrence is today or earlier. */
export function isScheduleDue(
  schedule: Pick<ScheduleRecord, 'nextDate'>,
  today = dateKey()
): boolean {
  return schedule.nextDate.slice(0, 10) <= today
}

export function cadenceLabel(cadence: ScheduleCadence): string {
  if (cadence === 'weekly') return 'Weekly'
  if (cadence === 'biweekly') return 'Every 2 weeks'
  return 'Monthly'
}

// —— Transaction type / status helpers ——

export function defaultTransactionType(amountCents: number): TransactionType {
  return amountCents >= 0 ? 'income' : 'expense'
}

export function transactionTypeLabel(type: TransactionType): string {
  switch (type) {
    case 'income':
      return 'Income'
    case 'transfer':
      return 'Transfer'
    case 'adjustment':
      return 'Adjustment'
    default:
      return 'Expense'
  }
}

export function transactionStatusLabel(status: TransactionStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'reconciled':
      return 'Reconciled'
    default:
      return 'Cleared'
  }
}

// —— Tags ——

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Stored as a JSON array string; tolerant of legacy comma-separated values. */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  let values: string[]
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      values = Array.isArray(parsed) ? parsed.map((value) => String(value)) : []
    } catch {
      values = []
    }
  } else {
    values = trimmed.split(',')
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const tag = normalizeTag(value)
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      out.push(tag)
    }
  }
  return out
}

export function serializeTags(tags: string[]): string {
  const seen = new Set<string>()
  const clean: string[] = []
  for (const tag of tags) {
    const norm = normalizeTag(tag)
    if (norm && !seen.has(norm)) {
      seen.add(norm)
      clean.push(norm)
    }
  }
  return clean.length > 0 ? JSON.stringify(clean) : ''
}

/** Split a free-typed tag string ("work, trip") into normalized tags. */
export function tagsFromInput(raw: string): string[] {
  return raw
    .split(',')
    .map(normalizeTag)
    .filter((tag, index, all) => tag !== '' && all.indexOf(tag) === index)
}

// —— Ledger search & filters (client-side over the loaded period) ——

export interface LedgerFilter {
  search: string
  type: TransactionType | 'all'
  status: TransactionStatus | 'all'
  /** 'all', 'none' (unfiled spending — expense with no envelope), or a category id. */
  categoryId: string
  tag: string | null
  minCents: number | null
  maxCents: number | null
  /** Inclusive YYYY-MM-DD bounds, or null. */
  from: string | null
  to: string | null
}

export const EMPTY_LEDGER_FILTER: LedgerFilter = {
  search: '',
  type: 'all',
  status: 'all',
  categoryId: 'all',
  tag: null,
  minCents: null,
  maxCents: null,
  from: null,
  to: null
}

export function isLedgerFilterActive(filter: LedgerFilter): boolean {
  return (
    filter.search.trim() !== '' ||
    filter.type !== 'all' ||
    filter.status !== 'all' ||
    filter.categoryId !== 'all' ||
    filter.tag !== null ||
    filter.minCents !== null ||
    filter.maxCents !== null ||
    filter.from !== null ||
    filter.to !== null
  )
}

function transactionTouchesCategory(txn: TransactionRecord, categoryId: string): boolean {
  if (categoryId === 'none') {
    // "Unfiled" = spending that should have an envelope but doesn't. Transfers and
    // income/refunds legitimately have no envelope, so they're not "unfiled" — this
    // matches the ledger's Unfiled chip and the cockpit "unfiled spending" warning.
    return txn.type === 'expense' && txn.categoryId === null && txn.splits.length === 0
  }
  if (txn.categoryId === categoryId) return true
  return txn.splits.some((line) => line.categoryId === categoryId)
}

export function filterTransactions(
  transactions: TransactionRecord[],
  filter: LedgerFilter
): TransactionRecord[] {
  const needle = filter.search.trim().toLowerCase()
  return transactions.filter((txn) => {
    if (filter.type !== 'all' && txn.type !== filter.type) return false
    if (filter.status !== 'all' && txn.status !== filter.status) return false
    if (filter.categoryId !== 'all' && !transactionTouchesCategory(txn, filter.categoryId)) {
      return false
    }
    if (filter.tag && !txn.tags.includes(filter.tag)) return false

    const magnitude = Math.abs(txn.amountCents)
    if (filter.minCents !== null && magnitude < filter.minCents) return false
    if (filter.maxCents !== null && magnitude > filter.maxCents) return false

    const day = txn.occurredAt.slice(0, 10)
    if (filter.from && day < filter.from) return false
    if (filter.to && day > filter.to) return false

    if (needle) {
      const haystack = [txn.payeeName ?? '', txn.memo, txn.notes, txn.tags.join(' ')]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })
}

/**
 * Paychecks shown in the register (QA2-08). Income lives ONLY in
 * budget_paychecks (A2's no-double-count invariant) — but the operator looks
 * for "my paycheck" in the ledger. These are display rows merged at read
 * time: never TransactionRecords, never part of net/balance math.
 */
export function filterPaychecksForRegister(
  paychecks: PaycheckRecord[],
  filter: LedgerFilter,
  selectedAccountId: string | null
): PaycheckRecord[] {
  const needle = filter.search.trim().toLowerCase()
  return paychecks.filter((paycheck) => {
    if (selectedAccountId && paycheck.accountId !== selectedAccountId) return false
    // Income direction; a received paycheck is settled money ("cleared").
    if (filter.type !== 'all' && filter.type !== 'income') return false
    if (filter.status !== 'all' && filter.status !== 'cleared') return false
    // Paychecks carry no envelope; 'none' means unfiled SPENDING — hide there.
    if (filter.categoryId !== 'all') return false
    if (filter.tag) return false

    const magnitude = Math.abs(paycheck.amountCents)
    if (filter.minCents !== null && magnitude < filter.minCents) return false
    if (filter.maxCents !== null && magnitude > filter.maxCents) return false

    const day = paycheck.receivedAt.slice(0, 10)
    if (filter.from && day < filter.from) return false
    if (filter.to && day > filter.to) return false

    if (needle && !paycheck.label.toLowerCase().includes(needle)) return false
    return true
  })
}

/**
 * Starter envelope set (QA2-10) — one-tap quick start for empty budgets, in
 * the setup wizard and the Budget tab. Bills don't count toward safe-to-spend.
 */
export const STARTER_ENVELOPES: Array<{ name: string; kind: 'bill' | 'everyday' }> = [
  { name: 'Rent', kind: 'bill' },
  { name: 'Groceries', kind: 'everyday' },
  { name: 'Gas', kind: 'everyday' },
  { name: 'Eating out', kind: 'everyday' },
  { name: 'Fun', kind: 'everyday' },
  { name: 'Phone', kind: 'bill' },
  { name: 'Subscriptions', kind: 'bill' },
  { name: 'Savings', kind: 'bill' }
]
