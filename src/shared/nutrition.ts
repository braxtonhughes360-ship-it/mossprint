export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export type FoodSource = 'manual' | 'off' | 'fdc'

export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks'
}

export interface NutritionGoals {
  calorieTarget: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number | null
  updatedAt: string
}

export interface FoodItemRecord {
  id: string
  source: FoodSource
  externalId: string | null
  name: string
  brand: string | null
  barcode: string | null
  kcalPer100g: number
  proteinPer100g: number
  carbsPer100g: number
  fatPer100g: number
  fiberPer100g: number | null
  cachedAt: string | null
  createdAt: string
}

export interface FoodServingRecord {
  id: string
  foodItemId: string
  label: string
  gramWeight: number
  isDefault: boolean
  createdAt: string
}

export interface FoodEntryRecord {
  id: string
  dateKey: string
  mealSlot: MealSlot
  foodItemId: string | null
  quantity: number
  servingId: string | null
  grams: number
  snapshotKcal: number
  snapshotProteinG: number
  snapshotCarbsG: number
  snapshotFatG: number
  label: string
  loggedAt: string
  createdAt: string
}

export interface DailyNutritionTotals {
  dateKey: string
  consumedKcal: number
  consumedProteinG: number
  consumedCarbsG: number
  consumedFatG: number
  entryCount: number
  updatedAt: string
}

export interface MacroProgress {
  consumed: number
  target: number
}

export interface NutritionSummary {
  dateKey: string
  goals: NutritionGoals
  totals: DailyNutritionTotals
  remainingKcal: number
  hasData: boolean
  headline: string
}

export interface NutritionDoorSnapshot {
  summary: NutritionSummary
  macroProgress: {
    protein: MacroProgress
    carbs: MacroProgress
    fat: MacroProgress
  }
  mealsLogged: number
}

export interface NutritionDiary {
  dateKey: string
  goals: NutritionGoals
  totals: DailyNutritionTotals
  remainingKcal: number
  meals: Record<MealSlot, FoodEntryRecord[]>
}

export interface SetGoalsInput {
  calorieTarget: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number | null
}

export interface LogEntryInput {
  dateKey: string
  mealSlot: MealSlot
  label: string
  kcal: number
  proteinG?: number
  carbsG?: number
  fatG?: number
  foodItemId?: string | null
  quantity?: number
  servingId?: string | null
  grams?: number
}

export interface UpdateEntryInput {
  label?: string
  kcal?: number
  proteinG?: number
  carbsG?: number
  fatG?: number
  mealSlot?: MealSlot
  quantity?: number
}

export type DescribeItemSource =
  | 'local'
  | 'fdc'
  | 'off'
  | 'manual'
  | 'estimate'
  | 'llm'
  | 'unresolved'

export type DescribeConfidence = 'high' | 'medium' | 'low'

export interface CreateFoodServingInput {
  label: string
  gramWeight: number
  isDefault?: boolean
}

export interface CreateFoodItemInput {
  name: string
  brand?: string
  kcalPer100g: number
  proteinPer100g?: number
  carbsPer100g?: number
  fatPer100g?: number
  fiberPer100g?: number | null
  defaultServing?: CreateFoodServingInput
}

export interface FoodSearchResult {
  source: FoodSource
  externalId: string
  name: string
  brand: string | null
  kcalPer100g: number
  proteinPer100g: number
  carbsPer100g: number
  fatPer100g: number
  barcode?: string | null
}

export interface RecentDiaryEntry {
  label: string
  foodItemId: string | null
  servingId: string | null
  quantity: number
  snapshotKcal: number
  snapshotProteinG: number
  snapshotCarbsG: number
  snapshotFatG: number
  lastLoggedAt: string
  source: DescribeItemSource
}

export interface DescribeMealInput {
  text: string
  dateKey: string
  mealSlot: MealSlot
}

export interface DescribeDraftItem {
  id: string
  rawPhrase: string
  quantity: number
  unitHint: string | null
  label: string
  foodItemId: string | null
  servingId: string | null
  snapshotKcal: number
  snapshotProteinG: number
  snapshotCarbsG: number
  snapshotFatG: number
  /** Per-100g rates when resolved from catalog — enables qty recompute in review plate. */
  per100gKcal: number | null
  per100gProteinG: number | null
  per100gCarbsG: number | null
  per100gFatG: number | null
  /** Gram weight for one quantity unit at resolve time (e.g. one slice = 100g). */
  unitGramWeight: number | null
  source: DescribeItemSource
  confidence: DescribeConfidence
  /** Other plausible matches — tap to swap on review plate. */
  alternates?: DescribeAlternate[]
}

/** Lighter row for alternate-match chips on the review plate. */
export interface DescribeAlternate {
  label: string
  snapshotKcal: number
  snapshotProteinG: number
  snapshotCarbsG: number
  snapshotFatG: number
  foodItemId: string | null
  servingId: string | null
  per100gKcal: number | null
  per100gProteinG: number | null
  per100gCarbsG: number | null
  per100gFatG: number | null
  unitGramWeight: number | null
  source: DescribeItemSource
  confidence: DescribeConfidence
}

export interface ResolveDescribeItemInput {
  phrase: string
  quantity?: number
  unitHint?: string | null
}

export interface DescribeMealResult {
  mealSlot: MealSlot
  items: DescribeDraftItem[]
  parseWarnings: string[]
}

