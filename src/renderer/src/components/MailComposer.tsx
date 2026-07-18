import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MailAccountRecord,
  MailComposeMode,
  MailDraftRecord,
  MailMessageDetail,
  MailSaveDraftInput,
  MailSendInput
} from '@shared/mail'
import {
  formatMailTimestamp,
  isLikelyEmail,
  mailDisplayName,
  parseAddressList
} from '@shared/mail'
import {
  createDraftAutosaveScheduler,
  createSerializedSaver,
  draftHasContent,
  MAIL_DRAFT_AUTOSAVE_MS
} from '@shared/mailDraftAutosave'
import { createSingleFlight } from '@shared/singleFlight'
import { MossModal } from './MossModal'
import { MossSelect } from './MossSelect'

interface MailComposerProps {
  mode: MailComposeMode
  accounts: MailAccountRecord[]
  original: MailMessageDetail | null
  /** Resume an existing local draft. */
  draft?: MailDraftRecord | null
  /** Kick off "Draft with MOSS" as soon as the composer opens (message-view action). */
  initialAiDraft?: boolean
  onClose: () => void
  onSent: (summary: string) => void
  onDraftSaved?: () => void
}

export function MailComposer({
  mode,
  accounts,
  original,
  draft,
  initialAiDraft,
  onClose,
  onSent,
  onDraftSaved
}: MailComposerProps): React.JSX.Element {
  const initial = useMemo(
    () => buildInitial(mode, original, accounts, draft),
    [mode, original, accounts, draft]
  )
  const [accountId, setAccountId] = useState(initial.accountId)
  const [to, setTo] = useState(initial.to)
  const [cc, setCc] = useState(initial.cc)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [showCc, setShowCc] = useState(Boolean(initial.cc))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [aiInstruction, setAiInstruction] = useState('')
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const draftIdRef = useRef<string | null>(draft?.id ?? null)
  const fieldsRef = useRef({ accountId, to, cc, subject, body, mode, originalId: original?.id ?? null })

  fieldsRef.current = {
    accountId,
    to,
    cc,
    subject,
    body,
    mode,
    originalId: original?.id ?? draft?.inReplyToMessageId ?? null
  }

  useEffect(() => {
    if (mode === 'new') firstFieldRef.current?.focus()
    else bodyRef.current?.focus()
  }, [mode])

  const persistDraftNow = useCallback(async (): Promise<void> => {
    if (!window.moss?.mail?.saveDraft) return
    const fields = fieldsRef.current
    if (!fields.accountId) return
    if (!draftHasContent(fields)) return

    setSavingDraft(true)
    try {
      const payload: MailSaveDraftInput = {
        id: draftIdRef.current ?? undefined,
        accountId: fields.accountId,
        toEmails: fields.to,
        ccEmails: fields.cc,
        subject: fields.subject,
        body: fields.body,
        composeMode: fields.mode,
        inReplyToMessageId: fields.originalId
      }
      const saved = await window.moss.mail.saveDraft(payload)
      if (!draftIdRef.current) draftIdRef.current = saved.id
      onDraftSaved?.()
    } catch {
      // Autosave is best-effort — never block compose.
    } finally {
      setSavingDraft(false)
    }
  }, [onDraftSaved])

  // Saves must never overlap: two in-flight saves with no draft id insert two
  // rows (the "two drafts on close" bug).
  const persistDraftNowRef = useRef(persistDraftNow)
  persistDraftNowRef.current = persistDraftNow
  const persistDraftRef = useRef<() => Promise<void>>(null as unknown as () => Promise<void>)
  if (!persistDraftRef.current) {
    persistDraftRef.current = createSerializedSaver(() => persistDraftNowRef.current())
  }
  const persistDraft = persistDraftRef.current

  const autosaveRef = useRef(
    createDraftAutosaveScheduler(
      MAIL_DRAFT_AUTOSAVE_MS,
      () => {
        void persistDraftRef.current()
      },
      (fn, ms) => window.setTimeout(fn, ms),
      (id) => window.clearTimeout(id)
    )
  )

  useEffect(() => {
    return () => autosaveRef.current.cancel()
  }, [])

  const queueAutosave = useCallback(() => {
    autosaveRef.current.schedule()
  }, [])

  // AI drafting is draft-only: the result lands in the body textarea as
  // editable text (autosave persists it like anything typed) and never touches
  // To/Cc or the send path — those stay with the human and the reply flow.
  const replySourceId = original?.id ?? draft?.inReplyToMessageId ?? null
  const canAiDraft =
    (mode === 'reply' || mode === 'replyAll') &&
    Boolean(replySourceId) &&
    Boolean(window.moss?.mail?.aiDraftReply)

  const requestAiDraftInner = useCallback(async (): Promise<void> => {
    if (!window.moss?.mail?.aiDraftReply || !replySourceId) return
    setAiBusy(true)
    setAiNotice(null)
    try {
      // Main process owns the time budget (~8s) — this always resolves.
      const result = await window.moss.mail.aiDraftReply(
        replySourceId,
        aiInstruction.trim() || undefined
      )
      if (result.ok) {
        setBody((prev) => {
          const rest = prev.replace(/^\n+/, '')
          return rest ? `${result.body}\n\n${rest}` : result.body
        })
        queueAutosave()
        bodyRef.current?.focus()
      } else if (result.reason === 'no-model') {
        setAiNotice('Drafting needs smart parsing — turn it on in Settings → Smart parsing.')
      } else {
        setAiNotice("MOSS couldn't draft in time — try again, or just write it.")
      }
    } catch {
      setAiNotice("MOSS couldn't draft in time — try again, or just write it.")
    } finally {
      setAiBusy(false)
    }
  }, [replySourceId, aiInstruction, queueAutosave])

  // Single-flight beyond the disabled button: StrictMode's double mount effect
  // (and Enter-vs-click races) fired two generations that both prepended into
  // the body — the operator's "double outputs".
  const requestAiDraftInnerRef = useRef(requestAiDraftInner)
  requestAiDraftInnerRef.current = requestAiDraftInner
  const requestAiDraftGateRef = useRef<() => Promise<void>>(null as unknown as () => Promise<void>)
  if (!requestAiDraftGateRef.current) {
    requestAiDraftGateRef.current = createSingleFlight(() => requestAiDraftInnerRef.current())
  }
  const requestAiDraft = requestAiDraftGateRef.current

  const initialAiDraftRef = useRef(initialAiDraft)
  const requestAiDraftRef = useRef(requestAiDraft)
  requestAiDraftRef.current = requestAiDraft
  useEffect(() => {
    // One-shot: consume the flag before firing so StrictMode's second mount
    // effect (or any remount) can't request a second generation.
    if (initialAiDraftRef.current) {
      initialAiDraftRef.current = false
      void requestAiDraftRef.current()
    }
  }, [])

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
    autosaveRef.current.cancel()
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
      } else if (draft?.inReplyToMessageId && (mode === 'reply' || mode === 'replyAll')) {
        payload.inReplyToId = draft.inReplyToMessageId
      }
      await window.moss.mail.send(payload)
      if (draftIdRef.current && window.moss.mail.deleteDraft) {
        await window.moss.mail.deleteDraft(draftIdRef.current)
      }
      onSent(`Sent to ${recipients[0]}${recipients.length > 1 ? ` +${recipients.length - 1}` : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send this message')
      setBusy(false)
    }
  }

  async function handleClose(): Promise<void> {
    // Cancel (not flush) the pending autosave — one awaited save on close.
    // flush + a second save here raced to two inserts before either had an id.
    autosaveRef.current.cancel()
    if (draftHasContent(fieldsRef.current)) {
      await persistDraft()
    }
    onClose()
  }

  async function handleDiscard(): Promise<void> {
    autosaveRef.current.cancel()
    if (draftIdRef.current && window.moss?.mail?.deleteDraft) {
      try {
        await window.moss.mail.deleteDraft(draftIdRef.current)
        onDraftSaved?.()
      } catch {
        // Closing anyway.
      }
    }
    onClose()
  }

  return (
    <MossModal
      onClose={() => void handleClose()}
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
            onClick={() => void handleClose()}
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
                onChange={(next) => {
                  setAccountId(next)
                  queueAutosave()
                }}
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
              onChange={(event) => {
                setTo(event.target.value)
                queueAutosave()
              }}
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
                onChange={(event) => {
                  setCc(event.target.value)
                  queueAutosave()
                }}
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
              onChange={(event) => {
                setSubject(event.target.value)
                queueAutosave()
              }}
              disabled={busy}
            />
          </label>

          {canAiDraft && (
            <div className="mail-composer-ai-row">
              <input
                type="text"
                className="preference-input mail-composer-input mail-composer-ai-instruction"
                placeholder='Optional — “decline politely”, “ask for the invoice”'
                value={aiInstruction}
                onChange={(event) => setAiInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !aiBusy && !busy) {
                    event.preventDefault()
                    void requestAiDraft()
                  }
                }}
                disabled={busy || aiBusy}
                aria-label="Tell MOSS what the reply should say"
              />
              <button
                type="button"
                className="calendar-settings-button mail-composer-ai-button"
                onClick={() => void requestAiDraft()}
                disabled={busy || aiBusy}
              >
                {aiBusy ? 'Drafting…' : 'Draft with MOSS'}
              </button>
            </div>
          )}
          {aiNotice && <p className="mail-composer-ai-notice">{aiNotice}</p>}

          <textarea
            ref={bodyRef}
            className="preference-input mail-composer-body"
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
              queueAutosave()
            }}
            disabled={busy}
            spellCheck
          />
        </div>

        {error && <p className="settings-inline-error mail-composer-error">{error}</p>}

        <footer className="mail-composer-foot">
          <p className="mail-composer-hint nutrition-mono">
            {savingDraft
              ? 'Saving draft…'
              : aiBusy
                ? 'MOSS is drafting — nothing sends until you press Send'
                : recipientsValid || to.trim() === ''
                ? fromEmail
                  ? `Sends from ${fromEmail} · drafts stay on this computer`
                  : 'Drafts stay on this computer'
                : 'Enter a valid address'}
          </p>
          <div className="mail-composer-actions">
            <button
              type="button"
              className="calendar-settings-button calendar-settings-button--ghost"
              onClick={() => void handleDiscard()}
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
  accounts: MailAccountRecord[],
  draft?: MailDraftRecord | null
): { accountId: string; to: string; cc: string; subject: string; body: string } {
  if (draft) {
    return {
      accountId: draft.accountId || accounts[0]?.id || '',
      to: draft.toEmails,
      cc: draft.ccEmails,
      subject: draft.subject,
      body: draft.body
    }
  }

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
