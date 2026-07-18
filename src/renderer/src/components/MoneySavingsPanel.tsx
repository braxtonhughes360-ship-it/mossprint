import { useEffect, useState } from 'react'
import type { SavingsOverview } from '@shared/moneySavings'
import {
  SAVINGS_GOAL_TEMPLATES,
  buildProjectFundingLine,
  buildSavingsPeriodLine,
  formatTargetDate,
  savingsAssignChipLabel,
  savingsGoalHeadlineHint,
  savingsKindLabel,
  savingsMaxAssignableCents,
  savingsOverAssignMessage
} from '@shared/moneySavings'
import { DEFAULT_MONEY_TRUST_SETTINGS } from '@shared/moneyTrust'
import { dateKey, formatMoneyCents, parseMoneyInput } from '@shared/money'
import { MossModal } from './MossModal'
import type { MoneyMutateFn } from '../moneyMutate'
import { MossButton } from './MossButton'
import { MossDateField } from './MossDateField'

interface MoneySavingsPanelProps {
  overview: SavingsOverview
  busy: boolean
  /** Unspent in spending envelopes — month wrap-up can sweep this (0 when card hidden). */
  envelopeSweepCents?: number
  actionError?: string | null
  onOpenLedgerForCategory?: (categoryId: string) => void
  onMutate: MoneyMutateFn
}

function formatActivityDate(iso: string): string {
  const day = iso.slice(0, 10)
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(year, month - 1, date)
  )
}

export function MoneySavingsPanel({
  overview,
  busy,
  envelopeSweepCents = 0,
  actionError = null,
  onOpenLedgerForCategory,
  onMutate
}: MoneySavingsPanelProps): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)
  const [templateKind, setTemplateKind] = useState(SAVINGS_GOAL_TEMPLATES[0].kind)
  const [goalName, setGoalName] = useState(SAVINGS_GOAL_TEMPLATES[0].name)
  const [targetAmount, setTargetAmount] = useState(
    String(SAVINGS_GOAL_TEMPLATES[0].defaultTargetCents / 100)
  )
  const [targetDate, setTargetDate] = useState('')

  useEffect(() => {
    void window.moss?.money?.getTrustSettings?.().then((settings) => {
      const kind = settings?.defaultSavingsGoalKind ?? DEFAULT_MONEY_TRUST_SETTINGS.defaultSavingsGoalKind
      const template = SAVINGS_GOAL_TEMPLATES.find((item) => item.kind === kind)
      if (!template) return
      setTemplateKind(template.kind)
      setGoalName(template.name)
      setTargetAmount(String(template.defaultTargetCents / 100))
    })
  }, [])

  function selectTemplate(kind: typeof templateKind): void {
    const template = SAVINGS_GOAL_TEMPLATES.find((item) => item.kind === kind)
    if (!template) return
    setTemplateKind(kind)
    setGoalName(template.name)
    setTargetAmount(String(template.defaultTargetCents / 100))
  }

  async function handleCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const targetCents = parseMoneyInput(targetAmount)
    if (targetCents == null || targetCents <= 0) return
    const name = goalName.trim()
    if (!name) return

    await onMutate(async () => {
      await window.moss.money.createSavingsGoal({
        name,
        targetCents,
        targetDate: targetDate.trim() || null,
        kind: templateKind
      })
    })
    setCreateOpen(false)
    setTargetDate('')
  }

  if (!overview.hasGoals) {
    return (
      <section className="money-instrument-panel money-savings-panel money-savings-panel--empty">
        <p className="money-instrument-kicker">Savings</p>
        <h2 className="money-savings-headline">Start a savings goal</h2>
        <p className="money-savings-copy">
          Put money aside for emergencies, a cushion, or something you are planning — separate from
          rent and groceries. Progress shows up here as you assign from money that is ready to go.
        </p>
        <MossButton
          type="button"
          disabled={busy}
          onClick={() => setCreateOpen(true)}
        >
          Create your first goal
        </MossButton>

        {createOpen && (
          <SavingsGoalModal
            templateKind={templateKind}
            goalName={goalName}
            targetAmount={targetAmount}
            targetDate={targetDate}
            busy={busy}
            onTemplateSelect={selectTemplate}
            onGoalNameChange={setGoalName}
            onTargetAmountChange={setTargetAmount}
            onTargetDateChange={setTargetDate}
            onClose={() => setCreateOpen(false)}
            onSubmit={(event) => void handleCreate(event)}
          />
        )}
      </section>
    )
  }

  return (
    <section className="money-instrument-panel money-savings-panel" aria-label="Savings goals">
      <div className="money-savings-panel-head">
        <div>
          <p className="money-instrument-kicker">Savings</p>
          <p className="money-savings-summary money-mono">
            {formatMoneyCents(overview.totalSavedCents)} saved
            {overview.totalTargetCents > 0 && (
              <>
                {' '}
                <span className="money-savings-summary-of">of</span>{' '}
                {formatMoneyCents(overview.totalTargetCents)} goal total
              </>
            )}
          </p>
        </div>
        <MossButton
          type="button"
          variant="quiet"
          size="sm"
          disabled={busy}
          onClick={() => setCreateOpen(true)}
        >
          Add goal
        </MossButton>
      </div>

      {overview.safeToSaveCents > 0 && (
        <p className="money-savings-safe">
          <span className="money-mono">{formatMoneyCents(overview.safeToSaveCents)}</span> from this
          month&apos;s pay not yet assigned
          <span className="money-savings-safe-note"> — bills and essentials first</span>
        </p>
      )}
      {overview.unassignedCents > 0 && (
        <p className="money-savings-pool">
          <span className="money-mono">{formatMoneyCents(overview.unassignedCents)}</span> ready to
          assign
          <span className="money-savings-safe-note"> — moves from the pool, not from groceries or rent</span>
        </p>
      )}

      {actionError && (
        <p className="money-savings-panel-error" role="alert">
          {actionError}
        </p>
      )}

      <ul className="money-savings-list">
        {overview.goals.map((row) => (
          <SavingsGoalCard
            key={row.goal.id}
            row={row}
            periodKey={overview.periodKey}
            unassignedCents={overview.unassignedCents}
            envelopeSweepCents={envelopeSweepCents}
            busy={busy}
            onOpenLedgerForCategory={onOpenLedgerForCategory}
            onMutate={onMutate}
          />
        ))}
      </ul>

      {createOpen && (
        <SavingsGoalModal
          templateKind={templateKind}
          goalName={goalName}
          targetAmount={targetAmount}
          targetDate={targetDate}
          busy={busy}
          onTemplateSelect={selectTemplate}
          onGoalNameChange={setGoalName}
          onTargetAmountChange={setTargetAmount}
          onTargetDateChange={setTargetDate}
          onClose={() => setCreateOpen(false)}
          onSubmit={(event) => void handleCreate(event)}
        />
      )}
    </section>
  )
}

