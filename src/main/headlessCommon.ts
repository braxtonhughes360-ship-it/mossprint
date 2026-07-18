import { activateProfile, createProfile, initializeProfiles, listProfiles } from './profiles'

export async function initHeadlessProfile(): Promise<void> {
  // Isolated userData (see headlessProfile.ts) — never wipe or touch real operator profiles.
  initializeProfiles()
  let profileId = listProfiles()[0]?.id
  if (!profileId) {
    profileId = createProfile({ displayName: 'Healthcheck' }).profile.id
  }
  const result = await activateProfile(profileId, undefined, { bypassPassword: true })
  if (!result.ok) {
    throw new Error(result.message ?? 'Failed to open headless profile database')
  }
}

const NEWS_WIDGET_SHOT_SOURCES = [
  {
    url: 'https://shot-seed.invalid/bbc.xml',
    title: 'BBC News',
    category: 'national'
  },
  {
    url: 'https://shot-seed.invalid/local.xml',
    title: 'Seattle Times',
    category: 'local'
  }
] as const

/** Deterministic fake briefing for screenshot runs — never real feed data. */
export async function seedShotNewsItems(): Promise<void> {
  const { randomUUID } = await import('node:crypto')
  const { getDb } = await import('./database')
  const { addNewsSource, deleteNewsSource, listNewsSources } = await import('./news')

  for (const seed of NEWS_WIDGET_SHOT_SOURCES) {
    const stale = listNewsSources().find((source) => source.url === seed.url)
    if (stale) deleteNewsSource(stale.id)
  }

  const now = Date.now()
  const fetchedAt = new Date(now - 12 * 60000).toISOString()
  const national = await addNewsSource({ ...NEWS_WIDGET_SHOT_SOURCES[0] })
  const local = await addNewsSource({ ...NEWS_WIDGET_SHOT_SOURCES[1] })

  getDb()
    .prepare('UPDATE news_sources SET last_fetched_at = ? WHERE id IN (?, ?)')
    .run(fetchedAt, national.id, local.id)

  const insertItem = (
    sourceId: string,
    externalId: string,
    title: string,
    summary: string,
    minutesAgo: number,
    imageUrl = ''
  ): void => {
    const publishedAt = new Date(now - minutesAgo * 60000).toISOString()
    getDb()
      .prepare(
        `INSERT INTO news_items (
           id, source_id, external_id, title, url, summary, image_url, published_at, read_at, created_at
         ) VALUES (
           @id, @sourceId, @externalId, @title, @url, @summary, @imageUrl, @publishedAt, NULL, @createdAt
         )`
      )
      .run({
        id: randomUUID(),
        sourceId,
        externalId,
        title,
        url: `https://shot-seed.invalid/${externalId}`,
        summary,
        imageUrl,
        publishedAt,
        createdAt: fetchedAt
      })
  }

  const heroImage =
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80'
  const thumbA =
    'https://images.unsplash.com/photo-1529107386315-d1caf5642164?auto=format&fit=crop&w=240&q=80'
  const thumbB =
    'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=240&q=80'
  const thumbC =
    'https://images.unsplash.com/photo-1514567171-4270ef7985c4?auto=format&fit=crop&w=240&q=80'
  const thumbD =
    'https://images.unsplash.com/photo-1527482790664-8c457e228969?auto=format&fit=crop&w=240&q=80'

  insertItem(
    national.id,
    'lead-1',
    'Global markets rally as inflation cools faster than forecast',
    'Major indexes closed higher after new data showed price growth easing for a third month.',
    8,
    heroImage
  )
  insertItem(
    national.id,
    'top-2',
    'Congress reaches late deal to avert partial shutdown',
    'Leaders agreed to a short-term funding patch with hours to spare before the deadline.',
    45,
    thumbA
  )
  insertItem(
    national.id,
    'top-3',
    'Tech giants outline new safety rules for AI assistants',
    'The voluntary framework focuses on election integrity and medical advice guardrails.',
    90,
    thumbB
  )
  insertItem(
    local.id,
    'local-1',
    'City council approves expanded light-rail funding plan',
    'The vote clears the way for two new stations and faster evening service downtown.',
    30,
    thumbC
  )
  insertItem(
    local.id,
    'local-2',
    'Weekend storm brings heavy rain; flood watches issued',
    'Emergency crews staged sandbags in low-lying neighborhoods ahead of the front.',
    75,
    thumbD
  )
}
