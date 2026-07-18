import { useEffect, useState } from 'react'
import type { CategoryGroupRecord, MoneyBudgetOverview } from '@shared/money'
import { formatMoneyCents, parseMoneyInput } from '@shared/money'
import {
  ENVELOPE_ASSIGN_HINT_DISMISSED_KEY,
  ENVELOPE_ASSIGN_VS_SPEND_HINT,
  envelopeRestMetaParts,
  envelopeRolloverEditorHint,
  envelopeRolloverOffConfirmBody
} from '@shared/moneyEnvelope'
import { MossButton } from './MossButton'
import { MossCheckbox } from './MossCheckbox'
import { MossModal } from './MossModal'
import { MossSelect } from './MossSelect'

/** One-time plain-English nudge: assigning ≠ spending (V2.75b). */
export function EnvelopeAssignHint(): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(ENVELOPE_ASSIGN_HINT_DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })

  if (dismissed) return null

  function dismiss(): void {
    setDismissed(true)
    try {
      localStorage.setItem(ENVELOPE_ASSIGN_HINT_DISMISSED_KEY, '1')
    } catch {
      // best-effort persistence only
    }
  }

  return (
    <div className="money-envelope-assign-hint" role="note">
      <p className="money-envelope-assign-hint-copy" title={ENVELOPE_ASSIGN_VS_SPEND_HINT}>
        Assigning money just gives it a job — it stays in your account until you spend it.
      </p>
      <MossButton
        type="button"
        variant="quiet"
        size="sm"
        className="money-envelope-assign-hint-dismiss"
        onClick={dismiss}
      >
        Got it
      </MossButton>
    </div>
  )
}

interface EnvelopeInstrumentRowProps {
  row: MoneyBudgetOverview['categories'][number]
  periodKey: string
  unassignedCents: number
  isSavingsEnvelope: boolean
  groups: CategoryGroupRecord[]
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
  /** Jump to the Ledger filtered to this envelope's transactions. */
  onOpenLedger?: () => void
}

