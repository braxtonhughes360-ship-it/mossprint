import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MailAccountRecord, MailStatus } from '@shared/mail'
import { MailAccountConnectFlow } from './MailAccountConnectFlow'

/** Inbox account connect + status — Settings chamber. OAuth (Gmail) + IMAP/SMTP presets. */
export function MailAccountsPanel(): React.JSX.Element {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [bridgeReady, setBridgeReady] = useState(Boolean(window.moss?.mail))

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

  const accounts = status?.accounts ?? []

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

        <MailAccountConnectFlow
          onConnected={(message) => {
            setFlash(message)
            void load()
          }}
          onError={setError}
        />
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
