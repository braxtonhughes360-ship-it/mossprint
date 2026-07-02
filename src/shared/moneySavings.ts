import type { PaycheckRecord, ScheduleCadence, ScheduleRecord } from './money'
import { advanceScheduleDate, cadenceLabel, dateKey, formatMoneyCents } from './money'

export type SavingsGoalKind = 'emergency' | 'cushion' | 'purchase' | 'project' | 'custom'

export type SavingsProgressMode = 'save-up' | 'project'

export interface SavingsGoalRecord {
  id: string
  name: string
  targetCents: number
  /** YYYY-MM-DD finish line, or null when open-ended. */
  targetDate: string | null
  categoryId: string
  kind: SavingsGoalKind
  /** Milestone amounts in cents, ascending. */
  milestonesCents: number[]
  /** Carry unused allocation forward with envelope rollover. */
  rolloverEnabled: boolean
  createdAt: string
}

export interface SavingsContributionRecord {
  id: string
  goalId: string
  amountCents: number
  occurredAt: string
  memo: string
  createdAt: string
}

export interface SavingsContributionGuidance {
  /** Monthly amount to stay on schedule for the target date. */
  neededPerMonthCents: number
  monthsRemaining: number
  /** True when this period's assignment meets the monthly target. */
  onTrackThisPeriod: boolean
  /** Amount still needed this month (0 when on track). */
  remainingThisMonthCents: number
  /** Quick-assign chip amount — capped by ready-to-assign pool (0 when pool empty). */
  suggestedAssignCents: number
  /** Monthly target still needed this period — shown on chip even when pool is empty. */
  targetAssignCents: number
  /** Max safe to move now — from received-only pool, never survival envelopes. */
  safeNowCents: number
  canContribute: boolean
  /** Monthly pace — one short line. */
  paceLine: string
  /** Pool / blocker — separate from pace so cards stay readable. */
  poolLine: string
  /** Shown when action needed this month (legacy; prefer paceLine + poolLine). */
  why: string
  /** Shown when on track this month. */
  onTrackWhy: string
}

export interface SavingsGoalActivityRow {
  id: string
  occurredAt: string
  /** Payee name or memo. */
  label: string
  amountCents: number
}

export interface SavingsGoalRow {
  goal: SavingsGoalRecord
  progressMode: SavingsProgressMode
  /** Cash still in the goal envelope right now. */
  balanceCents: number
  /** Assigned to this goal this budget period. */
  assignedThisPeriodCents: number
  /** Ledger outflows from this envelope this period. */
  transferredOutCents: number
  /** Period-scoped spend on this envelope (alias of transferredOutCents). */
  spentThisPeriodCents: number
  /** Cumulative ledger spend on this envelope (all periods). */
  spentTotalCents: number
  /** Cumulative assigned to this envelope (all periods). */
  fundedTotalCents: number
  /** @deprecated use balanceCents — kept for callers that read savedCents */
  savedCents: number
  progress: number
  remainingCents: number
  milestonesReached: number[]
  guidance: SavingsContributionGuidance
  /** Plain-English when assigned ≠ balance — guidance only, not card face. */
  balanceNote: string | null
  /** Last five expense rows on this envelope, newest first. */
  recentActivity: SavingsGoalActivityRow[]
}

export interface SavingsOverview {
  periodKey: string
  goals: SavingsGoalRow[]
  totalSavedCents: number
  totalTargetCents: number
  safeToSaveCents: number
  unassignedCents: number
  hasGoals: boolean
}

export function emptySavingsOverview(periodKey: string): SavingsOverview {
  return {
    periodKey,
    goals: [],
    totalSavedCents: 0,
    totalTargetCents: 0,
    safeToSaveCents: 0,
    unassignedCents: 0,
    hasGoals: false
  }
}

export interface SavingsGoalTemplate {
  kind: SavingsGoalKind
  name: string
  defaultTargetCents: number
  copy: string
}

export const SAVINGS_GOAL_TEMPLATES: SavingsGoalTemplate[] = [
  {
    kind: 'emergency',
    name: 'Emergency fund',
    defaultTargetCents: 100_000,
    copy: 'A cushion for surprises — car repair, medical bill, or a slow month.'
  },
  {
    kind: 'cushion',
    name: 'Cushion',
    defaultTargetCents: 50_000,
    copy: 'Breathing room between paychecks so one tight week does not scramble the bills.'
  },
  {
    kind: 'purchase',
    name: 'Planned purchase',
    defaultTargetCents: 30_000,
    copy: 'Save toward something specific — laptop, trip, or a big ticket item.'
  },
  {
    kind: 'project',
    name: 'Project',
    defaultTargetCents: 100_000,
    copy: 'A budget you spend over time — renovation, wedding, or any big project with lots of purchases.'
  }
]

