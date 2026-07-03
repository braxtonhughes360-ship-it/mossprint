import { randomUUID } from 'node:crypto'
import type { FoodItemRecord, FoodSearchResult, FoodSource } from '@shared/nutrition'
import { NUTRITION_USDA_API_KEY_SETTING } from '@shared/nutrition'
import { getSetting, setSetting } from './database'
import { getDb } from './database'
import { getUsdaFoundationCatalogState } from './nutritionUsdaImport'

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1'
const OFF_PRODUCT_BASE = 'https://world.openfoodfacts.org/api/v3/product'
const OFF_SEARCH_BASE = 'https://search.openfoodfacts.org/search'
const MOSS_USER_AGENT = 'MOSS/0.1 (personal nutrition app; local-first desktop client)'

let lastUsdaError: string | null = null
let lastOffError: string | null = null

interface FdcNutrient {
  nutrientId?: number
  nutrientName?: string
  unitName?: string
  value?: number
}

interface FdcSearchFood {
  fdcId: number
  description: string
  brandOwner?: string
  dataType?: string
}

interface FdcSearchResponse {
  foods?: FdcSearchFood[]
}

interface FdcFoodDetail {
  fdcId: number
  description: string
  brandOwner?: string
  foodNutrients?: FdcNutrient[]
}

interface OffNutriments {
  'energy-kcal_100g'?: number
  'energy-kcal'?: number
  energy_100g?: number
  proteins_100g?: number
  carbohydrates_100g?: number
  fat_100g?: number
  serving_size?: string
  serving_quantity?: number
}

const MAX_KCAL_PER_100G = 900
const MAX_MACRO_PER_100G = 100

function parseServingGrams(nutriments: OffNutriments): number | undefined {
  const quantity = nutriments.serving_quantity
  if (typeof quantity === 'number' && quantity > 0 && quantity < 2000) return quantity

  const raw = nutriments.serving_size?.trim().toLowerCase()
  if (!raw) return undefined
  const gramMatch = raw.match(/([\d.]+)\s*g/)
  if (gramMatch) return Number(gramMatch[1])
  const mlMatch = raw.match(/([\d.]+)\s*ml/)
  if (mlMatch) return Number(mlMatch[1])
  return undefined
}

function extractOffKcalPer100g(nutriments: OffNutriments): number {
  const per100 = nutriments['energy-kcal_100g']
  if (per100 != null && per100 > 0 && per100 <= MAX_KCAL_PER_100G) return per100

  const kj100 = nutriments.energy_100g
  if (kj100 != null && kj100 > 0) {
    const kcal = kj100 / 4.184
    if (kcal <= MAX_KCAL_PER_100G) return kcal
  }

  const kcalServing = nutriments['energy-kcal']
  if (kcalServing != null && kcalServing > 0) {
    const servingG = parseServingGrams(nutriments)
    if (servingG) {
      const derived = (kcalServing / servingG) * 100
      if (derived > 0 && derived <= MAX_KCAL_PER_100G) return derived
    }
    if (kcalServing <= MAX_KCAL_PER_100G) return kcalServing
  }

  return 0
}

function extractOffMacrosPer100g(nutriments: OffNutriments): {
  proteinPer100g: number
  carbsPer100g: number
  fatPer100g: number
} {
  const protein = nutriments.proteins_100g ?? 0
  const carbs = nutriments.carbohydrates_100g ?? 0
  const fat = nutriments.fat_100g ?? 0
  return {
    proteinPer100g: protein <= MAX_MACRO_PER_100G ? protein : 0,
    carbsPer100g: carbs <= MAX_MACRO_PER_100G ? carbs : 0,
    fatPer100g: fat <= MAX_MACRO_PER_100G ? fat : 0
  }
}

function isPlausibleOffHit(kcalPer100g: number, macros: ReturnType<typeof extractOffMacrosPer100g>): boolean {
  if (kcalPer100g <= 0 || kcalPer100g > MAX_KCAL_PER_100G) return false
  if (macros.proteinPer100g > MAX_MACRO_PER_100G || macros.carbsPer100g > MAX_MACRO_PER_100G) {
    return false
  }
  if (macros.fatPer100g > MAX_MACRO_PER_100G) return false
  return true
}

interface OffProductResponse {
  status?: number | string
  result?: { id?: string }
  product?: {
    product_name?: string
    brands?: string
    code?: string
    nutriments?: OffNutriments
  }
}

function isOffProductFound(payload: OffProductResponse): boolean {
  if (!payload.product) return false
  if (payload.status === 1 || payload.status === 'success') return true
  return payload.result?.id === 'product_found'
}

