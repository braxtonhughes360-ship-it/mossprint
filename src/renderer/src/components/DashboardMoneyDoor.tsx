import { memo } from 'react'
import { m } from 'motion/react'
import { Link } from 'react-router-dom'
import { formatMoneyCents } from '@shared/money'
import type { MoneyDoorSnapshot } from '@shared/money'
import { flowStatusClass } from '@shared/moneyFlow'
import { MODULE_VISUAL } from '@shared/modules'
import type { NavItem } from '@shared/types'
import { CountUp } from './CountUp'
import { MoneyWhyTrigger } from './MoneyTrustBadge'
import { mossDoorVariants } from '../lib/mossMotion'

interface DashboardMoneyDoorProps {
  item: NavItem
  snapshot: MoneyDoorSnapshot | null
  motionIndex?: number
  entranceEnabled?: boolean
}

/** Glance-density door — fixed height, envelope strip capped at top 3. */
export const DashboardMoneyDoor = memo(function DashboardMoneyDoor({
  item,
  snapshot,
  motionIndex = 1,
  entranceEnabled = false
}: DashboardMoneyDoorProps): React.JSX.Element {
  const visual = MODULE_VISUAL.money
  const summary = snapshot?.summary
  const portfolioTotal = snapshot?.portfolioTotalCents ?? 0
  const envelopes = (snapshot?.envelopes ?? []).slice(0, 3)
  const showGlance =
    summary &&
    (summary.hasData || portfolioTotal > 0 || envelopes.length > 0)

  const unassigned = summary?.unassignedCents ?? 0
  const budgetEmpty =
    (summary?.paycheckTotalCents ?? 0) === 0 && (summary?.assignedTotalCents ?? 0) === 0
  const assignLabel =
    unassigned < 0
      ? `${formatMoneyCents(Math.abs(unassigned))} over-assigned`
      : unassigned === 0
        ? budgetEmpty
          ? 'Nothing to assign yet'
          : 'Fully assigned'
        : `${formatMoneyCents(unassigned)} to assign`

  const safeToSpendWhy = snapshot?.safeToSpendWhy

  const door = (
    <Link
      to={item.path}
      className="dashboard-money-door module-door module-door--accent module-door-money"
      data-module="money"
      data-texture={visual.texture}
      aria-label="Financials module"
    >
      <span className="dashboard-money-door-sigil moss-money-sigil-fill" aria-hidden />
      <span className="dashboard-money-door-ambient" aria-hidden />

      <div className="module-door-body dashboard-money-door-body">
        <div className="module-door-head">
          <span className="module-door-kicker">{visual.tag}</span>
          <span className="module-door-name">{item.label}</span>
        </div>

        {!showGlance || !summary ? (
          <p className="dashboard-money-door-empty-copy">
            Add a paycheck or ledger entry to see position here.
          </p>
        ) : (
          <div className="dashboard-money-door-glance">
            {summary.hasData || summary.unassignedCents > 0 || summary.paycheckTotalCents > 0 ? (
              <>
                <div className="dashboard-money-door-glance-primary">
                  <div className="dashboard-money-door-headline-row">
                    {safeToSpendWhy ? (
                      <MoneyWhyTrigger why={safeToSpendWhy}>
                        <CountUp
                          className="dashboard-money-door-glance-value money-mono"
                          value={snapshot?.safeToSpendCents ?? summary.unassignedCents}
                          format={formatMoneyCents}
                        />
                      </MoneyWhyTrigger>
                    ) : (
                      <CountUp
                        className="dashboard-money-door-glance-value money-mono"
                        value={snapshot?.safeToSpendCents ?? summary.unassignedCents}
                        format={formatMoneyCents}
                      />
                    )}
                    {snapshot?.flowStatusLabel && (
                      <span
                        className={[
                          'money-flow-status',
                          flowStatusClass(snapshot.flowStatus ?? 'on_track'),
                          'money-mono',
                          'dashboard-money-door-status'
                        ].join(' ')}
                      >
                        {snapshot.flowStatusLabel}
                      </span>
                    )}
                  </div>
                  {safeToSpendWhy ? (
                    <MoneyWhyTrigger
                      why={safeToSpendWhy}
                      className="dashboard-money-door-glance-label"
                    >
                      Safe to spend
                    </MoneyWhyTrigger>
                  ) : (
                    <span className="dashboard-money-door-glance-label">Safe to spend</span>
                  )}
                </div>

                {envelopes.length > 0 && (
                  <div
                    className="dashboard-money-door-envelope-strip"
                    aria-label="Top envelopes, assigned versus spent"
                  >
                    {envelopes.map((envelope) => {
                      const spentFraction =
                        envelope.assignedCents > 0
                          ? Math.min(1, Math.max(0, envelope.spentCents / envelope.assignedCents))
                          : 0
                      const over = envelope.remainingCents < 0
                      return (
                        <div
                          key={envelope.categoryId}
                          className="dashboard-money-door-glance-envelope"
                          title={`${envelope.name}: ${formatMoneyCents(envelope.spentCents)} of ${formatMoneyCents(envelope.assignedCents)} spent`}
                        >
                          <div className="dashboard-money-door-envelope-head">
                            <span className="dashboard-money-door-envelope-name">
                              {envelope.name}
                            </span>
                            <span className="dashboard-money-door-envelope-left money-mono">
                              <CountUp value={envelope.remainingCents} format={formatMoneyCents} />{' '}
                              left
                            </span>
                          </div>
                          <span className="dashboard-money-door-envelope-bar" aria-hidden>
                            <span
                              className={[
                                'dashboard-money-door-envelope-fill',
                                over ? 'dashboard-money-door-envelope-fill--over' : ''
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              style={{ transform: `scaleX(${over ? 1 : spentFraction})` }}
                            />
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="dashboard-money-door-footer money-mono">
                  <span className="dashboard-money-door-assign">{assignLabel}</span>
                </div>
              </>
            ) : portfolioTotal > 0 ? (
              <div className="dashboard-money-door-glance-primary">
                <CountUp
                  className="dashboard-money-door-glance-value money-mono"
                  value={portfolioTotal}
                  format={formatMoneyCents}
                />
                <span className="dashboard-money-door-glance-label">Portfolio</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Link>
  )

  if (!entranceEnabled) {
    return <div className="module-door-wrap">{door}</div>
  }

  return (
    <m.div
      className="module-door-wrap"
      custom={motionIndex}
      initial="hidden"
      animate="visible"
      variants={mossDoorVariants}
    >
      {door}
    </m.div>
  )
})
