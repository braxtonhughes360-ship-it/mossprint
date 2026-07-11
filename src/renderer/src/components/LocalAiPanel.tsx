import { useCallback, useEffect, useState } from 'react'
import type {
  LocalAiDownloadState,
  LocalAiPanelState,
  LocalAiSurface
} from '@shared/localai'
import {
  LOCALAI_BUNDLED_MODEL_TAG,
  LOCALAI_SETTING_KEYS,
  LOCALAI_USE_BUILTIN_VALUE,
  LOCALAI_WARM_CALL_BAR_MS,
  formatLocalAiModelLabel
} from '@shared/localai'
import { MossSelect, type MossSelectOption } from './MossSelect'
import { LocalAiConsentCard } from './LocalAiConsentCard'

const SURFACE_ROWS: Array<{
  id: LocalAiSurface
  label: string
  hint: string
}> = [
  {
    id: 'capture',
    label: 'Quick capture routing',
    hint: 'Dashboard bar, menu bar, and the ⌘⇧M capture window.'
  },
  {
    id: 'money',
    label: 'Money describe line',
    hint: 'Smarter parsing when plain English doesn’t match a dollar amount.'
  },
  {
    id: 'nutrition',
    label: 'Nutrition describe line',
    hint: 'Better meal breakdowns when the basic parser misses.'
  },
  {
    id: 'calendar',
    label: 'Calendar quick-add',
    hint: 'Fills in events when date phrases don’t match the built-in parser.'
  }
]

async function writeToggle(key: string, enabled: boolean): Promise<void> {
  await window.moss.db.setSetting(key, enabled ? '1' : '0')
}

