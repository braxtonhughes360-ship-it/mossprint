import { useCallback, useEffect, useState } from 'react'
import type { NutritionDoorSnapshot } from '@shared/nutrition'
import { currentDateKey, mealSlotsWithEntries } from '@shared/nutrition'

export function useNutritionDoorSnapshot(): {
  snapshot: NutritionDoorSnapshot | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const [snapshot, setSnapshot] = useState<NutritionDoorSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!window.moss?.nutrition) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const dateKey = currentDateKey()
      const next = await window.moss.nutrition.getDoorSnapshot(dateKey)
      setSnapshot(next)
    } catch {
      try {
        const dateKey = currentDateKey()
        const summary = await window.moss.nutrition.getSummary(dateKey)
        const diary = await window.moss.nutrition.getDiary(dateKey)
        setSnapshot({
          summary,
          macroProgress: {
            protein: { consumed: summary.totals.consumedProteinG, target: summary.goals.proteinG },
            carbs: { consumed: summary.totals.consumedCarbsG, target: summary.goals.carbsG },
            fat: { consumed: summary.totals.consumedFatG, target: summary.goals.fatG }
          },
          mealsLogged: mealSlotsWithEntries(diary.meals)
        })
      } catch {
        setSnapshot(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { snapshot, loading, refresh }
}
