import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { DescribeAlternate, DescribeDraftItem, DescribeMealResult, FoodEntryRecord, MealSlot } from '@shared/nutrition'
import {
  MEAL_SLOT_LABELS,
  computeDescribeSnapshots,
  formatFoodSource,
  formatKcal,
  formatMacroG
} from '@shared/nutrition'
import { settingsSectionPath } from './SettingsNav'

function applyQuantityChange(item: DescribeDraftItem, quantity: number): DescribeDraftItem {
  // Estimate + local-model items carry totals (no per-100g basis) — scale linearly.
  if ((item.source === 'estimate' || item.source === 'llm') && item.snapshotKcal > 0) {
    const baseQty = item.quantity || 1
    const factor = quantity / baseQty
    return {
      ...item,
      quantity,
      snapshotKcal: item.snapshotKcal * factor,
      snapshotProteinG: item.snapshotProteinG * factor,
      snapshotCarbsG: item.snapshotCarbsG * factor,
      snapshotFatG: item.snapshotFatG * factor
    }
  }

  const gramOverride =
    item.unitGramWeight != null && item.unitGramWeight > 0 && item.unitGramWeight <= 200
      ? item.unitGramWeight
      : undefined

  if (item.per100gKcal != null && item.per100gKcal > 0) {
    const snap = computeDescribeSnapshots(
      {
        kcal: item.per100gKcal,
        protein: item.per100gProteinG ?? 0,
        carbs: item.per100gCarbsG ?? 0,
        fat: item.per100gFatG ?? 0
      },
      quantity,
      item.unitHint,
      gramOverride
    )
    return {
      ...item,
      quantity,
      snapshotKcal: snap.snapshotKcal,
      snapshotProteinG: snap.snapshotProteinG,
      snapshotCarbsG: snap.snapshotCarbsG,
      snapshotFatG: snap.snapshotFatG,
      unitGramWeight: snap.unitGramWeight
    }
  }
  return { ...item, quantity }
}

interface NutritionReviewPlateProps {
  draft: DescribeMealResult
  busy: boolean
  onClose: () => void
  onCommit: (items: DescribeDraftItem[]) => Promise<void>
}

