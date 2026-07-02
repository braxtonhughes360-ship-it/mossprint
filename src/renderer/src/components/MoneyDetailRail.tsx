import type { MoneyBudgetOverview, TransactionRecord } from '@shared/money'
import { formatMoneyCents, formatPeriodLabel } from '@shared/money'
import { MoneyAllocationBar } from './MoneyAllocationBar'
import { MoneyTrustBadge, MoneyWhyTrigger } from './MoneyTrustBadge'

interface MoneyDetailRailProps {
  budget: MoneyBudgetOverview
  summary: { monthFlowCents: number; ledgerNetCents: number }
  transactions: TransactionRecord[]
  portfolioTotalCents?: number
  quotesStale?: boolean
}

const ALLOCATION_HUES = [32, 58, 92, 128, 168, 200, 235, 280, 310, 345]

function formatTapeDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso))
}

/** Detail-only ledger rail — not a dashboard card clone. */
export function MoneyDetailRail({
  budget,
  summary,
  transactions,
  portfolioTotalCents = 0,
  quotesStale = false
}: MoneyDetailRailProps): React.JSX.Element {
  const income = Math.max(budget.paycheckTotalCents, 1)
  const assignedRows = budget.categories
    .filter((row) => row.assignedCents > 0)
    .sort((a, b) => b.assignedCents - a.assignedCents)
  const topRows = assignedRows.slice(0, 6)
  const topAssignedCents = topRows.reduce((sum, row) => sum + row.assignedCents, 0)
  const otherAssignedCents = Math.max(0, budget.assignedTotalCents - topAssignedCents)
  const allocationSegments: Array<{ id: string; name: string; assignedCents: number }> = [
    ...topRows.map((row) => ({
      id: row.category.id,
      name: row.category.name,
      assignedCents: row.assignedCents
    })),
    ...(otherAssignedCents > 0
      ? [{ id: '__other__', name: 'Other envelopes', assignedCents: otherAssignedCents }]
      : [])
  ]
  const retentionPct = Math.round(Math.max(0, Math.min(100, (summary.monthFlowCents / income) * 100)))
  const ringDegrees = Math.round((retentionPct / 100) * 360)
  const recentTxns = transactions.slice(0, 5)

  return (
    <aside className="money-detail-rail" aria-label="Money ledger">
      <div className="money-detail-rail-ticks" aria-hidden />
      <div className="money-detail-rail-inner">
        <header className="money-detail-rail-head">
          <p className="money-detail-rail-kicker">Ledger</p>
          <h2 className="money-detail-rail-title">{formatPeriodLabel(budget.periodKey)}</h2>
        </header>

        {budget.paycheckTotalCents > 0 ? (
          <div className="money-detail-rail-ring-block">
            <div
              className="money-detail-rail-ring"
              style={{
                background: `conic-gradient(
                  oklch(from var(--moss-accent) l c h) 0deg ${ringDegrees}deg,
                  oklch(from var(--moss-border) l c h / 0.55) ${ringDegrees}deg 360deg
                )`
              }}
              aria-hidden
            >
              <div className="money-detail-rail-ring-core">
                <span className="money-detail-rail-ring-label">Retained</span>
                <span className="money-detail-rail-ring-value money-mono">{retentionPct}%</span>
              </div>
            </div>
            <p className="money-detail-rail-ring-caption">
              <MoneyWhyTrigger
                why={`Month flow from logged paychecks and ledger activity for ${formatPeriodLabel(budget.periodKey)}.`}
              >
                Kept {formatMoneyCents(summary.monthFlowCents)} of{' '}
                {formatMoneyCents(budget.paycheckTotalCents)} so far
              </MoneyWhyTrigger>
            </p>
          </div>
        ) : (
          <p className="money-detail-rail-ring-caption">
            Log a paycheck to see how much of it you keep.
          </p>
        )}

        {portfolioTotalCents > 0 && (
          <section className="money-detail-rail-section" aria-label="Portfolio">
            <p className="money-detail-rail-section-label">Portfolio</p>
            <p className="money-portfolio-total money-mono">
              <MoneyWhyTrigger why="Portfolio total from holdings and the latest quotes you refreshed.">
                {formatMoneyCents(portfolioTotalCents)}
              </MoneyWhyTrigger>
            </p>
            {quotesStale && (
              <p className="money-detail-rail-ring-caption">
                <MoneyTrustBadge
                  kind="stale"
                  why="Market quotes are older than your stale threshold — refresh in Settings or Investments."
                />
              </p>
            )}
          </section>
        )}

        {allocationSegments.length > 0 && budget.assignedTotalCents > 0 && (
          <section className="money-detail-rail-section" aria-label="Envelope allocation">
            <p className="money-detail-rail-section-label">Allocation</p>
            <MoneyAllocationBar
              className="money-portfolio-allocation money-detail-rail-allocation"
              ariaLabel="Envelope allocation — hover or focus a band for its share"
              segments={allocationSegments.map((row, index) => {
                const isOther = row.id === '__other__'
                const hue = isOther ? 145 : ALLOCATION_HUES[index % ALLOCATION_HUES.length]
                const chroma = isOther ? 0.04 : 0.14
                const light = isOther ? 0.72 : 0.64
                const percent = Math.round((row.assignedCents / budget.assignedTotalCents) * 100)
                return {
                  id: row.id,
                  name: row.name,
                  percent,
                  valueLabel: formatMoneyCents(row.assignedCents),
                  color: `oklch(${light} ${chroma} ${hue})`
                }
              })}
            />
          </section>
        )}

        <section className="money-detail-rail-section" aria-label="Recent ledger entries">
          <p className="money-detail-rail-section-label">Recent entries</p>
          {recentTxns.length === 0 ? (
            <p className="money-detail-rail-tape-empty">No entries this month.</p>
          ) : (
            <ul className="money-detail-rail-tape">
              {recentTxns.map((txn) => (
                <li key={txn.id} className="money-detail-rail-tape-row">
                  <span className="money-detail-rail-tape-date money-mono">
                    {formatTapeDate(txn.occurredAt)}
                  </span>
                  <div className="money-detail-rail-tape-main">
                    <span className="money-detail-rail-tape-memo">{txn.memo || 'Entry'}</span>
                    <span
                      className={[
                        'money-detail-rail-tape-amount',
                        'money-mono',
                        txn.amountCents >= 0
                          ? 'money-detail-rail-tape-amount--in'
                          : 'money-detail-rail-tape-amount--out'
                      ].join(' ')}
                    >
                      {formatMoneyCents(txn.amountCents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  )
}
