import '../MoneyPage.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { emptySavingsOverview } from '@shared/moneySavings'
import { normalizeMoneyFlowGuidance } from '@shared/moneyFlow'
import type { LedgerFilter } from '@shared/money'
import {
  computeLedgerNetCents,
  computeMonthFlowCents,
  currentPeriodKey,
  EMPTY_LEDGER_FILTER,
  formatMoneyUserError,
  formatPeriodLabel,
  shiftPeriodKey
} from '@shared/money'
import { MoneyBudgetPanel } from '../components/MoneyBudgetPanel'
import { MoneyCockpitStrip } from '../components/MoneyCockpitStrip'
import { MoneyDescribeField } from '../components/MoneyDescribeField'
import { MoneyDetailRail } from '../components/MoneyDetailRail'
import { MoneyInvestmentsPanel } from '../components/MoneyInvestmentsPanel'
import { MoneyLedgerPanel } from '../components/MoneyLedgerPanel'
import { MoneyReportsPanel } from '../components/MoneyReportsPanel'
import { MoneyDataPanel } from '../components/MoneyDataPanel'
import { MoneySettingsPanel } from '../components/MoneySettingsPanel'
import { MODULE_VISUAL } from '@shared/modules'
import { usePreferences } from '../context/PreferencesProvider'

type MoneyTab = 'budget' | 'ledger' | 'investments' | 'reports' | 'data' | 'settings'

import type { MoneyMutateFn, MoneyMutateOptions } from '../moneyMutate'

