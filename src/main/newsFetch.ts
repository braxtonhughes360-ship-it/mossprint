/** RSS / Atom fetch + lightweight XML parse — main process only. */

import { looksLikeFeedUrl } from '@shared/newsBundles'

export interface ParsedFeedEntry {
  externalId: string
  title: string
  url: string
  summary: string
  imageUrl: string
  publishedAt: string
}

export interface ParsedFeedMeta {
  title: string
  etag: string | null
  lastModified: string | null
}

const MOSS_USER_AGENT = 'MOSS/0.1 (+https://github.com/statezero/moss)'
const FETCH_TIMEOUT_MS = 30_000

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

/** AP shut down official RSS — legacy URLs map to hub pages we scrape. */
const AP_LEGACY_RSS_TO_HUB: Record<string, string> = {
  'https://feeds.apnews.com/rss/apf-topnews': 'https://apnews.com/apf-topnews',
  'https://feeds.apnews.com/rss/apf-business': 'https://apnews.com/business',
  'https://feeds.apnews.com/rss/apf-sports': 'https://apnews.com/sports',
  'https://feeds.apnews.com/rss/apf-science': 'https://apnews.com/science'
}

function resolveApNewsHubUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  const legacy = AP_LEGACY_RSS_TO_HUB[trimmed]
  if (legacy) return legacy

  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
    if (host === 'feeds.apnews.com') {
      const key = `https://feeds.apnews.com${parsed.pathname.replace(/\/$/, '')}`
      return AP_LEGACY_RSS_TO_HUB[key] ?? null
    }
    if (host === 'apnews.com') return parsed.toString()
  } catch {
    return null
  }
  return null
}

function parseApNewsHubHtml(html: string): ParsedFeedEntry[] {
  const seen = new Set<string>()
  const entries: ParsedFeedEntry[] = []
  const pattern =
    /<a[^>]+href=['"]?(https:\/\/apnews\.com\/article\/[^'">\s]+|\/article\/[^'">\s]+)['"]?[^>]*>([^<]{12,240})<\/a>/gi

  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null && entries.length < 25) {
    let url = match[1]!.trim()
    if (url.startsWith('/')) url = `https://apnews.com${url}`
    if (seen.has(url)) continue
    seen.add(url)

    const title = decodeXmlEntities(match[2]!.replace(/\s+/g, ' ').trim())
    if (!title) continue

    const slug = url.split('/').pop() ?? url
    entries.push({
      externalId: slug,
      title,
      url,
      summary: briefApSummary(title),
      imageUrl: '',
      publishedAt: new Date().toISOString()
    })
  }

  return entries
}

function briefApSummary(title: string): string {
  return title.length > 120 ? `${title.slice(0, 117)}…` : title
}

