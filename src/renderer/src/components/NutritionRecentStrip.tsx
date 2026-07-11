import type { MealSlot, RecentDiaryEntry } from '@shared/nutrition'
import { formatKcal } from '@shared/nutrition'

interface NutritionRecentStripProps {
  entries: RecentDiaryEntry[]
  mealSlot: MealSlot
  dateKey: string
  busy: boolean
  onRelog: () => Promise<void>
}

export function NutritionRecentStrip({
  entries,
  mealSlot,
  dateKey,
  busy,
  onRelog
}: NutritionRecentStripProps): React.JSX.Element | null {
  if (entries.length === 0) return null

  return (
    <section className="nutrition-recent-strip" aria-label="Recent foods">
      <p className="nutrition-recent-strip-label">Recent</p>
      <div className="nutrition-recent-strip-row">
        {entries.map((entry) => (
          <button
            key={`${entry.label}-${entry.lastLoggedAt}`}
            type="button"
            className="nutrition-recent-chip"
            disabled={busy}
            onClick={() =>
              void (async () => {
                if (!window.moss?.nutrition) return
                await window.moss.nutrition.relogRecentEntry(dateKey, mealSlot, entry)
                await onRelog()
              })()
            }
          >
            <span className="nutrition-recent-chip-label">{entry.label}</span>
            <span className="nutrition-recent-chip-kcal nutrition-mono">
              {formatKcal(entry.snapshotKcal)}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