function getUsdaApiKey(): string | null {
  const fromEnv = process.env.NUTRITION_USDA_API_KEY?.trim()
  if (fromEnv) return fromEnv
  const record = getSetting(NUTRITION_USDA_API_KEY_SETTING)
  return record?.value?.trim() || null
}

function nutrientsFromFdcList(nutrients: FdcNutrient[] | undefined): {
  kcalPer100g: number
  proteinPer100g: number
  carbsPer100g: number
  fatPer100g: number
} {
  let kcalPer100g = 0
  let proteinPer100g = 0
  let carbsPer100g = 0
  let fatPer100g = 0

  for (const nutrient of nutrients ?? []) {
    const value = nutrient.value ?? 0
    const id = nutrient.nutrientId
    const name = (nutrient.nutrientName ?? '').toLowerCase()

    if (id === 1008 || name.includes('energy') && nutrient.unitName?.toLowerCase() === 'kcal') {
      kcalPer100g = value
    } else if (id === 2047 || id === 2048) {
      if (kcalPer100g === 0) kcalPer100g = value
    } else if (id === 1062 || (name.includes('energy') && nutrient.unitName?.toLowerCase() === 'kj')) {
      if (kcalPer100g === 0) kcalPer100g = value / 4.184
    } else if (id === 1003 || name === 'protein') {
      proteinPer100g = value
    } else if (id === 1005 || name.includes('carbohydrate')) {
      carbsPer100g = value
    } else if (id === 1004 || name.includes('total lipid') || name === 'fat') {
      fatPer100g = value
    }
  }

  return { kcalPer100g, proteinPer100g, carbsPer100g, fatPer100g }
}

export async function getNutritionLookupState(): Promise<{
  usdaApiKeyConfigured: boolean
  usdaFoundationCount: number
  usdaFoundationImportedAt: string | null
  usdaLastError: string | null
  offLastError: string | null
  describeLlmModel: string | null
  describeLlmError: string | null
}> {
  const foundation = getUsdaFoundationCatalogState()
  const { getDescribeLlmState } = await import('./nutritionDescribeLlm')
  const llm = await getDescribeLlmState()
  return {
    usdaApiKeyConfigured: Boolean(getUsdaApiKey()),
    usdaFoundationCount: foundation.count,
    usdaFoundationImportedAt: foundation.importedAt,
    usdaLastError: lastUsdaError,
    offLastError: lastOffError,
    describeLlmModel: llm.model,
    describeLlmError: llm.error
  }
}

export function setUsdaApiKey(key: string): void {
  setSetting(NUTRITION_USDA_API_KEY_SETTING, key.trim())
  lastUsdaError = null
}

function rowToFoodItem(row: {
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
}): FoodItemRecord {
  return {
    id: row.id,
    source: row.source as FoodSource,
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

function findCachedFood(source: FoodSource, externalId: string): FoodItemRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, source, external_id, name, brand, barcode,
              kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
              fiber_per_100g, cached_at, created_at
       FROM food_items WHERE source = ? AND external_id = ?`
    )
    .get(source, externalId) as
    | {
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
    | undefined

  return row ? rowToFoodItem(row) : null
}

function upsertCachedFood(input: {
  source: FoodSource
  externalId: string
  name: string
  brand: string | null
  barcode: string | null
  kcalPer100g: number
  proteinPer100g: number
  carbsPer100g: number
  fatPer100g: number
}): FoodItemRecord {
  const existing = findCachedFood(input.source, input.externalId)
  const now = new Date().toISOString()

  if (existing) {
    getDb()
      .prepare(
        `UPDATE food_items SET
           name = @name,
           brand = @brand,
           barcode = @barcode,
           kcal_per_100g = @kcalPer100g,
           protein_per_100g = @proteinPer100g,
           carbs_per_100g = @carbsPer100g,
           fat_per_100g = @fatPer100g,
           cached_at = @cachedAt
         WHERE id = @id`
      )
      .run({
        id: existing.id,
        name: input.name,
        brand: input.brand,
        barcode: input.barcode,
        kcalPer100g: input.kcalPer100g,
        proteinPer100g: input.proteinPer100g,
        carbsPer100g: input.carbsPer100g,
        fatPer100g: input.fatPer100g,
        cachedAt: now
      })
    return findCachedFood(input.source, input.externalId)!
  }

  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO food_items (
         id, source, external_id, name, brand, barcode,
         kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
         fiber_per_100g, cached_at, created_at
       ) VALUES (
         @id, @source, @externalId, @name, @brand, @barcode,
         @kcalPer100g, @proteinPer100g, @carbsPer100g, @fatPer100g,
         NULL, @cachedAt, @createdAt
       )`
    )
    .run({
      id,
      source: input.source,
      externalId: input.externalId,
      name: input.name,
      brand: input.brand,
      barcode: input.barcode,
      kcalPer100g: input.kcalPer100g,
      proteinPer100g: input.proteinPer100g,
      carbsPer100g: input.carbsPer100g,
      fatPer100g: input.fatPer100g,
      cachedAt: now,
      createdAt: now
    })

  return findCachedFood(input.source, input.externalId)!
}

