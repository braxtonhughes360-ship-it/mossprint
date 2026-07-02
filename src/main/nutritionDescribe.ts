import { randomUUID } from 'node:crypto'
import type {
  DescribeAlternate,
  DescribeConfidence,
  DescribeDraftItem,
  DescribeItemSource,
  DescribeMealInput,
  DescribeMealResult,
  MealSlot,
  ResolveDescribeItemInput
} from '@shared/nutrition'
import { DESCRIBE_UNIT_GRAMS, computeDescribeSnapshots } from '@shared/nutrition'
import {
  importFdcFood,
  importOffSearchResult,
  lookupOffBarcode,
  searchLocalFoods,
  searchOffFoods,
  searchUsdaFoods
} from './nutritionLookup'
import { isStrongEstimatePhrase, resolveEstimateAnchor, estimateDisplayLabel } from './nutritionEstimates'
import { getUsdaFoundationCatalogState } from './nutritionUsdaImport'
import { getDb } from './database'
import {
  BRAND_HINTS,
  PACKAGED_FOOD_HINTS,
  isMisleadingOffProduct,
  scoreOffRelevance,
  shouldSkipAmbiguousLookup,
  shouldSkipOffSearch
} from './nutritionDescribeLexicon'
import { parseMealText, type ParsedMealChunk } from './nutritionDescribeParse'
import { describeMealWithLlm } from './nutritionDescribeLlm'

export { parseMealText } from './nutritionDescribeParse'
export type { ParsedMealChunk } from './nutritionDescribeParse'

function buildSearchPhrase(phrase: string): string {
  const fromMatch = phrase.match(/^(.+?)\s+from\s+(.+)$/i)
  if (fromMatch) {
    return `${fromMatch[1].trim()} ${fromMatch[2].trim()}`
  }
  return phrase
}

function isPlausiblePer100g(per100g: { kcal: number; protein: number; carbs: number; fat: number }): boolean {
  if (per100g.kcal <= 0 || per100g.kcal > 900) return false
  if (per100g.protein > 100 || per100g.carbs > 100 || per100g.fat > 100) return false
  return true
}

function hasEstimateAnchor(phrase: string): boolean {
  return resolveEstimateAnchor(phrase) !== null
}

function isCerealPortionChunk(chunk: ParsedMealChunk): boolean {
  const unit = chunk.unitHint?.toLowerCase()
  const portionUnit = unit === 'bowl' || unit === 'cup' || unit === 'serving'
  return /\bcereal\b/i.test(chunk.phrase) && portionUnit
}

const CEREAL_PORTION_MAX_KCAL = 380

function unitsMatchForAnchor(chunkUnit: string, anchorUnit: string): boolean {
  if (chunkUnit === anchorUnit) return true
  const portionUnits = new Set(['bowl', 'cup', 'serving'])
  return portionUnits.has(chunkUnit) && portionUnits.has(anchorUnit)
}

function portionGramWeightOverride(chunk: ParsedMealChunk, foodItemId: string, servingId: string | null): number | undefined {
  if (servingId) {
    const row = getDb()
      .prepare('SELECT gram_weight FROM food_servings WHERE id = ?')
      .get(servingId) as { gram_weight: number } | undefined
    if (row && row.gram_weight > 0 && row.gram_weight <= 200) return row.gram_weight
  }
  const defaultServing = getDb()
    .prepare(
      'SELECT gram_weight FROM food_servings WHERE food_item_id = ? AND is_default = 1 LIMIT 1'
    )
    .get(foodItemId) as { gram_weight: number } | undefined
  if (defaultServing && defaultServing.gram_weight > 0 && defaultServing.gram_weight <= 200) {
    return defaultServing.gram_weight
  }
  if (isCerealPortionChunk(chunk)) {
    const anchor = resolveEstimateAnchor(chunk.phrase)
    return anchor?.gramWeight ?? 39
  }
  return undefined
}