async function fetchApNewsHub(hubUrl: string): Promise<ParsedFeedEntry[]> {
  const response = await fetchWithTimeout(hubUrl, {
    headers: {
      'User-Agent': MOSS_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow'
  })
  if (!response.ok) {
    throw new Error(`AP News fetch failed (${response.status})`)
  }
  const html = await response.text()
  const entries = parseApNewsHubHtml(html)
  if (entries.length === 0) {
    throw new Error('AP News page had no headlines')
  }
  return entries
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”'
}

function decodeXmlEntities(text: string): string {
  return (
    text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      // Numeric character references — decimal (&#8217;) and hex (&#x2019;).
      .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      // Named references — &amp; intentionally last so it can't re-trigger others.
      .replace(/&(nbsp|hellip|mdash|ndash|lsquo|rsquo|ldquo|rdquo|quot|apos|lt|gt|amp);/g, (_m, name: string) => NAMED_ENTITIES[name] ?? _m)
  )
}

/** Width we ask resizable CDNs for — crisp as a hero, downscales cleanly to a thumb. */
const IMG_TARGET_WIDTH = 960

/**
 * Normalize a feed image URL for display: decode HTML entities (feeds emit
 * `&#038;` / `&amp;` inside `<img src>`), and bump known low-res CDN URLs to a
 * sharp width so the dashboard hero isn't a blurry upscale. Idempotent and
 * conservative — only rewrites unsigned size tokens we know are safe.
 */
export function upgradeImageUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl
  let url = decodeXmlEntities(rawUrl).trim()

  // BBC iChef: width lives unsigned in the path (e.g. /ace/standard/240/ or
  // /news/240/) — the feed ships 240px, far too small for the lead hero.
  url = url.replace(
    /(\/\/ichef\.bbci\.co\.uk\/(?:ace\/standard|news)\/)\d+(\/)/i,
    `$1${IMG_TARGET_WIDTH}$2`
  )
  // BBC iChef alt form: /images/ic/240x135/ — keep the aspect ratio.
  url = url.replace(
    /(\/\/ichef\.bbci\.co\.uk\/images\/ic\/)(\d+)x(\d+)(\/)/i,
    (_m, pre: string, w: string, h: string, post: string) => {
      const width = Number(w)
      const height = Number(h)
      if (!width || !height) return `${pre}${w}x${h}${post}`
      const scaledH = Math.round((height * IMG_TARGET_WIDTH) / width)
      return `${pre}${IMG_TARGET_WIDTH}x${scaledH}${post}`
    }
  )
  return url
}

function stripTags(text: string): string {
  // Unwrap CDATA FIRST. A CDATA block has no '>' inside, so the tag regex below
  // would otherwise swallow the whole `<![CDATA[...]]>` (content included) — this
  // is why Atom `<title type="html"><![CDATA[…]]></title>` came back empty.
  const unwrapped = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
  return decodeXmlEntities(unwrapped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!match) return null
  return stripTags(match[1])
}

