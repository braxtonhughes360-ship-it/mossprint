/**
 * Describe smart parsing on a LOCAL model via Ollama (free, offline, no account).
 *
 * Architecture (SPEC §3.1 — treat generated output as untrusted):
 * - Ollama is probed at 127.0.0.1:11434 with a short timeout; result cached briefly.
 * - When reachable, the meal text goes to /api/chat with a structured-output JSON
 *   schema (`format`) so the model must return typed items, not prose.
 * - Every field is validated and clamped before it becomes a DescribeDraftItem.
 * - When Ollama is missing, slow, or returns garbage, callers fall back to the
 *   heuristic parser (nutritionDescribeParse/Lexicon) — Describe never hard-fails
 *   because a model isn't installed.
 */
import { randomUUID } from 'node:crypto'
import type { DescribeConfidence, DescribeDraftItem } from '@shared/nutrition'
import { getSetting } from './database'

const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434'
const PROBE_TIMEOUT_MS = 1200
const CHAT_TIMEOUT_MS = 30_000
const PROBE_CACHE_MS = 60_000
const MAX_ITEMS = 12
const MAX_LABEL_LENGTH = 80
const MAX_ITEM_KCAL = 3000

/** Optional override: settings key for a preferred installed model. */
export const DESCRIBE_LLM_MODEL_SETTING = 'nutrition.describe.llm.model'
/** Set to '0' to disable LLM parsing even when Ollama is running. */
export const DESCRIBE_LLM_ENABLED_SETTING = 'nutrition.describe.llm.enabled'

/** Instruction-following general models that do fine on this task, best first. */
const PREFERRED_MODELS = ['llama3.2', 'llama3.1', 'qwen2.5', 'mistral', 'gemma2', 'phi3']

let probeCache: { at: number; model: string | null; error: string | null } | null = null

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

function llmEnabled(): boolean {
  try {
    return getSetting(DESCRIBE_LLM_ENABLED_SETTING)?.value !== '0'
  } catch {
    // No profile DB open (headless callers) — treat as enabled; the probe still gates.
    return true
  }
}

function preferredModel(installed: string[]): string | null {
  if (installed.length === 0) return null
  try {
    const configured = getSetting(DESCRIBE_LLM_MODEL_SETTING)?.value?.trim()
    if (configured && installed.some((name) => name.startsWith(configured))) {
      return installed.find((name) => name.startsWith(configured)) ?? null
    }
  } catch {
    // ignore — fall through to preference order
  }
  for (const preferred of PREFERRED_MODELS) {
    const hit = installed.find((name) => name.startsWith(preferred))
    if (hit) return hit
  }
  return installed[0]
}

/** Reachability + model pick, cached for a minute so typing stays snappy. */
export async function getDescribeLlmState(): Promise<{ model: string | null; error: string | null }> {
  // Headless verify runs must stay deterministic — never route through a model.
  if (process.env.MOSS_HEADLESS_USER_DATA) {
    return { model: null, error: null }
  }
  if (!llmEnabled()) {
    return { model: null, error: null }
  }
  if (probeCache && Date.now() - probeCache.at < PROBE_CACHE_MS) {
    return { model: probeCache.model, error: probeCache.error }
  }

  let model: string | null = null
  let error: string | null = null
  try {
    const response = await fetchWithTimeout(`${OLLAMA_ENDPOINT}/api/tags`, {}, PROBE_TIMEOUT_MS)
    if (response.ok) {
      const parsed = (await response.json()) as { models?: Array<{ name?: string }> }
      const installed = (parsed.models ?? [])
        .map((row) => (typeof row.name === 'string' ? row.name : ''))
        .filter(Boolean)
      model = preferredModel(installed)
      if (!model) error = 'Ollama is running but has no models installed.'
    } else {
      error = `Ollama responded ${response.status}.`
    }
  } catch {
    error = null // not running — normal, not an error state worth surfacing loudly
  }

  probeCache = { at: Date.now(), model, error }
  return { model, error }
}

