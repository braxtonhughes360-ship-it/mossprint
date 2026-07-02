import {
  PROFILE_AVATAR_COLORS,
  avatarColorFromString,
  type ProfileAvatarColor
} from './profiles'

/** Strip bank noise and normalize for substring merchant matching. */
export function normalizePayeeForMatch(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bsq\s*\*?\s*/g, ' ')
    .replace(/\btst\s*\*?\s*/g, ' ')
    .replace(/\bpaypal\s*\*?\s*/g, ' ')
    .replace(/\bvenmo\s*\*?\s*/g, ' ')
    .replace(/\bpos\s+(debit|purchase)\b/g, ' ')
    .replace(/\b(check|debit|credit)\s*card\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Deterministic initials — same rules as profile avatars. */
export function merchantMonogram(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

export interface MerchantBrandEntry {
  /** Basename of bundled SVG in `/merchant-icons/`. */
  icon: string
  keywords: readonly string[]
}

/**
 * Curated US merchants — matched by normalized payee substring (longest keyword wins).
 * Icons are bundled offline under `src/renderer/public/merchant-icons/` (Simple Icons MIT).
 */
export const MERCHANT_BRANDS: readonly MerchantBrandEntry[] = [
  { icon: 'amazon.svg', keywords: ['amazon', 'amzn', 'amz mktpl', 'prime video', 'audible'] },
  { icon: 'walmart.svg', keywords: ['walmart', 'wal mart', 'wal-mart'] },
  { icon: 'target.svg', keywords: ['target'] },
  { icon: 'costco.svg', keywords: ['costco', 'costco whse'] },
  { icon: 'netflix.svg', keywords: ['netflix'] },
  { icon: 'spotify.svg', keywords: ['spotify'] },
  { icon: 'uber.svg', keywords: ['uber eats', 'ubereats', 'uber'] },
  { icon: 'lyft.svg', keywords: ['lyft'] },
  { icon: 'shell.svg', keywords: ['shell oil', 'shell'] },
  { icon: 'chevron.svg', keywords: ['chevron'] },
  { icon: 'exxonmobil.svg', keywords: ['exxon', 'exxonmobil', 'mobil gas'] },
  { icon: 'bp.svg', keywords: ['bp gas', ' bp '] },
  {
    icon: 'utility-electric.svg',
    keywords: [
      'electric',
      'electric bill',
      'city power',
      'power co',
      'power company',
      'energy',
      'utility',
      'pge',
      'pg&e',
      'con ed',
      'coned',
      'duke energy',
      'dominion',
      'edison',
      'sce ',
      'sdge',
      'national grid',
      'xcel energy',
      'entergy'
    ]
  },
  { icon: 'traderjoes.svg', keywords: ['trader joe', 'traderjoes'] },
  { icon: 'starbucks.svg', keywords: ['starbucks', 'sbux'] },
  { icon: 'apple.svg', keywords: ['apple com', 'apple store', 'apple'] },
  { icon: 'google.svg', keywords: ['google', 'goog'] },
  { icon: 'microsoft.svg', keywords: ['microsoft', 'msft', 'xbox'] },
  { icon: 'mcdonalds.svg', keywords: ['mcdonald', 'mcdonalds', 'mcd'] },
  { icon: 'chipotle.svg', keywords: ['chipotle', 'cmg'] },
  { icon: 'doordash.svg', keywords: ['doordash', 'door dash'] },
  { icon: 'instacart.svg', keywords: ['instacart'] },
  { icon: 'cvs.svg', keywords: ['cvs', 'cvs pharmacy'] },
  { icon: 'walgreens.svg', keywords: ['walgreens', 'walgreen'] },
  { icon: 'homedepot.svg', keywords: ['home depot', 'homedepot'] },
  { icon: 'lowes.svg', keywords: ['lowes', 'lowe s'] },
  { icon: 'bestbuy.svg', keywords: ['best buy', 'bestbuy'] },
  { icon: 'nike.svg', keywords: ['nike'] },
  { icon: 'adidas.svg', keywords: ['adidas'] },
  { icon: 'paypal.svg', keywords: ['paypal'] },
  { icon: 'venmo.svg', keywords: ['venmo'] },
  { icon: 'zelle.svg', keywords: ['zelle'] },
  { icon: 'cashapp.svg', keywords: ['cash app', 'cashapp', 'square cash'] },
  { icon: 'chase.svg', keywords: ['chase bank', 'jpmorgan chase', 'chase'] },
  { icon: 'bankofamerica.svg', keywords: ['bank of america', 'bofa'] },
  { icon: 'wellsfargo.svg', keywords: ['wells fargo', 'wellsfargo'] },
  { icon: 'americanexpress.svg', keywords: ['american express', 'amex'] },
  { icon: 'capitalone.svg', keywords: ['capital one', 'capitalone'] },
  { icon: 'wholefoodsmarket.svg', keywords: ['whole foods', 'wholefoods', 'wfm'] },
  { icon: 'kroger.svg', keywords: ['kroger'] },
  { icon: 'safeway.svg', keywords: ['safeway'] },
  { icon: 'publix.svg', keywords: ['publix'] },
  { icon: 'aldi.svg', keywords: ['aldi'] },
  { icon: 'heb.svg', keywords: ['h e b', 'heb'] },
  { icon: 'dunkin.svg', keywords: ['dunkin', 'dunkin donuts'] },
  { icon: 'dominos.svg', keywords: ['domino', 'dominos'] },
  { icon: 'subway.svg', keywords: ['subway'] },
  { icon: 'tacobell.svg', keywords: ['taco bell', 'tacobell'] },
  { icon: 'wendys.svg', keywords: ['wendy', 'wendys'] },
  { icon: 'burgerking.svg', keywords: ['burger king', 'burgerking'] },
  { icon: 'pizzahut.svg', keywords: ['pizza hut', 'pizzahut'] },
  { icon: 'airbnb.svg', keywords: ['airbnb'] },
  { icon: 'delta.svg', keywords: ['delta air', 'delta airlines', 'delta'] },
  { icon: 'southwestairlines.svg', keywords: ['southwest air', 'southwest'] },
  { icon: 'unitedairlines.svg', keywords: ['united air', 'united airlines', 'united'] },
  { icon: 'att.svg', keywords: ['at t', 'att'] },
  { icon: 'verizon.svg', keywords: ['verizon'] },
  { icon: 'comcast.svg', keywords: ['comcast', 'xfinity'] },
  { icon: 'disneyplus.svg', keywords: ['disney plus', 'disneyplus', 'disney'] },
  { icon: 'hulu.svg', keywords: ['hulu'] },
  { icon: 'hbo.svg', keywords: ['hbo max', 'hbo'] },
  { icon: 'peacock.svg', keywords: ['peacock'] },
  { icon: 'paramountplus.svg', keywords: ['paramount plus', 'paramountplus', 'paramount'] },
  { icon: 'youtube.svg', keywords: ['youtube', 'yt premium'] },
  { icon: 'twitch.svg', keywords: ['twitch'] },
  { icon: 'primevideo.svg', keywords: ['prime video', 'primevideo'] },
  { icon: 'steam.svg', keywords: ['steam'] },
  { icon: 'playstation.svg', keywords: ['playstation', 'psn', 'sony playstation'] },
  { icon: 'xbox.svg', keywords: ['xbox'] },
  { icon: 'tesla.svg', keywords: ['tesla'] },
  { icon: 'ebay.svg', keywords: ['ebay'] },
  { icon: 'etsy.svg', keywords: ['etsy'] },
  { icon: 'shopify.svg', keywords: ['shopify'] },
  { icon: 'stripe.svg', keywords: ['stripe'] },
  { icon: 'coinbase.svg', keywords: ['coinbase'] },
  { icon: 'openai.svg', keywords: ['openai', 'chatgpt'] },
  { icon: 'meta.svg', keywords: ['meta pay', 'facebook', 'meta'] },
  { icon: 'tiktok.svg', keywords: ['tiktok'] },
  { icon: 'usps.svg', keywords: ['usps', 'post office'] },
  { icon: 'ups.svg', keywords: [' ups ', 'ups store'] },
  { icon: 'fedex.svg', keywords: ['fedex', 'fed ex'] },
  { icon: 'geico.svg', keywords: ['geico'] },
  { icon: 'progressive.svg', keywords: ['progressive ins', 'progressive'] },
  { icon: 'statefarm.svg', keywords: ['state farm', 'statefarm'] },
  { icon: 'affirm.svg', keywords: ['affirm'] },
  { icon: 'klarna.svg', keywords: ['klarna'] },
  { icon: 'afterpay.svg', keywords: ['afterpay', 'after pay'] }
]

const BUNDLED_MERCHANT_ICONS = new Set(
  MERCHANT_BRANDS.map((brand) => brand.icon).filter((icon) => icon.endsWith('.svg'))
)

export interface MerchantChipResolved {
  label: string
  monogram: string
  color: ProfileAvatarColor
  iconUrl: string | null
}

export function resolveMerchantChip(payeeRaw: string): MerchantChipResolved {
  const label = payeeRaw.trim() || '?'
  const normalized = normalizePayeeForMatch(label)
  const monogram = merchantMonogram(label)
  const color = avatarColorFromString(normalized || label)

  let best: { icon: string; score: number } | null = null
  for (const brand of MERCHANT_BRANDS) {
    if (!BUNDLED_MERCHANT_ICONS.has(brand.icon)) continue
    for (const keyword of brand.keywords) {
      if (!normalized.includes(keyword)) continue
      const score = keyword.length
      if (!best || score > best.score) {
        best = { icon: brand.icon, score }
      }
    }
  }

  return {
    label,
    monogram,
    color,
    iconUrl: best ? `/merchant-icons/${best.icon}` : null
  }
}

export { PROFILE_AVATAR_COLORS, avatarColorFromString, type ProfileAvatarColor }
