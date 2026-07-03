import type { TransactionType } from './money'
import { currentPeriodKey, formatMoneyCents, formatPeriodLabel, shiftPeriodKey } from './money'

export type ReportRangePreset =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'year_to_date'
  | 'custom'

export type ReportViewMode = 'table' | 'chart'

export interface ReportFilters {
  rangePreset: ReportRangePreset
  /** Inclusive YYYY-MM-DD for custom range. */
  from: string | null
  to: string | null
  accountId: string | null
  categoryId: string | null
  groupId: string | null
  payeeId: string | null
  tag: string | null
  type: TransactionType | 'all'
  minCents: number | null
  maxCents: number | null
}

export const EMPTY_REPORT_FILTERS: ReportFilters = {
  rangePreset: 'this_month',
  from: null,
  to: null,
  accountId: null,
  categoryId: null,
  groupId: null,
  payeeId: null,
  tag: null,
  type: 'all',
  minCents: null,
  maxCents: null
}

export interface ReportPresetRecord {
  id: string
  name: string
  filters: ReportFilters
  viewMode: ReportViewMode
  createdAt: string
}

export interface CreateReportPresetInput {
  name: string
  filters: ReportFilters
  viewMode?: ReportViewMode
}

export interface ReportPeriodPoint {
  periodKey: string
  label: string
  incomeCents: number
  assignedCents: number
  spentCents: number
  netFlowCents: number
}

export interface ReportEnvelopeWeekPoint {
  label: string
  spentCents: number
  assignedCents: number
}

export interface ReportEnvelopeProgress {
  categoryId: string
  categoryName: string
  groupId: string | null
  groupName: string | null
  assignedCents: number
  spentCents: number
  remainingCents: number
  weeklySeries: ReportEnvelopeWeekPoint[]
  /** Plain-language pace summary — deterministic, non-AI. */
  why: string
}

export interface ReportCategorySpend {
  categoryId: string
  categoryName: string
  groupId: string | null
  groupName: string | null
  spentCents: number
}

export interface ReportPeriodTotals {
  incomeCents: number
  spentCents: number
  netFlowCents: number
  assignedCents: number
}

export interface ReportComparison {
  currentPeriodKey: string
  priorPeriodKey: string
  current: ReportPeriodTotals
  prior: ReportPeriodTotals
  deltaIncomeCents: number
  deltaSpentCents: number
  deltaNetFlowCents: number
  /** Plain-language summary — deterministic, non-AI. */
  why: string
}

export interface ReportNetWorthPoint {
  periodKey: string
  label: string
  cashCents: number
  investmentCents: number
  totalCents: number
  /** True when investment history is estimated from current quotes. */
  estimated: boolean
}

export interface ReportSavingsGlance {
  goalId: string
  name: string
  savedCents: number
  targetCents: number
  progress: number
  onTrack: boolean
  why: string
}

export interface ReportTransactionSummary {
  count: number
  incomeCents: number
  expenseCents: number
  netCents: number
}

export interface MoneyReportsOverview {
  filters: ReportFilters
  rangeLabel: string
  fromDay: string
  toDay: string
  periodKeys: string[]
  comparison: ReportComparison
  spendingByCategory: ReportCategorySpend[]
  envelopeProgress: ReportEnvelopeProgress[]
  cashFlowSeries: ReportPeriodPoint[]
  netWorthSeries: ReportNetWorthPoint[]
  savingsGlance: ReportSavingsGlance[]
  transactionSummary: ReportTransactionSummary
  hasData: boolean
  emptyWhy: string
}

export interface ResolvedReportRange {
  rangeLabel: string
  fromDay: string
  toDay: string
  fromIso: string
  toIso: string
  periodKeys: string[]
  comparisonCurrentKey: string
  comparisonPriorKey: string
}

function periodEndIso(periodKey: string): string {
  const [year, month] = periodKey.split('-').map(Number)
  return new Date(year, month, 0, 23, 59, 59, 999).toISOString()
}

function periodStartDay(periodKey: string): string {
  return `${periodKey}-01`
}

function periodEndDay(periodKey: string): string {
  const [year, month] = periodKey.split('-').map(Number)
  const day = new Date(year, month, 0).getDate()
  return `${periodKey}-${String(day).padStart(2, '0')}`
}

