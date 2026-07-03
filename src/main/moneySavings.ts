import { randomUUID } from 'node:crypto'
import type {
  CategoryBudgetRow,
  MoneyBudgetOverview
} from '@shared/money'
import type {
  ContributeToSavingsGoalInput,
  CreateSavingsGoalInput,
  SavingsContributionRecord,
  SavingsFundingHint,
  SavingsGoalActivityRow,
  SavingsGoalRecord,
  SavingsOverview
} from '@shared/moneySavings'
import {
  buildSavingsBalanceNote,
  computeContributionGuidance,
  computeProjectProgress,
  computeSavingsProgress,
  defaultMilestonesCents,
  milestonesReached,
  savingsProgressMode
} from '@shared/moneySavings'
import { getDb, getSetting } from './database'
import { getBudgetOverview, setAssignment, createCategory } from './money'
import { createCategoryGroup, listCategoryGroups } from './moneyS'
import { formatMoneyCents } from '@shared/money'

const HOLD_BUFFER_KEY = 'money.flow.holdBufferCents'

function readHoldBufferCents(): number {
  const raw = getSetting(HOLD_BUFFER_KEY)?.value
  const parsed = raw !== undefined && raw !== '' ? Number.parseInt(raw, 10) : 0
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

/** Received-only capacity — same formula as flow guidance, without circular imports. */
function computeSafeToSaveCents(budget: MoneyBudgetOverview): number {
  const receivedOnly = budget.paychecks.reduce((sum, paycheck) => sum + paycheck.amountCents, 0)
  return Math.max(0, receivedOnly - budget.assignedTotalCents - readHoldBufferCents())
}

const GOAL_COLUMNS = `id, name, target_cents, target_date, category_id, kind, milestones_cents, rollover_enabled, created_at`
const SAVINGS_GROUP_NAME = 'Savings'

function rowToGoal(row: {
  id: string
  name: string
  target_cents: number
  target_date: string | null
  category_id: string
  kind: string
  milestones_cents: string
  rollover_enabled: number
  created_at: string
}): SavingsGoalRecord {
  let milestones: number[] = []
  try {
    const parsed = JSON.parse(row.milestones_cents)
    milestones = Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === 'number' && Number.isFinite(v))
      : []
  } catch {
    milestones = []
  }
  return {
    id: row.id,
    name: row.name,
    targetCents: row.target_cents,
    targetDate: row.target_date,
    categoryId: row.category_id,
    kind: row.kind as SavingsGoalRecord['kind'],
    milestonesCents: milestones,
    rolloverEnabled: row.rollover_enabled === 1,
    createdAt: row.created_at
  }
}

function rowToContribution(row: {
  id: string
  goal_id: string
  amount_cents: number
  occurred_at: string
  memo: string
  created_at: string
}): SavingsContributionRecord {
  return {
    id: row.id,
    goalId: row.goal_id,
    amountCents: row.amount_cents,
    occurredAt: row.occurred_at,
    memo: row.memo,
    createdAt: row.created_at
  }
}

export function listSavingsCategoryIds(): Set<string> {
  const rows = getDb()
    .prepare('SELECT category_id FROM savings_goals')
    .all() as Array<{ category_id: string }>
  return new Set(rows.map((row) => row.category_id))
}

export function listSavingsGoals(): SavingsGoalRecord[] {
  const rows = getDb()
    .prepare(`SELECT ${GOAL_COLUMNS} FROM savings_goals ORDER BY created_at ASC`)
    .all() as Parameters<typeof rowToGoal>[0][]
  return rows.map(rowToGoal)
}

function ensureSavingsGroupId(): string {
  const existing = listCategoryGroups().find(
    (group) => group.name.toLowerCase() === SAVINGS_GROUP_NAME.toLowerCase()
  )
  if (existing) return existing.id
  return createCategoryGroup({ name: SAVINGS_GROUP_NAME }).id
}

function categoryRowForGoal(
  goal: SavingsGoalRecord,
  budget: MoneyBudgetOverview
): CategoryBudgetRow | undefined {
  return budget.categories.find((row) => row.category.id === goal.categoryId)
}

