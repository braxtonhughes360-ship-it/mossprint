import { randomUUID } from 'node:crypto'
import type {
  CommitDescribePlateInput,
  CreateFoodItemInput,
  DailyNutritionTotals,
  DescribeItemSource,
  FoodEntryRecord,
  FoodItemRecord,
  FoodServingRecord,
  LogEntryInput,
  MealSlot,
  NutritionDiary,
  NutritionDoorSnapshot,
  NutritionGoals,
  NutritionSummary,
  RecentDiaryEntry,
  SetGoalsInput,
  UpdateEntryInput
} from '@shared/nutrition'
import {
  DEFAULT_GOALS,
  MEAL_SLOTS,
  computeRemainingKcal,
  currentDateKey,
  mealSlotsWithEntries
} from '@shared/nutrition'
import { getDb } from './database'

const GOALS_ROW_ID = 'default'

const MEAL_SLOT_SET = new Set<string>(MEAL_SLOTS)

function assertMealSlot(value: string): asserts value is MealSlot {
  if (!MEAL_SLOT_SET.has(value)) {
    throw new Error(`Invalid meal slot: ${value}`)
  }
}

function rowToGoals(row: {
  calorie_target: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number | null
  updated_at: string
}): NutritionGoals {
  return {
    calorieTarget: row.calorie_target,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    fiberG: row.fiber_g,
    updatedAt: row.updated_at
  }
}

function rowToEntry(row: {
  id: string
  date_key: string
  meal_slot: string
  food_item_id: string | null
  quantity: number
  serving_id: string | null
  grams: number
  snapshot_kcal: number
  snapshot_protein_g: number
  snapshot_carbs_g: number
  snapshot_fat_g: number
  label: string
  logged_at: string
  created_at: string
}): FoodEntryRecord {
  return {
    id: row.id,
    dateKey: row.date_key,
    mealSlot: row.meal_slot as MealSlot,
    foodItemId: row.food_item_id,
    quantity: row.quantity,
    servingId: row.serving_id,
    grams: row.grams,
    snapshotKcal: row.snapshot_kcal,
    snapshotProteinG: row.snapshot_protein_g,
    snapshotCarbsG: row.snapshot_carbs_g,
    snapshotFatG: row.snapshot_fat_g,
    label: row.label,
    loggedAt: row.logged_at,
    createdAt: row.created_at
  }
}

function rowToTotals(row: {
  date_key: string
  consumed_kcal: number
  consumed_protein_g: number
  consumed_carbs_g: number
  consumed_fat_g: number
  entry_count: number
  updated_at: string
}): DailyNutritionTotals {
  return {
    dateKey: row.date_key,
    consumedKcal: row.consumed_kcal,
    consumedProteinG: row.consumed_protein_g,
    consumedCarbsG: row.consumed_carbs_g,
    consumedFatG: row.consumed_fat_g,
    entryCount: row.entry_count,
    updatedAt: row.updated_at
  }
}

function emptyTotals(dateKey: string): DailyNutritionTotals {
  const now = new Date().toISOString()
  return {
    dateKey,
    consumedKcal: 0,
    consumedProteinG: 0,
    consumedCarbsG: 0,
    consumedFatG: 0,
    entryCount: 0,
    updatedAt: now
  }
}