export function NutritionReviewPlate({
  draft,
  busy,
  onClose,
  onCommit
}: NutritionReviewPlateProps): React.JSX.Element {
  const [items, setItems] = useState<DescribeDraftItem[]>(() =>
    draft.items.map((item) => ({ ...item }))
  )
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)

  function updateItem(id: string, patch: Partial<DescribeDraftItem>): void {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  }

  function applyAlternate(item: DescribeDraftItem, alternate: DescribeAlternate): void {
    setItems((current) =>
      current.map((row) => {
        if (row.id !== item.id) return row
        const remainingAlternates = row.alternates?.filter((alt) => alt.label !== alternate.label)
        return {
          ...row,
          label: alternate.label,
          foodItemId: alternate.foodItemId,
          servingId: alternate.servingId,
          snapshotKcal: alternate.snapshotKcal,
          snapshotProteinG: alternate.snapshotProteinG,
          snapshotCarbsG: alternate.snapshotCarbsG,
          snapshotFatG: alternate.snapshotFatG,
          per100gKcal: alternate.per100gKcal,
          per100gProteinG: alternate.per100gProteinG,
          per100gCarbsG: alternate.per100gCarbsG,
          per100gFatG: alternate.per100gFatG,
          unitGramWeight: alternate.unitGramWeight,
          source: alternate.source,
          confidence: alternate.confidence,
          alternates: remainingAlternates?.length ? remainingAlternates : undefined
        }
      })
    )
  }

  async function handleReResolve(item: DescribeDraftItem): Promise<void> {
    if (!window.moss?.nutrition) return
    setRowBusyId(item.id)
    try {
      const resolved = await window.moss.nutrition.resolveDescribeItem({
        phrase: item.label.trim() || item.rawPhrase,
        quantity: item.quantity,
        unitHint: item.unitHint
      })
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...resolved, id: item.id } : row))
      )
    } finally {
      setRowBusyId(null)
    }
  }

  function addManualRow(): void {
    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        rawPhrase: '',
        quantity: 1,
        unitHint: null,
        label: '',
        foodItemId: null,
        servingId: null,
        snapshotKcal: 0,
        snapshotProteinG: 0,
        snapshotCarbsG: 0,
        snapshotFatG: 0,
        per100gKcal: null,
        per100gProteinG: null,
        per100gCarbsG: null,
        per100gFatG: null,
        unitGramWeight: null,
        source: 'manual',
        confidence: 'low'
      }
    ])
  }

  const totalKcal = items.reduce((sum, item) => sum + item.snapshotKcal, 0)
  const canCommit =
    items.length > 0 && items.every((item) => item.label.trim() && item.snapshotKcal > 0)

  return (
    <div className="nutrition-review-plate-backdrop" role="presentation" onClick={onClose}>
      <section
        className="nutrition-review-plate"
        role="dialog"
        aria-labelledby="nutrition-review-plate-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="nutrition-review-plate-head">
          <div>
            <p className="nutrition-review-plate-kicker">Review plate</p>
            <h2 id="nutrition-review-plate-title" className="nutrition-review-plate-title">
              Confirm before logging
            </h2>
          </div>
          <button type="button" className="nutrition-review-plate-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {draft.parseWarnings.length > 0 && (
          <ul className="nutrition-review-plate-warnings">
            {draft.parseWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        <ul className="nutrition-review-plate-list">
          {items.map((item) => (
            <li key={item.id} className="nutrition-review-plate-row">
              <div className="nutrition-review-plate-row-main">
                <input
                  type="text"
                  className="nutrition-input nutrition-review-plate-label"
                  value={item.label}
                  onChange={(event) => updateItem(item.id, { label: event.target.value })}
                  disabled={busy || rowBusyId === item.id}
                  placeholder="Food name"
                />
                <span className={`nutrition-source-chip nutrition-source-chip--${item.source}`}>
                  {formatFoodSource(item.source)}
                </span>
                {item.assumed && (
                  <span className="nutrition-assumed-tag">Assumed</span>
                )}
              </div>

              <div className="nutrition-review-plate-row-controls">
                <label className="nutrition-review-plate-field">
                  <span>Qty</span>
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    className="nutrition-input nutrition-input--macro"
                    value={item.quantity}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((row) =>
                          row.id === item.id
                            ? applyQuantityChange(row, Number(event.target.value) || 1)
                            : row
                        )
                      )
                    }
                    disabled={busy || rowBusyId === item.id}
                  />
                </label>
                {item.unitHint && (
                  <span className="nutrition-review-plate-unit nutrition-mono">{item.unitHint}</span>
                )}
                <label className="nutrition-review-plate-field">
                  <span>kcal</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="nutrition-input nutrition-input--kcal nutrition-mono"
                    value={Math.round(item.snapshotKcal)}
                    onChange={(event) =>
                      updateItem(item.id, { snapshotKcal: Number(event.target.value) || 0 })
                    }
                    disabled={busy || rowBusyId === item.id}
                  />
                </label>
              </div>

              <div className="nutrition-review-plate-macro-grid">
                {(['Protein', 'Carbs', 'Fat'] as const).map((macro) => {
                  const key =
                    macro === 'Protein'
                      ? 'snapshotProteinG'
                      : macro === 'Carbs'
                        ? 'snapshotCarbsG'
                        : 'snapshotFatG'
                  return (
                    <label key={macro} className="nutrition-review-plate-field">
                      <span>{macro[0]}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        className="nutrition-input nutrition-input--macro nutrition-mono"
                        value={Math.round(item[key] * 10) / 10}
                        onChange={(event) =>
                          updateItem(item.id, { [key]: Number(event.target.value) || 0 })
                        }
                        disabled={busy || rowBusyId === item.id}
                      />
                    </label>
                  )
                })}
              </div>

              <div className="nutrition-review-plate-row-actions">
                <button
                  type="button"
                  className="nutrition-button nutrition-button--ghost nutrition-button--compact"
                  disabled={busy || rowBusyId === item.id}
                  onClick={() => void handleReResolve(item)}
                >
                  {rowBusyId === item.id ? 'Resolving…' : 'Re-resolve'}
                </button>
                {items.length > 1 && (
                  <button
                    type="button"
                    className="nutrition-button nutrition-button--ghost nutrition-button--compact"
                    disabled={busy}
                    onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}
                  >
                    Remove
                  </button>
                )}
              </div>

              {item.alternates && item.alternates.length > 0 && (
                <div className="nutrition-review-plate-alternates">
                  <span className="nutrition-review-plate-alternates-label">Also</span>
                  {item.alternates.map((alternate) => (
                    <button
                      key={`${item.id}-${alternate.label}`}
                      type="button"
                      className="nutrition-review-plate-alternate nutrition-mono"
                      disabled={busy || rowBusyId === item.id}
                      onClick={() => applyAlternate(item, alternate)}
                    >
                      {alternate.label} · {formatKcal(alternate.snapshotKcal)}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="nutrition-review-plate-add-row">
          <button
            type="button"
            className="nutrition-button nutrition-button--ghost nutrition-button--compact"
            disabled={busy}
            onClick={addManualRow}
          >
            + Add item manually
          </button>
        </div>

        <footer className="nutrition-review-plate-foot">
          <p className="nutrition-review-plate-total nutrition-mono">
            Total {formatKcal(totalKcal)}
            <span className="nutrition-review-plate-meal"> · {MEAL_SLOT_LABELS[draft.mealSlot]}</span>
          </p>
          <div className="nutrition-review-plate-actions">
            <button type="button" className="nutrition-button nutrition-button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="nutrition-button"
              disabled={busy || !canCommit}
              onClick={() => void onCommit(items)}
            >
              Log meal
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

interface NutritionManualEntryModalProps {
  mealSlot: MealSlot
  busy: boolean
  onClose: () => void
  onSubmit: (input: {
    label: string
    kcal: number
    proteinG: number
    carbsG: number
    fatG: number
  }) => Promise<void>
}

export function NutritionManualEntryModal({
  mealSlot,
  busy,
  onClose,
  onSubmit
}: NutritionManualEntryModalProps): React.JSX.Element {
  const [label, setLabel] = useState('')
  const [kcal, setKcal] = useState('')
  const [proteinG, setProteinG] = useState('')
  const [carbsG, setCarbsG] = useState('')
  const [fatG, setFatG] = useState('')

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const parsedKcal = Number(kcal)
    if (!label.trim() || !Number.isFinite(parsedKcal) || parsedKcal <= 0) return

    await onSubmit({
      label: label.trim(),
      kcal: parsedKcal,
      proteinG: Number(proteinG) || 0,
      carbsG: Number(carbsG) || 0,
      fatG: Number(fatG) || 0
    })
    onClose()
  }

  return (
    <div className="nutrition-review-plate-backdrop" role="presentation" onClick={onClose}>
      <section
        className="nutrition-review-plate nutrition-manual-modal"
        role="dialog"
        aria-labelledby="nutrition-manual-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="nutrition-review-plate-head">
          <div>
            <p className="nutrition-review-plate-kicker">{MEAL_SLOT_LABELS[mealSlot]}</p>
            <h2 id="nutrition-manual-title" className="nutrition-review-plate-title">
              Manual entry
            </h2>
          </div>
          <button type="button" className="nutrition-review-plate-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form className="nutrition-manual-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="nutrition-field">
            <span className="nutrition-field-label">Food name</span>
            <input
              type="text"
              className="nutrition-input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={busy}
              autoFocus
              required
            />
          </label>
          <label className="nutrition-field">
            <span className="nutrition-field-label">Calories</span>
            <input
              type="number"
              min="1"
              step="1"
              className="nutrition-input nutrition-input--kcal"
              value={kcal}
              onChange={(event) => setKcal(event.target.value)}
              disabled={busy}
              required
            />
          </label>
          <div className="nutrition-review-plate-macro-grid">
            <label className="nutrition-field">
              <span className="nutrition-field-label">Protein (g)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="nutrition-input nutrition-input--macro"
                value={proteinG}
                onChange={(event) => setProteinG(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="nutrition-field">
              <span className="nutrition-field-label">Carbs (g)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="nutrition-input nutrition-input--macro"
                value={carbsG}
                onChange={(event) => setCarbsG(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="nutrition-field">
              <span className="nutrition-field-label">Fat (g)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="nutrition-input nutrition-input--macro"
                value={fatG}
                onChange={(event) => setFatG(event.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <footer className="nutrition-review-plate-foot nutrition-manual-foot">
            <button type="button" className="nutrition-button nutrition-button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="nutrition-button" disabled={busy || !label.trim() || !kcal}>
              Add to {MEAL_SLOT_LABELS[mealSlot].toLowerCase()}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

interface NutritionEntryEditModalProps {
  entry: FoodEntryRecord
  busy: boolean
  onClose: () => void
  onSave: (patch: {
    label: string
    kcal: number
    proteinG: number
    carbsG: number
    fatG: number
    quantity: number
  }) => Promise<void>
}

export function NutritionEntryEditModal({
  entry,
  busy,
  onClose,
  onSave
}: NutritionEntryEditModalProps): React.JSX.Element {
  const [label, setLabel] = useState(entry.label)
  const [kcal, setKcal] = useState(String(Math.round(entry.snapshotKcal)))
  const [proteinG, setProteinG] = useState(String(entry.snapshotProteinG))
  const [carbsG, setCarbsG] = useState(String(entry.snapshotCarbsG))
  const [fatG, setFatG] = useState(String(entry.snapshotFatG))
  const [quantity, setQuantity] = useState(String(entry.quantity))

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const parsedKcal = Number(kcal)
    if (!label.trim() || !Number.isFinite(parsedKcal) || parsedKcal <= 0) return

    await onSave({
      label: label.trim(),
      kcal: parsedKcal,
      proteinG: Number(proteinG) || 0,
      carbsG: Number(carbsG) || 0,
      fatG: Number(fatG) || 0,
      quantity: Number(quantity) || 1
    })
    onClose()
  }

  return (
    <div className="nutrition-review-plate-backdrop" role="presentation" onClick={onClose}>
      <section
        className="nutrition-review-plate nutrition-manual-modal"
        role="dialog"
        aria-labelledby="nutrition-edit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="nutrition-review-plate-head">
          <div>
            <p className="nutrition-review-plate-kicker">Edit entry</p>
            <h2 id="nutrition-edit-title" className="nutrition-review-plate-title">
              {entry.label}
            </h2>
          </div>
          <button type="button" className="nutrition-review-plate-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <form className="nutrition-manual-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="nutrition-field">
            <span className="nutrition-field-label">Food name</span>
            <input
              type="text"
              className="nutrition-input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={busy}
              required
            />
          </label>
          <div className="nutrition-review-plate-row-controls">
            <label className="nutrition-field">
              <span className="nutrition-field-label">Qty</span>
              <input
                type="number"
                min="0.25"
                step="0.25"
                className="nutrition-input nutrition-input--macro"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="nutrition-field">
              <span className="nutrition-field-label">Calories</span>
              <input
                type="number"
                min="1"
                step="1"
                className="nutrition-input nutrition-input--kcal"
                value={kcal}
                onChange={(event) => setKcal(event.target.value)}
                disabled={busy}
                required
              />
            </label>
          </div>
          <div className="nutrition-review-plate-macro-grid">
            <label className="nutrition-field">
              <span className="nutrition-field-label">Protein (g)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="nutrition-input nutrition-input--macro"
                value={proteinG}
                onChange={(event) => setProteinG(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="nutrition-field">
              <span className="nutrition-field-label">Carbs (g)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="nutrition-input nutrition-input--macro"
                value={carbsG}
                onChange={(event) => setCarbsG(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="nutrition-field">
              <span className="nutrition-field-label">Fat (g)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="nutrition-input nutrition-input--macro"
                value={fatG}
                onChange={(event) => setFatG(event.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <footer className="nutrition-review-plate-foot nutrition-manual-foot">
            <button type="button" className="nutrition-button nutrition-button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="nutrition-button" disabled={busy}>
              Save changes
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

const DESCRIBE_EXAMPLES = [
  '2 slices pepperoni pizza, 1 glass apple juice',
  'chicken breast and white rice',
  'protein shake, banana'
]

interface NutritionDescribeFieldProps {
  dateKey: string
  mealSlot: MealSlot
  busy: boolean
  lookupHint?: string | null
  /** Local Ollama model powering smart parsing; null = heuristic parsing only. */
  llmModel?: string | null
  onDraft: (draft: DescribeMealResult) => void
  onManualOpen: () => void
}

export function NutritionDescribeField({
  dateKey,
  mealSlot,
  busy,
  lookupHint,
  llmModel,
  onDraft,
  onManualOpen
}: NutritionDescribeFieldProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)

  async function runDescribe(inputText: string): Promise<void> {
    if (!inputText.trim() || !window.moss?.nutrition) return

    setError(null)
    setResolving(true)
    try {
      const draft = await window.moss.nutrition.describeMeal({
        text: inputText.trim(),
        dateKey,
        mealSlot
      })
      if (draft.items.length === 0) {
        setError('Could not parse any foods from that description.')
        return
      }
      onDraft(draft)
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Describe failed')
    } finally {
      setResolving(false)
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    await runDescribe(text)
  }

  return (
    <section
      className={[
        'nutrition-describe-panel',
        resolving ? 'nutrition-describe-panel--resolving' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Describe meal"
    >
      <div className="nutrition-add-toolbar">
        <div className="nutrition-add-toolbar-main">
          <h2 className="nutrition-add-title">Log food</h2>
          <span className="nutrition-meal-target-badge">{MEAL_SLOT_LABELS[mealSlot]}</span>
        </div>
        <button
          type="button"
          className="nutrition-button nutrition-button--compact nutrition-add-alt-button"
          disabled={busy}
          onClick={onManualOpen}
        >
          Manual entry
        </button>
      </div>
      <p className="nutrition-describe-copy">
        Describe what you ate in plain English (e.g.{' '}
        <em>chipotle chicken burrito and a coke</em>). Review the plate before logging, or use{' '}
        <strong>Manual entry</strong> for typed macros.
      </p>
      <p className="nutrition-describe-hint">
        {llmModel ? (
          <>
            Smart parsing on — using {llmModel.split(':')[0]}, running on this computer.
          </>
        ) : (
          <>
            <Link className="nutrition-describe-smarter-link" to={settingsSectionPath('localai')}>
              Make parsing smarter
            </Link>
          </>
        )}
      </p>
      {lookupHint && <p className="nutrition-describe-hint">{lookupHint}</p>}
      <form className="nutrition-describe-form" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          className="nutrition-describe-input"
          rows={2}
          placeholder="2 slices pepperoni pizza, 1 glass apple juice"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={busy || resolving}
        />
        <button
          type="submit"
          className="nutrition-button"
          disabled={busy || resolving || !text.trim()}
        >
          {resolving ? 'Resolving…' : 'Review plate'}
        </button>
      </form>
      <div className="nutrition-describe-examples">
        {DESCRIBE_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="nutrition-describe-example"
            disabled={busy || resolving}
            onClick={() => void runDescribe(example)}
          >
            {example}
          </button>
        ))}
      </div>
      {error && <p className="nutrition-error">{error}</p>}
    </section>
  )
}
