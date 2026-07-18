import type { MossBridge } from '@shared/ipc'
import type { NutritionDoorSnapshot } from '@shared/nutrition'
import { currentDateKey, mealSlotsWithEntries } from '@shared/nutrition'
import { useDoorSnapshot, type DoorSnapshotResult } from './useDoorSnapshot'

async function loadNutritionDoorSnapshot(
  channel: MossBridge['nutrition']
): Promise<NutritionDoorSnapshot> {
  const dateKey = currentDateKey()
  try {
    return await channel.getDoorSnapshot(dateKey)
  } catch {
    const summary = await channel.getSummary(dateKey)
    const diary = await channel.getDiary(dateKey)
    return {
      summary,
      macroProgress: {
        protein: { consumed: summary.totals.consumedProteinG, target: summary.goals.proteinG },
        carbs: { consumed: summary.totals.consumedCarbsG, target: summary.goals.carbsG },
        fat: { consumed: summary.totals.consumedFatG, target: summary.goals.fatG }
      },
      mealsLogged: mealSlotsWithEntries(diary.meals)
    }
  }
}

export const useNutritionDoorSnapshot = (): DoorSnapshotResult<NutritionDoorSnapshot> =>
  useDoorSnapshot(window.moss?.nutrition, { loadSnapshot: loadNutritionDoorSnapshot })
