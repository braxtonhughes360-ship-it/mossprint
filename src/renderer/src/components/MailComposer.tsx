import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  MailAccountRecord,
  MailComposeMode,
  MailMessageDetail,
  MailSendInput
} from '@shared/mail'
import {
  formatMailTimestamp,
  isLikelyEmail,
  mailDisplayName,
  parseAddressList
} from '@shared/mail'
import { MossModal } from './MossModal'
import { MossSelect } from './MossSelect'

interface MailComposerProps {
  mode: MailComposeMode
  accounts: MailAccountRecord[]
  original: MailMessageDetail | null
  onClose: () => void
  onSent: (summary: string) => void
}

export function MailComposer({
  mode,
  accounts,
  original,
  onClose,
  onSent
}: MailComposerProps): React.JSX.Element {
  const initial = useMemo(() => buildInitial(mode, original, accounts), [mode, original, accounts])
  const [accountId, setAccountId] = useState(initial.accountId)
  const [to, setTo] = useState(initial.to)
  const [cc, setCc] = useState(initial.cc)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [showCc, setShowCc] = useState(Boolean(initial.cc))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Reply/forward land the cursor in the body; a fresh compose starts at the recipient.
    if (mode === 'new') firstFieldRef.current?.focus()
    else bodyRef.current?.focus()
  }, [mode])

  const recipients = parseAddressList(to)
  const recipientsValid = recipients.length > 0 && recipients.every(isLikelyEmail)
  const ccValid = cc.trim() === '' || parseAddressList(cc).every(isLikelyEmail)
  const canSend = Boolean(accountId) && recipientsValid && ccValid && !busy
  const fromEmail = accounts.find((account) => account.id === accountId)?.email ?? ''

  const heading =
    mode === 'forward' ? 'Forward' : mode === 'new' ? 'New message' : 'Reply'

  async function handleSend(): Promise<void> {
    if (!window.moss?.mail?.send || !canSend) return
    setBusy(true)
    setError(null)
    try {
      const payload: MailSendInput = {
        accountId,
        to: recipients.join(', '),
        subject,
        body
      }
      if (cc.trim()) payload.cc = parseAddressList(cc).join(', ')
      if ((mode === 'reply' || mode === 'replyAll') && original) {
        payload.inReplyToId = original.id
      }
      await window.moss.mail.send(payload)
      onSent(`Sent to ${recipients[0]}${recipients.length > 1 ? ` +${recipients.length - 1}` : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send this message')
      setBusy(false)
    }
  }

  return (
    <MossModal
      onClose={onClose}
      backdropClassName="mail-composer-overlay"
      panelClassName="mail-composer"
      ariaLabel={heading}
    >
      <header className="mail-composer-head">
          <p className="settings-kicker">{heading}</p>
          <button
            type="button"
            className="mail-icon-button"
            aria-label="Close composer"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="mail-composer-fields">
          <label className="mail-composer-row">
            <span className="mail-composer-label nutrition-mono">From</span>
            {accounts.length > 1 ? (
              <MossSelect
                className="moss-select--block mail-composer-input"
                value={accountId}
                options={accounts.map((account) => ({ value: account.id, label: account.email }))}
                onChange={setAccountId}
                disabled={busy}
                ariaLabel="From account"
              />
            ) : (
              <span className="mail-composer-from-static nutrition-mono">
                {accounts.find((account) => account.id === accountId)?.email ?? '—'}
              </span>
            )}
          </label>

          <label className="mail-composer-row">
            <span className="mail-composer-label nutrition-mono">To</span>
            <input
              ref={firstFieldRef}
              type="text"
              className="preference-input mail-composer-input"
              placeholder="name@example.com"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              disabled={busy}
            />
            {!showCc && (
              <button
                type="button"
                className="mail-composer-cc-toggle"
                onClick={() => setShowCc(true)}
                disabled={busy}
              >
                Cc
              </button>
            )}
          </label>

          {showCc && (
            <label className="mail-composer-row">
              <span className="mail-composer-label nutrition-mono">Cc</span>
              <input
                type="text"
                className="preference-input mail-composer-input"
                placeholder="optional"
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                disabled={busy}
              />
            </label>
          )}

          <label className="mail-composer-row">
            <span className="mail-composer-label nutrition-mono">Subject</span>
            <input
              type="text"
              className="preference-input mail-composer-input"
              placeholder="Subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              disabled={busy}
            />
          </label>

          <textarea
            ref={bodyRef}
            className="preference-input mail-composer-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={busy}
            spellCheck
          />
        </div>

        {error && <p className="settings-inline-error mail-composer-error">{error}</p>}

        <footer className="mail-composer-foot">
          <p className="mail-composer-hint nutrition-mono">
            {recipientsValid || to.trim() === ''
              ? fromEmail
                ? `Sends from ${fromEmail}`
                : 'Sends from your account'
              : 'Enter a valid address'}
          </p>
          <div className="mail-composer-actions">
            <button
              type="button"
              className="calendar-settings-button calendar-settings-button--ghost"
              onClick={onClose}
              disabled={busy}
            >
              Discard
            </button>
            <button
              type="button"
              className="calendar-settings-button calendar-settings-button--primary"
              onClick={() => void handleSend()}
              disabled={!canSend}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </footer>
    </MossModal>
  )
}

function buildInitial(
  mode: MailComposeMode,
  original: MailMessageDetail | null,
  accounts: MailAccountRecord[]
): { accountId: string; to: string; cc: string; subject: string; body: string } {
  const fallbackAccount = accounts[0]?.id ?? ''

  if (!original || mode === 'new') {
    return { accountId: fallbackAccount, to: '', cc: '', subject: '', body: '' }
  }

  const accountId = original.accountId || fallbackAccount
  const accountEmail = accounts.find((account) => account.id === accountId)?.email ?? ''
  const senderLabel = mailDisplayName(original.fromName, original.fromEmail)

  if (mode === 'forward') {
    return {
      accountId,
      to: '',
      cc: '',
      subject: withPrefix(original.subject, 'Fwd:'),
      body: buildForwardBody(original)
    }
  }

  // reply / replyAll
  const cc =
    mode === 'replyAll'
      ? parseAddressList([original.toEmails, original.ccEmails].filter(Boolean).join(','))
          .filter((address) => normalizeEmail(address) !== normalizeEmail(accountEmail))
          .filter((address) => normalizeEmail(address) !== normalizeEmail(original.fromEmail))
          .join(', ')
      : ''

  return {
    accountId,
    to: original.fromEmail,
    cc,
    subject: withPrefix(original.subject, 'Re:'),
    body: buildQuotedReply(original, senderLabel)
  }
}

function withPrefix(subject: string, prefix: string): string {
  const trimmed = subject.trim()
  const lower = trimmed.toLowerCase()
  if (prefix === 'Re:' && (lower.startsWith('re:') || lower.startsWith('re :'))) return trimmed
  if (prefix === 'Fwd:' && (lower.startsWith('fwd:') || lower.startsWith('fw:'))) return trimmed
  return `${prefix} ${trimmed}`.trim()
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function buildQuotedReply(original: MailMessageDetail, senderLabel: string): string {
  const when = formatMailTimestamp(original.receivedAt)
  const lead = `On ${when}, ${senderLabel} <${original.fromEmail}> wrote:`
  return `\n\n${lead}\n${quote(original.bodyText.trim())}`
}

function buildForwardBody(original: MailMessageDetail): string {
  const lines = [
    '',
    '',
    '---------- Forwarded message ----------',
    `From: ${mailDisplayName(original.fromName, original.fromEmail)} <${original.fromEmail}>`,
    `Date: ${formatMailTimestamp(original.receivedAt)}`,
    `Subject: ${original.subject}`,
    original.toEmails ? `To: ${original.toEmails}` : '',
    '',
    original.bodyText.trim()
  ]
  return lines.filter((line, index) => !(line === '' && lines[index - 1] === '' && index > 2)).join('\n')
}

function normalizeEmail(value: string): string {
  const match = /<([^>]+)>/.exec(value)
  return (match ? match[1] : value).trim().toLowerCase()
}