export function searchLocalFoods(query: string, limit = 15): FoodSearchResult[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return []

  const tokens = trimmed.split(/\s+/).filter((token) => token.length > 1)
  const rows = getDb()
    .prepare(
      `SELECT id, source, external_id, name, brand, barcode,
              kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g
       FROM food_items
       WHERE kcal_per_100g > 0`
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
  }>

  const scored = rows
    .map((row) => {
      const haystack = `${row.name} ${row.brand ?? ''}`.toLowerCase()
      let score = 0
      if (haystack.includes(trimmed)) score += 100
      let tokenHits = 0
      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 20
          tokenHits += 1
        }
      }
      if (tokens.length > 1 && tokenHits < Math.min(2, tokens.length)) {
        score = 0
      }
      if (tokens.length === 1 && tokenHits === 0) {
        score = 0
      }
      if (row.source === 'manual') score += 5
      if (row.source === 'fdc') score += 2
      return { row, score }
    })
    .filter((entry) => entry.score >= 20)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, limit)

  return scored.map(({ row }) => ({
    source: row.source as FoodSource,
    externalId: row.external_id ?? row.id,
    name: row.name,
    brand: row.brand,
    kcalPer100g: row.kcal_per_100g,
    proteinPer100g: row.protein_per_100g,
    carbsPer100g: row.carbs_per_100g,
    fatPer100g: row.fat_per_100g,
    barcode: row.barcode
  }))
}

export async function searchUsdaFoods(query: string, limit = 8): Promise<FoodSearchResult[]> {
  const apiKey = getUsdaApiKey()
  if (!apiKey) {
    lastUsdaError = 'USDA API key not configured'
    return []
  }

  const url = new URL(`${USDA_BASE}/foods/search`)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('query', query.trim())
  url.searchParams.set('pageSize', String(Math.min(limit, 25)))
  url.searchParams.set('dataType', 'Foundation,SR Legacy')

  try {
    const response = await fetch(url.toString())
    if (!response.ok) {
      lastUsdaError = `USDA search failed (${response.status})`
      return []
    }

    const payload = (await response.json()) as FdcSearchResponse
    lastUsdaError = null

    return (payload.foods ?? []).slice(0, limit).map((food) => ({
      source: 'fdc' as const,
      externalId: String(food.fdcId),
      name: food.description,
      brand: food.brandOwner ?? null,
      kcalPer100g: 0,
      proteinPer100g: 0,
      carbsPer100g: 0,
      fatPer100g: 0
    }))
  } catch (err) {
    lastUsdaError = err instanceof Error ? err.message : 'USDA search failed'
    return []
  }
}

export async function importFdcFood(fdcId: string): Promise<FoodItemRecord> {
  const cached = findCachedFood('fdc', fdcId)
  if (cached) return cached

  const apiKey = getUsdaApiKey()
  if (!apiKey) {
    throw new Error('USDA API key not configured')
  }

  const url = new URL(`${USDA_BASE}/food/${fdcId}`)
  url.searchParams.set('api_key', apiKey)

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`USDA food detail failed (${response.status})`)
  }

  const food = (await response.json()) as FdcFoodDetail
  const macros = nutrientsFromFdcList(food.foodNutrients)
  lastUsdaError = null

  return upsertCachedFood({
    source: 'fdc',
    externalId: String(food.fdcId),
    name: food.description,
    brand: food.brandOwner ?? null,
    barcode: null,
    ...macros
  })
}

