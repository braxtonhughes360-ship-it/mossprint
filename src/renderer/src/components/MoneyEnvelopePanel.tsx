import { useEffect, useMemo, useState } from 'react'
import type { CategoryBudgetRow, CategoryGroupRecord, MoneyBudgetOverview } from '@shared/money'
import { formatMoneyCents, formatPeriodLabel, STARTER_ENVELOPES } from '@shared/money'
import type { MoneyMutateFn } from '../moneyMutate'
import { EnvelopeAssignHint, EnvelopeInstrumentRow } from './MoneyEnvelopeInstrumentRow'
import { MossButton } from './MossButton'
import { MossModal } from './MossModal'
import { MossSelect } from './MossSelect'
import { MossToolbar } from './MossToolbar'

/** Sentinel option values for the envelope group picker (actions, not real groups). */
const GROUP_ACTION_NEW = '__new_group__'
const GROUP_ACTION_EDIT = '__edit_groups__'

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

interface MoneyEnvelopePanelProps {
  budget: MoneyBudgetOverview
  savingsCategoryIds: Set<string>
  busy: boolean
  onMutate: MoneyMutateFn
  onOpenLedgerForCategory?: (categoryId: string) => void
}

export function MoneyEnvelopePanel({
  budget,
  savingsCategoryIds,
  busy,
  onMutate,
  onOpenLedgerForCategory
}: MoneyEnvelopePanelProps): React.JSX.Element {
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

  return (
    <>
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
            <MossButton type="submit" size="sm" disabled={busy}>
              Add
            </MossButton>
        </form>

        {/* QA2-10: one-tap starters while the budget is young — no typing eight names. */}
        {budget.categories.length < 3 &&
          (() => {
            const existing = new Set(
              budget.categories.map((row) => row.category.name.trim().toLowerCase())
            )
            const starters = STARTER_ENVELOPES.filter(
              (starter) => !existing.has(starter.name.toLowerCase())
            )
            if (starters.length === 0) return null
            const addStarters = (
              picks: Array<{ name: string; kind: 'bill' | 'everyday' }>
            ): void => {
              void onMutate(async () => {
                for (const pick of picks) {
                  await window.moss.money.createCategory({
                    name: pick.name,
                    countsTowardSafeToSpend: pick.kind === 'everyday'
                  })
                }
              })
            }
            return (
              <div className="money-starter-row" aria-label="Starter envelopes">
                <span className="money-starter-hint nutrition-mono">Quick start</span>
                {starters.map((starter) => (
                  <button
                    key={starter.name}
                    type="button"
                    className="money-chip"
                    disabled={busy}
                    onClick={() => addStarters([starter])}
                  >
                    + {starter.name}
                  </button>
                ))}
                <button
                  type="button"
                  className="money-chip money-chip--accent"
                  disabled={busy}
                  onClick={() => addStarters(starters)}
                >
                  Add all
                </button>
              </div>
            )
          })()}

        {budget.categories.length === 0 && (
          <p className="money-instrument-empty">Create an envelope, then assign from the pool above.</p>
        )}

        {envelopeSections.length > 1 && (
          <MossToolbar className="money-groups-toolbar" label="Envelope group actions">
            <MossToolbar.Group label="Group visibility">
              <MossButton type="button" variant="quiet" size="sm" onClick={toggleAllGroups}>
                {allCollapsed ? 'Expand all' : 'Collapse all'}
              </MossButton>
            </MossToolbar.Group>
          </MossToolbar>
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
                      onOpenLedger={
                        onOpenLedgerForCategory
                          ? () => onOpenLedgerForCategory(row.category.id)
                          : undefined
                      }
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
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setGroupModal(null)}
              >
                Cancel
              </MossButton>
              <MossButton
                type="submit"
                size="sm"
                disabled={busy || !groupDraftName.trim()}
              >
                Create group
              </MossButton>
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
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => {
                  setGroupDraftName('')
                  setGroupModal('create')
                }}
              >
                + New group
              </MossButton>
              <MossButton
                type="button"
                size="sm"
                onClick={() => setGroupModal(null)}
              >
                Done
              </MossButton>
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
              <MossButton
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setDeleteGroupTarget(null)}
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
                  const target = deleteGroupTarget
                  setDeleteGroupTarget(null)
                  void onMutate(async () => {
                    await window.moss.money.deleteCategoryGroup(target.id)
                  })
                }}
              >
                Delete group
              </MossButton>
            </div>
          </div>
        </MossModal>
      )}
    </>
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