export interface CreateSavingsGoalInput {
  name: string
  targetCents: number
  targetDate?: string | null
  kind?: SavingsGoalKind
  milestonesCents?: number[]
  rolloverEnabled?: boolean
}

export interface ContributeToSavingsGoalInput {
  goalId: string
  periodKey: string
  amountCents: number
  memo?: string
}

/** Default milestone markers at 25 / 50 / 75 / 100 %. */
export function defaultMilestonesCents(targetCents: number): number[] {
  if (targetCents <= 0) return []
  return [0.25, 0.5, 0.75, 1].map((ratio) => Math.round(targetCents * ratio))
}

export function computeSavingsProgress(savedCents: number, targetCents: number): number {
  if (targetCents <= 0) return savedCents > 0 ? 1 : 0
  return Math.min(1, Math.max(0, savedCents / targetCents))
}

export function savingsProgressMode(kind: SavingsGoalKind): SavingsProgressMode {
  return kind === 'project' ? 'project' : 'save-up'
}

export function computeProjectProgress(spentTotalCents: number, targetCents: number): number {
  return computeSavingsProgress(spentTotalCents, targetCents)
}

export function buildSavingsPeriodLine(
  mode: SavingsProgressMode,
  spentThisPeriodCents: number
): string | null {
  if (spentThisPeriodCents <= 0) return null
  const amount = formatMoneyCents(spentThisPeriodCents)
  if (mode === 'project') {
    return `${amount} spent on this project this month — see below`
  }
  return `${amount} used from this fund this month — see below`
}

export function savingsGoalHeadlineHint(mode: SavingsProgressMode): string {
  return mode === 'project' ? 'left for this project' : 'in envelope'
}

export function buildProjectFundingLine(
  fundedTotalCents: number,
  targetCents: number
): string | null {
  const stillToFund = Math.max(0, targetCents - fundedTotalCents)
  if (fundedTotalCents <= 0 && stillToFund <= 0) return null
  return `${formatMoneyCents(fundedTotalCents)} set aside · ${formatMoneyCents(stillToFund)} still to fund`
}

export function milestonesReached(savedCents: number, milestones: number[]): number[] {
  return milestones.filter((amount) => savedCents >= amount)
}

function daysBetween(fromDay: string, toDay: string): number {
  const a = new Date(fromDay.slice(0, 10) + 'T12:00:00')
  const b = new Date(toDay.slice(0, 10) + 'T12:00:00')
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000))
}

function cadenceDays(cadence: ScheduleCadence): number {
  if (cadence === 'weekly') return 7
  if (cadence === 'biweekly') return 14
  return 30
}

/** Infer pay cadence from income schedules, else recent paycheck spacing, else monthly. */
export function detectPayCadence(
  schedules: ScheduleRecord[],
  paychecks: PaycheckRecord[]
): ScheduleCadence {
  const incomeSchedule = schedules.find((s) => s.kind === 'income')
  if (incomeSchedule) return incomeSchedule.cadence

  const sorted = [...paychecks].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  if (sorted.length >= 2) {
    const gap = daysBetween(sorted[sorted.length - 2].receivedAt, sorted[sorted.length - 1].receivedAt)
    if (gap <= 10) return 'weekly'
    if (gap <= 18) return 'biweekly'
  }
  return 'monthly'
}

export function paysUntilDate(fromDay: string, targetDay: string, cadence: ScheduleCadence): number {
  const days = daysBetween(fromDay, targetDay)
  if (days <= 0) return 1
  return Math.max(1, Math.ceil(days / cadenceDays(cadence)))
}

/** Count income occurrences between today and the goal date when a schedule exists. */
export function countPaysUntilTarget(
  today: string,
  targetDate: string,
  cadence: ScheduleCadence,
  schedules: ScheduleRecord[]
): number {
  const incomeSchedule = schedules.find((schedule) => schedule.kind === 'income')
  if (incomeSchedule) {
    let count = 0
    let cursor = incomeSchedule.nextDate.slice(0, 10)
    for (let i = 0; i < 64 && cursor <= targetDate; i += 1) {
      if (cursor >= today) count += 1
      if (cursor >= targetDate) break
      cursor = advanceScheduleDate(cursor, incomeSchedule.cadence)
    }
    return Math.max(1, count)
  }
  return paysUntilDate(today, targetDate, cadence)
}