function ensureGoals(): NutritionGoals {
  const existing = getDb()
    .prepare(
      `SELECT calorie_target, protein_g, carbs_g, fat_g, fiber_g, updated_at
       FROM nutrition_goals WHERE id = ?`
    )
    .get(GOALS_ROW_ID) as
    | {
        calorie_target: number
        protein_g: number
        carbs_g: number
        fat_g: number
        fiber_g: number | null
        updated_at: string
      }
    | undefined

  if (existing) {
    return rowToGoals(existing)
  }

  const updatedAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO nutrition_goals (id, calorie_target, protein_g, carbs_g, fat_g, fiber_g, updated_at)
       VALUES (@id, @calorieTarget, @proteinG, @carbsG, @fatG, @fiberG, @updatedAt)`
    )
    .run({
      id: GOALS_ROW_ID,
      calorieTarget: DEFAULT_GOALS.calorieTarget,
      proteinG: DEFAULT_GOALS.proteinG,
      carbsG: DEFAULT_GOALS.carbsG,
      fatG: DEFAULT_GOALS.fatG,
      fiberG: DEFAULT_GOALS.fiberG,
      updatedAt
    })

  return {
    ...DEFAULT_GOALS,
    updatedAt
  }
}

function recomputeDailyTotals(dateKey: string): DailyNutritionTotals {
  const sums = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(snapshot_kcal), 0) AS consumed_kcal,
         COALESCE(SUM(snapshot_protein_g), 0) AS consumed_protein_g,
         COALESCE(SUM(snapshot_carbs_g), 0) AS consumed_carbs_g,
         COALESCE(SUM(snapshot_fat_g), 0) AS consumed_fat_g,
         COUNT(*) AS entry_count
       FROM food_entries
       WHERE date_key = ?`
    )
    .get(dateKey) as {
    consumed_kcal: number
    consumed_protein_g: number
    consumed_carbs_g: number
    consumed_fat_g: number
    entry_count: number
  }

  const updatedAt = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO daily_nutrition_totals (
         date_key, consumed_kcal, consumed_protein_g, consumed_carbs_g,
         consumed_fat_g, entry_count, updated_at
       ) VALUES (
         @dateKey, @consumedKcal, @consumedProteinG, @consumedCarbsG,
         @consumedFatG, @entryCount, @updatedAt
       )
       ON CONFLICT(date_key) DO UPDATE SET
         consumed_kcal = excluded.consumed_kcal,
         consumed_protein_g = excluded.consumed_protein_g,
         consumed_carbs_g = excluded.consumed_carbs_g,
         consumed_fat_g = excluded.consumed_fat_g,
         entry_count = excluded.entry_count,
         updated_at = excluded.updated_at`
    )
    .run({
      dateKey,
      consumedKcal: sums.consumed_kcal,
      consumedProteinG: sums.consumed_protein_g,
      consumedCarbsG: sums.consumed_carbs_g,
      consumedFatG: sums.consumed_fat_g,
      entryCount: sums.entry_count,
      updatedAt
    })

  return rowToTotals(
    getDb()
      .prepare(
        `SELECT date_key, consumed_kcal, consumed_protein_g, consumed_carbs_g,
                consumed_fat_g, entry_count, updated_at
         FROM daily_nutrition_totals WHERE date_key = ?`
      )
      .get(dateKey) as {
      date_key: string
      consumed_kcal: number
      consumed_protein_g: number
      consumed_carbs_g: number
      consumed_fat_g: number
      entry_count: number
      updated_at: string
    }
  )
}

function getTotalsForDate(dateKey: string): DailyNutritionTotals {
  const row = getDb()
    .prepare(
      `SELECT date_key, consumed_kcal, consumed_protein_g, consumed_carbs_g,
              consumed_fat_g, entry_count, updated_at
       FROM daily_nutrition_totals WHERE date_key = ?`
    )
    .get(dateKey) as
    | {
        date_key: string
        consumed_kcal: number
        consumed_protein_g: number
        consumed_carbs_g: number
        consumed_fat_g: number
        entry_count: number
        updated_at: string
      }
    | undefined

  if (row) {
    return rowToTotals(row)
  }

  if (
    (
      getDb()
        .prepare('SELECT COUNT(*) AS count FROM food_entries WHERE date_key = ?')
        .get(dateKey) as { count: number }
    ).count > 0
  ) {
    return recomputeDailyTotals(dateKey)
  }

  return emptyTotals(dateKey)
}

function buildSummary(dateKey: string, goals: NutritionGoals, totals: DailyNutritionTotals): NutritionSummary {
  const remainingKcal = computeRemainingKcal(goals.calorieTarget, totals.consumedKcal)

  let headline = 'Cycles · intake · balance'
  if (totals.entryCount > 0) {
    if (remainingKcal >= 0) {
      headline = `${Math.round(remainingKcal)} kcal remaining`
    } else {
      headline = `${Math.round(Math.abs(remainingKcal))} kcal over target`
    }
  }

  return {
    dateKey,
    goals,
    totals,
    remainingKcal,
    hasData: totals.entryCount > 0,
    headline
  }
}

export function getGoals(): NutritionGoals {
  return ensureGoals()
}

export function setGoals(input: SetGoalsInput): NutritionGoals {
  ensureGoals()
  const updatedAt = new Date().toISOString()

  getDb()
    .prepare(
      `UPDATE nutrition_goals SET
         calorie_target = @calorieTarget,
         protein_g = @proteinG,
         carbs_g = @carbsG,
         fat_g = @fatG,
         fiber_g = @fiberG,
         updated_at = @updatedAt
       WHERE id = @id`
    )
    .run({
      id: GOALS_ROW_ID,
      calorieTarget: input.calorieTarget,
      proteinG: input.proteinG,
      carbsG: input.carbsG,
      fatG: input.fatG,
      fiberG: input.fiberG ?? null,
      updatedAt
    })

  return getGoals()
}

export function getDiary(dateKey: string): NutritionDiary {
  const goals = ensureGoals()
  const rows = getDb()
    .prepare(
      `SELECT id, date_key, meal_slot, food_item_id, quantity, serving_id, grams,
              snapshot_kcal, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g,
              label, logged_at, created_at
       FROM food_entries
       WHERE date_key = ?
       ORDER BY meal_slot ASC, logged_at ASC`
    )
    .all(dateKey) as Array<{
    id: string
    date_key: string
    meal_slot: string
    food_item_id: string | null
    quantity: number
    serving_id: string | null
    grams: number
    snapshot_kcal: number
    snapshot_protein_g: number
    snapshot_carbs_g: number
    snapshot_fat_g: number
    label: string
    logged_at: string
    created_at: string
  }>

  const meals = MEAL_SLOTS.reduce(
    (acc, slot) => {
      acc[slot] = []
      return acc
    },
    {} as Record<MealSlot, FoodEntryRecord[]>
  )

  for (const row of rows) {
    const entry = rowToEntry(row)
    meals[entry.mealSlot].push(entry)
  }

  const totals = getTotalsForDate(dateKey)

  return {
    dateKey,
    goals,
    totals,
    remainingKcal: computeRemainingKcal(goals.calorieTarget, totals.consumedKcal),
    meals
  }
}

export function getSummary(dateKey = currentDateKey()): NutritionSummary {
  const goals = ensureGoals()
  const totals = getTotalsForDate(dateKey)
  return buildSummary(dateKey, goals, totals)
}

export function getDoorSnapshot(dateKey = currentDateKey()): NutritionDoorSnapshot {
  const goals = ensureGoals()
  const totals = getTotalsForDate(dateKey)
  const summary = buildSummary(dateKey, goals, totals)
  const diary = getDiary(dateKey)

  return {
    summary,
    macroProgress: {
      protein: { consumed: totals.consumedProteinG, target: goals.proteinG },
      carbs: { consumed: totals.consumedCarbsG, target: goals.carbsG },
      fat: { consumed: totals.consumedFatG, target: goals.fatG }
    },
    mealsLogged: mealSlotsWithEntries(diary.meals)
  }
}

export function listFoodItems(query?: string): FoodItemRecord[] {
  const trimmed = query?.trim()
  const rows = trimmed
    ? (getDb()
        .prepare(
          `SELECT id, source, external_id, name, brand, barcode,
                  kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                  fiber_per_100g, cached_at, created_at
           FROM food_items
           WHERE name LIKE @pattern OR brand LIKE @pattern
           ORDER BY name ASC
           LIMIT 50`
        )
        .all({ pattern: `%${trimmed}%` }) as Array<{
        id: string
        source: string
        external_id: string | null
        name: string
        brand: string | null
        barcode: string | null
        kcal_per_100g: number
        protein_per_100g: number
        carbs_per_100g: number
        fat_per_100g: number
        fiber_per_100g: number | null
        cached_at: string | null
        created_at: string
      }>)
    : (getDb()
        .prepare(
          `SELECT id, source, external_id, name, brand, barcode,
                  kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                  fiber_per_100g, cached_at, created_at
           FROM food_items
           ORDER BY name ASC
           LIMIT 50`
        )
        .all() as Array<{
        id: string
        source: string
        external_id: string | null
        name: string
        brand: string | null
        barcode: string | null
        kcal_per_100g: number
        protein_per_100g: number
        carbs_per_100g: number
        fat_per_100g: number
        fiber_per_100g: number | null
        cached_at: string | null
        created_at: string
      }>)

  return rows.map((row) => ({
    id: row.id,
    source: row.source as FoodItemRecord['source'],
    externalId: row.external_id,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    kcalPer100g: row.kcal_per_100g,
    proteinPer100g: row.protein_per_100g,
    carbsPer100g: row.carbs_per_100g,
    fatPer100g: row.fat_per_100g,
    fiberPer100g: row.fiber_per_100g,
    cachedAt: row.cached_at,
    createdAt: row.created_at
  }))
}

export function listRecentFoods(limit = 10): FoodItemRecord[] {
  const resolvedLimit = Math.min(Math.max(limit, 1), 50)
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT fi.id, fi.source, fi.external_id, fi.name, fi.brand, fi.barcode,
              fi.kcal_per_100g, fi.protein_per_100g, fi.carbs_per_100g, fi.fat_per_100g,
              fi.fiber_per_100g, fi.cached_at, fi.created_at,
              MAX(fe.logged_at) AS last_logged
       FROM food_items fi
       INNER JOIN food_entries fe ON fe.food_item_id = fi.id
       GROUP BY fi.id
       ORDER BY last_logged DESC
       LIMIT ?`
    )
    .all(resolvedLimit) as Array<{
    id: string
    source: string
    external_id: string | null
    name: string
    brand: string | null
    barcode: string | null
    kcal_per_100g: number
    protein_per_100g: number
    carbs_per_100g: number
    fat_per_100g: number
    fiber_per_100g: number | null
    cached_at: string | null
    created_at: string
  }>

  return rows.map((row) => ({
    id: row.id,
    source: row.source as FoodItemRecord['source'],
    externalId: row.external_id,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    kcalPer100g: row.kcal_per_100g,
    proteinPer100g: row.protein_per_100g,
    carbsPer100g: row.carbs_per_100g,
    fatPer100g: row.fat_per_100g,
    fiberPer100g: row.fiber_per_100g,
    cachedAt: row.cached_at,
    createdAt: row.created_at
  }))
}

