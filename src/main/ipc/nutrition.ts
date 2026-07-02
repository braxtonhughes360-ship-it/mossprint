import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import type {
  CommitDescribePlateInput,
  CreateFoodItemInput,
  DescribeMealInput,
  LogEntryInput,
  MealSlot,
  RecentDiaryEntry,
  SetGoalsInput,
  UpdateEntryInput
} from '@shared/nutrition'
import { MEAL_SLOTS } from '@shared/nutrition'
import { downloadAndImportUsdaFoundation } from '../nutritionUsdaImport'
import { describeMeal, resolveDescribeItem } from '../nutritionDescribe'
import {
  getNutritionLookupState,
  importFdcFood,
  lookupOffBarcode,
  searchFoods,
  setUsdaApiKey
} from '../nutritionLookup'
import {
  addFavoriteFood,
  commitDescribePlate,
  createFoodItem,
  deleteEntry,
  getDiary,
  getDoorSnapshot,
  getGoals,
  getSummary,
  listFavoriteFoods,
  listFoodItems,
  listFoodServings,
  listRecentDiaryEntries,
  listRecentFoods,
  logEntry,
  quickAddCalories,
  relogRecentEntry,
  removeFavoriteFood,
  setGoals,
  updateEntry
} from '../nutrition'

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

function assertInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`)
  }
}

function assertNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`)
  }
}

function assertMealSlot(value: unknown): asserts value is MealSlot {
  assertNonEmptyString(value, 'mealSlot')
  if (!MEAL_SLOTS.includes(value as MealSlot)) {
    throw new Error(`Invalid meal slot: ${value}`)
  }
}

