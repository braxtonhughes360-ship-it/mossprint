import { randomUUID } from 'node:crypto'
import { getDb, getSetting, setSetting } from './database'

export const NUTRITION_USDA_FOUNDATION_IMPORTED_AT = 'nutrition_usda_foundation_imported_at'
export const USDA_FOUNDATION_JSON_URL =
  'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2025-04-24.zip'

interface FdcNutrientEntry {
  nutrient?: { id?: number; number?: string; name?: string; unitName?: string }
  amount?: number
}

interface FdcFoundationFood {
  fdcId: number
  description: string
  foodNutrients?: FdcNutrientEntry[]
}

interface FdcFoundationPayload {
  FoundationFoods?: FdcFoundationFood[]
}

export interface UsdaFoundationImportResult {
  imported: number
  updated: number
  skipped: number
  total: number
}

export function getUsdaFoundationCatalogState(): {
  count: number
  importedAt: string | null
} {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM food_items WHERE source = 'fdc'`)
    .get() as { count: number }
  const setting = getSetting(NUTRITION_USDA_FOUNDATION_IMPORTED_AT)
  return {
    count: row.count,
    importedAt: setting?.value ?? null
  }
}

export function macrosFromFoundationNutrients(nutrients: FdcNutrientEntry[] | undefined): {
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
    const value = nutrient.amount ?? 0
    const id = nutrient.nutrient?.id
    const number = nutrient.nutrient?.number
    const name = (nutrient.nutrient?.name ?? '').toLowerCase()
    const unit = (nutrient.nutrient?.unitName ?? '').toLowerCase()

    if (
      id === 1008 ||
      id === 2047 ||
      id === 2048 ||
      number === '208' ||
      (name.includes('energy') && unit === 'kcal')
    ) {
      if (kcalPer100g === 0) kcalPer100g = value
    } else if (id === 1062 || number === '268' || (name.includes('energy') && unit === 'kj')) {
      if (kcalPer100g === 0) kcalPer100g = value / 4.184
    } else if (id === 1003 || number === '203' || name === 'protein') {
      proteinPer100g = value
    } else if (id === 1005 || number === '205' || name.includes('carbohydrate')) {
      carbsPer100g = value
    } else if (id === 1004 || number === '204' || name.includes('total lipid') || name === 'fat') {
      fatPer100g = value
    }
  }

  return { kcalPer100g, proteinPer100g, carbsPer100g, fatPer100g }
}

function upsertFoundationFood(food: FdcFoundationFood): 'imported' | 'updated' | 'skipped' {
  const externalId = String(food.fdcId)
  const macros = macrosFromFoundationNutrients(food.foodNutrients)
  if (macros.kcalPer100g <= 0) return 'skipped'

  const db = getDb()
  const existing = db
    .prepare(`SELECT id FROM food_items WHERE source = 'fdc' AND external_id = ?`)
    .get(externalId) as { id: string } | undefined

  const now = new Date().toISOString()
  const name = food.description.trim()
  if (!name) return 'skipped'

  if (existing) {
    db.prepare(
      `UPDATE food_items SET
         name = @name,
         kcal_per_100g = @kcalPer100g,
         protein_per_100g = @proteinPer100g,
         carbs_per_100g = @carbsPer100g,
         fat_per_100g = @fatPer100g,
         cached_at = @cachedAt
       WHERE id = @id`
    ).run({ id: existing.id, name, ...macros, cachedAt: now })
    return 'updated'
  }

  db.prepare(
    `INSERT INTO food_items (
       id, source, external_id, name, brand, barcode,
       kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
       fiber_per_100g, cached_at, created_at
     ) VALUES (
       @id, 'fdc', @externalId, @name, NULL, NULL,
       @kcalPer100g, @proteinPer100g, @carbsPer100g, @fatPer100g,
       NULL, @cachedAt, @createdAt
     )`
  ).run({
    id: randomUUID(),
    externalId,
    name,
    ...macros,
    cachedAt: now,
    createdAt: now
  })
  return 'imported'
}

export function importUsdaFoundationFromPayload(payload: FdcFoundationPayload): UsdaFoundationImportResult {
  const foods = payload.FoundationFoods ?? []
  let imported = 0
  let updated = 0
  let skipped = 0

  const db = getDb()
  const run = db.transaction(() => {
    for (const food of foods) {
      const outcome = upsertFoundationFood(food)
      if (outcome === 'imported') imported += 1
      else if (outcome === 'updated') updated += 1
      else skipped += 1
    }
  })
  run()

  if (imported + updated > 0) {
    setSetting(NUTRITION_USDA_FOUNDATION_IMPORTED_AT, new Date().toISOString())
  }

  return { imported, updated, skipped, total: foods.length }
}

export function importUsdaFoundationFromJson(jsonText: string): UsdaFoundationImportResult {
  const payload = JSON.parse(jsonText) as FdcFoundationPayload
  return importUsdaFoundationFromPayload(payload)
}

async function unzipSingleJson(buffer: Buffer): Promise<string> {
  // Minimal ZIP reader: foundation bundle is a single JSON entry.
  const signature = buffer.indexOf('PK')
  if (signature === -1) {
    return buffer.toString('utf8')
  }

  let offset = 0
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break
    const compression = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const fileNameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const dataStart = offset + 30 + fileNameLength + extraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)

    if (compression === 0) {
      return compressed.toString('utf8')
    }

    if (compression === 8) {
      const { inflateRawSync } = await import('node:zlib')
      return inflateRawSync(compressed).toString('utf8')
    }

    throw new Error(`Unsupported ZIP compression method: ${compression}`)
  }

  throw new Error('Could not extract JSON from USDA foundation archive')
}

export async function downloadAndImportUsdaFoundation(): Promise<UsdaFoundationImportResult> {
  const response = await fetch(USDA_FOUNDATION_JSON_URL, {
    headers: { 'User-Agent': 'MOSS/0.1 (personal nutrition app)' }
  })
  if (!response.ok) {
    throw new Error(`USDA foundation download failed (${response.status})`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const jsonText = await unzipSingleJson(buffer)
  return importUsdaFoundationFromJson(jsonText)
}

/** Background import on profile open — skips when foundation foods are already cached. */
export async function maybeAutoImportUsdaFoundation(): Promise<UsdaFoundationImportResult | null> {
  const state = getUsdaFoundationCatalogState()
  if (state.count > 0) return null
  return downloadAndImportUsdaFoundation()
}
