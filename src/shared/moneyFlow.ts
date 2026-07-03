import type {
  CategoryBudgetRow,
  MoneyBudgetOverview,
  PaycheckRecord,
  ScheduleRecord,
  TransactionRecord
} from './money'
import { formatEverydayEnvelopeNames, inferCountsTowardSafeToSpendFromName } from './moneyEnvelope'
import { advanceScheduleDate, dateKey, formatMoneyCents, scheduleSignedAmountCents } from './money'

export type MoneyFlowStatus = 'on_track' | 'tight' | 'over'

export interface DerivedMoneyReadout {
  cents: number
  /** Plain-language explanation — default path, no jargon. */
  why: string
  /** Technical terms for Advanced mode. */
  whyAdvanced?: string
}

/** Safe-to-spend split — unassigned pool + flexible envelope balances. */
export interface SafeToSpendBreakdown {
  /** max(0, unassigned) — money not yet in an envelope. */
  unassignedCents: number
  /** Remaining in non-bill, non-savings envelopes. */
  envelopeRemainingCents: number
}

export interface SafeToSpendReadout extends DerivedMoneyReadout, SafeToSpendBreakdown {}

export interface CreateExpectedPaycheckInput {
  label: string
  amountCents: number
  /** YYYY-MM-DD */
  expectedDate: string
}

export interface ExpectedPaycheckRecord {
  id: string
  label: string
  amountCents: number
  /** YYYY-MM-DD — user-placed expected pay date (shift cadence). */
  expectedDate: string
  createdAt: string
}

export interface MoneyTimelineEvent {
  id: string
  kind: 'paycheck' | 'expected_paycheck' | 'bill' | 'scheduled_income'
  label: string
  date: string
  amountCents: number
  why: string
}

export interface MoneyFlowSettings {
  /** Cushion parked this cycle for next month (cents). */
  holdBufferCents: number
  /** Plan income using the lowest historical paycheck, not an average. */
  useLowestPaycheckBaseline: boolean
}

export const DEFAULT_MONEY_FLOW_SETTINGS: MoneyFlowSettings = {
  holdBufferCents: 0,
  useLowestPaycheckBaseline: false
}

export const EMPTY_LEDGER_FLOW_SNAPSHOT: LedgerFlowSnapshot = {
  incomeCents: 0,
  expenseCents: 0,
  pendingCount: 0,
  uncategorizedExpenseCents: 0
}

export const EMPTY_VARIABLE_PAY: MoneyFlowGuidance['irregular']['variablePay'] = {
  detected: false,
  why: '',
  spreadCents: 0
}

/** Ledger rollups passed from V2e transaction tape — drift + pending awareness. */
export interface LedgerFlowSnapshot {
  incomeCents: number
  expenseCents: number
  pendingCount: number
  uncategorizedExpenseCents: number
}

export interface MoneyFlowDriftItem {
  label: string
  why: string
}

export interface MoneyFlowGuidanceInput {
  budget: MoneyBudgetOverview
  monthFlowCents: number
  ledgerNetCents: number
  ledger: LedgerFlowSnapshot
  schedules: ScheduleRecord[]
  expectedPaychecks: ExpectedPaycheckRecord[]
  settings: MoneyFlowSettings
  /** Linked savings-goal envelopes — excluded from discretionary spend. */
  savingsCategoryIds?: ReadonlySet<string>
  today?: string
}

export interface MoneyAffordabilityResult {
  amountCents: number
  affordable: boolean
  why: string
  whyAdvanced?: string
}

/** Housing glance — rent or mortgage envelope, or a matching recurring bill. */
export interface MoneyRentGlance extends DerivedMoneyReadout {
  /** False until a housing envelope or housing bill exists. */
  configured: boolean
  /** Envelope or bill name as the user wrote it (e.g. Rent, Mortgage). */
  label: string
  /** Short label for pills and inline readouts. */
  pillLabel: string
  /**
   * True only when the money is actually in the envelope (or this period's
   * housing is already paid). Unassigned money that COULD fund it is the
   * softer 'assign' state, never "covered".
   */
  covered: boolean
  /**
   * One owner for the housing story — 'covered' and 'at_risk' are mutually
   * exclusive with each other and with the overspend-risk list (the housing
   * envelope only appears there when this says 'at_risk').
   */
  state: 'unconfigured' | 'covered' | 'assign' | 'at_risk'
}

export interface MoneyFlowGuidance {
  periodKey: string
  safeToAssign: DerivedMoneyReadout
  safeToSpend: SafeToSpendReadout
  status: MoneyFlowStatus
  statusLabel: string
  statusWhy: string
  statusWhyAdvanced?: string
  restOfMonthForecast: DerivedMoneyReadout
  timeline: MoneyTimelineEvent[]
  /** ≤5s glance — housing (rent/mortgage envelope or bill). */
  rentGlance: MoneyRentGlance
  overspendRisk: {
    atRisk: boolean
    why: string
    envelopes: Array<{ categoryId: string; name: string; remainingCents: number; why: string }>
  }
  drift: {
    flagged: boolean
    why: string
    whyAdvanced?: string
    driftCents: number
    items: MoneyFlowDriftItem[]
  }
  irregular: {
    lowestPaycheckCents: number
    lowestPaycheckWhy: string
    holdBufferCents: number
    holdBufferWhy: string
    safeToSave: DerivedMoneyReadout
    expectedPaychecks: ExpectedPaycheckRecord[]
    variablePay: {
      detected: boolean
      why: string
      spreadCents: number
    }
  }
}

const RENT_NAME_PATTERN = /\b(rent|housing|lease|mortgage)\b/i

function isProtectedEnvelope(
  row: CategoryBudgetRow,
  savingsCategoryIds?: ReadonlySet<string>
): boolean {
  if (savingsCategoryIds?.has(row.category.id)) return true
  return !row.category.countsTowardSafeToSpend
}