/** Settings → Local AI: smart parsing status, the built-in helper, and per-surface toggles. */
export function LocalAiPanel(): React.JSX.Element {
  const [state, setState] = useState<LocalAiPanelState | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      // Drop the probe cache first — "Refresh status" must report what's
      // running RIGHT NOW, not a snapshot from up to a minute ago (the stale
      // "still on qwen3.5" the operator saw after closing Ollama).
      await window.moss.localai.resetProbe()
      const next = await window.moss.localai.getState()
      setState(next)
    } catch {
      setState(null)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live download progress — patch the runtime slice in place, refresh fully when it lands.
  useEffect(() => {
    const unsubscribe = window.moss.localai.onDownloadProgress((raw) => {
      const download = raw as LocalAiDownloadState
      setState((prev) => (prev ? { ...prev, runtime: { ...prev.runtime, download } } : prev))
      if (download.status === 'ready') void refresh()
    })
    return unsubscribe
  }, [refresh])

  async function setMasterEnabled(enabled: boolean): Promise<void> {
    await writeToggle(LOCALAI_SETTING_KEYS.enabled, enabled)
    await window.moss.localai.resetProbe()
    await refresh()
  }

  async function setSurfaceEnabled(surface: LocalAiSurface, enabled: boolean): Promise<void> {
    await writeToggle(LOCALAI_SETTING_KEYS[surface], enabled)
    await window.moss.localai.resetProbe()
    await refresh()
  }

  async function setModel(model: string): Promise<void> {
    // Engine intent is its own key: picking an Ollama model here is the ONLY
    // thing that prefers Ollama over the bundled default; the built-in choice
    // clears both keys and the default policy takes back over.
    const useBuiltIn = model === LOCALAI_USE_BUILTIN_VALUE
    await window.moss.db.setSetting(LOCALAI_SETTING_KEYS.engine, useBuiltIn ? '' : 'ollama')
    await window.moss.db.setSetting(LOCALAI_SETTING_KEYS.model, useBuiltIn ? '' : model)
    await window.moss.localai.resetProbe()
    await refresh()
  }

  async function acceptModel(): Promise<void> {
    await window.moss.localai.setModelConsent('accepted')
    await refresh()
  }

  async function laterModel(): Promise<void> {
    await window.moss.localai.setModelConsent('later')
    await refresh()
  }

  async function retryDownload(): Promise<void> {
    await window.moss.localai.startModelDownload()
    await refresh()
  }

  const runtime = state?.runtime
  const working =
    state?.masterEnabled === true && typeof state.model === 'string' && state.model.length > 0

  // The bundled helper is this install's own runtime; without it we fall back to
  // asking the user to bring their own Ollama (dev builds, or a runtime-less package).
  const hasBundled = runtime?.bundledAvailable === true
  const download = runtime?.download
  const slowMachine =
    working && typeof runtime?.warmCallMs === 'number' && runtime.warmCallMs > LOCALAI_WARM_CALL_BAR_MS
  const usingOwnOllama = working && runtime?.source === 'ollama'
  const usingBuiltIn = working && runtime?.source === 'bundled'
  const builtInReady = hasBundled && download?.status === 'ready'
  const ollamaAlsoRunning = (state?.installedModels.length ?? 0) > 0
  // The user picked their own Ollama, but nothing answered on 11434 — say so
  // instead of leaving them to wonder what's actually running (QA2-04).
  const chosenOllamaGone =
    state?.enginePreference === 'ollama' && !ollamaAlsoRunning && !usingOwnOllama

  const modelOptions: MossSelectOption[] = [
    // The built-in model leads the list whenever it's downloaded — it's the default brain.
    ...(builtInReady
      ? [{ value: LOCALAI_USE_BUILTIN_VALUE, label: 'MOSS built-in (qwen3.5) — recommended' }]
      : []),
    ...(state?.installedModels ?? []).map((name) => ({
      value: name,
      label: name
    }))
  ]

  // Selection mirrors what actually answered the probe — never a stale stored
  // value that the resolution policy isn't honoring.
  const selectedModel =
    state?.model === LOCALAI_BUNDLED_MODEL_TAG && builtInReady
      ? LOCALAI_USE_BUILTIN_VALUE
      : state?.model ?? ''

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Smart parsing</p>
          <h2 className="settings-card-title">Plain English, on your computer</h2>
          {working ? (
            <p className="settings-card-copy" role="status">
              {usingBuiltIn
                ? `Smart parsing is on — MOSS's built-in model (${formatLocalAiModelLabel(state?.model ?? '')}), running on this computer.`
                : usingOwnOllama
                  ? `Smart parsing is on — using your own model (${formatLocalAiModelLabel(state?.model ?? '')}), running on this computer.`
                  : 'Smart parsing is on — runs on this computer.'}
              {usingBuiltIn && chosenOllamaGone
                ? ' Your own Ollama isn’t running right now, so MOSS switched to the built-in model.'
                : ''}
              {usingBuiltIn && ollamaAlsoRunning
                ? ' Your Ollama is running too — pick one of its models below to use it instead.'
                : ''}
              {usingOwnOllama && builtInReady
                ? ' MOSS’s built-in model is installed too — choose it below to switch back.'
                : ''}
            </p>
          ) : state?.masterEnabled === false ? (
            <p className="settings-card-copy" role="status">
              Smart parsing is off. Basic parsing still works everywhere — flip the switch below
              to turn the smarter fallback back on.
            </p>
          ) : state && chosenOllamaGone ? (
            <p className="settings-card-copy" role="status">
              Nothing is answering right now — your own Ollama isn’t running
              {builtInReady
                ? '.'
                : ', and MOSS’s built-in model isn’t downloaded yet. Start Ollama, or download the helper below.'}
            </p>
          ) : (
            <p className="settings-card-copy" role="status">
              MOSS can turn plain English into transactions, meals, and events — all on this
              computer, nothing sent anywhere.
            </p>
          )}
          {slowMachine && (
            <p className="settings-card-copy settings-card-note" role="status">
              This computer runs the helper slowly, so smart parsing may take a few seconds. Basic
              parsing is instant and always available.
            </p>
          )}
        </header>

        {/* Bundled helper: consent + one-time download, no jargon, no terminal. */}
        {!working && hasBundled && (
          <LocalAiConsentCard
            download={download}
            onAccept={() => void acceptModel()}
            onLater={() => void laterModel()}
            onRetry={() => void retryDownload()}
          />
        )}

        {/* No bundled runtime (dev / runtime-less build): the bring-your-own-Ollama path. */}
        {!working && !hasBundled && (
          <>
            <div className="settings-actions">
              <button
                type="button"
                className="btn-secondary"
                aria-expanded={setupOpen}
                onClick={() => setSetupOpen((open) => !open)}
              >
                Get set up
              </button>
            </div>
            {setupOpen && (
              <div className="settings-stack settings-stack-tight mt-4">
                <p className="settings-card-copy">
                  MOSS talks to a small language model running on this computer through Ollama — a
                  free app that keeps everything offline. Install Ollama, download a model, then
                  come back here and tap Refresh.
                </p>
                <ol className="settings-card-copy settings-setup-steps">
                  <li>
                    Download and open{' '}
                    <button
                      type="button"
                      className="settings-inline-link"
                      onClick={() => void window.moss.shell.openExternal('https://ollama.com')}
                    >
                      Ollama
                    </button>{' '}
                    (ollama.com).
                  </li>
                  <li>
                    In Terminal, run{' '}
                    <code className="nutrition-mono">ollama pull qwen3.5</code> (or another small
                    model).
                  </li>
                  <li>Return here and choose your model below.</li>
                </ol>
              </div>
            )}
          </>
        )}

        <div className="settings-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Checking…' : 'Refresh status'}
          </button>
        </div>
      </section>

      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Control</p>
          <h2 className="settings-card-title">Smart parsing</h2>
          <p className="settings-card-copy">
            Turn smart parsing off entirely, or keep it on but skip certain pages. Basic parsing
            still works everywhere — these toggles only control the smarter fallback.
          </p>
        </header>

        <label className="preference-field preference-field-module">
          <span className="preference-field-copy">
            <span className="preference-label">Smart parsing</span>
            <span className="preference-hint">Master switch for all local model calls.</span>
          </span>
          <input
            type="checkbox"
            checked={state?.masterEnabled ?? true}
            disabled={!state}
            onChange={(event) => void setMasterEnabled(event.target.checked)}
          />
        </label>

        <div className="settings-stack settings-stack-tight">
          {SURFACE_ROWS.map((row) => (
            <label
              key={row.id}
              className="preference-field preference-field-module preference-field-nested"
            >
              <span className="preference-field-copy">
                <span className="preference-label">{row.label}</span>
                <span className="preference-hint">{row.hint}</span>
              </span>
              <input
                type="checkbox"
                checked={state?.surfaces[row.id] ?? true}
                disabled={!state || state.masterEnabled === false}
                onChange={(event) => void setSurfaceEnabled(row.id, event.target.checked)}
              />
            </label>
          ))}
        </div>
      </section>

      {(builtInReady || ollamaAlsoRunning) && (
        <section className="settings-card">
          <header className="settings-card-head">
            <p className="settings-kicker">Model</p>
            <h2 className="settings-card-title">Which model to use</h2>
            <p className="settings-card-copy">
              {builtInReady
                ? 'MOSS uses its built-in model unless you pick one of your own Ollama models here. Smaller models are faster; larger ones can be more accurate.'
                : 'Smaller models are faster; larger ones can be more accurate. Only models you’ve installed appear here.'}
            </p>
          </header>

          <label className="settings-field">
            <span className="settings-field-label">Installed model</span>
            <MossSelect
              value={selectedModel}
              options={modelOptions}
              onChange={(value) => void setModel(value)}
              placeholder="Choose a model"
              ariaLabel="Local model"
              disabled={!state?.masterEnabled}
            />
          </label>
          {!ollamaAlsoRunning && (
            <p className="settings-card-copy settings-card-note">
              Ollama isn’t running, so its models aren’t listed — start it and tap Refresh
              status to switch to one of your own models.
            </p>
          )}
        </section>
      )}

      <section className="settings-card settings-card-trust">
        <p className="settings-card-copy settings-trust-line">
          Everything Describe reads and writes stays on this computer.
        </p>
      </section>
    </div>
  )
}
