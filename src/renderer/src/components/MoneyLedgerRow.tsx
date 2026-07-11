import { useEffect, useState } from 'react'
import type {
  LedgerAuditRecord,
  PaycheckRecord,
  TransactionRecord,
  TransactionStatus,
  TransactionType
} from '@shared/money'
import {
  dayKeyToIso,
  formatMoneyCents,
  isoToDayKey,
  parseMoneyInput,
  tagsFromInput,
  transactionStatusLabel,
  transactionTypeLabel
} from '@shared/money'
import { MossSelect, type MossSelectOption } from './MossSelect'
import { MoneyMerchantChip } from './MoneyMerchantChip'

interface MoneyLedgerRowProps {
  txn: TransactionRecord
  balanceCents: number
  categoryMap: Map<string, string>
  accountMap: Map<string, string>
  categoryOptions: MossSelectOption[]
  accountOptions: MossSelectOption[]
  showAccountTag: boolean
  busy: boolean
  expanded: boolean
  onToggle: () => void
  onMutate: (task: () => Promise<void>) => Promise<void>
  onDeleted: (undoToken: string, label: string) => void
  onFilterTag: (tag: string) => void
}

const STATUS_NEXT: Record<TransactionStatus, TransactionStatus> = {
  pending: 'cleared',
  cleared: 'reconciled',
  reconciled: 'pending'
}

const TYPE_GLYPH: Record<TransactionType, string> = {
  income: '↑',
  expense: '↓',
  transfer: '⇄',
  adjustment: '±'
}

const EDIT_TYPE_OPTIONS: MossSelectOption[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'adjustment', label: 'Adjustment' }
]

const STATUS_OPTIONS: MossSelectOption[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'cleared', label: 'Cleared' },
  { value: 'reconciled', label: 'Reconciled' }
]

function formatTapeDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(iso))
}

/**
 * Display-only income row merged into the register at read time (QA2-08).
 * Paychecks live in budget_paychecks — never in transactions (A2's
 * no-double-count invariant) — so this row is not editable here and never
 * feeds the net/balance math. Manage it on the Budget tab.
 */
export function MoneyLedgerPaycheckRow({
  paycheck,
  accountName
}: {
  paycheck: PaycheckRecord
  accountName: string | null
}): React.JSX.Element {
  return (
    <li className="money-ledger-entry money-ledger-entry--paycheck">
      <div
        className="money-ledger-row money-mono money-ledger-row--paycheck"
        title="Income — funds your budget. Manage paychecks on the Budget tab."
      >
        <span className="money-ledger-date">{formatTapeDate(paycheck.receivedAt)}</span>
        <span className="money-ledger-main">
          <span className="money-ledger-memo-line">
            <MoneyMerchantChip label={paycheck.label} />
            <span
              className="money-ledger-type money-ledger-type--income"
              aria-label="Income"
              title="Income"
            >
              {TYPE_GLYPH.income}
            </span>
            <span className="money-ledger-memo">{paycheck.label}</span>
          </span>
          {accountName && (
            <span className="money-ledger-meta">
              <span className="money-ledger-account-tag">{accountName}</span>
            </span>
          )}
        </span>
        <span className="money-ledger-category">
          <span className="money-ledger-paycheck-flag">Funds budget</span>
        </span>
        <span className="money-ledger-amount money-ledger-amount--in">
          {formatMoneyCents(paycheck.amountCents)}
        </span>
        <span className="money-ledger-balance" aria-hidden>
          —
        </span>
        <span className="money-status-pill money-status-pill--cleared">Received</span>
        <span className="money-ledger-caret" aria-hidden />
      </div>
    </li>
  )
}

function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso))
}

