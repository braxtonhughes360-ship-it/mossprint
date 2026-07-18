import { useMemo, useState } from 'react'
import type { CashAccountBalance, CashAccountType } from '@shared/money'
import { accountOwedCents, formatMoneyCents, isCreditAccountType, parseMoneyInput } from '@shared/money'
import { MossModal } from './MossModal'
import { MossSelect } from './MossSelect'
import { MossButton } from './MossButton'

interface MoneyAccountsBarProps {
  accounts: CashAccountBalance[]
  selectedAccountId: string | null
  onSelect: (accountId: string | null) => void
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

const ACCOUNT_TYPES: Array<{ value: CashAccountType; label: string }> = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit card' },
  { value: 'other', label: 'Other' }
]

export function MoneyAccountsBar({
  accounts,
  selectedAccountId,
  onSelect,
  busy,
  onMutate
}: MoneyAccountsBarProps): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<CashAccountType>('checking')
  const [startingBalance, setStartingBalance] = useState('')

  const [payingCard, setPayingCard] = useState<CashAccountBalance | null>(null)
  const [payFromId, setPayFromId] = useState('')
  const [payAmount, setPayAmount] = useState('')

  const cashAccounts = accounts.filter((account) => !isCreditAccountType(account.type))
  const creditAccounts = accounts.filter((account) => isCreditAccountType(account.type))
  // "All accounts" sums every account (a card's negative balance nets out the debt), matching the
  // Ledger header's TOTAL BALANCE. The card's owed amount is also broken out below for clarity.
  const allBalanceCents = accounts.reduce((sum, account) => sum + account.balanceCents, 0)
  const totalOwedCents = creditAccounts.reduce((sum, account) => sum + accountOwedCents(account.balanceCents), 0)
  const creating = type === 'credit'

  const payFromOptions = useMemo(
    () => cashAccounts.map((account) => ({ value: account.id, label: account.name })),
    [cashAccounts]
  )

  function resetForm(): void {
    setName('')
    setType('checking')
    setStartingBalance('')
    setAdding(false)
  }

  function openPay(card: CashAccountBalance): void {
    setPayingCard(card)
    setPayFromId(cashAccounts[0]?.id ?? '')
    setPayAmount(String(accountOwedCents(card.balanceCents) / 100))
  }

  function closePay(): void {
    setPayingCard(null)
    setPayFromId('')
    setPayAmount('')
  }

  function renderChip(account: CashAccountBalance): React.JSX.Element {
    const isCredit = isCreditAccountType(account.type)
    const owedCents = accountOwedCents(account.balanceCents)
    return (
      <span key={account.id} className="money-account-chip-wrap">
        <button
          type="button"
          role="tab"
          aria-selected={selectedAccountId === account.id}
          className={[
            'money-account-chip',
            selectedAccountId === account.id ? 'money-account-chip--active' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(account.id)}
        >
          <span className="money-account-chip-name">{account.name}</span>
          {isCredit ? (
            <span
              className={[
                'money-account-chip-balance money-mono',
                owedCents > 0 ? 'money-account-chip-balance--neg' : 'money-account-chip-balance--ok'
              ].join(' ')}
            >
              {owedCents > 0 ? `${formatMoneyCents(owedCents)} owed` : 'Paid off'}
            </span>
          ) : (
            <span
              className={[
                'money-account-chip-balance money-mono',
                account.balanceCents < 0 ? 'money-account-chip-balance--neg' : ''
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {formatMoneyCents(account.balanceCents)}
            </span>
          )}
        </button>
        {isCredit && owedCents > 0 && cashAccounts.length > 0 && (
          <button
            type="button"
            className="money-account-chip-pay"
            disabled={busy}
            onClick={() => openPay(account)}
          >
            Pay
          </button>
        )}
        <button
          type="button"
          className="money-delete-button money-delete-button--icon money-account-chip-delete"
          disabled={busy}
          aria-label={`Remove ${account.name}`}
          onClick={() => {
            void onMutate(async () => {
              if (selectedAccountId === account.id) onSelect(null)
              await window.moss.money.deleteCashAccount(account.id)
            })
          }}
        >
          ×
        </button>
      </span>
    )
  }

  return (
    <section className="money-instrument-panel money-accounts-bar" aria-label="Accounts">
      <div className="money-accounts-bar-head">
        <p className="money-instrument-kicker">Accounts</p>
        <MossButton
          type="button"
          variant="quiet"
          size="sm"
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          + Account
        </MossButton>
      </div>

      {accounts.length === 0 && !adding && (
        <p className="money-instrument-empty">
          Track checking, savings, cash, or a credit card separately. Add one to see per-account
          balances.
        </p>
      )}

      {accounts.length > 0 && (
        <div className="money-accounts-chips" role="tablist" aria-label="Filter by account">
          <button
            type="button"
            role="tab"
            aria-selected={selectedAccountId === null}
            className={[
              'money-account-chip',
              selectedAccountId === null ? 'money-account-chip--active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelect(null)}
          >
            <span className="money-account-chip-name">All accounts</span>
            <span className="money-account-chip-balance money-mono">
              {formatMoneyCents(allBalanceCents)}
            </span>
          </button>
          {cashAccounts.map((account) => renderChip(account))}
        </div>
      )}

      {creditAccounts.length > 0 && (
        <div className="money-accounts-credit">
          <p className="money-accounts-credit-head nutrition-mono">
            Credit cards
            {totalOwedCents > 0 && (
              <span className="money-accounts-credit-owed"> · {formatMoneyCents(totalOwedCents)} owed</span>
            )}
          </p>
          <div className="money-accounts-chips" role="tablist" aria-label="Filter by credit card">
            {creditAccounts.map((account) => renderChip(account))}
          </div>
          <p className="money-accounts-credit-note">
            A charge on a card lands in the Ledger like any expense (pick the card as the account); it
            raises what you owe and still spends from its envelope. <strong>Pay</strong> records a
            transfer from your cash — MOSS never moves real money.
          </p>
        </div>
      )}

      {adding && (
        <MossModal
          onClose={resetForm}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy="money-add-account-title"
        >
          <form
            className="calendar-event-modal"
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim()) return
              const parsed = startingBalance ? parseMoneyInput(startingBalance) ?? 0 : 0
              // A credit card's "current balance owed" is stored as a negative balance.
              const startingBalanceCents = creating ? -Math.abs(parsed) : parsed
              void onMutate(async () => {
                await window.moss.money.createCashAccount({
                  name: name.trim(),
                  type,
                  startingBalanceCents
                })
                resetForm()
              })
            }}
          >
            <header className="calendar-event-modal-head">
              <h2 id="money-add-account-title" className="calendar-event-modal-title">
                Add account
              </h2>
            </header>
            <p className="money-group-modal-help">
              {creating
                ? 'Track a credit card. Enter what you currently owe so the balance starts right.'
                : 'Track a checking, savings, or cash account. Set its current balance so totals start from the right number.'}
            </p>
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">Name</span>
              <input
                className="preference-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={creating ? 'e.g. Visa' : 'e.g. Checking'}
                aria-label="Account name"
                autoFocus
              />
            </label>
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">Type</span>
              <MossSelect
                className="moss-select--block"
                value={type}
                options={ACCOUNT_TYPES}
                onChange={(next) => setType(next as CashAccountType)}
                ariaLabel="Account type"
              />
            </label>
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">
                {creating ? 'Current balance owed' : 'Current balance'}
              </span>
              <input
                className="preference-input money-mono"
                value={startingBalance}
                onChange={(event) => setStartingBalance(event.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                aria-label={creating ? 'Current balance owed' : 'Starting balance'}
              />
            </label>
            <div className="calendar-event-modal-actions">
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={resetForm}
              >
                Cancel
              </MossButton>
              <MossButton
                type="submit"
                size="sm"
                disabled={busy || !name.trim()}
              >
                Add account
              </MossButton>
            </div>
          </form>
        </MossModal>
      )}

      {payingCard && (
        <MossModal
          onClose={closePay}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy="money-pay-card-title"
        >
          <form
            className="calendar-event-modal"
            onSubmit={(event) => {
              event.preventDefault()
              const amountCents = parseMoneyInput(payAmount)
              if (!amountCents || amountCents <= 0 || !payFromId) return
              const card = payingCard
              void onMutate(async () => {
                await window.moss.money.createTransfer({
                  fromAccountId: payFromId,
                  toAccountId: card.id,
                  amountCents,
                  occurredAt: new Date().toISOString(),
                  memo: `Payment to ${card.name}`
                })
                closePay()
              })
            }}
          >
            <header className="calendar-event-modal-head">
              <h2 id="money-pay-card-title" className="calendar-event-modal-title">
                Pay {payingCard.name}
              </h2>
            </header>
            <p className="money-group-modal-help">
              Records a transfer from your cash to the card — lowers what you owe and your cash by the
              same amount. MOSS does not move real money; make the actual payment with your bank.
            </p>
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">Pay from</span>
              <MossSelect
                className="moss-select--block"
                value={payFromId}
                options={payFromOptions}
                onChange={setPayFromId}
                ariaLabel="Pay from account"
              />
            </label>
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">Amount</span>
              <input
                className="preference-input money-mono"
                value={payAmount}
                onChange={(event) => setPayAmount(event.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                aria-label="Payment amount"
                autoFocus
              />
            </label>
            <div className="calendar-event-modal-actions">
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={closePay}
              >
                Cancel
              </MossButton>
              <MossButton
                type="submit"
                size="sm"
                disabled={busy || !payFromId || !payAmount.trim()}
              >
                Record payment
              </MossButton>
            </div>
          </form>
        </MossModal>
      )}
    </section>
  )
}
