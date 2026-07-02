import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  MailAccountRecord,
  MailConnectImapInput,
  MailStatus,
  MailTlsMode
} from '@shared/mail'
import {
  MAIL_IMAP_PRESETS,
  flagsToTlsMode,
  getImapPreset,
  presetImapSecurity,
  presetSmtpSecurity
} from '@shared/mail'
import { MossSelect } from './MossSelect'

const TLS_OPTIONS: Array<{ value: MailTlsMode; label: string }> = [
  { value: 'ssl', label: 'SSL/TLS' },
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'none', label: 'None (local only)' }
]

/** Inbox account connect + status — Settings chamber. OAuth (Gmail) + IMAP/SMTP presets. */
export function MailAccountsPanel(): React.JSX.Element {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showAdminSetup, setShowAdminSetup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [bridgeReady, setBridgeReady] = useState(Boolean(window.moss?.mail))

  const [presetId, setPresetId] = useState(MAIL_IMAP_PRESETS[0]!.id)
  const [imapEmail, setImapEmail] = useState('')
  const [imapPassword, setImapPassword] = useState('')
  const [showServerSettings, setShowServerSettings] = useState(false)
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('')
  const [imapSecurity, setImapSecurity] = useState<MailTlsMode>('ssl')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('')
  const [smtpSecurity, setSmtpSecurity] = useState<MailTlsMode>('starttls')
  const [allowSelfSigned, setAllowSelfSigned] = useState(false)
  const [imapConnecting, setImapConnecting] = useState(false)

  const preset = useMemo(() => getImapPreset(presetId), [presetId])

  useEffect(() => {
    if (!preset) return
    setImapHost(preset.imapHost)
    setImapPort(String(preset.imapPort))
    setSmtpHost(preset.smtpHost)
    setSmtpPort(String(preset.smtpPort))
    setImapSecurity(presetImapSecurity(preset))
    setSmtpSecurity(presetSmtpSecurity(preset))
    setAllowSelfSigned(Boolean(preset.allowSelfSigned))
    setShowServerSettings(Boolean(preset.custom))
  }, [preset])

  const load = useCallback(async () => {
    if (!window.moss?.mail) {
      setBridgeReady(false)
      setError('Inbox bridge unavailable — use the MOSS desktop app, not a bare browser tab.')
      return
    }
    setBridgeReady(true)
    try {
      const next = await window.moss.mail.getStatus()
      setStatus(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mail accounts')
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
    if (!window.moss?.mail) return
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

  async function connectGmail(): Promise<void> {
    if (!window.moss?.mail?.connectGmail) return
    setConnecting(true)
    setError(null)
    try {
      const result = await window.moss.mail.connectGmail()
      await load()
      setFlash(`Connected ${result.email} · imported ${result.imported} messages`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not connect Gmail'
      if (!/cancel/i.test(message)) setError(message)
    } finally {
      setConnecting(false)
    }
  }

  function cancelGmailConnect(): void {
    void window.moss?.mail?.cancelConnectGmail?.()
  }

  async function connectImap(): Promise<void> {
    if (!window.moss?.mail?.connectImap) return
    setImapConnecting(true)
    setError(null)
    try {
      const input: MailConnectImapInput = {
        presetId,
        email: imapEmail.trim(),
        password: imapPassword,
        imapHost: imapHost.trim(),
        smtpHost: smtpHost.trim(),
        imapPort: Number(imapPort) || undefined,
        smtpPort: Number(smtpPort) || undefined,
        imapSecurity,
        smtpSecurity,
        allowSelfSigned
      }
      const result = await window.moss.mail.connectImap(input)
      await load()
      setImapEmail('')
      setImapPassword('')
      setFlash(`Connected ${result.email} · imported ${result.imported} messages`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect this account')
    } finally {
      setImapConnecting(false)
    }
  }

  const configured = status?.configured ?? false
  const accounts = status?.accounts ?? []
  const imapDisabled =
    imapConnecting ||
    busy ||
    !bridgeReady ||
    !imapEmail.trim() ||
    !imapPassword ||
    !imapHost.trim() ||
    !smtpHost.trim()

  return (
    <section className="settings-card">
      <header className="settings-card-head">
        <p className="settings-kicker">Inbox</p>
        <h2 className="settings-card-title">Mail accounts</h2>
        <p className="settings-card-copy">
          Connect Gmail (OAuth) or any IMAP provider to read, reply, and send inside MOSS.
          Credentials are stored in your OS keychain — never in the local database.
        </p>
      </header>

      {!bridgeReady && (
        <p className="settings-inline-error">
          Restart MOSS after updates if this persists — Inbox requires the Electron shell.
        </p>
      )}
      {error && <p className="settings-inline-error">{error}</p>}
      {flash && <p className="settings-inline-flash">{flash}</p>}

      <div className="settings-stack">
        {accounts.length > 0 && (
          <div className="settings-subsection">
            <p className="settings-subsection-label nutrition-mono">Connected</p>
            <ul className="mail-account-list">
              {accounts.map((account) => (
                <MailAccountRow
                  key={account.id}
                  account={account}
                  busy={busy}
                  onSync={() =>
                    void run(async () => {
                      const result = await window.moss.mail.syncAccount(account.id)
                      setFlash(
                        result.error
                          ? 'Sync issue — showing the last good copy'
                          : `Synced · ${result.imported} new`
                      )
                    })
                  }
                  onDisconnect={() =>
                    void run(async () => {
                      await window.moss.mail.disconnectAccount(account.id)
                    }, 'Account disconnected')
                  }
                />
              ))}
            </ul>
          </div>
        )}

        <div className="settings-subsection calendar-google-panel">
          <p className="settings-subsection-label nutrition-mono">Gmail — sign in</p>
          {configured ? (
            <div className="calendar-google-connect-flow">
              <p className="preference-hint">
                Opens your default browser. Sign in, approve access (and 2-Step on your phone if
                prompted), then return to MOSS.
              </p>
              <button
                type="button"
                className="calendar-settings-button calendar-settings-button--primary calendar-settings-button--wide"
                disabled={connecting || busy || !bridgeReady}
                onClick={() => void connectGmail()}
              >
                {connecting
                  ? 'Opening Google…'
                  : accounts.some((a) => a.authType === 'oauth')
                    ? 'Add another Gmail'
                    : 'Connect Gmail'}
              </button>
              {connecting && (
                <button
                  type="button"
                  className="calendar-settings-button calendar-settings-button--ghost"
                  onClick={cancelGmailConnect}
                >
                  Cancel sign-in
                </button>
              )}
            </div>
          ) : (
            <div className="calendar-google-connect-flow">
              <p className="preference-hint">
                Google asks every copy of an app like MOSS to bring its own free key — MOSS has no
                company server that could hold one for you. One person does this <strong>once</strong>{' '}
                (~10 minutes); the same key then powers Gmail and Google Calendar for everyone on
                this computer.
              </p>
              <button
                type="button"
                className="calendar-settings-button"
                disabled={busy || !bridgeReady}
                onClick={() => setShowAdminSetup((open) => !open)}
              >
                {showAdminSetup ? 'Hide setup' : 'One-time Google setup'}
              </button>
              {showAdminSetup && (
                <>
                  <details className="calendar-google-admin-details">
                    <summary className="preference-hint moss-selectable">Setup steps</summary>
                    <ol className="calendar-google-admin-list preference-hint">
                      <li>In Google Cloud, enable the Gmail API (free project)</li>
                      <li>Create an OAuth client → Desktop app</li>
                      <li>
                        Add scopes on the consent screen:{' '}
                        <span className="nutrition-mono moss-selectable">gmail.modify</span> and{' '}
                        <span className="nutrition-mono moss-selectable">gmail.send</span>
                      </li>
                      <li>
                        Redirect URI:{' '}
                        <span className="nutrition-mono moss-selectable">
                          http://127.0.0.1:42813/oauth2callback
                        </span>
                      </li>
                      <li>
                        Save JSON as <span className="nutrition-mono">config/google-oauth.json</span>,
                        use <span className="nutrition-mono">.env</span>, or paste below
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
                        await window.moss.mail.setGoogleOAuth(clientId.trim(), clientSecret.trim())
                      }, 'Saved — now use Connect Gmail').then(() => {
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

        <div className="settings-subsection">
          <p className="settings-subsection-label nutrition-mono">Other providers — IMAP</p>
          <p className="preference-hint">
            Gmail/Workspace (app password), iCloud, Fastmail, Yahoo, AOL, Zoho, Proton (Bridge), or
            any custom server. Use an app-specific password — never your main account password.
          </p>
          <form
            className="mail-imap-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!imapDisabled) void connectImap()
            }}
          >
            <MossSelect
              className="moss-select--block"
              value={presetId}
              options={MAIL_IMAP_PRESETS.map((option) => ({ value: option.id, label: option.label }))}
              onChange={setPresetId}
              disabled={imapConnecting || busy}
              ariaLabel="Mail provider"
            />

            {preset?.note && (
              <p className="mail-preset-note preference-hint">
                {preset.note}
                {preset.appPasswordUrl && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="mail-preset-link"
                      onClick={() => void window.moss?.shell?.openExternal(preset.appPasswordUrl!)}
                    >
                      Open app-password page
                    </button>
                  </>
                )}
              </p>
            )}

            <input
              type="email"
              className="preference-input"
              placeholder="you@example.com"
              value={imapEmail}
              onChange={(event) => setImapEmail(event.target.value)}
              disabled={imapConnecting || busy}
              autoComplete="off"
            />
            <input
              type="password"
              className="preference-input"
              placeholder="App password"
              value={imapPassword}
              onChange={(event) => setImapPassword(event.target.value)}
              disabled={imapConnecting || busy}
              autoComplete="off"
            />

            <button
              type="button"
              className="calendar-settings-button"
              disabled={imapConnecting || busy}
              onClick={() => setShowServerSettings((open) => !open)}
            >
              {showServerSettings ? 'Hide server settings' : 'Server settings (host, port, TLS)'}
            </button>

            {showServerSettings && (
              <div className="mail-imap-custom-grid mail-imap-server-panel">
                <p className="mail-imap-server-label nutrition-mono">Incoming (IMAP)</p>
                <input
                  type="text"
                  className="preference-input"
                  placeholder="IMAP host"
                  value={imapHost}
                  onChange={(event) => setImapHost(event.target.value)}
                  disabled={imapConnecting || busy}
                />
                <input
                  type="number"
                  className="preference-input mail-imap-port"
                  placeholder="Port"
                  value={imapPort}
                  onChange={(event) => setImapPort(event.target.value)}
                  disabled={imapConnecting || busy}
                />
                <MossSelect
                  className="moss-select--block"
                  value={imapSecurity}
                  options={TLS_OPTIONS}
                  onChange={(next) => setImapSecurity(next as MailTlsMode)}
                  disabled={imapConnecting || busy}
                  ariaLabel="IMAP security"
                />

                <p className="mail-imap-server-label nutrition-mono">Outgoing (SMTP)</p>
                <input
                  type="text"
                  className="preference-input"
                  placeholder="SMTP host"
                  value={smtpHost}
                  onChange={(event) => setSmtpHost(event.target.value)}
                  disabled={imapConnecting || busy}
                />
                <input
                  type="number"
                  className="preference-input mail-imap-port"
                  placeholder="Port"
                  value={smtpPort}
                  onChange={(event) => setSmtpPort(event.target.value)}
                  disabled={imapConnecting || busy}
                />
                <MossSelect
                  className="moss-select--block"
                  value={smtpSecurity}
                  options={TLS_OPTIONS}
                  onChange={(next) => setSmtpSecurity(next as MailTlsMode)}
                  disabled={imapConnecting || busy}
                  ariaLabel="SMTP security"
                />

                <label className="mail-imap-self-signed">
                  <input
                    type="checkbox"
                    checked={allowSelfSigned}
                    onChange={(event) => setAllowSelfSigned(event.target.checked)}
                    disabled={imapConnecting || busy}
                  />
                  <span className="preference-hint">
                    Allow self-signed certificate (Proton Bridge / localhost)
                  </span>
                </label>
                <p className="preference-hint mail-imap-server-hint">
                  Preset defaults: IMAP {flagsToTlsMode(preset?.imapSecure ?? true, Number(imapPort) || 993)}{' '}
                  · SMTP {flagsToTlsMode(preset?.smtpSecure ?? false, Number(smtpPort) || 587)}
                </p>
              </div>
            )}

            <button
              type="submit"
              className="calendar-settings-button calendar-settings-button--primary calendar-settings-button--wide"
              disabled={imapDisabled}
            >
              {imapConnecting ? 'Connecting…' : 'Connect account'}
            </button>
          </form>
        </div>
      </div>

      <p className="preference-hint">
        <Link to="/inbox" className="calendar-settings-planning-link">
          Open Inbox
        </Link>{' '}
        to read and triage. Sync pulls the last 90 days (up to 1,500 messages per account).
      </p>
    </section>
  )
}

function MailAccountRow({
  account,
  busy,
  onSync,
  onDisconnect
}: {
  account: MailAccountRecord
  busy: boolean
  onSync: () => void
  onDisconnect: () => void
}): React.JSX.Element {
  const kind = account.authType === 'oauth' ? 'Gmail' : account.imapHost || 'IMAP'
  return (
    <li className="mail-account-row">
      <div className="mail-account-info">
        <span className="mail-account-email">{account.email}</span>
        <span className="mail-account-status nutrition-mono">
          <span className="mail-account-kind">{kind}</span>
          {' · '}
          {account.stale
            ? 'Last sync failed — try Sync now'
            : account.lastSyncAt
              ? `Synced ${new Date(account.lastSyncAt).toLocaleString()}`
              : 'Ready to sync'}
        </span>
      </div>
      <div className="calendar-settings-actions">
        <button
          type="button"
          className="calendar-settings-button calendar-settings-button--primary"
          disabled={busy}
          onClick={onSync}
        >
          Sync now
        </button>
        <button
          type="button"
          className="calendar-settings-button calendar-settings-button--ghost"
          disabled={busy}
          onClick={onDisconnect}
        >
          Disconnect
        </button>
      </div>
    </li>
  )
}