function periodKeysBetween(fromKey: string, toKey: string): string[] {
  const keys: string[] = []
  let cursor = fromKey
  for (let guard = 0; guard < 120 && cursor <= toKey; guard += 1) {
    keys.push(cursor)
    if (cursor === toKey) break
    cursor = shiftPeriodKey(cursor, 1)
  }
  return keys
}

/** Resolve preset/custom filters into concrete bounds and period keys. */
export function resolveReportRange(
  filters: ReportFilters,
  anchorPeriodKey = currentPeriodKey()
): ResolvedReportRange {
  let fromKey = anchorPeriodKey
  let toKey = anchorPeriodKey
  let rangeLabel = formatPeriodLabel(anchorPeriodKey)

  switch (filters.rangePreset) {
    case 'last_month': {
      const prior = shiftPeriodKey(anchorPeriodKey, -1)
      fromKey = prior
      toKey = prior
      rangeLabel = formatPeriodLabel(prior)
      break
    }
    case 'last_3_months': {
      fromKey = shiftPeriodKey(anchorPeriodKey, -2)
      toKey = anchorPeriodKey
      rangeLabel = `${formatPeriodLabel(fromKey)} – ${formatPeriodLabel(toKey)}`
      break
    }
    case 'last_6_months': {
      fromKey = shiftPeriodKey(anchorPeriodKey, -5)
      toKey = anchorPeriodKey
      rangeLabel = `${formatPeriodLabel(fromKey)} – ${formatPeriodLabel(toKey)}`
      break
    }
    case 'year_to_date': {
      fromKey = `${anchorPeriodKey.slice(0, 4)}-01`
      toKey = anchorPeriodKey
      rangeLabel = `Jan – ${formatPeriodLabel(toKey)}`
      break
    }
    case 'custom': {
      if (filters.from && filters.to) {
        const fromDay = filters.from.slice(0, 10)
        const toDay = filters.to.slice(0, 10)
        fromKey = fromDay.slice(0, 7)
        toKey = toDay.slice(0, 7)
        rangeLabel =
          fromDay === toDay
            ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(
                new Date(fromDay + 'T12:00:00')
              )
            : `${fromDay} – ${toDay}`
      }
      break
    }
    default:
      break
  }

  const fromDay =
    filters.rangePreset === 'custom' && filters.from
      ? filters.from.slice(0, 10)
      : periodStartDay(fromKey)
  const toDay =
    filters.rangePreset === 'custom' && filters.to
      ? filters.to.slice(0, 10)
      : periodEndDay(toKey)

  const fromIso = new Date(fromDay + 'T00:00:00').toISOString()
  const toIso = new Date(toDay + 'T23:59:59.999').toISOString()
  const periodKeys = periodKeysBetween(fromKey, toKey)
  const comparisonCurrentKey = toKey
  const comparisonPriorKey = shiftPeriodKey(comparisonCurrentKey, -1)

  return {
    rangeLabel,
    fromDay,
    toDay,
    fromIso,
    toIso,
    periodKeys,
    comparisonCurrentKey,
    comparisonPriorKey
  }
}

export function buildComparisonWhy(
  current: ReportPeriodTotals,
  prior: ReportPeriodTotals,
  currentLabel: string,
  priorLabel: string
): string {
  const parts: string[] = []
  const spentDelta = current.spentCents - prior.spentCents
  const incomeDelta = current.incomeCents - prior.incomeCents

  if (prior.spentCents === 0 && prior.incomeCents === 0) {
    return `${currentLabel} is your first month with activity in this view.`
  }

  if (spentDelta > 0) {
    parts.push(
      `Spending is ${formatMoneyCents(spentDelta)} higher than ${priorLabel} (${formatMoneyCents(current.spentCents)} vs ${formatMoneyCents(prior.spentCents)}).`
    )
  } else if (spentDelta < 0) {
    parts.push(
      `Spending is ${formatMoneyCents(Math.abs(spentDelta))} lower than ${priorLabel}.`
    )
  } else {
    parts.push(`Spending matches ${priorLabel}.`)
  }

  if (incomeDelta !== 0) {
    parts.push(
      incomeDelta > 0
        ? `Income up ${formatMoneyCents(incomeDelta)} vs ${priorLabel}.`
        : `Income down ${formatMoneyCents(Math.abs(incomeDelta))} vs ${priorLabel}.`
    )
  }

  return parts.join(' ')
}

