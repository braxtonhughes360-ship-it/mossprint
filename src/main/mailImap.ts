import { randomUUID } from 'node:crypto'
import { ImapFlow, type ListResponse } from 'imapflow'
import nodemailer from 'nodemailer'
import SMTPConnection from 'nodemailer/lib/smtp-connection/index.js'
import { simpleParser, type AddressObject } from 'mailparser'
import type {
  MailConnectImapInput,
  MailConnectResult,
  MailImapConfig,
  MailSendInput,
  MailSendResult,
  MailSyncResult,
  MailTlsMode
} from '@shared/mail'
import {
  flagsToTlsMode,
  getImapPreset,
  presetImapSecurity,
  presetSmtpSecurity,
  tlsModeToFlags
} from '@shared/mail'
import { MAIL_SYNC_MAX_MESSAGES, MAIL_SYNC_RETENTION_DAYS } from '@shared/mailSyncConstants'
import {
  createImapAccount,
  getImapConfig,
  getMailAccount,
  getMessageDetail,
  markAccountStale,
  touchAccount,
  upsertMessage
} from './mail'
import { sanitizeEmailHtml, htmlToText, buildSnippet, MAX_BODY_LENGTH } from './mailHtml'
import { deleteMailPassword, readMailPassword, storeMailPassword } from './mailCredentials'

/**
 * IMAP + SMTP provider presets (V2b). Read via imapflow, send via nodemailer; app passwords live
 * in the OS keychain (never SQLite). Gmail/Outlook intentionally use OAuth, not this path.
 */

const SMTP_TIMEOUT_MS = 15000

function resolveTlsMode(
  explicit: MailTlsMode | undefined,
  secureFallback: boolean,
  port: number
): MailTlsMode {
  if (explicit) return explicit
  return flagsToTlsMode(secureFallback, port)
}

function resolveImapConfig(input: MailConnectImapInput): MailImapConfig {
  const preset = getImapPreset(input.presetId)
  if (!preset) {
    throw new Error('Unknown mail provider')
  }

  const username = input.username?.trim() || input.email.trim()
  const imapHost = (input.imapHost?.trim() || preset.imapHost).trim()
  const smtpHost = (input.smtpHost?.trim() || preset.smtpHost).trim()
  const imapPort = input.imapPort ?? preset.imapPort
  const smtpPort = input.smtpPort ?? preset.smtpPort
  const allowSelfSigned = input.allowSelfSigned ?? preset.allowSelfSigned ?? false

  if (!imapHost || !smtpHost) {
    throw new Error('Enter both an IMAP and an SMTP server address')
  }

  const imapSecurity = resolveTlsMode(
    input.imapSecurity ?? (preset.custom ? undefined : presetImapSecurity(preset)),
    preset.imapPort === imapPort ? preset.imapSecure : imapPort === 993,
    imapPort
  )
  const smtpSecurity = resolveTlsMode(
    input.smtpSecurity ?? (preset.custom ? undefined : presetSmtpSecurity(preset)),
    preset.smtpPort === smtpPort ? preset.smtpSecure : smtpPort === 465,
    smtpPort
  )
  const imapTls = tlsModeToFlags(imapSecurity)
  const smtpTls = tlsModeToFlags(smtpSecurity)

  return {
    presetId: preset.custom ? 'custom' : preset.id,
    imapHost,
    imapPort,
    imapSecure: imapTls.secure,
    imapSecurity,
    smtpHost,
    smtpPort,
    smtpSecure: smtpTls.secure,
    smtpSecurity,
    allowSelfSigned,
    username
  }
}

function imapSecureOption(config: MailImapConfig): boolean {
  const mode = config.imapSecurity ?? flagsToTlsMode(config.imapSecure, config.imapPort)
  return mode === 'ssl'
}

function smtpTransportOptions(config: MailImapConfig, password: string) {
  const mode = config.smtpSecurity ?? flagsToTlsMode(config.smtpSecure, config.smtpPort)
  const tls = tlsModeToFlags(mode)
  return {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: tls.secure,
    requireTLS: tls.requireTLS && !config.allowSelfSigned,
    ignoreTLS: !tls.secure && !tls.requireTLS,
    auth: { user: config.username, pass: password },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    tls: config.allowSelfSigned ? { rejectUnauthorized: false } : undefined
  }
}

function buildImapClient(config: MailImapConfig, password: string): ImapFlow {
  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: imapSecureOption(config),
    auth: { user: config.username, pass: password },
    logger: false,
    // Bridges (Proton) listen on localhost with a self-signed cert; everything else verifies.
    tls: { rejectUnauthorized: !config.allowSelfSigned }
  })
}

function buildSmtpTransport(
  config: MailImapConfig,
  password: string
): nodemailer.Transporter {
  return nodemailer.createTransport(smtpTransportOptions(config, password))
}

