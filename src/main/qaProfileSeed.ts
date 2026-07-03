/**
 * Seeds a rich "QA Tester" profile — money, calendar, nutrition, news.
 * Local-only calendar events; no inbox or Google Calendar.
 *
 * Real operator profiles: `MOSS_QA_SEED=1` (+ optional `MOSS_QA_SEED_FORCE=1`).
 * Isolated headless: `MOSS_HEADLESS_SEED=1` via headlessSeed.ts wrapper.
 */
import { app } from 'electron'
import { closeDatabase, setSetting } from './database'
import {
  initializeProfiles,
  listProfiles,
  createProfile,
  activateProfile,
  deleteProfile
} from './profiles'
import {
  createPaycheck,
  createCategory,
  setCategoryTarget,
  setAssignment,
  createTransaction,
  createTransfer,
  createInvestmentAccount,
  createInvestmentSnapshot,
  getBudgetOverview,
  getMoneySummary
} from './money'
import { createCashAccount, createSchedule, createBudgetRule } from './moneyV2'
import { createCategoryGroup, createInvestmentHolding } from './moneyS'
import { createSavingsGoal } from './moneySavings'
import { createInvestmentActivity } from './moneyInvestments'
import { createCalendarEvent } from './calendar'
import { setGoals, logEntry } from './nutrition'
import { addNewsSource, syncNewsSource } from './news'
import { currentPeriodKey, shiftPeriodKey, computeMonthFlowCents } from '@shared/money'
import { buildMoneyCockpitPresentation } from '@shared/moneyFlow'
import { getMoneyFlowGuidance } from './moneyFlow'
import { currentDateKey, shiftDateKey } from '@shared/nutrition'
import { PREFERENCES_STORAGE_KEY, DEFAULT_PREFERENCES } from '@shared/preferences'
import { NEWS_FEED_BUNDLES } from '@shared/newsBundles'

export const QA_PROFILE_NAME = 'QA Tester'

/** ISO datetime for `monthsAgo` months back, on `day` of that month. */
function monthsAgoDate(monthsAgo: number, day: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, day, 12, 0, 0)
  return d.toISOString()
}

function dayOffsetIso(daysFromToday: number, hour: number, durationHours = 1): { startAt: string; endAt: string } {
  const start = new Date()
  start.setDate(start.getDate() + daysFromToday)
  start.setHours(hour, 0, 0, 0)
  const end = new Date(start)
  end.setHours(start.getHours() + durationHours)
  return { startAt: start.toISOString(), endAt: end.toISOString() }
}

function seedExpense(input: {
  accountId: string
  categoryId: string
  amountCents: number
  payeeName: string
  memo: string
  occurredAt: string
  tags?: string[]
  status?: 'cleared' | 'pending'
}): void {
  createTransaction({
    amountCents: -Math.abs(input.amountCents),
    categoryId: input.categoryId,
    payeeName: input.payeeName,
    memo: input.memo,
    tags: input.tags,
    status: input.status ?? 'cleared',
    occurredAt: input.occurredAt,
    accountId: input.accountId
  })
}

/** Spend a believable share of an envelope assignment (never piles fake rollover). */
function seedEnvelopeSpend(input: {
  accountId: string
  categoryId: string
  assignedCents: number
  fraction: number
  payeeName: string
  memo: string
  occurredAt: string
  tags?: string[]
  status?: 'cleared' | 'pending'
}): void {
  const amountCents = Math.round(input.assignedCents * input.fraction)
  if (amountCents <= 0) return
  seedExpense({ ...input, amountCents })
}