/** Calendar months from today until the target date (minimum 1). */
export function monthsUntilTarget(today: string, targetDate: string): number {
  const start = new Date(today.slice(0, 10) + 'T12:00:00')
  const end = new Date(targetDate.slice(0, 10) + 'T12:00:00')
  if (end <= start) return 1
  let count = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (end.getDate() >= start.getDate()) count += 1
  return Math.max(1, count)
}

export interface SavingsFundingHint {
  name: string
  amountCents: number
  kind: 'bill_shortfall' | 'overspent'
}

export interface ContributionGuidanceInput {
  savedCents: number
  targetCents: number
  targetDate: string | null
  /** Assigned to this goal in the current budget period only. */
  assignedThisPeriodCents: number
  /** Period-scoped headroom (informational — not the assign pool). */
  safeToSaveCents: number
  /** Ready-to-assign pool (cumulative income − cumulative assignments). */
  unassignedCents: number
  /** Envelopes that could use unassigned money before savings — for specific copy. */
  fundingHints?: SavingsFundingHint[]
  today?: string
  /** When assigned ≠ balance (money left the envelope). */
  balanceNote?: string | null
}

/** Monthly pacing — on-track when this period's assignment meets the monthly target. */
export function computeContributionGuidance(input: ContributionGuidanceInput): SavingsContributionGuidance {
  const today = input.today ?? dateKey()
  const remaining = Math.max(0, input.targetCents - input.savedCents)
  /** Money in the ready-to-assign pool — savings moves from here, not from bill envelopes. */
  const assignableCents = Math.max(0, input.unassignedCents)
  const safeNowCents = assignableCents
  const billHints = (input.fundingHints ?? []).filter((h) => h.kind === 'bill_shortfall')
  const overspentHints = (input.fundingHints ?? []).filter((h) => h.kind === 'overspent')

  if (remaining <= 0) {
    return {
      neededPerMonthCents: 0,
      monthsRemaining: 0,
      onTrackThisPeriod: true,
      remainingThisMonthCents: 0,
      suggestedAssignCents: 0,
      targetAssignCents: 0,
      safeNowCents,
      canContribute: assignableCents > 0,
      paceLine: '',
      poolLine: '',
      why: '',
      onTrackWhy: 'Goal reached — nice work.'
    }
  }

  let neededPerMonth = 0
  let monthsRemaining = 0

  if (input.targetDate && input.targetDate >= today) {
    monthsRemaining = monthsUntilTarget(today, input.targetDate)
    neededPerMonth = Math.ceil(remaining / monthsRemaining)
  } else {
    monthsRemaining = 4
    neededPerMonth = Math.ceil(remaining / monthsRemaining)
  }

  /** Pace credit = assignment still held in the envelope (not money that already left). */
  const paceCreditCents = Math.max(0, Math.min(input.assignedThisPeriodCents, input.savedCents))
  const remainingThisMonthCents = Math.max(0, neededPerMonth - paceCreditCents)
  const onTrackThisPeriod = remainingThisMonthCents <= 0

  if (onTrackThisPeriod) {
    const onTrackWhy =
      input.balanceNote ??
      (input.targetDate && input.targetDate >= today
        ? `${formatMoneyCents(input.assignedThisPeriodCents)} assigned this month — on pace for ${formatTargetDate(input.targetDate)}.`
        : `${formatMoneyCents(input.assignedThisPeriodCents)} assigned this month — on pace.`)
    return {
      neededPerMonthCents: neededPerMonth,
      monthsRemaining,
      onTrackThisPeriod: true,
      remainingThisMonthCents: 0,
      suggestedAssignCents: 0,
      targetAssignCents: 0,
      safeNowCents,
      canContribute: assignableCents > 0,
      paceLine: '',
      poolLine: assignableCents > 0 ? `${formatMoneyCents(assignableCents)} ready to assign elsewhere` : '',
      why: '',
      onTrackWhy
    }
  }

  const paceLine =
    input.targetDate && input.targetDate >= today
      ? `${formatMoneyCents(neededPerMonth)} per month to finish by ${formatTargetDate(input.targetDate)}`
      : `About ${formatMoneyCents(neededPerMonth)} per month keeps momentum`

  const firstBill = billHints[0]
  const firstOver = overspentHints[0]

  if (assignableCents <= 0) {
    let poolLine = 'Nothing free to assign — wait for your next paycheck.'
    if (firstBill) {
      poolLine = `${firstBill.name} still needs ${formatMoneyCents(firstBill.amountCents)} this month first.`
    } else if (firstOver) {
      poolLine = `${firstOver.name} is ${formatMoneyCents(firstOver.amountCents)} over — cover that before assigning here.`
    }
    return {
      neededPerMonthCents: neededPerMonth,
      monthsRemaining,
      onTrackThisPeriod: false,
      remainingThisMonthCents,
      suggestedAssignCents: 0,
      targetAssignCents: remainingThisMonthCents,
      safeNowCents: 0,
      canContribute: false,
      paceLine,
      poolLine,
      why: `${paceLine}. ${poolLine}`,
      onTrackWhy: ''
    }
  }

  const suggestedAssignCents = Math.min(remainingThisMonthCents, assignableCents)
  let poolLine = `${formatMoneyCents(assignableCents)} ready to assign`

  if (firstBill) {
    poolLine = `${firstBill.name} still needs ${formatMoneyCents(firstBill.amountCents)} — or assign ${formatMoneyCents(suggestedAssignCents)} from ${formatMoneyCents(assignableCents)} ready`
  } else if (firstOver) {
    poolLine = `${firstOver.name} is ${formatMoneyCents(firstOver.amountCents)} over — ${formatMoneyCents(suggestedAssignCents)} available from ${formatMoneyCents(assignableCents)} ready`
  }

  const why = `${paceLine} — ${formatMoneyCents(remainingThisMonthCents)} still needed this month. ${poolLine}`

  return {
    neededPerMonthCents: neededPerMonth,
    monthsRemaining,
    onTrackThisPeriod: false,
    remainingThisMonthCents,
    suggestedAssignCents,
    targetAssignCents: remainingThisMonthCents,
    safeNowCents,
    canContribute: true,
    paceLine,
    poolLine,
    why,
    onTrackWhy: ''
  }
}

