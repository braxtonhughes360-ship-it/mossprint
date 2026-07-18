import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import type { MailConnectImapInput, MailListOptions, MailSaveDraftInput } from '@shared/mail'
import { MAIL_FOLDERS } from '@shared/mail'
import {
  getMailDoorSnapshot,
  getMailStatus,
  getMessageDetail,
  countMessageSummaries,
  listMessageSummaries
} from '../mail'
import { connectGmailAccount } from '../mailGoogle'
import { connectImapAccount } from '../mailImap'
import {
  archiveMailMessage,
  disconnectMailAccount,
  sendMailMessage,
  setMailReadState,
  syncAllMailAccounts,
  syncMailAccount,
  trashMailMessage
} from '../mailSync'
import {
  countMailDrafts,
  deleteMailDraft,
  getMailDraft,
  listMailDraftSummaries,
  saveMailDraft
} from '../mailDrafts'
import { assertSendInput } from '../mailSendInput'
import { draftMailReply } from '../mailAiDraft'
import { cancelGoogleOAuthLoopback, storeGoogleOAuthClientConfig } from '../googleOAuth'

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

function parseListOptions(value: unknown): MailListOptions {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object') {
    throw new Error('Invalid mail list options')
  }
  const raw = value as Record<string, unknown>
  const options: MailListOptions = {}

  if (raw.folder !== undefined) {
    if (typeof raw.folder !== 'string' || !MAIL_FOLDERS.includes(raw.folder as never)) {
      throw new Error('Invalid mail folder')
    }
    options.folder = raw.folder as MailListOptions['folder']
  }
  if (raw.accountId !== undefined) {
    assertNonEmptyString(raw.accountId, 'accountId')
    options.accountId = raw.accountId
  }
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'number' || !Number.isFinite(raw.limit)) {
      throw new Error('limit must be a number')
    }
    options.limit = raw.limit
  }
  if (raw.unreadOnly !== undefined) {
    options.unreadOnly = Boolean(raw.unreadOnly)
  }
  if (raw.query !== undefined) {
    if (typeof raw.query !== 'string') {
      throw new Error('query must be a string')
    }
    options.query = raw.query
  }
  return options
}

function assertConnectImapInput(value: unknown): MailConnectImapInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid connect input')
  }
  const raw = value as Record<string, unknown>
  assertNonEmptyString(raw.presetId, 'presetId')
  assertNonEmptyString(raw.email, 'email')
  assertNonEmptyString(raw.password, 'password')

  const input: MailConnectImapInput = {
    presetId: raw.presetId.trim(),
    email: raw.email.trim(),
    password: raw.password
  }
  if (typeof raw.displayName === 'string' && raw.displayName.trim()) {
    input.displayName = raw.displayName.trim()
  }
  if (typeof raw.imapHost === 'string' && raw.imapHost.trim()) input.imapHost = raw.imapHost.trim()
  if (typeof raw.smtpHost === 'string' && raw.smtpHost.trim()) input.smtpHost = raw.smtpHost.trim()
  if (typeof raw.username === 'string' && raw.username.trim()) input.username = raw.username.trim()
  if (typeof raw.imapPort === 'number' && Number.isFinite(raw.imapPort)) input.imapPort = raw.imapPort
  if (typeof raw.smtpPort === 'number' && Number.isFinite(raw.smtpPort)) input.smtpPort = raw.smtpPort
  if (raw.imapSecurity === 'ssl' || raw.imapSecurity === 'starttls' || raw.imapSecurity === 'none') {
    input.imapSecurity = raw.imapSecurity
  }
  if (raw.smtpSecurity === 'ssl' || raw.smtpSecurity === 'starttls' || raw.smtpSecurity === 'none') {
    input.smtpSecurity = raw.smtpSecurity
  }
  if (typeof raw.allowSelfSigned === 'boolean') input.allowSelfSigned = raw.allowSelfSigned
  return input
}

function assertSaveDraftInput(value: unknown): MailSaveDraftInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid draft input')
  }
  const raw = value as Record<string, unknown>
  assertNonEmptyString(raw.accountId, 'accountId')
  if (typeof raw.toEmails !== 'string') throw new Error('toEmails must be a string')
  if (typeof raw.subject !== 'string') throw new Error('subject must be a string')
  if (typeof raw.body !== 'string') throw new Error('body must be a string')

  const input: MailSaveDraftInput = {
    accountId: raw.accountId,
    toEmails: raw.toEmails,
    subject: raw.subject,
    body: raw.body
  }
  if (typeof raw.id === 'string' && raw.id.trim()) input.id = raw.id.trim()
  if (typeof raw.ccEmails === 'string') input.ccEmails = raw.ccEmails
  if (raw.composeMode === 'new' || raw.composeMode === 'reply' || raw.composeMode === 'replyAll' || raw.composeMode === 'forward') {
    input.composeMode = raw.composeMode
  }
  if (typeof raw.inReplyToMessageId === 'string' && raw.inReplyToMessageId.trim()) {
    input.inReplyToMessageId = raw.inReplyToMessageId.trim()
  } else if (raw.inReplyToMessageId === null) {
    input.inReplyToMessageId = null
  }
  return input
}

