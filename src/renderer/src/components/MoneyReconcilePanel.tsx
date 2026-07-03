import { useEffect, useState } from 'react'
import type { CashAccountBalance, ReconciliationSummary } from '@shared/money'
import { dateKey, dayKeyToIso, formatMoneyCents, parseMoneyInput } from '@shared/money'

interface MoneyReconcilePanelProps {
  account: CashAccountBalance
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
  onClose: () => void
}

export function MoneyReconcilePanel({
  account,
  busy,
  onMutate,
  onClose
}: MoneyReconcilePanelProps): React.JSX.Element {
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null)
  const [statement, setStatement] = useState('')

  useEffect(() => {
    setStatement('')
  }, [account.id])

  useEffect(() => {
    if (busy) return
    let active = true
    void window.moss.money
      .getReconciliation(account.id)
      .then((next) => {
        if (active) setSummary(next)
      })
      .catch(() => {
        if (active) setSummary(null)
      })
    return () => {
      active = false
    }
  }, [account.id, busy])

  const clearedCents = summary?.clearedBalanceCents ?? account.balanceCents
  const statementCents = statement.trim() ? parseMoneyInput(statement) : null
  const differenceCents = statementCents === null ? null : statementCents - clearedCents
  const balanced = differenceCents === 0

  function addAdjustment(): void {
    if (differenceCents === null || differenceCents === 0) return
    void onMutate(async () => {
      await window.moss.money.createTransaction({
        amountCents: differenceCents,
        type: 'adjustment',
        status: 'cleared',
        memo: 'Reconciliation adjustment',
        notes: `Matched ${account.name} to statement`,
        occurredAt: dayKeyToIso(dateKey()),
        accountId: account.id
      })
      setStatement('')
    })
  }

  function markReconciled(): void {
    void onMutate(async () => {
      await window.moss.money.reconcileAccount(account.id)
    })
  }

  return (
    <section className="money-reconcile" aria-label={`Reconcile ${account.name}`}>
      <div className="money-reconcile-head">
        <div>
          <p className="money-instrument-kicker">Reconcile</p>
          <h3 className="money-reconcile-title">{account.name}</h3>
        </div>
        <button
          type="button"
          className="money-button money-button--ghost money-button--compact"
          onClick={onClose}
        >
          Done
        </button>
      </div>

      <div className="money-reconcile-stats">
        <div className="money-reconcile-stat">
          <span className="money-reconcile-stat-label">Cleared balance</span>
          <span className="money-reconcile-stat-value money-mono">{formatMoneyCents(clearedCents)}</span>
        </div>
        <div className="money-reconcile-stat">
          <span className="money-reconcile-stat-label">Working balance</span>
          <span className="money-reconcile-stat-value money-mono">
            {formatMoneyCents(summary?.workingBalanceCents ?? account.balanceCents)}
          </span>
        </div>
        {summary && summary.pendingCount > 0 && (
          <div className="money-reconcile-stat">
            <span className="money-reconcile-stat-label">
              Pending · {summary.pendingCount}
            </span>
            <span className="money-reconcile-stat-value money-mono">
              {formatMoneyCents(summary.pendingCents)}
            </span>
          </div>
        )}
      </div>

      <div className="money-reconcile-match">
        <label className="money-ledger-field">
          <span className="money-ledger-field-label">Your statement balance</span>
          <input
            className="money-input money-input--register money-mono"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="Statement balance"
          />
        </label>

        {differenceCents !== null && (
          <div
            className={[
              'money-reconcile-diff',
              balanced ? 'money-reconcile-diff--ok' : 'money-reconcile-diff--off'
            ].join(' ')}
          >
            {balanced ? (
              <span>Balanced ✓</span>
            ) : (
              <>
                <span className="money-mono">Off by {formatMoneyCents(differenceCents)}</span>
                <button
                  type="button"
                  className="money-button money-button--compact"
                  disabled={busy}
                  onClick={addAdjustment}
                >
                  Add {formatMoneyCents(differenceCents)} adjustment
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="money-reconcile-foot">
        <p className="money-reconcile-hint">
          Mark items cleared as you confirm them against your statement, then lock them in.
        </p>
        {summary && summary.unreconciledCount > 0 && (
          <button
            type="button"
            className="money-button money-button--ghost money-button--compact"
            disabled={busy}
            onClick={markReconciled}
          >
            Mark {summary.unreconciledCount} cleared as reconciled
          </button>
        )}
      </div>
    </section>
  )
}
