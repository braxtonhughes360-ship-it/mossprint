export const MAIL_PROVIDERS = ['gmail', 'imap'] as const

export type MailProvider = (typeof MAIL_PROVIDERS)[number]

export type MailAuthType = 'oauth' | 'imap'

export const MAIL_FOLDERS = ['inbox', 'archive', 'sent', 'trash'] as const

export type MailFolder = (typeof MAIL_FOLDERS)[number]

export interface MailAccountRecord {
  id: string
  provider: MailProvider
  authType: MailAuthType
  email: string
  label: string
  /** IMAP host for display ('' for OAuth accounts). */
  imapHost: string
  lastSyncAt: string | null
  stale: boolean
  lastError: string | null
  enabled: boolean
  createdAt: string
}

/** Compact row for the unified inbox list — no heavy body fields. */
export interface MailMessageSummary {
  id: string
  accountId: string
  accountEmail: string
  accountLabel: string
  externalId: string
  threadId: string | null
  folder: MailFolder
  fromName: string
  fromEmail: string
  toEmails: string
  subject: string
  snippet: string
  receivedAt: string
  read: boolean
  hasAttachments: boolean
}

/** Full message including sanitized body — fetched on open. */
export interface MailMessageDetail extends MailMessageSummary {
  ccEmails: string
  bodyHtml: string
  bodyText: string
  messageIdHeader: string
  referencesHeader: string
}

export interface MailStatus {
  configured: boolean
  accounts: MailAccountRecord[]
}

export interface MailListOptions {
  folder?: MailFolder
  accountId?: string
  limit?: number
  unreadOnly?: boolean
  /** Case-insensitive match on subject, sender, recipients, snippet, and full message body. */
  query?: string
}

/** TLS mode for IMAP/SMTP endpoints — shown in account setup advanced panel. */
export type MailTlsMode = 'ssl' | 'starttls' | 'none'

export interface MailConnectResult {
  accountId: string
  email: string
  label: string
  imported: number
}

// ── IMAP + SMTP presets (V2b) ───────────────────────────────────────────────

export interface MailImapPreset {
  id: string
  label: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  /** Localhost bridges use self-signed certs — only Proton Bridge here. */
  allowSelfSigned?: boolean
  /** Honest setup copy (app-password requirement, Bridge caveat, etc.). */
  note?: string
  appPasswordUrl?: string
  custom?: boolean
}

/** Stored (non-secret) IMAP/SMTP connection settings — password lives in the keychain. */
export interface MailImapConfig {
  presetId: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  imapSecurity?: MailTlsMode
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpSecurity?: MailTlsMode
  allowSelfSigned: boolean
  username: string
}

export interface MailConnectImapInput {
  presetId: string
  email: string
  password: string
  displayName?: string
  /** Server overrides — any preset can adjust host, port, and TLS. */
  imapHost?: string
  imapPort?: number
  imapSecurity?: MailTlsMode
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: MailTlsMode
  allowSelfSigned?: boolean
  username?: string
}

/**
 * Named provider presets. Gmail and Outlook are intentionally absent — they use OAuth, not
 * app-password IMAP. Every named preset needs an app-specific password (never the main account
 * password). Proton requires the Bridge app + a paid plan.
 */
export const MAIL_IMAP_PRESETS: readonly MailImapPreset[] = [
  {
    id: 'gmail-app',
    label: 'Gmail / Google Workspace (app password)',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    note: 'Turn on 2-Step Verification, then create an App Password (Google Account → Security → App passwords) and paste it here — not your normal password. Prefer one click and no app password? Use “Connect Gmail” above (OAuth) instead.',
    appPasswordUrl: 'https://myaccount.google.com/apppasswords'
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
    note: 'Use an app-specific password from appleid.apple.com — not your Apple ID password. Requires two-factor on your Apple ID.',
    appPasswordUrl: 'https://account.apple.com/account/manage'
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    smtpSecure: true,
    note: 'Create an app password in Fastmail → Settings → Privacy & Security → App passwords.',
    appPasswordUrl: 'https://app.fastmail.com/settings/security/apppasswords'
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
    note: 'Generate an app password in Yahoo Account Security — your normal password will not work.',
    appPasswordUrl: 'https://login.yahoo.com/account/security'
  },
  {
    id: 'aol',
    label: 'AOL Mail',
    imapHost: 'imap.aol.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.aol.com',
    smtpPort: 465,
    smtpSecure: true,
    note: 'Generate an app password in AOL Account Security — your normal password will not work.',
    appPasswordUrl: 'https://login.aol.com/account/security'
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465,
    smtpSecure: true,
    note: 'Create an app-specific password in Zoho → Settings → Security → App Passwords (IMAP must be enabled).',
    appPasswordUrl: 'https://accounts.zoho.com/home#security/app_password'
  },
  {
    id: 'protonbridge',
    label: 'Proton Mail (Bridge)',
    imapHost: '127.0.0.1',
    imapPort: 1143,
    imapSecure: false,
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    // Current Bridge uses implicit TLS on the SMTP port; MOSS also falls back to STARTTLS on connect.
    smtpSecure: true,
    allowSelfSigned: true,
    note: 'Requires the Proton Mail Bridge app running on this Mac and a paid Proton plan. Use the IMAP password Bridge shows you (not your Proton account password). Default Bridge ports are 1143/1025 — adjust with Custom if yours differ. MOSS auto-detects whether Bridge wants SSL or STARTTLS when sending.'
  },
  {
    id: 'custom',
    label: 'Other (custom IMAP/SMTP)',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    custom: true,
    note: 'Enter your provider’s IMAP and SMTP server details. Most providers list these under “mail client setup”.'
  }
]