export function registerNutritionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NUTRITION_GET_SUMMARY, (event, dateKey?: unknown) => {
    assertTrustedSender(event)
    if (dateKey !== undefined) {
      assertNonEmptyString(dateKey, 'dateKey')
      return getSummary(dateKey)
    }
    return getSummary()
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_GET_DOOR_SNAPSHOT, (event, dateKey?: unknown) => {
    assertTrustedSender(event)
    if (dateKey !== undefined) {
      assertNonEmptyString(dateKey, 'dateKey')
      return getDoorSnapshot(dateKey)
    }
    return getDoorSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_GET_DIARY, (event, dateKey: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(dateKey, 'dateKey')
    return getDiary(dateKey)
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_GET_GOALS, (event) => {
    assertTrustedSender(event)
    return getGoals()
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_SET_GOALS, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid goals input')
    }
    const payload = input as SetGoalsInput
    assertInteger(payload.calorieTarget, 'calorieTarget')
    assertNumber(payload.proteinG, 'proteinG')
    assertNumber(payload.carbsG, 'carbsG')
    assertNumber(payload.fatG, 'fatG')
    return setGoals(payload)
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_LIST_FOOD_ITEMS, (event, query?: unknown) => {
    assertTrustedSender(event)
    if (query !== undefined) {
      if (typeof query !== 'string') {
        throw new Error('query must be a string')
      }
      return listFoodItems(query)
    }
    return listFoodItems()
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_LIST_RECENT_FOODS, (event, limit?: unknown) => {
    assertTrustedSender(event)
    const resolvedLimit = limit === undefined ? 10 : limit
    assertInteger(resolvedLimit, 'limit')
    return listRecentFoods(resolvedLimit)
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_CREATE_FOOD_ITEM, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid food item input')
    }
    const payload = input as CreateFoodItemInput
    assertNonEmptyString(payload.name, 'name')
    assertNumber(payload.kcalPer100g, 'kcalPer100g')
    return createFoodItem(payload)
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_LOG_ENTRY, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid log entry input')
    }
    const payload = input as LogEntryInput
    assertNonEmptyString(payload.dateKey, 'dateKey')
    assertMealSlot(payload.mealSlot)
    if (!payload.foodItemId && (!payload.label || !payload.label.trim())) {
      throw new Error('label must be a non-empty string')
    }
    assertNumber(payload.kcal, 'kcal')
    return logEntry(payload)
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_UPDATE_ENTRY, (event, id: unknown, patch: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    if (!patch || typeof patch !== 'object') {
      throw new Error('Invalid entry patch')
    }
    const payload = patch as UpdateEntryInput
    if (payload.mealSlot !== undefined) {
      assertMealSlot(payload.mealSlot)
    }
    if (payload.kcal !== undefined) {
      assertNumber(payload.kcal, 'kcal')
    }
    if (payload.quantity !== undefined) {
      assertNumber(payload.quantity, 'quantity')
    }
    return updateEntry(id, payload)
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_DELETE_ENTRY, (event, id: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(id, 'id')
    deleteEntry(id)
    return { ok: true as const }
  })

  ipcMain.handle(
    IPC_CHANNELS.NUTRITION_QUICK_ADD_CALORIES,
    (event, dateKey: unknown, mealSlot: unknown, kcal: unknown, label?: unknown) => {
      assertTrustedSender(event)
      assertNonEmptyString(dateKey, 'dateKey')
      assertMealSlot(mealSlot)
      assertNumber(kcal, 'kcal')
      const resolvedLabel = typeof label === 'string' && label.trim() ? label.trim() : 'Quick add'
      return quickAddCalories(dateKey, mealSlot, kcal, resolvedLabel)
    }
  )

  ipcMain.handle(IPC_CHANNELS.NUTRITION_DESCRIBE_MEAL, async (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid describe input')
    }
    const payload = input as DescribeMealInput
    assertNonEmptyString(payload.text, 'text')
    assertNonEmptyString(payload.dateKey, 'dateKey')
    assertMealSlot(payload.mealSlot)
    return describeMeal(payload)
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_RESOLVE_DESCRIBE_ITEM, async (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid resolve input')
    }
    const payload = input as { phrase?: unknown; quantity?: unknown; unitHint?: unknown }
    assertNonEmptyString(payload.phrase, 'phrase')
    if (payload.quantity !== undefined) {
      assertNumber(payload.quantity, 'quantity')
    }
    return resolveDescribeItem({
      phrase: payload.phrase,
      quantity: payload.quantity as number | undefined,
      unitHint: typeof payload.unitHint === 'string' ? payload.unitHint : null
    })
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_COMMIT_DESCRIBE_PLATE, (event, input: unknown) => {
    assertTrustedSender(event)
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid plate input')
    }
    const payload = input as CommitDescribePlateInput
    assertNonEmptyString(payload.dateKey, 'dateKey')
    assertMealSlot(payload.mealSlot)
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new Error('items must be a non-empty array')
    }
    return commitDescribePlate(payload)
  })

  ipcMain.handle(
    IPC_CHANNELS.NUTRITION_SEARCH_FOODS,
    async (event, query: unknown, sources?: unknown) => {
      assertTrustedSender(event)
      assertNonEmptyString(query, 'query')
      const resolvedSources =
        sources === undefined
          ? undefined
          : (sources as Array<'local' | 'fdc' | 'off'>)
      return searchFoods(query, resolvedSources)
    }
  )

  ipcMain.handle(IPC_CHANNELS.NUTRITION_IMPORT_FDC_FOOD, async (event, fdcId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(fdcId, 'fdcId')
    return importFdcFood(fdcId)
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_LOOKUP_BARCODE, async (event, barcode: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(barcode, 'barcode')
    return lookupOffBarcode(barcode)
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_GET_LOOKUP_STATE, (event) => {
    assertTrustedSender(event)
    return getNutritionLookupState()
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_SET_USDA_API_KEY, (event, key: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(key, 'key')
    setUsdaApiKey(key)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_IMPORT_USDA_FOUNDATION, (event) => {
    assertTrustedSender(event)
    return downloadAndImportUsdaFoundation()
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_LIST_RECENT_DIARY_ENTRIES, (event, limit?: unknown) => {
    assertTrustedSender(event)
    const resolvedLimit = limit === undefined ? 12 : limit
    assertInteger(resolvedLimit, 'limit')
    return listRecentDiaryEntries(resolvedLimit)
  })

  ipcMain.handle(
    IPC_CHANNELS.NUTRITION_RELOG_RECENT_ENTRY,
    (event, dateKey: unknown, mealSlot: unknown, recent: unknown, quantity?: unknown) => {
      assertTrustedSender(event)
      assertNonEmptyString(dateKey, 'dateKey')
      assertMealSlot(mealSlot)
      if (!recent || typeof recent !== 'object') {
        throw new Error('Invalid recent entry')
      }
      if (quantity !== undefined) {
        assertNumber(quantity, 'quantity')
      }
      return relogRecentEntry(
        dateKey,
        mealSlot,
        recent as RecentDiaryEntry,
        quantity as number | undefined
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.NUTRITION_LIST_FAVORITE_FOODS, (event) => {
    assertTrustedSender(event)
    return listFavoriteFoods()
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_ADD_FAVORITE_FOOD, (event, foodItemId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(foodItemId, 'foodItemId')
    addFavoriteFood(foodItemId)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_REMOVE_FAVORITE_FOOD, (event, foodItemId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(foodItemId, 'foodItemId')
    removeFavoriteFood(foodItemId)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.NUTRITION_LIST_FOOD_SERVINGS, (event, foodItemId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(foodItemId, 'foodItemId')
    return listFoodServings(foodItemId)
  })
}
