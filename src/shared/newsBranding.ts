/** Outlet logos + source-title → brand resolution for widget and reader. */

import { LOCAL_NEWS_BY_CITY, NEWS_SOURCE_CATALOG } from './newsBundles'

/** High-res favicon from the publisher domain — crisp at widget/reader scale. */
export function faviconLogoUrl(domain: string, size = 64): string {
  const host = domain.replace(/^www\./, '').trim()
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`
}

function domainFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Map a stored source label (e.g. "NYT · Top stories") to a logo URL. */
export function resolveSourceLogoUrl(sourceTitle: string, feedOrArticleUrl?: string): string | null {
  const title = sourceTitle.trim().toLowerCase()
  if (!title) return null

  for (const outlet of NEWS_SOURCE_CATALOG) {
    const name = outlet.name.toLowerCase()
    const mono = outlet.monogram.toLowerCase()
    if (
      title.includes(name) ||
      title.startsWith(`${mono} `) ||
      title.startsWith(`${mono}·`) ||
      title === mono
    ) {
      return faviconLogoUrl(outlet.domain)
    }
  }

  for (const feeds of Object.values(LOCAL_NEWS_BY_CITY)) {
    for (const feed of feeds) {
      const feedTitle = feed.title.toLowerCase()
      if (title === feedTitle || title.includes(feedTitle) || feedTitle.includes(title)) {
        const domain = domainFromUrl(feed.url)
        if (domain) return faviconLogoUrl(domain)
      }
    }
  }

  if (feedOrArticleUrl) {
    const domain = domainFromUrl(feedOrArticleUrl)
    if (domain) return faviconLogoUrl(domain)
  }

  return null
}