export function buildEnvelopeProgressWhy(
  assignedCents: number,
  spentCents: number,
  weeklySeries: ReportEnvelopeWeekPoint[]
): string {
  if (assignedCents <= 0 && spentCents > 0) {
    return `Spent ${formatMoneyCents(spentCents)} with no assignment this month.`
  }
  if (assignedCents <= 0) return 'No assignment this month.'

  if (spentCents > assignedCents) {
    return `${formatMoneyCents(spentCents - assignedCents)} over the ${formatMoneyCents(assignedCents)} assigned.`
  }

  const pct = assignedCents > 0 ? Math.round((spentCents / assignedCents) * 100) : 0
  const lastLabel = weeklySeries.length > 0 ? weeklySeries[weeklySeries.length - 1].label : 'month end'
  if (spentCents === 0) {
    return `${formatMoneyCents(assignedCents)} assigned · nothing spent yet.`
  }
  return `${pct}% of assignment used through ${lastLabel} (${formatMoneyCents(spentCents)} of ${formatMoneyCents(assignedCents)}).`
}

export function normalizeReportFilters(raw: unknown): ReportFilters {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_REPORT_FILTERS }
  const input = raw as Partial<ReportFilters>
  const preset = input.rangePreset ?? 'this_month'
  const allowed: ReportRangePreset[] = [
    'this_month',
    'last_month',
    'last_3_months',
    'last_6_months',
    'year_to_date',
    'custom'
  ]
  return {
    rangePreset: allowed.includes(preset as ReportRangePreset)
      ? (preset as ReportRangePreset)
      : 'this_month',
    from: typeof input.from === 'string' ? input.from.slice(0, 10) : null,
    to: typeof input.to === 'string' ? input.to.slice(0, 10) : null,
    accountId: typeof input.accountId === 'string' ? input.accountId : null,
    categoryId: typeof input.categoryId === 'string' ? input.categoryId : null,
    groupId: typeof input.groupId === 'string' ? input.groupId : null,
    payeeId: typeof input.payeeId === 'string' ? input.payeeId : null,
    tag: typeof input.tag === 'string' && input.tag.trim() ? input.tag.trim() : null,
    type:
      input.type === 'income' ||
      input.type === 'expense' ||
      input.type === 'transfer' ||
      input.type === 'adjustment'
        ? input.type
        : 'all',
    minCents: typeof input.minCents === 'number' ? input.minCents : null,
    maxCents: typeof input.maxCents === 'number' ? input.maxCents : null
  }
}

const EMPTY_COMPARISON: ReportComparison = {
  currentPeriodKey: currentPeriodKey(),
  priorPeriodKey: shiftPeriodKey(currentPeriodKey(), -1),
  current: { incomeCents: 0, spentCents: 0, netFlowCents: 0, assignedCents: 0 },
  prior: { incomeCents: 0, spentCents: 0, netFlowCents: 0, assignedCents: 0 },
  deltaIncomeCents: 0,
  deltaSpentCents: 0,
  deltaNetFlowCents: 0,
  why: ''
}

const EMPTY_TXN_SUMMARY: ReportTransactionSummary = {
  count: 0,
  incomeCents: 0,
  expenseCents: 0,
  netCents: 0
}