// ── Connect ──────────────────────────────────────────────────────────────────

export async function connectImapAccount(
  input: MailConnectImapInput
): Promise<MailConnectResult> {
  const email = input.email.trim()
  if (!email) {
    throw new Error('Enter the email address for this account')
  }
  if (!input.password) {
    throw new Error('Enter the app password for this account')
  }

  const config = resolveImapConfig(input)

  // Verify both legs before persisting anything, so a typo never leaves a dead account. SMTP
  // verification self-corrects the TLS mode (returns the config that actually connected).
  await verifyImap(config, input.password)
  const verifiedConfig = await verifySmtp(config, input.password)

  const label = input.displayName?.trim() || email
  const accountId = createImapAccount(email, label, verifiedConfig)
  storeMailPassword(accountId, input.password)

  const sync = await syncImapAccount(accountId)
  return { accountId, email, label, imported: sync.imported }
}

async function verifyImap(config: MailImapConfig, password: string): Promise<void> {
  const client = buildImapClient(config, password)
  try {
    await client.connect()
  } catch (error) {
    throw new Error(imapErrorMessage(error))
  } finally {
    await safeLogout(client)
  }
}

/**
 * Verify SMTP, auto-correcting the TLS mode when the chosen one can't reach the server, and
 * return the config that actually connected. Proton Bridge varies between implicit SSL and
 * STARTTLS on the same 1025 port depending on the user's Bridge settings, so we try the chosen
 * mode first then fall back to the alternative — but never retry on an auth failure (that means
 * the TLS handshake worked and the password is the real problem). nodemailer's verify() hangs on
 * Bridge, so the login probe matches the real send path.
 */
async function verifySmtp(config: MailImapConfig, password: string): Promise<MailImapConfig> {
  const primary = config.smtpSecurity ?? flagsToTlsMode(config.smtpSecure, config.smtpPort)
  const order: MailTlsMode[] =
    primary === 'starttls' ? ['starttls', 'ssl'] : primary === 'ssl' ? ['ssl', 'starttls'] : ['none', 'ssl', 'starttls']

  const tried = new Set<MailTlsMode>()
  let lastError: unknown = null

  for (const mode of order) {
    if (tried.has(mode)) continue
    tried.add(mode)
    const candidate = applySmtpSecurity(config, mode)
    try {
      await probeSmtpLogin(candidate, password)
      return candidate
    } catch (error) {
      lastError = error
      if (isSmtpAuthError(error)) {
        // TLS handshake worked; the credentials are wrong — stop and report that, not "no response".
        throw new Error(`Could not sign in to the outgoing (SMTP) server — ${smtpErrorMessage(error)}`)
      }
    }
  }

  throw new Error(`Could not reach the outgoing (SMTP) server — ${smtpErrorMessage(lastError)}`)
}

function applySmtpSecurity(config: MailImapConfig, mode: MailTlsMode): MailImapConfig {
  return { ...config, smtpSecurity: mode, smtpSecure: tlsModeToFlags(mode).secure }
}

function isSmtpAuthError(error: unknown): boolean {
  if (errnoCode(error) === 'EAUTH') return true
  const text = error instanceof Error ? error.message : String(error)
  return /\b(535|534|authentication|invalid login|invalid credentials|bad username|password)\b/i.test(text)
}

function probeSmtpLogin(config: MailImapConfig, password: string): Promise<void> {
  const options = {
    ...smtpTransportOptions(config, password),
    logger: false
  }

  return new Promise((resolve, reject) => {
    const connection = new SMTPConnection(options)
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      try {
        connection.quit()
      } catch {
        // already closed
      }
      if (error) reject(error)
      else resolve()
    }

    connection.once('error', (error: Error) => finish(error))
    connection.connect(() => {
      connection.login({ user: config.username, pass: password }, (error?: Error | null) => {
        finish(error ?? undefined)
      })
    })
  })
}

// ── Sync ──────────────────────────────────────────────────────────────────────

