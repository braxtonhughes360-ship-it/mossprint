import { useEffect, useState } from 'react'
import type { NutritionGoals } from '@shared/nutrition'
import { MossButton } from './MossButton'

interface NutritionGoalsPanelProps {
  goals: NutritionGoals
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

export function NutritionGoalsPanel({
  goals,
  busy,
  onMutate
}: NutritionGoalsPanelProps): React.JSX.Element {
  const [calorieTarget, setCalorieTarget] = useState(String(goals.calorieTarget))
  const [proteinG, setProteinG] = useState(String(goals.proteinG))
  const [carbsG, setCarbsG] = useState(String(goals.carbsG))
  const [fatG, setFatG] = useState(String(goals.fatG))

  useEffect(() => {
    setCalorieTarget(String(goals.calorieTarget))
    setProteinG(String(goals.proteinG))
    setCarbsG(String(goals.carbsG))
    setFatG(String(goals.fatG))
  }, [goals])

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()

    await onMutate(async () => {
      await window.moss.nutrition.setGoals({
        calorieTarget: Number(calorieTarget),
        proteinG: Number(proteinG),
        carbsG: Number(carbsG),
        fatG: Number(fatG)
      })
    })
  }

  return (
    <section className="nutrition-goals-panel">
      <header className="nutrition-goals-head">
        <h2 className="nutrition-panel-title">Daily targets</h2>
        <p className="nutrition-goals-copy">
          Calorie budget and primary macros — stored locally on this device.
        </p>
      </header>

      <form className="nutrition-goals-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="nutrition-field">
          <span className="nutrition-field-label">Calorie target</span>
          <input
            type="number"
            min="500"
            step="50"
            className="nutrition-input nutrition-input--goal nutrition-mono"
            value={calorieTarget}
            onChange={(event) => setCalorieTarget(event.target.value)}
            disabled={busy}
          />
        </label>

        <label className="nutrition-field">
          <span className="nutrition-field-label">Protein (g)</span>
          <input
            type="number"
            min="0"
            step="1"
            className="nutrition-input nutrition-input--goal nutrition-mono"
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
            step="1"
            className="nutrition-input nutrition-input--goal nutrition-mono"
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
            step="1"
            className="nutrition-input nutrition-input--goal nutrition-mono"
            value={fatG}
            onChange={(event) => setFatG(event.target.value)}
            disabled={busy}
          />
        </label>

        <MossButton type="submit" disabled={busy}>
          Save targets
        </MossButton>
      </form>
    </section>
  )
}
