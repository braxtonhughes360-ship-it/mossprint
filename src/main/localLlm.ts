/**
 * Shared client for local structured-output chat.
 *
 * LA7: the endpoint is RESOLVED, not fixed — a user's own Ollama at
 * 127.0.0.1:11434 wins (zero duplicate RAM for power users), else the
 * MOSS-managed llama.cpp sidecar on its own loopback port, else none and
 * every surface degrades deterministically.
 *
 * Privacy: both candidates are 127.0.0.1-only — never any other host. User
 * envelope names in prompts stay on-machine; see SECURITY.md.
 */
import type { LocalAiPanelState, LocalAiSurface } from '@shared/localai'
import { LOCALAI_SETTING_KEYS } from '@shared/localai'
import { getAppSettings } from './appSettings'
import { getSetting } from './database'
import {
  BUNDLED_MODEL,
  ensureSidecarRunning,
  getRuntimeStateForPanel,
  isBundledModelReady,
  isBundledRuntimeAvailable,
  noteSidecarUse,
  recordWarmCallMs,
  sidecarBaseUrlForRouting
} from './localRuntime'

/** Localhost-only user-Ollama base URL — do not parameterize to another host. */
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

/** Resolved localhost endpoint for structured calls. */
interface LocalLlmEndpoint {
  baseUrl: string
  kind: 'ollama' | 'llamacpp'
  model: string
}

export const LOCALAI_MODEL_SETTING = LOCALAI_SETTING_KEYS.model
export const LOCALAI_ENABLED_SETTING = LOCALAI_SETTING_KEYS.enabled
export const LOCALAI_CAPTURE_ENABLED_SETTING = LOCALAI_SETTING_KEYS.capture
export const LOCALAI_MONEY_ENABLED_SETTING = LOCALAI_SETTING_KEYS.money
export const LOCALAI_NUTRITION_ENABLED_SETTING = LOCALAI_SETTING_KEYS.nutrition
export const LOCALAI_CALENDAR_ENABLED_SETTING = LOCALAI_SETTING_KEYS.calendar

/** Legacy nutrition-namespaced keys — read as fallback when localai.* is unset. */
export const LEGACY_MODEL_SETTING = 'nutrition.describe.llm.model'
export const LEGACY_ENABLED_SETTING = 'nutrition.describe.llm.enabled'

const SURFACE_SETTING_KEYS: Record<LocalAiSurface, string> = {
  capture: LOCALAI_CAPTURE_ENABLED_SETTING,
  money: LOCALAI_MONEY_ENABLED_SETTING,
  nutrition: LOCALAI_NUTRITION_ENABLED_SETTING,
  calendar: LOCALAI_CALENDAR_ENABLED_SETTING
}

const PROBE_TIMEOUT_MS = 1200
const PROBE_CACHE_MS = 60_000

/** Instruction-following general models that do fine on structured tasks, best first. */
export const PREFERRED_MODELS = [
  'qwen3.5',
  'llama3.2',
  'llama3.1',
  'qwen2.5',
  'gemma3',
  'qwen3',
  'mistral',
  'gemma2',
  'phi3'
] as const

let probeCache: {
  at: number
  ttlMs: number
  model: string | null
  error: string | null
  endpoint: LocalLlmEndpoint | null
} | null = null

/** While a cold sidecar may still be loading, re-probe sooner than the normal minute. */
const PROBE_CACHE_WARMING_MS = 5_000

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

function readSettingWithFallback(primaryKey: string, legacyKey: string): string | undefined {
  const primary = getSetting(primaryKey)?.value
  if (primary !== undefined && primary !== null) return primary
  return getSetting(legacyKey)?.value
}

/** Whether local LLM calls are allowed (localai.* with legacy fallback). */
export function isLocalLlmEnabled(): boolean {
  try {
    const enabled = readSettingWithFallback(LOCALAI_ENABLED_SETTING, LEGACY_ENABLED_SETTING)
    return enabled !== '0'
  } catch {
    // No profile DB open (headless callers) — treat as enabled; the probe still gates.
    return true
  }
}

function readSurfaceToggle(key: string): boolean {
  try {
    const val = getSetting(key)?.value
    if (val !== undefined && val !== null) return val !== '0'
    return true
  } catch {
    return true
  }
}

/**
 * Whether LLM fallback is allowed on a surface (master toggle + per-surface flag).
 * Surfaces stay visible and keep deterministic parsing when this is false.
 */