export interface CommitDescribePlateItem {
  foodItemId?: string | null
  servingId?: string | null
  label: string
  quantity?: number
  kcal: number
  proteinG?: number
  carbsG?: number
  fatG?: number
}

export interface CommitDescribePlateInput {
  dateKey: string
  mealSlot: MealSlot
  items: CommitDescribePlateItem[]
}

export interface NutritionLookupState {
  usdaApiKeyConfigured: boolean
  usdaFoundationCount: number
  usdaFoundationImportedAt: string | null
  usdaLastError: string | null
  offLastError: string | null
  /** Local Ollama model powering Describe smart parsing; null when Ollama is not reachable. */
  describeLlmModel: string | null
  describeLlmError: string | null
}

export interface UsdaFoundationImportResult {
  imported: number
  updated: number
  skipped: number
  total: number
}

export const NUTRITION_USDA_API_KEY_SETTING = 'nutrition_usda_api_key'

export function formatFoodSource(source: DescribeItemSource): string {
  switch (source) {
    case 'local':
      return 'Yours'
    case 'fdc':
      return 'USDA'
    case 'off':
      return 'OFF'
    case 'manual':
      return 'Manual'
    case 'estimate':
      return 'Estimate'
    case 'llm':
      return 'Local AI'
    case 'unresolved':
      return 'Unresolved'
  }
}

/** Estimated gram weight for common unit hints in Describe parser. */
export const DESCRIBE_UNIT_GRAMS: Record<string, number> = {
  slice: 100,
  slices: 100,
  piece: 50,
  pieces: 50,
  glass: 240,
  cup: 240,
  cups: 240,
  bowl: 240,
  bowls: 240,
  tbsp: 15,
  teaspoon: 5,
  tsp: 5,
  serving: 100,
  servings: 100,
  can: 355,
  bottle: 500,
  plate: 350,
  plates: 350,
  oz: 28,
  scoop: 65,
  scoops: 65,
  handful: 30,
  handfuls: 30,
  strip: 15,
  strips: 15,
  wedge: 40,
  wedges: 40,
  patty: 85,
  patties: 85,
  wing: 45,
  wings: 45,
  fillet: 150,
  fillets: 150,
  link: 45,
  links: 45,
  muffin: 60,
  muffins: 60,
  bagel: 100,
  bagels: 100,
  tortilla: 45,
  tortillas: 45,
  g: 1,
  gram: 1,
  grams: 1
}

export const DEFAULT_GOALS: Omit<NutritionGoals, 'updatedAt'> = {
  calorieTarget: 2000,
  proteinG: 150,
  carbsG: 200,
  fatG: 65,
  fiberG: null
}

/** Local calendar date YYYY-MM-DD. */
export function currentDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const next = new Date(year, month - 1, day)
  next.setDate(next.getDate() + deltaDays)
  return currentDateKey(next)
}

export function formatDateKeyLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(date)
}

export function formatKcal(value: number): string {
  return `${Math.round(value).toLocaleString()} kcal`
}

export function formatMacroG(value: number): string {
  return `${Math.round(value * 10) / 10}g`
}

export function computeDescribeSnapshots(
  per100g: { kcal: number; protein: number; carbs: number; fat: number },
  quantity: number,
  unitHint: string | null,
  unitGramWeightOverride?: number | null
): {
  snapshotKcal: number
  snapshotProteinG: number
  snapshotCarbsG: number
  snapshotFatG: number
  unitGramWeight: number
} {
  const unitGrams = unitHint ? DESCRIBE_UNIT_GRAMS[unitHint.toLowerCase()] : undefined
  let unitGramWeight = 100
  if (unitHint && (unitHint === 'g' || unitHint === 'gram' || unitHint === 'grams')) {
    unitGramWeight = 1
  } else if (unitGramWeightOverride != null && unitGramWeightOverride > 0) {
    unitGramWeight = unitGramWeightOverride
  } else if (unitGrams) {
    unitGramWeight = unitGrams
  }
  const grams = quantity * unitGramWeight
  const factor = grams / 100
  return {
    snapshotKcal: per100g.kcal * factor,
    snapshotProteinG: per100g.protein * factor,
    snapshotCarbsG: per100g.carbs * factor,
    snapshotFatG: per100g.fat * factor,
    unitGramWeight
  }
}

export function computeRemainingKcal(calorieTarget: number, consumedKcal: number): number {
  return calorieTarget - consumedKcal
}

export function remainingKcalLabel(remainingKcal: number): 'Remaining' | 'Over' {
  return remainingKcal < 0 ? 'Over' : 'Remaining'
}

/** Single-line hero readout for macro strip and doors. */
export function formatRemainingKcalLine(remainingKcal: number): string {
  if (remainingKcal < 0) {
    return `${formatKcal(Math.abs(remainingKcal))} over goal`
  }
  return `${formatKcal(remainingKcal)} remaining`
}

export function mealSlotsWithEntries(
  meals: Record<MealSlot, FoodEntryRecord[]>
): number {
  return MEAL_SLOTS.filter((slot) => meals[slot].length > 0).length
}

/** Infer default meal slot from local time (MFP-style). */
export function inferMealSlotFromTime(date = new Date()): MealSlot {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 15 && hour < 21) return 'dinner'
  return 'snack'
}