/** Dev-only — prints current-month budget sanity after seed (stdout JSON). */
function logMoneySeedSanity(): void {
  const periodKey = currentPeriodKey()
  const budget = getBudgetOverview(periodKey)
  const summary = getMoneySummary(periodKey)
  const guidance = getMoneyFlowGuidance(periodKey)
  const monthFlowCents = computeMonthFlowCents(budget.paycheckTotalCents, summary.ledgerNetCents)
  const presentation = buildMoneyCockpitPresentation({
    budget,
    monthFlowCents,
    ledgerNetCents: summary.ledgerNetCents,
    guidance
  })

  const rolloverEnvelopes = budget.categories
    .filter((row) => row.category.rolloverEnabled && row.remainingCents !== 0)
    .map((row) => ({ name: row.category.name, remainingCents: row.remainingCents }))

  process.stdout.write(
    `${JSON.stringify({
      qaMoneySanity: {
        periodKey,
        unassignedCents: budget.unassignedCents,
        safeToSpendCents: guidance.safeToSpend.cents,
        relationshipLine: presentation.relationshipLine,
        rolloverEnvelopes
      }
    })}\n`
  )
}

function seedMoney(): void {
  // QA story: Alex, $4,200/mo take-home, mid-month. Monthly bills are assigned ≈ spent
  // (no $1,500 car-payment piles). Insurance is the only modest sinking fund (~2 mo saved).
  // ~$0 still to assign after full income assign; safe-to-spend from everyday envelope leftovers.

  const checking = createCashAccount({ name: 'Everyday Checking', type: 'checking', startingBalanceCents: 120_000 })
  const savings = createCashAccount({ name: 'Ally Savings', type: 'savings', startingBalanceCents: 940_000 })
  createCashAccount({ name: 'Wallet Cash', type: 'cash', startingBalanceCents: 8_000 })

  const billsGroup = createCategoryGroup({ name: 'Bills' })
  const livingGroup = createCategoryGroup({ name: 'Living' })
  const funGroup = createCategoryGroup({ name: 'Lifestyle' })

  const env = (name: string, groupId: string, targetCents: number, rolloverEnabled = false) => {
    const cat = createCategory({ name, groupId, targetCents, rolloverEnabled })
    setCategoryTarget({ categoryId: cat.id, targetCents })
    return cat
  }

  // Bills carry forward only where a balance should exist (insurance quarterly); paid monthly otherwise.
  const rent = env('Rent', billsGroup.id, 145_000, true)
  const utilities = env('Utilities', billsGroup.id, 15_000, true)
  const phone = env('Phone', billsGroup.id, 6_000, true)
  const internet = env('Internet', billsGroup.id, 7_000, true)
  const carPayment = env('Car payment', billsGroup.id, 30_000, true)
  const insurance = env('Insurance', billsGroup.id, 14_000, true)

  const groceries = env('Groceries', livingGroup.id, 60_000)
  const gas = env('Gas', livingGroup.id, 15_000)
  const health = env('Health', livingGroup.id, 8_000)

  const dining = env('Dining out', funGroup.id, 25_000)
  const funMoney = env('Fun money', funGroup.id, 15_000)
  const subs = env('Subscriptions', funGroup.id, 5_000)
  const misc = env('Misc', funGroup.id, 5_000)

  const emergency = createSavingsGoal({ name: 'Emergency fund', targetCents: 500_000, kind: 'emergency' })
  const vacation = createSavingsGoal({
    name: 'Hawaii trip',
    targetCents: 240_000,
    kind: 'custom',
    targetDate: monthsAgoDate(-6, 15).slice(0, 10)
  })

  const monthlyPlan: Array<[string, number]> = [
    [rent.id, 145_000],
    [utilities.id, 15_000],
    [phone.id, 6_000],
    [internet.id, 7_000],
    [carPayment.id, 30_000],
    [insurance.id, 14_000],
    [groceries.id, 60_000],
    [gas.id, 15_000],
    [health.id, 8_000],
    [dining.id, 25_000],
    [funMoney.id, 15_000],
    [subs.id, 5_000],
    [misc.id, 5_000],
    [emergency.categoryId, 55_000],
    [vacation.categoryId, 10_000]
  ]
  // Plan total = $4,200/mo — matches two paychecks so cumulative "to assign" stays near zero.

  for (let m = 5; m >= 0; m -= 1) {
    const periodKey = shiftPeriodKey(currentPeriodKey(), -m)
    const isCurrent = m === 0

    createPaycheck({
      label: 'Paycheck',
      amountCents: 210_000,
      receivedAt: monthsAgoDate(m, 1),
      accountId: checking.id
    })
    createPaycheck({
      label: 'Paycheck',
      amountCents: 210_000,
      receivedAt: monthsAgoDate(m, 15),
      accountId: checking.id
    })

    for (const [categoryId, amountCents] of monthlyPlan) {
      setAssignment({ categoryId, periodKey, amountCents })
    }

    // Monthly bills — assigned ≈ spent so rollover stays near zero.
    seedExpense({
      accountId: checking.id,
      categoryId: rent.id,
      amountCents: 145_000,
      payeeName: 'Sunset Apartments',
      memo: 'Rent',
      occurredAt: monthsAgoDate(m, 2)
    })
    seedExpense({
      accountId: checking.id,
      categoryId: utilities.id,
      amountCents: 14_300,
      payeeName: 'City Power',
      memo: 'Electric bill',
      occurredAt: monthsAgoDate(m, 10)
    })
    seedExpense({
      accountId: checking.id,
      categoryId: phone.id,
      amountCents: 6_000,
      payeeName: 'Verizon',
      memo: 'Phone bill',
      occurredAt: monthsAgoDate(m, 8)
    })
    seedExpense({
      accountId: checking.id,
      categoryId: internet.id,
      amountCents: 7_000,
      payeeName: 'Comcast',
      memo: 'Internet bill',
      occurredAt: monthsAgoDate(m, 9)
    })
    seedExpense({
      accountId: checking.id,
      categoryId: carPayment.id,
      amountCents: 30_000,
      payeeName: 'Honda Finance',
      memo: 'Car payment',
      occurredAt: monthsAgoDate(m, 5)
    })

    // Insurance: assign monthly, pay quarterly — at most ~2 months saved mid-cycle.
    if (m > 0 && m % 3 === 0) {
      seedExpense({
        accountId: checking.id,
        categoryId: insurance.id,
        amountCents: 42_000,
        payeeName: 'State Farm',
        memo: 'Auto insurance — quarterly',
        occurredAt: monthsAgoDate(m, 22)
      })
    }

    const spendFraction = isCurrent ? 1 : 0.98
    seedEnvelopeSpend({
      accountId: checking.id,
      categoryId: groceries.id,
      assignedCents: 60_000,
      fraction: isCurrent ? 0.52 : spendFraction,
      payeeName: "Trader Joe's",
      memo: 'Groceries',
      occurredAt: monthsAgoDate(m, 4),
      tags: ['food']
    })
    seedEnvelopeSpend({
      accountId: checking.id,
      categoryId: groceries.id,
      assignedCents: 60_000,
      fraction: isCurrent ? 0.18 : spendFraction * 0.35,
      payeeName: 'Safeway',
      memo: 'Groceries',
      occurredAt: monthsAgoDate(m, 12)
    })
    seedEnvelopeSpend({
      accountId: checking.id,
      categoryId: gas.id,
      assignedCents: 15_000,
      fraction: isCurrent ? 0.55 : spendFraction,
      payeeName: 'Shell',
      memo: 'Gas',
      occurredAt: monthsAgoDate(m, 6)
    })
    seedEnvelopeSpend({
      accountId: checking.id,
      categoryId: dining.id,
      assignedCents: 25_000,
      fraction: isCurrent ? 0.12 : spendFraction * 0.45,
      payeeName: 'Chipotle',
      memo: 'Lunch',
      occurredAt: monthsAgoDate(m, 8),
      tags: ['food']
    })
    seedEnvelopeSpend({
      accountId: checking.id,
      categoryId: dining.id,
      assignedCents: 25_000,
      fraction: isCurrent ? 0.58 : spendFraction * 0.55,
      payeeName: 'Sushi Bar',
      memo: 'Dinner',
      occurredAt: monthsAgoDate(m, 18)
    })
    seedEnvelopeSpend({
      accountId: checking.id,
      categoryId: subs.id,
      assignedCents: 5_000,
      fraction: isCurrent ? 0.32 : spendFraction * 0.35,
      payeeName: 'Netflix',
      memo: 'Subscription',
      occurredAt: monthsAgoDate(m, 14)
    })
    seedEnvelopeSpend({
      accountId: checking.id,
      categoryId: health.id,
      assignedCents: 8_000,
      fraction: isCurrent ? 0.56 : spendFraction * 0.6,
      payeeName: 'CVS Pharmacy',
      memo: 'Prescription',
      occurredAt: monthsAgoDate(m, 16),
      status: isCurrent ? 'pending' : 'cleared'
    })
    seedEnvelopeSpend({
      accountId: checking.id,
      categoryId: funMoney.id,
      assignedCents: 15_000,
      fraction: isCurrent ? 0.4 : spendFraction * 0.7,
      payeeName: 'Cinema',
      memo: 'Movie night',
      occurredAt: monthsAgoDate(m, 20)
    })
    if (!isCurrent) {
      seedEnvelopeSpend({
        accountId: checking.id,
        categoryId: misc.id,
        assignedCents: 5_000,
        fraction: 0.35,
        payeeName: 'Target',
        memo: 'Household',
        occurredAt: monthsAgoDate(m, 17)
      })
    }

    createTransaction({
      amountCents: 4_200,
      type: 'income',
      categoryId: null,
      payeeName: 'Amazon',
      memo: 'Refund',
      occurredAt: monthsAgoDate(m, 22),
      accountId: checking.id
    })
    createTransfer({
      fromAccountId: checking.id,
      toAccountId: savings.id,
      amountCents: 30_000,
      memo: 'Monthly savings',
      occurredAt: monthsAgoDate(m, 24)
    })

    // Savings goals accrue assigned dollars — move them off the budget monthly so piles stay believable.
    seedExpense({
      accountId: checking.id,
      categoryId: emergency.categoryId,
      amountCents: 55_000,
      payeeName: 'Ally Savings',
      memo: 'Emergency fund contribution',
      occurredAt: monthsAgoDate(m, 25)
    })
    seedExpense({
      accountId: checking.id,
      categoryId: vacation.categoryId,
      amountCents: 10_000,
      payeeName: 'Ally Savings',
      memo: 'Vacation fund contribution',
      occurredAt: monthsAgoDate(m, 26)
    })

    // One unfiled row in the current month for ledger QA.
    if (isCurrent) {
      createTransaction({
        amountCents: -1_850,
        categoryId: null,
        payeeName: 'Corner Cafe',
        memo: 'Coffee — not filed yet',
        status: 'cleared',
        occurredAt: monthsAgoDate(m, 19),
        accountId: checking.id
      })
    }
  }

  const nextMonthFirst = monthsAgoDate(-1, 1).slice(0, 10)
  createSchedule({
    kind: 'income',
    label: 'Paycheck',
    amountCents: 210_000,
    accountId: checking.id,
    cadence: 'biweekly',
    nextDate: nextMonthFirst
  })
  createSchedule({
    kind: 'bill',
    label: 'Rent',
    amountCents: 145_000,
    categoryId: rent.id,
    accountId: checking.id,
    cadence: 'monthly',
    nextDate: nextMonthFirst
  })
  createSchedule({
    kind: 'bill',
    label: 'Car payment',
    amountCents: 30_000,
    categoryId: carPayment.id,
    accountId: checking.id,
    cadence: 'monthly',
    nextDate: monthsAgoDate(-1, 5).slice(0, 10)
  })
  createSchedule({
    kind: 'bill',
    label: 'Netflix',
    amountCents: 1_599,
    categoryId: subs.id,
    accountId: checking.id,
    cadence: 'monthly',
    nextDate: monthsAgoDate(-1, 14).slice(0, 10)
  })

  createBudgetRule({ matchField: 'payee', matchType: 'contains', matchValue: "Trader Joe's", categoryId: groceries.id })
  createBudgetRule({ matchField: 'payee', matchType: 'contains', matchValue: 'Shell', categoryId: gas.id })
  createBudgetRule({ matchField: 'memo', matchType: 'contains', matchValue: 'Subscription', categoryId: subs.id })

  const four01k = createInvestmentAccount({ label: 'Fidelity 401(k)', accountType: '401k' })
  const brokerage = createInvestmentAccount({ label: 'Robinhood', accountType: 'brokerage' })

  createInvestmentHolding({
    accountId: four01k.id,
    symbol: 'VTI',
    label: 'Total US Market',
    quantity: 42,
    costBasisCents: 980_000,
    manualPriceCents: 27_100,
    allocationTag: 'US Equity'
  })
  createInvestmentHolding({
    accountId: four01k.id,
    symbol: 'VXUS',
    label: 'Intl Market',
    quantity: 60,
    costBasisCents: 360_000,
    manualPriceCents: 6_250,
    allocationTag: 'Intl Equity'
  })
  createInvestmentHolding({
    accountId: four01k.id,
    symbol: 'BND',
    label: 'Total Bond',
    quantity: 80,
    costBasisCents: 590_000,
    manualPriceCents: 7_150,
    allocationTag: 'Bonds'
  })
  createInvestmentHolding({
    accountId: brokerage.id,
    symbol: 'AAPL',
    label: 'Apple',
    quantity: 15,
    costBasisCents: 270_000,
    manualPriceCents: 22_000,
    allocationTag: 'US Equity'
  })
  createInvestmentHolding({
    accountId: brokerage.id,
    symbol: 'NVDA',
    label: 'NVIDIA',
    quantity: 8,
    costBasisCents: 420_000,
    manualPriceCents: 120_000,
    allocationTag: 'US Equity'
  })

  createInvestmentActivity({
    accountId: brokerage.id,
    type: 'buy',
    symbol: 'AAPL',
    quantity: 5,
    amountCents: -90_000,
    occurredAt: monthsAgoDate(4, 10),
    memo: 'Buy AAPL'
  })
  createInvestmentActivity({
    accountId: brokerage.id,
    type: 'dividend',
    symbol: 'AAPL',
    amountCents: 3_100,
    occurredAt: monthsAgoDate(2, 12),
    memo: 'Dividend'
  })
  createInvestmentActivity({
    accountId: brokerage.id,
    type: 'fee',
    amountCents: -500,
    occurredAt: monthsAgoDate(1, 3),
    memo: 'Account fee'
  })

  for (let m = 5; m >= 0; m -= 1) {
    // Snapshots trend upward; latest matches manual-price holdings so reconciliation is quiet on first open.
    const progress = (6 - m) / 6
    const four01kHoldingsCents = 42 * 27_100 + 60 * 6_250 + 80 * 7_150
    const brokerageHoldingsCents = 15 * 22_000 + 8 * 120_000
    createInvestmentSnapshot({
      accountId: four01k.id,
      valueCents: Math.round(four01kHoldingsCents * (0.82 + progress * 0.18)),
      asOf: monthsAgoDate(m, 28),
      memo: 'Statement'
    })
    createInvestmentSnapshot({
      accountId: brokerage.id,
      valueCents: Math.round(brokerageHoldingsCents * (0.82 + progress * 0.18)),
      asOf: monthsAgoDate(m, 28),
      memo: 'Statement'
    })
  }
}

