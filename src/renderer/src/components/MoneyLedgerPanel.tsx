import { useEffect, useMemo, useState } from 'react'
import type {
  CashAccountBalance,
  LedgerFilter,
  MoneyBudgetOverview,
  PayeeRecord,
  PaycheckRecord,
  TransactionRecord,
  TransactionStatus,
  TransactionType
} from '@shared/money'
import {
  EMPTY_LEDGER_FILTER,
  availableEntryKinds,
  currentPeriodKey,
  dateKey,
  dayKeyToIso,
  filterPaychecksForRegister,
  filterTransactions,
  formatMoneyCents,
  formatPeriodLabel,
  isLedgerFilterActive,
  parseMoneyInput,
  tagsFromInput
} from '@shared/money'
import { MoneyAccountsBar } from './MoneyAccountsBar'
import { MoneyLedgerPaycheckRow, MoneyLedgerRow } from './MoneyLedgerRow'
import { MoneyReconcilePanel } from './MoneyReconcilePanel'
import { MossSelect, type MossSelectOption } from './MossSelect'

interface MoneyLedgerPanelProps {
  budget: MoneyBudgetOverview
  periodKey: string
  transactions: TransactionRecord[]
  /** This month's paychecks — display-only income rows (QA2-08, A2 intact). */
  paychecks?: PaycheckRecord[]
  accounts: CashAccountBalance[]
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
  /** One-shot filter to apply when the panel opens (e.g. deep-link to unfiled rows). */
  initialFilter?: LedgerFilter | null
  /** Called once the initialFilter has been consumed, so it isn't reapplied. */
  onInitialFilterApplied?: () => void
}

type EntryType = TransactionType

const PAYEE_DATALIST_ID = 'money-payee-datalist'

/** Manual entries default to today; a past month gets its midpoint so rows stay in-period. */
function defaultEntryDayKey(periodKey: string): string {
  return periodKey === currentPeriodKey() ? dateKey() : `${periodKey}-15`
}

/**
 * Describe is the default entry surface (LocalAI plan §2.5); the structured
 * form sits behind this disclosure. Remembered per app session, module-scoped
 * so navigating away and back keeps the operator's choice.
 */
let manualEntryOpenMemory = false

const TYPE_FILTER_OPTIONS: MossSelectOption[] = [
  { value: 'all', label: 'All types' },
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'adjustment', label: 'Adjustment' }
]

const STATUS_FILTER_OPTIONS: MossSelectOption[] = [
  { value: 'all', label: 'Any status' },
  { value: 'pending', label: 'Pending' },
  { value: 'cleared', label: 'Cleared' },
  { value: 'reconciled', label: 'Reconciled' }
]

const ENTRY_STATUS_OPTIONS: MossSelectOption[] = [
  { value: 'cleared', label: 'Cleared' },
  { value: 'pending', label: 'Pending' },
  { value: 'reconciled', label: 'Reconciled' }
]

