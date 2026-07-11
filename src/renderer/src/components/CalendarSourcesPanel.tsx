import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CalendarGoogleStatus, CalendarSourceRecord } from '@shared/calendar'
import { usePreferences } from '../context/PreferencesProvider'
import { CalendarClassSchedulePanel } from './CalendarClassSchedulePanel'

/** Calendar import + sync — Settings chamber (not the planning view). */
export function CalendarSourcesPanel(): React.JSX.Element {
  const { preferences, setPreferences } = usePreferences()
  const academicsEnabled = preferences.modules.calendar.academicsEnabled
  const [sources, setSources] = useState<CalendarSourceRecord[]>([])
  const [googleStatus, setGoogleStatus] = useState<CalendarGoogleStatus | null>(null)
  const [googleIcsUrl, setGoogleIcsUrl] = useState('')
  const [url, setUrl] = useState('')
  const [urlLabel, setUrlLabel] = useState('')
  const [caldavUrl, setCaldavUrl] = useState('')
  const [caldavLabel, setCaldavLabel] = useState('')
  const [caldavUser, setCaldavUser] = useState('')
  const [caldavPass, setCaldavPass] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showAdminSetup, setShowAdminSetup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [bridgeReady, setBridgeReady] = useState(Boolean(window.moss?.calendar))

  const load = useCallback(async () => {
    if (!window.moss?.calendar) {
      setBridgeReady(false)
      setError('Calendar bridge unavailable — use the MOSS desktop app (npm run dev), not a bare browser tab.')
      return
    }

    setBridgeReady(true)
    try {
      const [nextSources, nextGoogleStatus] = await Promise.all([
        window.moss.calendar.listSources(),
        window.moss.calendar.getGoogleStatus()
      ])
      setSources(nextSources)
      setGoogleStatus(nextGoogleStatus)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar sources')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 5000)
    return () => window.clearTimeout(timer)
  }, [flash])

  async function run(task: () => Promise<void>, successMessage?: string): Promise<void> {
    if (!window.moss?.calendar) return
    setBusy(true)
    setError(null)
    try {
      await task()
      await load()
      if (successMessage) setFlash(successMessage)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const googleConnected = googleStatus?.connected ?? false
  const googleConfigured = googleStatus?.configured ?? false
  const googleSource = googleStatus?.source
  const googleWriteCapable = googleStatus?.writeCapable ?? false
  const googlePendingPush = googleStatus?.pendingPushCount ?? 0

  return (
    <section className="settings-card">
      <header className="settings-card-head">
        <p className="settings-kicker">Calendar</p>
        <h2 className="settings-card-title">Connected sources</h2>
        <p className="settings-card-copy">
          Sync Google or school calendars. Events are stored on this computer — nothing is
          shared anywhere.
        </p>
      </header>

      {!bridgeReady && (
        <p className="settings-inline-error">
          Restart MOSS after updates if this persists. Calendar requires the Electron shell.
        </p>
      )}

      {error && <p className="settings-inline-error">{error}</p>}
      {flash && <p className="settings-inline-flash">{flash}</p>}

      <div className="settings-stack">
        <div className="settings-subsection calendar-google-panel">
          <p className="settings-subsection-label nutrition-mono">Google Calendar — easiest</p>
          <p className="preference-hint">
            No Google Cloud account needed. In Google Calendar → Settings → your calendar →{' '}
            <strong>Integrate calendar</strong> → copy <strong>Secret address in iCal format</strong>,
            paste below.
          </p>
          <form
            className="calendar-settings-form"
            onSubmit={(event) => {
              event.preventDefault()
              const trimmed = googleIcsUrl.trim()
              if (!trimmed) return
              void run(async () => {
                const result = await window.moss.calendar.importIcsUrl(trimmed, 'Google Calendar')
                setFlash(`Imported ${result.imported} · updated ${result.updated}`)
              }).then(() => setGoogleIcsUrl(''))
            }}
          >
            <input
              type="url"
              className="preference-input"
              placeholder="https://calendar.google.com/calendar/ical/…"
              value={googleIcsUrl}
              onChange={(event) => setGoogleIcsUrl(event.target.value)}
              disabled={busy || !bridgeReady}
            />
            <button
              type="submit"
              className="calendar-settings-button calendar-settings-button--primary"
              disabled={busy || !bridgeReady || !googleIcsUrl.trim()}
            >
              Connect Google via link
            </button>
          </form>
        </div>

        <div className="settings-subsection calendar-google-panel">
          <p className="settings-subsection-label nutrition-mono">Google Calendar — sign in</p>

          {googleConnected && googleSource ? (
            <div className="calendar-google-connected">
              <p className="calendar-google-status-line">
                <span className="calendar-google-status-badge">Connected</span>
                {googleSource.label}
              </p>
              <p className="preference-hint">
                {googleSource.stale
                  ? 'Last sync failed — tap Sync now.'
                  : googleSource.lastSyncAt
                    ? `Last synced ${new Date(googleSource.lastSyncAt).toLocaleString()}`
                    : 'Ready to sync'}
              </p>
              {!googleWriteCapable && (
                <p className="preference-hint">
                  Events you add in MOSS stay on this computer until you reconnect —{' '}
                  <button
                    type="button"
                    className="settings-inline-link"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await window.moss.calendar.connectGoogle()
                      }, 'Reconnected — MOSS can now add events to Google')
                    }
                  >
                    Allow MOSS to add events to Google — Reconnect
                  </button>
                </p>
              )}
              {googleWriteCapable && googlePendingPush > 0 && (
                <p className="preference-hint">
                  {googlePendingPush} MOSS {googlePendingPush === 1 ? 'event' : 'events'} waiting
                  to reach Google — Sync now retries.
                </p>
              )}
              <div className="calendar-settings-actions">
                <button
                  type="button"
                  className="calendar-settings-button calendar-settings-button--primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await window.moss.calendar.syncSource(googleSource.id)
                      const pushedNote = result.pushed ? ` · ${result.pushed} sent to Google` : ''
                      const pushErrorNote = result.pushErrors
                        ? ` · ${result.pushErrors} failed to send (will retry)`
                        : ''
                      setFlash(
                        `Synced · ${result.imported} new · ${result.updated} updated${pushedNote}${pushErrorNote}`
                      )
                    })
                  }
                >
                  Sync now
                </button>
                <button
                  type="button"
                  className="calendar-settings-button calendar-settings-button--ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await window.moss.calendar.disconnectGoogle(googleSource.id)
                    }, 'Google Calendar disconnected')
                  }
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : googleConfigured ? (
            <div className="calendar-google-connect-flow">
              <p className="preference-hint">
                Opens your default browser (Safari or Chrome). Sign in, approve 2‑Step on your phone,
                then return to MOSS when you see &ldquo;Connected.&rdquo;
              </p>
              <button
                type="button"
                className="calendar-settings-button calendar-settings-button--primary calendar-settings-button--wide"
                disabled={busy || !bridgeReady}
                onClick={() =>
                  void run(async () => {
                    const result = await window.moss.calendar.connectGoogle()
                    setFlash(
                      `Connected · imported ${result.imported} events · updated ${result.updated}`
                    )
                  })
                }
              >
                Sign in with Google
              </button>
            </div>
          ) : (
            <div className="calendar-google-connect-flow">
              <p className="preference-hint">
                Google asks every copy of an app like MOSS to bring its own free key — MOSS has no
                company server that could hold one for you. It&apos;s a <strong>one-time</strong>{' '}
                ~10-minute setup; after that, everyone on this computer just clicks Sign in with
                Google.
              </p>
              <button
                type="button"
                className="calendar-settings-button"
                disabled={busy || !bridgeReady}
                onClick={() => setShowAdminSetup((open) => !open)}
              >
                {showAdminSetup ? 'Hide admin setup' : 'Admin: one-time Google setup'}
              </button>
              {showAdminSetup && (
                <>
                  <details className="calendar-google-admin-details">
                    <summary className="preference-hint moss-selectable">Setup steps</summary>
                    <ol className="calendar-google-admin-list preference-hint">
                      <li>Enable Google Calendar API in Google Cloud (free project)</li>
                      <li>Create OAuth client → Desktop app</li>
                      <li>
                        Redirect URI: loopback on your Mac (Desktop client — no manual URI needed)
                      </li>
                      <li>
                        Save JSON as <span className="nutrition-mono">config/google-oauth.json</span>{' '}
                        or paste below / use <span className="nutrition-mono">.env</span>
                      </li>
                    </ol>
                  </details>
                  <button
                    type="button"
                    className="calendar-settings-button calendar-settings-button--ghost"
                    onClick={() =>
                      void window.moss?.shell?.openExternal(
                        'https://console.cloud.google.com/apis/credentials'
                      )
                    }
                  >
                    Open Google Cloud Console ↗
                  </button>
                  <form
                    className="calendar-settings-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (!clientId.trim() || !clientSecret.trim()) return
                      void run(async () => {
                        await window.moss.calendar.setGoogleOAuth(clientId.trim(), clientSecret.trim())
                      }, 'Saved — now use Sign in with Google').then(() => {
                        setClientId('')
                        setClientSecret('')
                      })
                    }}
                  >
                    <input
                      type="text"
                      className="preference-input"
                      placeholder="Client ID"
                      value={clientId}
                      onChange={(event) => setClientId(event.target.value)}
                      disabled={busy}
                      required
                    />
                    <input
                      type="password"
                      className="preference-input"
                      placeholder="Client secret"
                      value={clientSecret}
                      onChange={(event) => setClientSecret(event.target.value)}
                      disabled={busy}
                      required
                    />
                    <button type="submit" className="calendar-settings-button" disabled={busy}>
                      Save credentials
                    </button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>

        <div className="settings-subsection calendar-academics-toggle">
          <label className="calendar-academics-toggle-row">
            <input
              type="checkbox"
              checked={academicsEnabled}
              onChange={(event) =>
                setPreferences({
                  modules: {
                    calendar: { ...preferences.modules.calendar, academicsEnabled: event.target.checked }
                  }
                })
              }
            />
            <span>
              <span className="settings-subsection-label nutrition-mono">I&apos;m a student</span>
              <span className="preference-hint">
                Turn on school &amp; classes — a recurring class schedule builder, plus class, exam,
                and assignment markers in your calendar and on the dashboard. Off by default.
              </span>
            </span>
          </label>
        </div>

        {academicsEnabled && (
          <CalendarClassSchedulePanel
            busy={busy}
            bridgeReady={bridgeReady}
            onFlash={setFlash}
            onError={setError}
            onCreated={load}
          />
        )}

        <div className="settings-subsection">
          <p className="settings-subsection-label nutrition-mono">Other ICS feeds</p>
          <div className="calendar-settings-actions">
            <button
              type="button"
              className="calendar-settings-button"
              disabled={busy || !bridgeReady}
              onClick={() =>
                void run(async () => {
                  const result = await window.moss.calendar.importIcsFile()
                  if (result.canceled) return
                  setFlash(
                    `Imported ${result.imported ?? 0} · updated ${result.updated ?? 0} from ${result.label ?? 'ICS'}`
                  )
                })
              }
            >
              Import .ics file
            </button>
          </div>
          <form
            className="calendar-settings-form"
            onSubmit={(event) => {
              event.preventDefault()
              const trimmed = url.trim()
              if (!trimmed) return
              void run(async () => {
                const result = await window.moss.calendar.importIcsUrl(trimmed, urlLabel.trim() || undefined)
                setFlash(`Imported ${result.imported} · updated ${result.updated} from ${result.label}`)
              }).then(() => {
                setUrl('')
                setUrlLabel('')
              })
            }}
          >
            <input
              type="url"
              className="preference-input"
              placeholder="https://…/calendar.ics"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={busy || !bridgeReady}
            />
            <input
              type="text"
              className="preference-input"
              placeholder="Label (optional)"
              value={urlLabel}
              onChange={(event) => setUrlLabel(event.target.value)}
              disabled={busy || !bridgeReady}
            />
            <button
              type="submit"
              className="calendar-settings-button"
              disabled={busy || !bridgeReady || !url.trim()}
            >
              Subscribe URL
            </button>
          </form>
        </div>

        <div className="settings-subsection">
          <p className="settings-subsection-label nutrition-mono">CalDAV subscribe (iCloud / school)</p>
          <p className="preference-hint">
            Read-only. Paste a CalDAV or webcal address. Add a username and app-specific password if
            the calendar is private (stored encrypted on this device).
          </p>
          <form
            className="calendar-settings-form"
            onSubmit={(event) => {
              event.preventDefault()
              const trimmed = caldavUrl.trim()
              if (!trimmed) return
              void run(async () => {
                const result = await window.moss.calendar.subscribeCaldav({
                  url: trimmed,
                  label: caldavLabel.trim() || undefined,
                  username: caldavUser.trim() || undefined,
                  password: caldavPass || undefined
                })
                setFlash(`Subscribed · ${result.imported} new · ${result.updated} updated from ${result.label}`)
              }).then(() => {
                setCaldavUrl('')
                setCaldavLabel('')
                setCaldavUser('')
                setCaldavPass('')
              })
            }}
          >
            <input
              type="url"
              className="preference-input"
              placeholder="https://caldav.icloud.com/…  or  webcal://…"
              value={caldavUrl}
              onChange={(event) => setCaldavUrl(event.target.value)}
              disabled={busy || !bridgeReady}
            />
            <input
              type="text"
              className="preference-input"
              placeholder="Label (optional)"
              value={caldavLabel}
              onChange={(event) => setCaldavLabel(event.target.value)}
              disabled={busy || !bridgeReady}
            />
            <input
              type="text"
              className="preference-input"
              placeholder="Username (optional)"
              value={caldavUser}
              onChange={(event) => setCaldavUser(event.target.value)}
              autoComplete="off"
              disabled={busy || !bridgeReady}
            />
            <input
              type="password"
              className="preference-input"
              placeholder="Password (optional)"
              value={caldavPass}
              onChange={(event) => setCaldavPass(event.target.value)}
              autoComplete="off"
              disabled={busy || !bridgeReady}
            />
            <button
              type="submit"
              className="calendar-settings-button"
              disabled={busy || !bridgeReady || !caldavUrl.trim()}
            >
              Subscribe CalDAV
            </button>
          </form>
        </div>

        {sources.length > 0 && (
          <ul className="calendar-settings-source-list">
            {sources.map((source) => (
              <li
                key={source.id}
                className={[
                  'calendar-settings-source-row nutrition-mono',
                  source.enabled ? '' : 'calendar-settings-source-row--off'
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span>
                  {source.label}
                  <span className="calendar-source-kind"> · {source.kind}</span>
                </span>
                <span className="calendar-settings-source-meta">
                  {!source.enabled
                    ? 'Hidden'
                    : source.stale
                      ? 'Stale'
                      : source.lastSyncAt
                        ? `Synced ${new Date(source.lastSyncAt).toLocaleString()}`
                        : 'Not synced'}
                </span>
                <button
                  type="button"
                  className="calendar-settings-button calendar-settings-button--ghost calendar-settings-button--compact"
                  disabled={busy || !bridgeReady}
                  aria-pressed={!source.enabled}
                  onClick={() =>
                    void run(
                      async () => {
                        await window.moss.calendar.setSourceEnabled(source.id, !source.enabled)
                      },
                      source.enabled ? `${source.label} hidden` : `${source.label} shown`
                    )
                  }
                >
                  {source.enabled ? 'Hide' : 'Show'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="preference-hint">
        <Link to="/calendar" className="calendar-settings-planning-link">Open Calendar</Link> for the
        week view.
      </p>
    </section>
  )
}