function normalizeImageUrl(raw: string | null | undefined, baseUrl?: string): string | null {
  if (!raw?.trim()) return null
  try {
    const url = new URL(raw.trim(), baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function isImageType(type: string | null | undefined): boolean {
  if (!type) return false
  return type.startsWith('image/') || type === 'image'
}

function extractImageFromBlock(block: string, itemUrl?: string): string | null {
  const attrUrl = (tag: string, attr = 'url'): string | null => {
    const match = block.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["']`, 'i'))
    return match?.[1]?.trim() ?? null
  }

  const mediaContent = block.match(/<media:content\b[^>]*>/i)?.[0]
  if (mediaContent) {
    const medium = mediaContent.match(/\bmedium=["']([^"']+)["']/i)?.[1]
    const type = mediaContent.match(/\btype=["']([^"']+)["']/i)?.[1]
    if (!medium || medium === 'image' || isImageType(type)) {
      const url = normalizeImageUrl(attrUrl('media:content'), itemUrl)
      if (url) return url
    }
  }

  const mediaThumb = normalizeImageUrl(attrUrl('media:thumbnail'), itemUrl)
  if (mediaThumb) return mediaThumb

  const enclosure = block.match(/<enclosure\b[^>]*>/i)?.[0]
  if (enclosure) {
    const type = enclosure.match(/\btype=["']([^"']+)["']/i)?.[1]
    if (isImageType(type)) {
      const url = normalizeImageUrl(
        enclosure.match(/\burl=["']([^"']+)["']/i)?.[1],
        itemUrl
      )
      if (url) return url
    }
  }

  // Walk every <img> and take the first real one — feeds (NPR, many others)
  // embed a 1×1 tracking beacon as the first <img> in the description HTML.
  const imgTags = block.match(/<img\b[^>]*>/gi) ?? []
  for (const tag of imgTags) {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]
    if (!src || isLikelyTrackingPixel(tag, src)) continue
    const url = normalizeImageUrl(src, itemUrl)
    if (url) return url
  }

  return null
}

/** Skip 1×1 beacons and known pixel/tracking image URLs (NPR rss-pixel, etc.). */
function isLikelyTrackingPixel(imgTag: string, src: string): boolean {
  if (/\b(?:width|height)\s*=\s*["']?1(?:px)?["']?(?:\s|\/|>|$)/i.test(imgTag)) return true
  return /pixel|\/track(?:ing)?[./]|doubleclick|feedburner|\bstats?\./i.test(src)
}

/** Human-readable source name from a feed URL, e.g. rss.nytimes.com → "Nytimes". */
export function deriveSourceName(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname
      .replace(/^www\./, '')
      .replace(/^(rss|feeds?|news)\./, '')
    const base = host.split('.')[0]
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'News'
  } catch {
    return 'News'
  }
}

/**
 * Feed/channel title from the header only — scoped before the first item/entry
 * so we never grab an article's <title>. Returns null when empty/whitespace.
 */
function extractChannelTitle(xml: string): string | null {
  const firstEntry = xml.search(/<(item|entry)[\s>]/i)
  const head = firstEntry >= 0 ? xml.slice(0, firstEntry) : xml
  const raw = extractTag(head, 'title')?.trim()
  return raw && raw.length > 0 ? raw : null
}

function extractAtomLink(block: string): string | null {
  const alternate = block.match(
    /<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i
  )
  if (alternate?.[1]) return alternate[1].trim()

  const href = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)
  return href?.[1]?.trim() ?? null
}

function parseRssItems(xml: string): ParsedFeedEntry[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  const entries: ParsedFeedEntry[] = []

  for (const block of items) {
    const title = extractTag(block, 'title') ?? 'Untitled'
    const link = extractTag(block, 'link') ?? extractAtomLink(block)
    if (!link) continue

    const guid = extractTag(block, 'guid') ?? link
    const pubDate = extractTag(block, 'pubDate')
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
    const summary = extractTag(block, 'description') ?? ''
    const imageUrl = upgradeImageUrl(extractImageFromBlock(block, link) ?? '')

    entries.push({
      externalId: guid,
      title,
      url: link,
      summary: summary.slice(0, 500),
      imageUrl,
      publishedAt
    })
  }

  return entries
}

function parseAtomEntries(xml: string): ParsedFeedEntry[] {
  const blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  const entries: ParsedFeedEntry[] = []

  for (const block of blocks) {
    const title = extractTag(block, 'title') ?? 'Untitled'
    const link = extractAtomLink(block) ?? extractTag(block, 'id')
    if (!link) continue

    const externalId = extractTag(block, 'id') ?? link
    const updated = extractTag(block, 'updated') ?? extractTag(block, 'published')
    const publishedAt = updated ? new Date(updated).toISOString() : new Date().toISOString()
    const summary =
      extractTag(block, 'summary') ?? extractTag(block, 'content') ?? ''
    const imageUrl = upgradeImageUrl(extractImageFromBlock(block, link) ?? '')

    entries.push({
      externalId,
      title,
      url: link,
      summary: summary.slice(0, 500),
      imageUrl,
      publishedAt
    })
  }

  return entries
}

export function parseFeedXml(
  xml: string,
  sourceUrl = ''
): { meta: ParsedFeedMeta; entries: ParsedFeedEntry[] } {
  const channelTitle = extractChannelTitle(xml) ?? (sourceUrl ? deriveSourceName(sourceUrl) : '')
  const isAtom = /<feed[\s>]/i.test(xml)
  const entries = isAtom ? parseAtomEntries(xml) : parseRssItems(xml)

  return {
    meta: {
      title: channelTitle,
      etag: null,
      lastModified: null
    },
    entries
  }
}

export async function fetchFeedDocument(
  url: string,
  headers: { etag?: string | null; lastModified?: string | null } = {}
): Promise<{ xml: string; etag: string | null; lastModified: string | null }> {
  const requestHeaders: Record<string, string> = {
    'User-Agent': MOSS_USER_AGENT,
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
  }
  if (headers.etag) requestHeaders['If-None-Match'] = headers.etag
  if (headers.lastModified) requestHeaders['If-Modified-Since'] = headers.lastModified

  const response = await fetchWithTimeout(url, { headers: requestHeaders, redirect: 'follow' })
  if (response.status === 304) {
    return { xml: '', etag: headers.etag ?? null, lastModified: headers.lastModified ?? null }
  }

  if (!response.ok) {
    throw new Error(`Feed fetch failed (${response.status})`)
  }

  const xml = await response.text()
  return {
    xml,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified')
  }
}

function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('URL is required')
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function resolveAbsoluteUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw.trim(), baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function extractFeedLinksFromHtml(html: string, baseUrl: string): string[] {
  const links: string[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? ''
    const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? ''
    const isAlternate = rel.split(/\s+/).includes('alternate')
    const isFeedType =
      type.includes('rss') || type.includes('atom') || type.includes('xml')
    if (!isAlternate && !isFeedType) continue
    if (isAlternate && type && !isFeedType) continue

    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    const resolved = resolveAbsoluteUrl(href, baseUrl)
    if (!resolved) continue
    if (isFeedType || isAlternate || /\.(rss|xml|atom)(\?|$)/i.test(resolved)) {
      links.push(resolved)
    }
  }
  return Array.from(new Set(links))
}

const FEED_PATH_GUESSES = [
  '/feed',
  '/feed/',
  '/rss',
  '/rss.xml',
  '/rss/',
  '/atom.xml',
  '/feeds/rss.xml',
  '/index.xml'
]

function looksLikeFeedXml(xml: string): boolean {
  return /<rss[\s>]/i.test(xml) || /<feed[\s>]/i.test(xml)
}

/**
 * Resolve a pasted website or feed URL to an RSS/Atom feed URL.
 * Direct feed URLs pass through; bare domains discover via `<link rel="alternate">`
 * and common path guesses.
 */
export async function discoverFeedUrl(raw: string): Promise<string> {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('URL is required')

  const apHub = resolveApNewsHubUrl(trimmed)
  if (apHub) return apHub

  if (looksLikeFeedUrl(trimmed)) {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Feed URL must use http or https')
    }
    return url.toString()
  }

  const siteUrl = normalizeWebsiteUrl(trimmed)
  let html = ''
  try {
    const response = await fetchWithTimeout(siteUrl, {
      headers: {
        'User-Agent': MOSS_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
      },
      redirect: 'follow'
    })
    if (!response.ok) {
      throw new Error(`Could not reach site (${response.status})`)
    }
    html = await response.text()
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Could not reach site')
  }

  const fromHead = extractFeedLinksFromHtml(html, siteUrl)
  if (fromHead.length > 0) return fromHead[0]!

  const origin = new URL(siteUrl).origin
  for (const path of FEED_PATH_GUESSES) {
    const guess = `${origin}${path}`
    try {
      const { xml } = await fetchFeedDocument(guess)
      if (xml && looksLikeFeedXml(xml)) return guess
    } catch {
      // try next guess
    }
  }

  throw new Error('No RSS or Atom feed found on that site')
}

export async function fetchAndParseFeed(
  url: string,
  headers: { etag?: string | null; lastModified?: string | null } = {}
): Promise<{ meta: ParsedFeedMeta; entries: ParsedFeedEntry[]; notModified: boolean }> {
  const apHub = resolveApNewsHubUrl(url)
  if (apHub) {
    const entries = await fetchApNewsHub(apHub)
    return {
      meta: { title: deriveSourceName(apHub), etag: null, lastModified: null },
      entries,
      notModified: false
    }
  }

  const { xml, etag, lastModified } = await fetchFeedDocument(url, headers)
  if (!xml) {
    // 304 Not Modified — no document. Empty title signals "keep existing name".
    return {
      meta: { title: '', etag, lastModified },
      entries: [],
      notModified: true
    }
  }

  const parsed = parseFeedXml(xml, url)
  const entries = [...parsed.entries].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )

  return {
    meta: { title: parsed.meta.title, etag, lastModified },
    entries: entries.slice(0, 25),
    notModified: false
  }
}