export function MoneyLedgerPanel({
  budget,
  periodKey,
  transactions,
  paychecks = [],
  accounts,
  busy,
  onMutate,
  initialFilter,
  onInitialFilterApplied
}: MoneyLedgerPanelProps): React.JSX.Element {
  const [entryType, setEntryType] = useState<EntryType>('expense')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [adjustSign, setAdjustSign] = useState<1 | -1>(-1)
  const [entryPulse, setEntryPulse] = useState(false)

  useEffect(() => {
    if (!entryPulse) return
    const id = window.setTimeout(() => setEntryPulse(false), 620)
    return () => window.clearTimeout(id)
  }, [entryPulse])
  const [payees, setPayees] = useState<PayeeRecord[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [entryAccountId, setEntryAccountId] = useState('')
  const [transferToId, setTransferToId] = useState('')
  const [entryStatus, setEntryStatus] = useState<TransactionStatus>('cleared')
  const [entryDate, setEntryDate] = useState(() => defaultEntryDayKey(periodKey))
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [manualOpen, setManualOpen] = useState(manualEntryOpenMemory)

  function toggleManualEntry(): void {
    setManualOpen((open) => {
      manualEntryOpenMemory = !open
      return !open
    })
  }

  const [filter, setFilter] = useState<LedgerFilter>(EMPTY_LEDGER_FILTER)
  const [showFilters, setShowFilters] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ token: string; label: string } | null>(null)
  const [reconcileOpen, setReconcileOpen] = useState(false)

  useEffect(() => {
    if (!window.moss?.money?.listPayees) return
    void window.moss.money.listPayees().then(setPayees).catch(() => setPayees([]))
  }, [])

  // Default the new-entry account to whatever account is currently filtered.
  useEffect(() => {
    setEntryAccountId(selectedAccountId ?? '')
  }, [selectedAccountId])

  // Reset transient state when the viewed month changes.
  useEffect(() => {
    setUndo(null)
    setExpandedId(null)
    setEntryDate(defaultEntryDayKey(periodKey))
  }, [periodKey])

  // Deep-link (e.g. the cockpit "unfiled spending" warning) hands us a one-shot
  // filter; apply it once, scope back to all accounts so nothing is hidden, then
  // tell the parent to clear it so it isn't reapplied on later visits.
  useEffect(() => {
    if (!initialFilter) return
    setSelectedAccountId(null)
    setFilter(initialFilter)
    setShowFilters(false)
    onInitialFilterApplied?.()
  }, [initialFilter, onInitialFilterApplied])

  // Transfer needs two accounts; fall back if they disappear.
  useEffect(() => {
    if (entryType === 'transfer' && accounts.length < 2) setEntryType('expense')
  }, [entryType, accounts.length])

  const categoryMap = useMemo(
    () => new Map(budget.categories.map((row) => [row.category.id, row.category.name])),
    [budget.categories]
  )
  const accountMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts]
  )

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'No envelope' },
      ...budget.categories.map((row) => ({ value: row.category.id, label: row.category.name }))
    ],
    [budget.categories]
  )
  const accountOptions = useMemo(
    () => [
      { value: '', label: 'No account' },
      ...accounts.map((account) => ({ value: account.id, label: account.name }))
    ],
    [accounts]
  )
  const transferToOptions = useMemo(
    () => [
      { value: '', label: 'To account' },
      ...accounts
        .filter((account) => account.id !== entryAccountId)
        .map((account) => ({ value: account.id, label: account.name }))
    ],
    [accounts, entryAccountId]
  )
  const filterCategoryOptions = useMemo(
    () => [
      { value: 'all', label: 'All envelopes' },
      { value: 'none', label: 'No envelope / Unfiled' },
      ...budget.categories.map((row) => ({ value: row.category.id, label: row.category.name }))
    ],
    [budget.categories]
  )

  // Account scope drives the running balance; the rest of the filter is layered on top.
  const accountScoped = useMemo(
    () =>
      selectedAccountId
        ? transactions.filter((txn) => txn.accountId === selectedAccountId)
        : transactions,
    [transactions, selectedAccountId]
  )

  const tagOptions = useMemo(() => {
    const all = accountScoped.flatMap((txn) => txn.tags)
    const unique = all.filter((tag, index) => all.indexOf(tag) === index).sort()
    return [
      { value: 'all', label: 'Any tag' },
      ...unique.map((tag) => ({ value: tag, label: `#${tag}` }))
    ]
  }, [accountScoped])

  // Real money movement for this scope (includes transfer legs) — used only to seed
  // the running-balance column so it lands on the true current balance.
  const activityCents = useMemo(
    () => accountScoped.reduce((sum, txn) => sum + txn.amountCents, 0),
    [accountScoped]
  )

  // "Net this month" is income minus spending. Transfers move money between your own
  // accounts — they're not income or an expense — so they're excluded from the net.
  const netCents = useMemo(
    () =>
      accountScoped
        .filter((txn) => txn.type !== 'transfer')
        .reduce((sum, txn) => sum + txn.amountCents, 0),
    [accountScoped]
  )

  // Live balance for the current scope: a single account's balance, or the sum of
  // every account when viewing "All accounts". This already folds in starting
  // balances and deposited paychecks (see listCashAccounts), so it's the real
  // "how much money you have" figure — not just this view's transaction sum.
  const totalBalanceCents = useMemo(
    () => accounts.reduce((sum, account) => sum + account.balanceCents, 0),
    [accounts]
  )
  const scopeBalanceCents = selectedAccountId
    ? accounts.find((account) => account.id === selectedAccountId)?.balanceCents ?? 0
    : totalBalanceCents

  // Seed the running "Balance" column so the most recent row lands on the real
  // current balance (not a cumulative-from-zero sum that ignores starting balances
  // and paychecks). With no accounts there's no balance concept, so fall back to 0.
  const balanceById = useMemo(() => {
    const ascending = [...accountScoped].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    )
    const map = new Map<string, number>()
    let running = accounts.length > 0 ? scopeBalanceCents - activityCents : 0
    for (const txn of ascending) {
      running += txn.amountCents
      map.set(txn.id, running)
    }
    return map
  }, [accountScoped, accounts.length, scopeBalanceCents, activityCents])

  // Register rows: transactions + this month's paychecks merged at read time
  // (QA2-08). Paychecks are display-only — excluded from net/balance math above.
  const displayed = useMemo(() => {
    const txnRows = filterTransactions(accountScoped, filter).map((txn) => ({
      kind: 'txn' as const,
      txn,
      at: new Date(txn.occurredAt).getTime()
    }))
    const paycheckRows = filterPaychecksForRegister(paychecks, filter, selectedAccountId).map(
      (paycheck) => ({
        kind: 'paycheck' as const,
        paycheck,
        at: new Date(paycheck.receivedAt).getTime()
      })
    )
    return [...txnRows, ...paycheckRows].sort((a, b) => b.at - a.at)
  }, [accountScoped, filter, paychecks, selectedAccountId])

  const filterActive = isLedgerFilterActive(filter)
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null

  function patchFilter(patch: Partial<LedgerFilter>): void {
    setFilter((prev) => ({ ...prev, ...patch }))
  }

  function resetEntry(): void {
    setAmount('')
    setMemo('')
    setNotes('')
    setTags('')
    setEntryPulse(true)
  }

  function submitEntry(): void {
    if (entryType === 'transfer') {
      const magnitude = parseMoneyInput(amount)
      if (!magnitude || magnitude <= 0) return
      if (!entryAccountId || !transferToId || entryAccountId === transferToId) return
      void onMutate(async () => {
        await window.moss.money.createTransfer({
          fromAccountId: entryAccountId,
          toAccountId: transferToId,
          amountCents: magnitude,
          occurredAt: dayKeyToIso(entryDate),
          memo: memo.trim() || undefined,
          notes: notes.trim() || undefined,
          tags: tagsFromInput(tags),
          status: entryStatus
        })
        resetEntry()
      })
      return
    }

    const parsed = parseMoneyInput(amount)
    if (!parsed || parsed <= 0) return
    const sign = entryType === 'income' ? 1 : entryType === 'adjustment' ? adjustSign : -1
    const payeeName = memo.trim()

    void onMutate(async () => {
      await window.moss.money.createTransaction({
        amountCents: sign * parsed,
        type: entryType,
        status: entryStatus,
        categoryId: categoryId || null,
        payeeName: payeeName || undefined,
        memo: payeeName,
        notes: notes.trim() || undefined,
        tags: tagsFromInput(tags),
        occurredAt: dayKeyToIso(entryDate),
        accountId: entryAccountId || null
      })
      resetEntry()
    })
  }

  function undoDelete(): void {
    if (!undo) return
    const token = undo.token
    setUndo(null)
    void onMutate(async () => {
      await window.moss.money.restoreTransaction(token)
    })
  }

  return (
    <div className="money-workspace">
      <MoneyAccountsBar
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onSelect={(id) => {
          setSelectedAccountId(id)
          if (!id) setReconcileOpen(false)
        }}
        busy={busy}
        onMutate={onMutate}
      />

      {selectedAccount && (
        <div className="money-reconcile-trigger">
          <button
            type="button"
            className={['money-chip', reconcileOpen ? 'money-chip--accent' : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={reconcileOpen}
            onClick={() => setReconcileOpen((value) => !value)}
          >
            {reconcileOpen ? 'Close reconcile' : `Reconcile ${selectedAccount.name}`}
          </button>
        </div>
      )}

      {selectedAccount && reconcileOpen && (
        <MoneyReconcilePanel
          account={selectedAccount}
          busy={busy}
          onMutate={onMutate}
          onClose={() => setReconcileOpen(false)}
        />
      )}

      <section className="money-instrument-panel money-register" aria-label="Ledger">
        <header className="money-instrument-head money-register-hero">
          <div className="money-register-balance-block">
            <p className="money-instrument-kicker">
              {selectedAccount ? `${selectedAccount.name} balance` : 'Total balance'}
            </p>
            <p
              className={[
                'money-register-balance money-mono',
                scopeBalanceCents < 0 ? 'money-register-balance--neg' : ''
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {formatMoneyCents(scopeBalanceCents)}
            </p>
            <p className="money-register-balance-sub money-mono">
              {formatPeriodLabel(periodKey)} · Net {formatMoneyCents(netCents)} this month
            </p>
          </div>
        </header>

        {/* Describe moved to the page hero (QA2-06) — one flagship bar, no duplicates. */}

        <div className="money-ledger-filterbar">
          <input
            className="money-input money-input--register money-ledger-search"
            value={filter.search}
            onChange={(event) => patchFilter({ search: event.target.value })}
            placeholder="Search memo, notes, tags…"
            aria-label="Search transactions"
            type="search"
          />
          <MossSelect
            className="money-select--register"
            value={filter.type}
            options={TYPE_FILTER_OPTIONS}
            onChange={(value) => patchFilter({ type: value as LedgerFilter['type'] })}
            ariaLabel="Filter by type"
          />
          <MossSelect
            className="money-select--register"
            value={filter.status}
            options={STATUS_FILTER_OPTIONS}
            onChange={(value) => patchFilter({ status: value as LedgerFilter['status'] })}
            ariaLabel="Filter by status"
          />
          <MossSelect
            className="money-select--register"
            value={filter.categoryId}
            options={filterCategoryOptions}
            onChange={(value) => patchFilter({ categoryId: value })}
            ariaLabel="Filter by envelope"
          />
          <button
            type="button"
            className={['money-chip', showFilters ? 'money-chip--accent' : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={showFilters}
            onClick={() => setShowFilters((value) => !value)}
          >
            More
          </button>
          {filterActive && (
            <button
              type="button"
              className="money-chip"
              onClick={() => {
                setFilter(EMPTY_LEDGER_FILTER)
                setShowFilters(false)
              }}
            >
              Clear
            </button>
          )}
        </div>

        {showFilters && (
          <div className="money-ledger-filterbar money-ledger-filterbar--more">
            <MossSelect
              className="money-select--register"
              value={filter.tag ?? 'all'}
              options={tagOptions}
              onChange={(value) => patchFilter({ tag: value === 'all' ? null : value })}
              ariaLabel="Filter by tag"
            />
            <input
              className="money-input money-input--register money-mono money-input--amount"
              value={filter.minCents === null ? '' : (filter.minCents / 100).toString()}
              onChange={(event) =>
                patchFilter({ minCents: event.target.value ? parseMoneyInput(event.target.value) : null })
              }
              placeholder="Min $"
              inputMode="decimal"
              aria-label="Minimum amount"
            />
            <input
              className="money-input money-input--register money-mono money-input--amount"
              value={filter.maxCents === null ? '' : (filter.maxCents / 100).toString()}
              onChange={(event) =>
                patchFilter({ maxCents: event.target.value ? parseMoneyInput(event.target.value) : null })
              }
              placeholder="Max $"
              inputMode="decimal"
              aria-label="Maximum amount"
            />
            <input
              type="date"
              className="money-input money-input--register money-mono"
              value={filter.from ?? ''}
              onChange={(event) => patchFilter({ from: event.target.value || null })}
              aria-label="From date"
            />
            <input
              type="date"
              className="money-input money-input--register money-mono"
              value={filter.to ?? ''}
              onChange={(event) => patchFilter({ to: event.target.value || null })}
              aria-label="To date"
            />
          </div>
        )}

        {undo && (
          <div className="money-ledger-undo" role="status">
            <span>Removed {undo.label}.</span>
            <div className="money-ledger-undo-actions">
              <button type="button" className="money-button money-button--compact" onClick={undoDelete}>
                Undo
              </button>
              <button
                type="button"
                className="money-button money-button--ghost money-button--compact"
                onClick={() => setUndo(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="money-ledger-register">
          <div className="money-ledger-head-wrap">
            <div className="money-ledger-head money-mono" aria-hidden>
              <span>Date</span>
              <span>Memo</span>
              <span>Envelope</span>
              <span className="money-ledger-col-amount">Amount</span>
              <span className="money-ledger-col-balance">Balance</span>
              <span className="money-ledger-col-status">Status</span>
              <span />
            </div>
          </div>

          <div className="money-register-scroll">
            <ul className="money-ledger-tape">
            {displayed.length === 0 && (
              <li className="money-instrument-empty">
                {accountScoped.length === 0
                  ? 'No entries — log one below.'
                  : 'No entries match these filters.'}
              </li>
            )}
            {displayed.map((entry) =>
              entry.kind === 'paycheck' ? (
                <MoneyLedgerPaycheckRow
                  key={`paycheck-${entry.paycheck.id}`}
                  paycheck={entry.paycheck}
                  accountName={
                    selectedAccountId === null && entry.paycheck.accountId
                      ? accountMap.get(entry.paycheck.accountId) ?? null
                      : null
                  }
                />
              ) : (
                <MoneyLedgerRow
                  key={entry.txn.id}
                  txn={entry.txn}
                  balanceCents={balanceById.get(entry.txn.id) ?? 0}
                  categoryMap={categoryMap}
                  accountMap={accountMap}
                  categoryOptions={categoryOptions}
                  accountOptions={accountOptions}
                  showAccountTag={selectedAccountId === null}
                  busy={busy}
                  expanded={expandedId === entry.txn.id}
                  onToggle={() => setExpandedId((id) => (id === entry.txn.id ? null : entry.txn.id))}
                  onMutate={onMutate}
                  onDeleted={(token, label) => {
                    setExpandedId(null)
                    setUndo({ token, label })
                  }}
                  onFilterTag={(tag) => patchFilter({ tag })}
                />
              )
            )}
          </ul>
        </div>
        </div>

        <div className="money-register-manual">
          <button
            type="button"
            className={['money-chip', manualOpen ? 'money-chip--accent' : ''].filter(Boolean).join(' ')}
            aria-expanded={manualOpen}
            onClick={toggleManualEntry}
          >
            Manual entry
          </button>
          {!manualOpen && (
            <span className="money-register-manual-hint">
              Typed amounts, transfers, and adjustments.
            </span>
          )}
        </div>

        {manualOpen && (
        <form
          className={['money-register-entry', entryPulse ? 'money-register-entry--pulse' : ''].join(
            ' '
          )}
          onSubmit={(event) => {
            event.preventDefault()
            submitEntry()
          }}
        >
          <div className="money-register-entry-top">
            <div className="money-kind-toggle money-kind-toggle--register">
              {availableEntryKinds(accounts.length).map((kind) => (
                <button
                  key={kind.value}
                  type="button"
                  className={['money-kind', entryType === kind.value ? 'money-kind--active' : ''].join(' ')}
                  onClick={() => setEntryType(kind.value)}
                >
                  {kind.label}
                </button>
              ))}
            </div>

            {entryType === 'adjustment' && (
              <button
                type="button"
                className="money-sign-toggle"
                onClick={() => setAdjustSign((sign) => (sign === -1 ? 1 : -1))}
                aria-label={adjustSign === -1 ? 'Negative adjustment' : 'Positive adjustment'}
              >
                {adjustSign === -1 ? '−' : '+'}
              </button>
            )}

            <input
              className="money-input money-input--register money-mono"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              aria-label="Amount"
            />
            <input
              className="money-input money-input--register"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              placeholder={entryType === 'transfer' ? 'Memo (optional)' : 'Memo / payee'}
              aria-label="Memo or payee"
              list={PAYEE_DATALIST_ID}
            />
            <datalist id={PAYEE_DATALIST_ID}>
              {payees.map((payee) => (
                <option key={payee.id} value={payee.name} />
              ))}
            </datalist>

            <input
              type="date"
              className="money-input money-input--register money-mono"
              value={entryDate}
              onChange={(event) =>
                setEntryDate(event.target.value || defaultEntryDayKey(periodKey))
              }
              aria-label="Date"
            />

            {entryType === 'transfer' ? (
              <>
                <MossSelect
                  className="money-select--register"
                  value={entryAccountId}
                  options={accountOptions.filter((option) => option.value !== '')}
                  onChange={setEntryAccountId}
                  placeholder="From account"
                  ariaLabel="From account"
                />
                <MossSelect
                  className="money-select--register"
                  value={transferToId}
                  options={transferToOptions}
                  onChange={setTransferToId}
                  placeholder="To account"
                  ariaLabel="To account"
                />
              </>
            ) : (
              <>
                <MossSelect
                  className="money-select--register"
                  value={categoryId}
                  options={categoryOptions}
                  onChange={setCategoryId}
                  placeholder="Envelope"
                  ariaLabel="Envelope"
                />
                {accounts.length > 0 && (
                  <MossSelect
                    className="money-select--register"
                    value={entryAccountId}
                    options={accountOptions}
                    onChange={setEntryAccountId}
                    placeholder="No account"
                    ariaLabel="Account"
                  />
                )}
              </>
            )}

            <button
              type="button"
              className={['money-chip', showMore ? 'money-chip--accent' : '']
                .filter(Boolean)
                .join(' ')}
              aria-pressed={showMore}
              onClick={() => setShowMore((value) => !value)}
            >
              More
            </button>
            <button type="submit" className="money-button money-button--compact" disabled={busy}>
              {entryType === 'transfer' ? 'Move' : 'Post'}
            </button>
          </div>

          {showMore && (
            <div className="money-entry-more">
              <label className="money-ledger-field">
                <span className="money-ledger-field-label">Status</span>
                <MossSelect
                  value={entryStatus}
                  options={ENTRY_STATUS_OPTIONS}
                  onChange={(value) => setEntryStatus(value as TransactionStatus)}
                  ariaLabel="Status"
                />
              </label>
              <label className="money-ledger-field money-ledger-field--wide">
                <span className="money-ledger-field-label">Notes</span>
                <input
                  className="money-input money-input--register"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Optional detail"
                  aria-label="Notes"
                />
              </label>
              <label className="money-ledger-field">
                <span className="money-ledger-field-label">Tags</span>
                <input
                  className="money-input money-input--register"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="comma, separated"
                  aria-label="Tags"
                />
              </label>
            </div>
          )}

        </form>
        )}
      </section>
    </div>
  )
}