export function isSurfaceLlmEnabled(surface: LocalAiSurface): boolean {
  if (process.env.MOSS_HEADLESS_USER_DATA) return false
  if (!isLocalLlmEnabled()) return false
  return readSurfaceToggle(SURFACE_SETTING_KEYS[surface])
}

/** Installed Ollama model tags (empty when Ollama is not running). */
export async function listInstalledModels(): Promise<string[]> {
  try {
    const response = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/tags`, {}, PROBE_TIMEOUT_MS)
    if (!response.ok) return []
    const parsed = (await response.json()) as { models?: Array<{ name?: string }> }
    return (parsed.models ?? [])
      .map((row) => (typeof row.name === 'string' ? row.name : ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/** Settings panel snapshot — probe + stored toggles + LA7 runtime state. */
export async function getLocalAiPanelState(): Promise<LocalAiPanelState> {
  const masterEnabled = isLocalLlmEnabled()
  const installedModels = await listInstalledModels()
  const probe = masterEnabled ? await probeOllama() : { model: null, error: null }

  const runtime = getRuntimeStateForPanel()
  if (masterEnabled && probeCache?.endpoint?.kind === 'ollama') {
    runtime.source = 'ollama'
  }

  return {
    model: probe.model,
    error: probe.error,
    installedModels,
    masterEnabled,
    surfaces: {
      capture: readSurfaceToggle(LOCALAI_CAPTURE_ENABLED_SETTING),
      money: readSurfaceToggle(LOCALAI_MONEY_ENABLED_SETTING),
      nutrition: readSurfaceToggle(LOCALAI_NUTRITION_ENABLED_SETTING),
      calendar: readSurfaceToggle(LOCALAI_CALENDAR_ENABLED_SETTING)
    },
    configuredModel: configuredModelPrefix(),
    runtime
  }
}

function configuredModelPrefix(): string | null {
  try {
    const configured = readSettingWithFallback(LOCALAI_MODEL_SETTING, LEGACY_MODEL_SETTING)?.trim()
    return configured || null
  } catch {
    return null
  }
}

/** Pick the best installed model tag from a preference-ordered prefix list. */
export function pickPreferredModel(installed: string[]): string | null {
  if (installed.length === 0) return null
  const configured = configuredModelPrefix()
  if (configured && installed.some((name) => name.startsWith(configured))) {
    return installed.find((name) => name.startsWith(configured)) ?? null
  }
  for (const preferred of PREFERRED_MODELS) {
    const hit = installed.find((name) => name.startsWith(preferred))
    if (hit) return hit
  }
  return installed[0]
}

/**
 * Resolve the active endpoint: user Ollama first, then the bundled sidecar,
 * then none. Cached briefly so repeated calls stay snappy.
 */
async function resolveEndpoint(): Promise<{
  endpoint: LocalLlmEndpoint | null
  error: string | null
}> {
  if (probeCache && Date.now() - probeCache.at < probeCache.ttlMs) {
    return { endpoint: probeCache.endpoint, error: probeCache.error }
  }

  let endpoint: LocalLlmEndpoint | null = null
  let error: string | null = null
  let ttlMs = PROBE_CACHE_MS

  try {
    const response = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/tags`, {}, PROBE_TIMEOUT_MS)
    if (response.ok) {
      const parsed = (await response.json()) as { models?: Array<{ name?: string }> }
      const installed = (parsed.models ?? [])
        .map((row) => (typeof row.name === 'string' ? row.name : ''))
        .filter(Boolean)
      const model = pickPreferredModel(installed)
      if (model) {
        endpoint = { baseUrl: OLLAMA_BASE_URL, kind: 'ollama', model }
      } else {
        error = 'Ollama is running but has no models installed.'
      }
    } else {
      error = `Ollama responded ${response.status}.`
    }
  } catch {
    // not running — normal, fall through to the bundled runtime
  }

  if (!endpoint && isBundledRuntimeAvailable() && isBundledModelReady()) {
    const baseUrl = await sidecarBaseUrlForRouting()
    if (baseUrl) {
      endpoint = { baseUrl, kind: 'llamacpp', model: BUNDLED_MODEL.tag }
      error = null
    } else {
      // The sidecar may still be loading the model — don't pin "none" for a minute.
      ttlMs = PROBE_CACHE_WARMING_MS
    }
  }

  probeCache = { at: Date.now(), ttlMs, model: endpoint?.model ?? null, error, endpoint }
  return { endpoint, error }
}

