import { useMemo, useState } from 'react'
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

  const categoryNames = useMemo(
    () => new Map(categories.map((row) => [row.category.id, row.category.name])),
    [categories]
  )
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
            Add a paycheck or recurring bill — Moss reminds you to log it on its date. It never
            moves money on its own; you tap “Log it” when it actually happens.
          </li>
        )}
        {schedules.map((schedule) => {
          const due = isScheduleDue(schedule)
          const signed = scheduleSignedAmountCents(schedule)
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
                  disabled={busy || !due}
                  title={
                    due
                      ? 'Post this occurrence and advance to the next date'
                      : `Available on ${formatNextDate(schedule.nextDate)}`
                  }
                  onClick={() => {
                    if (!due) return
                    setPostTarget(schedule)
                    setPostAmount((schedule.amountCents / 100).toFixed(2))
                  }}
                >
                  Log it
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

      <form
        className="money-form money-form--inline money-schedule-form"
        onSubmit={(event) => {
          event.preventDefault()
          const amountCents = parseMoneyInput(amount)
          if (!label.trim() || !amountCents || amountCents <= 0) return
          void onMutate(async () => {
            await window.moss.money.createSchedule({
              kind,
              label: label.trim(),
              amountCents,
              cadence,
              nextDate,
              categoryId: kind === 'bill' && categoryId ? categoryId : null,
              accountId: accountId || null
            })
            setLabel('')
            setAmount('')
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
        <input
          className="money-input money-input--inline money-mono"
          type="date"
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
        <button type="submit" className="money-button money-button--compact" disabled={busy}>
          Add
        </button>
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
              void onMutate(async () => {
                await window.moss.money.postSchedule(postTarget.id, { amountCents })
                setPostTarget(null)
              })
            }}
          >
            <h2 id="money-post-schedule-title" className="calendar-event-modal-title">
              {postTarget.kind === 'income' ? 'Log paycheck' : 'Log bill'}
            </h2>
            <p className="money-group-modal-help">
              Enter the actual amount for {postTarget.label}. Moss advances the next date after you
              confirm.
            </p>
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
              <button
                type="button"
                className="money-button money-button--ghost money-button--compact"
                onClick={() => setPostTarget(null)}
              >
                Cancel
              </button>
              <button type="submit" className="money-button money-button--compact" disabled={busy}>
                Log it
              </button>
            </div>
          </form>
        </MossModal>
      )}
    </details>
  )
}
