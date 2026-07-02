import { useMemo, useRef, useState } from 'react'
import type { MoneyFlowGuidance, MoneyFlowSettings } from '@shared/moneyFlow'
import { checkAffordability, rentGlancePillClass } from '@shared/moneyFlow'
import { dateKey, formatMoneyCents, parseMoneyInput } from '@shared/money'
import { MossModal } from './MossModal'

interface MoneyFlowPanelProps {
  guidance: MoneyFlowGuidance
  settings: MoneyFlowSettings
  advancedToolsEnabled?: boolean
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
  /** Deep-link the "unfiled spending" drift row to the ledger's unfiled filter. */
  onFindUnfiled?: () => void
}

function formatTimelineDate(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(year, month - 1, date)
  )
}

interface VariablePayBlockProps {
  guidance: MoneyFlowGuidance
  settings: MoneyFlowSettings
  busy: boolean
  expectedLabel: string
  expectedAmount: string
  expectedDate: string
  holdInput: string
  onExpectedLabel: (value: string) => void
  onExpectedAmount: (value: string) => void
  onExpectedDate: (value: string) => void
  onHoldInput: (value: string) => void
  onSaveHold: (raw: string) => void
  onMutate: MoneyFlowPanelProps['onMutate']
}

function VariablePayBlock({
  guidance,
  settings,
  busy,
  expectedLabel,
  expectedAmount,
  expectedDate,
  holdInput,
  onExpectedLabel,
  onExpectedAmount,
  onExpectedDate,
  onHoldInput,
  onSaveHold,
  onMutate
}: VariablePayBlockProps): React.JSX.Element {
  const variablePay = guidance.irregular.variablePay ?? {
    detected: false,
    why: '',
    spreadCents: 0
  }

  return (
    <section className="money-flow-variable" aria-label="Variable paychecks">
      <h3 className="money-flow-tool-title">Variable paychecks</h3>
      <p className="money-flow-tool-hint">
        {variablePay.why || 'Add expected paychecks so Coming up stays honest.'}
      </p>
      {guidance.irregular.lowestPaycheckCents > 0 && (
        <p className="money-flow-tool-note">{guidance.irregular.lowestPaycheckWhy}</p>
      )}

      {guidance.irregular.expectedPaychecks.length > 0 && (
        <ul className="money-flow-expected-list">
          {guidance.irregular.expectedPaychecks.map((expected) => (
            <li key={expected.id} className="money-flow-expected-row">
              <span className="money-mono">{formatTimelineDate(expected.expectedDate)}</span>
              <span>{expected.label}</span>
              <span className="money-mono">{formatMoneyCents(expected.amountCents)}</span>
              <button
                type="button"
                className="money-button money-button--ghost money-button--compact"
                aria-label={`Remove ${expected.label}`}
                disabled={busy}
                onClick={() => {
                  void onMutate(async () => {
                    await window.moss.money.deleteExpectedPaycheck?.(expected.id)
                  })
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="money-flow-expected-form"
        onSubmit={(event) => {
          event.preventDefault()
          const cents = parseMoneyInput(expectedAmount)
          if (!expectedLabel.trim() || cents === null || cents <= 0) return
          void onMutate(async () => {
            await window.moss.money.createExpectedPaycheck?.({
              label: expectedLabel.trim(),
              amountCents: cents,
              expectedDate
            })
            onExpectedAmount('')
          })
        }}
      >
        <label className="money-flow-mini-field">
          <span className="money-flow-mini-label">Name</span>
          <input
            className="money-input money-input--inline"
            value={expectedLabel}
            onChange={(event) => onExpectedLabel(event.target.value)}
            placeholder="Paycheck"
            aria-label="Expected paycheck name"
          />
        </label>
        <label className="money-flow-mini-field">
          <span className="money-flow-mini-label">Amount</span>
          <input
            className="money-input money-input--inline"
            value={expectedAmount}
            onChange={(event) => onExpectedAmount(event.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Expected paycheck amount"
          />
        </label>
        <label className="money-flow-mini-field">
          <span className="money-flow-mini-label">Date</span>
          <input
            className="money-input money-input--inline"
            type="date"
            value={expectedDate}
            onChange={(event) => onExpectedDate(event.target.value)}
            aria-label="Expected pay date"
          />
        </label>
        <button type="submit" className="money-button money-button--compact" disabled={busy}>
          Add
        </button>
      </form>

      <div className="money-flow-variable-options">
        <label className="money-flow-mini-field money-flow-mini-field--grow">
          <span className="money-flow-mini-label">Set aside for next month</span>
          <input
            className="money-input money-input--inline"
            value={holdInput}
            onChange={(event) => onHoldInput(event.target.value)}
            onBlur={() => onSaveHold(holdInput)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Amount to set aside for next month"
            disabled={busy}
          />
        </label>
        <label className="money-flow-checkbox">
          <input
            type="checkbox"
            checked={settings.useLowestPaycheckBaseline}
            onChange={(event) => {
              void onMutate(async () => {
                await window.moss.money.setFlowSettings?.({
                  holdBufferCents: settings.holdBufferCents,
                  useLowestPaycheckBaseline: event.target.checked
                })
              })
            }}
            disabled={busy}
          />
          <span>Plan using my smallest paycheck</span>
        </label>
      </div>
    </section>
  )
}

export function MoneyFlowPanel({
  guidance,
  settings,
  advancedToolsEnabled = false,
  busy,
  onMutate,
  onFindUnfiled
}: MoneyFlowPanelProps): React.JSX.Element {
  const [affordInput, setAffordInput] = useState('')
  const [expectedLabel, setExpectedLabel] = useState('Paycheck')
  const [expectedAmount, setExpectedAmount] = useState('')
  const [expectedDate, setExpectedDate] = useState(dateKey())
  const [holdInput, setHoldInput] = useState(
    settings.holdBufferCents > 0 ? String(settings.holdBufferCents / 100) : ''
  )
  const [toolsOpen, setToolsOpen] = useState(false)
  const toolsTriggerRef = useRef<HTMLButtonElement>(null)

  function closeTools(): void {
    setToolsOpen(false)
    toolsTriggerRef.current?.focus()
  }

  const affordResult = useMemo(() => {
    const cents = parseMoneyInput(affordInput)
    if (cents === null || cents <= 0) return null
    return checkAffordability(guidance, cents)
  }, [affordInput, guidance])

  const upcomingTimeline = guidance.timeline.filter((e) => e.date >= dateKey()).slice(0, 6)
  const variablePay = guidance.irregular.variablePay ?? { detected: false, why: '', spreadCents: 0 }
  const showVariablePayInline =
    advancedToolsEnabled &&
    (variablePay.detected ||
      settings.holdBufferCents > 0 ||
      settings.useLowestPaycheckBaseline)

  function saveHoldBuffer(raw: string): void {
    const cents = parseMoneyInput(raw)
    void onMutate(async () => {
      await window.moss.money.setFlowSettings?.({
        holdBufferCents: cents ?? 0,
        useLowestPaycheckBaseline: settings.useLowestPaycheckBaseline
      })
    })
  }

  const variablePayProps: VariablePayBlockProps = {
    guidance,
    settings,
    busy,
    expectedLabel,
    expectedAmount,
    expectedDate,
    holdInput,
    onExpectedLabel: setExpectedLabel,
    onExpectedAmount: setExpectedAmount,
    onExpectedDate: setExpectedDate,
    onHoldInput: setHoldInput,
    onSaveHold: saveHoldBuffer,
    onMutate
  }

  return (
    <section className="money-instrument-panel money-flow-panel" aria-label="Month flow">
      {guidance.rentGlance.configured && (
        <header className="money-flow-panel-head">
          <div className="money-flow-panel-glance">
            <div className="money-flow-panel-glance-row">
              <span
                className={[
                  'money-flow-rent-pill',
                  rentGlancePillClass(guidance.rentGlance),
                  'money-mono'
                ].join(' ')}
              >
                {guidance.rentGlance.pillLabel}
              </span>
              {!guidance.rentGlance.covered && (
                <span className="money-flow-rent-detail">{guidance.rentGlance.why}</span>
              )}
            </div>
          </div>
        </header>
      )}

      <div className="money-flow-timeline-block">
        <p className="money-flow-section-label">Coming up</p>
        {upcomingTimeline.length === 0 ? (
          <p className="money-flow-empty-note">No pay or bills on the calendar yet.</p>
        ) : (
          <ul className="money-flow-timeline money-flow-timeline--compact">
            {upcomingTimeline.map((event) => (
              <li key={event.id} className="money-flow-timeline-row money-flow-timeline-row--compact">
                <span className="money-flow-timeline-date money-mono">{formatTimelineDate(event.date)}</span>
                <span className="money-flow-timeline-label">{event.label}</span>
                <span
                  className={[
                    'money-flow-timeline-amount money-mono',
                    event.amountCents >= 0
                      ? 'money-flow-timeline-amount--in'
                      : 'money-flow-timeline-amount--out'
                  ].join(' ')}
                >
                  {formatMoneyCents(event.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showVariablePayInline && <VariablePayBlock {...variablePayProps} />}

      {guidance.overspendRisk.atRisk && (
        <div className="money-flow-alert money-flow-alert--warn" role="status">
          <p className="money-flow-alert-copy">{guidance.overspendRisk.why}</p>
          <ul className="money-flow-pressure-list">
            {(guidance.overspendRisk.envelopes ?? []).map((envelope) => (
              <li key={envelope.categoryId} className="money-flow-pressure-row">
                <span className="money-flow-pressure-name">{envelope.name}</span>
                <span className="money-flow-pressure-detail">{envelope.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {guidance.drift.flagged && (
        <div className="money-flow-alert money-flow-alert--drift" role="status">
          <ul className="money-flow-drift-list">
            {(guidance.drift.items ?? []).map((item) => {
              const isUnfiled = item.label === 'Unfiled spending'
              const content = (
                <>
                  <span className="money-flow-drift-label">{item.label}</span>
                  <span className="money-flow-drift-copy">{item.why}</span>
                  {isUnfiled && onFindUnfiled && (
                    <span className="money-flow-drift-cta" aria-hidden>
                      Find these →
                    </span>
                  )}
                </>
              )
              if (isUnfiled && onFindUnfiled) {
                return (
                  <li key={item.label}>
                    <button
                      type="button"
                      className="money-flow-drift-row money-flow-drift-row--action"
                      onClick={onFindUnfiled}
                    >
                      {content}
                    </button>
                  </li>
                )
              }
              return (
                <li key={item.label} className="money-flow-drift-row">
                  {content}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="money-flow-tools">
        <button
          ref={toolsTriggerRef}
          type="button"
          className="money-button money-button--ghost money-button--compact money-flow-tools-trigger"
          aria-haspopup="dialog"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen(true)}
        >
          Tools
        </button>
      </div>

      {toolsOpen && (
        <MossModal
          onClose={closeTools}
          backdropClassName="calendar-event-modal-backdrop"
          panelClassName="money-flow-tools-modal"
          ariaLabelledBy="money-flow-tools-title"
        >
          <h2 id="money-flow-tools-title" className="calendar-event-modal-title">
            Tools
          </h2>
          <div className="money-flow-tools-body">
              <section className="money-flow-tool" aria-label="Budget breakdown">
                <h3 className="money-flow-tool-title">Where your money is</h3>
                <ul className="money-flow-breakdown">
                  <li>
                    <span className="money-flow-breakdown-label">Still to assign</span>
                    <span className="money-flow-breakdown-value money-mono">
                      {formatMoneyCents(guidance.safeToAssign.cents)}
                    </span>
                    <span className="money-flow-breakdown-note">{guidance.safeToAssign.why}</span>
                  </li>
                  <li>
                    <span className="money-flow-breakdown-label">Free to spend</span>
                    <span className="money-flow-breakdown-value money-mono">
                      {formatMoneyCents(guidance.safeToSpend.cents)}
                    </span>
                    <span className="money-flow-breakdown-note">{guidance.safeToSpend.why}</span>
                  </li>
                  {guidance.irregular.safeToSave.cents > 0 && (
                    <li>
                      <span className="money-flow-breakdown-label">Safe to save</span>
                      <span className="money-flow-breakdown-value money-mono">
                        {formatMoneyCents(guidance.irregular.safeToSave.cents)}
                      </span>
                      <span className="money-flow-breakdown-note">{guidance.irregular.safeToSave.why}</span>
                    </li>
                  )}
                </ul>
              </section>

              <section className="money-flow-tool" aria-label="Purchase check">
                <h3 className="money-flow-tool-title">Can I buy it?</h3>
                <p className="money-flow-tool-hint">Type a price to see if it fits what you have left.</p>
                <div className="money-flow-afford-row">
                  <span className="money-flow-afford-prefix money-mono">$</span>
                  <input
                    className="money-input money-input--inline money-flow-afford-input"
                    value={affordInput}
                    onChange={(event) => setAffordInput(event.target.value)}
                    placeholder="0.00"
                    inputMode="decimal"
                    aria-label="Purchase amount to check"
                  />
                </div>
                {affordResult && (
                  <p
                    className={[
                      'money-flow-afford-result money-mono',
                      affordResult.affordable ? 'money-flow-afford-result--yes' : 'money-flow-afford-result--no'
                    ].join(' ')}
                    role="status"
                  >
                    {affordResult.why}
                  </p>
                )}
              </section>

              {advancedToolsEnabled && !showVariablePayInline && (
                <VariablePayBlock {...variablePayProps} />
              )}
            </div>
            <div className="calendar-event-modal-actions">
              <button
                type="button"
                className="money-button money-button--compact"
                onClick={closeTools}
              >
                Done
              </button>
            </div>
        </MossModal>
      )}
    </section>
  )
}
