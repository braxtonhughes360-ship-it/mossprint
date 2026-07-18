import { app } from 'electron'
import { initHeadlessProfile } from './headlessCommon'

export async function runHeadlessLedgerSmoke(): Promise<void> {
  // Exercises the V2e ledger lifecycle end-to-end through the real SQLCipher
  // stack (create → edit → revert → transfer → reconcile → delete → restore).
  // Wrapped in BEGIN/ROLLBACK so it never leaves residue in the profile DB.
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const db = getDb()

    const checks: Record<string, boolean> = {}
    const rowCount = (id: string): number =>
      (db.prepare('SELECT COUNT(*) AS c FROM ledger_transactions WHERE id = ?').get(id) as {
        c: number
      }).c

    db.exec('BEGIN')
    try {
      const accountA = money.createCashAccount({
        name: 'Smoke A',
        type: 'checking',
        startingBalanceCents: 10_000
      })
      const accountB = money.createCashAccount({
        name: 'Smoke B',
        type: 'savings',
        startingBalanceCents: 0
      })
      const category = money.createCategory({ name: 'Smoke envelope' })
      const occurredAt = new Date().toISOString()

      // create
      const expense = money.createTransaction({
        amountCents: -2000,
        type: 'expense',
        status: 'cleared',
        categoryId: category.id,
        memo: 'Smoke coffee',
        notes: 'first note',
        tags: ['Smoke', 'Coffee'],
        occurredAt,
        accountId: accountA.id
      })
      checks.createType = expense.type === 'expense'
      checks.createTags = expense.tags.includes('smoke') && expense.tags.includes('coffee')
      checks.createAudit = money.getTransactionAudit(expense.id).some((a) => a.action === 'created')

      // edit
      const edited = money.updateTransaction({
        id: expense.id,
        amountCents: -2500,
        type: 'expense',
        status: 'reconciled',
        categoryId: category.id,
        memo: 'Smoke coffee',
        notes: 'second note',
        tags: ['smoke'],
        occurredAt,
        accountId: accountA.id
      })
      checks.editAmount = edited.amountCents === -2500
      checks.editStatus = edited.status === 'reconciled'
      checks.editAudit = money.getTransactionAudit(expense.id).some((a) => a.action === 'edited')

      // revert
      const reverted = money.revertTransaction(expense.id)
      checks.revertAmount = reverted.amountCents === -2000
      checks.revertStatus = reverted.status === 'cleared'
      checks.revertAudit = money.getTransactionAudit(expense.id).some((a) => a.action === 'restored')

      // transfer (two legs)
      const legs = money.createTransfer({
        fromAccountId: accountA.id,
        toAccountId: accountB.id,
        amountCents: 1000,
        occurredAt
      })
      checks.transferLegs = legs.length === 2
      checks.transferType = legs.every((leg) => leg.type === 'transfer')
      checks.transferGrouped =
        legs[0].transferGroupId !== null && legs[0].transferGroupId === legs[1].transferGroupId

      // balances: A = 10000 − 2000 − 1000 = 7000 ; B = 0 + 1000 = 1000
      const balances = money.listCashAccounts()
      const balA = balances.find((a) => a.id === accountA.id)?.balanceCents
      const balB = balances.find((a) => a.id === accountB.id)?.balanceCents
      checks.balanceFrom = balA === 7000
      checks.balanceTo = balB === 1000

      // reconcile math + lock
      money.setTransactionStatus({ id: expense.id, status: 'pending' })
      const recon = money.getReconciliationSummary(accountA.id)
      checks.reconWorking = recon.workingBalanceCents === 7000
      checks.reconClearedExcludesPending = recon.clearedBalanceCents === 9000
      checks.reconPending = recon.pendingCount === 1
      const locked = money.reconcileClearedForAccount(accountA.id)
      checks.reconLockCount = locked.count === 1 // only the cleared transfer leg

      // delete + undo
      const del = money.deleteTransaction(expense.id)
      checks.deleteToken = del.undoToken !== ''
      checks.deleteGone = rowCount(expense.id) === 0
      money.restoreDeletedTransaction(del.undoToken)
      checks.restoreBack = rowCount(expense.id) === 1

      // deleting one transfer leg removes the whole group
      money.deleteTransaction(legs[0].id)
      const groupLeft = (
        db
          .prepare('SELECT COUNT(*) AS c FROM ledger_transactions WHERE transfer_group_id = ?')
          .get(legs[0].transferGroupId) as { c: number }
      ).c
      checks.transferGroupDelete = groupLeft === 0
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)

    const { resolveMerchantChip, normalizePayeeForMatch } = await import('@shared/merchantChip')
    const amazon = resolveMerchantChip('AMZN MKTP US*AB12CD')
    const local = resolveMerchantChip('Corner Cafe')
    const chipChecks = {
      amazonIcon: amazon.iconUrl === '/merchant-icons/amazon.svg',
      amazonMonogram: amazon.monogram === 'AM',
      localMonogram: local.monogram === 'CC',
      localColorStable:
        resolveMerchantChip('Corner Cafe').color === local.color &&
        resolveMerchantChip('corner cafe').color === local.color,
      normalizeNoise: normalizePayeeForMatch('SQ *STARBUCKS #1234').includes('starbucks')
    }
    const chipOk = Object.values(chipChecks).every(Boolean)

    process.stdout.write(`${JSON.stringify({ ok, checks, chipOk, chipChecks })}\n`)
    app.exit(ok && chipOk ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessCreditSmoke(): Promise<void> {
  // Credit-card accounting end-to-end: charge raises debt + hits the envelope (single count);
  // payoff transfer lowers debt + cash and leaves net worth unchanged. BEGIN/ROLLBACK — no residue.
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const { accountOwedCents } = await import('@shared/money')
    const db = getDb()

    const checks: Record<string, boolean> = {}
    // Net worth mirror: sum of all non-archived account balances (as buildNetWorthSeries does).
    const netWorth = (): number =>
      money.listCashAccounts().reduce((sum, a) => (a.archived ? sum : sum + a.balanceCents), 0)
    const balanceOf = (id: string): number =>
      money.listCashAccounts().find((a) => a.id === id)?.balanceCents ?? 0
    const spentOf = (categoryId: string): number =>
      money.getBudgetOverview().categories.find((r) => r.category.id === categoryId)?.spentCents ?? 0

    db.exec('BEGIN')
    try {
      const checking = money.createCashAccount({
        name: 'CC Smoke Checking',
        type: 'checking',
        startingBalanceCents: 100_000
      })
      // A card created with $500 owed is stored as a negative balance.
      const card = money.createCashAccount({
        name: 'CC Smoke Visa',
        type: 'credit',
        startingBalanceCents: -50_000
      })
      const category = money.createCategory({ name: 'CC Smoke envelope' })
      const occurredAt = new Date().toISOString()

      checks.creditTypeAccepted = balanceOf(card.id) === -50_000
      checks.owedHelper = accountOwedCents(balanceOf(card.id)) === 50_000

      const netWorthStart = netWorth() // 100000 + (-50000) = 50000
      checks.netWorthStart = netWorthStart === 50_000

      // Charge $50 on the card, categorized — raises debt AND envelope spent.
      money.createTransaction({
        amountCents: -5_000,
        type: 'expense',
        status: 'cleared',
        categoryId: category.id,
        memo: 'CC Smoke charge',
        occurredAt,
        accountId: card.id
      })
      checks.chargeRaisesOwed = balanceOf(card.id) === -55_000
      checks.chargeHitsEnvelope = spentOf(category.id) === 5_000
      checks.chargeLeavesCash = balanceOf(checking.id) === 100_000
      checks.chargeLowersNetWorth = netWorth() === 45_000 // down by exactly the charge

      // Pay $300 from checking → card. Lowers debt + cash, nets to zero in budget.
      const legs = money.createTransfer({
        fromAccountId: checking.id,
        toAccountId: card.id,
        amountCents: 30_000,
        occurredAt
      })
      checks.payTwoLegs = legs.length === 2
      checks.payNoCategory = legs.every((leg) => leg.categoryId === null)
      checks.payLowersOwed = balanceOf(card.id) === -25_000
      checks.payLowersCash = balanceOf(checking.id) === 70_000
      checks.payNoEnvelopeChange = spentOf(category.id) === 5_000 // payoff must not double-count
      checks.payKeepsNetWorth = netWorth() === 45_000 // paying debt doesn't change net worth
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)
    process.stdout.write(`${JSON.stringify({ ok, checks })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessFlowSmoke(): Promise<void> {
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const moneyFlow = await import('./moneyFlow')
    const { checkAffordability, computeMonthWrapUp, MONTH_WRAP_MIN_LEFTOVER_CENTS } = await import('@shared/moneyFlow')
    const { currentPeriodKey, dayKeyToIso, dateKey } = await import('@shared/money')
    const db = getDb()

    const checks: Record<string, boolean> = {}

    db.exec('BEGIN')
    try {
      const periodKey = currentPeriodKey()
      const today = dateKey()
      const rent = money.createCategory({ name: 'Rent' })
      const fun = money.createCategory({ name: 'Fun' })
      const receivedAt = dayKeyToIso(today)

      money.createPaycheck({
        label: 'Pay A',
        amountCents: 80_000,
        receivedAt
      })
      money.createPaycheck({
        label: 'Pay B',
        amountCents: 120_000,
        receivedAt
      })
      money.setAssignment({ categoryId: rent.id, periodKey, amountCents: 140_000 })
      money.setAssignment({ categoryId: fun.id, periodKey, amountCents: 20_000 })

      const future = new Date()
      future.setDate(future.getDate() + 7)
      moneyFlow.createExpectedPaycheck({
        label: 'Next shift',
        amountCents: 95_000,
        expectedDate: dateKey(future)
      })

      let guidance = moneyFlow.getMoneyFlowGuidance(periodKey)
      checks.variablePay = guidance.irregular.variablePay.detected
      checks.rentCovered = guidance.rentGlance.covered
      checks.hasTimeline = guidance.timeline.length > 0
      checks.overspendListShape =
        !guidance.overspendRisk.atRisk || guidance.overspendRisk.envelopes.every((e) => !!e.categoryId)

      money.createTransaction({
        amountCents: -25_000,
        type: 'expense',
        status: 'cleared',
        categoryId: fun.id,
        memo: 'Smoke fun',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      guidance = moneyFlow.getMoneyFlowGuidance(periodKey)
      checks.overspendNamed = guidance.overspendRisk.envelopes.some((e) => e.name === 'Fun')

      // Beta.4 A2 — the hero must tell one story: rent that is only partially
      // funded in-envelope but coverable from unassigned reads as the softer
      // "assign" nudge (never "covered"), the overspend list never names the
      // housing envelope the glance already handles, and a coverable state is
      // never a red month.
      money.createTransaction({
        amountCents: -10_000,
        type: 'expense',
        status: 'cleared',
        categoryId: rent.id,
        memo: 'Smoke rent partial',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      guidance = moneyFlow.getMoneyFlowGuidance(periodKey)
      checks.rentAssignNotCovered =
        !guidance.rentGlance.covered && guidance.rentGlance.state === 'assign'
      checks.rentCoveredXorAtRisk = !guidance.overspendRisk.envelopes.some(
        (e) => e.categoryId === rent.id
      )
      checks.coverableIsNotRed = guidance.status !== 'over'

      money.createTransaction({
        amountCents: -5000,
        type: 'expense',
        status: 'pending',
        categoryId: null,
        memo: 'Smoke unfiled',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      guidance = moneyFlow.getMoneyFlowGuidance(periodKey)
      checks.driftUnfiled = guidance.drift.items.some((i) => i.label === 'Unfiled spending')
      checks.driftPending = guidance.drift.items.some((i) => i.label === 'Pending')

      const afford = checkAffordability(guidance, 1000)
      checks.affordCheck = typeof afford.affordable === 'boolean'
      checks.forecastWhy = guidance.restOfMonthForecast.why.includes('spend pace')

      const lastDay = new Date(
        Number.parseInt(periodKey.slice(0, 4), 10),
        Number.parseInt(periodKey.slice(5, 7), 10),
        0
      ).getDate()
      const nearEndToday = `${periodKey}-${String(lastDay).padStart(2, '0')}`

      checks.monthWrapNotEligibleMidMonth = !computeMonthWrapUp({
        budget: money.getBudgetOverview(periodKey),
        isCurrentPeriod: true,
        today: `${periodKey}-05`
      }).eligible

      const coffee = money.createCategory({ name: 'Coffee' })
      money.setAssignment({ categoryId: coffee.id, periodKey, amountCents: 2000 })
      const wrapBelowMin = computeMonthWrapUp({
        budget: money.getBudgetOverview(periodKey),
        isCurrentPeriod: true,
        today: nearEndToday
      })
      checks.monthWrapBelowMin =
        wrapBelowMin.discretionaryLeftoverCents < MONTH_WRAP_MIN_LEFTOVER_CENTS &&
        !wrapBelowMin.eligible

      const dining = money.createCategory({ name: 'Dining' })
      money.setAssignment({ categoryId: dining.id, periodKey, amountCents: 50_000 })
      money.createTransaction({
        amountCents: -10_000,
        type: 'expense',
        status: 'cleared',
        categoryId: dining.id,
        memo: 'Smoke dining',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      const wrapHigh = computeMonthWrapUp({
        budget: money.getBudgetOverview(periodKey),
        isCurrentPeriod: true,
        today: nearEndToday
      })
      checks.monthWrapLeftover =
        wrapHigh.discretionaryLeftoverCents >= MONTH_WRAP_MIN_LEFTOVER_CENTS &&
        wrapHigh.suggestedSweepCents === wrapHigh.discretionaryLeftoverCents
      checks.monthWrapEligibleNearEnd = wrapHigh.eligible

      const { computeContributionGuidance } = await import('@shared/moneySavings')
      const pacePulled = computeContributionGuidance({
        savedCents: 0,
        targetCents: 50_000,
        targetDate: null,
        assignedThisPeriodCents: 10_000,
        safeToSaveCents: 5000,
        unassignedCents: 5000
      })
      checks.savingsPaceUsesBalance =
        pacePulled.remainingThisMonthCents === 12_500 && pacePulled.suggestedAssignCents === 5000
      const paceHeld = computeContributionGuidance({
        savedCents: 10_000,
        targetCents: 50_000,
        targetDate: null,
        assignedThisPeriodCents: 10_000,
        safeToSaveCents: 5000,
        unassignedCents: 5000
      })
      checks.savingsPaceHeldPartial =
        paceHeld.remainingThisMonthCents < pacePulled.remainingThisMonthCents

      // Rollover off materializes pile into "to assign" (Option A); turning back on is fresh start.
      const priorMonth = new Date()
      priorMonth.setMonth(priorMonth.getMonth() - 1)
      const priorPeriod = `${priorMonth.getFullYear()}-${String(priorMonth.getMonth() + 1).padStart(2, '0')}`
      const sinking = money.createCategory({ name: 'Insurance', rolloverEnabled: true })
      const priorReceived = dayKeyToIso(`${priorPeriod}-15`)
      money.setAssignment({ categoryId: sinking.id, periodKey: priorPeriod, amountCents: 50_000 })
      money.createTransaction({
        amountCents: -30_000,
        type: 'expense',
        status: 'cleared',
        categoryId: sinking.id,
        memo: 'Prior premium',
        notes: '',
        tags: [],
        occurredAt: priorReceived
      })
      money.setAssignment({ categoryId: sinking.id, periodKey, amountCents: 10_000 })
      let budget = money.getBudgetOverview(periodKey)
      const sinkingRow = budget.categories.find((r) => r.category.id === sinking.id)
      checks.rolloverCarryIn =
        !!sinkingRow && sinkingRow.carryInCents === 20_000 && sinkingRow.remainingCents === 30_000
      const poolBefore = budget.unassignedCents
      money.setCategoryRollover({ categoryId: sinking.id, rolloverEnabled: false })
      budget = money.getBudgetOverview(periodKey)
      const afterOff = budget.categories.find((r) => r.category.id === sinking.id)
      checks.rolloverReleaseToPool = budget.unassignedCents === poolBefore + 20_000
      checks.rolloverReleasedPersisted =
        !!afterOff && afterOff.category.rolloverReleasedCents === 20_000 && afterOff.remainingCents === 10_000
      money.setCategoryRollover({ categoryId: sinking.id, rolloverEnabled: true })
      budget = money.getBudgetOverview(periodKey)
      const afterOn = budget.categories.find((r) => r.category.id === sinking.id)
      checks.rolloverFreshOn =
        !!afterOn &&
        afterOn.remainingCents === 10_000 &&
        afterOn.assignedCents === 10_000 &&
        afterOn.carryInCents === 0 &&
        afterOn.category.rolloverReleasedCents === 20_000

      const fresh = money.createCategory({ name: 'FreshBill', rolloverEnabled: false })
      money.setAssignment({ categoryId: fresh.id, periodKey, amountCents: 14_000 })
      money.setCategoryRollover({ categoryId: fresh.id, rolloverEnabled: true })
      budget = money.getBudgetOverview(periodKey)
      const freshRow = budget.categories.find((r) => r.category.id === fresh.id)
      checks.rolloverEnableKeepsAssign =
        !!freshRow &&
        freshRow.assignedCents === 14_000 &&
        freshRow.remainingCents === 14_000 &&
        freshRow.carryInCents === 0 &&
        freshRow.category.rolloverReleasedCents === 0

      const corrupt = money.createCategory({ name: 'CorruptHeal', rolloverEnabled: true })
      money.setAssignment({ categoryId: corrupt.id, periodKey, amountCents: 14_000 })
      db.prepare('UPDATE budget_categories SET rollover_released_cents = 14_000 WHERE id = ?').run(
        corrupt.id
      )
      // Heal is one-shot per profile (no writes on ordinary budget reads) — re-arm
      // it so this deliberate corruption exercises the heal logic itself.
      db.prepare("DELETE FROM settings WHERE key = 'money_heal_rollover_on_seal_v1'").run()
      budget = money.getBudgetOverview(periodKey)
      const corruptRow = budget.categories.find((r) => r.category.id === corrupt.id)
      checks.rolloverHealOnSeal =
        !!corruptRow &&
        corruptRow.remainingCents === 14_000 &&
        corruptRow.category.rolloverReleasedCents === 0

      const rolloverOver = money.createCategory({ name: 'RolloverOver', rolloverEnabled: true })
      money.setAssignment({ categoryId: rolloverOver.id, periodKey: priorPeriod, amountCents: 10_000 })
      money.setAssignment({ categoryId: rolloverOver.id, periodKey, amountCents: 5_000 })
      money.createTransaction({
        amountCents: -20_000,
        type: 'expense',
        status: 'cleared',
        categoryId: rolloverOver.id,
        memo: 'Over pile',
        notes: '',
        tags: [],
        occurredAt: receivedAt
      })
      budget = money.getBudgetOverview(periodKey)
      const overBefore = budget.categories.find((r) => r.category.id === rolloverOver.id)
      checks.coverOverspendDetectsRollover =
        !!overBefore && overBefore.remainingCents === -5_000 && budget.overspent.some((o) => o.categoryId === rolloverOver.id)
      money.createPaycheck({
        label: 'Cover pool',
        amountCents: 100_000,
        receivedAt
      })
      money.coverOverspending({ categoryId: rolloverOver.id, periodKey, source: 'pool' })
      budget = money.getBudgetOverview(periodKey)
      const overAfter = budget.categories.find((r) => r.category.id === rolloverOver.id)
      checks.coverOverspendRolloverOn = !!overAfter && overAfter.remainingCents >= 0
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)
    process.stdout.write(`${JSON.stringify({ ok, checks })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessReportsSmoke(): Promise<void> {
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const moneyReports = await import('./moneyReports')
    const { currentPeriodKey, dayKeyToIso, dateKey } = await import('@shared/money')
    const { normalizeMoneyReportsOverview, EMPTY_REPORT_FILTERS } = await import('@shared/moneyReports')
    const db = getDb()

    const checks: Record<string, boolean> = {}

    db.exec('BEGIN')
    try {
      const periodKey = currentPeriodKey()
      const today = dateKey()
      const groceries = money.createCategory({ name: 'Groceries' })
      const rent = money.createCategory({ name: 'Rent' })
      const receivedAt = dayKeyToIso(today)

      money.createPaycheck({ label: 'Pay', amountCents: 200_000, receivedAt })
      money.setAssignment({ categoryId: rent.id, periodKey, amountCents: 120_000 })
      money.setAssignment({ categoryId: groceries.id, periodKey, amountCents: 30_000 })
      money.createTransaction({
        amountCents: -4500,
        type: 'expense',
        status: 'cleared',
        categoryId: groceries.id,
        memo: 'Market',
        notes: '',
        tags: ['food'],
        occurredAt: receivedAt
      })

      const overview = moneyReports.getMoneyReportsOverview(EMPTY_REPORT_FILTERS, periodKey)
      checks.hasData = overview.hasData
      checks.spendingRows = overview.spendingByCategory.length > 0
      checks.cashFlowSeries = overview.cashFlowSeries.length >= 1
      checks.cashFlowAssigned =
        overview.cashFlowSeries.length > 0 &&
        typeof overview.cashFlowSeries[0].assignedCents === 'number'
      checks.envelopeProgress = overview.envelopeProgress.length > 0
      checks.envelopeWeeklySeries =
        overview.envelopeProgress.length > 0 &&
        overview.envelopeProgress[0].weeklySeries.length >= 1
      checks.netWorthSeries = overview.netWorthSeries.length >= 1
      checks.comparisonWhy = overview.comparison.why.length > 0
      // The Budget-trends meta (comparison.current) and the chart point come from the
      // same period — their assigned totals must agree, or the chart lies.
      const lastFlow = overview.cashFlowSeries[overview.cashFlowSeries.length - 1]
      checks.assignedConsistent =
        lastFlow.assignedCents === overview.comparison.current.assignedCents

      const normalized = normalizeMoneyReportsOverview(overview, periodKey)
      checks.normalizeArrays =
        Array.isArray(normalized.spendingByCategory) &&
        Array.isArray(normalized.envelopeProgress) &&
        Array.isArray(normalized.savingsGlance) &&
        Array.isArray(normalized.netWorthSeries)

      const preset = moneyReports.createReportPreset({
        name: 'Smoke preset',
        filters: { ...overview.filters, rangePreset: 'this_month' },
        viewMode: 'chart'
      })
      checks.presetRoundTrip = moneyReports.listReportPresets().some((p) => p.id === preset.id)
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)
    process.stdout.write(`${JSON.stringify({ ok, checks })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessImportSmoke(): Promise<void> {
  // Exercises the V2f import/export engine end-to-end against real SQLite:
  // parse → guess mapping → preview (ok/error/unmatched) → commit → re-preview
  // (duplicate detection) → full backup. Wrapped in BEGIN/ROLLBACK so nothing
  // persists, matching the reports/ledger smoke pattern.
  try {
    await initHeadlessProfile()
    const { getDb } = await import('./database')
    const money = await import('./money')
    const io = await import('./moneyImportExport')
    const { guessMapping, DEFAULT_IMPORT_OPTIONS, detectPreset, applyImportPreset } = await import(
      '@shared/moneyImportExport'
    )
    const db = getDb()

    const checks: Record<string, boolean> = {}

    db.exec('BEGIN')
    try {
      money.createCategory({ name: 'Groceries' })
      money.createCashAccount({ name: 'Checking', type: 'checking' })

      const csv = [
        'Date,Payee,Category,Amount',
        '2026-06-10,Market,Groceries,-45.00',
        '2026-06-11,Paycheck,,1200.00',
        'not-a-date,Broken,,-10.00',
        '2026-06-12,Cafe,Coffee,-5.25'
      ].join('\n')

      const parsed = io.parseCsv(csv)
      checks.parsedHeaders = parsed.headers.length === 4 && parsed.rows.length === 4

      const mapping = guessMapping(parsed.headers)
      checks.guessedMapping = mapping[0] === 'date' && mapping.includes('amount')

      const request = {
        headers: parsed.headers,
        rows: parsed.rows,
        mapping,
        options: { ...DEFAULT_IMPORT_OPTIONS }
      }

      const preview = io.previewImport(request)
      checks.previewOk = preview.okCount === 3 && preview.errorCount === 1
      checks.previewUnmatched = preview.unmatchedCategories.includes('Coffee')

      const commit = io.commitImport(request)
      checks.committed = commit.imported === 3 && commit.skippedErrors === 1

      const preview2 = io.previewImport(request)
      checks.dedupe = preview2.duplicateCount === 3 && preview2.okCount === 0

      const commit2 = io.commitImport(request)
      checks.dedupeSkips = commit2.imported === 0 && commit2.skippedDuplicates === 3

      const backup = io.buildBackup()
      checks.backupTxns = Boolean(backup.tables.ledger_transactions) &&
        backup.tables.ledger_transactions.rows.length >= 3
      checks.backupCategories = Boolean(backup.tables.budget_categories)

      // V2.5a — Chase preset: Description → payee (not Details DEBIT/CREDIT)
      const chaseCsv = [
        'Details,Posting Date,Description,Amount,Type,Balance',
        'DEBIT,06/15/2026,STARBUCKS,-5.75,DEBIT,100.00',
        'DEBIT,06/16/2026,PAYCHECK,1200.00,CREDIT,1300.00'
      ].join('\n')
      const chaseParsed = io.parseCsv(chaseCsv)
      checks.chasePreset = detectPreset(chaseParsed.headers) === 'chase'
      const chaseApplied = applyImportPreset('chase', chaseParsed.headers)
      checks.chaseMapping =
        chaseApplied.mapping.includes('date') &&
        chaseApplied.mapping.includes('payee') &&
        chaseApplied.mapping.includes('amount') &&
        chaseParsed.headers[chaseParsed.headers.indexOf('Details')] !== undefined &&
        chaseApplied.mapping[chaseParsed.headers.indexOf('Details')] === 'ignore'
      const chasePreview = io.previewImport({
        headers: chaseParsed.headers,
        rows: chaseParsed.rows,
        mapping: chaseApplied.mapping,
        options: chaseApplied.options
      })
      checks.chasePayeeNotDebit = chasePreview.rows[0].payee === 'STARBUCKS'
      checks.chaseAmounts =
        chasePreview.okCount === 2 &&
        chasePreview.rows[0].amountCents === -575 &&
        chasePreview.rows[1].amountCents === 120000

      // V2.5a — Capital One debit/credit two-column → signed amount
      const twoColCsv = [
        'Transaction Date,Description,Debit,Credit',
        '06/15/2026,Grocery Store,45.50,',
        '06/16/2026,Pay Deposit,,1200.00'
      ].join('\n')
      const twoColParsed = io.parseCsv(twoColCsv)
      checks.twoColPreset = detectPreset(twoColParsed.headers) === 'capital_one'
      const twoColApplied = applyImportPreset('capital_one', twoColParsed.headers)
      checks.twoColMapping =
        twoColApplied.mapping.includes('outflow') && twoColApplied.mapping.includes('inflow')
      const twoColPreview = io.previewImport({
        headers: twoColParsed.headers,
        rows: twoColParsed.rows,
        mapping: twoColApplied.mapping,
        options: twoColApplied.options
      })
      checks.twoColAmounts =
        twoColPreview.okCount === 2 &&
        twoColPreview.rows[0].amountCents === -4550 &&
        twoColPreview.rows[1].amountCents === 120000
    } finally {
      db.exec('ROLLBACK')
    }

    const ok = Object.values(checks).every(Boolean)
    process.stdout.write(`${JSON.stringify({ ok, checks })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    app.exit(1)
  }
}