/** Reachability + model pick — name kept from the Ollama-only era; resolution is LA7's. */
export async function probeOllama(): Promise<{ model: string | null; error: string | null }> {
  if (!isLocalLlmEnabled()) {
    return { model: null, error: null }
  }
  const { endpoint, error } = await resolveEndpoint()
  return { model: endpoint?.model ?? null, error }
}

/** Drop the cached probe (e.g. after the user changes the model setting). */
export function resetLocalLlmProbe(): void {
  probeCache = null
}

const LOAD_TIMEOUT_MS = 30_000

/**
 * Warm the active engine so the first real call is fast. Ollama: load-only
 * /api/chat (empty messages, per API docs). Bundled sidecar: full start-and-wait,
 * then one tiny structured call — which doubles as the LA7 per-machine honesty
 * check the first time it runs. Best-effort and fire-and-forget safe.
 */
export async function loadModel(keepAlive: string | number = '5m'): Promise<void> {
  if (!isLocalLlmEnabled()) return

  const { endpoint } = await resolveEndpoint()

  if (endpoint?.kind === 'ollama') {
    try {
      await fetchWithTimeout(
        `${endpoint.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: endpoint.model, messages: [], keep_alive: keepAlive })
        },
        LOAD_TIMEOUT_MS
      )
    } catch {
      // Cold first call still works, just slower.
    }
    return
  }

  // No user Ollama — warm the bundled sidecar if it's ready to serve. This is
  // the no-budget path: warm-up-on-focus can afford the cold model load.
  if (!isBundledRuntimeAvailable() || !isBundledModelReady()) return
  const baseUrl = await ensureSidecarRunning()
  if (!baseUrl) return
  resetLocalLlmProbe() // the routing probe should see the now-ready sidecar

  if (getAppSettings().localAiWarmCallMs !== null) return
  const startedAt = Date.now()
  const warm = await structuredChat({
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok']
    },
    system: 'Reply with JSON: {"ok":true}',
    user: 'ready?',
    timeoutMs: LOAD_TIMEOUT_MS
  })
  if (warm) {
    recordWarmCallMs(Date.now() - startedAt)
  }
}

export interface StructuredChatParams {
  schema: unknown
  system: string
  user: string
  timeoutMs: number
  keepAlive?: string | number
  /** Defaults to 0.1 for backward compatibility with nutrition describe. */
  temperature?: number
}

/**
 * Structured-output chat against the resolved endpoint. The schema, prompts,
 * and every upstream sanitizer are engine-agnostic — only the wire format
 * differs (Ollama /api/chat `format` vs llama.cpp OpenAI-style json_schema).
 * Returns null when no engine is available, disabled, times out, or returns
 * nothing usable.
 */
export async function structuredChat(
  params: StructuredChatParams
): Promise<{ content: string; model: string } | null> {
  if (!isLocalLlmEnabled()) return null
  const { endpoint } = await resolveEndpoint()
  if (!endpoint) return null

  const messages = [
    { role: 'system', content: params.system },
    { role: 'user', content: params.user }
  ]

  let url: string
  let body: Record<string, unknown>
  if (endpoint.kind === 'ollama') {
    url = `${endpoint.baseUrl}/api/chat`
    body = {
      model: endpoint.model,
      stream: false,
      format: params.schema,
      options: { temperature: params.temperature ?? 0.1 },
      messages
    }
    if (params.keepAlive !== undefined) {
      body.keep_alive = params.keepAlive
    }
  } else {
    url = `${endpoint.baseUrl}/v1/chat/completions`
    body = {
      model: endpoint.model,
      stream: false,
      temperature: params.temperature ?? 0.1,
      max_tokens: 768,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'moss_structured', strict: true, schema: params.schema }
      },
      messages
    }
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      params.timeoutMs
    )
    if (!response.ok) return null

    let content: string | undefined
    if (endpoint.kind === 'ollama') {
      const parsed = (await response.json()) as { message?: { content?: string } }
      content = parsed.message?.content
    } else {
      noteSidecarUse()
      const parsed = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      content = parsed.choices?.[0]?.message?.content
    }
    if (!content) return null

    return { content, model: endpoint.model }
  } catch {
    return null
  }
}