export function createFoodItem(input: CreateFoodItemInput): FoodItemRecord {
  const id = randomUUID()
  const createdAt = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO food_items (
         id, source, external_id, name, brand, barcode,
         kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
         fiber_per_100g, cached_at, created_at
       ) VALUES (
         @id, 'manual', NULL, @name, @brand, NULL,
         @kcalPer100g, @proteinPer100g, @carbsPer100g, @fatPer100g,
         @fiberPer100g, NULL, @createdAt
       )`
    )
    .run({
      id,
      name: input.name.trim(),
      brand: input.brand?.trim() || null,
      kcalPer100g: input.kcalPer100g,
      proteinPer100g: input.proteinPer100g ?? 0,
      carbsPer100g: input.carbsPer100g ?? 0,
      fatPer100g: input.fatPer100g ?? 0,
      fiberPer100g: input.fiberPer100g ?? null,
      createdAt
    })

  if (input.defaultServing) {
    getDb()
      .prepare(
        `INSERT INTO food_servings (id, food_item_id, label, gram_weight, is_default, created_at)
         VALUES (@id, @foodItemId, @label, @gramWeight, 1, @createdAt)`
      )
      .run({
        id: randomUUID(),
        foodItemId: id,
        label: input.defaultServing.label.trim(),
        gramWeight: input.defaultServing.gramWeight,
        createdAt
      })
  }

  const row = getDb()
    .prepare(
      `SELECT id, source, external_id, name, brand, barcode,
              kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
              fiber_per_100g, cached_at, created_at
       FROM food_items WHERE id = ?`
    )
    .get(id) as {
    id: string
    source: string
    external_id: string | null
    name: string
    brand: string | null
    barcode: string | null
    kcal_per_100g: number
    protein_per_100g: number
    carbs_per_100g: number
    fat_per_100g: number
    fiber_per_100g: number | null
    cached_at: string | null
    created_at: string
  }

  return {
    id: row.id,
    source: row.source as FoodItemRecord['source'],
    externalId: row.external_id,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    kcalPer100g: row.kcal_per_100g,
    proteinPer100g: row.protein_per_100g,
    carbsPer100g: row.carbs_per_100g,
    fatPer100g: row.fat_per_100g,
    fiberPer100g: row.fiber_per_100g,
    cachedAt: row.cached_at,
    createdAt: row.created_at
  }
}

function nutrientsFromFoodItem(
  foodItemId: string,
  quantity: number,
  servingId?: string | null,
  gramsOverride?: number
): {
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  grams: number
  label: string
} {
  const item = getDb()
    .prepare(
      `SELECT name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g
       FROM food_items WHERE id = ?`
    )
    .get(foodItemId) as
    | {
        name: string
        kcal_per_100g: number
        protein_per_100g: number
        carbs_per_100g: number
        fat_per_100g: number
      }
    | undefined

  if (!item) {
    throw new Error('Food item not found')
  }

  let resolvedGrams = gramsOverride ?? 0
  if (!gramsOverride) {
    if (servingId) {
      const serving = getDb()
        .prepare('SELECT gram_weight FROM food_servings WHERE id = ? AND food_item_id = ?')
        .get(servingId, foodItemId) as { gram_weight: number } | undefined
      resolvedGrams = (serving?.gram_weight ?? 100) * quantity
    } else {
      const defaultServing = getDb()
        .prepare(
          'SELECT gram_weight FROM food_servings WHERE food_item_id = ? AND is_default = 1 LIMIT 1'
        )
        .get(foodItemId) as { gram_weight: number } | undefined
      resolvedGrams = (defaultServing?.gram_weight ?? 100) * quantity
    }
  }

  const factor = resolvedGrams / 100

  return {
    kcal: item.kcal_per_100g * factor,
    proteinG: item.protein_per_100g * factor,
    carbsG: item.carbs_per_100g * factor,
    fatG: item.fat_per_100g * factor,
    grams: resolvedGrams,
    label: item.name
  }
}

export function logEntry(input: LogEntryInput): FoodEntryRecord {
  assertMealSlot(input.mealSlot)

  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const loggedAt = createdAt

  let snapshotKcal = input.kcal
  let snapshotProteinG = input.proteinG ?? 0
  let snapshotCarbsG = input.carbsG ?? 0
  let snapshotFatG = input.fatG ?? 0
  let label = input.label.trim()
  let grams = input.grams ?? 0
  const quantity = input.quantity ?? 1
  const foodItemId = input.foodItemId ?? null
  const servingId = input.servingId ?? null

  if (foodItemId) {
    const computed = nutrientsFromFoodItem(
      foodItemId,
      quantity,
      servingId ?? input.servingId,
      input.grams
    )
    snapshotKcal = computed.kcal
    snapshotProteinG = computed.proteinG
    snapshotCarbsG = computed.carbsG
    snapshotFatG = computed.fatG
    grams = computed.grams
    if (!label) {
      label = computed.label
    }
  }

  if (!label) {
    throw new Error('Entry label is required')
  }

  getDb()
    .prepare(
      `INSERT INTO food_entries (
         id, date_key, meal_slot, food_item_id, quantity, serving_id, grams,
         snapshot_kcal, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g,
         label, logged_at, created_at
       ) VALUES (
         @id, @dateKey, @mealSlot, @foodItemId, @quantity, @servingId, @grams,
         @snapshotKcal, @snapshotProteinG, @snapshotCarbsG, @snapshotFatG,
         @label, @loggedAt, @createdAt
       )`
    )
    .run({
      id,
      dateKey: input.dateKey,
      mealSlot: input.mealSlot,
      foodItemId,
      quantity,
      servingId,
      grams,
      snapshotKcal,
      snapshotProteinG,
      snapshotCarbsG,
      snapshotFatG,
      label,
      loggedAt,
      createdAt
    })

  recomputeDailyTotals(input.dateKey)

  return rowToEntry(
    getDb()
      .prepare(
        `SELECT id, date_key, meal_slot, food_item_id, quantity, serving_id, grams,
                snapshot_kcal, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g,
                label, logged_at, created_at
         FROM food_entries WHERE id = ?`
      )
      .get(id) as {
      id: string
      date_key: string
      meal_slot: string
      food_item_id: string | null
      quantity: number
      serving_id: string | null
      grams: number
      snapshot_kcal: number
      snapshot_protein_g: number
      snapshot_carbs_g: number
      snapshot_fat_g: number
      label: string
      logged_at: string
      created_at: string
    }
  )
}

export function updateEntry(id: string, patch: UpdateEntryInput): FoodEntryRecord {
  const existing = getDb()
    .prepare(
      `SELECT id, date_key, meal_slot, food_item_id, quantity, serving_id, grams,
              snapshot_kcal, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g,
              label, logged_at, created_at
       FROM food_entries WHERE id = ?`
    )
    .get(id) as
    | {
        id: string
        date_key: string
        meal_slot: string
        food_item_id: string | null
        quantity: number
        serving_id: string | null
        grams: number
        snapshot_kcal: number
        snapshot_protein_g: number
        snapshot_carbs_g: number
        snapshot_fat_g: number
        label: string
        logged_at: string
        created_at: string
      }
    | undefined

  if (!existing) {
    throw new Error('Entry not found')
  }

  if (patch.mealSlot) {
    assertMealSlot(patch.mealSlot)
  }

  const nextLabel = patch.label?.trim() ?? existing.label
  const nextMealSlot = patch.mealSlot ?? existing.meal_slot
  const nextKcal = patch.kcal ?? existing.snapshot_kcal
  const nextProtein = patch.proteinG ?? existing.snapshot_protein_g
  const nextCarbs = patch.carbsG ?? existing.snapshot_carbs_g
  const nextFat = patch.fatG ?? existing.snapshot_fat_g
  const nextQuantity = patch.quantity ?? existing.quantity

  if (existing.food_item_id && patch.kcal === undefined && patch.proteinG === undefined) {
    const computed = nutrientsFromFoodItem(
      existing.food_item_id,
      nextQuantity,
      existing.serving_id
    )
    getDb()
      .prepare(
        `UPDATE food_entries SET
           meal_slot = @mealSlot,
           label = @label,
           quantity = @quantity,
           snapshot_kcal = @snapshotKcal,
           snapshot_protein_g = @snapshotProteinG,
           snapshot_carbs_g = @snapshotCarbsG,
           snapshot_fat_g = @snapshotFatG,
           grams = @grams
         WHERE id = @id`
      )
      .run({
        id,
        mealSlot: nextMealSlot,
        label: nextLabel,
        quantity: nextQuantity,
        snapshotKcal: computed.kcal,
        snapshotProteinG: computed.proteinG,
        snapshotCarbsG: computed.carbsG,
        snapshotFatG: computed.fatG,
        grams: computed.grams
      })
  } else {
    getDb()
      .prepare(
        `UPDATE food_entries SET
           meal_slot = @mealSlot,
           label = @label,
           quantity = @quantity,
           snapshot_kcal = @snapshotKcal,
           snapshot_protein_g = @snapshotProteinG,
           snapshot_carbs_g = @snapshotCarbsG,
           snapshot_fat_g = @snapshotFatG
         WHERE id = @id`
      )
      .run({
        id,
        mealSlot: nextMealSlot,
        label: nextLabel,
        quantity: nextQuantity,
        snapshotKcal: nextKcal,
        snapshotProteinG: nextProtein,
        snapshotCarbsG: nextCarbs,
        snapshotFatG: nextFat
      })
  }
  recomputeDailyTotals(existing.date_key)

  return rowToEntry(
    getDb()
      .prepare(
        `SELECT id, date_key, meal_slot, food_item_id, quantity, serving_id, grams,
                snapshot_kcal, snapshot_protein_g, snapshot_carbs_g, snapshot_fat_g,
                label, logged_at, created_at
         FROM food_entries WHERE id = ?`
      )
      .get(id) as {
      id: string
      date_key: string
      meal_slot: string
      food_item_id: string | null
      quantity: number
      serving_id: string | null
      grams: number
      snapshot_kcal: number
      snapshot_protein_g: number
      snapshot_carbs_g: number
      snapshot_fat_g: number
      label: string
      logged_at: string
      created_at: string
    }
  )
}

export function deleteEntry(id: string): void {
  const existing = getDb()
    .prepare('SELECT date_key FROM food_entries WHERE id = ?')
    .get(id) as { date_key: string } | undefined

  if (!existing) {
    throw new Error('Entry not found')
  }

  getDb().prepare('DELETE FROM food_entries WHERE id = ?').run(id)
  recomputeDailyTotals(existing.date_key)
}

export function quickAddCalories(
  dateKey: string,
  mealSlot: MealSlot,
  kcal: number,
  label = 'Quick add'
): FoodEntryRecord {
  assertMealSlot(mealSlot)

  return logEntry({
    dateKey,
    mealSlot,
    label,
    kcal,
    proteinG: 0,
    carbsG: 0,
    fatG: 0
  })
}

function mapEntrySource(source: string | null | undefined): DescribeItemSource {
  if (source === 'fdc' || source === 'off' || source === 'manual') {
    return source
  }
  if (source) return 'local'
  return 'manual'
}

export function listRecentDiaryEntries(limit = 12): RecentDiaryEntry[] {
  const resolvedLimit = Math.min(Math.max(limit, 1), 30)
  const rows = getDb()
    .prepare(
      `SELECT fe.label, fe.food_item_id, fe.serving_id, fe.quantity,
              fe.snapshot_kcal, fe.snapshot_protein_g, fe.snapshot_carbs_g, fe.snapshot_fat_g,
              fe.logged_at, fi.source
       FROM food_entries fe
       LEFT JOIN food_items fi ON fi.id = fe.food_item_id
       ORDER BY fe.logged_at DESC
       LIMIT ?`
    )
    .all(resolvedLimit * 4) as Array<{
    label: string
    food_item_id: string | null
    serving_id: string | null
    quantity: number
    snapshot_kcal: number
    snapshot_protein_g: number
    snapshot_carbs_g: number
    snapshot_fat_g: number
    logged_at: string
    source: string | null
  }>

  const seen = new Set<string>()
  const results: RecentDiaryEntry[] = []

  for (const row of rows) {
    const key = `${row.food_item_id ?? 'none'}::${row.label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      label: row.label,
      foodItemId: row.food_item_id,
      servingId: row.serving_id,
      quantity: row.quantity,
      snapshotKcal: row.snapshot_kcal,
      snapshotProteinG: row.snapshot_protein_g,
      snapshotCarbsG: row.snapshot_carbs_g,
      snapshotFatG: row.snapshot_fat_g,
      lastLoggedAt: row.logged_at,
      source: mapEntrySource(row.source)
    })
    if (results.length >= resolvedLimit) break
  }

  return results
}