function savingsFundingHints(budget: MoneyBudgetOverview): SavingsFundingHint[] {
  const hints: SavingsFundingHint[] = []
  const billGroupIds = new Set(
    budget.groups.filter((g) => g.name.trim().toLowerCase() === 'bills').map((g) => g.id)
  )

  for (const row of budget.categories) {
    const groupId = row.category.groupId
    const target = row.targetCents ?? 0
    if (!groupId || !billGroupIds.has(groupId)) continue
    if (target <= 0 || row.assignedCents >= target) continue
    hints.push({
      name: row.category.name,
      amountCents: target - row.assignedCents,
      kind: 'bill_shortfall'
    })
  }

  for (const row of budget.overspent) {
    hints.push({
      name: row.name,
      amountCents: Math.abs(row.remainingCents),
      kind: 'overspent'
    })
  }

  return hints
}

function periodEndIso(periodKey: string): string {
  const [year, month] = periodKey.split('-').map(Number)
  const end = new Date(year, month, 0, 23, 59, 59, 999)
  return end.toISOString()
}

function cumulativeSpentByCategory(periodKey: string): Map<string, number> {
  const end = periodEndIso(periodKey)
  const db = getDb()
  const spent = new Map<string, number>()
  const add = (categoryId: string | null, amount: number): void => {
    if (!categoryId || amount <= 0) return
    spent.set(categoryId, (spent.get(categoryId) ?? 0) + amount)
  }

  const direct = db
    .prepare(
      `SELECT category_id, COALESCE(SUM(ABS(amount_cents)), 0) AS spent
       FROM ledger_transactions
       WHERE category_id IS NOT NULL AND amount_cents < 0 AND occurred_at <= ?
       GROUP BY category_id`
    )
    .all(end) as Array<{ category_id: string; spent: number }>
  for (const row of direct) add(row.category_id, row.spent)

  const split = db
    .prepare(
      `SELECT s.category_id AS category_id, COALESCE(SUM(ABS(s.amount_cents)), 0) AS spent
       FROM ledger_transaction_splits s
       JOIN ledger_transactions t ON t.id = s.transaction_id
       WHERE s.category_id IS NOT NULL AND s.amount_cents < 0 AND t.occurred_at <= ?
       GROUP BY s.category_id`
    )
    .all(end) as Array<{ category_id: string; spent: number }>
  for (const row of split) add(row.category_id, row.spent)

  return spent
}