function clampCerealPortionDraft(chunk: ParsedMealChunk, draft: DescribeDraftItem): DescribeDraftItem {
  const cerealLike =
    isCerealPortionChunk(chunk) ||
    (/\bcereal\b/i.test(draft.label) &&
      (chunk.unitHint === 'bowl' || chunk.unitHint === 'cup'))
  if (!cerealLike || draft.snapshotKcal <= CEREAL_PORTION_MAX_KCAL) {
    return draft
  }
  const estimate = resolveEstimateMatch(chunk)
  if (estimate && estimate.snapshotKcal <= CEREAL_PORTION_MAX_KCAL) {
    return { ...estimate, id: draft.id, alternates: draft.alternates }
  }
  return draft
}

function isUndesirableAlternate(label: string, phrase: string): boolean {
  const labelLower = label.toLowerCase()
  const phraseLower = phrase.toLowerCase()
  if (/\braw\b/.test(labelLower) && !/\braw\b/.test(phraseLower)) return true
  if (/\buncooked\b/.test(labelLower)) return true
  if (phraseLower.includes('cereal') && labelLower.includes('peanut butter') && !labelLower.includes('cereal')) {
    return true
  }
  return isMisleadingOffProduct(phrase, label)
}

interface ResolvedFood {
  foodItemId: string
  servingId: string | null
  name: string
  per100g: { kcal: number; protein: number; carbs: number; fat: number }
  source: DescribeItemSource
  confidence: DescribeConfidence
}

function resolveLocalMatch(phrase: string): ResolvedFood | null {
  return resolveLocalMatches(phrase, 1)[0] ?? null
}