export function formatTargetDate(day: string): string {
  const [year, month, date] = day.slice(0, 10).split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(year, month - 1, date)
  )
}

export function savingsKindLabel(kind: SavingsGoalKind): string {
  switch (kind) {
    case 'emergency':
      return 'Emergency fund'
    case 'cushion':
      return 'Cushion'
    case 'purchase':
      return 'Planned purchase'
    case 'project':
      return 'Project'
    default:
      return 'Savings goal'
  }
}

/** One-tap assign chip — shows what will actually move, not the full monthly pace gap. */
export function savingsAssignChipLabel(guidance: SavingsContributionGuidance): string {
  const moveCents =
    guidance.suggestedAssignCents > 0
      ? guidance.suggestedAssignCents
      : guidance.targetAssignCents
  if (
    guidance.suggestedAssignCents > 0 &&
    guidance.targetAssignCents > guidance.suggestedAssignCents
  ) {
    return `Assign ${formatMoneyCents(moveCents)} now`
  }
  return `Assign ${formatMoneyCents(moveCents)} this month`
}

/** Max assignable from the ready-to-assign pool for a savings goal action. */
export function savingsMaxAssignableCents(unassignedCents: number): number {
  return Math.max(0, unassignedCents)
}

/** Plain-English when the user tries to assign more than the pool holds. */
export function savingsOverAssignMessage(
  unassignedCents: number,
  envelopeSweepCents: number
): string {
  const ready = formatMoneyCents(unassignedCents)
  if (envelopeSweepCents > 0) {
    return `Only ${ready} is ready to assign right now. Use Month wrap-up above to move up to ${formatMoneyCents(envelopeSweepCents)} from spending envelopes, or enter ${ready} or less.`
  }
  return `Only ${ready} is ready to assign right now — enter that amount or less.`
}

/** Explain why assigned this month ≠ what's still in the envelope. */
export function buildSavingsBalanceNote(input: {
  balanceCents: number
  assignedThisPeriodCents: number
  transferredOutCents: number
}): string | null {
  const { balanceCents, assignedThisPeriodCents, transferredOutCents } = input
  if (assignedThisPeriodCents <= 0 && transferredOutCents <= 0) return null
  if (transferredOutCents <= 0 && assignedThisPeriodCents === balanceCents) return null

  const parts: string[] = []
  if (assignedThisPeriodCents > 0) {
    parts.push(`${formatMoneyCents(assignedThisPeriodCents)} assigned this month`)
  }
  if (transferredOutCents > 0) {
    parts.push(`${formatMoneyCents(transferredOutCents)} logged out of this envelope`)
  }
  parts.push(`${formatMoneyCents(balanceCents)} still in this envelope`)
  return parts.join(' · ')
}