export async function lookupOffBarcode(barcode: string): Promise<FoodItemRecord | null> {
  const trimmed = barcode.trim()
  if (!trimmed) return null

  const cached = findCachedFood('off', trimmed)
  if (cached) return cached

  try {
    const response = await fetch(`${OFF_PRODUCT_BASE}/${encodeURIComponent(trimmed)}.json`, {
      headers: { 'User-Agent': MOSS_USER_AGENT }
    })
    if (!response.ok) {
      lastOffError = `OFF product failed (${response.status})`
      return null
    }

    const payload = (await response.json()) as OffProductResponse
    if (!isOffProductFound(payload) || !payload.product) {
      lastOffError = 'Product not found in Open Food Facts'
      return null
    }

    const product = payload.product
    const nutriments = product.nutriments ?? {}
    const macros = extractOffMacrosPer100g(nutriments)
    const kcalPer100g = extractOffKcalPer100g(nutriments)
    if (!isPlausibleOffHit(kcalPer100g, macros)) {
      lastOffError = 'Product nutrition data out of range'
      return null
    }

    lastOffError = null
    return upsertCachedFood({
      source: 'off',
      externalId: trimmed,
      name: product.product_name?.trim() || 'Packaged food',
      brand: product.brands?.trim() || null,
      barcode: trimmed,
      kcalPer100g,
      proteinPer100g: macros.proteinPer100g,
      carbsPer100g: macros.carbsPer100g,
      fatPer100g: macros.fatPer100g
    })
  } catch (err) {
    lastOffError = err instanceof Error ? err.message : 'OFF lookup failed'
    return null
  }
}

interface OffSearchHit {
  code?: string
  product_name?: string
  brands?: string[] | string
  nutriments?: OffNutriments
}

interface OffSearchResponse {
  hits?: OffSearchHit[]
}

function normalizeOffBrands(brands: OffSearchHit['brands']): string | null {
  if (!brands) return null
  if (Array.isArray(brands)) return brands.join(', ') || null
  return brands.trim() || null
}

export async function searchOffFoods(query: string, limit = 8): Promise<FoodSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const url = new URL(OFF_SEARCH_BASE)
  url.searchParams.set('q', trimmed)
  url.searchParams.set('page_size', String(Math.min(limit, 10)))
  url.searchParams.set('langs', 'en')
  url.searchParams.set('fields', 'code,product_name,brands,nutriments')

  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': MOSS_USER_AGENT }
    })
    if (!response.ok) {
      lastOffError = `OFF search failed (${response.status})`
      return []
    }

    const payload = (await response.json()) as OffSearchResponse
    lastOffError = null

    return (payload.hits ?? [])
      .filter((hit) => hit.code && hit.product_name)
      .slice(0, limit)
      .map((hit) => {
        const nutriments = hit.nutriments ?? {}
        const macros = extractOffMacrosPer100g(nutriments)
        const kcalPer100g = extractOffKcalPer100g(nutriments)
        return {
          source: 'off' as const,
          externalId: hit.code!,
          name: hit.product_name!.trim(),
          brand: normalizeOffBrands(hit.brands),
          kcalPer100g,
          proteinPer100g: macros.proteinPer100g,
          carbsPer100g: macros.carbsPer100g,
          fatPer100g: macros.fatPer100g,
          barcode: hit.code!
        }
      })
      .filter((item) => isPlausibleOffHit(item.kcalPer100g, {
        proteinPer100g: item.proteinPer100g,
        carbsPer100g: item.carbsPer100g,
        fatPer100g: item.fatPer100g
      }))
  } catch (err) {
    lastOffError = err instanceof Error ? err.message : 'OFF search failed'
    return []
  }
}

export async function importOffSearchResult(hit: FoodSearchResult): Promise<FoodItemRecord | null> {
  if (hit.kcalPer100g > 0 && hit.barcode) {
    return upsertCachedFood({
      source: 'off',
      externalId: hit.barcode,
      name: hit.name,
      brand: hit.brand,
      barcode: hit.barcode,
      kcalPer100g: hit.kcalPer100g,
      proteinPer100g: hit.proteinPer100g,
      carbsPer100g: hit.carbsPer100g,
      fatPer100g: hit.fatPer100g
    })
  }
  return lookupOffBarcode(hit.barcode ?? hit.externalId)
}

export async function searchFoods(
  query: string,
  sources: Array<'local' | 'fdc' | 'off'> = ['local', 'fdc', 'off']
): Promise<FoodSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const results: FoodSearchResult[] = []

  if (sources.includes('local')) {
    results.push(...searchLocalFoods(trimmed, 10))
  }

  if (sources.includes('off')) {
    const off = await searchOffFoods(trimmed, 6)
    for (const item of off) {
      if (!results.some((row) => row.source === item.source && row.externalId === item.externalId)) {
        results.push(item)
      }
    }
  }

  if (sources.includes('fdc')) {
    const usda = await searchUsdaFoods(trimmed, 8)
    for (const item of usda) {
      if (!results.some((row) => row.source === item.source && row.externalId === item.externalId)) {
        results.push(item)
      }
    }
  }

  return results.slice(0, 20)
}