export async function syncImapAccount(accountId: string): Promise<MailSyncResult> {
  const account = getMailAccount(accountId)
  if (!account) {
    throw new Error('Mail account not found')
  }
  const config = getImapConfig(accountId)
  const password = readMailPassword(accountId)
  if (!config || !password) {
    const message = 'Mail credentials missing — reconnect this account'
    markAccountStale(accountId, message)
    return { accountId, imported: 0, updated: 0, stale: true, error: message }
  }

  let imported = 0
  let updated = 0
  const client = buildImapClient(config, password)

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date()
      since.setDate(since.getDate() - MAIL_SYNC_RETENTION_DAYS)

      const uids = await client.search({ since }, { uid: true })
      const uidList = Array.isArray(uids) ? uids : []
      const toFetch =
        uidList.length > MAIL_SYNC_MAX_MESSAGES
          ? uidList.slice(uidList.length - MAIL_SYNC_MAX_MESSAGES)
          : uidList

      if (toFetch.length > 0) {
        for await (const msg of client.fetch(toFetch, {
          uid: true,
          flags: true,
          envelope: true,
          source: true,
          internalDate: true
        })) {
          const result = await storeImapMessage(accountId, msg)
          if (result === 'imported') imported += 1
          else updated += 1
        }
      }
    } finally {
      lock.release()
    }

    touchAccount(accountId, { stale: false, error: null })
    return { accountId, imported, updated, stale: false }
  } catch (error) {
    const message = imapErrorMessage(error)
    markAccountStale(accountId, message)
    return { accountId, imported, updated, stale: true, error: message }
  } finally {
    await safeLogout(client)
  }
}

interface FetchedMessage {
  uid: number
  flags?: Set<string>
  source?: Buffer
  internalDate?: Date | string
}

async function storeImapMessage(
  accountId: string,
  msg: FetchedMessage
): Promise<'imported' | 'updated'> {
  const parsed = await simpleParser(msg.source ?? Buffer.alloc(0))

  const fromValue = parsed.from?.value?.[0]
  const fromName = fromValue?.name?.trim() ?? ''
  const fromEmail = fromValue?.address?.trim() ?? ''

  const rawHtml = typeof parsed.html === 'string' ? parsed.html : ''
  const sanitizedHtml = sanitizeEmailHtml(rawHtml)
  const plain = parsed.text
    ? parsed.text.slice(0, MAX_BODY_LENGTH)
    : htmlToText(sanitizedHtml)
  const snippet = buildSnippet(plain)

  const read = msg.flags?.has('\\Seen') ?? false
  const receivedAt = new Date(parsed.date ?? msg.internalDate ?? Date.now()).toISOString()
  const hasAttachments = (parsed.attachments?.length ?? 0) > 0
  const flags = [...Array.from(msg.flags ?? []), ...(hasAttachments ? ['att'] : [])].join(',')

  return upsertMessage({
    accountId,
    externalId: String(msg.uid),
    threadId: null,
    folder: 'inbox',
    fromName,
    fromEmail,
    toEmails: addressText(parsed.to),
    ccEmails: addressText(parsed.cc),
    subject: parsed.subject?.trim() ?? '',
    snippet,
    bodyHtml: sanitizedHtml,
    bodyText: plain,
    messageIdHeader: parsed.messageId ?? '',
    referencesHeader: referencesText(parsed.references) || parsed.inReplyTo || '',
    receivedAt,
    read,
    flags
  })
}

function addressText(value: AddressObject | AddressObject[] | undefined): string {
  if (!value) return ''
  if (Array.isArray(value)) return value.map((entry) => entry.text).filter(Boolean).join(', ')
  return value.text ?? ''
}

function referencesText(value: string | string[] | undefined): string {
  if (!value) return ''
  return Array.isArray(value) ? value.join(' ') : value
}

// ── Mutations ────────────────────────────────────────────────────────────────

async function withInbox<T>(
  accountId: string,
  task: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const config = getImapConfig(accountId)
  const password = readMailPassword(accountId)
  if (!config || !password) {
    throw new Error('Mail credentials missing — reconnect this account')
  }
  const client = buildImapClient(config, password)
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      return await task(client)
    } finally {
      lock.release()
    }
  } finally {
    await safeLogout(client)
  }
}

export async function setImapRead(
  accountId: string,
  externalId: string,
  read: boolean
): Promise<void> {
  await withInbox(accountId, async (client) => {
    if (read) {
      await client.messageFlagsAdd(externalId, ['\\Seen'], { uid: true })
    } else {
      await client.messageFlagsRemove(externalId, ['\\Seen'], { uid: true })
    }
  })
}

export async function archiveImapMessage(accountId: string, externalId: string): Promise<void> {
  await moveToSpecial(accountId, externalId, '\\Archive', ['Archive', 'All Mail'], 'Archive')
}

export async function trashImapMessage(accountId: string, externalId: string): Promise<void> {
  await moveToSpecial(
    accountId,
    externalId,
    '\\Trash',
    ['Trash', 'Deleted Messages', 'Deleted Items', 'Bin'],
    'Trash'
  )
}

async function moveToSpecial(
  accountId: string,
  externalId: string,
  specialUse: string,
  fallbackNames: string[],
  label: string
): Promise<void> {
  const config = getImapConfig(accountId)
  const password = readMailPassword(accountId)
  if (!config || !password) {
    throw new Error('Mail credentials missing — reconnect this account')
  }
  const client = buildImapClient(config, password)
  try {
    await client.connect()
    const target = findFolder(await client.list(), specialUse, fallbackNames)
    if (!target) {
      throw new Error(`This account has no ${label} folder`)
    }
    const lock = await client.getMailboxLock('INBOX')
    try {
      await client.messageMove(externalId, target, { uid: true })
    } finally {
      lock.release()
    }
  } finally {
    await safeLogout(client)
  }
}

