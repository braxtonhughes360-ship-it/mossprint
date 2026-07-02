import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import type { AddNewsSourceInput, NewsBriefingOptions } from '@shared/news'
import {
  addNewsSource,
  deleteNewsSource,
  getNewsBriefing,
  getNewsDoorSnapshot,
  listNewsItems,
  listNewsSources,
  markNewsItemRead,
  setNewsSourceEnabled,
  syncAllNewsSources,
  syncNewsSource
} from '../news'

function assertAddSourceInput(value: unknown): AddNewsSourceInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid feed input')
  const payload = value as AddNewsSourceInput
  if (typeof payload.url !== 'string' || payload.url.trim().length === 0) {
    throw new Error('Feed URL is required')
  }
  return {
    url: payload.url.trim(),
    title: typeof payload.title === 'string' ? payload.title.trim() : undefined,
    category: typeof payload.category === 'string' ? payload.category.trim() : undefined
  }
}

export function registerNewsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NEWS_LIST_SOURCES, (event) => {
    assertTrustedSender(event)
    return listNewsSources()
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_ADD_SOURCE, async (event, input: unknown) => {
    assertTrustedSender(event)
    return await addNewsSource(assertAddSourceInput(input))
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_DELETE_SOURCE, (event, sourceId: unknown) => {
    assertTrustedSender(event)
    if (typeof sourceId !== 'string' || !sourceId) throw new Error('Invalid source id')
    return deleteNewsSource(sourceId)
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_SET_SOURCE_ENABLED, (event, sourceId: unknown, enabled: unknown) => {
    assertTrustedSender(event)
    if (typeof sourceId !== 'string' || !sourceId) throw new Error('Invalid source id')
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean')
    return setNewsSourceEnabled(sourceId, enabled)
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_SYNC_ALL, async (event) => {
    assertTrustedSender(event)
    return await syncAllNewsSources()
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_SYNC_SOURCE, async (event, sourceId: unknown) => {
    assertTrustedSender(event)
    if (typeof sourceId !== 'string' || !sourceId) throw new Error('Invalid source id')
    return await syncNewsSource(sourceId)
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_LIST_ITEMS, (event, limit?: unknown) => {
    assertTrustedSender(event)
    const safeLimit = typeof limit === 'number' && limit > 0 ? limit : 50
    return listNewsItems(safeLimit)
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_GET_BRIEFING, (event, options?: unknown) => {
    assertTrustedSender(event)
    if (typeof options === 'number' && options > 0) {
      return getNewsBriefing({ maxItems: options })
    }
    if (!options || typeof options !== 'object') {
      return getNewsBriefing({})
    }
    const payload = options as NewsBriefingOptions
    const mode =
      payload.mode === 'latest' || payload.mode === 'priority' || payload.mode === 'balanced'
        ? payload.mode
        : undefined
    const maxItems =
      typeof payload.maxItems === 'number' && payload.maxItems > 0 ? payload.maxItems : undefined
    const maxPerSource =
      typeof payload.maxPerSource === 'number' && payload.maxPerSource > 0
        ? payload.maxPerSource
        : undefined
    const layout =
      payload.layout === 'compact' || payload.layout === 'split' || payload.layout === 'full'
        ? payload.layout
        : undefined
    return getNewsBriefing({ maxItems, mode, maxPerSource, layout })
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_GET_DOOR_SNAPSHOT, (event) => {
    assertTrustedSender(event)
    return getNewsDoorSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.NEWS_MARK_READ, (event, itemId: unknown) => {
    assertTrustedSender(event)
    if (typeof itemId !== 'string' || !itemId) throw new Error('Invalid item id')
    return markNewsItemRead(itemId)
  })
}