export function listFavoriteFoods(): FoodItemRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT fi.id, fi.source, fi.external_id, fi.name, fi.brand, fi.barcode,
              fi.kcal_per_100g, fi.protein_per_100g, fi.carbs_per_100g, fi.fat_per_100g,
              fi.fiber_per_100g, fi.cached_at, fi.created_at
       FROM food_favorites ff
       INNER JOIN food_items fi ON fi.id = ff.food_item_id
       ORDER BY ff.created_at DESC`
    )
    .all() as Array<{
    id: string
    source: string
    external_id: string | null
    name: string
    brand: string | null
    barcode: string | null
    kcal_per_100g: number
    protein_per_100g: number
    carbs_per_100g: number
    fat_per_100g: number
    fiber_per_100g: number | null
    cached_at: string | null
    created_at: string
  }>

  return rows.map((row) => ({
    id: row.id,
    source: row.source as FoodItemRecord['source'],
    externalId: row.external_id,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    kcalPer100g: row.kcal_per_100g,
    proteinPer100g: row.protein_per_100g,
    carbsPer100g: row.carbs_per_100g,
    fatPer100g: row.fat_per_100g,
    fiberPer100g: row.fiber_per_100g,
    cachedAt: row.cached_at,
    createdAt: row.created_at
  }))
}

export function addFavoriteFood(foodItemId: string): void {
  const createdAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO food_favorites (food_item_id, created_at)
       VALUES (@foodItemId, @createdAt)
       ON CONFLICT(food_item_id) DO NOTHING`
    )
    .run({ foodItemId, createdAt })
}