function findFolder(
  list: ListResponse[],
  specialUse: string,
  fallbackNames: string[]
): string | null {
  const bySpecial = list.find((box) => box.specialUse === specialUse)
  if (bySpecial) return bySpecial.path
  const lowered = fallbackNames.map((name) => name.toLowerCase())
  const byName = list.find((box) => lowered.includes(box.path.toLowerCase()) || lowered.includes((box.name ?? '').toLowerCase()))
  return byName?.path ?? null
}

// ── Send ─────────────────────────────────────────────────────────────────────

export async function sendImap(input: MailSendInput): Promise<MailSendResult> {
  const account = getMailAccount(input.accountId)
  const config = getImapConfig(input.accountId)
  const password = readMailPassword(input.accountId)
  if (!account || !config || !password) {
    throw new Error('Mail account not found or not connected')
  }

  let inReplyTo = ''
  let references = ''
  if (input.inReplyToId) {
    const original = getMessageDetail(input.inReplyToId)
    if (original && original.accountId === input.accountId) {
      inReplyTo = original.messageIdHeader
      references = [original.referencesHeader, original.messageIdHeader].filter(Boolean).join(' ')
    }
  }

  // Shared Message-ID so the SMTP copy and the Sent-folder copy match.
  const domain = account.email.split('@')[1] || 'localhost'
  const messageId = `<${randomUUID()}@${domain}>`
  const mailOptions: nodemailer.SendMailOptions = {
    from: account.email,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject.trim() || '(no subject)',
    text: input.body,
    messageId,
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references } : {})
  }

  const transport = buildSmtpTransport(config, password)
  try {
    await transport.sendMail(mailOptions)
  } catch (error) {
    throw new Error(`Could not send — ${smtpErrorMessage(error)}`)
  } finally {
    transport.close()
  }

  // Best-effort: drop a copy in the Sent folder so it shows in the account's webmail too.
  await appendToSent(config, password, mailOptions).catch(() => {
    // Sent-folder copy is a nicety; the message already went out.
  })

  return { ok: true, messageId }
}

function isGmailSmtpHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === 'smtp.gmail.com' || normalized === 'smtp.googlemail.com'
}

async function appendToSent(
  config: MailImapConfig,
  password: string,
  mailOptions: nodemailer.SendMailOptions
): Promise<void> {
  // Gmail/Workspace auto-file SMTP-sent mail into "Sent Mail" — appending here would duplicate it.
  if (isGmailSmtpHost(config.smtpHost)) return

  const builder = nodemailer.createTransport({ streamTransport: true, buffer: true })
  const built = await builder.sendMail(mailOptions)
  const raw = built.message as Buffer

  const client = buildImapClient(config, password)
  try {
    await client.connect()
    const sent = findFolder(await client.list(), '\\Sent', ['Sent', 'Sent Items', 'Sent Mail'])
    if (sent) {
      await client.append(sent, raw, ['\\Seen'])
    }
  } finally {
    await safeLogout(client)
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function deleteImapCredentials(accountId: string): void {
  deleteMailPassword(accountId)
}

async function safeLogout(client: ImapFlow): Promise<void> {
  try {
    await client.logout()
  } catch {
    try {
      client.close()
    } catch {
      // already closed
    }
  }
}

function imapErrorMessage(error: unknown): string {
  const code = errnoCode(error)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Could not find the mail server — check the host'
  if (code === 'ECONNREFUSED') return 'The mail server refused the connection — check the port'
  if (code === 'ETIMEDOUT') return 'The mail server did not respond — check host and port'
  const text = error instanceof Error ? error.message : String(error)
  if (/auth|credential|login|password/i.test(text)) {
    return 'Sign-in failed — check the email and app password'
  }
  if (/certificate|self.signed/i.test(text)) {
    return 'The server’s TLS certificate could not be verified'
  }
  return 'Could not connect to the mail server'
}

function smtpErrorMessage(error: unknown): string {
  const code = errnoCode(error)
  if (code === 'ENOTFOUND') return 'host not found'
  if (code === 'ECONNREFUSED') return 'connection refused (check the port)'
  if (code === 'ETIMEDOUT') return 'no response (check host and port)'
  const text = error instanceof Error ? error.message : String(error)
  if (/auth|credential|login|password/i.test(text)) return 'sign-in rejected (check the app password)'
  return 'check the server details'
}

function errnoCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '')
  }
  return ''
}