function seedCalendar(): void {
  const events: Array<{
    title: string
    days: number
    hour: number
    duration?: number
    location?: string
    notes?: string
    kind?: 'general' | 'class' | 'exam' | 'assignment' | 'office_hours'
  }> = [
    { title: 'Team standup', days: 1, hour: 9, duration: 0.5, location: 'Zoom', kind: 'general' },
    { title: 'Dentist — cleaning', days: 5, hour: 14, location: 'Pearl Dental', kind: 'general' },
    { title: 'Coffee with Alex', days: -2, hour: 10, location: 'Starbucks on Main', kind: 'general' },
    { title: 'Gym — leg day', days: 0, hour: 18, duration: 1.5, location: '24 Hour Fitness', kind: 'general' },
    { title: 'Book club', days: 3, hour: 19, duration: 2, location: 'Public library', kind: 'general' },
    { title: 'Car oil change', days: 8, hour: 11, location: 'Jiffy Lube', kind: 'general' },
    { title: 'Payday reminder', days: -14, hour: 8, notes: 'Check direct deposit landed', kind: 'general' },
    { title: 'Weekend hike', days: 6, hour: 7, duration: 4, location: 'Forest Park trailhead', kind: 'general' }
  ]

  for (const event of events) {
    const { startAt, endAt } = dayOffsetIso(event.days, event.hour, event.duration ?? 1)
    createCalendarEvent({
      title: event.title,
      startAt,
      endAt,
      location: event.location,
      notes: event.notes,
      kind: event.kind
    })
  }
}