export function EnvelopeInstrumentRow({
  row,
  periodKey,
  unassignedCents,
  isSavingsEnvelope,
  groups,
  busy,
  onMutate,
  onOpenLedger
}: EnvelopeInstrumentRowProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [targetDraft, setTargetDraft] = useState('')
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    if (!pulse) return
    const id = window.setTimeout(() => setPulse(false), 620)
    return () => window.clearTimeout(id)
  }, [pulse])
  const [editing, setEditing] = useState(false)
  const [rolloverOffConfirm, setRolloverOffConfirm] = useState<number | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  useEffect(() => {
    setDraft(row.assignedCents > 0 ? String(row.assignedCents / 100) : '')
  }, [row.assignedCents])

  useEffect(() => {
    setTargetDraft(row.targetCents != null ? String(row.targetCents / 100) : '')
  }, [row.targetCents])

  // Bar measures spend against everything available this period (carried-in + assigned when rollover on).
  const priorBalanceCents = row.carryInCents
  const budgetedCents = row.category.rolloverEnabled
    ? priorBalanceCents + row.assignedCents
    : row.assignedCents
  const spentRatio = budgetedCents > 0 ? Math.min(1, row.spentCents / budgetedCents) : 0
  const overspent = row.remainingCents < 0
  const targetCents = row.targetCents
  const underfunded = targetCents != null && targetCents > 0 && row.assignedCents < targetCents
  const restMeta = envelopeRestMetaParts({
    spentCents: row.spentCents,
    budgetedCents,
    targetCents,
    assignedCents: row.assignedCents,
    carryInCents: priorBalanceCents,
    rolloverEnabled: row.category.rolloverEnabled,
    formatCents: formatMoneyCents
  })

  function applyRollover(next: boolean): void {
    void onMutate(async () => {
      await window.moss.money.setCategoryRollover({
        categoryId: row.category.id,
        rolloverEnabled: next
      })
    })
  }

  async function commitAssignment(nextCents: number): Promise<void> {
    if (nextCents === row.assignedCents) return
    await onMutate(async () => {
      await window.moss.money.setAssignment({
        categoryId: row.category.id,
        periodKey,
        amountCents: Math.max(0, nextCents)
      })
    })
    setPulse(true)
  }

  function commitDraft(): void {
    // Empty box ≠ "assign $0". Clearing the field and clicking away just
    // reverts to the current amount — you set $0 explicitly by typing 0.
    if (draft.trim() === '') {
      setDraft(row.assignedCents > 0 ? String(row.assignedCents / 100) : '')
      return
    }
    const amountCents = parseMoneyInput(draft) ?? 0
    void commitAssignment(amountCents)
  }

  function commitTarget(): void {
    const trimmed = targetDraft.trim()
    const nextTarget = trimmed === '' ? null : parseMoneyInput(targetDraft)
    if (nextTarget === row.targetCents) return
    if (trimmed !== '' && (nextTarget == null || nextTarget < 0)) return
    void onMutate(async () => {
      await window.moss.money.setCategoryTarget({
        categoryId: row.category.id,
        targetCents: nextTarget
      })
    })
  }

  function addFromPool(cents: number): void {
    const add = Math.min(unassignedCents, cents)
    if (add <= 0) return
    void commitAssignment(row.assignedCents + add)
  }

  function fillFromPool(): void {
    if (unassignedCents <= 0) return
    void commitAssignment(row.assignedCents + unassignedCents)
  }

  function fundToTarget(): void {
    if (targetCents == null) return
    const need = targetCents - row.assignedCents
    const add = Math.min(unassignedCents, need)
    if (add <= 0) return
    void commitAssignment(row.assignedCents + add)
  }

  // Honest cover: only pull what's actually unassigned. If the pool can't fully
  // cover the overspend, the rest stays flagged in the top "Overspent" panel, where
  // it can be pulled from another envelope with room.
  function coverFromPool(): void {
    const need = Math.abs(row.remainingCents)
    const add = Math.min(unassignedCents, need)
    if (add <= 0) return
    void commitAssignment(row.assignedCents + add)
  }

  function toggleEditing(): void {
    setEditing((value) => !value)
  }

  return (
    <li
      className={[
        'money-envelope-instrument',
        editing ? 'money-envelope-instrument--editing' : '',
        pulse ? 'money-envelope-instrument--pulse' : '',
        overspent ? 'money-envelope-instrument--overspent' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {rolloverOffConfirm != null && (
        <MossModal
          onClose={() => setRolloverOffConfirm(null)}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy={`money-rollover-off-title-${row.category.id}`}
        >
          <div className="calendar-event-modal">
            <h2 id={`money-rollover-off-title-${row.category.id}`} className="calendar-event-modal-title">
              {rolloverOffConfirm < 0 ? 'Release carried overspend?' : 'Turn off rollover?'}
            </h2>
            <p className="money-group-modal-help">
              {envelopeRolloverOffConfirmBody(
                row.category.name,
                rolloverOffConfirm,
                formatMoneyCents
              )}
            </p>
            <div className="calendar-event-modal-actions">
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setRolloverOffConfirm(null)}
                autoFocus
              >
                Cancel
              </MossButton>
              <MossButton
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setRolloverOffConfirm(null)
                  applyRollover(false)
                }}
              >
                Move {rolloverOffConfirm < 0 ? 'overspend' : 'pile'} to to assign
              </MossButton>
            </div>
          </div>
        </MossModal>
      )}
      <div
        className="money-envelope-summary"
        role="button"
        tabIndex={0}
        aria-expanded={editing}
        onClick={toggleEditing}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggleEditing()
          }
        }}
      >
        <div className="money-envelope-instrument-top">
          <span className="money-envelope-instrument-name">{row.category.name}</span>
          <span className="money-envelope-summary-right">
            <span
              className={[
                'money-envelope-instrument-remaining',
                'money-mono',
                overspent ? 'money-envelope-instrument-remaining--over' : ''
              ].join(' ')}
            >
              {formatMoneyCents(row.remainingCents)} left
            </span>
            <svg
              className="money-envelope-summary-caret"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden
            >
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>

        <div className="money-envelope-bar money-envelope-bar--instrument" aria-hidden>
          <span
            className="money-envelope-bar-fill"
            style={{ width: `${Math.round(spentRatio * 100)}%` }}
          />
        </div>

        <div className="money-envelope-instrument-meta money-mono">
          {restMeta.spentLine}
          {restMeta.carryInClause && (
            <span className="money-envelope-carry"> · {restMeta.carryInClause}</span>
          )}
          {restMeta.goalClause && (
            <span className="money-envelope-target--under"> · {restMeta.goalClause}</span>
          )}
          {restMeta.overspendClause && (
            <span className="money-envelope-target--under"> · {restMeta.overspendClause}</span>
          )}
        </div>
      </div>

      {editing && (
        <div className="money-envelope-editor">
          <div className="money-envelope-editor-field">
            <label className="money-envelope-editor-label">
              Assigned this month
              <input
                className="money-input money-input--assign money-mono"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commitDraft()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitDraft()
                  }
                }}
                inputMode="decimal"
                placeholder="0"
                aria-label={`Assigned amount for ${row.category.name}`}
              />
            </label>
            <p className="money-envelope-editor-hint">
              Type how much of your money this envelope gets — or use the buttons below.
            </p>
          </div>

          {unassignedCents > 0 && (
            <div className="money-envelope-editor-field">
              <span className="money-envelope-editor-label">
                Add from {formatMoneyCents(unassignedCents)} left to assign
              </span>
              <div className="money-envelope-quick">
                <button type="button" className="money-chip" disabled={busy} onClick={() => addFromPool(2500)}>
                  +$25
                </button>
                <button type="button" className="money-chip" disabled={busy} onClick={() => addFromPool(5000)}>
                  +$50
                </button>
                <button
                  type="button"
                  className="money-chip money-chip--accent"
                  disabled={busy}
                  onClick={() => fillFromPool()}
                  title="Assign everything you have left to assign"
                >
                  Assign the rest
                </button>
              </div>
            </div>
          )}

          <div className="money-envelope-editor-field">
            <MossCheckbox
              label="Counts toward safe to spend"
              checked={row.category.countsTowardSafeToSpend}
              disabled={busy || isSavingsEnvelope}
              onChange={(event) => {
                const next = event.target.checked
                if (next === row.category.countsTowardSafeToSpend) return
                void onMutate(async () => {
                  await window.moss.money.setCategorySpendPolicy({
                    categoryId: row.category.id,
                    countsTowardSafeToSpend: next
                  })
                })
              }}
            />
            <p className="money-envelope-editor-hint">
              {isSavingsEnvelope
                ? 'Savings goals stay protected — not included in everyday spending.'
                : 'Uncheck for bills and fixed costs you do not spend from casually — like rent or insurance.'}
            </p>
          </div>

          <div className="money-envelope-editor-field">
            <MossCheckbox
              label="Roll unspent into next month"
              checked={row.category.rolloverEnabled}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.checked
                if (next === row.category.rolloverEnabled) return
                if (!next && row.category.rolloverEnabled && priorBalanceCents !== 0) {
                  setRolloverOffConfirm(priorBalanceCents)
                  return
                }
                applyRollover(next)
              }}
            />
            <p className="money-envelope-editor-hint">
              {envelopeRolloverEditorHint({
                rolloverEnabled: row.category.rolloverEnabled,
                priorBalanceCents,
                releasedCents: row.category.rolloverReleasedCents,
                remainingCents: row.remainingCents,
                formatCents: formatMoneyCents
              })}
            </p>
          </div>

          <div className="money-envelope-editor-field">
            <label className="money-envelope-editor-label">
              Monthly goal (optional)
              <input
                className="money-input money-input--assign money-mono"
                value={targetDraft}
                onChange={(event) => setTargetDraft(event.target.value)}
                onBlur={() => commitTarget()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitTarget()
                  }
                }}
                inputMode="decimal"
                placeholder="No goal"
                aria-label={`Monthly goal for ${row.category.name}`}
              />
            </label>
            <p className="money-envelope-editor-hint">
              The finish line, not the deposit — assigning moves money in; the goal is what this
              envelope needs by month-end. Once spending reaches it (say a $300 car payment), MOSS
              counts this envelope as handled and stops warning about it.
            </p>
            {underfunded && unassignedCents > 0 && (
              <button
                type="button"
                className="money-chip money-chip--accent money-envelope-editor-action"
                disabled={busy}
                onClick={() => fundToTarget()}
              >
                Fund to goal
              </button>
            )}
          </div>

          {overspent && unassignedCents > 0 && (
            <button
              type="button"
              className="money-chip money-chip--accent money-envelope-editor-action"
              disabled={busy}
              onClick={() => coverFromPool()}
            >
              Cover {formatMoneyCents(Math.min(unassignedCents, Math.abs(row.remainingCents)))} from
              unassigned
            </button>
          )}
          {overspent && unassignedCents <= 0 && (
            <p className="money-envelope-editor-hint">
              Overspent by {formatMoneyCents(Math.abs(row.remainingCents))}. Cover it from the
              Overspent panel up top — you can pull from another envelope that has room.
            </p>
          )}

          {groups.length > 0 && (
            <div className="money-envelope-editor-field">
              <span className="money-envelope-editor-label" id={`money-group-of-${row.category.id}`}>
                Group
              </span>
              <MossSelect
                className="money-select--inline"
                value={row.category.groupId ?? ''}
                options={[
                  { value: '', label: 'Other (no group)' },
                  ...groups.map((group) => ({ value: group.id, label: group.name }))
                ]}
                onChange={(value) => {
                  const nextGroupId = value === '' ? null : value
                  if (nextGroupId === (row.category.groupId ?? null)) return
                  void onMutate(async () => {
                    await window.moss.money.setCategoryGroup({
                      categoryId: row.category.id,
                      groupId: nextGroupId
                    })
                  })
                }}
                ariaLabel={`Group for ${row.category.name}`}
              />
              <p className="money-envelope-editor-hint">
                Move this envelope into a group — or back to “Other”.
              </p>
            </div>
          )}

          {onOpenLedger && (
            <button
              type="button"
              className="money-chip money-envelope-editor-action"
              onClick={onOpenLedger}
              title={`Open the Ledger filtered to ${row.category.name}`}
            >
              See spending in Ledger
            </button>
          )}

          <MossButton
            type="button"
            variant="quiet"
            size="sm"
            className="money-envelope-delete-full"
            disabled={busy}
            onClick={() => setDeleteConfirm(true)}
          >
            Delete envelope
          </MossButton>
        </div>
      )}

      {deleteConfirm && (
        <MossModal
          onClose={() => setDeleteConfirm(false)}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy={`money-delete-envelope-title-${row.category.id}`}
        >
          <div className="calendar-event-modal">
            <h2
              id={`money-delete-envelope-title-${row.category.id}`}
              className="calendar-event-modal-title"
            >
              Delete the “{row.category.name}” envelope?
            </h2>
            <p className="money-group-modal-help">
              Its transactions stay in the Ledger as unfiled, and money assigned here returns to
              your pool. The envelope itself can&rsquo;t be restored.
            </p>
            <div className="calendar-event-modal-actions">
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setDeleteConfirm(false)}
                autoFocus
              >
                Cancel
              </MossButton>
              <MossButton
                type="button"
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDeleteConfirm(false)
                  void onMutate(async () => {
                    await window.moss.money.deleteCategory(row.category.id)
                  })
                }}
              >
                Delete envelope
              </MossButton>
            </div>
          </div>
        </MossModal>
      )}
    </li>
  )
}

