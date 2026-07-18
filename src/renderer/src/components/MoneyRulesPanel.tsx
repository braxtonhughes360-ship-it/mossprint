import { useState } from 'react'
import type {
  BudgetRuleRecord,
  CategoryBudgetRow,
  RuleMatchField,
  RuleMatchType
} from '@shared/money'
import { MossSelect } from './MossSelect'
import { MossButton } from './MossButton'

interface MoneyRulesPanelProps {
  rules: BudgetRuleRecord[]
  categories: CategoryBudgetRow[]
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

const FIELD_OPTIONS = [
  { value: 'payee', label: 'the payee' },
  { value: 'memo', label: 'the memo' }
]
const TYPE_OPTIONS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'is exactly' }
]

export function MoneyRulesPanel({
  rules,
  categories,
  busy,
  onMutate
}: MoneyRulesPanelProps): React.JSX.Element {
  const [matchField, setMatchField] = useState<RuleMatchField>('payee')
  const [matchType, setMatchType] = useState<RuleMatchType>('contains')
  const [matchValue, setMatchValue] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const categoryOptions = [
    { value: '', label: 'Pick an envelope' },
    ...categories.map((row) => ({ value: row.category.id, label: row.category.name }))
  ]

  return (
    <details className="money-instrument-panel money-rules-panel">
      <summary className="money-income-drawer-summary">
        <span className="money-instrument-kicker">Auto-sort new entries</span>
        <span className="money-income-drawer-total money-mono">
          {rules.length === 0 ? 'Off' : `${rules.length} on`}
        </span>
      </summary>

      <p className="money-rules-help">
        Tired of picking an envelope every time? Teach Moss once. For example: every charge from{' '}
        <strong>“Starbucks”</strong> goes to your <strong>Coffee</strong> envelope. After that,
        whenever you add a Starbucks entry without choosing an envelope, Moss fills it in for you —
        and you can always change it.
      </p>

      <ul className="money-rule-list">
        {rules.length === 0 && (
          <li className="money-instrument-empty">No auto-sort rules yet.</li>
        )}
        {rules.map((rule) => (
          <li key={rule.id} className="money-rule-row">
            <span className="money-rule-text">
              When {rule.matchField === 'memo' ? 'the memo' : 'the payee'}{' '}
              <span className="money-rule-op">
                {rule.matchType === 'equals' ? 'is exactly' : 'contains'}
              </span>{' '}
              <span className="money-rule-value">“{rule.matchValue}”</span>
              <span className="money-rule-arrow" aria-hidden>
                →
              </span>
              <span className="money-rule-category">{rule.categoryName ?? 'Removed envelope'}</span>
            </span>
            <button
              type="button"
              className="money-delete-button money-delete-button--icon"
              disabled={busy}
              aria-label="Delete rule"
              onClick={() => {
                void onMutate(async () => {
                  await window.moss.money.deleteRule(rule.id)
                })
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <form
        className="money-rule-builder"
        onSubmit={(event) => {
          event.preventDefault()
          if (!matchValue.trim() || !categoryId) return
          void onMutate(async () => {
            await window.moss.money.createRule({
              matchField,
              matchType,
              matchValue: matchValue.trim(),
              categoryId
            })
            setMatchValue('')
          })
        }}
      >
        <div className="money-rule-builder-sentence">
          <span className="money-rule-builder-word">When</span>
          <MossSelect
            className="money-rule-builder-field"
            value={matchField}
            options={FIELD_OPTIONS}
            onChange={(next) => setMatchField(next as RuleMatchField)}
            ariaLabel="Match on payee or memo"
          />
          <MossSelect
            className="money-rule-builder-field"
            value={matchType}
            options={TYPE_OPTIONS}
            onChange={(next) => setMatchType(next as RuleMatchType)}
            ariaLabel="Match type"
          />
          <input
            className="money-input money-input--inline money-rule-builder-value"
            value={matchValue}
            onChange={(event) => setMatchValue(event.target.value)}
            placeholder="e.g. Starbucks"
            aria-label="Text to match"
          />
          <span className="money-rule-builder-word">→ file it under</span>
          <MossSelect
            className="money-rule-builder-field"
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
            placeholder="Pick an envelope"
            ariaLabel="Envelope to file into"
          />
        </div>
        <MossButton type="submit" size="sm" disabled={busy}>
          Add rule
        </MossButton>
      </form>
    </details>
  )
}
