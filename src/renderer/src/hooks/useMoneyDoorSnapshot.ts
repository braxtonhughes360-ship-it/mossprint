import type { MossBridge } from '@shared/ipc'
import type { MoneyDoorSnapshot } from '@shared/money'
import { computeLedgerNetCents, computeMonthFlowCents, currentPeriodKey } from '@shared/money'
import { useDoorSnapshot, type DoorSnapshotResult } from './useDoorSnapshot'

async function loadMoneyDoorSnapshot(channel: MossBridge['money']): Promise<MoneyDoorSnapshot> {
  const periodKey = currentPeriodKey()
  try {
    const next = await channel.getDoorSnapshot(periodKey)
    const summary = next.summary
    const ledgerNetCents =
      typeof summary.ledgerNetCents === 'number'
        ? summary.ledgerNetCents
        : computeLedgerNetCents(await channel.listTransactions(100, periodKey))

    return {
      ...next,
      summary: {
        ...summary,
        ledgerNetCents,
        monthFlowCents: computeMonthFlowCents(summary.paycheckTotalCents, ledgerNetCents)
      }
    }
  } catch {
    const [budget, summary, transactions] = await Promise.all([
      channel.getBudget(periodKey),
      channel.getSummary(periodKey),
      channel.listTransactions(100, periodKey)
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

    return {
      summary: {
        ...summary,
        ledgerNetCents,
        monthFlowCents: computeMonthFlowCents(budget.paycheckTotalCents, ledgerNetCents)
      },
      envelopes,
      portfolioTotalCents: 0,
      quotesStale: false
    }
  }
}

export const useMoneyDoorSnapshot = (): DoorSnapshotResult<MoneyDoorSnapshot> =>
  useDoorSnapshot(window.moss?.money, { loadSnapshot: loadMoneyDoorSnapshot })
