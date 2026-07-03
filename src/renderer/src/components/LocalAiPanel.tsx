import { useCallback, useEffect, useState } from 'react'
import type {
  LocalAiDownloadState,
  LocalAiPanelState,
  LocalAiSurface
} from '@shared/localai'
import {
  LOCALAI_MODEL_DOWNLOAD_GB,
  LOCALAI_SETTING_KEYS,
  LOCALAI_WARM_CALL_BAR_MS,
  formatLocalAiModelLabel
} from '@shared/localai'
import { MossSelect, type MossSelectOption } from './MossSelect'

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

function percent(download: LocalAiDownloadState): number {
  if (download.totalBytes <= 0) return 0
  return Math.min(100, Math.round((download.receivedBytes / download.totalBytes) * 100))
}

/** Settings → Local AI: smart parsing status, the built-in helper, and per-surface toggles. */
export function LocalAiPanel(): React.JSX.Element {
  const [state, setState] = useState<LocalAiPanelState | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
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
    await window.moss.db.setSetting(LOCALAI_SETTING_KEYS.model, model)
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
  const downloading = download?.status === 'downloading' || download?.status === 'verifying'
  const slowMachine =
    working && typeof runtime?.warmCallMs === 'number' && runtime.warmCallMs > LOCALAI_WARM_CALL_BAR_MS
  const usingOwnOllama = working && runtime?.source === 'ollama'

  const modelOptions: MossSelectOption[] = (state?.installedModels ?? []).map((name) => ({
    value: name,
    label: name
  }))

  const selectedModel =
    state?.configuredModel &&
    state.installedModels.some((name) => name.startsWith(state.configuredModel ?? ''))
      ? state.installedModels.find((name) => name.startsWith(state.configuredModel ?? '')) ?? ''
      : state?.model ?? ''

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Smart parsing</p>
          <h2 className="settings-card-title">Plain English, on your computer</h2>
          {working ? (
            <p className="settings-card-copy" role="status">
              Smart parsing is on — runs on this computer.
              {usingOwnOllama ? ' Using the model you already have installed.' : ''}
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
          <div className="settings-stack settings-stack-tight">
            {download?.status === 'error' ? (
              <>
                <p className="settings-card-copy" role="alert">
                  {download.error}
                </p>
                <div className="settings-actions">
                  <button type="button" className="btn-secondary" onClick={() => void retryDownload()}>
                    Try again
                  </button>
                </div>
              </>
            ) : downloading ? (
              <>
                <p className="settings-card-copy" role="status">
                  {download?.status === 'verifying'
                    ? 'Checking the download…'
                    : `Downloading the local AI helper — ${percent(download!)}%`}
                </p>
                <div
                  className="settings-download-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent(download!)}
                >
                  <span
                    className="settings-download-fill"
                    style={{ width: `${percent(download!)}%` }}
                  />
                </div>
                <p className="settings-card-copy settings-card-note">
                  You can keep using MOSS while this finishes. It resumes on its own if the
                  connection drops.
                </p>
              </>
            ) : (
              <>
                <p className="settings-card-copy">
                  MOSS includes a local AI helper (~{LOCALAI_MODEL_DOWNLOAD_GB}GB, one-time download).
                  Everything stays on this computer — no account, no cloud, no setup.
                </p>
                <div className="settings-actions">
                  <button type="button" className="btn-accent" onClick={() => void acceptModel()}>
                    Download the helper
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => void laterModel()}>
                    Later
                  </button>
                </div>
              </>
            )}
          </div>
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

      {modelOptions.length > 0 && (
        <section className="settings-card">
          <header className="settings-card-head">
            <p className="settings-kicker">Model</p>
            <h2 className="settings-card-title">Which model to use</h2>
            <p className="settings-card-copy">
              Smaller models are faster; larger ones can be more accurate. Only models you’ve
              installed appear here.
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
