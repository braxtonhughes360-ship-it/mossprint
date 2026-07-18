import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MailAccountRecord, MailListOptions, MailMessageSummary } from '@shared/mail'
import { MAIL_LIST_DEFAULT_LIMIT } from '@shared/mailSyncConstants'
import { InboxPage } from '@renderer/pages/InboxPage'
import { installMossMock } from '../helpers/mossMock'
import { renderWithProviders } from '../helpers/renderWithProviders'

function account(id: string, email: string): MailAccountRecord {
  return {
    id,
    provider: 'gmail',
    authType: 'oauth',
    email,
    label: email,
    imapHost: '',
    lastSyncAt: '2026-07-14T07:00:00.000Z',
    stale: false,
    lastError: null,
    enabled: true,
    createdAt: '2026-07-01T09:00:00.000Z'
  }
}

function message(id: string, accountId: string, subject: string): MailMessageSummary {
  return {
    id,
    accountId,
    accountEmail: accountId === 'acc-1' ? 'one@example.com' : 'two@example.com',
    accountLabel: 'Personal',
    externalId: `ext-${id}`,
    threadId: null,
    folder: 'inbox',
    fromName: 'Ada Lovelace',
    fromEmail: 'ada@example.com',
    toEmails: 'one@example.com',
    subject,
    snippet: 'First lines of the message…',
    receivedAt: '2026-07-14T06:45:00.000Z',
    read: false,
    hasAttachments: false
  }
}

const accounts = [account('acc-1', 'one@example.com'), account('acc-2', 'two@example.com')]
const inboxRows = [
  message('m1', 'acc-1', 'Quarterly plan'),
  message('m2', 'acc-2', 'Lab notes attached')
]

function installMailBridge(): { listMessages: ReturnType<typeof vi.fn> } {
  const listMessages = vi.fn(async (options?: MailListOptions) =>
    options?.accountId
      ? inboxRows.filter((row) => row.accountId === options.accountId)
      : inboxRows
  )
  installMossMock({
    mail: {
      getStatus: async () => ({ configured: true, accounts }),
      listMessages,
      countMessages: async (options?: MailListOptions) =>
        options?.accountId
          ? inboxRows.filter((row) => row.accountId === options.accountId).length
          : inboxRows.length,
      listDrafts: async () => [],
      syncAll: async () => ({ results: [], staleCount: 0 })
    }
  })
  return { listMessages }
}

describe('InboxPage list load + account switch', () => {
  it('loads accounts then the unified list with the default slice options', async () => {
    const { listMessages } = installMailBridge()
    renderWithProviders(<InboxPage />)

    expect(await screen.findByText('Quarterly plan')).toBeTruthy()
    expect(screen.getByText('Lab notes attached')).toBeTruthy()
    expect(screen.getByText('Showing 2 of 2')).toBeTruthy()
    expect(screen.getByText('2 unread')).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'Inbox actions' })).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'Inbox list controls' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Compose' }).classList.contains('moss-button')).toBe(
      true
    )
    expect(listMessages).toHaveBeenCalledWith({
      folder: 'inbox',
      unreadOnly: false,
      accountId: undefined,
      query: undefined,
      limit: MAIL_LIST_DEFAULT_LIMIT
    })
  })

  it('switching the account filter refetches the list scoped to that account', async () => {
    const { listMessages } = installMailBridge()
    renderWithProviders(<InboxPage />)
    await screen.findByText('Quarterly plan')

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Filter by account' }))
    await user.click(await screen.findByRole('option', { name: 'two@example.com' }))

    await waitFor(() =>
      expect(listMessages).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'acc-2' })
      )
    )
    // The refetched slice replaces the unified list.
    expect(await screen.findByText('Lab notes attached')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Quarterly plan')).toBeNull())
    expect(screen.getByText('Showing 1 of 1')).toBeTruthy()
  })

  it('with no accounts connected it lands on the set-up empty state, not an empty list', async () => {
    installMossMock({
      mail: {
        getStatus: async () => ({ configured: true, accounts: [] }),
        listMessages: async () => [],
        countMessages: async () => 0,
        listDrafts: async () => [],
        syncAll: async () => ({ results: [], staleCount: 0 })
      }
    })
    renderWithProviders(<InboxPage />)

    expect(await screen.findByText('Your mail, calm and in one place')).toBeTruthy()
    const connectButton = screen.getByRole('button', { name: 'Connect Gmail' })
    expect(connectButton).toBeTruthy()
    expect(connectButton.closest('.moss-empty-state')).toBeTruthy()
  })
})
