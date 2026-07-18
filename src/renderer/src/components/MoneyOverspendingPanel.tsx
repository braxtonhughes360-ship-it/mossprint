import type { MoneyBudgetOverview } from '@shared/money'
import { formatMoneyCents } from '@shared/money'
import type { MoneyMutateFn } from '../moneyMutate'
import { MossSelect } from './MossSelect'

interface MoneyOverspendingPanelProps {
  budget: MoneyBudgetOverview
  busy: boolean
  onMutate: MoneyMutateFn
}

export function MoneyOverspendingPanel({
  budget,
  busy,
  onMutate
}: MoneyOverspendingPanelProps): React.JSX.Element | null {
  // Move money INTO an overspent envelope from a chosen source — the unassigned pool or
  // another envelope's available balance. Capped at the source's remaining ("X left") so its
  // available never drops below zero and money is never created. Pulling from an envelope
  // lowers its THIS-PERIOD assignment, which may go negative — valid under carry-forward
  // (pulling previously-assigned money back out; see MONEY_ARCHITECTURE.md Rollover semantics).
  async function coverOverspend(
    targetCategoryId: string,
    sourceValue: string,
    needCents: number
  ): Promise<void> {
    const targetAssigned =
      budget.categories.find((row) => row.category.id === targetCategoryId)?.assignedCents ?? 0

    if (sourceValue === 'pool') {
      const amount = Math.min(needCents, budget.unassignedCents)
      if (amount <= 0) return
      await onMutate(async () => {
        await window.moss.money.setAssignment({
          categoryId: targetCategoryId,
          periodKey: budget.periodKey,
          amountCents: targetAssigned + amount
        })
      })
      return
    }

    const source = budget.categories.find((row) => row.category.id === sourceValue)
    if (!source) return
    const amount = Math.min(needCents, source.remainingCents)
    if (amount <= 0) return
    await onMutate(async () => {
      await window.moss.money.setAssignment({
        categoryId: source.category.id,
        periodKey: budget.periodKey,
        amountCents: source.assignedCents - amount
      })
      await window.moss.money.setAssignment({
        categoryId: targetCategoryId,
        periodKey: budget.periodKey,
        amountCents: targetAssigned + amount
      })
    })
  }

  if (budget.overspent.length === 0) return null

  return (
    <section
      className="money-instrument-panel money-envelope-instrument--overspent"
      aria-label="Overspending"
    >
          <p className="money-instrument-kicker">Overspent</p>
          <p className="money-overspent-help">
            You spent more than these envelopes hold. Pull the difference from money that&rsquo;s
            still free — your unassigned cash or another envelope with room to spare.
          </p>
          <ul className="money-envelope-list">
            {budget.overspent.map((item) => {
              const need = Math.abs(item.remainingCents)
              const sourceOptions = [
                ...(budget.unassignedCents > 0
                  ? [
                      {
                        value: 'pool',
                        label: `Unassigned (${formatMoneyCents(budget.unassignedCents)})`
                      }
                    ]
                  : []),
                ...budget.categories
                  .filter((row) => row.category.id !== item.categoryId && row.remainingCents > 0)
                  .sort((a, b) => b.remainingCents - a.remainingCents)
                  .map((row) => ({
                    value: row.category.id,
                    label: `${row.category.name} (${formatMoneyCents(row.remainingCents)} free)`
                  }))
              ]
              return (
                <li key={item.categoryId} className="money-envelope-instrument-top py-2">
                  <span className="money-envelope-instrument-name">{item.name}</span>
                  <span className="money-row-actions">
                    <span className="money-envelope-instrument-remaining money-envelope-instrument-remaining--over money-mono">
                      {formatMoneyCents(need)} over
                    </span>
                    {sourceOptions.length > 0 ? (
                      <MossSelect
                        className="money-select--inline money-cover-select"
                        value=""
                        options={sourceOptions}
                        onChange={(sourceValue) => void coverOverspend(item.categoryId, sourceValue, need)}
                        placeholder="Cover from…"
                        disabled={busy}
                        ariaLabel={`Cover ${item.name} overspend from`}
                      />
                    ) : (
                      <span className="money-cover-empty money-mono">
                        No free money — trim an envelope or add income
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
    </section>
  )
}