function cumulativeAssignedByCategory(periodKey: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT category_id, COALESCE(SUM(amount_cents), 0) AS total
       FROM budget_assignments WHERE period_key <= ? GROUP BY category_id`
    )
    .all(periodKey) as Array<{ category_id: string; total: number }>
  return new Map(rows.map((row) => [row.category_id, row.total]))
}

function recentSavingsActivity(categoryId: string, limit = 5): SavingsGoalActivityRow[] {
  const db = getDb()
  type ActivityCandidate = SavingsGoalActivityRow & { sortAt: string }

  const direct = db
    .prepare(
      `SELECT t.id, t.occurred_at, t.memo, COALESCE(p.name, '') AS payee_name,
              ABS(t.amount_cents) AS amount_cents
       FROM ledger_transactions t
       LEFT JOIN payees p ON p.id = t.payee_id
       WHERE t.category_id = ? AND t.type = 'expense' AND t.amount_cents < 0
       ORDER BY t.occurred_at DESC
       LIMIT ?`
    )
    .all(categoryId, limit * 2) as Array<{
    id: string
    occurred_at: string
    memo: string
    payee_name: string
    amount_cents: number
  }>

  const split = db
    .prepare(
      `SELECT t.id, t.occurred_at, t.memo, COALESCE(p.name, '') AS payee_name,
              ABS(s.amount_cents) AS amount_cents, s.id AS split_id
       FROM ledger_transaction_splits s
       JOIN ledger_transactions t ON t.id = s.transaction_id
       LEFT JOIN payees p ON p.id = t.payee_id
       WHERE s.category_id = ? AND t.type = 'expense' AND s.amount_cents < 0
       ORDER BY t.occurred_at DESC
       LIMIT ?`
    )
    .all(categoryId, limit * 2) as Array<{
    id: string
    occurred_at: string
    memo: string
    payee_name: string
    amount_cents: number
    split_id: string
  }>

  const candidates: ActivityCandidate[] = []

  for (const row of direct) {
    const label = row.payee_name.trim() || row.memo.trim() || 'Expense'
    candidates.push({
      id: row.id,
      occurredAt: row.occurred_at,
      label,
      amountCents: row.amount_cents,
      sortAt: row.occurred_at
    })
  }

  for (const row of split) {
    const label = row.payee_name.trim() || row.memo.trim() || 'Expense'
    candidates.push({
      id: `${row.id}:${row.split_id}`,
      occurredAt: row.occurred_at,
      label,
      amountCents: row.amount_cents,
      sortAt: row.occurred_at
    })
  }

  candidates.sort((a, b) => b.sortAt.localeCompare(a.sortAt))

  const seen = new Set<string>()
  const rows: SavingsGoalActivityRow[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)
    rows.push({
      id: candidate.id,
      occurredAt: candidate.occurredAt,
      label: candidate.label,
      amountCents: candidate.amountCents
    })
    if (rows.length >= limit) break
  }

  return rows
}

export function getSavingsOverview(periodKey?: string): SavingsOverview {
  const budget = getBudgetOverview(periodKey)
  const goals = listSavingsGoals()
  const safeToSaveCents = computeSafeToSaveCents(budget)
  const fundingHints = savingsFundingHints(budget)
  const cumulativeSpent = cumulativeSpentByCategory(budget.periodKey)
  const cumulativeAssigned = cumulativeAssignedByCategory(budget.periodKey)

  const rows = goals.map((goal) => {
    const catRow = categoryRowForGoal(goal, budget)
    const balanceCents = catRow?.remainingCents ?? 0
    const assignedThisPeriodCents = catRow?.assignedCents ?? 0
    const spentThisPeriodCents = catRow?.spentCents ?? 0
    const spentTotalCents = cumulativeSpent.get(goal.categoryId) ?? 0
    const fundedTotalCents = cumulativeAssigned.get(goal.categoryId) ?? 0
    const progressMode = savingsProgressMode(goal.kind)

    const progress =
      progressMode === 'project'
        ? computeProjectProgress(spentTotalCents, goal.targetCents)
        : computeSavingsProgress(balanceCents, goal.targetCents)

    const remainingCents =
      progressMode === 'project'
        ? Math.max(0, goal.targetCents - spentTotalCents)
        : Math.max(0, goal.targetCents - balanceCents)

    const milestoneBasis = progressMode === 'project' ? spentTotalCents : balanceCents

    const balanceNote = buildSavingsBalanceNote({
      balanceCents,
      assignedThisPeriodCents,
      transferredOutCents: spentThisPeriodCents
    })
    const guidance = computeContributionGuidance({
      savedCents: progressMode === 'project' ? fundedTotalCents : balanceCents,
      targetCents: goal.targetCents,
      targetDate: goal.targetDate,
      assignedThisPeriodCents,
      safeToSaveCents,
      unassignedCents: budget.unassignedCents,
      fundingHints,
      balanceNote
    })

    return {
      goal,
      progressMode,
      balanceCents,
      assignedThisPeriodCents,
      transferredOutCents: spentThisPeriodCents,
      spentThisPeriodCents,
      spentTotalCents,
      fundedTotalCents,
      savedCents: balanceCents,
      progress,
      remainingCents,
      milestonesReached: milestonesReached(milestoneBasis, goal.milestonesCents),
      guidance,
      balanceNote,
      recentActivity: recentSavingsActivity(goal.categoryId)
    }
  })

  return {
    periodKey: budget.periodKey,
    goals: rows,
    totalSavedCents: rows.reduce((sum, row) => sum + Math.max(0, row.balanceCents), 0),
    totalTargetCents: rows.reduce((sum, row) => sum + row.goal.targetCents, 0),
    safeToSaveCents,
    unassignedCents: budget.unassignedCents,
    hasGoals: rows.length > 0
  }
}

export function createSavingsGoal(input: CreateSavingsGoalInput): SavingsGoalRecord {
  const name = input.name.trim()
  if (!name) throw new Error('Goal name is required')
  if (input.targetCents <= 0) throw new Error('Target amount must be positive')

  const groupId = ensureSavingsGroupId()
  const category = createCategory({
    name,
    groupId,
    targetCents: input.targetCents,
    countsTowardSafeToSpend: false,
    // Savings must accumulate — leftover should never return to the "to assign" pool.
    rolloverEnabled: true
  })

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const kind = input.kind ?? 'custom'
  const milestones =
    input.milestonesCents && input.milestonesCents.length > 0
      ? input.milestonesCents
      : defaultMilestonesCents(input.targetCents)
  const targetDate = input.targetDate?.slice(0, 10) ?? null

  getDb()
    .prepare(
      `INSERT INTO savings_goals
       (id, name, target_cents, target_date, category_id, kind, milestones_cents, rollover_enabled, created_at)
       VALUES (@id, @name, @targetCents, @targetDate, @categoryId, @kind, @milestones, @rollover, @createdAt)`
    )
    .run({
      id,
      name,
      targetCents: input.targetCents,
      targetDate,
      categoryId: category.id,
      kind,
      milestones: JSON.stringify(milestones),
      rollover: input.rolloverEnabled === false ? 0 : 1,
      createdAt
    })

  return rowToGoal(
    getDb()
      .prepare(`SELECT ${GOAL_COLUMNS} FROM savings_goals WHERE id = ?`)
      .get(id) as Parameters<typeof rowToGoal>[0]
  )
}

export function deleteSavingsGoal(id: string): void {
  const goal = getDb()
    .prepare(`SELECT category_id FROM savings_goals WHERE id = ?`)
    .get(id) as { category_id: string } | undefined
  if (!goal) throw new Error('Savings goal not found')

  const db = getDb()
  const run = db.transaction(() => {
    db.prepare('DELETE FROM savings_contributions WHERE goal_id = ?').run(id)
    db.prepare('DELETE FROM savings_goals WHERE id = ?').run(id)
    db.prepare('DELETE FROM budget_assignments WHERE category_id = ?').run(goal.category_id)
    db.prepare('DELETE FROM budget_categories WHERE id = ?').run(goal.category_id)
  })
  run()
}

/**
 * Move money from the unassigned pool into a savings goal envelope.
 * Never pulls from rent, groceries, or other survival envelopes.
 */
export function contributeToSavingsGoal(input: ContributeToSavingsGoalInput): SavingsContributionRecord {
  if (input.amountCents <= 0) throw new Error('Contribution must be positive')

  const goalRow = getDb()
    .prepare(`SELECT ${GOAL_COLUMNS} FROM savings_goals WHERE id = ?`)
    .get(input.goalId) as Parameters<typeof rowToGoal>[0] | undefined
  if (!goalRow) throw new Error('Savings goal not found')

  const budget = getBudgetOverview(input.periodKey)

  if (input.amountCents > budget.unassignedCents) {
    throw new Error(
      `Only ${formatMoneyCents(budget.unassignedCents)} is ready to assign right now`
    )
  }

  const goal = rowToGoal(goalRow)
  const catRow = categoryRowForGoal(goal, budget)
  const currentAssigned = catRow?.assignedCents ?? 0
  const now = new Date().toISOString()
  const occurredAt = now

  const db = getDb()
  const run = db.transaction(() => {
    setAssignment({
      categoryId: goal.categoryId,
      periodKey: input.periodKey,
      amountCents: currentAssigned + input.amountCents
    })

    const contributionId = randomUUID()
    db.prepare(
      `INSERT INTO savings_contributions (id, goal_id, amount_cents, occurred_at, memo, created_at)
       VALUES (@id, @goalId, @amountCents, @occurredAt, @memo, @createdAt)`
    ).run({
      id: contributionId,
      goalId: input.goalId,
      amountCents: input.amountCents,
      occurredAt,
      memo: (input.memo ?? '').trim(),
      createdAt: now
    })
  })
  run()

  const latest = getDb()
    .prepare(
      `SELECT id, goal_id, amount_cents, occurred_at, memo, created_at
       FROM savings_contributions WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(input.goalId) as Parameters<typeof rowToContribution>[0]

  return rowToContribution(latest)
}
