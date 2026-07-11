import ical from 'node-ical'
import type { CalendarCaldavSubscribeInput, CalendarIcsImportResult } from '@shared/calendar'
import { getCalendarSourceById } from './calendar'
import { readSourceSecret, storeSourceSecret } from './calendarCredentials'
import { importParsedIcs } from './calendarIcs'
import { getDb } from './database'

/**
 * CalDAV "subscribe" is read-only: many CalDAV servers (iCloud published calendars, school feeds)
 * expose an ICS document at an https endpoint, optionally behind Basic auth. We fetch that ICS and
 * reuse the ICS importer rather than speaking the full PROPFIND/REPORT protocol — daily-useful, no
 * heavy deps. Credentials are encrypted via safeStorage, never written to SQLite in plaintext.
 */

function normalizeCaldavUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim().replace(/^webcal:\/\//i, 'https://')
  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only https (or webcal) CalDAV URLs are supported')
  }
  return parsed
}

async function fetchIcsText(
  url: string,
  username?: string,
  password?: string
): Promise<string> {
  const headers: Record<string, string> = { Accept: 'text/calendar, */*' }
  if (username) {
    const token = Buffer.from(`${username}:${password ?? ''}`).toString('base64')
    headers.Authorization = `Basic ${token}`
  }
  const response = await fetch(url, { headers, redirect: 'follow' })
  if (response.status === 401) {
    throw new Error('CalDAV server rejected the username or password')
  }
  if (!response.ok) {
    throw new Error(`CalDAV fetch failed (${response.status})`)
  }
  return response.text()
}

export async function subscribeCaldav(
  input: CalendarCaldavSubscribeInput
): Promise<CalendarIcsImportResult> {
  const parsedUrl = normalizeCaldavUrl(input.url)
  const username = input.username?.trim() || undefined
  const password = input.password && input.password.length > 0 ? input.password : undefined

  const text = await fetchIcsText(parsedUrl.toString(), username, password)
  const parsed = ical.sync.parseICS(text)
  const label = input.label?.trim() || parsedUrl.hostname
  const config: Record<string, string> = { url: parsedUrl.toString() }
  if (username) config.username = username

  const result = importParsedIcs(parsed, label, config, undefined, 'caldav')

  if (username || password) {
    storeSourceSecret(result.sourceId, JSON.stringify({ username, password }))
  }

  return result
}

export async function syncCaldavSource(sourceId: string): Promise<CalendarIcsImportResult> {
  const source = getCalendarSourceById(sourceId)
  if (!source || source.kind !== 'caldav') {
    throw new Error('CalDAV calendar source not found')
  }

  const config = JSON.parse(source.configJson) as { url?: string; username?: string }
  const url = config.url?.trim()
  if (!url) {
    throw new Error('CalDAV source has no URL — subscribe again in Settings')
  }

  let username = config.username
  let password: string | undefined
  const secret = readSourceSecret(sourceId)
  if (secret) {
    try {
      const parsedSecret = JSON.parse(secret) as { username?: string; password?: string }
      username = parsedSecret.username ?? username
      password = parsedSecret.password
    } catch {
      // ignore malformed secret — proceed unauthenticated
    }
  }

  try {
    const text = await fetchIcsText(url, username, password)
    const parsed = ical.sync.parseICS(text)
    const result = importParsedIcs(parsed, source.label, config, sourceId, 'caldav')
    getDb().prepare('UPDATE calendar_sources SET stale = 0 WHERE id = ?').run(sourceId)
    return result
  } catch (err) {
    getDb().prepare('UPDATE calendar_sources SET stale = 1 WHERE id = ?').run(sourceId)
    throw err
  }
}
