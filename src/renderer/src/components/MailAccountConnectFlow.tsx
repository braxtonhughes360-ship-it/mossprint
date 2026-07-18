import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MailConnectImapInput, MailStatus, MailTlsMode } from '@shared/mail'
import {
  MAIL_IMAP_PRESETS,
  flagsToTlsMode,
  getImapPreset,
  presetImapSecurity,
  presetSmtpSecurity
} from '@shared/mail'
import { MossButton } from './MossButton'
import { MossCheckbox } from './MossCheckbox'
import { MossSelect } from './MossSelect'

const TLS_OPTIONS: Array<{ value: MailTlsMode; label: string }> = [
  { value: 'ssl', label: 'SSL/TLS' },
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'none', label: 'None (local only)' }
]

export interface MailAccountConnectFlowProps {
  /** Called after a successful Gmail or IMAP connect (Settings reload, Inbox invalidate, etc.). */
  onConnected?: (message: string) => void
  onError?: (message: string) => void
  /** When true, omit the subsection labels (modal / inline Inbox use). */
  compact?: boolean
}

/** Shared Gmail OAuth + IMAP connect UI — used by Settings, Setup, and Inbox "Add account". */
export function MailAccountConnectFlow({
  onConnected,
  onError,
  compact = false
}: MailAccountConnectFlowProps): React.JSX.Element {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showAdminSetup, setShowAdminSetup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
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

  const loadStatus = useCallback(async () => {
    if (!window.moss?.mail) {
      setBridgeReady(false)
      onError?.('Inbox bridge unavailable — use the MOSS desktop app, not a bare browser tab.')
      return null
    }
    setBridgeReady(true)
    try {
      const next = await window.moss.mail.getStatus()
      setStatus(next)
      return next
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to load mail accounts')
      return null
    }
  }, [onError])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  async function connectGmail(): Promise<void> {
    if (!window.moss?.mail?.connectGmail) return
    setConnecting(true)
    try {
      const result = await window.moss.mail.connectGmail()
      await loadStatus()
      onConnected?.(`Connected ${result.email} · imported ${result.imported} messages`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not connect Gmail'
      if (!/cancel/i.test(message)) onError?.(message)
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
      await loadStatus()
      setImapEmail('')
      setImapPassword('')
      onConnected?.(`Connected ${result.email} · imported ${result.imported} messages`)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Could not connect this account')
    } finally {
      setImapConnecting(false)
    }
  }

  async function saveGoogleOAuth(): Promise<void> {
    if (!window.moss?.mail?.setGoogleOAuth || !clientId.trim() || !clientSecret.trim()) return
    setBusy(true)
    try {
      await window.moss.mail.setGoogleOAuth(clientId.trim(), clientSecret.trim())
      await loadStatus()
      setClientId('')
      setClientSecret('')
      onConnected?.('Saved — now use Connect Gmail')
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Could not save credentials')
    } finally {
      setBusy(false)
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
    <div className="mail-connect-flow">
      <div className={`settings-subsection calendar-google-panel${compact ? ' mail-connect-flow--compact' : ''}`}>
        {!compact && <p className="settings-subsection-label nutrition-mono">Gmail — sign in</p>}
        {configured ? (
          <div className="calendar-google-connect-flow">
            <p className="preference-hint">
              Opens your default browser. Sign in, approve access (and 2-Step on your phone if
              prompted), then return to MOSS.
            </p>
            <MossButton
              className="calendar-settings-button--wide"
              disabled={connecting || busy || !bridgeReady}
              onClick={() => void connectGmail()}
              busy={connecting}
              busyLabel="Opening Google…"
            >
              {accounts.some((a) => a.authType === 'oauth')
                ? 'Add another Gmail'
                : 'Connect Gmail'}
            </MossButton>
            {connecting && (
              <MossButton variant="quiet" onClick={cancelGmailConnect}>
                Cancel sign-in
              </MossButton>
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
            <MossButton
              disabled={busy || !bridgeReady}
              onClick={() => setShowAdminSetup((open) => !open)}
            >
              {showAdminSetup ? 'Hide setup' : 'One-time Google setup'}
            </MossButton>
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
                <MossButton
                  variant="quiet"
                  onClick={() =>
                    void window.moss?.shell?.openExternal(
                      'https://console.cloud.google.com/apis/credentials'
                    )
                  }
                >
                  Open Google Cloud Console ↗
                </MossButton>
                <form
                  className="calendar-settings-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void saveGoogleOAuth()
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
                  <MossButton type="submit" disabled={busy}>
                    Save credentials
                  </MossButton>
                </form>
              </>
            )}
          </div>
        )}
      </div>

      <div className={`settings-subsection${compact ? ' mail-connect-flow--compact' : ''}`}>
        {!compact && (
          <p className="settings-subsection-label nutrition-mono">Other providers — IMAP</p>
        )}
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

          <MossButton
            disabled={imapConnecting || busy}
            onClick={() => setShowServerSettings((open) => !open)}
          >
            {showServerSettings ? 'Hide server settings' : 'Server settings (host, port, TLS)'}
          </MossButton>

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

              <MossCheckbox
                className="mail-imap-self-signed"
                label="Allow self-signed certificate (Proton Bridge / localhost)"
                checked={allowSelfSigned}
                onChange={(event) => setAllowSelfSigned(event.target.checked)}
                disabled={imapConnecting || busy}
              />
              <p className="preference-hint mail-imap-server-hint">
                Preset defaults: IMAP {flagsToTlsMode(preset?.imapSecure ?? true, Number(imapPort) || 993)}{' '}
                · SMTP {flagsToTlsMode(preset?.smtpSecure ?? false, Number(smtpPort) || 587)}
              </p>
            </div>
          )}

          <MossButton
            type="submit"
            className="calendar-settings-button--wide"
            disabled={imapDisabled}
            busy={imapConnecting}
            busyLabel="Connecting…"
          >
            Connect account
          </MossButton>
        </form>
      </div>
    </div>
  )
}
