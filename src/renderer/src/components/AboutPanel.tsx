import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/updates'
import type { MossAppSettings } from '@shared/appSettings'
import { DEFAULT_APP_SETTINGS } from '@shared/appSettings'
import { useUpdateState } from '../hooks/useUpdateState'

/** Settings → About: current version, update status, and a manual check. */
export function AboutPanel(): React.JSX.Element {
  const { update, checkNow, restartAndInstall, openDownloadPage } = useUpdateState()
  const [busy, setBusy] = useState(false)
  const [appSettings, setAppSettings] = useState<MossAppSettings>(DEFAULT_APP_SETTINGS)

  const checking = update?.status === 'checking'

  useEffect(() => {
    void window.moss.shell.getAppSettings().then(setAppSettings).catch(() => undefined)
  }, [])

  const runCheck = async (): Promise<void> => {
    setBusy(true)
    try {
      await checkNow()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">Background</p>
          <h2 className="settings-card-title">Menu bar</h2>
          <p className="settings-card-copy">
            When this is on, closing the MOSS window keeps the app running in your menu bar so
            quick capture stays one click away. When it&apos;s off, closing the window quits MOSS.
          </p>
        </header>

        <label className="preference-field preference-field-module">
          <span className="preference-field-copy">
            <span className="preference-label">Keep MOSS running in the menu bar</span>
            <span className="preference-hint">
              Shows a MOSS icon in the menu bar. Click it for quick capture.
            </span>
          </span>
          <input
            type="checkbox"
            checked={appSettings.keepInMenuBar}
            onChange={(event) => {
              const keepInMenuBar = event.target.checked
              setAppSettings((current) => ({ ...current, keepInMenuBar }))
              void window.moss.shell
                .setAppSettings({ keepInMenuBar })
                .then(setAppSettings)
                .catch(() => undefined)
            }}
          />
        </label>
      </section>

      <section className="settings-card">
        <header className="settings-card-head">
          <p className="settings-kicker">About</p>
        <h2 className="settings-card-title">This copy of MOSS</h2>
        <p className="settings-card-copy">
          New versions come from the MOSS releases page. MOSS looks once a day and never
          restarts on its own.
        </p>
        </header>

        <dl className="memory-grid">
        <div className="memory-cell">
          <dt className="index-label">Version</dt>
          <dd className="mono-data mt-2">{update ? update.currentVersion : '—'}</dd>
        </div>
        <div className="memory-cell">
          <dt className="index-label">Last checked</dt>
          <dd className="mono-data mt-2">
            {update?.lastCheckedAt ? formatTimestamp(update.lastCheckedAt) : 'Not yet'}
          </dd>
        </div>
        </dl>

        {update && (
          <p
          className={[
            'memory-feedback mt-5',
            update.status === 'error' ? 'memory-feedback-error' : 'memory-feedback-ok'
          ].join(' ')}
        >
          {statusCopy(update)}
          </p>
        )}

        <div className="memory-actions mt-5 flex flex-wrap gap-3">
        {update?.status === 'update-available' && (
          <button type="button" className="btn-accent" onClick={() => void openDownloadPage()}>
            Download
          </button>
        )}
        {update?.status === 'ready-to-install' && (
          <button type="button" className="btn-accent" onClick={() => void restartAndInstall()}>
            Restart to update
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void runCheck()}
          disabled={busy || checking}
        >
          {busy || checking ? 'Checking…' : 'Check now'}
        </button>
        </div>
      </section>
    </div>
  )
}

function statusCopy(update: UpdateState): string {
  switch (update.status) {
    case 'checking':
      return 'Checking for a new version…'
    case 'up-to-date':
      return "You're on the latest version."
    case 'update-available':
      return `MOSS ${update.latestVersion} is out.`
    case 'downloading':
      return `Getting MOSS ${update.latestVersion} in the background — keep working.`
    case 'ready-to-install':
      return `MOSS ${update.latestVersion} is ready. Restart whenever suits you.`
    case 'error':
      return update.message ?? "Couldn't check for updates. MOSS will try again later."
    default:
      return 'No check yet this session.'
  }
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}