function seedNutrition(): void {
  setGoals({ calorieTarget: 2200, proteinG: 140, carbsG: 240, fatG: 72, fiberG: 30 })

  const meals: Array<{
    slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'
    label: string
    kcal: number
    proteinG: number
    carbsG: number
    fatG: number
  }> = [
    { slot: 'breakfast', label: 'Oatmeal with berries', kcal: 320, proteinG: 12, carbsG: 52, fatG: 8 },
    { slot: 'lunch', label: 'Chicken rice bowl', kcal: 580, proteinG: 42, carbsG: 58, fatG: 16 },
    { slot: 'snack', label: 'Greek yogurt', kcal: 150, proteinG: 15, carbsG: 12, fatG: 4 },
    { slot: 'dinner', label: 'Salmon and roasted veggies', kcal: 620, proteinG: 45, carbsG: 28, fatG: 32 },
    { slot: 'snack', label: 'Apple + peanut butter', kcal: 210, proteinG: 6, carbsG: 22, fatG: 12 }
  ]

  for (let d = 13; d >= 0; d -= 1) {
    const dateKey = shiftDateKey(currentDateKey(), -d)
    const dayMeals = d % 3 === 0 ? meals.slice(0, 4) : meals
    for (const meal of dayMeals) {
      logEntry({
        dateKey,
        mealSlot: meal.slot,
        label: meal.label,
        kcal: meal.kcal,
        proteinG: meal.proteinG,
        carbsG: meal.carbsG,
        fatG: meal.fatG
      })
    }
  }
}

