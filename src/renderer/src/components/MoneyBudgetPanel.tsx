import { useMemo, useRef, useState } from 'react'
import type {
  BudgetRuleRecord,
  CashAccountBalance,
  MoneyBudgetOverview,
  ScheduleRecord
} from '@shared/money'
import type { MoneyFlowGuidance, MoneyFlowSettings } from '@shared/moneyFlow'
import { computeMonthWrapUp } from '@shared/moneyFlow'
import { currentPeriodKey } from '@shared/money'
import type { SavingsOverview } from '@shared/moneySavings'
import { MoneySchedulesPanel } from './MoneySchedulesPanel'
import { MoneyRulesPanel } from './MoneyRulesPanel'
import { MoneyFlowPanel } from './MoneyFlowPanel'
import { MoneyMonthWrapCard } from './MoneyMonthWrapCard'
import { MoneySavingsPanel } from './MoneySavingsPanel'
import type { MoneyMutateFn } from '../moneyMutate'
import { MossEmptyState } from './MossEmptyState'
import { MoneyEnvelopePanel } from './MoneyEnvelopePanel'
import { MoneyIncomePanel } from './MoneyIncomePanel'
import { MoneyOverspendingPanel } from './MoneyOverspendingPanel'

interface MoneyBudgetPanelProps {
  budget: MoneyBudgetOverview
  savingsOverview: SavingsOverview
  savingsCategoryIds: Set<string>
  accounts: CashAccountBalance[]
  schedules: ScheduleRecord[]
  rules: BudgetRuleRecord[]
  flowGuidance: MoneyFlowGuidance | null
  flowSettings: MoneyFlowSettings | null
  advancedToolsEnabled: boolean
  busy: boolean
  onMutate: MoneyMutateFn
  /** Deep-link to the ledger filtered to unfiled rows (from the drift warning). */
  onFindUnfiled?: () => void
  /** Deep-link to the ledger filtered to a savings goal envelope. */
  onOpenLedgerForCategory?: (categoryId: string) => void
}

export function MoneyBudgetPanel({
  budget,
  savingsOverview,
  savingsCategoryIds,
  accounts,
  schedules,
  rules,
  flowGuidance,
  flowSettings,
  advancedToolsEnabled,
  busy,
  onMutate,
  onFindUnfiled,
  onOpenLedgerForCategory
}: MoneyBudgetPanelProps): React.JSX.Element {
  const [savingsError, setSavingsError] = useState<string | null>(null)
  const paycheckAmountRef = useRef<HTMLInputElement>(null)

  const envelopeSweepCents = useMemo(() => {
    const readout = computeMonthWrapUp({
      budget,
      savingsCategoryIds,
      isCurrentPeriod: budget.periodKey === currentPeriodKey()
    })
    return readout.eligible ? readout.discretionaryLeftoverCents : 0
  }, [budget, savingsCategoryIds])

  // Brand-new budget: no income and no envelopes yet. Lead with a warm "start here"
  // panel instead of a row of zeros, and open the income form so step 1 is right there.
  const isFresh = budget.paychecks.length === 0 && budget.categories.length === 0

  return (
    <div className="money-workspace">
      {isFresh ? (
        <MossEmptyState
          className="money-empty-onboard"
          aria-label="Get started"
          kicker="Start here"
          title="Build your first budget"
          body="Add the pay you actually take home, then give those dollars jobs like Rent, Groceries, and Fun. MOSS will show what is safe to spend as you go."
          action={{
            label: 'Add take-home pay',
            variant: 'primary',
            onClick: () => {
              paycheckAmountRef.current?.scrollIntoView({ block: 'center' })
              paycheckAmountRef.current?.focus({ preventScroll: true })
            }
          }}
        />
      ) : null}

      {flowGuidance && flowSettings && (
        <MoneyFlowPanel
          guidance={flowGuidance}
          settings={flowSettings}
          advancedToolsEnabled={advancedToolsEnabled}
          busy={busy}
          onMutate={onMutate}
          onFindUnfiled={onFindUnfiled}
        />
      )}

      <MoneyMonthWrapCard
        budget={budget}
        savingsOverview={savingsOverview}
        savingsCategoryIds={savingsCategoryIds}
        busy={busy}
        onMutate={onMutate}
      />

      <MoneySavingsPanel
        overview={savingsOverview}
        busy={busy}
        envelopeSweepCents={envelopeSweepCents}
        actionError={savingsError}
        onOpenLedgerForCategory={onOpenLedgerForCategory}
        onMutate={(task) => {
          setSavingsError(null)
          return onMutate(task, { onError: setSavingsError })
        }}
      />

      <MoneyOverspendingPanel budget={budget} busy={busy} onMutate={onMutate} />

      <MoneyEnvelopePanel
        budget={budget}
        savingsCategoryIds={savingsCategoryIds}
        busy={busy}
        onMutate={onMutate}
        onOpenLedgerForCategory={onOpenLedgerForCategory}
      />

      <MoneySchedulesPanel
        schedules={schedules}
        categories={budget.categories}
        accounts={accounts}
        busy={busy}
        onMutate={onMutate}
      />

      {budget.categories.length > 0 && (
        <MoneyRulesPanel
          rules={rules}
          categories={budget.categories}
          busy={busy}
          onMutate={onMutate}
        />
      )}

      <MoneyIncomePanel
        budget={budget}
        accounts={accounts}
        busy={busy}
        isFresh={isFresh}
        paycheckAmountRef={paycheckAmountRef}
        onMutate={onMutate}
      />
    </div>
  )
}