function discretionarySpendParts(
  categories: CategoryBudgetRow[],
  unassignedCents: number,
  savingsCategoryIds?: ReadonlySet<string>
): SafeToSpendBreakdown & { totalCents: number } {
  const unassigned = Math.max(0, unassignedCents)
  const envelopeRemainingCents = categories.reduce((sum, row) => {
    if (isProtectedEnvelope(row, savingsCategoryIds)) return sum
    return sum + Math.max(0, row.remainingCents)
  }, 0)
  return {
    unassignedCents: unassigned,
    envelopeRemainingCents,
    totalCents: unassigned + envelopeRemainingCents
  }
}

function committedEnvelopeTotal(
  categories: CategoryBudgetRow[],
  savingsCategoryIds?: ReadonlySet<string>
): number {
  return categories.reduce((sum, row) => {
    if (!isProtectedEnvelope(row, savingsCategoryIds)) return sum
    return sum + Math.max(0, row.remainingCents)
  }, 0)
}

function periodEndDay(periodKey: string): string {
  const [year, month] = periodKey.split('-').map(Number)
  const last = new Date(year, month, 0).getDate()
  return `${periodKey}-${String(last).padStart(2, '0')}`
}

function daysInPeriod(periodKey: string): number {
  const [year, month] = periodKey.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

function dayOfMonth(today: string): number {
  return Number.parseInt(today.slice(8, 10), 10)
}

/** Expand a recurring schedule into dated occurrences through `throughDay` (inclusive). */
export function expandScheduleOccurrences(
  schedule: ScheduleRecord,
  throughDay: string,
  fromDay?: string
): Array<{ date: string; amountCents: number }> {
  const start = fromDay ?? schedule.nextDate.slice(0, 10)
  const out: Array<{ date: string; amountCents: number }> = []
  let cursor = schedule.nextDate.slice(0, 10)
  const signed = scheduleSignedAmountCents(schedule)

  // Walk forward from next_date until we pass throughDay (cap iterations).
  for (let i = 0; i < 64 && cursor <= throughDay; i += 1) {
    if (cursor >= start) {
      out.push({ date: cursor, amountCents: signed })
    }
    if (cursor >= throughDay) break
    cursor = advanceScheduleDate(cursor, schedule.cadence)
  }
  return out
}

function assignWhy(unassignedCents: number): { why: string; whyAdvanced: string } {
  if (unassignedCents < 0) {
    return {
      why: `${formatMoneyCents(Math.abs(unassignedCents))} over-assigned vs income received.`,
      whyAdvanced: `Ready-to-assign pool is negative (${formatMoneyCents(unassignedCents)}).`
    }
  }
  if (unassignedCents === 0) {
    return {
      why: 'All income has a job this month.',
      whyAdvanced: 'Unassigned pool is zero — every received dollar is assigned.'
    }
  }
  return {
    why: `${formatMoneyCents(unassignedCents)} still needs an envelope.`,
    whyAdvanced: `Ready-to-assign = cumulative paychecks − cumulative assignments (${formatMoneyCents(unassignedCents)}).`
  }
}

function flexibleEnvelopeNames(
  categories: CategoryBudgetRow[],
  savingsCategoryIds?: ReadonlySet<string>
): string[] {
  return categories
    .filter(
      (row) =>
        !isProtectedEnvelope(row, savingsCategoryIds) && Math.max(0, row.remainingCents) > 0
    )
    .map((row) => row.category.name)
}

function spendWhy(
  parts: SafeToSpendBreakdown & { totalCents: number },
  committedCents: number,
  everydayNames: readonly string[]
): { why: string; whyAdvanced: string } {
  const { unassignedCents, envelopeRemainingCents, totalCents } = parts
  const envelopeHint = formatEverydayEnvelopeNames(everydayNames)

  if (totalCents === 0 && committedCents > 0) {
    return {
      why: `${formatMoneyCents(committedCents)} is earmarked for bills — not free to spend elsewhere.`,
      whyAdvanced: `Discretionary = unassigned + everyday envelope balances; ${formatMoneyCents(committedCents)} sits in bill/savings envelopes.`
    }
  }
  if (totalCents === 0) {
    return {
      why: 'Nothing loose right now.',
      whyAdvanced: 'Discretionary spend pool is zero.'
    }
  }

  const totalLabel = formatMoneyCents(totalCents)
  const advanced = `Unassigned ${formatMoneyCents(unassignedCents)} + everyday envelope balances ${formatMoneyCents(envelopeRemainingCents)}; ${formatMoneyCents(committedCents)} in bill/savings envelopes.`

  if (unassignedCents > 0 && envelopeRemainingCents > 0) {
    return {
      why: `${formatMoneyCents(unassignedCents)} still needs a job + ${formatMoneyCents(envelopeRemainingCents)} unspent in ${envelopeHint} = ${totalLabel} you can spend right now.`,
      whyAdvanced: advanced
    }
  }
  if (unassignedCents > 0) {
    return {
      why: `${formatMoneyCents(unassignedCents)} still needs a job = ${totalLabel} you can spend right now.`,
      whyAdvanced: advanced
    }
  }
  return {
    why: `${formatMoneyCents(envelopeRemainingCents)} unspent in ${envelopeHint} = ${totalLabel} you can spend right now.`,
    whyAdvanced: advanced
  }
}

function findRentRow(categories: CategoryBudgetRow[]): CategoryBudgetRow | null {
  return categories.find((row) => RENT_NAME_PATTERN.test(row.category.name)) ?? null
}

function findUpcomingRentBill(
  schedules: ScheduleRecord[],
  timeline: MoneyTimelineEvent[],
  today: string
): MoneyTimelineEvent | null {
  const rentBill = schedules.find(
    (s) => s.kind === 'bill' && RENT_NAME_PATTERN.test(s.label)
  )
  if (rentBill) {
    const match = timeline.find(
      (e) => e.kind === 'bill' && e.label === rentBill.label && e.date >= today
    )
    if (match) return match
  }
  return timeline.find((e) => e.kind === 'bill' && RENT_NAME_PATTERN.test(e.label) && e.date >= today) ?? null
}

function lowestPaycheckAmount(
  paychecks: PaycheckRecord[],
  expected: ExpectedPaycheckRecord[],
  schedules: ScheduleRecord[]
): number {
  const amounts = [
    ...paychecks.map((p) => p.amountCents),
    ...expected.map((p) => p.amountCents),
    ...schedules.filter((s) => s.kind === 'income').map((s) => s.amountCents)
  ].filter((n) => n > 0)
  if (amounts.length === 0) return 0
  return Math.min(...amounts)
}

/** Roll up V2e ledger rows for flow drift and pending awareness. */
export function buildLedgerFlowSnapshot(
  transactions: Pick<
    TransactionRecord,
    'amountCents' | 'type' | 'status' | 'categoryId' | 'splits'
  >[]
): LedgerFlowSnapshot {
  let incomeCents = 0
  let expenseCents = 0
  let pendingCount = 0
  let uncategorizedExpenseCents = 0

  for (const txn of transactions) {
    if (txn.type === 'transfer') continue
    if (txn.status === 'pending') pendingCount += 1

    if (txn.type === 'income' && txn.amountCents > 0) {
      incomeCents += txn.amountCents
      continue
    }

    const spendLines =
      txn.splits.length > 0
        ? txn.splits.map((line) => ({ categoryId: line.categoryId, amountCents: line.amountCents }))
        : [{ categoryId: txn.categoryId, amountCents: txn.amountCents }]

    for (const line of spendLines) {
      if (line.amountCents >= 0) continue
      const abs = Math.abs(line.amountCents)
      expenseCents += abs
      if (!line.categoryId) uncategorizedExpenseCents += abs
    }
  }

  return { incomeCents, expenseCents, pendingCount, uncategorizedExpenseCents }
}

function detectVariablePay(
  paychecks: PaycheckRecord[],
  expectedPaychecks: ExpectedPaycheckRecord[]
): { detected: boolean; why: string; spreadCents: number } {
  const amounts = paychecks.map((p) => p.amountCents).filter((n) => n > 0)
  if (amounts.length >= 2) {
    const min = Math.min(...amounts)
    const max = Math.max(...amounts)
    const spread = max - min
    if (spread >= 5000 || (min > 0 && spread / min >= 0.15)) {
      return {
        detected: true,
        spreadCents: spread,
        why: `Paychecks range from ${formatMoneyCents(min)} to ${formatMoneyCents(max)} — add expected pay so Coming up stays honest.`
      }
    }
  }

  if (expectedPaychecks.length > 0) {
    return {
      detected: true,
      spreadCents: 0,
      why: 'You are tracking expected paychecks on the calendar.'
    }
  }

  return { detected: false, why: '', spreadCents: 0 }
}

/** Project discretionary envelope spend for remaining days at current pace. */
function computeProjectedSpendPace(
  categories: CategoryBudgetRow[],
  periodKey: string,
  today: string,
  savingsCategoryIds?: ReadonlySet<string>
): number {
  const totalDays = daysInPeriod(periodKey)
  const elapsed = Math.max(dayOfMonth(today), 1)
  const remainingDays = Math.max(totalDays - dayOfMonth(today), 0)
  if (remainingDays <= 0) return 0

  let projected = 0
  for (const row of categories) {
    if (row.assignedCents <= 0 || row.spentCents <= 0) continue
    if (isProtectedEnvelope(row, savingsCategoryIds)) continue
    if (isEnvelopeFulfilled(row)) continue
    const dailyRate = row.spentCents / elapsed
    // An envelope can only spend what it still holds — projecting a bill paid
    // in full on day 2 as a daily burn rate forecast thousands of phantom
    // dollars and flipped a healthy month to "Tight" (QA, 2026-07-02).
    projected += Math.min(dailyRate * remainingDays, Math.max(row.remainingCents, 0))
  }
  return Math.round(projected)
}

/**
 * An envelope that has done its job for the period — goal reached, or assigned
 * money spent exactly to the cent (a bill paid in full). These are complete,
 * not "burning fast", so pace-based warnings and projections skip them.
 */
function isEnvelopeFulfilled(row: CategoryBudgetRow): boolean {
  if (row.remainingCents < 0) return false
  const goalMet = row.targetCents != null && row.targetCents > 0 && row.spentCents >= row.targetCents
  const paidExactly = row.remainingCents === 0 && row.spentCents === row.assignedCents
  return goalMet || paidExactly
}

function buildTimeline(input: MoneyFlowGuidanceInput): MoneyTimelineEvent[] {
  const { budget, schedules, expectedPaychecks } = input
  const today = input.today ?? dateKey()
  const through = periodEndDay(budget.periodKey)
  const events: MoneyTimelineEvent[] = []

  for (const paycheck of budget.paychecks) {
    const day = paycheck.receivedAt.slice(0, 10)
    if (day >= `${budget.periodKey}-01` && day <= through) {
      events.push({
        id: `paycheck-${paycheck.id}`,
        kind: 'paycheck',
        label: paycheck.label,
        date: day,
        amountCents: paycheck.amountCents,
        why: `${formatMoneyCents(paycheck.amountCents)} already logged this month.`
      })
    }
  }

  for (const expected of expectedPaychecks) {
    const day = expected.expectedDate.slice(0, 10)
    if (day >= today && day <= through) {
      events.push({
        id: `expected-${expected.id}`,
        kind: 'expected_paycheck',
        label: expected.label,
        date: day,
        amountCents: expected.amountCents,
        why: `You placed this expected pay on the calendar — not received yet.`
      })
    }
  }

  for (const schedule of schedules) {
    const occurrences = expandScheduleOccurrences(schedule, through, today)
    for (const occ of occurrences) {
      if (occ.date < today) continue
      events.push({
        id: `schedule-${schedule.id}-${occ.date}`,
        kind: schedule.kind === 'income' ? 'scheduled_income' : 'bill',
        label: schedule.label,
        date: occ.date,
        amountCents: occ.amountCents,
        why:
          schedule.kind === 'income'
            ? `From your recurring income schedule.`
            : `From your recurring bill schedule.`
      })
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
}

function computeRemainingCashEvents(
  timeline: MoneyTimelineEvent[],
  today: string
): { incomeCents: number; billCents: number } {
  let incomeCents = 0
  let billCents = 0
  for (const event of timeline) {
    if (event.date < today) continue
    if (event.amountCents > 0) incomeCents += event.amountCents
    else billCents += Math.abs(event.amountCents)
  }
  return { incomeCents, billCents }
}

function computeStatus(
  unassignedCents: number,
  overspentCount: number,
  overspentTotalCents: number,
  forecastCents: number,
  rentGlance: Pick<MoneyRentGlance, 'configured' | 'state' | 'label' | 'why'>,
  overspendAtRisk: boolean
): { status: MoneyFlowStatus; label: string; why: string; whyAdvanced: string } {
  // Housing pushes the month red only on a GENUINE shortfall (envelope +
  // unassigned still can't make rent). The 'assign' state is a nudge, not Over.
  const housingOk = !rentGlance.configured || rentGlance.state !== 'at_risk'
  // A small overspend you can still cover from unassigned money is a nudge to move
  // money, not a red month — reserve "Over" for genuinely underwater states.
  const overspendCoverable =
    overspentCount === 0 || overspentTotalCents <= Math.max(0, unassignedCents)

  if (unassignedCents < 0 || forecastCents < 0 || !housingOk || !overspendCoverable) {
    return {
      status: 'over',
      label: 'Over',
      why: !overspendCoverable
        ? 'An envelope is overspent beyond your unassigned money.'
        : !housingOk && rentGlance.configured
          ? `${rentGlance.label} is not fully funded.`
          : unassignedCents < 0
            ? 'Assigned amounts exceed income received.'
            : 'Month-end looks short after upcoming bills.',
      whyAdvanced: !overspendCoverable
        ? 'Overspent envelope balance exceeds the ready-to-assign pool.'
        : !housingOk && rentGlance.configured
          ? 'Housing envelope or bill underfunded beyond ready-to-assign.'
          : unassignedCents < 0
            ? 'Ready-to-assign pool is negative.'
            : 'Rest-of-month forecast < 0.'
    }
  }

  // Tight = something the shown numbers back up: a visible overspent envelope,
  // or a forecast scraping zero. Pacing risk alone never flips the month —
  // the forecast already carries projected spend, and a hot envelope next to
  // thousands ready-to-assign is a nudge to move money, not a tight month.
  if (overspentCount > 0 || (forecastCents > 0 && forecastCents < 10000)) {
    return {
      status: 'tight',
      label: 'Tight',
      why:
        overspentCount > 0
          ? 'An envelope is overspent — cover it from another envelope or unassigned.'
          : 'Month-end forecast is under $100.',
      whyAdvanced:
        overspentCount > 0
          ? 'Envelope balance negative but coverable from ready-to-assign.'
          : 'Forecast end position under $100.'
    }
  }

  if (forecastCents === 0 && !overspendAtRisk) {
    return {
      status: 'on_track',
      label: 'On track',
      why: '',
      whyAdvanced: 'Forecast end position is exactly zero — bills covered, no extra cushion.'
    }
  }

  return {
    status: 'on_track',
    label: 'On track',
    why:
      rentGlance.state === 'assign'
        ? rentGlance.why
        : overspendAtRisk
          ? 'An envelope is pacing hot — coverable from unassigned if it keeps up.'
          : unassignedCents === 0
            ? 'Income is assigned and bills look covered.'
            : '',
    whyAdvanced:
      overspendAtRisk || rentGlance.state === 'assign'
        ? 'Pressure signals present but coverable from ready-to-assign; forecast non-negative.'
        : 'No overspend, housing covered, forecast non-negative.'
  }
}

function computeDrift(
  budget: MoneyBudgetOverview,
  expectedPaychecks: ExpectedPaycheckRecord[],
  ledger: LedgerFlowSnapshot,
  today: string
): MoneyFlowGuidance['drift'] {
  const items: MoneyFlowDriftItem[] = []
  let driftCents = 0

  const pastExpected = expectedPaychecks.filter((p) => p.expectedDate.slice(0, 10) < today)
  const expectedTotal = pastExpected.reduce((s, p) => s + p.amountCents, 0)
  const receivedTotal = budget.paychecks.reduce((s, p) => s + p.amountCents, 0)

  if (pastExpected.length > 0 && expectedTotal > receivedTotal) {
    const gap = expectedTotal - receivedTotal
    driftCents = Math.max(driftCents, gap)
    items.push({
      label: 'Expected pay',
      why: `${formatMoneyCents(gap)} less received than you placed on the calendar.`
    })
  }

  // Budget paychecks and ledger income are intentionally separate ledgers — refunds and
  // side income live in the ledger and legitimately differ from budgeted pay, so we do not
  // flag a paycheck-vs-ledger-income mismatch (it fired on every normal refund).

  if (ledger.uncategorizedExpenseCents > 0) {
    items.push({
      label: 'Unfiled spending',
      why: `${formatMoneyCents(ledger.uncategorizedExpenseCents)} in the ledger has no envelope — file it so spend totals stay honest.`
    })
  }

  if (ledger.pendingCount > 0) {
    items.push({
      label: 'Pending',
      why: `${ledger.pendingCount} ledger ${ledger.pendingCount === 1 ? 'entry' : 'entries'} still pending — balances may shift when cleared.`
    })
  }

  const flagged = items.length > 0
  const why = flagged
    ? items[0].why
    : 'Budget and ledger agree on income so far.'
  const whyAdvanced = flagged
    ? items.map((item) => `${item.label}: ${item.why}`).join(' ')
    : 'No meaningful divergence between expected calendar, paychecks, and ledger.'

  return { flagged, why, whyAdvanced, driftCents, items }
}

function computeOverspendRisk(
  categories: CategoryBudgetRow[],
  periodKey: string,
  today: string
): MoneyFlowGuidance['overspendRisk'] {
  const totalDays = daysInPeriod(periodKey)
  const elapsed = dayOfMonth(today)
  const monthFraction = elapsed / totalDays
  const envelopes: MoneyFlowGuidance['overspendRisk']['envelopes'] = []

  for (const row of categories) {
    if (row.remainingCents < 0) {
      envelopes.push({
        categoryId: row.category.id,
        name: row.category.name,
        remainingCents: row.remainingCents,
        why: `${formatMoneyCents(Math.abs(row.remainingCents))} over — cover or stop spending here.`
      })
      continue
    }
    if (row.assignedCents <= 0) continue
    if (isEnvelopeFulfilled(row)) continue
    const burnRate = row.spentCents / row.assignedCents
    if (monthFraction < 0.55 && burnRate > 0.85) {
      envelopes.push({
        categoryId: row.category.id,
        name: row.category.name,
        remainingCents: row.remainingCents,
        why: `Burning fast — ${Math.round(burnRate * 100)}% used with most of the month left.`
      })
    }
  }

  const names = envelopes.map((e) => e.name)
  const nameSummary =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names[0]}, ${names[1]}, +${names.length - 2} more`

  return {
    atRisk: envelopes.length > 0,
    why:
      envelopes.length > 0
        ? `${nameSummary} ${envelopes.length === 1 ? 'needs' : 'need'} attention before month-end.`
        : 'No envelopes look at risk right now.',
    envelopes
  }
}

function computeRentGlance(
  budget: MoneyBudgetOverview,
  schedules: ScheduleRecord[],
  timeline: MoneyTimelineEvent[],
  forecastCents: number,
  safeToAssignCents: number,
  today: string
): MoneyRentGlance {
  const rentRow = findRentRow(budget.categories)
  const rentBill = findUpcomingRentBill(schedules, timeline, today)

  if (!rentRow && !rentBill) {
    return {
      cents: 0,
      configured: false,
      label: '',
      pillLabel: 'Configure rent/mortgage',
      covered: false,
      state: 'unconfigured',
      why: 'Add a Rent or Mortgage envelope to track housing.',
      whyAdvanced: 'No housing envelope or recurring bill matched.'
    }
  }

  const label = rentRow?.category.name ?? rentBill!.label

  if (rentRow) {
    const need = rentBill ? Math.abs(rentBill.amountCents) : rentRow.targetCents ?? rentRow.assignedCents
    // This period's rent is handled once it's already paid (spent up to its target) — don't
    // raise "at risk" for next period's not-yet-funded rent the moment this month's is paid.
    const rentTarget = rentRow.targetCents ?? rentRow.assignedCents
    const paidThisPeriod = rentTarget > 0 && rentRow.spentCents >= rentTarget
    // "Covered" = the money is IN the envelope (or the bill is already paid and
    // the envelope isn't overdrawn). Unassigned money never counts here.
    const covered =
      (paidThisPeriod && rentRow.remainingCents >= 0) ||
      (rentRow.remainingCents >= 0 && (need <= 0 || rentRow.remainingCents >= need))

    if (covered) {
      return {
        cents: rentRow.remainingCents,
        configured: true,
        label,
        pillLabel: `${label} covered`,
        covered: true,
        state: 'covered',
        why: paidThisPeriod
          ? `${label} paid this month.`
          : rentBill
            ? `${label} covered — due ${formatTimelineShort(rentBill.date)}.`
            : `${label} covered this month.`,
        whyAdvanced: `${label} envelope balance ${formatMoneyCents(rentRow.remainingCents)}.`
      }
    }

    // Cents still owed to make the envelope whole: the rest of the bill, or —
    // when the bill itself is paid — the envelope's overdraft.
    const gap = paidThisPeriod ? Math.abs(rentRow.remainingCents) : need - rentRow.remainingCents
    if (gap <= Math.max(0, safeToAssignCents)) {
      return {
        cents: rentRow.remainingCents,
        configured: true,
        label,
        pillLabel: `Assign to ${label}`,
        covered: false,
        state: 'assign',
        why: paidThisPeriod
          ? `${label} is paid, but its envelope is ${formatMoneyCents(gap)} over — cover it from unassigned.`
          : `${formatMoneyCents(gap)} unassigned can cover ${label} — assign it.`,
        whyAdvanced: `${label} envelope ${formatMoneyCents(rentRow.remainingCents)} vs need ${formatMoneyCents(need)}; ready-to-assign ${formatMoneyCents(safeToAssignCents)}.`
      }
    }

    const shortfall = Math.max(gap - Math.max(0, safeToAssignCents), 0)
    return {
      cents: rentRow.remainingCents,
      configured: true,
      label,
      pillLabel: `${label} at risk`,
      covered: false,
      state: 'at_risk',
      why: `${label} short ${formatMoneyCents(shortfall || Math.abs(rentRow.remainingCents))}.`,
      whyAdvanced: `${label} envelope ${formatMoneyCents(rentRow.remainingCents)} vs need ${formatMoneyCents(need)}.`
    }
  }

  const need = Math.abs(rentBill!.amountCents)
  const covered = forecastCents >= need
  return {
    cents: forecastCents,
    configured: true,
    label,
    pillLabel: covered ? `${label} covered` : `${label} at risk`,
    covered,
    state: covered ? 'covered' : 'at_risk',
    why: covered
      ? `${label} covered — projected cash covers the bill.`
      : `${label} may be short ${formatMoneyCents(need - forecastCents)}.`,
    whyAdvanced: `Forecast ${formatMoneyCents(forecastCents)} vs ${label} ${formatMoneyCents(need)}.`
  }
}

function formatTimelineShort(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(year, month - 1, date)
  )
}

export function computeMoneyFlowGuidance(input: MoneyFlowGuidanceInput): MoneyFlowGuidance {
  const { budget, monthFlowCents, settings } = input
  const savingsCategoryIds = input.savingsCategoryIds
  const ledger = input.ledger ?? EMPTY_LEDGER_FLOW_SNAPSHOT
  const today = input.today ?? dateKey()
  const timeline = buildTimeline(input)
  const { incomeCents: remainingIncome, billCents: remainingBills } = computeRemainingCashEvents(
    timeline,
    today
  )
  const projectedSpend = computeProjectedSpendPace(
    budget.categories,
    budget.periodKey,
    today,
    savingsCategoryIds
  )

  const safeToAssignCents = budget.unassignedCents
  const committedCents = committedEnvelopeTotal(budget.categories, savingsCategoryIds)
  const spendParts = discretionarySpendParts(
    budget.categories,
    safeToAssignCents,
    savingsCategoryIds
  )
  const everydayNames = flexibleEnvelopeNames(budget.categories, savingsCategoryIds)
  const assignCopy = assignWhy(safeToAssignCents)
  const spendCopy = spendWhy(spendParts, committedCents, everydayNames)

  let forecastCents = monthFlowCents + remainingIncome - remainingBills - projectedSpend
  if (settings.useLowestPaycheckBaseline && remainingIncome > 0) {
    const floor = lowestPaycheckAmount(budget.paychecks, input.expectedPaychecks, input.schedules)
    if (floor > 0) {
      forecastCents = monthFlowCents + floor - remainingBills - projectedSpend
    }
  }
  forecastCents -= settings.holdBufferCents

  const rentGlance = computeRentGlance(
    budget,
    input.schedules,
    timeline,
    forecastCents,
    safeToAssignCents,
    today
  )
  // The rent glance owns the housing story: the housing envelope only appears
  // in the overspend-risk list when the glance itself says at_risk, so
  // "covered" and "at risk" can never be shown for the same envelope.
  const housingCategoryId =
    rentGlance.configured && rentGlance.state !== 'at_risk'
      ? findRentRow(budget.categories)?.category.id ?? null
      : null
  const overspendRisk = computeOverspendRisk(
    budget.categories.filter((row) => row.category.id !== housingCategoryId),
    budget.periodKey,
    today
  )

  const overspentTotalCents = budget.overspent.reduce(
    (sum, row) => sum + Math.abs(row.remainingCents),
    0
  )
  const statusPack = computeStatus(
    safeToAssignCents,
    budget.overspent.length,
    overspentTotalCents,
    forecastCents + settings.holdBufferCents,
    rentGlance,
    overspendRisk.atRisk
  )

  const receivedOnly = budget.paychecks.reduce((s, p) => s + p.amountCents, 0)
  const safeToSaveCents = Math.max(
    0,
    receivedOnly - budget.assignedTotalCents - settings.holdBufferCents
  )

  const lowest = lowestPaycheckAmount(
    budget.paychecks,
    input.expectedPaychecks,
    input.schedules
  )

  const variablePayBase = detectVariablePay(budget.paychecks, input.expectedPaychecks)
  const variablePay =
    variablePayBase.detected || settings.holdBufferCents > 0 || settings.useLowestPaycheckBaseline
      ? {
          detected: true as const,
          spreadCents: variablePayBase.spreadCents,
          why:
            variablePayBase.why ||
            (settings.holdBufferCents > 0
              ? 'You set money aside for next month — expected pay keeps the timeline honest.'
              : 'Planning with your smallest paycheck — add expected pay when shifts change.')
        }
      : variablePayBase

  const result: MoneyFlowGuidance = {
    periodKey: budget.periodKey,
    safeToAssign: {
      cents: safeToAssignCents,
      why: assignCopy.why,
      whyAdvanced: assignCopy.whyAdvanced
    },
    safeToSpend: {
      cents: spendParts.totalCents,
      unassignedCents: spendParts.unassignedCents,
      envelopeRemainingCents: spendParts.envelopeRemainingCents,
      why: spendCopy.why,
      whyAdvanced: spendCopy.whyAdvanced
    },
    status: statusPack.status,
    statusLabel: statusPack.label,
    statusWhy: statusPack.why,
    statusWhyAdvanced: statusPack.whyAdvanced,
    restOfMonthForecast: {
      cents: forecastCents,
      why:
        forecastCents >= 0
          ? `After upcoming pay, bills, and spend pace, about ${formatMoneyCents(forecastCents)} left at month-end.`
          : `About ${formatMoneyCents(Math.abs(forecastCents))} short after upcoming pay, bills, and spend pace.`,
      whyAdvanced: `Month flow ${formatMoneyCents(monthFlowCents)} + scheduled income ${formatMoneyCents(remainingIncome)} − bills ${formatMoneyCents(remainingBills)} − spend pace ${formatMoneyCents(projectedSpend)} − hold buffer ${formatMoneyCents(settings.holdBufferCents)}.`
    },
    timeline,
    rentGlance,
    overspendRisk,
    drift: computeDrift(budget, input.expectedPaychecks, ledger, today),
    irregular: {
      lowestPaycheckCents: lowest,
      lowestPaycheckWhy:
        lowest > 0
          ? `Your smallest pay is ${formatMoneyCents(lowest)} — plan against that, not an average.`
          : 'Log a few paychecks to see your conservative floor.',
      holdBufferCents: settings.holdBufferCents,
      holdBufferWhy:
        settings.holdBufferCents > 0
          ? `${formatMoneyCents(settings.holdBufferCents)} held back for next month.`
          : 'No hold-back set — add one to smooth uneven pay.',
      safeToSave: {
        cents: safeToSaveCents,
        why:
          safeToSaveCents > 0
            ? `${formatMoneyCents(safeToSaveCents)} from money already received — not from expected pay.`
            : 'Nothing safe to save yet — received pay is fully assigned or held.',
        whyAdvanced: `Received paychecks ${formatMoneyCents(receivedOnly)} − assigned ${formatMoneyCents(budget.assignedTotalCents)} − hold ${formatMoneyCents(settings.holdBufferCents)}.`
      },
      expectedPaychecks: input.expectedPaychecks,
      variablePay
    }
  }

  return normalizeMoneyFlowGuidance(result)!
}

export function checkAffordability(
  guidance: MoneyFlowGuidance,
  amountCents: number
): MoneyAffordabilityResult {
  if (amountCents <= 0) {
    return {
      amountCents: 0,
      affordable: false,
      why: 'Enter an amount to check.'
    }
  }

  const headroom = guidance.safeToSpend.cents
  const affordable = amountCents <= headroom && guidance.status !== 'over'

  return {
    amountCents,
    affordable,
    why: affordable
      ? `Yes — ${formatMoneyCents(headroom)} is loose for non-bill spending.`
      : headroom <= 0
        ? 'Not really — the rest is tied up in bills and envelopes.'
        : `Only about ${formatMoneyCents(headroom)} is loose right now.`,
    whyAdvanced: affordable
      ? `Amount ≤ min(safe-to-spend, safe-to-assign + safe-to-spend); status ${guidance.statusLabel}.`
      : `Requested ${formatMoneyCents(amountCents)} > headroom ${formatMoneyCents(headroom)} or status Over.`
  }
}

/** Secondary month-position figures — demoted below the safe-to-spend hero (V2.75a). */
export interface MoneyCockpitSecondaryMetrics {
  monthFlowCents: number
  ledgerNetCents: number
  spentTotalCents: number
  retentionPct: number | null
  assignedPct: number
}

/** Shared door + cockpit copy — one relationship line, no competing hero figures. */
export interface MoneyCockpitPresentation {
  relationshipLine: string
  metrics: MoneyCockpitSecondaryMetrics
  /** Compact summary for the closed details trigger. */
  detailsSummary: string
}

function formatPeriodMonthName(periodKey: string): string {
  const [year, month] = periodKey.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(year, month - 1, 1))
}

function spentTotalCents(categories: CategoryBudgetRow[]): number {
  return categories.reduce((sum, row) => sum + row.spentCents, 0)
}

function retentionPctFromFlow(monthFlowCents: number, incomeCents: number): number | null {
  if (incomeCents <= 0) return null
  return Math.round(Math.max(0, Math.min(100, (monthFlowCents / incomeCents) * 100)))
}

function buildRelationshipLine(
  budget: MoneyBudgetOverview,
  monthFlowCents: number,
  guidance: MoneyFlowGuidance | null
): string {
  const income = budget.paycheckTotalCents
  const assignCents = guidance?.safeToAssign.cents ?? budget.unassignedCents
  const clauses: string[] = []

  if (assignCents > 0) {
    clauses.push(`${formatMoneyCents(assignCents)} still needs a job`)
  } else if (assignCents < 0) {
    clauses.push((guidance?.safeToAssign.why ?? assignWhy(assignCents).why).replace(/\.$/, ''))
  } else if (income > 0) {
    clauses.push('Every dollar has a job this month')
  }

  const retention = retentionPctFromFlow(monthFlowCents, income)
  if (retention !== null) {
    clauses.push(
      `you've kept ${retention}% of ${formatPeriodMonthName(budget.periodKey)}'s income so far`
    )
  }

  if (clauses.length === 0) {
    return 'Add a paycheck to see how this month is tracking.'
  }

  return `${clauses.join('; ')}.`
}

function buildDetailsSummary(metrics: MoneyCockpitSecondaryMetrics): string {
  const parts = [
    `Month flow ${formatMoneyCents(metrics.monthFlowCents)}`,
    `Spent ${formatMoneyCents(metrics.spentTotalCents)}`
  ]
  if (metrics.retentionPct !== null) {
    parts.push(`${metrics.retentionPct}% retained`)
  }
  return parts.join(' · ')
}

/** Door + cockpit readouts — reuse guidance; do not recompute in UI components. */
export function buildMoneyCockpitPresentation(input: {
  budget: MoneyBudgetOverview
  monthFlowCents: number
  ledgerNetCents: number
  guidance: MoneyFlowGuidance | null
}): MoneyCockpitPresentation {
  const { budget, monthFlowCents, ledgerNetCents, guidance } = input
  const income = Math.max(budget.paycheckTotalCents, 1)
  const assignedPct = Math.round(Math.min(100, (budget.assignedTotalCents / income) * 100))
  const metrics: MoneyCockpitSecondaryMetrics = {
    monthFlowCents,
    ledgerNetCents,
    spentTotalCents: spentTotalCents(budget.categories),
    retentionPct: retentionPctFromFlow(monthFlowCents, budget.paycheckTotalCents),
    assignedPct
  }

  return {
    relationshipLine: buildRelationshipLine(budget, monthFlowCents, guidance),
    metrics,
    detailsSummary: buildDetailsSummary(metrics)
  }
}

/** Minimum unspent in everyday envelopes before the month-wrap card appears. */
export const MONTH_WRAP_MIN_LEFTOVER_CENTS = 2500

export const MONTH_WRAP_DISMISS_PREFIX = 'moss.money.monthWrapDismissed.'

export interface MonthWrapUpReadout {
  /** Unspent in discretionary (`countsTowardSafeToSpend`) envelopes only — not unassigned pool. */
  discretionaryLeftoverCents: number
  /** Default one-tap sweep amount (all discretionary leftover). */
  suggestedSweepCents: number
  /** True when leftover is meaningful and the period is near month-end. */
  eligible: boolean
  why: string
}

export interface MonthWrapUpInput {
  budget: MoneyBudgetOverview
  savingsCategoryIds?: ReadonlySet<string>
  /** Card only surfaces on the live month — not when browsing history. */
  isCurrentPeriod?: boolean
  today?: string
}

function discretionaryEnvelopeLeftoverCents(
  categories: CategoryBudgetRow[],
  savingsCategoryIds?: ReadonlySet<string>
): number {
  return categories.reduce((sum, row) => {
    if (isProtectedEnvelope(row, savingsCategoryIds)) return sum
    return sum + Math.max(0, row.remainingCents)
  }, 0)
}

function isNearPeriodEnd(periodKey: string, today: string): boolean {
  const totalDays = daysInPeriod(periodKey)
  const day = dayOfMonth(today)
  const threshold = Math.max(Math.ceil(totalDays * 0.75), totalDays - 4)
  return day >= threshold
}

/** Month-end sweep nudge — discretionary envelope leftover + near-period-end gate (V2.75d). */
export function computeMonthWrapUp(input: MonthWrapUpInput): MonthWrapUpReadout {
  const today = input.today ?? dateKey()
  const { budget, savingsCategoryIds, isCurrentPeriod = true } = input
  const discretionaryLeftoverCents = discretionaryEnvelopeLeftoverCents(
    budget.categories,
    savingsCategoryIds
  )
  const suggestedSweepCents = discretionaryLeftoverCents
  const meaningful = discretionaryLeftoverCents >= MONTH_WRAP_MIN_LEFTOVER_CENTS
  const nearEnd = isNearPeriodEnd(budget.periodKey, today)
  const eligible = isCurrentPeriod && meaningful && nearEnd

  let why = ''
  if (!isCurrentPeriod) {
    why = 'Month wrap-up is for the current month only.'
  } else if (!meaningful) {
    why = 'Not enough unspent in spending envelopes yet.'
  } else if (!nearEnd) {
    why = 'Shows near month-end when everyday envelopes still have money left.'
  } else {
    why = `${formatMoneyCents(discretionaryLeftoverCents)} unspent in spending envelopes.`
  }

  return { discretionaryLeftoverCents, suggestedSweepCents, eligible, why }
}

export function monthWrapDismissStorageKey(periodKey: string): string {
  return `${MONTH_WRAP_DISMISS_PREFIX}${periodKey}`
}

export function flowStatusClass(status: MoneyFlowStatus): string {
  if (status === 'over') return 'money-flow-status--over'
  if (status === 'tight') return 'money-flow-status--tight'
  return 'money-flow-status--on-track'
}

export function rentGlancePillClass(rent: MoneyRentGlance): string {
  if (!rent.configured) return 'money-flow-rent-pill--unset'
  if (rent.state === 'assign') return 'money-flow-rent-pill--assign'
  return rent.covered ? 'money-flow-rent-pill--ok' : 'money-flow-rent-pill--warn'
}

export function rentGlanceInlineClass(rent: MoneyRentGlance): string {
  if (!rent.configured) return 'money-flow-rent-inline--unset'
  if (rent.state === 'assign') return 'money-flow-rent-inline--assign'
  return rent.covered ? 'money-flow-rent-inline--ok' : 'money-flow-rent-inline--warn'
}

/** Fill V2c fields missing from older guidance payloads (HMR / stale IPC). */
export function normalizeMoneyFlowGuidance(
  guidance: MoneyFlowGuidance | null | undefined
): MoneyFlowGuidance | null {
  if (!guidance) return null

  const irregular = guidance.irregular ?? {
    lowestPaycheckCents: 0,
    lowestPaycheckWhy: '',
    holdBufferCents: 0,
    holdBufferWhy: '',
    safeToSave: { cents: 0, why: '' },
    expectedPaychecks: [],
    variablePay: EMPTY_VARIABLE_PAY
  }

  const rent = guidance.rentGlance
  const rentConfigured =
    rent?.configured ??
    (Boolean(rent?.label) ||
      (rent?.covered === true && !String(rent?.why ?? '').includes('Add a Rent')))

  return {
    ...guidance,
    rentGlance: {
      cents: rent?.cents ?? 0,
      configured: rentConfigured,
      label: rent?.label ?? '',
      pillLabel:
        rent?.pillLabel ??
        (rentConfigured
          ? rent?.covered
            ? `${rent?.label || 'Housing'} covered`
            : `${rent?.label || 'Housing'} at risk`
          : 'Configure rent/mortgage'),
      covered: rent?.covered ?? false,
      // Older payloads predate the state field — they only knew covered/warn.
      state:
        rent?.state ??
        (rentConfigured ? (rent?.covered ? 'covered' : 'at_risk') : 'unconfigured'),
      why: rent?.why ?? '',
      whyAdvanced: rent?.whyAdvanced
    },
    overspendRisk: {
      ...guidance.overspendRisk,
      envelopes: guidance.overspendRisk?.envelopes ?? []
    },
    drift: {
      ...guidance.drift,
      items: guidance.drift?.items ?? [],
      driftCents: guidance.drift?.driftCents ?? 0,
      flagged: guidance.drift?.flagged ?? false,
      why: guidance.drift?.why ?? ''
    },
    irregular: {
      ...irregular,
      expectedPaychecks: irregular.expectedPaychecks ?? [],
      variablePay: irregular.variablePay ?? EMPTY_VARIABLE_PAY,
      safeToSave: irregular.safeToSave ?? { cents: 0, why: '' }
    }
  }
}