/** Coerce IPC payloads — partial objects must not crash the renderer. */
export function normalizeMoneyReportsOverview(
  raw: unknown,
  periodKey = currentPeriodKey()
): MoneyReportsOverview {
  if (!raw || typeof raw !== 'object') {
    return {
      filters: { ...EMPTY_REPORT_FILTERS },
      rangeLabel: formatPeriodLabel(periodKey),
      fromDay: periodStartDay(periodKey),
      toDay: periodEndDay(periodKey),
      periodKeys: [periodKey],
      comparison: EMPTY_COMPARISON,
      spendingByCategory: [],
      envelopeProgress: [],
      cashFlowSeries: [],
      netWorthSeries: [],
      savingsGlance: [],
      transactionSummary: EMPTY_TXN_SUMMARY,
      hasData: false,
      emptyWhy: 'Add paychecks, ledger entries, or savings goals to see reports here.'
    }
  }

  const input = raw as Partial<MoneyReportsOverview>
  return {
    filters: normalizeReportFilters(input.filters),
    rangeLabel: typeof input.rangeLabel === 'string' ? input.rangeLabel : formatPeriodLabel(periodKey),
    fromDay: typeof input.fromDay === 'string' ? input.fromDay : periodStartDay(periodKey),
    toDay: typeof input.toDay === 'string' ? input.toDay : periodEndDay(periodKey),
    periodKeys: Array.isArray(input.periodKeys) ? input.periodKeys : [periodKey],
    comparison: input.comparison ?? EMPTY_COMPARISON,
    spendingByCategory: Array.isArray(input.spendingByCategory) ? input.spendingByCategory : [],
    envelopeProgress: Array.isArray(input.envelopeProgress) ? input.envelopeProgress : [],
    cashFlowSeries: Array.isArray(input.cashFlowSeries) ? input.cashFlowSeries : [],
    netWorthSeries: Array.isArray(input.netWorthSeries) ? input.netWorthSeries : [],
    savingsGlance: Array.isArray(input.savingsGlance) ? input.savingsGlance : [],
    transactionSummary: input.transactionSummary ?? EMPTY_TXN_SUMMARY,
    hasData: Boolean(input.hasData),
    emptyWhy:
      typeof input.emptyWhy === 'string'
        ? input.emptyWhy
        : 'Add paychecks, ledger entries, or savings goals to see reports here.'
  }
}

/** Hue steps for group/category bands — matches allocation strip on the money door. */
export const MONEY_FLOW_GROUP_HUES = [32, 58, 92, 128, 168, 200, 235, 280, 310, 345]

export interface MoneyFlowCategoryNode {
  id: string
  name: string
  groupId: string | null
  groupName: string
  spentCents: number
  shareOfSpent: number
  hue: number
  /** True for the rolled-up "N smaller" band on the right column. */
  isOther?: boolean
}

export interface MoneyFlowGroupNode {
  id: string
  name: string
  spentCents: number
  shareOfSpent: number
  shareOfIncome: number
  hue: number
  topCategories: MoneyFlowCategoryNode[]
}

/** Precomputed group → right-column band routing for the ribbon geometry. */
export interface MoneyFlowLink {
  groupId: string
  /** Category id, or OTHER_FLOW_ID for the rolled-up band. */
  targetId: string
  cents: number
  hue: number
}

export const OTHER_FLOW_ID = '__other__'
/** Right-column label/band budget — beyond this, the smallest roll into "Other". */
export const MAX_FLOW_CATEGORIES = 8

export interface MoneyFlowViewData {
  incomeCents: number
  spentCents: number
  keptCents: number
  groups: MoneyFlowGroupNode[]
  /** Right-column bands: top categories, capped with a rolled-up "Other" band. */
  categories: MoneyFlowCategoryNode[]
  /** Group → category (or Other) flows, summing to each group's spend. */
  links: MoneyFlowLink[]
  /** True when ≤1 group or ≤1 category — copy should set expectations. */
  sparse: boolean
  /** Plain-language summary for screen readers + caption. */
  summary: string
}

const UNCATEGORIZED_GROUP = 'Other'

function groupKey(row: ReportCategorySpend): string {
  return row.groupId ?? '__none__'
}

function groupLabel(row: ReportCategorySpend): string {
  return row.groupName?.trim() || UNCATEGORIZED_GROUP
}

