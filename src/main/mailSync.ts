import type { MailSendInput, MailSendResult, MailSyncAllResult, MailSyncResult } from '@shared/mail'
import {
  getMailAccount,
  getMessageRef,
  listEnabledMailAccounts,
  setMailAccountEnabled,
  setMessageFolderLocal,
  setMessageReadLocal
} from './mail'
import {
  archiveGmailMessage,
  sendGmail,
  setGmailRead,
  syncGmailAccount,
  trashGmailMessage
} from './mailGoogle'
import {
  archiveImapMessage,
  deleteImapCredentials,
  sendImap,
  setImapRead,
  syncImapAccount,
  trashImapMessage
} from './mailImap'
import { deleteMailToken } from './mailCredentials'

/**
 * Provider-agnostic mail operations. Routes each call to the Gmail (OAuth) or IMAP/SMTP
 * implementation by account provider, then keeps the local SQLite mirror in sync.
 */

function isImap(accountId: string): boolean {
  return getMailAccount(accountId)?.provider === 'imap'
}

export async function syncMailAccount(accountId: string): Promise<MailSyncResult> {
  const account = getMailAccount(accountId)
  if (!account) {
    throw new Error('Mail account not found')
  }
  return account.provider === 'imap' ? syncImapAccount(accountId) : syncGmailAccount(accountId)
}

export async function syncAllMailAccounts(): Promise<MailSyncAllResult> {
  const accounts = listEnabledMailAccounts()
  const results: MailSyncResult[] = []
  for (const account of accounts) {
    results.push(await syncMailAccount(account.id))
  }
  return { results, staleCount: results.filter((result) => result.stale).length }
}

export async function setMailReadState(messageId: string, read: boolean): Promise<void> {
  const ref = getMessageRef(messageId)
  if (!ref) throw new Error('Message not found')
  if (isImap(ref.accountId)) {
    await setImapRead(ref.accountId, ref.externalId, read)
  } else {
    await setGmailRead(ref.accountId, ref.externalId, read)
  }
  setMessageReadLocal(ref.id, read)
}

export async function archiveMailMessage(messageId: string): Promise<void> {
  const ref = getMessageRef(messageId)
  if (!ref) throw new Error('Message not found')
  if (isImap(ref.accountId)) {
    await archiveImapMessage(ref.accountId, ref.externalId)
  } else {
    await archiveGmailMessage(ref.accountId, ref.externalId)
  }
  setMessageFolderLocal(ref.id, 'archive')
}

export async function trashMailMessage(messageId: string): Promise<void> {
  const ref = getMessageRef(messageId)
  if (!ref) throw new Error('Message not found')
  if (isImap(ref.accountId)) {
    await trashImapMessage(ref.accountId, ref.externalId)
  } else {
    await trashGmailMessage(ref.accountId, ref.externalId)
  }
  setMessageFolderLocal(ref.id, 'trash')
}

export async function sendMailMessage(input: MailSendInput): Promise<MailSendResult> {
  const account = getMailAccount(input.accountId)
  if (!account) throw new Error('Mail account not found')
  return account.provider === 'imap' ? sendImap(input) : sendGmail(input)
}

export function disconnectMailAccount(accountId: string): { ok: true } {
  const account = getMailAccount(accountId)
  if (!account) throw new Error('Mail account not found')
  // Clear whichever secret applies; disable the row (history stays, reconnect re-enables).
  deleteMailToken(accountId)
  deleteImapCredentials(accountId)
  setMailAccountEnabled(accountId, false)
  return { ok: true }
}