export function MoneyLedgerRow({
  txn,
  balanceCents,
  categoryMap,
  accountMap,
  categoryOptions,
  accountOptions,
  showAccountTag,
  busy,
  expanded,
  onToggle,
  onMutate,
  onDeleted,
  onFilterTag
}: MoneyLedgerRowProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [audit, setAudit] = useState<LedgerAuditRecord[] | null>(null)

  const isSplit = txn.splits.length > 0
  const isTransfer = txn.type === 'transfer'
  const isStructured = isSplit || isTransfer
  // Transfers and splits keep their structure on edit; only annotations change.
  const restrictedEdit = isStructured

  // —— Inline editor state ——
  const [editType, setEditType] = useState<TransactionType>(txn.type)
  const [editAmount, setEditAmount] = useState(() =>
    (Math.abs(txn.amountCents) / 100).toFixed(2)
  )
  const [editSign, setEditSign] = useState<1 | -1>(txn.amountCents < 0 ? -1 : 1)
  const [editDate, setEditDate] = useState(() => isoToDayKey(txn.occurredAt))
  const [editMemo, setEditMemo] = useState(txn.memo)
  const [editNotes, setEditNotes] = useState(txn.notes)
  const [editTags, setEditTags] = useState(txn.tags.join(', '))
  const [editCategory, setEditCategory] = useState(txn.categoryId ?? '')
  const [editAccount, setEditAccount] = useState(txn.accountId ?? '')
  const [editStatus, setEditStatus] = useState<TransactionStatus>(txn.status)

  useEffect(() => {
    if (!expanded) {
      setEditing(false)
      return
    }
    let active = true
    void window.moss.money
      .getTransactionAudit(txn.id)
      .then((rows) => {
        if (active) setAudit(rows)
      })
      .catch(() => {
        if (active) setAudit([])
      })
    return () => {
      active = false
    }
  }, [expanded, txn.id, txn.updatedAt])

  function beginEdit(): void {
    setEditType(txn.type)
    setEditAmount((Math.abs(txn.amountCents) / 100).toFixed(2))
    setEditSign(txn.amountCents < 0 ? -1 : 1)
    setEditDate(isoToDayKey(txn.occurredAt))
    setEditMemo(txn.memo)
    setEditNotes(txn.notes)
    setEditTags(txn.tags.join(', '))
    setEditCategory(txn.categoryId ?? '')
    setEditAccount(txn.accountId ?? '')
    setEditStatus(txn.status)
    setEditing(true)
  }

  function saveEdit(): void {
    const occurredAt = dayKeyToIso(editDate)
    if (restrictedEdit) {
      // Preserve structure (amount / accounts / splits); only annotations + date + status move.
      void onMutate(async () => {
        await window.moss.money.updateTransaction({
          id: txn.id,
          amountCents: txn.amountCents,
          type: txn.type,
          status: editStatus,
          categoryId: txn.categoryId,
          payeeName: editMemo.trim() || undefined,
          memo: editMemo.trim(),
          notes: editNotes.trim(),
          tags: tagsFromInput(editTags),
          occurredAt,
          accountId: txn.accountId,
          splits: isSplit
            ? txn.splits.map((line) => ({
                categoryId: line.categoryId,
                amountCents: line.amountCents,
                memo: line.memo
              }))
            : undefined
        })
        setEditing(false)
      })
      return
    }

    const magnitude = parseMoneyInput(editAmount)
    if (magnitude === null || magnitude <= 0) return
    const signedAmount =
      editType === 'income' ? magnitude : editType === 'expense' ? -magnitude : editSign * magnitude

    void onMutate(async () => {
      await window.moss.money.updateTransaction({
        id: txn.id,
        amountCents: signedAmount,
        type: editType,
        status: editStatus,
        categoryId: editCategory || null,
        payeeName: editMemo.trim() || undefined,
        memo: editMemo.trim(),
        notes: editNotes.trim(),
        tags: tagsFromInput(editTags),
        occurredAt,
        accountId: editAccount || null
      })
      setEditing(false)
    })
  }

  function cycleStatus(): void {
    void onMutate(async () => {
      await window.moss.money.setTransactionStatus({ id: txn.id, status: STATUS_NEXT[txn.status] })
    })
  }

  function deleteRow(): void {
    void onMutate(async () => {
      const result = await window.moss.money.deleteTransaction(txn.id)
      if (result.undoToken) {
        onDeleted(result.undoToken, txn.memo || transactionTypeLabel(txn.type))
      }
    })
  }

  function revertRow(): void {
    void onMutate(async () => {
      await window.moss.money.revertTransaction(txn.id)
    })
  }

  const accountName = showAccountTag && txn.accountId ? accountMap.get(txn.accountId) : null
  const transferName = txn.transferAccountId ? accountMap.get(txn.transferAccountId) : null
  const categoryLabel = isSplit
    ? txn.splits
        .map((line) =>
          line.categoryId && categoryMap.has(line.categoryId)
            ? categoryMap.get(line.categoryId)
            : 'Uncategorized'
        )
        .join(', ')
    : txn.categoryId && categoryMap.has(txn.categoryId)
      ? categoryMap.get(txn.categoryId)
      : '—'
  const canRevert = (audit ?? []).some((entry) => entry.action === 'edited')
  // Flag spending that never got an envelope so it's findable (matches the cockpit
  // "unfiled spending" warning + the ledger's "No envelope / Unfiled" filter).
  const isUnfiled = !isSplit && !isTransfer && txn.type === 'expense' && !txn.categoryId
  const payeeName = txn.payeeName?.trim() ?? ''
  const memoText = txn.memo.trim()
  const primaryLabel = payeeName || memoText || transactionTypeLabel(txn.type)
  const detailMemo =
    payeeName && memoText && payeeName.toLowerCase() !== memoText.toLowerCase() ? memoText : null

  return (
    <li className={['money-ledger-entry', expanded ? 'money-ledger-entry--open' : ''].filter(Boolean).join(' ')}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="money-ledger-row money-mono"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
      >
        <span className="money-ledger-date">{formatTapeDate(txn.occurredAt)}</span>
        <span className="money-ledger-main">
          <span className="money-ledger-memo-line">
            <MoneyMerchantChip label={primaryLabel} />
            <span
              className={`money-ledger-type money-ledger-type--${txn.type}`}
              aria-label={transactionTypeLabel(txn.type)}
              title={transactionTypeLabel(txn.type)}
            >
              {TYPE_GLYPH[txn.type]}
            </span>
            <span className="money-ledger-memo">
              {primaryLabel}
              {detailMemo && (
                <span className="money-ledger-memo-detail"> · {detailMemo}</span>
              )}
              {transferName && <span className="money-ledger-transfer-to"> · {transferName}</span>}
            </span>
          </span>
          {(accountName || txn.tags.length > 0) && (
            <span className="money-ledger-meta">
              {accountName && <span className="money-ledger-account-tag">{accountName}</span>}
              {txn.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="money-tag"
                  onClick={(event) => {
                    event.stopPropagation()
                    onFilterTag(tag)
                  }}
                >
                  #{tag}
                </button>
              ))}
            </span>
          )}
        </span>
        <span className="money-ledger-category">
          {isUnfiled ? (
            <span className="money-ledger-unfiled-flag" title="No envelope — unfiled spending">
              Unfiled
            </span>
          ) : (
            categoryLabel
          )}
        </span>
        <span
          className={[
            'money-ledger-amount',
            txn.amountCents >= 0 ? 'money-ledger-amount--in' : 'money-ledger-amount--out'
          ].join(' ')}
        >
          {formatMoneyCents(txn.amountCents)}
        </span>
        <span className="money-ledger-balance">{formatMoneyCents(balanceCents)}</span>
        <button
          type="button"
          className={`money-status-pill money-status-pill--${txn.status}`}
          disabled={busy}
          title={`${transactionStatusLabel(txn.status)} — click to change`}
          aria-label={`Status ${transactionStatusLabel(txn.status)}, click to change`}
          onClick={(event) => {
            event.stopPropagation()
            cycleStatus()
          }}
        >
          {transactionStatusLabel(txn.status)}
        </button>
        <span className="money-ledger-caret" aria-hidden>
          ▸
        </span>
      </div>

      {expanded && (
        <div className="money-ledger-inspector">
          {editing ? (
            <div className="money-ledger-editor">
              {isTransfer && (
                <p className="money-ledger-editor-note">
                  Transfer — amount and accounts are fixed. Delete and re-add to change them.
                </p>
              )}
              <div className="money-ledger-editor-grid">
                {!restrictedEdit && (
                  <label className="money-ledger-field">
                    <span className="money-ledger-field-label">Type</span>
                    <MossSelect
                      value={editType}
                      options={EDIT_TYPE_OPTIONS}
                      onChange={(value) => setEditType(value as TransactionType)}
                      ariaLabel="Type"
                    />
                  </label>
                )}
                {!restrictedEdit && (
                  <label className="money-ledger-field">
                    <span className="money-ledger-field-label">Amount</span>
                    <span className="money-ledger-amount-field">
                      {editType === 'adjustment' && (
                        <button
                          type="button"
                          className="money-sign-toggle"
                          onClick={() => setEditSign((sign) => (sign === -1 ? 1 : -1))}
                          aria-label={editSign === -1 ? 'Negative' : 'Positive'}
                        >
                          {editSign === -1 ? '−' : '+'}
                        </button>
                      )}
                      <input
                        className="money-input money-input--register money-mono"
                        value={editAmount}
                        onChange={(event) => setEditAmount(event.target.value)}
                        inputMode="decimal"
                        aria-label="Amount"
                      />
                    </span>
                  </label>
                )}
                <label className="money-ledger-field">
                  <span className="money-ledger-field-label">Date</span>
                  <input
                    type="date"
                    className="money-input money-input--register money-mono"
                    value={editDate}
                    onChange={(event) => setEditDate(event.target.value)}
                    aria-label="Date"
                  />
                </label>
                <label className="money-ledger-field">
                  <span className="money-ledger-field-label">Status</span>
                  <MossSelect
                    value={editStatus}
                    options={STATUS_OPTIONS}
                    onChange={(value) => setEditStatus(value as TransactionStatus)}
                    ariaLabel="Status"
                  />
                </label>
                <label className="money-ledger-field money-ledger-field--wide">
                  <span className="money-ledger-field-label">Memo / payee</span>
                  <input
                    className="money-input money-input--register"
                    value={editMemo}
                    onChange={(event) => setEditMemo(event.target.value)}
                    aria-label="Memo or payee"
                  />
                </label>
                {!restrictedEdit && (
                  <label className="money-ledger-field">
                    <span className="money-ledger-field-label">Envelope</span>
                    <MossSelect
                      value={editCategory}
                      options={categoryOptions}
                      onChange={setEditCategory}
                      placeholder="No envelope"
                      ariaLabel="Envelope"
                    />
                  </label>
                )}
                {!restrictedEdit && accountOptions.length > 1 && (
                  <label className="money-ledger-field">
                    <span className="money-ledger-field-label">Account</span>
                    <MossSelect
                      value={editAccount}
                      options={accountOptions}
                      onChange={setEditAccount}
                      placeholder="No account"
                      ariaLabel="Account"
                    />
                  </label>
                )}
                <label className="money-ledger-field money-ledger-field--wide">
                  <span className="money-ledger-field-label">Notes</span>
                  <input
                    className="money-input money-input--register"
                    value={editNotes}
                    onChange={(event) => setEditNotes(event.target.value)}
                    placeholder="Optional detail"
                    aria-label="Notes"
                  />
                </label>
                <label className="money-ledger-field money-ledger-field--wide">
                  <span className="money-ledger-field-label">Tags</span>
                  <input
                    className="money-input money-input--register"
                    value={editTags}
                    onChange={(event) => setEditTags(event.target.value)}
                    placeholder="comma, separated"
                    aria-label="Tags"
                  />
                </label>
              </div>
              <div className="money-ledger-editor-actions">
                <button
                  type="button"
                  className="money-button money-button--compact"
                  disabled={busy}
                  onClick={saveEdit}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="money-button money-button--ghost money-button--compact"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="money-ledger-inspector-actions">
                <button
                  type="button"
                  className="money-button money-button--compact"
                  disabled={busy}
                  onClick={beginEdit}
                >
                  Edit
                </button>
                {canRevert && (
                  <button
                    type="button"
                    className="money-button money-button--ghost money-button--compact"
                    disabled={busy}
                    onClick={revertRow}
                  >
                    Revert last edit
                  </button>
                )}
                <button
                  type="button"
                  className="money-button money-button--ghost money-button--compact money-button--danger"
                  disabled={busy}
                  onClick={deleteRow}
                >
                  Delete
                </button>
              </div>

              <div className="money-ledger-meta-group">
                <dl className="money-ledger-details">
                  <div>
                    <dt>Type</dt>
                    <dd>{transactionTypeLabel(txn.type)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{transactionStatusLabel(txn.status)}</dd>
                  </div>
                  {txn.accountId && (
                    <div>
                      <dt>Account</dt>
                      <dd>{accountMap.get(txn.accountId) ?? '—'}</dd>
                    </div>
                  )}
                  {transferName && (
                    <div>
                      <dt>{txn.amountCents < 0 ? 'To' : 'From'}</dt>
                      <dd>{transferName}</dd>
                    </div>
                  )}
                  {txn.notes && (
                    <div className="money-ledger-details--wide">
                      <dt>Notes</dt>
                      <dd>{txn.notes}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Logged</dt>
                    <dd>{formatStamp(txn.createdAt)}</dd>
                  </div>
                  {txn.updatedAt && (
                    <div>
                      <dt>Edited</dt>
                      <dd>{formatStamp(txn.updatedAt)}</dd>
                    </div>
                  )}
                </dl>

                {isSplit && (
                  <ul className="money-ledger-splits money-mono">
                    {txn.splits.map((line) => (
                      <li key={line.id}>
                        <span>
                          {line.categoryId && categoryMap.has(line.categoryId)
                            ? categoryMap.get(line.categoryId)
                            : 'Uncategorized'}
                        </span>
                        <span>{formatMoneyCents(line.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {audit && audit.length > 0 && (
                  <div className="money-ledger-history">
                    <p className="money-ledger-history-label">History</p>
                    <ul>
                      {audit.map((entry) => (
                        <li key={entry.id}>
                          <span className={`money-ledger-history-dot money-ledger-history-dot--${entry.action}`} aria-hidden />
                          <span className="money-ledger-history-summary">{entry.summary}</span>
                          <span className="money-ledger-history-time money-mono">
                            {formatStamp(entry.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}
