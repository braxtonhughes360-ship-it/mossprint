import { useEffect, useMemo, useState } from 'react'
import type { CategoryBudgetRow, MoneyBudgetOverview } from '@shared/money'
import { currentPeriodKey, formatMoneyCents, parseMoneyInput } from '@shared/money'
import type { MonthWrapUpReadout } from '@shared/moneyFlow'
import { computeMonthWrapUp, monthWrapDismissStorageKey } from '@shared/moneyFlow'
import type { SavingsOverview } from '@shared/moneySavings'
import { savingsKindLabel } from '@shared/moneySavings'
import { useMotionGates } from '../hooks/useMotionGates'
import { MossSelect } from './MossSelect'

interface MoneyMonthWrapCardProps {
  budget: MoneyBudgetOverview
  savingsOverview: SavingsOverview
  savingsCategoryIds: ReadonlySet<string>
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

function discretionarySources(
  categories: CategoryBudgetRow[],
  savingsCategoryIds: ReadonlySet<string>
): CategoryBudgetRow[] {
  return categories
    .filter(
      (row) =>
        row.category.countsTowardSafeToSpend &&
        !savingsCategoryIds.has(row.category.id) &&
        row.remainingCents > 0
    )
    .sort((a, b) => b.remainingCents - a.remainingCents)
}

export function MoneyMonthWrapCard({
  budget,
  savingsOverview,
  savingsCategoryIds,
  busy,
  onMutate
}: MoneyMonthWrapCardProps): React.JSX.Element | null {
  const { motionEnabled } = useMotionGates()
  const isCurrentPeriod = budget.periodKey === currentPeriodKey()
  const readout: MonthWrapUpReadout = useMemo(
    () =>
      computeMonthWrapUp({
        budget,
        savingsCategoryIds,
        isCurrentPeriod
      }),
    [budget, savingsCategoryIds, isCurrentPeriod]
  )

  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(monthWrapDismissStorageKey(budget.periodKey)) === '1'
    } catch {
      return false
    }
  })

  const goalOptions = useMemo(
    () =>
      savingsOverview.goals.map((row) => ({
        value: row.goal.id,
        label: `${row.goal.name} (${savingsKindLabel(row.goal.kind)})`
      })),
    [savingsOverview.goals]
  )

  const [goalId, setGoalId] = useState(() => goalOptions[0]?.value ?? '')
  const [amountDraft, setAmountDraft] = useState('')

  useEffect(() => {
    if (!goalOptions.some((option) => option.value === goalId)) {
      setGoalId(goalOptions[0]?.value ?? '')
    }
  }, [goalId, goalOptions])

  useEffect(() => {
    if (readout.suggestedSweepCents > 0 && !amountDraft) {
      setAmountDraft(String(readout.suggestedSweepCents / 100))
    }
  }, [amountDraft, readout.suggestedSweepCents])

  if (!readout.eligible || dismissed || !savingsOverview.hasGoals || goalOptions.length === 0) {
    return null
  }

  const amountCents = parseMoneyInput(amountDraft) ?? 0
  const canMove =
    amountCents > 0 &&
    amountCents <= readout.discretionaryLeftoverCents &&
    goalId.length > 0 &&
    !busy

  function dismiss(): void {
    setDismissed(true)
    try {
      localStorage.setItem(monthWrapDismissStorageKey(budget.periodKey), '1')
    } catch {
      // best-effort persistence only
    }
  }

  async function moveToGoal(): Promise<void> {
    if (!canMove) return
    const sources = discretionarySources(budget.categories, savingsCategoryIds)
    let remaining = amountCents

    await onMutate(async () => {
      for (const source of sources) {
        if (remaining <= 0) break
        const pull = Math.min(remaining, source.remainingCents)
        await window.moss.money.setAssignment({
          categoryId: source.category.id,
          periodKey: budget.periodKey,
          amountCents: source.assignedCents - pull
        })
        remaining -= pull
      }
      const swept = amountCents - remaining
      if (swept <= 0) return
      await window.moss.money.contributeToSavingsGoal({
        goalId,
        periodKey: budget.periodKey,
        amountCents: swept,
        memo: 'Month wrap-up'
      })
    })
    dismiss()
  }

  return (
    <section
      className={[
        'money-month-wrap-card',
        motionEnabled ? 'money-month-wrap-card--motion' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Month wrap-up"
    >
      <p className="money-instrument-kicker">Month wrap-up</p>
      <p className="money-month-wrap-headline">
        You have {formatMoneyCents(readout.discretionaryLeftoverCents)} unspent in spending
        envelopes. Move some to savings?
      </p>
      <p className="money-month-wrap-caveat">
        Moving money to a savings goal lowers your safe-to-spend — it leaves your spending
        envelopes and counts toward your goal instead. This only re-assigns budget dollars; it does
        not move cash in your accounts or place any trades.
      </p>

      <div className="money-month-wrap-controls">
        <label className="money-month-wrap-field">
          <span className="money-flow-mini-label">Savings goal</span>
          <MossSelect
            className="money-select--inline money-month-wrap-goal"
            value={goalId}
            options={goalOptions}
            onChange={setGoalId}
            disabled={busy}
            ariaLabel="Savings goal for month wrap-up"
          />
        </label>
        <label className="money-month-wrap-field money-month-wrap-field--amount">
          <span className="money-flow-mini-label">Amount</span>
          <input
            type="text"
            inputMode="decimal"
            className="money-input money-input--assign money-mono"
            value={amountDraft}
            onChange={(event) => setAmountDraft(event.target.value)}
            disabled={busy}
            aria-label="Amount to move to savings"
          />
        </label>
        <button
          type="button"
          className="money-button money-button--accent money-month-wrap-move"
          disabled={!canMove}
          onClick={() => void moveToGoal()}
        >
          Move {formatMoneyCents(amountCents > 0 ? amountCents : readout.suggestedSweepCents)}
        </button>
      </div>

      <button
        type="button"
        className="money-button money-button--ghost money-button--compact money-month-wrap-dismiss"
        disabled={busy}
        onClick={dismiss}
      >
        Keep it in my envelopes
      </button>
    </section>
  )
}
