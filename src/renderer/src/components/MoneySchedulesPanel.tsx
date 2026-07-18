import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CashAccountBalance,
  CategoryBudgetRow,
  ScheduleCadence,
  ScheduleKind,
  ScheduleRecord
} from '@shared/money'
import {
  cadenceLabel,
  dateKey,
  formatMoneyCents,
  isScheduleDue,
  parseMoneyInput,
  scheduleSignedAmountCents
} from '@shared/money'
import { MossModal } from './MossModal'
import { MossSelect } from './MossSelect'
import { MossButton } from './MossButton'
import { MossDateField } from './MossDateField'

interface MoneySchedulesPanelProps {
  schedules: ScheduleRecord[]
  categories: CategoryBudgetRow[]
  accounts: CashAccountBalance[]
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

const CADENCE_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' }
]

function formatNextDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(year, month - 1, day)
  )
}

export function MoneySchedulesPanel({
  schedules,
  categories,
  accounts,
  busy,
  onMutate
}: MoneySchedulesPanelProps): React.JSX.Element {
  const [kind, setKind] = useState<ScheduleKind>('bill')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [cadence, setCadence] = useState<ScheduleCadence>('monthly')
  const [nextDate, setNextDate] = useState(() => dateKey())
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [postTarget, setPostTarget] = useState<ScheduleRecord | null>(null)
  const [postAmount, setPostAmount] = useState('')
  const [doneMessage, setDoneMessage] = useState<string | null>(null)
  const doneTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
    }
  }, [])

  const categoryNames = useMemo(
    () => new Map(categories.map((row) => [row.category.id, row.category.name])),
    [categories]
  )
  const envelopeById = useMemo(
    () => new Map(categories.map((row) => [row.category.id, row])),
    [categories]
  )

  /** How far a bill overshoots its envelope's "left" — 0 when covered or no envelope. */
  function billShortCents(schedule: ScheduleRecord, amountCents: number): number {
    if (schedule.kind !== 'bill' || !schedule.categoryId) return 0
    const envelope = envelopeById.get(schedule.categoryId)
    if (!envelope) return 0
    return Math.max(0, amountCents - envelope.remainingCents)
  }
  const accountNames = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts]
  )

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'No envelope' },
      ...categories.map((row) => ({ value: row.category.id, label: row.category.name }))
    ],
    [categories]
  )
  const accountOptions = useMemo(
    () => [
      { value: '', label: 'No account' },
      ...accounts.map((account) => ({ value: account.id, label: account.name }))
    ],
    [accounts]
  )

  const dueCount = schedules.filter((schedule) => isScheduleDue(schedule)).length
  const summaryHint =
    schedules.length === 0
      ? 'None yet'
      : dueCount > 0
        ? `${dueCount} due now`
        : `Next ${formatNextDate(schedules[0].nextDate)}`

  return (
    <details className="money-instrument-panel money-schedule-panel" open={dueCount > 0}>
      <summary className="money-income-drawer-summary">
        <span className="money-instrument-kicker">Scheduled &amp; recurring</span>
        <span className="money-income-drawer-total money-mono">{summaryHint}</span>
      </summary>

      <ul className="money-schedule-list">
        {schedules.length === 0 && (
          <li className="money-instrument-empty">
            Add a paycheck or recurring bill — Moss reminds you on its date, and you pay or log it
            right here, no trip to the Ledger. It never moves money on its own.
          </li>
        )}
        {schedules.map((schedule) => {
          const due = isScheduleDue(schedule)
          const signed = scheduleSignedAmountCents(schedule)
          const shortCents = billShortCents(schedule, schedule.amountCents)
          const meta = [
            cadenceLabel(schedule.cadence),
            schedule.kind === 'bill' && schedule.categoryId
              ? categoryNames.get(schedule.categoryId) ?? null
              : null,
            schedule.accountId ? accountNames.get(schedule.accountId) ?? null : null
          ]
            .filter(Boolean)
            .join(' · ')

          return (
            <li
              key={schedule.id}
              className={['money-schedule-row', due ? 'money-schedule-row--due' : '']
                .filter(Boolean)
                .join(' ')}
            >
              <div className="money-schedule-row-main">
                <span className="money-schedule-row-label">
                  <span
                    className={[
                      'money-schedule-tag',
                      schedule.kind === 'income'
                        ? 'money-schedule-tag--income'
                        : 'money-schedule-tag--bill'
                    ].join(' ')}
                  >
                    {schedule.kind === 'income' ? 'Income' : 'Bill'}
                  </span>
                  {schedule.label}
                </span>
                <span className="money-schedule-row-meta money-mono">
                  {due ? 'Due' : 'Next'} {formatNextDate(schedule.nextDate)}
                  {meta ? ` · ${meta}` : ''}
                  {shortCents > 0 && (
                    <span className="money-schedule-short">
                      {' '}
                      · {formatMoneyCents(shortCents)} short — assign first
                    </span>
                  )}
                </span>
              </div>
              <span className="money-row-actions">
                <span
                  className={[
                    'money-schedule-amount money-mono',
                    signed >= 0 ? 'money-schedule-amount--in' : 'money-schedule-amount--out'
                  ].join(' ')}
                >
                  {formatMoneyCents(signed)}
                </span>
                <button
                  type="button"
                  className={['money-chip', due ? 'money-chip--accent' : ''].filter(Boolean).join(' ')}
                  disabled={busy}
                  title={
                    due
                      ? 'Post this occurrence and advance to the next date'
                      : `Not due until ${formatNextDate(schedule.nextDate)} — you can still pay early`
                  }
                  onClick={() => {
                    setPostTarget(schedule)
                    setPostAmount((schedule.amountCents / 100).toFixed(2))
                  }}
                >
                  {schedule.kind === 'bill' ? 'Pay' : 'Log it'}
                </button>
                <button
                  type="button"
                  className="money-delete-button money-delete-button--icon"
                  disabled={busy}
                  aria-label={`Delete ${schedule.label}`}
                  onClick={() => {
                    void onMutate(async () => {
                      await window.moss.money.deleteSchedule(schedule.id)
                    })
                  }}
                >
                  ×
                </button>
              </span>
            </li>
          )
        })}
      </ul>

      {doneMessage && (
        <p className="money-describe-status" role="status">
          {doneMessage}
        </p>
      )}

      <form
        className="money-form money-form--inline money-schedule-form"
        onSubmit={(event) => {
          event.preventDefault()
          const amountCents = parseMoneyInput(amount)
          if (!label.trim() || !amountCents || amountCents <= 0) return
          const createdLabel = label.trim()
          const createdKind = kind
          void onMutate(async () => {
            await window.moss.money.createSchedule({
              kind,
              label: createdLabel,
              amountCents,
              cadence,
              nextDate,
              categoryId: kind === 'bill' && categoryId ? categoryId : null,
              accountId: accountId || null
            })
            setLabel('')
            setAmount('')
            // QA2-09: creating one felt inert — say exactly what happens next.
            setDoneMessage(
              `${createdLabel} is set — ${formatMoneyCents(amountCents)} ${cadenceLabel(
                cadence
              ).toLowerCase()}, next ${formatNextDate(nextDate)}. It shows here and under Upcoming; MOSS reminds you when it's due and ${
                createdKind === 'income' ? '“Log it” adds it to your budget' : '“Pay” logs the bill'
              } — nothing ever posts on its own.`
            )
            if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
            doneTimerRef.current = window.setTimeout(() => setDoneMessage(null), 8000)
          })
        }}
      >
        <div className="money-kind-toggle">
          <button
            type="button"
            className={['money-kind', kind === 'bill' ? 'money-kind--active' : ''].join(' ')}
            onClick={() => setKind('bill')}
          >
            Bill
          </button>
          <button
            type="button"
            className={['money-kind', kind === 'income' ? 'money-kind--active' : ''].join(' ')}
            onClick={() => setKind('income')}
          >
            Income
          </button>
        </div>
        <input
          className="money-input money-input--inline"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={kind === 'income' ? 'Paycheck' : 'Rent'}
          aria-label="Schedule label"
        />
        <input
          className="money-input money-input--amount money-input--inline"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Amount"
          inputMode="decimal"
          aria-label="Schedule amount"
        />
        <MossSelect
          className="money-select--inline"
          value={cadence}
          options={CADENCE_OPTIONS}
          onChange={(next) => setCadence(next as ScheduleCadence)}
          ariaLabel="How often"
        />
        <MossDateField
          className="money-date-field--inline"
          value={nextDate}
          onChange={(event) => setNextDate(event.target.value)}
          aria-label="Next date"
        />
        {kind === 'bill' && (
          <MossSelect
            className="money-select--inline"
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
            placeholder="No envelope"
            ariaLabel="Envelope"
          />
        )}
        {accounts.length > 0 && (
          <MossSelect
            className="money-select--inline"
            value={accountId}
            options={accountOptions}
            onChange={setAccountId}
            placeholder="No account"
            ariaLabel="Account"
          />
        )}
        <MossButton type="submit" size="sm" disabled={busy}>
          Add
        </MossButton>
      </form>

      {postTarget && (
        <MossModal
          onClose={() => setPostTarget(null)}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy="money-post-schedule-title"
        >
          <form
            className="calendar-event-modal money-group-modal"
            onSubmit={(event) => {
              event.preventDefault()
              const amountCents = parseMoneyInput(postAmount)
              if (!amountCents || amountCents <= 0) return
              const target = postTarget
              void onMutate(async () => {
                await window.moss.money.postSchedule(target.id, { amountCents })
                setPostTarget(null)
                setDoneMessage(
                  target.kind === 'income'
                    ? `Logged ${formatMoneyCents(amountCents)} in — ${target.label} · added to budget`
                    : `Logged ${formatMoneyCents(amountCents)} out — ${target.label}`
                )
                if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
                doneTimerRef.current = window.setTimeout(() => setDoneMessage(null), 2400)
              })
            }}
          >
            <h2 id="money-post-schedule-title" className="calendar-event-modal-title">
              {postTarget.kind === 'income' ? 'Log paycheck' : `Pay ${postTarget.label}`}
            </h2>
            {(() => {
              const draftCents = parseMoneyInput(postAmount)
              const confirmCents =
                draftCents && draftCents > 0 ? draftCents : postTarget.amountCents
              const envelopeName = postTarget.categoryId
                ? categoryNames.get(postTarget.categoryId) ?? null
                : null
              const modalShortCents = billShortCents(postTarget, confirmCents)
              const due = isScheduleDue(postTarget)
              return (
                <>
                  <p className="money-group-modal-help">
                    {postTarget.kind === 'income'
                      ? `Log ${formatMoneyCents(confirmCents)} — ${postTarget.label} · ${
                          due ? 'due' : 'expected'
                        } ${formatNextDate(postTarget.nextDate)}. It lands in your budget pool, and the next date advances.`
                      : `Pay ${formatMoneyCents(confirmCents)} · ${
                          envelopeName ?? 'no envelope'
                        } · due ${formatNextDate(postTarget.nextDate)}. Adjust the amount if the bill came in different.`}
                  </p>
                  {modalShortCents > 0 && envelopeName && (
                    <p className="money-group-modal-help money-schedule-short">
                      {formatMoneyCents(modalShortCents)} short in {envelopeName} — assign first,
                      or pay anyway and the envelope shows overspent until you cover it.
                    </p>
                  )}
                  {!due && (
                    <p className="money-group-modal-help">
                      Not due yet — {postTarget.kind === 'income' ? 'logging' : 'paying'} now posts
                      it dated {formatNextDate(postTarget.nextDate)} and advances the next date.
                    </p>
                  )}
                </>
              )
            })()}
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">Amount</span>
              <input
                className="preference-input"
                value={postAmount}
                onChange={(event) => setPostAmount(event.target.value)}
                inputMode="decimal"
                aria-label="Actual amount"
                autoFocus
              />
            </label>
            <div className="calendar-event-modal-actions">
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setPostTarget(null)}
              >
                Cancel
              </MossButton>
              <MossButton type="submit" size="sm" disabled={busy}>
                {postTarget.kind === 'income' ? 'Log it' : 'Pay'}
              </MossButton>
            </div>
          </form>
        </MossModal>
      )}
    </details>
  )
}
