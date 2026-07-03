import { useCallback, useEffect, useState } from 'react'
import type { MoneyDoorSnapshot } from '@shared/money'
import { computeLedgerNetCents, computeMonthFlowCents, currentPeriodKey } from '@shared/money'

export function useMoneyDoorSnapshot(): {
  snapshot: MoneyDoorSnapshot | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<MoneyDoorSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!window.moss?.money) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const periodKey = currentPeriodKey()
      const next = await window.moss.money.getDoorSnapshot(periodKey)
      const summary = next.summary
      const ledgerNetCents =
        typeof summary.ledgerNetCents === 'number'
          ? summary.ledgerNetCents
          : computeLedgerNetCents(
              await window.moss.money.listTransactions(100, periodKey)
            )

      setSnapshot({
        ...next,
        summary: {
          ...summary,
          ledgerNetCents,
          monthFlowCents: computeMonthFlowCents(summary.paycheckTotalCents, ledgerNetCents)
        }
      })
    } catch {
      try {
        const periodKey = currentPeriodKey()
        const [budget, summary, transactions] = await Promise.all([
          window.moss.money.getBudget(periodKey),
          window.moss.money.getSummary(periodKey),
          window.moss.money.listTransactions(100, periodKey)
        ])
        const ledgerNetCents =
          typeof summary.ledgerNetCents === 'number'
            ? summary.ledgerNetCents
            : computeLedgerNetCents(transactions)

        const envelopes = budget.categories
          .filter((row) => row.assignedCents > 0)
          .sort((a, b) => b.assignedCents - a.assignedCents)
          .slice(0, 3)
          .map((row) => ({
            categoryId: row.category.id,
            name: row.category.name,
            assignedCents: row.assignedCents,
            spentCents: row.spentCents,
            remainingCents: row.remainingCents
          }))

        setSnapshot({
          summary: {
            ...summary,
            ledgerNetCents,
            monthFlowCents: computeMonthFlowCents(budget.paycheckTotalCents, ledgerNetCents)
          },
          envelopes,
          portfolioTotalCents: 0,
          quotesStale: false
        })
      } catch {
        setSnapshot(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { snapshot, loading, refresh }
}
