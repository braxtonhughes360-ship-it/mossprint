import type { NutritionDiary } from '@shared/nutrition'
import { formatKcal, formatMacroG, formatRemainingKcalLine } from '@shared/nutrition'

interface NutritionMacroStripProps {
  diary: NutritionDiary
}

function macroBarWidth(consumed: number, target: number): number {
  if (target <= 0) return 0
  return Math.round(Math.min(1, consumed / target) * 100)
}

export function NutritionMacroStrip({ diary }: NutritionMacroStripProps): React.JSX.Element {
  const { goals, totals, remainingKcal } = diary
  const isOver = remainingKcal < 0
  const consumedPct =
    goals.calorieTarget > 0
      ? Math.round(Math.min(1, totals.consumedKcal / goals.calorieTarget) * 100)
      : 0

  return (
    <section className="nutrition-macro-instrument" aria-label="Daily nutrition summary">
      <div className="nutrition-macro-instrument-head">
        <div className="nutrition-macro-instrument-hero">
          <span
            className={[
              'nutrition-macro-instrument-kcal-line nutrition-mono',
              isOver ? 'nutrition-macro-instrument-kcal-line--over' : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {formatRemainingKcalLine(remainingKcal)}
          </span>
        </div>
        <div className="nutrition-macro-instrument-consumed nutrition-mono">
          <span>{formatKcal(totals.consumedKcal)} eaten</span>
          <span className="nutrition-macro-instrument-sep" aria-hidden>
            ·
          </span>
          <span>{formatKcal(goals.calorieTarget)} goal</span>
        </div>
      </div>

      <div className="nutrition-macro-instrument-track" aria-hidden>
        <span
          className={[
            'nutrition-macro-instrument-fill',
            isOver ? 'nutrition-macro-instrument-fill--over' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ width: `${consumedPct}%` }}
        />
      </div>

      <div className="nutrition-macro-instrument-macros">
        {(
          [
            { key: 'protein', label: 'Protein', consumed: totals.consumedProteinG, target: goals.proteinG },
            { key: 'carbs', label: 'Carbs', consumed: totals.consumedCarbsG, target: goals.carbsG },
            { key: 'fat', label: 'Fat', consumed: totals.consumedFatG, target: goals.fatG }
          ] as const
        ).map((macro) => (
          <div key={macro.key} className="nutrition-macro-instrument-macro">
            <div className="nutrition-macro-instrument-macro-head">
              <span className="nutrition-macro-instrument-macro-label">{macro.label}</span>
              <span className="nutrition-macro-instrument-macro-value nutrition-mono">
                {formatMacroG(macro.consumed)} / {formatMacroG(macro.target)}
              </span>
            </div>
            <span className="nutrition-macro-instrument-macro-bar" aria-hidden>
              <span
                className="nutrition-macro-instrument-macro-fill"
                style={{ width: `${macroBarWidth(macro.consumed, macro.target)}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