export function registerMailHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MAIL_GET_STATUS, (event) => {
    assertTrustedSender(event)
    return getMailStatus()
  })

  ipcMain.handle(
    IPC_CHANNELS.MAIL_SET_GOOGLE_OAUTH,
    (event, clientId: unknown, clientSecret: unknown) => {
      assertTrustedSender(event)
      assertNonEmptyString(clientId, 'clientId')
      assertNonEmptyString(clientSecret, 'clientSecret')
      storeGoogleOAuthClientConfig(clientId, clientSecret)
      return { ok: true as const }
    }
  )

  ipcMain.handle(IPC_CHANNELS.MAIL_CONNECT_GMAIL, async (event) => {
    assertTrustedSender(event)
    return connectGmailAccount()
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_CANCEL_CONNECT_GMAIL, (event) => {
    assertTrustedSender(event)
    cancelGoogleOAuthLoopback()
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_CONNECT_IMAP, async (event, input: unknown) => {
    assertTrustedSender(event)
    return connectImapAccount(assertConnectImapInput(input))
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_DISCONNECT_ACCOUNT, (event, accountId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(accountId, 'accountId')
    return disconnectMailAccount(accountId)
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_SYNC_ALL, async (event) => {
    assertTrustedSender(event)
    return syncAllMailAccounts()
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_SYNC_ACCOUNT, async (event, accountId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(accountId, 'accountId')
    return syncMailAccount(accountId)
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_LIST_MESSAGES, (event, options: unknown) => {
    assertTrustedSender(event)
    return listMessageSummaries(parseListOptions(options))
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_COUNT_MESSAGES, (event, options: unknown) => {
    assertTrustedSender(event)
    return countMessageSummaries(parseListOptions(options))
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_GET_MESSAGE, (event, messageId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(messageId, 'messageId')
    return getMessageDetail(messageId)
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_GET_DOOR_SNAPSHOT, (event) => {
    assertTrustedSender(event)
    return getMailDoorSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_SET_READ, async (event, messageId: unknown, read: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(messageId, 'messageId')
    await setMailReadState(messageId, Boolean(read))
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_ARCHIVE, async (event, messageId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(messageId, 'messageId')
    await archiveMailMessage(messageId)
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_TRASH, async (event, messageId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(messageId, 'messageId')
    await trashMailMessage(messageId)
    return { ok: true as const }
  })

  // QA-11c invariant: sending stays a human act. The only inputs this handler
  // accepts are the composer's user-initiated payload fields (assertSendInput
  // whitelists them) — there is no auto/AI flag, and the AI draft handler
  // below returns text to the composer only, never into this channel.
  ipcMain.handle(IPC_CHANNELS.MAIL_SEND, async (event, input: unknown) => {
    assertTrustedSender(event)
    return sendMailMessage(assertSendInput(input))
  })

  ipcMain.handle(
    IPC_CHANNELS.MAIL_AI_DRAFT_REPLY,
    async (event, messageId: unknown, instruction: unknown) => {
      assertTrustedSender(event)
      assertNonEmptyString(messageId, 'messageId')
      if (instruction !== undefined && instruction !== null && typeof instruction !== 'string') {
        throw new Error('instruction must be a string')
      }
      return draftMailReply(messageId, typeof instruction === 'string' ? instruction : undefined)
    }
  )

  ipcMain.handle(IPC_CHANNELS.MAIL_LIST_DRAFTS, (event, accountId: unknown) => {
    assertTrustedSender(event)
    if (accountId === undefined || accountId === null) {
      return listMailDraftSummaries()
    }
    assertNonEmptyString(accountId, 'accountId')
    return listMailDraftSummaries(accountId)
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_GET_DRAFT, (event, draftId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(draftId, 'draftId')
    return getMailDraft(draftId)
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_SAVE_DRAFT, (event, input: unknown) => {
    assertTrustedSender(event)
    return saveMailDraft(assertSaveDraftInput(input))
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_DELETE_DRAFT, (event, draftId: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(draftId, 'draftId')
    return deleteMailDraft(draftId)
  })

  ipcMain.handle(IPC_CHANNELS.MAIL_COUNT_DRAFTS, (event, accountId: unknown) => {
    assertTrustedSender(event)
    if (accountId === undefined || accountId === null) {
      return countMailDrafts()
    }
    assertNonEmptyString(accountId, 'accountId')
    return countMailDrafts(accountId)
  })
}