export function getImapPreset(id: string): MailImapPreset | undefined {
  return MAIL_IMAP_PRESETS.find((preset) => preset.id === id)
}

export function presetImapSecurity(preset: MailImapPreset): MailTlsMode {
  // Secure presets use implicit TLS (993/465); everything else negotiates STARTTLS.
  return preset.imapSecure ? 'ssl' : 'starttls'
}

export function presetSmtpSecurity(preset: MailImapPreset): MailTlsMode {
  return preset.smtpSecure ? 'ssl' : 'starttls'
}

export function tlsModeToFlags(mode: MailTlsMode): { secure: boolean; requireTLS: boolean } {
  if (mode === 'ssl') return { secure: true, requireTLS: false }
  if (mode === 'starttls') return { secure: false, requireTLS: true }
  return { secure: false, requireTLS: false }
}

export function flagsToTlsMode(secure: boolean, port: number): MailTlsMode {
  if (secure) return 'ssl'
  if (port === 465 || port === 993) return 'ssl'
  return 'starttls'
}

export interface MailSyncResult {
  accountId: string
  imported: number
  updated: number
  stale: boolean
  error?: string
}

export interface MailSyncAllResult {
  results: MailSyncResult[]
  staleCount: number
}

export interface MailDoorSnapshot {
  unreadCount: number
  totalAccounts: number
  latest: {
    fromName: string
    subject: string
    receivedAt: string
    read: boolean
  } | null
  hasStaleAccounts: boolean
}

export type MailComposeMode = 'new' | 'reply' | 'replyAll' | 'forward'

export interface MailSendInput {
  accountId: string
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string
  /** Reply/forward threading — the message being responded to. */
  inReplyToId?: string
}

export interface MailSendResult {
  ok: true
  messageId: string
}

/**
 * AI reply drafting (QA-11c). Success carries editable body text for the
 * composer only — never recipients, and never anything that can send itself.
 */
export type MailAiDraftResult =
  | { ok: true; body: string }
  | { ok: false; reason: 'no-model' | 'unavailable' }

/** Local-only compose draft — never synced to the provider (see mail_drafts migration). */
export interface MailDraftRecord {
  id: string
  accountId: string
  accountEmail: string
  toEmails: string
  ccEmails: string
  subject: string
  body: string
  composeMode: MailComposeMode
  inReplyToMessageId: string | null
  createdAt: string
  updatedAt: string
}

export interface MailDraftSummary {
  id: string
  accountId: string
  accountEmail: string
  toEmails: string
  subject: string
  snippet: string
  composeMode: MailComposeMode
  inReplyToMessageId: string | null
  updatedAt: string
}

export interface MailSaveDraftInput {
  id?: string
  accountId: string
  toEmails: string
  ccEmails?: string
  subject: string
  body: string
  composeMode?: MailComposeMode
  inReplyToMessageId?: string | null
}

/** Parsed recipient list (comma/semicolon separated) into trimmed addresses. */
export function parseAddressList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isLikelyEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

/** Short relative age label for list rows — "3m", "2h", "Mon", "Apr 4". */
export function formatMailAge(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = now - then
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(then)
  }
  const sameYear = new Date(then).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  }).format(then)
}

/** Full timestamp for the reading pane header. */
export function formatMailTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

/** Display name for a row — name if present, else the local part of the email. */
export function mailDisplayName(fromName: string, fromEmail: string): string {
  const name = fromName.trim()
  if (name) return name
  const email = fromEmail.trim()
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email || 'Unknown sender'
}
