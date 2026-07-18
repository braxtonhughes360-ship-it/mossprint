import { useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import type { CashAccountBalance, MoneyBudgetOverview, PaycheckRecord } from '@shared/money'
import {
  dateKey,
  dayKeyToIso,
  formatMoneyCents,
  isCreditAccountType,
  isoToDayKey,
  parseMoneyInput
} from '@shared/money'
import type { MoneyMutateFn } from '../moneyMutate'
import { MossButton } from './MossButton'
import { MossDateField } from './MossDateField'
import { MossModal } from './MossModal'
import { MossSelect } from './MossSelect'

interface MoneyIncomePanelProps {
  budget: MoneyBudgetOverview
  accounts: CashAccountBalance[]
  busy: boolean
  isFresh: boolean
  paycheckAmountRef: RefObject<HTMLInputElement | null>
  onMutate: MoneyMutateFn
}

export function MoneyIncomePanel({
  budget,
  accounts,
  busy,
  isFresh,
  paycheckAmountRef,
  onMutate
}: MoneyIncomePanelProps): React.JSX.Element {
  const [paycheckLabel, setPaycheckLabel] = useState('Paycheck')
  const [paycheckAmount, setPaycheckAmount] = useState('')
  const [paycheckDate, setPaycheckDate] = useState(() => dateKey())
  const [paycheckAccountId, setPaycheckAccountId] = useState('')
  const [editPaycheck, setEditPaycheck] = useState<PaycheckRecord | null>(null)
  const [editPaycheckLabel, setEditPaycheckLabel] = useState('')
  const [editPaycheckAmount, setEditPaycheckAmount] = useState('')
  const [editPaycheckDate, setEditPaycheckDate] = useState(() => dateKey())
  const [editPaycheckAccountId, setEditPaycheckAccountId] = useState('')

  const accountOptions = useMemo(
    () => [
      { value: '', label: 'No account' },
      ...accounts.map((account) => ({ value: account.id, label: account.name }))
    ],
    [accounts]
  )

  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts]
  )

  // Default new income to checking (or the only account) so ledger balances stay honest.
  useEffect(() => {
    if (accounts.length === 0 || paycheckAccountId) return
    const preferred =
      accounts.find((account) => account.type === 'checking') ??
      accounts.find((account) => account.type === 'savings') ??
      accounts.find((account) => !isCreditAccountType(account.type)) ??
      accounts[0]
    if (preferred) setPaycheckAccountId(preferred.id)
  }, [accounts, paycheckAccountId])

  return (
    <>
      <details className="money-instrument-panel money-income-drawer" open={isFresh}>
        <summary className="money-income-drawer-summary">
          <span className="money-instrument-kicker">Income</span>
          <span className="money-income-drawer-total money-mono">
            {formatMoneyCents(budget.paycheckTotalCents)}
          </span>
        </summary>

        <ul className="money-income-list">
          {budget.paychecks.length === 0 && (
            <li className="money-instrument-empty">No paychecks logged this month.</li>
          )}
          {budget.paychecks.map((paycheck) => (
            <li key={paycheck.id} className="money-income-row">
              <span>
                {paycheck.label}
                <span className="money-income-row-date money-mono">
                  {' '}
                  · {formatIncomeDate(paycheck.receivedAt)}
                  {accounts.length > 0 && (
                    <>
                      {' '}
                      ·{' '}
                      {paycheck.accountId && accountNameById.has(paycheck.accountId)
                        ? accountNameById.get(paycheck.accountId)
                        : 'Budget only'}
                    </>
                  )}
                </span>
              </span>
              <span className="money-row-actions">
                <span className="money-mono">{formatMoneyCents(paycheck.amountCents)}</span>
                <MossButton
                  type="button"
                  variant="quiet"
                  size="sm"
                  disabled={busy}
                  aria-label={`Edit ${paycheck.label}`}
                  onClick={() => {
                    setEditPaycheck(paycheck)
                    setEditPaycheckLabel(paycheck.label)
                    setEditPaycheckAmount((paycheck.amountCents / 100).toFixed(2))
                    setEditPaycheckDate(isoToDayKey(paycheck.receivedAt))
                    setEditPaycheckAccountId(paycheck.accountId ?? '')
                  }}
                >
                  Edit
                </MossButton>
                <button
                  type="button"
                  className="money-delete-button"
                  disabled={busy}
                  aria-label={`Delete ${paycheck.label}`}
                  onClick={() => {
                    void onMutate(async () => {
                      await window.moss.money.deletePaycheck(paycheck.id)
                    })
                  }}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>

        {accounts.length === 0 ? (
          <p className="money-income-ledger-note">
            Add Checking or Savings on the <strong>Ledger</strong> tab to tag which account income
            lands in. Until then, income still counts toward your budget pool.
          </p>
        ) : (
          <p className="money-income-account-hint">
            Pick a deposit account so this income updates that account&rsquo;s balance in the Ledger.
          </p>
        )}

        <form
          className="money-form money-form--inline"
          onSubmit={(event) => {
            event.preventDefault()
            const amountCents = parseMoneyInput(paycheckAmount)
            if (!amountCents || amountCents <= 0) return
            void onMutate(async () => {
              await window.moss.money.createPaycheck({
                label: paycheckLabel.trim() || 'Paycheck',
                amountCents,
                receivedAt: dayKeyToIso(paycheckDate),
                accountId: paycheckAccountId || null
              })
              setPaycheckAmount('')
            })
          }}
        >
          <input
            className="money-input money-input--inline"
            value={paycheckLabel}
            onChange={(event) => setPaycheckLabel(event.target.value)}
            placeholder="Label"
            aria-label="Paycheck label"
          />
          <input
            ref={paycheckAmountRef}
            className="money-input money-input--amount money-input--inline"
            value={paycheckAmount}
            onChange={(event) => setPaycheckAmount(event.target.value)}
            placeholder="Amount"
            inputMode="decimal"
            aria-label="Paycheck amount"
          />
          <MossDateField
            className="money-date-field--inline"
            value={paycheckDate}
            onChange={(event) => setPaycheckDate(event.target.value)}
            aria-label="Pay date"
          />
          {accounts.length > 0 && (
            <MossSelect
              className="money-select--inline"
              value={paycheckAccountId}
              options={accountOptions}
              onChange={setPaycheckAccountId}
              placeholder="Deposit to"
              ariaLabel="Deposit account"
            />
          )}
          <MossButton type="submit" size="sm" disabled={busy}>
            Log income
          </MossButton>
        </form>
      </details>

      {editPaycheck && (
        <MossModal
          onClose={() => setEditPaycheck(null)}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy="money-edit-paycheck-title"
        >
          <form
            className="calendar-event-modal money-group-modal"
            onSubmit={(event) => {
              event.preventDefault()
              const amountCents = parseMoneyInput(editPaycheckAmount)
              if (!amountCents || amountCents <= 0) return
              void onMutate(async () => {
                await window.moss.money.updatePaycheck({
                  id: editPaycheck.id,
                  label: editPaycheckLabel.trim() || 'Paycheck',
                  amountCents,
                  receivedAt: dayKeyToIso(editPaycheckDate),
                  accountId: editPaycheckAccountId || null
                })
                setEditPaycheck(null)
              })
            }}
          >
            <h2 id="money-edit-paycheck-title" className="calendar-event-modal-title">
              Edit income
            </h2>
            <p className="money-group-modal-help">
              Fix the amount or date if this paycheck landed differently than planned.
            </p>
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">Label</span>
              <input
                className="preference-input"
                value={editPaycheckLabel}
                onChange={(event) => setEditPaycheckLabel(event.target.value)}
                aria-label="Paycheck label"
              />
            </label>
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">Amount</span>
              <input
                className="preference-input"
                value={editPaycheckAmount}
                onChange={(event) => setEditPaycheckAmount(event.target.value)}
                inputMode="decimal"
                aria-label="Paycheck amount"
              />
            </label>
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">Date received</span>
              <MossDateField
                value={editPaycheckDate}
                onChange={(event) => setEditPaycheckDate(event.target.value)}
                aria-label="Pay date"
              />
            </label>
            {accounts.length > 0 && (
              <label className="calendar-class-time-field">
                <span className="calendar-quick-add-label nutrition-mono">Account</span>
                <MossSelect
                  value={editPaycheckAccountId}
                  options={accountOptions}
                  onChange={setEditPaycheckAccountId}
                  placeholder="No account"
                  ariaLabel="Deposit account"
                />
              </label>
            )}
            <div className="calendar-event-modal-actions">
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setEditPaycheck(null)}
              >
                Cancel
              </MossButton>
              <MossButton type="submit" size="sm" disabled={busy}>
                Save
              </MossButton>
            </div>
          </form>
        </MossModal>
      )}
    </>
  )
}

function formatIncomeDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(year, month - 1, day)
  )
}