/** Aggregate reports overview rows into Income → groups → top categories for the flow viz. */
export function buildMoneyFlowViewData(
  incomeCents: number,
  spendingByCategory: ReportCategorySpend[],
  maxCategoriesPerGroup = 3
): MoneyFlowViewData | null {
  const spentCents = spendingByCategory.reduce((sum, row) => sum + row.spentCents, 0)
  if (spentCents <= 0) return null

  const byGroup = new Map<
    string,
    { id: string | null; name: string; rows: ReportCategorySpend[]; spentCents: number }
  >()

  for (const row of spendingByCategory) {
    const key = groupKey(row)
    const existing = byGroup.get(key)
    if (existing) {
      existing.rows.push(row)
      existing.spentCents += row.spentCents
    } else {
      byGroup.set(key, {
        id: row.groupId,
        name: groupLabel(row),
        rows: [row],
        spentCents: row.spentCents
      })
    }
  }

  const incomeBase = Math.max(incomeCents, spentCents)
  const keptCents = Math.max(0, incomeCents - spentCents)

  // Stable id per group so links + layout agree (null group → "Other" bucket).
  const groupNodes = Array.from(byGroup.values())
    .sort((a, b) => b.spentCents - a.spentCents)
    .map((group, groupIndex) => {
      const id = group.id ?? `group-${groupIndex}`
      const hue = MONEY_FLOW_GROUP_HUES[groupIndex % MONEY_FLOW_GROUP_HUES.length]
      const rowsBySpend = [...group.rows].sort((a, b) => b.spentCents - a.spentCents)
      return { ...group, id, hue, rowsBySpend }
    })

  const groups: MoneyFlowGroupNode[] = groupNodes.map((group) => ({
    id: group.id,
    name: group.name,
    spentCents: group.spentCents,
    shareOfSpent: group.spentCents / spentCents,
    shareOfIncome: group.spentCents / incomeBase,
    hue: group.hue,
    topCategories: group.rowsBySpend.slice(0, maxCategoriesPerGroup).map((row) => ({
      id: row.categoryId,
      name: row.categoryName,
      groupId: row.groupId,
      groupName: group.name,
      spentCents: row.spentCents,
      shareOfSpent: row.spentCents / spentCents,
      hue: group.hue
    }))
  }))

  // Right column: pick which categories get their own band by overall spend
  // (biggest envelopes win), but ORDER them grouped by their parent group so
  // ribbons run straight instead of crossing. The leftovers roll into one
  // "N smaller" band so the column never crams or overflows.
  const flatByGroup: MoneyFlowCategoryNode[] = groupNodes.flatMap((group) =>
    group.rowsBySpend.map((row) => ({
      id: row.categoryId,
      name: row.categoryName,
      groupId: group.id,
      groupName: group.name,
      spentCents: row.spentCents,
      shareOfSpent: row.spentCents / spentCents,
      hue: group.hue
    }))
  )

  const overflow = flatByGroup.length > MAX_FLOW_CATEGORIES
  const shownIds = new Set<string>(
    (overflow
      ? [...flatByGroup].sort((a, b) => b.spentCents - a.spentCents).slice(0, MAX_FLOW_CATEGORIES - 1)
      : flatByGroup
    ).map((c) => c.id)
  )

  const categories: MoneyFlowCategoryNode[] = flatByGroup.filter((c) => shownIds.has(c.id))
  if (overflow) {
    const rest = flatByGroup.filter((c) => !shownIds.has(c.id))
    const otherCents = rest.reduce((sum, c) => sum + c.spentCents, 0)
    categories.push({
      id: OTHER_FLOW_ID,
      name: `${rest.length} smaller`,
      groupId: null,
      groupName: '',
      spentCents: otherCents,
      shareOfSpent: otherCents / spentCents,
      hue: 0,
      isOther: true
    })
  }

  // Group → band links: a shown category resolves to its own band; the rest
  // route into the shared "Other" band. Sums to each group's spend.
  const links: MoneyFlowLink[] = []
  for (const group of groupNodes) {
    for (const row of group.rowsBySpend) {
      links.push({
        groupId: group.id,
        targetId: shownIds.has(row.categoryId) ? row.categoryId : OTHER_FLOW_ID,
        cents: row.spentCents,
        hue: group.hue
      })
    }
  }

  const sparse = groups.length <= 1 && flatByGroup.length <= 1

  const groupParts = groups
    .slice(0, 4)
    .map((g) => `${formatMoneyCents(g.spentCents)} ${g.name}`)
    .join(', ')
  const tail = groups.length > 4 ? `, +${groups.length - 4} more` : ''

  let summary: string
  if (incomeCents <= 0) {
    summary = `${formatMoneyCents(spentCents)} went out${groupParts ? ` — mostly ${groupParts}${tail}` : ''}.`
  } else if (keptCents > 0) {
    summary = `${formatMoneyCents(incomeCents)} came in → ${groupParts}${tail}. You kept ${formatMoneyCents(keptCents)}.`
  } else if (spentCents > incomeCents) {
    summary = `${formatMoneyCents(incomeCents)} came in and ${formatMoneyCents(spentCents)} went out — ${groupParts}${tail}.`
  } else {
    summary = `${formatMoneyCents(incomeCents)} came in → ${groupParts}${tail}.`
  }

  return {
    incomeCents,
    spentCents,
    keptCents,
    groups,
    categories,
    links,
    sparse,
    summary
  }
}

export { periodEndIso }
