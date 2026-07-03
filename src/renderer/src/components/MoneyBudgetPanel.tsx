import { useEffect, useMemo, useState } from 'react'
import type {
  BudgetRuleRecord,
  CashAccountBalance,
  CategoryBudgetRow,
  CategoryGroupRecord,
  MoneyBudgetOverview,
  PaycheckRecord,
  ScheduleRecord
} from '@shared/money'
import type { MoneyFlowGuidance, MoneyFlowSettings } from '@shared/moneyFlow'
import { computeMonthWrapUp } from '@shared/moneyFlow'
import {
  currentPeriodKey,
  dateKey,
  dayKeyToIso,
  formatMoneyCents,
  formatPeriodLabel,
  isCreditAccountType,
  isoToDayKey,
  parseMoneyInput
} from '@shared/money'
import type { SavingsOverview } from '@shared/moneySavings'
import { MoneySchedulesPanel } from './MoneySchedulesPanel'
import { MoneyRulesPanel } from './MoneyRulesPanel'
import { MoneyFlowPanel } from './MoneyFlowPanel'
import { MoneyMonthWrapCard } from './MoneyMonthWrapCard'
import { MoneySavingsPanel } from './MoneySavingsPanel'
import {
  ENVELOPE_ASSIGN_HINT_DISMISSED_KEY,
  ENVELOPE_ASSIGN_VS_SPEND_HINT,
  envelopeRestMetaParts,
  envelopeRolloverEditorHint,
  envelopeRolloverOffConfirmBody
} from '@shared/moneyEnvelope'
import { MossModal } from './MossModal'
import { MossSelect } from './MossSelect'
import type { MoneyMutateFn } from '../moneyMutate'

/** Sentinel option values for the envelope group picker (actions, not real groups). */
const GROUP_ACTION_NEW = '__new_group__'
const GROUP_ACTION_EDIT = '__edit_groups__'

interface MoneyBudgetPanelProps {
  budget: MoneyBudgetOverview
  savingsOverview: SavingsOverview
  savingsCategoryIds: Set<string>
  accounts: CashAccountBalance[]
  schedules: ScheduleRecord[]
  rules: BudgetRuleRecord[]
  flowGuidance: MoneyFlowGuidance | null
  flowSettings: MoneyFlowSettings | null
  advancedToolsEnabled: boolean
  busy: boolean
  onMutate: MoneyMutateFn
  /** Deep-link to the ledger filtered to unfiled rows (from the drift warning). */
  onFindUnfiled?: () => void
  /** Deep-link to the ledger filtered to a savings goal envelope. */
  onOpenLedgerForCategory?: (categoryId: string) => void
}

interface EnvelopeSection {
  id: string
  title: string
  rows: CategoryBudgetRow[]
}

function buildEnvelopeSections(
  budget: MoneyBudgetOverview,
  savingsCategoryIds: Set<string>
): EnvelopeSection[] {
  const byGroupId = new Map<string | null, CategoryBudgetRow[]>()

  for (const row of budget.categories) {
    if (savingsCategoryIds.has(row.category.id)) continue
    const key = row.category.groupId
    const list = byGroupId.get(key) ?? []
    list.push(row)
    byGroupId.set(key, list)
  }

  const sections: EnvelopeSection[] = []
  const sortedGroups = [...budget.groups].sort((a, b) => a.sortOrder - b.sortOrder)

  for (const group of sortedGroups) {
    const rows = byGroupId.get(group.id)
    if (rows?.length) {
      sections.push({ id: group.id, title: group.name, rows })
    }
    byGroupId.delete(group.id)
  }

  const other: CategoryBudgetRow[] = [...(byGroupId.get(null) ?? [])]
  for (const [groupId, rows] of Array.from(byGroupId.entries())) {
    if (groupId) other.push(...rows)
  }
  if (other.length > 0) {
    sections.push({ id: 'other', title: 'Other', rows: other })
  }

  return sections
}