export function MoneyPage(): React.JSX.Element {
  const visual = MODULE_VISUAL.money
  const { preferences } = usePreferences()
  const investmentsEnabled = preferences.modules.money.investmentsEnabled
  const advancedToolsEnabled = preferences.modules.money.advancedToolsEnabled ?? false
  const [searchParams] = useSearchParams()
  const [periodKey, setPeriodKey] = useState(() => currentPeriodKey())
  const [tab, setTab] = useState<MoneyTab>(() => {
    const requested = searchParams.get('tab')
    if (requested === 'settings') return 'settings'
    if (requested === 'data') return 'data'
    if (requested === 'reports') return 'reports'
    if (requested === 'ledger') return 'ledger'
    if (requested === 'investments' && investmentsEnabled) return 'investments'
    return 'budget'
  })
  const queryClient = useQueryClient()
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // One-shot ledger filter handed off when deep-linking from the unfiled warning.
  const [pendingLedgerFilter, setPendingLedgerFilter] = useState<LedgerFilter | null>(null)

  const findUnfiled = useCallback(() => {
    setPendingLedgerFilter({ ...EMPTY_LEDGER_FILTER, categoryId: 'none' })
    setTab('ledger')
  }, [])

  const openLedgerForCategory = useCallback((categoryId: string) => {
    setPendingLedgerFilter({ ...EMPTY_LEDGER_FILTER, categoryId })
    setTab('ledger')
  }, [])

  // Period-scoped budget/ledger data — refetched when the month changes.
  const coreQuery = useQuery({
    queryKey: ['money', 'core', periodKey],
    queryFn: async () => {
      const [budget, transactions, summary, flowGuidance, savingsOverview, paychecks] =
        await Promise.all([
          window.moss.money.getBudget(periodKey),
          window.moss.money.listTransactions(500, periodKey),
          window.moss.money.getSummary(periodKey),
          window.moss.money.getFlowGuidance?.(periodKey) ?? Promise.resolve(null),
          window.moss.money
            .getSavingsOverview(periodKey)
            .catch(() => emptySavingsOverview(periodKey)),
          window.moss.money.listPaychecks().catch(() => [])
        ])
      return { budget, transactions, summary, flowGuidance, savingsOverview, paychecks }
    },
    enabled: Boolean(window.moss?.money)
  })

  // Period-independent reference lists (accounts, schedules, rules, …).
  const listsQuery = useQuery({
    queryKey: ['money', 'lists'],
    queryFn: async () => {
      const [accounts, schedules, rules, categories, payees, flowSettings, savingsGoals] =
        await Promise.all([
          window.moss.money.listCashAccounts?.() ?? Promise.resolve([]),
          window.moss.money.listSchedules?.() ?? Promise.resolve([]),
          window.moss.money.listRules?.() ?? Promise.resolve([]),
          window.moss.money.listCategories(),
          window.moss.money.listPayees(),
          window.moss.money.getFlowSettings?.() ?? Promise.resolve(null),
          window.moss.money.listSavingsGoals().catch(() => [])
        ])
      return { accounts, schedules, rules, categories, payees, flowSettings, savingsGoals }
    },
    enabled: Boolean(window.moss?.money)
  })

  const investmentsQuery = useQuery({
    queryKey: ['money', 'investments'],
    queryFn: () => window.moss.money.getInvestments(),
    enabled: Boolean(window.moss?.money?.getInvestments) && investmentsEnabled
  })

  const budget = coreQuery.data?.budget ?? null
  const transactions = coreQuery.data?.transactions ?? []
  // Register-visible income (QA2-08): this month's paychecks, display-only.
  const periodPaychecks = useMemo(
    () =>
      (coreQuery.data?.paychecks ?? []).filter((paycheck) =>
        paycheck.receivedAt.startsWith(periodKey)
      ),
    [coreQuery.data?.paychecks, periodKey]
  )
  const flowGuidance = normalizeMoneyFlowGuidance(coreQuery.data?.flowGuidance ?? null)
  const savingsOverview = coreQuery.data?.savingsOverview ?? null
  const cashAccounts = listsQuery.data?.accounts ?? []
  const schedules = listsQuery.data?.schedules ?? []
  const rules = listsQuery.data?.rules ?? []
  const categoryRecords = listsQuery.data?.categories ?? []
  const payees = listsQuery.data?.payees ?? []
  const flowSettings = listsQuery.data?.flowSettings ?? null
  const savingsCategoryIds = new Set(
    (listsQuery.data?.savingsGoals ?? []).map((goal) => goal.categoryId)
  )

  // Envelope options for the hero describe bar (same shape the register uses).
  const describeCategoryOptions = useMemo(
    () => [
      { value: '', label: 'No envelope' },
      ...(budget?.categories ?? []).map((row) => ({
        value: row.category.id,
        label: row.category.name
      }))
    ],
    [budget?.categories]
  )

  const summary = coreQuery.data?.summary
  const ledgerNetCents =
    typeof summary?.ledgerNetCents === 'number'
      ? summary.ledgerNetCents
      : computeLedgerNetCents(transactions)
  const flowSummary = budget
    ? {
        monthFlowCents: computeMonthFlowCents(budget.paycheckTotalCents, ledgerNetCents),
        ledgerNetCents
      }
    : null

  const investments = investmentsEnabled ? investmentsQuery.data : undefined
  const portfolioTotalCents = investments
    ? investments.holdingsTotalCents > 0
      ? investments.holdingsTotalCents
      : investments.totalCents
    : 0
  const quotesStale = investments?.quotesStale ?? false

  const queryError = !window.moss?.money
    ? 'Money storage unavailable'
    : coreQuery.error || listsQuery.error
      ? formatMoneyUserError(coreQuery.error ?? listsQuery.error)
      : null
  const error = mutationError ?? queryError

  useEffect(() => {
    if (!investmentsEnabled && tab === 'investments') {
      setTab('budget')
    }
  }, [investmentsEnabled, tab])

  async function runMutation(
    task: () => Promise<void>,
    options?: MoneyMutateOptions
  ): Promise<void> {
    setBusy(true)
    try {
      await task()
      // Surgical enough for now: every money mutation invalidates the money tree.
      await queryClient.invalidateQueries({ queryKey: ['money'] })
      if (!options?.onError) setMutationError(null)
    } catch (err) {
      const message = formatMoneyUserError(err)
      if (options?.onError) {
        options.onError(message)
      } else {
        setMutationError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  const isCurrentPeriod = periodKey === currentPeriodKey()

  return (
    <div className="moss-arrival moss-arrival-money" data-module="money" data-texture={visual.texture}>
      <header className="moss-arrival-band money-arrival-band">
        <div className="moss-arrival-band-inner module-arrival-head money-arrival-head">
          <div className="module-arrival-title-block money-arrival-title-block">
            <p className="money-arrival-kicker">{visual.tag}</p>
            <h1 className="display-arrival">Financials</h1>
          </div>

          <div className="module-arrival-meta-block money-arrival-period-block">
            <div className="money-period-nav">
              <button
                type="button"
                className="money-period-button"
                aria-label="Previous month"
                onClick={() => setPeriodKey((key) => shiftPeriodKey(key, -1))}
              >
                ←
              </button>
              <p className="money-arrival-period money-mono">{formatPeriodLabel(periodKey)}</p>
              <button
                type="button"
                className="money-period-button"
                aria-label="Next month"
                disabled={isCurrentPeriod}
                onClick={() => setPeriodKey((key) => shiftPeriodKey(key, 1))}
              >
                →
              </button>
            </div>
            {!isCurrentPeriod && (
              <button
                type="button"
                className="money-period-today"
                onClick={() => setPeriodKey(currentPeriodKey())}
              >
                Back to current month
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="moss-arrival-body money-arrival-body">
        {budget && flowSummary && (
          <MoneyCockpitStrip
            budget={budget}
            summary={flowSummary}
            flowGuidance={flowGuidance}
            advancedToolsEnabled={advancedToolsEnabled}
          />
        )}

        {/* QA2-06: describe is the module's flagship input — hero position,
            same describe-first pattern as the calendar add bar (QA2-05). */}
        {budget && (tab === 'budget' || tab === 'ledger') && (
          <div className="money-describe-hero">
            <p className="money-describe-hero-kicker nutrition-mono">Describe it</p>
            <MoneyDescribeField
              categoryOptions={describeCategoryOptions}
              busy={busy}
              onMutate={runMutation}
            />
          </div>
        )}

        <div className="money-page-layout">
          <div className="money-page-main">
            <div className="money-tab-bar" role="tablist" aria-label="Money views">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'budget'}
                className={['money-tab', tab === 'budget' ? 'money-tab--active' : ''].filter(Boolean).join(' ')}
                onClick={() => setTab('budget')}
              >
                Budget
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'ledger'}
                className={['money-tab', tab === 'ledger' ? 'money-tab--active' : ''].filter(Boolean).join(' ')}
                onClick={() => setTab('ledger')}
              >
                Ledger
              </button>
              {investmentsEnabled && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'investments'}
                  className={['money-tab', tab === 'investments' ? 'money-tab--active' : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setTab('investments')}
                >
                  Investments
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'reports'}
                className={['money-tab', tab === 'reports' ? 'money-tab--active' : ''].filter(Boolean).join(' ')}
                onClick={() => setTab('reports')}
              >
                Reports
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'data'}
                className={['money-tab', tab === 'data' ? 'money-tab--active' : ''].filter(Boolean).join(' ')}
                onClick={() => setTab('data')}
              >
                Import / Export
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'settings'}
                className={['money-tab', tab === 'settings' ? 'money-tab--active' : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setTab('settings')}
              >
                Settings
              </button>
            </div>

            {error && <p className="money-error">{error}</p>}

            {tab === 'budget' && budget && (
              <MoneyBudgetPanel
                budget={budget}
                savingsOverview={savingsOverview ?? emptySavingsOverview(periodKey)}
                savingsCategoryIds={savingsCategoryIds}
                accounts={cashAccounts}
                schedules={schedules}
                rules={rules}
                flowGuidance={flowGuidance}
                flowSettings={flowSettings}
                advancedToolsEnabled={advancedToolsEnabled}
                busy={busy}
                onMutate={runMutation}
                onFindUnfiled={findUnfiled}
                onOpenLedgerForCategory={openLedgerForCategory}
              />
            )}

            {tab === 'ledger' && budget && (
              <MoneyLedgerPanel
                budget={budget}
                periodKey={periodKey}
                transactions={transactions}
                paychecks={periodPaychecks}
                accounts={cashAccounts}
                busy={busy}
                onMutate={runMutation}
                initialFilter={pendingLedgerFilter}
                onInitialFilterApplied={() => setPendingLedgerFilter(null)}
              />
            )}

            {tab === 'investments' && investmentsEnabled && (
              <MoneyInvestmentsPanel busy={busy} onMutate={runMutation} />
            )}

            {tab === 'reports' && budget && (
              <MoneyReportsPanel
                periodKey={periodKey}
                accounts={cashAccounts}
                categories={categoryRecords}
                groups={budget.groups}
                payees={payees}
                busy={busy}
                onMutate={runMutation}
              />
            )}

            {tab === 'data' && (
              <MoneyDataPanel accounts={cashAccounts} busy={busy} onMutate={runMutation} />
            )}

            {tab === 'settings' && (
              <MoneySettingsPanel busy={busy} onMutate={runMutation} />
            )}
          </div>

          {budget && flowSummary && tab !== 'reports' && tab !== 'data' && tab !== 'settings' && (
            <MoneyDetailRail
              budget={budget}
              summary={flowSummary}
              transactions={transactions}
              schedules={schedules}
              portfolioTotalCents={portfolioTotalCents}
              quotesStale={quotesStale}
            />
          )}
        </div>
      </div>
    </div>
  )
}