function resolveLocalMatches(phrase: string, limit = 3): ResolvedFood[] {
  if (shouldSkipAmbiguousLookup(phrase)) return []

  const matches = searchLocalFoods(phrase, limit + 4)
  if (matches.length === 0) return []

  const ranked = matches
    .map((hit) => ({
      hit,
      score: scoreOffRelevance(phrase, hit.name)
    }))
    .filter(
      (row) =>
        row.score > 0 &&
        !isMisleadingOffProduct(phrase, row.hit.name) &&
        !isUndesirableAlternate(row.hit.name, phrase)
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const results: ResolvedFood[] = []

  for (const { hit } of ranked) {
    const row = getDb()
      .prepare(
        `SELECT id, name, source, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g
         FROM food_items
         WHERE source = ? AND (external_id = ? OR id = ?)
         LIMIT 1`
      )
      .get(hit.source, hit.externalId, hit.externalId) as
      | {
          id: string
          name: string
          source: string
          kcal_per_100g: number
          protein_per_100g: number
          carbs_per_100g: number
          fat_per_100g: number
        }
      | undefined

    if (!row || row.kcal_per_100g <= 0) continue

    const serving = getDb()
      .prepare(`SELECT id FROM food_servings WHERE food_item_id = ? AND is_default = 1 LIMIT 1`)
      .get(row.id) as { id: string } | undefined

    const source: DescribeItemSource =
      row.source === 'manual' ? 'local' : (row.source as DescribeItemSource)

    results.push({
      foodItemId: row.id,
      servingId: serving?.id ?? null,
      name: row.name,
      per100g: {
        kcal: row.kcal_per_100g,
        protein: row.protein_per_100g,
        carbs: row.carbs_per_100g,
        fat: row.fat_per_100g
      },
      source,
      confidence: 'high'
    })
  }

  return results
}

async function resolveOffMatch(phrase: string, maxAttempts = 3): Promise<ResolvedFood | null> {
  if (shouldSkipOffSearch(phrase)) return null
  const searchPhrase = buildSearchPhrase(phrase)
  const hits = await searchOffFoods(searchPhrase, maxAttempts + 2)

  const ranked = hits
    .map((hit) => ({
      hit,
      score: scoreOffRelevance(searchPhrase, hit.name)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxAttempts)

  for (const { hit } of ranked) {
    if (isMisleadingOffProduct(searchPhrase, hit.name)) continue
    if (isUndesirableAlternate(hit.name, phrase)) continue
    const imported = await importOffSearchResult(hit)
    if (!imported || imported.kcalPer100g <= 0) continue
    const per100g = {
      kcal: imported.kcalPer100g,
      protein: imported.proteinPer100g,
      carbs: imported.carbsPer100g,
      fat: imported.fatPer100g
    }
    if (!isPlausiblePer100g(per100g)) continue
    return {
      foodItemId: imported.id,
      servingId: null,
      name: imported.brand ? `${imported.name} (${imported.brand})` : imported.name,
      per100g,
      source: 'off',
      confidence: 'medium'
    }
  }
  return null
}

function resolveEstimateMatch(chunk: ParsedMealChunk): DescribeDraftItem | null {
  const anchor = resolveEstimateAnchor(chunk.phrase)
  if (!anchor) return null

  const unitHint = chunk.unitHint ?? anchor.unitHint
  const normalizedUnit = unitHint?.toLowerCase() ?? ''
  const anchorUnit = anchor.unitHint.toLowerCase()

  // Anchor unitKcal is per label serving (e.g. 1 cup ≈ 39g) — not a 240g generic bowl.
  let factor: number
  let unitGramWeight = anchor.gramWeight
  if (normalizedUnit && unitsMatchForAnchor(normalizedUnit, anchorUnit)) {
    factor = chunk.quantity
  } else if (chunk.unitHint) {
    unitGramWeight = DESCRIBE_UNIT_GRAMS[normalizedUnit] ?? anchor.gramWeight
    factor = (chunk.quantity * unitGramWeight) / anchor.gramWeight
  } else {
    factor = chunk.quantity
  }

  return {
    id: randomUUID(),
    rawPhrase: chunk.phrase,
    quantity: chunk.quantity,
    unitHint,
    label: estimateDisplayLabel(chunk.phrase, anchor),
    foodItemId: null,
    servingId: null,
    snapshotKcal: anchor.unitKcal * factor,
    snapshotProteinG: anchor.proteinG * factor,
    snapshotCarbsG: anchor.carbsG * factor,
    snapshotFatG: anchor.fatG * factor,
    per100gKcal: null,
    per100gProteinG: null,
    per100gCarbsG: null,
    per100gFatG: null,
    unitGramWeight,
    source: 'estimate',
    confidence: 'medium'
  }
}

async function resolveUsdaLive(phrase: string): Promise<ResolvedFood | null> {
  const usdaHits = await searchUsdaFoods(phrase, 1)
  if (usdaHits.length === 0) return null
  try {
    const imported = await importFdcFood(usdaHits[0].externalId)
    if (imported.kcalPer100g <= 0) return null
    return {
      foodItemId: imported.id,
      servingId: null,
      name: imported.name,
      per100g: {
        kcal: imported.kcalPer100g,
        protein: imported.proteinPer100g,
        carbs: imported.carbsPer100g,
        fat: imported.fatPer100g
      },
      source: 'fdc',
      confidence: 'medium'
    }
  } catch {
    return null
  }
}

function draftFromResolved(
  chunk: ParsedMealChunk,
  resolved: ResolvedFood,
  id = randomUUID()
): DescribeDraftItem {
  const gramOverride = portionGramWeightOverride(chunk, resolved.foodItemId, resolved.servingId)
  const snap = computeDescribeSnapshots(
    resolved.per100g,
    chunk.quantity,
    chunk.unitHint,
    gramOverride
  )
  return {
    id,
    rawPhrase: chunk.phrase,
    quantity: chunk.quantity,
    unitHint: chunk.unitHint,
    label: resolved.name,
    foodItemId: resolved.foodItemId,
    servingId: resolved.servingId,
    snapshotKcal: snap.snapshotKcal,
    snapshotProteinG: snap.snapshotProteinG,
    snapshotCarbsG: snap.snapshotCarbsG,
    snapshotFatG: snap.snapshotFatG,
    per100gKcal: resolved.per100g.kcal,
    per100gProteinG: resolved.per100g.protein,
    per100gCarbsG: resolved.per100g.carbs,
    per100gFatG: resolved.per100g.fat,
    unitGramWeight: snap.unitGramWeight,
    source: resolved.source,
    confidence: resolved.confidence
  }
}

function draftToAlternate(draft: DescribeDraftItem): DescribeAlternate {
  return {
    label: draft.label,
    snapshotKcal: draft.snapshotKcal,
    snapshotProteinG: draft.snapshotProteinG,
    snapshotCarbsG: draft.snapshotCarbsG,
    snapshotFatG: draft.snapshotFatG,
    foodItemId: draft.foodItemId,
    servingId: draft.servingId,
    per100gKcal: draft.per100gKcal,
    per100gProteinG: draft.per100gProteinG,
    per100gCarbsG: draft.per100gCarbsG,
    per100gFatG: draft.per100gFatG,
    unitGramWeight: draft.unitGramWeight,
    source: draft.source,
    confidence: draft.confidence
  }
}

async function gatherAlternates(
  chunk: ParsedMealChunk,
  primary: DescribeDraftItem
): Promise<DescribeAlternate[]> {
  const alternates: DescribeAlternate[] = []
  const seen = new Set<string>([primary.label.toLowerCase().trim()])

  const addDraft = (draft: DescribeDraftItem | null): void => {
    if (!draft) return
    const key = draft.label.toLowerCase().trim()
    if (seen.has(key) || draft.snapshotKcal <= 0) return
    if (isUndesirableAlternate(draft.label, chunk.phrase)) return
    seen.add(key)
    alternates.push(draftToAlternate(draft))
  }

  const estimate = resolveEstimateMatch(chunk)
  if (estimate && estimate.label.toLowerCase() !== primary.label.toLowerCase()) {
    addDraft(estimate)
  }

  const searchPhrase = buildSearchPhrase(chunk.phrase)
  for (const local of resolveLocalMatches(searchPhrase, 3)) {
    addDraft(draftFromResolved(chunk, local, randomUUID()))
  }

  if (chunk.preferPackaged && alternates.length < 2 && primary.source !== 'estimate') {
    const off = await resolveOffMatch(chunk.phrase, 2)
    if (off) {
      addDraft(draftFromResolved(chunk, off, randomUUID()))
    }
  }

  return alternates.slice(0, 4)
}

async function finalizeDraft(chunk: ParsedMealChunk, draft: DescribeDraftItem): Promise<DescribeDraftItem> {
  if (draft.source === 'unresolved' || draft.confidence === 'low' || draft.source === 'estimate') {
    const alternates = await gatherAlternates(chunk, draft)
    if (alternates.length > 0) {
      return { ...draft, alternates }
    }
  }
  return draft
}

function unresolvedDraft(chunk: ParsedMealChunk, id = randomUUID()): DescribeDraftItem {
  return {
    id,
    rawPhrase: chunk.phrase,
    quantity: chunk.quantity,
    unitHint: chunk.unitHint,
    label: chunk.phrase,
    foodItemId: null,
    servingId: null,
    snapshotKcal: 0,
    snapshotProteinG: 0,
    snapshotCarbsG: 0,
    snapshotFatG: 0,
    per100gKcal: null,
    per100gProteinG: null,
    per100gCarbsG: null,
    per100gFatG: null,
    unitGramWeight: null,
    source: 'unresolved',
    confidence: 'low'
  }
}

async function resolveChunk(chunk: ParsedMealChunk): Promise<DescribeDraftItem> {
  const id = randomUUID()
  let draft: DescribeDraftItem | null = null

  const barcodeMatch = chunk.phrase.match(/\b(\d{8,14})\b/)
  if (barcodeMatch) {
    const offItem = await lookupOffBarcode(barcodeMatch[1])
    if (offItem && offItem.kcalPer100g > 0) {
      draft = draftFromResolved(
        chunk,
        {
          foodItemId: offItem.id,
          servingId: null,
          name: offItem.name,
          per100g: {
            kcal: offItem.kcalPer100g,
            protein: offItem.proteinPer100g,
            carbs: offItem.carbsPer100g,
            fat: offItem.fatPer100g
          },
          source: 'off',
          confidence: 'high'
        },
        id
      )
    }
  }

  const estimateMatch = resolveEstimateMatch(chunk)
  const strongEstimate = isStrongEstimatePhrase(chunk.phrase)
  const hasAnchor = hasEstimateAnchor(chunk.phrase)
  const preferEstimate =
    strongEstimate || (hasAnchor && !chunk.preferBranded) || (hasAnchor && chunk.preferPackaged)

  if (!draft && estimateMatch && (hasAnchor || chunk.preferBranded || preferEstimate)) {
    draft = { ...estimateMatch, id }
  }

  if (
    draft &&
    estimateMatch &&
    hasAnchor &&
    draft.source === 'off'
  ) {
    draft = { ...estimateMatch, id }
  }

  if (!draft && chunk.preferPackaged && !preferEstimate && !hasAnchor && !estimateMatch) {
    const offPackaged = await resolveOffMatch(chunk.phrase, 5)
    if (offPackaged) {
      draft = draftFromResolved(chunk, { ...offPackaged, confidence: 'medium' }, id)
    }
  }

  if (!draft && !strongEstimate && !preferEstimate) {
    const local = resolveLocalMatch(buildSearchPhrase(chunk.phrase))
    if (local) {
      draft = draftFromResolved(chunk, local, id)
    }
  }

  const foundationCount = getUsdaFoundationCatalogState().count
  if (!draft && foundationCount === 0 && !strongEstimate && !preferEstimate) {
    const usda = await resolveUsdaLive(chunk.phrase)
    if (usda) {
      draft = draftFromResolved(
        chunk,
        { ...usda, confidence: chunk.preferBranded ? 'low' : 'medium' },
        id
      )
    }
  }

  if (!draft && estimateMatch) {
    draft = { ...estimateMatch, id }
  }

  if (!draft && !strongEstimate && !preferEstimate && !estimateMatch) {
    const offFallback = await resolveOffMatch(chunk.phrase, 3)
    if (offFallback) {
      draft = draftFromResolved(chunk, { ...offFallback, confidence: 'medium' }, id)
    }
  }

  if (!draft && foundationCount > 0 && !strongEstimate && !preferEstimate) {
    const usda = await resolveUsdaLive(chunk.phrase)
    if (usda) {
      draft = draftFromResolved(chunk, { ...usda, confidence: 'low' }, id)
    }
  }

  return finalizeDraft(chunk, clampCerealPortionDraft(chunk, draft ?? unresolvedDraft(chunk, id)))
}

export async function resolveDescribeItem(input: ResolveDescribeItemInput): Promise<DescribeDraftItem> {
  // Prefer the local model for re-resolves too — it handles brands/typos the
  // lexicon never will. Single-item phrase, same review-plate confirmation.
  const phrase = input.phrase.trim()
  const quantity = input.quantity ?? 1
  const singleItemText =
    quantity !== 1 || input.unitHint
      ? `${quantity} ${input.unitHint ?? ''} ${phrase}`.replace(/\s+/g, ' ').trim()
      : phrase
  const llm = await describeMealWithLlm(singleItemText)
  if (llm && llm.items.length > 0) {
    const item = { ...llm.items[0], rawPhrase: phrase }
    return finalizeLlmDraft(item)
  }

  const chunk: ParsedMealChunk = {
    quantity,
    unitHint: input.unitHint ?? null,
    phrase,
    preferBranded: BRAND_HINTS.some((hint) => input.phrase.toLowerCase().includes(hint)),
    preferPackaged:
      BRAND_HINTS.some((hint) => input.phrase.toLowerCase().includes(hint)) ||
      PACKAGED_FOOD_HINTS.some((hint) => input.phrase.toLowerCase().includes(hint))
  }
  return resolveChunk(chunk)
}

/** A local hit grounds an LLM item only when it covers most of the label's words. */
function isStrongLocalMatch(label: string, name: string): boolean {
  const score = scoreOffRelevance(label, name)
  if (score <= 0) return false
  const wordLength = label
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .reduce((sum, word) => sum + word.length, 0)
  return wordLength > 0 && score >= wordLength * 0.6
}

/** Ground a model-parsed item in the local catalog and attach alternates (offline, cheap). */
function finalizeLlmDraft(draft: DescribeDraftItem): DescribeDraftItem {
  try {
    const chunk: ParsedMealChunk = {
      quantity: draft.quantity,
      unitHint: draft.unitHint,
      phrase: draft.label,
      preferBranded: false,
      preferPackaged: false
    }
    const locals = resolveLocalMatches(draft.label, 2)

    // Link the top catalog hit when it clearly matches: foodItemId/servingId plus
    // per-100g rates enable serving-aware editing, while the LLM totals stay as
    // the snapshot the user reviews.
    let grounded = draft
    const top = locals[0]
    if (top && isStrongLocalMatch(draft.label, top.name) && isPlausiblePer100g(top.per100g)) {
      grounded = {
        ...draft,
        foodItemId: top.foodItemId,
        servingId: top.servingId,
        per100gKcal: top.per100g.kcal,
        per100gProteinG: top.per100g.protein,
        per100gCarbsG: top.per100g.carbs,
        per100gFatG: top.per100g.fat
      }
    }

    const alternates: DescribeAlternate[] = []
    const seen = new Set<string>([draft.label.toLowerCase().trim()])
    for (const local of locals) {
      const alt = draftFromResolved(chunk, local, randomUUID())
      const key = alt.label.toLowerCase().trim()
      if (seen.has(key) || alt.snapshotKcal <= 0) continue
      seen.add(key)
      alternates.push(draftToAlternate(alt))
    }
    return alternates.length > 0 ? { ...grounded, alternates } : grounded
  } catch {
    return draft
  }
}

/** Barcodes stay on the deterministic OFF path — no reason to involve a model. */
function containsBarcode(text: string): boolean {
  return /\b\d{8,14}\b/.test(text)
}

export async function describeMeal(input: DescribeMealInput): Promise<DescribeMealResult> {
  const parseWarnings: string[] = []

  // Local model first (Ollama, free, offline). It decomposes compound meals,
  // brands, and typos far beyond the lexicon. Heuristics remain the fallback so
  // Describe still works with no model installed.
  if (!containsBarcode(input.text)) {
    const llm = await describeMealWithLlm(input.text)
    if (llm && llm.items.length > 0) {
      const items = llm.items.map((item) => finalizeLlmDraft(item))
      for (const item of items) {
        if (item.confidence === 'low') {
          parseWarnings.push(`Rough estimate for: ${item.label} — confirm on review plate.`)
        }
      }
      return { mealSlot: input.mealSlot as MealSlot, items, parseWarnings }
    }
  }

  const chunks = parseMealText(input.text)

  if (chunks.length === 0) {
    parseWarnings.push('Could not parse any foods from that description.')
    return { mealSlot: input.mealSlot, items: [], parseWarnings }
  }

  const items: DescribeDraftItem[] = []
  for (const chunk of chunks) {
    const item = await resolveChunk(chunk)
    items.push(item)
    if (item.source === 'unresolved') {
      parseWarnings.push(`Could not resolve: ${chunk.phrase} — edit kcal/macros or tap Re-resolve.`)
    }
    if (chunk.preferBranded && item.source === 'fdc') {
      parseWarnings.push(`Used generic USDA match for: ${chunk.phrase}`)
    }
    if (!chunk.preferPackaged && item.source === 'off') {
      parseWarnings.push(`Used packaged product match for: ${chunk.phrase}`)
    }
    if (item.source === 'estimate') {
      parseWarnings.push(`Used portion estimate for: ${chunk.phrase} — confirm on review plate.`)
    }
  }

  return {
    mealSlot: input.mealSlot as MealSlot,
    items,
    parseWarnings
  }
}