export function removeFavoriteFood(foodItemId: string): void {
  getDb().prepare('DELETE FROM food_favorites WHERE food_item_id = ?').run(foodItemId)
}

export function listFoodServings(foodItemId: string): FoodServingRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, food_item_id, label, gram_weight, is_default, created_at
       FROM food_servings WHERE food_item_id = ? ORDER BY is_default DESC, label ASC`
    )
    .all(foodItemId) as Array<{
    id: string
    food_item_id: string
    label: string
    gram_weight: number
    is_default: number
    created_at: string
  }>

  return rows.map((row) => ({
    id: row.id,
    foodItemId: row.food_item_id,
    label: row.label,
    gramWeight: row.gram_weight,
    isDefault: row.is_default === 1,
    createdAt: row.created_at
  }))
}

export function commitDescribePlate(input: CommitDescribePlateInput): FoodEntryRecord[] {
  const entries: FoodEntryRecord[] = []

  for (const item of input.items) {
    if (item.foodItemId) {
      entries.push(
        logEntry({
          dateKey: input.dateKey,
          mealSlot: input.mealSlot,
          label: item.label,
          kcal: item.kcal,
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatG: item.fatG,
          foodItemId: item.foodItemId,
          servingId: item.servingId ?? null,
          quantity: item.quantity ?? 1
        })
      )
    } else {
      entries.push(
        logEntry({
          dateKey: input.dateKey,
          mealSlot: input.mealSlot,
          label: item.label,
          kcal: item.kcal,
          proteinG: item.proteinG ?? 0,
          carbsG: item.carbsG ?? 0,
          fatG: item.fatG ?? 0,
          quantity: item.quantity ?? 1
        })
      )
    }
  }

  return entries
}

export function relogRecentEntry(
  dateKey: string,
  mealSlot: MealSlot,
  recent: RecentDiaryEntry,
  quantity?: number
): FoodEntryRecord {
  const qty = quantity ?? recent.quantity

  if (recent.foodItemId) {
    return logEntry({
      dateKey,
      mealSlot,
      label: recent.label,
      kcal: recent.snapshotKcal,
      foodItemId: recent.foodItemId,
      servingId: recent.servingId,
      quantity: qty
    })
  }

  const factor = qty / (recent.quantity || 1)
  return logEntry({
    dateKey,
    mealSlot,
    label: recent.label,
    kcal: recent.snapshotKcal * factor,
    proteinG: recent.snapshotProteinG * factor,
    carbsG: recent.snapshotCarbsG * factor,
    fatG: recent.snapshotFatG * factor,
    quantity: qty
  })
}