interface SavingsGoalCardProps {
  row: SavingsOverview['goals'][number]
  periodKey: string
  unassignedCents: number
  envelopeSweepCents: number
  busy: boolean
  onOpenLedgerForCategory?: (categoryId: string) => void
  onMutate: MoneyMutateFn
}

function SavingsGoalCard({
  row,
  periodKey,
  unassignedCents,
  envelopeSweepCents,
  busy,
  onOpenLedgerForCategory,
  onMutate
}: SavingsGoalCardProps): React.JSX.Element {
  const [amountDraft, setAmountDraft] = useState('')
  const [cardError, setCardError] = useState<string | null>(null)
  const progressPercent = Math.round(row.progress * 100)
  const complete = row.progress >= 1
  const isProject = row.progressMode === 'project'
  const headlineHint = savingsGoalHeadlineHint(row.progressMode)
  const periodLine = buildSavingsPeriodLine(row.progressMode, row.spentThisPeriodCents)
  const projectFundingLine =
    isProject ? buildProjectFundingLine(row.fundedTotalCents, row.goal.targetCents) : null
  const maxAssignable = savingsMaxAssignableCents(unassignedCents)
  const paceGapCents = row.guidance.targetAssignCents
  const showPaceGap =
    paceGapCents > 0 &&
    row.guidance.suggestedAssignCents > 0 &&
    paceGapCents > row.guidance.suggestedAssignCents

  function validateAmount(cents: number): string | null {
    if (cents <= 0) return null
    if (cents > maxAssignable) {
      return savingsOverAssignMessage(unassignedCents, envelopeSweepCents)
    }
    return null
  }

  async function contribute(amountCents: number): Promise<void> {
    const validationError = validateAmount(amountCents)
    if (validationError) {
      setCardError(validationError)
      return
    }
    setCardError(null)
    await onMutate(async () => {
      await window.moss.money.contributeToSavingsGoal({
        goalId: row.goal.id,
        periodKey,
        amountCents
      })
    })
    setAmountDraft('')
  }

  function handleContribute(event: React.FormEvent): void {
    event.preventDefault()
    const cents = parseMoneyInput(amountDraft)
    if (cents == null || cents <= 0) return
    void contribute(cents)
  }

  return (
    <li className="money-savings-card">
      <div className="money-savings-card-top">
        <div>
          <p className="money-savings-card-kind">{savingsKindLabel(row.goal.kind)}</p>
          <h3 className="money-savings-card-name">{row.goal.name}</h3>
        </div>
        <div className="money-savings-card-amounts money-mono">
          <span className="money-savings-card-saved">{formatMoneyCents(row.balanceCents)}</span>
          <span className="money-savings-card-target">
            {' '}
            / {formatMoneyCents(row.goal.targetCents)}
          </span>
          <span className="money-savings-card-amounts-hint"> {headlineHint}</span>
        </div>
      </div>

      {row.assignedThisPeriodCents > 0 && !isProject && (
        <p className="money-savings-card-period money-mono">
          {formatMoneyCents(row.assignedThisPeriodCents)} assigned this month
        </p>
      )}

      <div
        className="money-savings-progress"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${row.goal.name} progress`}
      >
        <div className="money-savings-progress-track">
          <div
            className="money-savings-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
          {row.goal.milestonesCents.map((milestone) => {
            const ratio =
              row.goal.targetCents > 0 ? milestone / row.goal.targetCents : 0
            const reached = row.milestonesReached.includes(milestone)
            return (
              <span
                key={milestone}
                className={[
                  'money-savings-milestone',
                  reached ? 'money-savings-milestone--reached' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
                title={`${formatMoneyCents(milestone)}${reached ? ' — reached' : ''}`}
                aria-hidden
              />
            )
          })}
        </div>
        <p className="money-savings-progress-meta money-mono">
          {complete
            ? 'Goal reached'
            : isProject
              ? `${formatMoneyCents(row.spentTotalCents)} of ${formatMoneyCents(row.goal.targetCents)} spent`
              : `${formatMoneyCents(row.remainingCents)} to go`}
          {row.goal.targetDate && !complete && (
            <span> · by {formatTargetDate(row.goal.targetDate)}</span>
          )}
        </p>
      </div>

      {periodLine && <p className="money-savings-period-line">{periodLine}</p>}

      {projectFundingLine && (
        <p className="money-savings-project-funding money-mono">{projectFundingLine}</p>
      )}

      {(row.recentActivity.length > 0 || onOpenLedgerForCategory) && (
        <details className="money-savings-activity">
          <summary className="money-savings-activity-summary">Recent activity</summary>
          {row.recentActivity.length > 0 ? (
            <ul className="money-savings-activity-tape money-mono">
              {row.recentActivity.map((activity) => (
                <li key={activity.id} className="money-savings-activity-row">
                  <span className="money-savings-activity-date">
                    {formatActivityDate(activity.occurredAt)}
                  </span>
                  <span className="money-savings-activity-label">{activity.label}</span>
                  <span className="money-savings-activity-amount">
                    {formatMoneyCents(activity.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="money-savings-activity-empty">No expenses logged to this goal yet.</p>
          )}
        </details>
      )}

      {onOpenLedgerForCategory && (
        <button
          type="button"
          className="money-savings-ledger-link"
          onClick={() => onOpenLedgerForCategory(row.goal.categoryId)}
        >
          View all in ledger
        </button>
      )}

      {cardError && (
        <p className="money-savings-card-error" role="alert">
          {cardError}
        </p>
      )}

      {!complete && row.guidance.onTrackThisPeriod && (
        <div className="money-savings-on-track">
          <p className="money-savings-on-track-label">On track</p>
          <p className="money-savings-on-track-why">{row.guidance.onTrackWhy}</p>
        </div>
      )}

      {!complete && !row.guidance.onTrackThisPeriod && (
        <div className="money-savings-guidance">
          {row.guidance.paceLine && (
            <p className="money-savings-guidance-pace">{row.guidance.paceLine}</p>
          )}
          {row.guidance.poolLine && (
            <p className="money-savings-guidance-pool">{row.guidance.poolLine}</p>
          )}
          {showPaceGap && (
            <p className="money-savings-guidance-pace-gap">
              {formatMoneyCents(paceGapCents)} still needed this month to stay on pace
              {envelopeSweepCents > 0
                ? ` — only ${formatMoneyCents(maxAssignable)} is ready to assign; use Month wrap-up above to move up to ${formatMoneyCents(envelopeSweepCents)} from spending envelopes`
                : maxAssignable > 0
                  ? ` — you can assign up to ${formatMoneyCents(maxAssignable)} from the pool now`
                  : ''}
              .
            </p>
          )}
          {row.guidance.targetAssignCents > 0 && (
            <div className="money-savings-contribute">
              <form className="money-savings-contribute-form" onSubmit={handleContribute}>
                <label className="money-savings-contribute-label">
                  <span className="money-envelope-editor-label">Assign to goal</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="money-input money-input--assign money-mono"
                    placeholder="Amount"
                    value={amountDraft}
                    disabled={busy || !row.guidance.canContribute}
                    aria-label={`Amount to assign to ${row.goal.name}`}
                    onChange={(event) => setAmountDraft(event.target.value)}
                  />
                </label>
                <MossButton
                  type="submit"
                  size="sm"
                  disabled={busy || !row.guidance.canContribute || !amountDraft.trim()}
                >
                  Assign
                </MossButton>
              </form>
              <button
                type="button"
                className={[
                  'money-chip',
                  row.guidance.canContribute ? 'money-chip--accent' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={busy || !row.guidance.canContribute}
                title={
                  row.guidance.canContribute
                    ? undefined
                    : row.guidance.poolLine
                }
                onClick={() =>
                  void contribute(
                    row.guidance.suggestedAssignCents > 0
                      ? row.guidance.suggestedAssignCents
                      : row.guidance.targetAssignCents
                  )
                }
              >
                {savingsAssignChipLabel(row.guidance)}
              </button>
            </div>
          )}
        </div>
      )}

      {!complete && row.guidance.onTrackThisPeriod && row.guidance.canContribute && (
        <details className="money-savings-extra">
          <summary className="money-savings-extra-summary">Add extra this month</summary>
          {cardError && (
            <p className="money-savings-card-error" role="alert">
              {cardError}
            </p>
          )}
          <form className="money-savings-extra-form" onSubmit={handleContribute}>
            <input
              type="text"
              inputMode="decimal"
              className="money-input money-mono money-savings-extra-input"
              placeholder="Amount"
              value={amountDraft}
              disabled={busy}
              aria-label={`Extra amount for ${row.goal.name}`}
              onChange={(event) => setAmountDraft(event.target.value)}
            />
            <MossButton
              type="submit"
              variant="quiet"
              size="sm"
              disabled={busy || !amountDraft.trim()}
            >
              Assign
            </MossButton>
          </form>
        </details>
      )}

      <div className="money-savings-card-foot">
        <button
          type="button"
          className="money-delete-button"
          disabled={busy}
          onClick={() => {
            void onMutate(async () => {
              await window.moss.money.deleteSavingsGoal(row.goal.id)
            })
          }}
        >
          Remove goal
        </button>
      </div>
    </li>
  )
}

interface SavingsGoalModalProps {
  templateKind: (typeof SAVINGS_GOAL_TEMPLATES)[number]['kind']
  goalName: string
  targetAmount: string
  targetDate: string
  busy: boolean
  onTemplateSelect: (kind: (typeof SAVINGS_GOAL_TEMPLATES)[number]['kind']) => void
  onGoalNameChange: (value: string) => void
  onTargetAmountChange: (value: string) => void
  onTargetDateChange: (value: string) => void
  onClose: () => void
  onSubmit: (event: React.FormEvent) => void
}

function SavingsGoalModal({
  templateKind,
  goalName,
  targetAmount,
  targetDate,
  busy,
  onTemplateSelect,
  onGoalNameChange,
  onTargetAmountChange,
  onTargetDateChange,
  onClose,
  onSubmit
}: SavingsGoalModalProps): React.JSX.Element {
  const template = SAVINGS_GOAL_TEMPLATES.find((item) => item.kind === templateKind)

  return (
    <MossModal
      onClose={onClose}
      backdropClassName="calendar-event-modal-backdrop"
      ariaLabelledBy="money-new-savings-goal-title"
    >
      <form
        className="calendar-event-modal money-savings-form"
        onSubmit={onSubmit}
      >
        <h2 id="money-new-savings-goal-title" className="calendar-event-modal-title">
          New savings goal
        </h2>
        <div className="money-savings-templates" role="group" aria-label="Goal type">
          {SAVINGS_GOAL_TEMPLATES.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={[
                'money-savings-template',
                templateKind === item.kind ? 'money-savings-template--active' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onTemplateSelect(item.kind)}
            >
              {item.name}
            </button>
          ))}
        </div>

        {template && <p className="money-savings-template-copy">{template.copy}</p>}

        <label className="money-savings-field">
          <span className="money-envelope-editor-label">Goal name</span>
          <input
            type="text"
            className="money-input"
            value={goalName}
            disabled={busy}
            onChange={(event) => onGoalNameChange(event.target.value)}
          />
        </label>

        <label className="money-savings-field">
          <span className="money-envelope-editor-label">Target amount</span>
          <input
            type="text"
            inputMode="decimal"
            className="money-input money-mono"
            value={targetAmount}
            disabled={busy}
            onChange={(event) => onTargetAmountChange(event.target.value)}
          />
        </label>

        <label className="money-savings-field">
          <span className="money-envelope-editor-label">Target date (optional)</span>
          <MossDateField
            min={dateKey()}
            value={targetDate}
            disabled={busy}
            onChange={(event) => onTargetDateChange(event.target.value)}
          />
        </label>

        <div className="money-savings-form-actions">
          <MossButton type="button" variant="quiet" onClick={onClose}>
            Cancel
          </MossButton>
          <MossButton type="submit" disabled={busy}>
            Create goal
          </MossButton>
        </div>
      </form>
    </MossModal>
  )
}