async function seedNews(): Promise<void> {
  const feeds = [
    ...NEWS_FEED_BUNDLES[0].feeds.slice(0, 2),
    NEWS_FEED_BUNDLES[1].feeds[0]
  ]

  for (const feed of feeds) {
    const source = await addNewsSource({ url: feed.url, title: feed.title })
    try {
      await syncNewsSource(source.id)
    } catch {
      // Offline during seed is fine — sources still show up.
    }
  }
}

function writePreferences(): void {
  setSetting(
    PREFERENCES_STORAGE_KEY,
    JSON.stringify({
      ...DEFAULT_PREFERENCES,
      colorMode: 'light',
      profile: { displayName: QA_PROFILE_NAME },
      setup: { completedAt: new Date().toISOString(), version: 1 },
      modules: {
        calendar: { enabled: true },
        money: { enabled: true, investmentsEnabled: true, advancedToolsEnabled: true },
        nutrition: { enabled: true },
        inbox: { enabled: false },
        news: {
          enabled: true,
          maxItems: 9,
          widgetLayout: 'split',
          briefingMode: 'balanced',
          maxPerSource: 2
        }
      }
    })
  )
}

export interface QaProfileSeedOptions {
  /** Quit Electron after seeding (headless / script mode). */
  quitApp?: boolean
  /** Replace an existing QA Tester profile. */
  force?: boolean
}

export async function runQaProfileSeed(options: QaProfileSeedOptions = {}): Promise<void> {
  initializeProfiles()

  const existing = listProfiles().find((p) => p.displayName === QA_PROFILE_NAME)
  if (existing) {
    if (options.force) {
      deleteProfile(existing.id, { confirmName: QA_PROFILE_NAME })
    } else {
      closeDatabase()
      if (options.quitApp) app.quit()
      return
    }
  }

  const created = createProfile({ displayName: QA_PROFILE_NAME, avatarColor: 'moss' })
  const result = await activateProfile(created.profile.id, undefined, { bypassPassword: true })
  if (!result.ok) {
    throw new Error(result.message ?? 'Failed to activate QA profile')
  }

  writePreferences()
  seedMoney()
  logMoneySeedSanity()
  seedCalendar()
  seedNutrition()
  await seedNews()

  closeDatabase()
  if (options.quitApp) app.quit()
}
