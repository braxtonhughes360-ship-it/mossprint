import type { MoneyBudgetOverview } from '@shared/money'
import type { MoneyFlowGuidance } from '@shared/moneyFlow'
import {
  buildMoneyCockpitPresentation,
  flowStatusClass,
  rentGlanceInlineClass
} from '@shared/moneyFlow'
import { formatMoneyCents } from '@shared/money'
import { MoneyWhyTrigger } from './MoneyTrustBadge'

interface MoneyCockpitStripProps {
  budget: MoneyBudgetOverview
  summary: { monthFlowCents: number; ledgerNetCents: number }
  flowGuidance: MoneyFlowGuidance | null
  advancedToolsEnabled: boolean
}

/** Month position — one hero number; secondary figures behind a calm disclosure (V2.75a). */
export function MoneyCockpitStrip({
  budget,
  summary,
  flowGuidance,
  advancedToolsEnabled
}: MoneyCockpitStripProps): React.JSX.Element {
  const presentation = buildMoneyCockpitPresentation({
    budget,
    monthFlowCents: summary.monthFlowCents,
    ledgerNetCents: summary.ledgerNetCents,
    guidance: flowGuidance
  })
  const { metrics, relationshipLine, detailsSummary } = presentation

  const assignedPct = metrics.assignedPct

  const spendCents = flowGuidance?.safeToSpend.cents ?? budget.unassignedCents
  const assignCents = flowGuidance?.safeToAssign.cents ?? budget.unassignedCents
  const spendWhy = flowGuidance?.safeToSpend.why

  const budgetEmpty = budget.paycheckTotalCents === 0 && budget.assignedTotalCents === 0
  const assignLabel =
    assignCents < 0
      ? `${formatMoneyCents(Math.abs(assignCents))} over-assigned`
      : assignCents === 0
        ? budgetEmpty
          ? 'Nothing to assign yet'
          : 'Fully assigned'
        : `${formatMoneyCents(assignCents)} to assign`

  return (
    <section className="money-flow-instrument" aria-label="Month position">
      <div className="money-flow-instrument-head">
        <div className="money-flow-instrument-hero">
          <div className="money-flow-instrument-hero-row">
            {spendWhy ? (
              <MoneyWhyTrigger why={spendWhy} className="money-flow-instrument-hero-value money-mono">
                {formatMoneyCents(spendCents)}
              </MoneyWhyTrigger>
            ) : (
              <span className="money-flow-instrument-hero-value money-mono">
                {formatMoneyCents(spendCents)}
              </span>
            )}
            {flowGuidance && (
              <span
                className={[
                  'money-flow-status',
                  flowStatusClass(flowGuidance.status),
                  'money-mono'
                ].join(' ')}
              >
                {flowGuidance.statusLabel}
              </span>
            )}
          </div>
          {spendWhy ? (
            <MoneyWhyTrigger why={spendWhy} className="money-flow-instrument-hero-label">
              Safe to spend
            </MoneyWhyTrigger>
          ) : (
            <span className="money-flow-instrument-hero-label">Safe to spend</span>
          )}
        </div>

        <p className="money-flow-instrument-assign-line money-mono">{assignLabel}</p>

        <p className="money-flow-instrument-relationship">{relationshipLine}</p>

        <div className="money-flow-instrument-subline money-mono">
          <span>
            {budget.paycheckTotalCents > 0
              ? `${formatMoneyCents(budget.paycheckTotalCents)} income`
              : 'No income logged this month'}
          </span>
          {flowGuidance?.rentGlance.configured && (
            <>
              <span className="money-flow-instrument-sep" aria-hidden>
                ·
              </span>
              <span className={rentGlanceInlineClass(flowGuidance.rentGlance)}>
                {flowGuidance.rentGlance.pillLabel}
              </span>
            </>
          )}
          {flowGuidance?.overspendRisk.atRisk && (
            <>
              <span className="money-flow-instrument-sep" aria-hidden>
                ·
              </span>
              <span className="money-flow-instrument-pressure">
                {flowGuidance.overspendRisk.envelopes
                  .slice(0, 2)
                  .map((e) => e.name)
                  .join(', ')}
                {flowGuidance.overspendRisk.envelopes.length > 2
                  ? ` +${flowGuidance.overspendRisk.envelopes.length - 2}`
                  : ''}{' '}
                at risk
              </span>
            </>
          )}
        </div>
      </div>

      <div className="money-flow-instrument-track" aria-hidden>
        <span className="money-flow-instrument-fill" style={{ width: `${assignedPct}%` }} />
      </div>

      <details className="money-flow-instrument-details">
        <summary className="money-flow-instrument-details-summary">
          <span className="money-flow-instrument-details-label">Month details</span>
          <span className="money-flow-instrument-details-hint money-mono">{detailsSummary}</span>
        </summary>
        <dl className="money-flow-instrument-details-grid money-mono">
          <div className="money-flow-instrument-details-row">
            <dt>Month flow</dt>
            <dd
              className={
                metrics.monthFlowCents >= 0 ? 'money-flow-instrument-details-value--in' : undefined
              }
            >
              {formatMoneyCents(metrics.monthFlowCents)}
            </dd>
          </div>
          <div className="money-flow-instrument-details-row">
            <dt>Spent</dt>
            <dd>{formatMoneyCents(metrics.spentTotalCents)}</dd>
          </div>
          {metrics.retentionPct !== null && (
            <div className="money-flow-instrument-details-row">
              <dt>Retained</dt>
              <dd>{metrics.retentionPct}%</dd>
            </div>
          )}
          {advancedToolsEnabled && (
            <div className="money-flow-instrument-details-row">
              <dt>Ledger net</dt>
              <dd>{formatMoneyCents(metrics.ledgerNetCents)}</dd>
            </div>
          )}
          <div className="money-flow-instrument-details-row">
            <dt>Assigned</dt>
            <dd>{assignedPct}%</dd>
          </div>
        </dl>
      </details>
    </section>
  )
}