/** Drop the cached probe (e.g. after the user changes the model setting). */
export function resetDescribeLlmProbe(): void {
  probeCache = null
}

const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: ['string', 'null'] },
          kcal: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['name', 'quantity', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'confidence']
      }
    }
  },
  required: ['items']
} as const

const SYSTEM_PROMPT = [
  'You are a nutrition logging assistant. The user describes a meal in plain English,',
  'possibly with typos, brand names, or restaurant items.',
  'Break the description into individual food items. For each item estimate realistic',
  'US portion nutrition TOTALS for the stated quantity (not per 100g):',
  'kcal, protein_g, carbs_g, fat_g.',
  'Use well-known values for branded/restaurant items (e.g. a Chick-fil-A chicken',
  'sandwich is ~440 kcal; a Chipotle chicken burrito is ~1000 kcal).',
  'quantity is the number of units the user stated (default 1). unit is the portion',
  'word they used (bowl, slice, cup, sandwich...) or null.',
  'confidence: high = well-known exact item, medium = reasonable estimate,',
  'low = you are guessing. Respond ONLY with JSON matching the schema.'
].join(' ')

export interface LlmMealItem {
  name: string
  quantity: number
  unit: string | null
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  confidence: DescribeConfidence
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, value))
}

export function sanitizeItems(raw: unknown): LlmMealItem[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as { items?: unknown }).items
  if (!Array.isArray(list)) return []

  const items: LlmMealItem[] = []
  for (const entry of list.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, MAX_LABEL_LENGTH) : ''
    const kcal = clampNumber(row.kcal, 0, MAX_ITEM_KCAL)
    if (!name || kcal === null || kcal <= 0) continue

    const confidence: DescribeConfidence =
      row.confidence === 'high' || row.confidence === 'low' ? row.confidence : 'medium'

    items.push({
      name,
      quantity: clampNumber(row.quantity, 0.1, 50) ?? 1,
      unit:
        typeof row.unit === 'string' && row.unit.trim()
          ? row.unit.trim().toLowerCase().slice(0, 24)
          : null,
      kcal,
      protein_g: clampNumber(row.protein_g, 0, 500) ?? 0,
      carbs_g: clampNumber(row.carbs_g, 0, 800) ?? 0,
      fat_g: clampNumber(row.fat_g, 0, 400) ?? 0,
      confidence
    })
  }
  return items
}

function toDraftItem(item: LlmMealItem): DescribeDraftItem {
  return {
    id: randomUUID(),
    rawPhrase: item.name,
    quantity: item.quantity,
    unitHint: item.unit,
    label: item.name,
    foodItemId: null,
    servingId: null,
    snapshotKcal: item.kcal,
    snapshotProteinG: item.protein_g,
    snapshotCarbsG: item.carbs_g,
    snapshotFatG: item.fat_g,
    per100gKcal: null,
    per100gProteinG: null,
    per100gCarbsG: null,
    per100gFatG: null,
    unitGramWeight: null,
    source: 'llm',
    confidence: item.confidence
  }
}

/**
 * Parse a meal description with the local model. Returns null when Ollama is
 * unavailable, disabled, times out, or returns nothing usable — callers must
 * fall back to the heuristic pipeline.
 */
export async function describeMealWithLlm(text: string): Promise<{
  items: DescribeDraftItem[]
  model: string
} | null> {
  const trimmed = text.trim()
  if (!trimmed) return null

  const { model } = await getDescribeLlmState()
  if (!model) return null

  try {
    const response = await fetchWithTimeout(
      `${OLLAMA_ENDPOINT}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: MEAL_SCHEMA,
          options: { temperature: 0.1 },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: trimmed.slice(0, 500) }
          ]
        })
      },
      CHAT_TIMEOUT_MS
    )
    if (!response.ok) return null

    const parsed = (await response.json()) as { message?: { content?: string } }
    const content = parsed.message?.content
    if (!content) return null

    const items = sanitizeItems(JSON.parse(content))
    if (items.length === 0) return null

    return { items: items.map(toDraftItem), model }
  } catch {
    return null
  }
}