export function MoneyBudgetPanel({
  budget,
  savingsOverview,
  savingsCategoryIds,
  accounts,
  schedules,
  rules,
  flowGuidance,
  flowSettings,
  advancedToolsEnabled,
  busy,
  onMutate,
  onFindUnfiled,
  onOpenLedgerForCategory
}: MoneyBudgetPanelProps): React.JSX.Element {
  const [paycheckLabel, setPaycheckLabel] = useState('Paycheck')
  const [paycheckAmount, setPaycheckAmount] = useState('')
  const [paycheckDate, setPaycheckDate] = useState(() => dateKey())
  const [paycheckAccountId, setPaycheckAccountId] = useState('')
  const [editPaycheck, setEditPaycheck] = useState<PaycheckRecord | null>(null)
  const [editPaycheckLabel, setEditPaycheckLabel] = useState('')
  const [editPaycheckAmount, setEditPaycheckAmount] = useState('')
  const [editPaycheckDate, setEditPaycheckDate] = useState(() => dateKey())
  const [editPaycheckAccountId, setEditPaycheckAccountId] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [categorySpendKind, setCategorySpendKind] = useState<'everyday' | 'bill'>('everyday')
  // Empty = no group chosen. New envelopes with no group simply fall into "Other" —
  // there's deliberately no "No group" item; the resting state is the greyed
  // "+ New group" placeholder.
  const [categoryGroupId, setCategoryGroupId] = useState('')
  const [groupModal, setGroupModal] = useState<'create' | 'edit' | null>(null)
  const [groupDraftName, setGroupDraftName] = useState('')
  // Deleting a group is destructive enough to confirm first — a stray click on the
  // header × shouldn't silently ungroup envelopes.
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<{
    id: string
    title: string
    count: number
  } | null>(null)
  const [savingsError, setSavingsError] = useState<string | null>(null)

  const envelopeSweepCents = useMemo(() => {
    const readout = computeMonthWrapUp({
      budget,
      savingsCategoryIds,
      isCurrentPeriod: budget.periodKey === currentPeriodKey()
    })
    return readout.eligible ? readout.discretionaryLeftoverCents : 0
  }, [budget, savingsCategoryIds])

  const envelopeSections = useMemo(
    () => buildEnvelopeSections(budget, savingsCategoryIds),
    [budget, savingsCategoryIds]
  )

  // Collapsible groups keep a long budget legible — remember the user's choice
  // across reloads. Stored by group id; "Other" included.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('moss.money.collapsedGroups')
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('moss.money.collapsedGroups', JSON.stringify(Array.from(collapsedGroups)))
    } catch {
      // best-effort persistence only
    }
  }, [collapsedGroups])

  function toggleGroup(id: string): void {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allCollapsed =
    envelopeSections.length > 1 && envelopeSections.every((s) => collapsedGroups.has(s.id))

  function toggleAllGroups(): void {
    setCollapsedGroups(allCollapsed ? new Set() : new Set(envelopeSections.map((s) => s.id)))
  }

  // If the chosen group is deleted out from under us, fall back to "Other" (no group).
  useEffect(() => {
    if (categoryGroupId && !budget.groups.some((group) => group.id === categoryGroupId)) {
      setCategoryGroupId('')
    }
  }, [budget.groups, categoryGroupId])

  const groupSelectOptions = useMemo(() => {
    if (budget.groups.length === 0) {
      return [{ value: GROUP_ACTION_NEW, label: '+ New group' }]
    }
    return [
      ...budget.groups.map((group) => ({ value: group.id, label: group.name })),
      { value: GROUP_ACTION_NEW, label: '+ New group' },
      { value: GROUP_ACTION_EDIT, label: 'Edit groups' }
    ]
  }, [budget.groups])

  function handleGroupSelect(value: string): void {
    if (value === GROUP_ACTION_NEW) {
      setGroupDraftName('')
      setGroupModal('create')
      return
    }
    if (value === GROUP_ACTION_EDIT) {
      setGroupModal('edit')
      return
    }
    setCategoryGroupId(value)
  }

  async function createGroup(): Promise<void> {
    const name = groupDraftName.trim()
    if (!name) return
    await onMutate(async () => {
      const created = (await window.moss.money.createCategoryGroup({ name })) as { id?: string }
      if (created?.id) {
        setCategoryGroupId(created.id)
      }
    })
    setGroupDraftName('')
    setGroupModal(null)
  }

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

  // Brand-new budget: no income and no envelopes yet. Lead with a warm "start here"
  // panel instead of a row of zeros, and open the income form so step 1 is right there.
  const isFresh = budget.paychecks.length === 0 && budget.categories.length === 0

  // Move money INTO an overspent envelope from a chosen source — the unassigned pool or
  // another envelope's available balance. Capped at the source's remaining ("X left") so its
  // available never drops below zero and money is never created. Pulling from an envelope
  // lowers its THIS-PERIOD assignment, which may go negative — valid under carry-forward
  // (pulling previously-assigned money back out; see MONEY_ARCHITECTURE.md Rollover semantics).
  async function coverOverspend(
    targetCategoryId: string,
    sourceValue: string,
    needCents: number
  ): Promise<void> {
    const targetAssigned =
      budget.categories.find((row) => row.category.id === targetCategoryId)?.assignedCents ?? 0

    if (sourceValue === 'pool') {
      const amount = Math.min(needCents, budget.unassignedCents)
      if (amount <= 0) return
      await onMutate(async () => {
        await window.moss.money.setAssignment({
          categoryId: targetCategoryId,
          periodKey: budget.periodKey,
          amountCents: targetAssigned + amount
        })
      })
      return
    }

    const source = budget.categories.find((row) => row.category.id === sourceValue)
    if (!source) return
    const amount = Math.min(needCents, source.remainingCents)
    if (amount <= 0) return
    await onMutate(async () => {
      await window.moss.money.setAssignment({
        categoryId: source.category.id,
        periodKey: budget.periodKey,
        amountCents: source.assignedCents - amount
      })
      await window.moss.money.setAssignment({
        categoryId: targetCategoryId,
        periodKey: budget.periodKey,
        amountCents: targetAssigned + amount
      })
    })
  }

  return (
    <div className="money-workspace">
      {isFresh ? (
        <section className="money-instrument-panel money-empty-onboard" aria-label="Get started">
          <p className="money-instrument-kicker">Start here</p>
          <h2 className="money-empty-onboard-title">Build your first budget.</h2>
          <p className="money-empty-onboard-copy">
            Two steps: add the pay you actually take home, then give those dollars jobs —
            envelopes like Rent, Groceries, and Fun. Every dollar with a purpose, no spreadsheet.
          </p>
          <ol className="money-empty-onboard-steps">
            <li>
              <span aria-hidden>1</span> Log your take-home pay in <strong>Income</strong> below.
            </li>
            <li>
              <span aria-hidden>2</span> Create an <strong>envelope</strong> and assign money into it.
            </li>
          </ol>
        </section>
      ) : null}

      {flowGuidance && flowSettings && (
        <MoneyFlowPanel
          guidance={flowGuidance}
          settings={flowSettings}
          advancedToolsEnabled={advancedToolsEnabled}
          busy={busy}
          onMutate={onMutate}
          onFindUnfiled={onFindUnfiled}
        />
      )}

      <MoneyMonthWrapCard
        budget={budget}
        savingsOverview={savingsOverview}
        savingsCategoryIds={savingsCategoryIds}
        busy={busy}
        onMutate={onMutate}
      />

      <MoneySavingsPanel
        overview={savingsOverview}
        busy={busy}
        envelopeSweepCents={envelopeSweepCents}
        actionError={savingsError}
        onOpenLedgerForCategory={onOpenLedgerForCategory}
        onMutate={(task) => {
          setSavingsError(null)
          return onMutate(task, { onError: setSavingsError })
        }}
      />

      {budget.overspent.length > 0 && (
        <section
          className="money-instrument-panel money-envelope-instrument--overspent"
          aria-label="Overspending"
        >
          <p className="money-instrument-kicker">Overspent</p>
          <p className="money-overspent-help">
            You spent more than these envelopes hold. Pull the difference from money that&rsquo;s
            still free — your unassigned cash or another envelope with room to spare.
          </p>
          <ul className="money-envelope-list">
            {budget.overspent.map((item) => {
              const need = Math.abs(item.remainingCents)
              const sourceOptions = [
                ...(budget.unassignedCents > 0
                  ? [
                      {
                        value: 'pool',
                        label: `Unassigned (${formatMoneyCents(budget.unassignedCents)})`
                      }
                    ]
                  : []),
                ...budget.categories
                  .filter((row) => row.category.id !== item.categoryId && row.remainingCents > 0)
                  .sort((a, b) => b.remainingCents - a.remainingCents)
                  .map((row) => ({
                    value: row.category.id,
                    label: `${row.category.name} (${formatMoneyCents(row.remainingCents)} free)`
                  }))
              ]
              return (
                <li key={item.categoryId} className="money-envelope-instrument-top py-2">
                  <span className="money-envelope-instrument-name">{item.name}</span>
                  <span className="money-row-actions">
                    <span className="money-envelope-instrument-remaining money-envelope-instrument-remaining--over money-mono">
                      {formatMoneyCents(need)} over
                    </span>
                    {sourceOptions.length > 0 ? (
                      <MossSelect
                        className="money-select--inline money-cover-select"
                        value=""
                        options={sourceOptions}
                        onChange={(sourceValue) => void coverOverspend(item.categoryId, sourceValue, need)}
                        placeholder="Cover from…"
                        disabled={busy}
                        ariaLabel={`Cover ${item.name} overspend from`}
                      />
                    ) : (
                      <span className="money-cover-empty money-mono">
                        No free money — trim an envelope or add income
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="money-instrument-panel" aria-label="Envelopes">
        <header className="money-instrument-head">
          <div>
            <p className="money-instrument-kicker">Envelopes</p>
            <h2 className="money-instrument-title">{formatPeriodLabel(budget.periodKey)}</h2>
          </div>
        </header>

        {budget.categories.length > 0 && <EnvelopeAssignHint />}

        <form
            className="money-envelope-add"
            onSubmit={(event) => {
              event.preventDefault()
              if (!categoryName.trim()) return
              void onMutate(async () => {
                await window.moss.money.createCategory({
                  name: categoryName.trim(),
                  groupId: categoryGroupId || null,
                  countsTowardSafeToSpend: categorySpendKind === 'everyday'
                })
                setCategoryName('')
                setCategorySpendKind('everyday')
              })
            }}
          >
            <input
              className="money-input money-input--inline"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="New envelope"
              aria-label="New envelope name"
            />
            <MossSelect
              className="money-select--inline"
              value={categoryGroupId}
              options={groupSelectOptions}
              onChange={handleGroupSelect}
              placeholder="+ New group"
              ariaLabel="Envelope group"
            />
            <MossSelect
              className="money-select--inline"
              value={categorySpendKind}
              options={[
                { value: 'everyday', label: 'Everyday spending' },
                { value: 'bill', label: 'Bill or fixed' }
              ]}
              onChange={(value) => setCategorySpendKind(value as 'everyday' | 'bill')}
              ariaLabel="How this envelope counts toward safe to spend"
            />
            <button type="submit" className="money-button money-button--compact" disabled={busy}>
              Add
            </button>
        </form>

        {budget.categories.length === 0 && (
          <p className="money-instrument-empty">Create an envelope, then assign from the pool above.</p>
        )}

        {envelopeSections.length > 1 && (
          <div className="money-groups-toolbar">
            <button type="button" className="money-groups-collapse-all" onClick={toggleAllGroups}>
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          </div>
        )}

        {envelopeSections.map((section) => {
          const collapsed = collapsedGroups.has(section.id)
          const remainingCents = section.rows.reduce((sum, row) => sum + row.remainingCents, 0)
          const overspentInGroup = section.rows.some((row) => row.remainingCents < 0)
          const listId = `money-group-${section.id}`
          return (
            <div key={section.id} className="money-group mt-4">
              <div className="money-group-header">
                <button
                  type="button"
                  className="money-group-toggle"
                  aria-expanded={!collapsed}
                  aria-controls={listId}
                  onClick={() => toggleGroup(section.id)}
                >
                  <svg
                    className="money-group-caret"
                    data-collapsed={collapsed ? 'true' : 'false'}
                    width="11"
                    height="11"
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
                  <span className="money-instrument-kicker">{section.title}</span>
                  <span
                    className={[
                      'money-group-summary money-mono',
                      overspentInGroup ? 'money-group-summary--over' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {section.rows.length} {section.rows.length === 1 ? 'envelope' : 'envelopes'} ·{' '}
                    {formatMoneyCents(remainingCents)} left
                  </span>
                </button>
                {section.id !== 'other' && (
                  <button
                    type="button"
                    className="money-delete-button money-delete-button--icon money-group-delete"
                    disabled={busy}
                    aria-label={`Delete group ${section.title}`}
                    title="Delete group (asks first; its envelopes move to Other)"
                    onClick={() =>
                      setDeleteGroupTarget({
                        id: section.id,
                        title: section.title,
                        count: section.rows.length
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </div>
              {!collapsed && (
                <ul className="money-envelope-list" id={listId}>
                  {section.rows.map((row) => (
                    <EnvelopeInstrumentRow
                      key={row.category.id}
                      row={row}
                      periodKey={budget.periodKey}
                      unassignedCents={budget.unassignedCents}
                      isSavingsEnvelope={savingsCategoryIds.has(row.category.id)}
                      groups={budget.groups}
                      busy={busy}
                      onMutate={onMutate}
                    />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </section>

      {groupModal === 'create' && (
        <MossModal
          onClose={() => setGroupModal(null)}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy="money-new-group-title"
        >
          <form
            className="calendar-event-modal"
            onSubmit={(event) => {
              event.preventDefault()
              void createGroup()
            }}
          >
            <h2 id="money-new-group-title" className="calendar-event-modal-title">
              New group
            </h2>
            <p className="money-group-modal-help">
              Groups just cluster related envelopes — like “Bills” or “Fun”. Optional.
            </p>
            <label className="calendar-class-time-field">
              <span className="calendar-quick-add-label nutrition-mono">Group name</span>
              <input
                className="preference-input"
                value={groupDraftName}
                onChange={(event) => setGroupDraftName(event.target.value)}
                placeholder="Group name"
                aria-label="Group name"
                autoFocus
              />
            </label>
            <div className="calendar-event-modal-actions">
              <button
                type="button"
                className="money-button money-button--ghost money-button--compact"
                onClick={() => setGroupModal(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="money-button money-button--compact"
                disabled={busy || !groupDraftName.trim()}
              >
                Create group
              </button>
            </div>
          </form>
        </MossModal>
      )}

      {groupModal === 'edit' && (
        <MossModal
          onClose={() => setGroupModal(null)}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy="money-edit-groups-title"
        >
          <div className="calendar-event-modal">
            <h2 id="money-edit-groups-title" className="calendar-event-modal-title">
              Edit groups
            </h2>
            {budget.groups.length === 0 ? (
              <p className="money-group-modal-help">No groups yet.</p>
            ) : (
              <p className="money-group-modal-help">
                Rename a group, or delete it — its envelopes move to “Other”, nothing is lost.
              </p>
            )}
            <ul className="money-group-edit-list">
              {budget.groups.map((group) => (
                <GroupEditRow key={group.id} group={group} busy={busy} onMutate={onMutate} />
              ))}
            </ul>
            <div className="calendar-event-modal-actions">
              <button
                type="button"
                className="money-button money-button--ghost money-button--compact"
                onClick={() => {
                  setGroupDraftName('')
                  setGroupModal('create')
                }}
              >
                + New group
              </button>
              <button
                type="button"
                className="money-button money-button--compact"
                onClick={() => setGroupModal(null)}
              >
                Done
              </button>
            </div>
          </div>
        </MossModal>
      )}

      {deleteGroupTarget && (
        <MossModal
          onClose={() => setDeleteGroupTarget(null)}
          backdropClassName="calendar-event-modal-backdrop"
          ariaLabelledBy="money-delete-group-title"
        >
          <div className="calendar-event-modal">
            <h2 id="money-delete-group-title" className="calendar-event-modal-title">
              Delete the “{deleteGroupTarget.title}” group?
            </h2>
            <p className="money-group-modal-help">
              {deleteGroupTarget.count === 0
                ? 'This just removes the group label — nothing else changes.'
                : `Its ${deleteGroupTarget.count} ${
                    deleteGroupTarget.count === 1 ? 'envelope' : 'envelopes'
                  } won’t be deleted — they move to “Other”, keeping every dollar, goal, and transaction. Only the group label goes away.`}
            </p>
            <div className="calendar-event-modal-actions">
              <button
                type="button"
                className="money-button money-button--ghost money-button--compact"
                onClick={() => setDeleteGroupTarget(null)}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="money-button money-button--compact money-button--danger"
                disabled={busy}
                onClick={() => {
                  const target = deleteGroupTarget
                  setDeleteGroupTarget(null)
                  void onMutate(async () => {
                    await window.moss.money.deleteCategoryGroup(target.id)
                  })
                }}
              >
                Delete group
              </button>
            </div>
          </div>
        </MossModal>
      )}

      <MoneySchedulesPanel
        schedules={schedules}
        categories={budget.categories}
        accounts={accounts}
        busy={busy}
        onMutate={onMutate}
      />

      {budget.categories.length > 0 && (
        <MoneyRulesPanel
          rules={rules}
          categories={budget.categories}
          busy={busy}
          onMutate={onMutate}
        />
      )}

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
                <button
                  type="button"
                  className="money-button money-button--ghost money-button--compact"
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
                </button>
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
            className="money-input money-input--amount money-input--inline"
            value={paycheckAmount}
            onChange={(event) => setPaycheckAmount(event.target.value)}
            placeholder="Amount"
            inputMode="decimal"
            aria-label="Paycheck amount"
          />
          <input
            className="money-input money-input--inline money-mono"
            type="date"
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
          <button type="submit" className="money-button money-button--compact" disabled={busy}>
            Log income
          </button>
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
              <input
                className="preference-input money-mono"
                type="date"
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
              <button
                type="button"
                className="money-button money-button--ghost money-button--compact"
                onClick={() => setEditPaycheck(null)}
              >
                Cancel
              </button>
              <button type="submit" className="money-button money-button--compact" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </MossModal>
      )}
    </div>
  )
}

function formatIncomeDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(year, month - 1, day)
  )
}

interface GroupEditRowProps {
  group: CategoryGroupRecord
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

function GroupEditRow({ group, busy, onMutate }: GroupEditRowProps): React.JSX.Element {
  const [name, setName] = useState(group.name)

  useEffect(() => {
    setName(group.name)
  }, [group.name])

  function commitName(): void {
    const next = name.trim()
    if (!next || next === group.name) {
      setName(group.name)
      return
    }
    void onMutate(async () => {
      await window.moss.money.renameCategoryGroup({ id: group.id, name: next })
    })
  }

  return (
    <li className="money-group-edit-row">
      <input
        className="money-input money-input--inline"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitName()
          }
        }}
        aria-label={`Rename ${group.name}`}
        disabled={busy}
      />
      <button
        type="button"
        className="money-delete-button money-delete-button--icon"
        disabled={busy}
        aria-label={`Delete group ${group.name}`}
        title="Delete group (its envelopes move to Other)"
        onClick={() => {
          void onMutate(async () => {
            await window.moss.money.deleteCategoryGroup(group.id)
          })
        }}
      >
        ×
      </button>
    </li>
  )
}

/** One-time plain-English nudge: assigning ≠ spending (V2.75b). */
function EnvelopeAssignHint(): React.JSX.Element | null {
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
      <button
        type="button"
        className="money-button money-button--ghost money-button--compact money-envelope-assign-hint-dismiss"
        onClick={dismiss}
      >
        Got it
      </button>
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
}

function EnvelopeInstrumentRow({
  row,
  periodKey,
  unassignedCents,
  isSavingsEnvelope,
  groups,
  busy,
  onMutate
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
              <button
                type="button"
                className="money-button money-button--ghost money-button--compact"
                onClick={() => setRolloverOffConfirm(null)}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="money-button money-button--compact"
                disabled={busy}
                onClick={() => {
                  setRolloverOffConfirm(null)
                  applyRollover(false)
                }}
              >
                Move {rolloverOffConfirm < 0 ? 'overspend' : 'pile'} to to assign
              </button>
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
            <label className="money-envelope-editor-label money-envelope-spend-policy">
              <input
                type="checkbox"
                className="money-envelope-spend-policy-input"
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
              Counts toward safe to spend
            </label>
            <p className="money-envelope-editor-hint">
              {isSavingsEnvelope
                ? 'Savings goals stay protected — not included in everyday spending.'
                : 'Uncheck for bills and fixed costs you do not spend from casually — like rent or insurance.'}
            </p>
          </div>

          <div className="money-envelope-editor-field">
            <label className="money-envelope-editor-label money-envelope-spend-policy">
              <input
                type="checkbox"
                className="money-envelope-spend-policy-input"
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
              Roll unspent into next month
            </label>
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

          <button
            type="button"
            className="money-button money-button--ghost money-button--compact money-envelope-delete-full"
            disabled={busy}
            onClick={() => {
              void onMutate(async () => {
                await window.moss.money.deleteCategory(row.category.id)
              })
            }}
          >
            Delete envelope
          </button>
        </div>
      )}
    </li>
  )
}
