import { useCallback, useEffect, useState } from 'react'
import type {
  DescribeDraftItem,
  DescribeMealResult,
  FoodEntryRecord,
  MealSlot,
  NutritionDiary,
  RecentDiaryEntry
} from '@shared/nutrition'
import {
  MEAL_SLOTS,
  MEAL_SLOT_LABELS,
  formatKcal,
  formatMacroG,
  inferMealSlotFromTime
} from '@shared/nutrition'
import {
  NutritionDescribeField,
  NutritionEntryEditModal,
  NutritionManualEntryModal,
  NutritionReviewPlate
} from './NutritionDescribeField'
import { NutritionRecentStrip } from './NutritionRecentStrip'

interface NutritionDiaryPanelProps {
  diary: NutritionDiary
  dateKey: string
  busy: boolean
  lookupHint: string | null
  llmModel: string | null
  onMutate: (task: () => Promise<void>, successMessage?: string) => Promise<void>
}

function mealSubtotal(entries: NutritionDiary['meals'][MealSlot]): number {
  return entries.reduce((sum, entry) => sum + entry.snapshotKcal, 0)
}

export function NutritionDiaryPanel({
  diary,
  dateKey,
  busy,
  lookupHint,
  llmModel,
  onMutate
}: NutritionDiaryPanelProps): React.JSX.Element {
  const [activeMeal, setActiveMeal] = useState<MealSlot>(() => inferMealSlotFromTime())
  const [showAllMeals, setShowAllMeals] = useState(false)
  const [recentEntries, setRecentEntries] = useState<RecentDiaryEntry[]>([])
  const [reviewDraft, setReviewDraft] = useState<DescribeMealResult | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<FoodEntryRecord | null>(null)

  const loadRecents = useCallback(async () => {
    if (!window.moss?.nutrition) return
    const next = await window.moss.nutrition.listRecentDiaryEntries(8)
    setRecentEntries(next)
  }, [])

  useEffect(() => {
    void loadRecents()
  }, [loadRecents, diary])

  async function handleCommitPlate(items: DescribeDraftItem[]): Promise<void> {
    if (!reviewDraft || !window.moss?.nutrition) return
    const mealSlot = activeMeal

    await onMutate(async () => {
      await window.moss.nutrition.commitDescribePlate({
        dateKey,
        mealSlot,
        items: items.map((item) => ({
          foodItemId: item.foodItemId,
          servingId: item.servingId,
          label: item.label,
          quantity: item.quantity,
          kcal: item.snapshotKcal,
          proteinG: item.snapshotProteinG,
          carbsG: item.snapshotCarbsG,
          fatG: item.snapshotFatG
        }))
      })
    }, `Logged ${items.length} item${items.length === 1 ? '' : 's'} to ${MEAL_SLOT_LABELS[mealSlot].toLowerCase()}.`)
    setReviewDraft(null)
  }

  const visibleSlots = showAllMeals ? MEAL_SLOTS : [activeMeal]
  const hiddenMealCount = MEAL_SLOTS.length - 1

  return (
    <div className="nutrition-diary">
      <div className="nutrition-meal-picker" role="tablist" aria-label="Meal slot">
        <span className="nutrition-meal-picker-label">Logging to</span>
        <div className="nutrition-meal-picker-track">
          {MEAL_SLOTS.map((slot) => (
            <button
              key={slot}
              type="button"
              role="tab"
              aria-selected={activeMeal === slot}
              className={[
                'nutrition-meal-pill',
                activeMeal === slot ? 'nutrition-meal-pill--active' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                setActiveMeal(slot)
                setShowAllMeals(false)
              }}
            >
              {MEAL_SLOT_LABELS[slot]}
            </button>
          ))}
        </div>
      </div>

      <NutritionDescribeField
        dateKey={dateKey}
        mealSlot={activeMeal}
        busy={busy}
        lookupHint={lookupHint}
        llmModel={llmModel}
        onDraft={(draft) => setReviewDraft({ ...draft, mealSlot: activeMeal })}
        onManualOpen={() => setManualOpen(true)}
      />

      <NutritionRecentStrip
        entries={recentEntries}
        mealSlot={activeMeal}
        dateKey={dateKey}
        busy={busy}
        onRelog={loadRecents}
      />

      {!showAllMeals && hiddenMealCount > 0 && (
        <button
          type="button"
          className="nutrition-meal-show-all"
          onClick={() => setShowAllMeals(true)}
        >
          Show all meals ({hiddenMealCount} more)
        </button>
      )}

      {showAllMeals && (
        <button
          type="button"
          className="nutrition-meal-show-all"
          onClick={() => setShowAllMeals(false)}
        >
          Focus on {MEAL_SLOT_LABELS[activeMeal].toLowerCase()} only
        </button>
      )}

      {visibleSlots.map((slot) => {
        const entries = diary.meals[slot]
        const subtotal = mealSubtotal(entries)
        const isActive = slot === activeMeal

        return (
          <section
            key={slot}
            className={[
              'nutrition-meal-slot',
              isActive ? 'nutrition-meal-slot--active' : 'nutrition-meal-slot--collapsed'
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <header className="nutrition-meal-head">
              <h2 className="nutrition-meal-title">{MEAL_SLOT_LABELS[slot]}</h2>
              <span className="nutrition-meal-subtotal nutrition-mono">
                {subtotal > 0 ? formatKcal(subtotal) : '—'}
              </span>
            </header>

            {entries.length === 0 ? (
              <p className="nutrition-meal-empty">
                {isActive ? 'Nothing logged yet — describe your meal above.' : 'Nothing logged yet.'}
              </p>
            ) : (
              <ul className="nutrition-entry-list">
                {entries.map((entry) => (
                  <li key={entry.id} className="nutrition-entry-row">
                    <button
                      type="button"
                      className="nutrition-entry-edit-hit"
                      disabled={busy}
                      onClick={() => setEditEntry(entry)}
                    >
                      <div className="nutrition-entry-main">
                        <span className="nutrition-entry-label">
                          {entry.quantity !== 1 ? `${entry.quantity}× ` : ''}
                          {entry.label}
                        </span>
                        <span className="nutrition-entry-kcal nutrition-mono">
                          {formatKcal(entry.snapshotKcal)}
                        </span>
                      </div>
                      {(entry.snapshotProteinG > 0 ||
                        entry.snapshotCarbsG > 0 ||
                        entry.snapshotFatG > 0) && (
                        <p className="nutrition-entry-macros nutrition-mono">
                          P {formatMacroG(entry.snapshotProteinG)}
                          <span aria-hidden> · </span>
                          C {formatMacroG(entry.snapshotCarbsG)}
                          <span aria-hidden> · </span>
                          F {formatMacroG(entry.snapshotFatG)}
                        </p>
                      )}
                    </button>
                    <button
                      type="button"
                      className="nutrition-delete-button"
                      aria-label={`Delete ${entry.label}`}
                      disabled={busy}
                      onClick={() =>
                        void onMutate(async () => {
                          await window.moss.nutrition.deleteEntry(entry.id)
                        }, `Removed ${entry.label}.`)
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {reviewDraft && (
        <NutritionReviewPlate
          draft={{ ...reviewDraft, mealSlot: activeMeal }}
          busy={busy}
          onClose={() => setReviewDraft(null)}
          onCommit={handleCommitPlate}
        />
      )}

      {manualOpen && (
        <NutritionManualEntryModal
          mealSlot={activeMeal}
          busy={busy}
          onClose={() => setManualOpen(false)}
          onSubmit={async (input) => {
            await onMutate(async () => {
              await window.moss.nutrition.logEntry({
                dateKey,
                mealSlot: activeMeal,
                label: input.label,
                kcal: input.kcal,
                proteinG: input.proteinG,
                carbsG: input.carbsG,
                fatG: input.fatG
              })
            }, `Added ${input.label} to ${MEAL_SLOT_LABELS[activeMeal].toLowerCase()}.`)
          }}
        />
      )}

      {editEntry && (
        <NutritionEntryEditModal
          entry={editEntry}
          busy={busy}
          onClose={() => setEditEntry(null)}
          onSave={async (patch) => {
            await onMutate(async () => {
              await window.moss.nutrition.updateEntry(editEntry.id, {
                label: patch.label,
                kcal: patch.kcal,
                proteinG: patch.proteinG,
                carbsG: patch.carbsG,
                fatG: patch.fatG,
                quantity: patch.quantity
              })
            }, `Updated ${patch.label}.`)
            setEditEntry(null)
          }}
        />
      )}
    </div>
  )
}
