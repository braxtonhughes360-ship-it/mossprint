/** Curated news bundles for Setup Manager — no raw RSS in the default path. */

export interface NewsBundleFeed {
  url: string
  title: string
}

export interface NewsFeedBundle {
  id: string
  label: string
  copy: string
  feeds: NewsBundleFeed[]
}

export const NEWS_FEED_BUNDLES: NewsFeedBundle[] = [
  {
    id: 'national',
    label: 'National top stories',
    copy: 'Headlines from trusted wire services — good morning briefing material.',
    feeds: [
      { url: 'https://feeds.npr.org/1001/rss.xml', title: 'NPR News' },
      { url: 'https://feeds.bbci.co.uk/news/rss.xml', title: 'BBC News' },
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', title: 'NYT Top Stories' }
    ]
  },
  {
    id: 'tech',
    label: 'Tech & gadgets',
    copy: 'Product launches, software, and the internet — without the noise.',
    feeds: [
      { url: 'https://www.theverge.com/rss/index.xml', title: 'The Verge' },
      { url: 'https://feeds.arstechnica.com/arstechnica/index', title: 'Ars Technica' }
    ]
  },
  {
    id: 'sports',
    label: 'Sports scores & news',
    copy: 'Game day headlines when you want them on the dashboard.',
    feeds: [{ url: 'https://www.espn.com/espn/rss/news', title: 'ESPN Top Headlines' }]
  }
]

/**
 * Source-first catalog — pick an outlet, then choose which sections you want from it.
 * Each topic maps to a real RSS feed. Stored source title is "<Outlet> · <Topic>" so the
 * reader and dashboard show provenance. This is the default News onboarding path; raw RSS
 * stays behind "Advanced".
 */
export interface NewsTopicFeed {
  id: string
  label: string
  url: string
  title: string
}

/** Interest chips shown first in Setup — no RSS jargon. */
export type NewsInterestId = 'top' | 'local' | 'tech' | 'sports' | 'business' | 'science'

export interface NewsInterest {
  id: NewsInterestId
  label: string
  copy: string
}

export const NEWS_INTERESTS: NewsInterest[] = [
  { id: 'top', label: 'Top stories', copy: 'Morning briefing from trusted desks' },
  { id: 'local', label: 'Local', copy: 'Your city or neighborhood' },
  { id: 'tech', label: 'Tech', copy: 'Gadgets, software, and the web' },
  { id: 'sports', label: 'Sports', copy: 'Scores and game-day headlines' },
  { id: 'business', label: 'Business', copy: 'Markets, companies, and the economy' },
  { id: 'science', label: 'Science', copy: 'Research, health, and the planet' }
]

/** Section/topic ids on an outlet that match each interest chip. */
export const INTEREST_TOPIC_IDS: Record<Exclude<NewsInterestId, 'local'>, string[]> = {
  top: ['top', 'news', 'world'],
  tech: ['tech', 'technology', 'all'],
  sports: ['sports', 'sport', 'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'ncf', 'ncb', 'top'],
  business: ['business'],
  science: ['science']
}

export interface NewsOutlet {
  id: string
  name: string
  /** Publisher domain for favicon logos — e.g. nytimes.com */
  domain: string
  /** Short badge when logo fails — brand mark, not a URL. */
  monogram: string
  blurb: string
  /** Which interest chips surface this outlet in setup. */
  interests: NewsInterestId[]
  topics: NewsTopicFeed[]
}

export const NEWS_SOURCE_CATALOG: NewsOutlet[] = [
  {
    id: 'nyt',
    name: 'The New York Times',
    domain: 'nytimes.com',
    monogram: 'NYT',
    blurb: 'Editorial heft across desks',
    interests: ['top', 'tech', 'business', 'sports', 'science'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', title: 'NYT · Top stories' },
      { id: 'tech', label: 'Technology', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', title: 'NYT · Technology' },
      { id: 'business', label: 'Business', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', title: 'NYT · Business' },
      { id: 'world', label: 'World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', title: 'NYT · World' },
      { id: 'sports', label: 'Sports', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml', title: 'NYT · Sports' },
      { id: 'science', label: 'Science', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', title: 'NYT · Science' }
    ]
  },
  {
    id: 'bbc',
    name: 'BBC News',
    domain: 'bbc.com',
    monogram: 'BBC',
    blurb: 'Global wire, fast and even',
    interests: ['top', 'tech', 'business', 'science', 'sports'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'https://feeds.bbci.co.uk/news/rss.xml', title: 'BBC · Top stories' },
      { id: 'world', label: 'World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', title: 'BBC · World' },
      { id: 'tech', label: 'Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', title: 'BBC · Technology' },
      { id: 'business', label: 'Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', title: 'BBC · Business' },
      { id: 'science', label: 'Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', title: 'BBC · Science' },
      { id: 'sport', label: 'Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', title: 'BBC · Sport' },
      { id: 'uk', label: 'UK', url: 'https://feeds.bbci.co.uk/news/uk/rss.xml', title: 'BBC · UK' }
    ]
  },
  {
    id: 'npr',
    name: 'NPR',
    domain: 'npr.org',
    monogram: 'NPR',
    blurb: 'Calm, considered public radio',
    interests: ['top', 'tech', 'science'],
    topics: [
      { id: 'news', label: 'Top stories', url: 'https://feeds.npr.org/1001/rss.xml', title: 'NPR · Top stories' },
      { id: 'tech', label: 'Technology', url: 'https://feeds.npr.org/1019/rss.xml', title: 'NPR · Technology' },
      { id: 'science', label: 'Science', url: 'https://feeds.npr.org/1007/rss.xml', title: 'NPR · Science' }
    ]
  },
  {
    id: 'ap',
    name: 'Associated Press',
    domain: 'apnews.com',
    monogram: 'AP',
    blurb: 'Wire headlines, fast and factual',
    interests: ['top', 'business', 'sports', 'science'],
    topics: [
      {
        id: 'top',
        label: 'Top stories',
        url: 'https://apnews.com/apf-topnews',
        title: 'AP · Top stories'
      },
      {
        id: 'business',
        label: 'Business',
        url: 'https://apnews.com/business',
        title: 'AP · Business'
      },
      {
        id: 'sports',
        label: 'Sports',
        url: 'https://apnews.com/sports',
        title: 'AP · Sports'
      },
      {
        id: 'science',
        label: 'Science',
        url: 'https://apnews.com/science',
        title: 'AP · Science'
      }
    ]
  },
  {
    id: 'guardian',
    name: 'The Guardian',
    domain: 'theguardian.com',
    monogram: 'GDN',
    blurb: 'Strong world & culture desks',
    interests: ['top', 'tech', 'sports'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'https://www.theguardian.com/us/rss', title: 'Guardian · Top stories' },
      { id: 'world', label: 'World', url: 'https://www.theguardian.com/world/rss', title: 'Guardian · World' },
      { id: 'tech', label: 'Technology', url: 'https://www.theguardian.com/uk/technology/rss', title: 'Guardian · Technology' },
      { id: 'sport', label: 'Sport', url: 'https://www.theguardian.com/uk/sport/rss', title: 'Guardian · Sport' }
    ]
  },
  {
    id: 'verge',
    name: 'The Verge',
    domain: 'theverge.com',
    monogram: 'VRG',
    blurb: 'Tech, gadgets, and the web',
    interests: ['tech'],
    topics: [
      { id: 'all', label: 'Tech & gadgets', url: 'https://www.theverge.com/rss/index.xml', title: 'The Verge' }
    ]
  },
  {
    id: 'arstechnica',
    name: 'Ars Technica',
    domain: 'arstechnica.com',
    monogram: 'ARS',
    blurb: 'Deep technical reporting',
    interests: ['tech', 'science'],
    topics: [
      { id: 'all', label: 'Tech & science', url: 'https://feeds.arstechnica.com/arstechnica/index', title: 'Ars Technica' }
    ]
  },
  {
    id: 'espn',
    name: 'ESPN',
    domain: 'espn.com',
    monogram: 'ESPN',
    blurb: 'Scores and game-day news',
    interests: ['sports'],
    topics: [
      { id: 'top', label: 'Top headlines', url: 'https://www.espn.com/espn/rss/news', title: 'ESPN · Top headlines' },
      { id: 'nfl', label: 'NFL', url: 'https://www.espn.com/espn/rss/nfl/news', title: 'ESPN · NFL' },
      { id: 'nba', label: 'NBA', url: 'https://www.espn.com/espn/rss/nba/news', title: 'ESPN · NBA' },
      { id: 'mlb', label: 'MLB', url: 'https://www.espn.com/espn/rss/mlb/news', title: 'ESPN · MLB' },
      { id: 'nhl', label: 'NHL', url: 'https://www.espn.com/espn/rss/nhl/news', title: 'ESPN · NHL' },
      { id: 'soccer', label: 'Soccer', url: 'https://www.espn.com/espn/rss/soccer/news', title: 'ESPN · Soccer' },
      { id: 'ncf', label: 'College football', url: 'https://www.espn.com/espn/rss/ncf/news', title: 'ESPN · College football' },
      { id: 'ncb', label: 'College basketball', url: 'https://www.espn.com/espn/rss/ncb/news', title: 'ESPN · College basketball' }
    ]
  },
  {
    id: 'cnn',
    name: 'CNN',
    domain: 'cnn.com',
    monogram: 'CNN',
    blurb: 'Breaking news around the clock',
    interests: ['top', 'business'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'http://rss.cnn.com/rss/cnn_topstories.rss', title: 'CNN · Top stories' },
      { id: 'world', label: 'World', url: 'http://rss.cnn.com/rss/cnn_world.rss', title: 'CNN · World' },
      { id: 'business', label: 'Business', url: 'http://rss.cnn.com/rss/money_latest.rss', title: 'CNN · Business' }
    ]
  },
  {
    id: 'reuters',
    name: 'Reuters',
    domain: 'reuters.com',
    monogram: 'RTR',
    blurb: 'Global wire — fast and factual',
    interests: ['top', 'business'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'https://feeds.reuters.com/reuters/topNews', title: 'Reuters · Top stories' },
      { id: 'world', label: 'World', url: 'https://feeds.reuters.com/Reuters/worldNews', title: 'Reuters · World' },
      { id: 'business', label: 'Business', url: 'https://feeds.reuters.com/reuters/businessNews', title: 'Reuters · Business' }
    ]
  },
  {
    id: 'wapo',
    name: 'The Washington Post',
    domain: 'washingtonpost.com',
    monogram: 'WaPo',
    blurb: 'Politics and national reporting',
    interests: ['top', 'business', 'science'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'https://feeds.washingtonpost.com/rss/national', title: 'WaPo · National' },
      { id: 'world', label: 'World', url: 'https://feeds.washingtonpost.com/rss/world', title: 'WaPo · World' },
      { id: 'business', label: 'Business', url: 'https://feeds.washingtonpost.com/rss/business', title: 'WaPo · Business' }
    ]
  },
  {
    id: 'wsj',
    name: 'The Wall Street Journal',
    domain: 'wsj.com',
    monogram: 'WSJ',
    blurb: 'Markets and business depth',
    interests: ['business', 'top'],
    topics: [
      { id: 'top', label: 'World news', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', title: 'WSJ · World' },
      { id: 'business', label: 'Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', title: 'WSJ · Markets' }
    ]
  },
  {
    id: 'bloomberg',
    name: 'Bloomberg',
    domain: 'bloomberg.com',
    monogram: 'BBG',
    blurb: 'Markets and the economy',
    interests: ['business'],
    topics: [
      { id: 'business', label: 'Markets', url: 'https://feeds.bloomberg.com/markets/news.rss', title: 'Bloomberg · Markets' },
      { id: 'top', label: 'Top stories', url: 'https://feeds.bloomberg.com/politics/news.rss', title: 'Bloomberg · Politics' }
    ]
  },
  {
    id: 'politico',
    name: 'Politico',
    domain: 'politico.com',
    monogram: 'POL',
    blurb: 'Politics and policy',
    interests: ['top'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'https://rss.politico.com/politics-news.xml', title: 'Politico · Politics' }
    ]
  },
  {
    id: 'usatoday',
    name: 'USA Today',
    domain: 'usatoday.com',
    monogram: 'USA',
    blurb: 'National headlines, plain and fast',
    interests: ['top', 'sports'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'https://rssfeeds.usatoday.com/usatoday-NewsTopStories', title: 'USA Today · Top stories' },
      { id: 'sports', label: 'Sports', url: 'https://rssfeeds.usatoday.com/UsatodaycomSports-TopStories', title: 'USA Today · Sports' }
    ]
  },
  {
    id: 'cbs',
    name: 'CBS News',
    domain: 'cbsnews.com',
    monogram: 'CBS',
    blurb: 'Broadcast news desk',
    interests: ['top', 'science'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'https://www.cbsnews.com/latest/rss/main', title: 'CBS · Top stories' },
      { id: 'science', label: 'Health & science', url: 'https://www.cbsnews.com/latest/rss/health', title: 'CBS · Health' }
    ]
  },
  {
    id: 'nbc',
    name: 'NBC News',
    domain: 'nbcnews.com',
    monogram: 'NBC',
    blurb: 'National and breaking news',
    interests: ['top'],
    topics: [
      { id: 'top', label: 'Top stories', url: 'https://feeds.nbcnews.com/nbcnews/public/news', title: 'NBC · Top stories' }
    ]
  },
  {
    id: 'wired',
    name: 'Wired',
    domain: 'wired.com',
    monogram: 'WIR',
    blurb: 'Tech culture and the future',
    interests: ['tech', 'science'],
    topics: [
      { id: 'all', label: 'Tech & science', url: 'https://www.wired.com/feed/rss', title: 'Wired' }
    ]
  },
  {
    id: 'techcrunch',
    name: 'TechCrunch',
    domain: 'techcrunch.com',
    monogram: 'TC',
    blurb: 'Startups and Silicon Valley',
    interests: ['tech', 'business'],
    topics: [
      { id: 'all', label: 'Tech & startups', url: 'https://techcrunch.com/feed/', title: 'TechCrunch' }
    ]
  },
  {
    id: 'marketwatch',
    name: 'MarketWatch',
    domain: 'marketwatch.com',
    monogram: 'MW',
    blurb: 'Markets and money news',
    interests: ['business'],
    topics: [
      { id: 'business', label: 'Top stories', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', title: 'MarketWatch · Top stories' }
    ]
  },
  {
    id: 'sciencenews',
    name: 'Scientific American',
    domain: 'scientificamerican.com',
    monogram: 'SciAm',
    blurb: 'Research and discovery',
    interests: ['science'],
    topics: [
      { id: 'science', label: 'Science', url: 'https://rss.sciam.com/ScientificAmerican-Global', title: 'Scientific American' }
    ]
  }
]

/** Outlets that match at least one selected interest (local is handled separately). */
export function outletsForInterests(interests: ReadonlySet<NewsInterestId>): NewsOutlet[] {
  const nonLocal = Array.from(interests).filter(
    (id): id is Exclude<NewsInterestId, 'local'> => id !== 'local'
  )
  if (nonLocal.length === 0) return NEWS_SOURCE_CATALOG
  return NEWS_SOURCE_CATALOG.filter((outlet) =>
    nonLocal.some((interest) => outlet.interests.includes(interest))
  )
}

/** Section chips to show for an outlet — all desk sections; interests only pick the default. */
export function visibleTopicsForOutlet(
  outlet: NewsOutlet,
  _interests: ReadonlySet<NewsInterestId>
): NewsTopicFeed[] {
  return outlet.topics
}

/** Default single section when an outlet is first selected — interest picks the desk, not visibility. */
export function defaultFeedKeyForOutlet(
  outlet: NewsOutlet,
  interests: ReadonlySet<NewsInterestId>
): string {
  const nonLocal = Array.from(interests).filter(
    (id): id is Exclude<NewsInterestId, 'local'> => id !== 'local'
  )
  let topic = outlet.topics[0]!
  if (nonLocal.length > 0) {
    const allowedIds = new Set(nonLocal.flatMap((interest) => INTEREST_TOPIC_IDS[interest]))
    const matched = outlet.topics.filter((t) => allowedIds.has(t.id))
    if (matched.length > 0) topic = matched[0]!
  }
  return `${outlet.id}:${topic.id}`
}

export function outletFromFeedKey(key: string): string {
  return key.split(':')[0] ?? ''
}

export function feedsForOutlet(keys: ReadonlySet<string>, outletId: string): string[] {
  return Array.from(keys).filter((key) => outletFromFeedKey(key) === outletId)
}

/** True when the pasted value looks like a direct RSS/Atom URL (not a bare website). */
export function looksLikeFeedUrl(raw: string): boolean {
  const value = raw.trim().toLowerCase()
  if (!value) return false
  if (value.endsWith('.xml') || value.endsWith('.rss') || value.endsWith('.atom')) return true
  if (value.includes('/rss') || value.includes('/feed') || value.includes('feeds.')) return true
  return false
}

/** Resolve a "outletId:topicId" selection key to its feed, or null. */
export function resolveCatalogFeed(key: string): NewsTopicFeed | null {
  const [outletId, topicId] = key.split(':')
  const outlet = NEWS_SOURCE_CATALOG.find((o) => o.id === outletId)
  return outlet?.topics.find((t) => t.id === topicId) ?? null
}

/** Major metros — city name (lowercase) → local section feeds. Expand in V2 research task. */
export const LOCAL_NEWS_BY_CITY: Record<string, NewsBundleFeed[]> = {
  'new york': [
    {
      url: 'https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml',
      title: 'NYT New York'
    }
  ],
  nyc: [
    {
      url: 'https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml',
      title: 'NYT New York'
    }
  ],
  'los angeles': [
    {
      url: 'https://www.latimes.com/local/rss2.0.xml',
      title: 'LA Times Local'
    }
  ],
  chicago: [
    {
      url: 'https://www.chicagotribune.com/arcio/rss/category/news/local/',
      title: 'Chicago Tribune Local'
    }
  ],
  houston: [
    {
      url: 'https://www.houstonchronicle.com/rss/feed/News-270.php',
      title: 'Houston Chronicle'
    }
  ],
  phoenix: [
    {
      url: 'https://www.azcentral.com/rss/',
      title: 'Arizona Republic'
    }
  ],
  philadelphia: [
    {
      url: 'https://www.inquirer.com/rss/',
      title: 'Philadelphia Inquirer'
    }
  ],
  'san antonio': [
    {
      url: 'https://www.expressnews.com/rss/feed/News-270.php',
      title: 'San Antonio Express-News'
    }
  ],
  'san diego': [
    {
      url: 'https://www.sandiegouniontribune.com/rss/',
      title: 'San Diego Union-Tribune'
    }
  ],
  dallas: [
    {
      url: 'https://www.dallasnews.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Dallas Morning News Local'
    }
  ],
  seattle: [
    {
      url: 'https://www.seattletimes.com/seattle-news/feed/',
      title: 'Seattle Times Local'
    }
  ],
  denver: [
    {
      url: 'https://www.denverpost.com/feed/',
      title: 'Denver Post'
    }
  ],
  boston: [
    {
      url: 'https://www.bostonglobe.com/feeds/rss/local/',
      title: 'Boston Globe Local'
    }
  ],
  'san francisco': [
    {
      url: 'https://www.sfchronicle.com/rss/feed/News-270.php',
      title: 'SF Chronicle'
    }
  ],
  sf: [
    {
      url: 'https://www.sfchronicle.com/rss/feed/News-270.php',
      title: 'SF Chronicle'
    }
  ],
  'washington dc': [
    {
      url: 'https://feeds.washingtonpost.com/rss/local',
      title: 'WaPo · DC area'
    }
  ],
  dc: [
    {
      url: 'https://feeds.washingtonpost.com/rss/local',
      title: 'WaPo · DC area'
    }
  ],
  'portland': [
    {
      url: 'https://www.oregonlive.com/arc/outboundfeeds/rss/?outputType=xml',
      title: 'Oregon Live'
    }
  ],
  'vancouver wa': [
    {
      url: 'https://www.columbian.com/feed/',
      title: 'The Columbian'
    },
    {
      url: 'https://www.columbian.com/rss/',
      title: 'The Columbian'
    },
    {
      url: 'https://www.opb.org/arc/outboundfeeds/rss/?outputType=xml',
      title: 'OPB News'
    },
    {
      url: 'https://www.kgw.com/rss/',
      title: 'KGW8 Portland'
    },
    {
      url: 'https://www.oregonlive.com/arc/outboundfeeds/rss/?outputType=xml',
      title: 'Oregon Live'
    },
    {
      url: 'https://www.clarkcountytoday.com/feed/',
      title: 'Clark County Today'
    }
  ],
  vancouver: [
    {
      url: 'https://www.columbian.com/feed/',
      title: 'The Columbian'
    },
    {
      url: 'https://www.columbian.com/rss/',
      title: 'The Columbian'
    },
    {
      url: 'https://www.opb.org/arc/outboundfeeds/rss/?outputType=xml',
      title: 'OPB News'
    },
    {
      url: 'https://www.kgw.com/rss/',
      title: 'KGW8 Portland'
    },
    {
      url: 'https://www.oregonlive.com/arc/outboundfeeds/rss/?outputType=xml',
      title: 'Oregon Live'
    },
    {
      url: 'https://www.clarkcountytoday.com/feed/',
      title: 'Clark County Today'
    }
  ],
  austin: [
    {
      url: 'https://www.statesman.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Austin American-Statesman'
    }
  ],
  nashville: [
    {
      url: 'https://www.tennessean.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'The Tennessean'
    }
  ],
  detroit: [
    {
      url: 'https://www.freep.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Detroit Free Press'
    }
  ],
  minneapolis: [
    {
      url: 'https://www.startribune.com/local/index.rss2',
      title: 'Star Tribune Local'
    }
  ],
  charlotte: [
    {
      url: 'https://www.charlotteobserver.com/news/local/rss',
      title: 'Charlotte Observer Local'
    }
  ],
  tampa: [
    {
      url: 'https://www.tampabay.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Tampa Bay Times'
    }
  ],
  orlando: [
    {
      url: 'https://www.orlandosentinel.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Orlando Sentinel'
    }
  ],
  cleveland: [
    {
      url: 'https://www.cleveland.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Cleveland.com Local'
    }
  ],
  pittsburgh: [
    {
      url: 'https://www.post-gazette.com/rss/local',
      title: 'Pittsburgh Post-Gazette'
    }
  ],
  'st louis': [
    {
      url: 'https://www.stltoday.com/search/?f=rss&t=article&c=news/local&l=25&s=start_time&sd=desc',
      title: 'St. Louis Post-Dispatch'
    }
  ],
  'kansas city': [
    {
      url: 'https://www.kansascity.com/news/local/rss',
      title: 'Kansas City Star Local'
    }
  ],
  sacramento: [
    {
      url: 'https://www.sacbee.com/news/local/rss',
      title: 'Sacramento Bee Local'
    }
  ],
  'las vegas': [
    {
      url: 'https://www.reviewjournal.com/feed/local/',
      title: 'Las Vegas Review-Journal'
    }
  ],
  'salt lake city': [
    {
      url: 'https://www.sltrib.com/rss/local/',
      title: 'Salt Lake Tribune Local'
    }
  ],
  indianapolis: [
    {
      url: 'https://www.indystar.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Indianapolis Star Local'
    }
  ],
  columbus: [
    {
      url: 'https://www.dispatch.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Columbus Dispatch Local'
    }
  ],
  cincinnati: [
    {
      url: 'https://www.cincinnati.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Cincinnati Enquirer Local'
    }
  ],
  milwaukee: [
    {
      url: 'https://www.jsonline.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Milwaukee Journal Sentinel'
    }
  ],
  raleigh: [
    {
      url: 'https://www.newsobserver.com/news/local/rss',
      title: 'Raleigh News & Observer'
    }
  ],
  baltimore: [
    {
      url: 'https://www.baltimoresun.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Baltimore Sun Local'
    }
  ],
  atlanta: [
    {
      url: 'https://www.ajc.com/arc/outboundfeeds/rss/category/news/local/?outputType=xml',
      title: 'Atlanta Journal-Constitution Local'
    }
  ],
  miami: [
    {
      url: 'https://www.miamiherald.com/news/local/rss',
      title: 'Miami Herald Local'
    }
  ]
}

/** ZIP → city key in LOCAL_NEWS_BY_CITY (top US metros). */
const LOCAL_NEWS_BY_ZIP: Record<string, string> = {
  '10001': 'new york',
  '10002': 'new york',
  '10003': 'new york',
  '10011': 'new york',
  '10016': 'new york',
  '10019': 'new york',
  '10021': 'new york',
  '10036': 'new york',
  '11201': 'new york',
  '90001': 'los angeles',
  '90012': 'los angeles',
  '90028': 'los angeles',
  '90210': 'los angeles',
  '60601': 'chicago',
  '60614': 'chicago',
  '77001': 'houston',
  '77002': 'houston',
  '85001': 'phoenix',
  '19101': 'philadelphia',
  '19103': 'philadelphia',
  '78201': 'san antonio',
  '92101': 'san diego',
  '75201': 'dallas',
  '98101': 'seattle',
  '98109': 'seattle',
  '80202': 'denver',
  '02108': 'boston',
  '02116': 'boston',
  '30301': 'atlanta',
  '30303': 'atlanta',
  '33101': 'miami',
  '33130': 'miami'
}

/**
 * First three ZIP digits → metro key in LOCAL_NEWS_BY_CITY.
 * Covers major US metros so any 5-digit ZIP resolves without an exact match.
 */
const ZIP3_TO_CITY: Record<string, string> = {
  '006': 'new york',
  '007': 'new york',
  '008': 'new york',
  '009': 'new york',
  '010': 'boston',
  '011': 'boston',
  '012': 'boston',
  '013': 'boston',
  '014': 'boston',
  '015': 'boston',
  '016': 'boston',
  '017': 'boston',
  '018': 'boston',
  '019': 'boston',
  '020': 'boston',
  '021': 'boston',
  '022': 'boston',
  '023': 'boston',
  '024': 'boston',
  '025': 'boston',
  '026': 'boston',
  '027': 'boston',
  '028': 'boston',
  '100': 'new york',
  '101': 'new york',
  '102': 'new york',
  '103': 'new york',
  '104': 'new york',
  '105': 'new york',
  '106': 'new york',
  '107': 'new york',
  '108': 'new york',
  '109': 'new york',
  '110': 'new york',
  '111': 'new york',
  '112': 'new york',
  '113': 'new york',
  '114': 'new york',
  '115': 'new york',
  '116': 'new york',
  '117': 'new york',
  '118': 'new york',
  '119': 'new york',
  '120': 'new york',
  '121': 'new york',
  '122': 'new york',
  '123': 'new york',
  '124': 'new york',
  '125': 'new york',
  '126': 'new york',
  '127': 'new york',
  '128': 'new york',
  '129': 'new york',
  '130': 'new york',
  '131': 'new york',
  '132': 'new york',
  '133': 'new york',
  '134': 'new york',
  '135': 'new york',
  '136': 'new york',
  '137': 'new york',
  '138': 'new york',
  '139': 'new york',
  '140': 'new york',
  '141': 'new york',
  '142': 'new york',
  '143': 'new york',
  '144': 'new york',
  '145': 'new york',
  '146': 'new york',
  '147': 'new york',
  '148': 'new york',
  '149': 'new york',
  '150': 'pittsburgh',
  '151': 'pittsburgh',
  '152': 'pittsburgh',
  '153': 'pittsburgh',
  '154': 'pittsburgh',
  '155': 'pittsburgh',
  '156': 'pittsburgh',
  '157': 'pittsburgh',
  '158': 'pittsburgh',
  '159': 'pittsburgh',
  '160': 'pittsburgh',
  '161': 'pittsburgh',
  '162': 'pittsburgh',
  '163': 'pittsburgh',
  '164': 'pittsburgh',
  '165': 'pittsburgh',
  '166': 'pittsburgh',
  '167': 'pittsburgh',
  '168': 'pittsburgh',
  '169': 'pittsburgh',
  '170': 'philadelphia',
  '171': 'philadelphia',
  '172': 'philadelphia',
  '173': 'philadelphia',
  '174': 'philadelphia',
  '175': 'philadelphia',
  '176': 'philadelphia',
  '177': 'philadelphia',
  '178': 'philadelphia',
  '179': 'philadelphia',
  '180': 'philadelphia',
  '181': 'philadelphia',
  '182': 'philadelphia',
  '183': 'philadelphia',
  '184': 'philadelphia',
  '185': 'philadelphia',
  '186': 'philadelphia',
  '187': 'philadelphia',
  '188': 'philadelphia',
  '189': 'philadelphia',
  '190': 'philadelphia',
  '191': 'philadelphia',
  '192': 'philadelphia',
  '193': 'philadelphia',
  '194': 'philadelphia',
  '195': 'philadelphia',
  '196': 'philadelphia',
  '197': 'washington dc',
  '198': 'washington dc',
  '199': 'washington dc',
  '200': 'washington dc',
  '201': 'washington dc',
  '202': 'washington dc',
  '203': 'washington dc',
  '204': 'washington dc',
  '205': 'washington dc',
  '206': 'washington dc',
  '207': 'washington dc',
  '208': 'washington dc',
  '209': 'washington dc',
  '210': 'baltimore',
  '211': 'baltimore',
  '212': 'baltimore',
  '214': 'baltimore',
  '215': 'baltimore',
  '216': 'baltimore',
  '217': 'baltimore',
  '218': 'baltimore',
  '219': 'baltimore',
  '220': 'washington dc',
  '221': 'washington dc',
  '222': 'washington dc',
  '223': 'washington dc',
  '270': 'raleigh',
  '271': 'raleigh',
  '272': 'raleigh',
  '273': 'raleigh',
  '274': 'raleigh',
  '275': 'raleigh',
  '276': 'raleigh',
  '277': 'raleigh',
  '278': 'raleigh',
  '279': 'raleigh',
  '280': 'charlotte',
  '281': 'charlotte',
  '282': 'charlotte',
  '283': 'charlotte',
  '284': 'charlotte',
  '285': 'charlotte',
  '286': 'charlotte',
  '287': 'charlotte',
  '288': 'charlotte',
  '289': 'charlotte',
  '290': 'charlotte',
  '291': 'charlotte',
  '292': 'charlotte',
  '293': 'charlotte',
  '294': 'charlotte',
  '295': 'charlotte',
  '296': 'charlotte',
  '297': 'charlotte',
  '298': 'charlotte',
  '299': 'charlotte',
  '300': 'atlanta',
  '301': 'atlanta',
  '302': 'atlanta',
  '303': 'atlanta',
  '304': 'atlanta',
  '305': 'atlanta',
  '306': 'atlanta',
  '307': 'atlanta',
  '308': 'atlanta',
  '309': 'atlanta',
  '310': 'atlanta',
  '311': 'atlanta',
  '312': 'atlanta',
  '313': 'atlanta',
  '314': 'atlanta',
  '315': 'atlanta',
  '316': 'atlanta',
  '317': 'atlanta',
  '318': 'atlanta',
  '319': 'atlanta',
  '320': 'atlanta',
  '321': 'orlando',
  '322': 'orlando',
  '323': 'orlando',
  '324': 'orlando',
  '325': 'orlando',
  '326': 'orlando',
  '327': 'orlando',
  '328': 'orlando',
  '329': 'orlando',
  '330': 'miami',
  '331': 'miami',
  '332': 'miami',
  '333': 'miami',
  '334': 'miami',
  '335': 'tampa',
  '336': 'tampa',
  '337': 'tampa',
  '338': 'tampa',
  '339': 'tampa',
  '341': 'miami',
  '342': 'tampa',
  '346': 'tampa',
  '347': 'orlando',
  '349': 'miami',
  '370': 'nashville',
  '371': 'nashville',
  '372': 'nashville',
  '373': 'nashville',
  '374': 'nashville',
  '375': 'nashville',
  '376': 'nashville',
  '377': 'nashville',
  '378': 'nashville',
  '379': 'nashville',
  '380': 'nashville',
  '381': 'nashville',
  '382': 'nashville',
  '383': 'nashville',
  '384': 'nashville',
  '385': 'nashville',
  '420': 'nashville',
  '421': 'nashville',
  '422': 'nashville',
  '423': 'nashville',
  '424': 'nashville',
  '425': 'nashville',
  '430': 'columbus',
  '431': 'columbus',
  '432': 'columbus',
  '433': 'columbus',
  '434': 'columbus',
  '435': 'columbus',
  '436': 'columbus',
  '437': 'columbus',
  '438': 'columbus',
  '439': 'columbus',
  '440': 'cleveland',
  '441': 'cleveland',
  '442': 'cleveland',
  '443': 'cleveland',
  '444': 'cleveland',
  '445': 'cleveland',
  '446': 'cleveland',
  '447': 'cleveland',
  '448': 'cleveland',
  '449': 'cleveland',
  '450': 'cincinnati',
  '451': 'cincinnati',
  '452': 'cincinnati',
  '453': 'cincinnati',
  '454': 'cincinnati',
  '455': 'cincinnati',
  '456': 'cincinnati',
  '457': 'cincinnati',
  '458': 'cincinnati',
  '459': 'cincinnati',
  '460': 'indianapolis',
  '461': 'indianapolis',
  '462': 'indianapolis',
  '463': 'indianapolis',
  '464': 'indianapolis',
  '465': 'indianapolis',
  '466': 'indianapolis',
  '467': 'indianapolis',
  '468': 'indianapolis',
  '469': 'indianapolis',
  '470': 'indianapolis',
  '471': 'indianapolis',
  '472': 'indianapolis',
  '473': 'indianapolis',
  '474': 'indianapolis',
  '475': 'indianapolis',
  '476': 'indianapolis',
  '477': 'indianapolis',
  '478': 'indianapolis',
  '479': 'indianapolis',
  '480': 'detroit',
  '481': 'detroit',
  '482': 'detroit',
  '483': 'detroit',
  '484': 'detroit',
  '485': 'detroit',
  '486': 'detroit',
  '487': 'detroit',
  '488': 'detroit',
  '489': 'detroit',
  '490': 'detroit',
  '491': 'detroit',
  '492': 'detroit',
  '493': 'detroit',
  '494': 'detroit',
  '495': 'detroit',
  '496': 'detroit',
  '497': 'detroit',
  '498': 'detroit',
  '499': 'detroit',
  '530': 'milwaukee',
  '531': 'milwaukee',
  '532': 'milwaukee',
  '534': 'milwaukee',
  '535': 'milwaukee',
  '537': 'milwaukee',
  '538': 'milwaukee',
  '539': 'milwaukee',
  '540': 'minneapolis',
  '541': 'minneapolis',
  '542': 'minneapolis',
  '543': 'minneapolis',
  '544': 'minneapolis',
  '545': 'minneapolis',
  '546': 'minneapolis',
  '547': 'minneapolis',
  '548': 'minneapolis',
  '549': 'minneapolis',
  '550': 'minneapolis',
  '551': 'minneapolis',
  '553': 'minneapolis',
  '554': 'minneapolis',
  '555': 'minneapolis',
  '556': 'minneapolis',
  '557': 'minneapolis',
  '558': 'minneapolis',
  '559': 'minneapolis',
  '560': 'minneapolis',
  '561': 'minneapolis',
  '562': 'minneapolis',
  '563': 'minneapolis',
  '564': 'minneapolis',
  '565': 'minneapolis',
  '566': 'minneapolis',
  '567': 'minneapolis',
  '600': 'chicago',
  '601': 'chicago',
  '602': 'chicago',
  '603': 'chicago',
  '604': 'chicago',
  '605': 'chicago',
  '606': 'chicago',
  '607': 'chicago',
  '608': 'chicago',
  '609': 'chicago',
  '610': 'chicago',
  '611': 'chicago',
  '612': 'chicago',
  '613': 'chicago',
  '614': 'chicago',
  '615': 'chicago',
  '616': 'chicago',
  '617': 'chicago',
  '618': 'chicago',
  '619': 'chicago',
  '620': 'chicago',
  '622': 'chicago',
  '623': 'chicago',
  '624': 'chicago',
  '625': 'chicago',
  '626': 'chicago',
  '627': 'chicago',
  '628': 'chicago',
  '629': 'chicago',
  '630': 'st louis',
  '631': 'st louis',
  '633': 'st louis',
  '634': 'st louis',
  '635': 'st louis',
  '636': 'st louis',
  '637': 'st louis',
  '638': 'st louis',
  '639': 'st louis',
  '640': 'kansas city',
  '641': 'kansas city',
  '644': 'kansas city',
  '645': 'kansas city',
  '646': 'kansas city',
  '647': 'kansas city',
  '648': 'kansas city',
  '649': 'kansas city',
  '650': 'kansas city',
  '651': 'kansas city',
  '652': 'kansas city',
  '653': 'kansas city',
  '654': 'kansas city',
  '655': 'kansas city',
  '656': 'kansas city',
  '657': 'kansas city',
  '658': 'kansas city',
  '660': 'kansas city',
  '661': 'kansas city',
  '662': 'kansas city',
  '664': 'kansas city',
  '665': 'kansas city',
  '666': 'kansas city',
  '667': 'kansas city',
  '668': 'kansas city',
  '669': 'kansas city',
  '670': 'kansas city',
  '671': 'kansas city',
  '672': 'kansas city',
  '673': 'kansas city',
  '674': 'kansas city',
  '675': 'kansas city',
  '676': 'kansas city',
  '677': 'kansas city',
  '678': 'kansas city',
  '679': 'kansas city',
  '700': 'houston',
  '701': 'houston',
  '703': 'houston',
  '704': 'houston',
  '705': 'houston',
  '706': 'houston',
  '707': 'houston',
  '708': 'houston',
  '709': 'houston',
  '710': 'houston',
  '711': 'houston',
  '712': 'houston',
  '713': 'houston',
  '714': 'houston',
  '715': 'houston',
  '716': 'houston',
  '717': 'houston',
  '718': 'houston',
  '719': 'houston',
  '720': 'houston',
  '721': 'houston',
  '722': 'houston',
  '723': 'houston',
  '724': 'houston',
  '725': 'houston',
  '726': 'houston',
  '727': 'houston',
  '728': 'houston',
  '729': 'houston',
  '730': 'houston',
  '731': 'houston',
  '733': 'houston',
  '734': 'houston',
  '735': 'houston',
  '736': 'houston',
  '737': 'houston',
  '738': 'houston',
  '739': 'houston',
  '740': 'houston',
  '741': 'houston',
  '742': 'houston',
  '743': 'houston',
  '744': 'houston',
  '745': 'houston',
  '746': 'houston',
  '747': 'houston',
  '748': 'houston',
  '749': 'houston',
  '750': 'dallas',
  '751': 'dallas',
  '752': 'dallas',
  '753': 'dallas',
  '754': 'dallas',
  '755': 'dallas',
  '756': 'dallas',
  '757': 'dallas',
  '758': 'dallas',
  '759': 'dallas',
  '760': 'dallas',
  '761': 'dallas',
  '762': 'dallas',
  '763': 'dallas',
  '764': 'dallas',
  '765': 'dallas',
  '766': 'dallas',
  '767': 'dallas',
  '768': 'dallas',
  '769': 'dallas',
  '770': 'houston',
  '771': 'houston',
  '772': 'houston',
  '773': 'houston',
  '774': 'houston',
  '775': 'houston',
  '776': 'houston',
  '777': 'houston',
  '778': 'houston',
  '779': 'houston',
  '780': 'san antonio',
  '781': 'san antonio',
  '782': 'san antonio',
  '783': 'san antonio',
  '784': 'san antonio',
  '785': 'san antonio',
  '786': 'austin',
  '787': 'austin',
  '788': 'austin',
  '789': 'austin',
  '790': 'austin',
  '791': 'austin',
  '792': 'austin',
  '793': 'austin',
  '794': 'austin',
  '795': 'austin',
  '796': 'austin',
  '797': 'austin',
  '798': 'austin',
  '799': 'austin',
  '800': 'denver',
  '801': 'denver',
  '802': 'denver',
  '803': 'denver',
  '804': 'denver',
  '805': 'denver',
  '806': 'denver',
  '807': 'denver',
  '808': 'denver',
  '809': 'denver',
  '810': 'denver',
  '811': 'denver',
  '812': 'denver',
  '813': 'denver',
  '814': 'denver',
  '815': 'denver',
  '816': 'denver',
  '820': 'denver',
  '821': 'denver',
  '822': 'denver',
  '823': 'denver',
  '824': 'denver',
  '825': 'denver',
  '826': 'denver',
  '827': 'denver',
  '828': 'denver',
  '829': 'denver',
  '830': 'denver',
  '831': 'denver',
  '832': 'denver',
  '833': 'denver',
  '834': 'denver',
  '835': 'denver',
  '836': 'denver',
  '837': 'denver',
  '838': 'denver',
  '839': 'denver',
  '840': 'salt lake city',
  '841': 'salt lake city',
  '842': 'salt lake city',
  '843': 'salt lake city',
  '844': 'salt lake city',
  '845': 'salt lake city',
  '846': 'salt lake city',
  '847': 'salt lake city',
  '850': 'phoenix',
  '851': 'phoenix',
  '852': 'phoenix',
  '853': 'phoenix',
  '855': 'phoenix',
  '856': 'phoenix',
  '857': 'phoenix',
  '858': 'phoenix',
  '859': 'phoenix',
  '860': 'phoenix',
  '863': 'phoenix',
  '864': 'phoenix',
  '865': 'phoenix',
  '870': 'phoenix',
  '871': 'phoenix',
  '872': 'phoenix',
  '873': 'phoenix',
  '874': 'phoenix',
  '875': 'phoenix',
  '877': 'phoenix',
  '878': 'phoenix',
  '879': 'phoenix',
  '880': 'phoenix',
  '881': 'phoenix',
  '882': 'phoenix',
  '883': 'phoenix',
  '884': 'phoenix',
  '885': 'phoenix',
  '889': 'las vegas',
  '890': 'las vegas',
  '891': 'las vegas',
  '892': 'las vegas',
  '893': 'las vegas',
  '894': 'las vegas',
  '895': 'las vegas',
  '896': 'las vegas',
  '897': 'las vegas',
  '898': 'las vegas',
  '900': 'los angeles',
  '901': 'los angeles',
  '902': 'los angeles',
  '903': 'los angeles',
  '904': 'los angeles',
  '905': 'los angeles',
  '906': 'los angeles',
  '907': 'los angeles',
  '908': 'los angeles',
  '910': 'los angeles',
  '911': 'los angeles',
  '912': 'los angeles',
  '913': 'los angeles',
  '914': 'los angeles',
  '915': 'los angeles',
  '916': 'los angeles',
  '917': 'los angeles',
  '918': 'los angeles',
  '919': 'san diego',
  '920': 'san diego',
  '921': 'san diego',
  '922': 'san diego',
  '923': 'san diego',
  '924': 'san diego',
  '925': 'san diego',
  '926': 'san diego',
  '927': 'san diego',
  '928': 'san diego',
  '930': 'los angeles',
  '931': 'los angeles',
  '932': 'los angeles',
  '933': 'los angeles',
  '934': 'los angeles',
  '935': 'los angeles',
  '936': 'los angeles',
  '937': 'los angeles',
  '938': 'los angeles',
  '939': 'los angeles',
  '940': 'san francisco',
  '941': 'san francisco',
  '942': 'sacramento',
  '943': 'san francisco',
  '944': 'san francisco',
  '945': 'san francisco',
  '946': 'san francisco',
  '947': 'san francisco',
  '948': 'san francisco',
  '949': 'san francisco',
  '950': 'san francisco',
  '951': 'san francisco',
  '952': 'san francisco',
  '953': 'san francisco',
  '954': 'san francisco',
  '955': 'san francisco',
  '956': 'sacramento',
  '957': 'sacramento',
  '958': 'sacramento',
  '959': 'sacramento',
  '960': 'sacramento',
  '961': 'sacramento',
  '970': 'portland',
  '971': 'portland',
  '972': 'portland',
  '973': 'portland',
  '974': 'portland',
  '975': 'portland',
  '976': 'portland',
  '977': 'portland',
  '978': 'portland',
  '979': 'portland',
  '986': 'vancouver wa',
  '987': 'vancouver wa',
  '988': 'vancouver wa',
  '989': 'vancouver wa',
  '980': 'seattle',
  '981': 'seattle',
  '982': 'seattle',
  '983': 'seattle',
  '984': 'seattle',
  '985': 'seattle',
  '990': 'seattle',
  '991': 'seattle',
  '992': 'seattle',
  '993': 'seattle',
  '994': 'seattle'
}

function localFeedsForZipDigits(zipDigits: string): NewsBundleFeed[] {
  if (zipDigits.length < 5) return []
  const zip5 = zipDigits.slice(0, 5)
  const exactCity = LOCAL_NEWS_BY_ZIP[zip5]
  if (exactCity) return LOCAL_NEWS_BY_CITY[exactCity] ?? []

  const zip3 = zip5.slice(0, 3)
  const prefixCity = ZIP3_TO_CITY[zip3]
  if (prefixCity) return LOCAL_NEWS_BY_CITY[prefixCity] ?? []

  return []
}

export function resolveLocalNewsFeeds(query: string): NewsBundleFeed[] {
  const key = query.trim().toLowerCase()
  if (!key) return []

  const zipDigits = key.replace(/\D/g, '')
  const fromZip = localFeedsForZipDigits(zipDigits)
  if (fromZip.length > 0) return fromZip

  if (LOCAL_NEWS_BY_CITY[key]) return LOCAL_NEWS_BY_CITY[key]!

  for (const [city, feeds] of Object.entries(LOCAL_NEWS_BY_CITY)) {
    if (city.includes(key) || key.includes(city)) return feeds
  }

  return []
}

/** Human label for a resolved local metro — used in setup copy. */
export function localMetroLabel(query: string): string | null {
  const key = query.trim().toLowerCase()
  const zipDigits = key.replace(/\D/g, '')
  if (zipDigits.length >= 5) {
    const zip5 = zipDigits.slice(0, 5)
    const city = LOCAL_NEWS_BY_ZIP[zip5] ?? ZIP3_TO_CITY[zip5.slice(0, 3)]
    if (city) return city.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  if (LOCAL_NEWS_BY_CITY[key]) {
    return key.replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return null
}

/**
 * Map a known feed URL to a semantic category (national/local/tech/…), or null
 * if the URL isn't in our catalog. Used to tag sources for the reader's
 * category filters — both when adding from setup and when backfilling on sync.
 */
/** Catalog section/topic id → canonical reader category. */
const TOPIC_CATEGORY: Record<string, string> = {
  top: 'national',
  news: 'national',
  world: 'world',
  tech: 'tech',
  technology: 'tech',
  business: 'business',
  sports: 'sports',
  sport: 'sports',
  nfl: 'sports',
  nba: 'sports',
  science: 'science'
}

export function isKnownLocalFeedUrl(rawUrl: string): boolean {
  const url = rawUrl.trim()
  if (!url) return false
  for (const feeds of Object.values(LOCAL_NEWS_BY_CITY)) {
    if (feeds.some((feed) => feed.url === url)) return true
  }
  return false
}

export function categoryForFeedUrl(rawUrl: string): string | null {
  const url = rawUrl.trim()
  // Bundles classify the major outlet feeds with clean category ids
  // (national/tech/sports) — check first so an outlet's primary feed reads as
  // its real category rather than a section-specific topic id like 'all'/'news'.
  for (const bundle of NEWS_FEED_BUNDLES) {
    if (bundle.feeds.some((feed) => feed.url === url)) return bundle.id
  }
  // Source-first catalog: normalize the section/topic id; unknown sections stay
  // untagged rather than guessing a wrong category.
  for (const outlet of NEWS_SOURCE_CATALOG) {
    for (const topic of outlet.topics) {
      if (topic.url === url) return TOPIC_CATEGORY[topic.id] ?? null
    }
  }
  if (isKnownLocalFeedUrl(url)) return 'local'
  return null
}

const NEWS_CATEGORY_LABELS: Record<string, string> = {
  national: 'National',
  local: 'Local',
  tech: 'Tech',
  business: 'Business',
  world: 'World',
  sports: 'Sports',
  science: 'Science',
  custom: 'Custom'
}

/** Friendly label for a stored category id (falls back to Title-case). */
export function newsCategoryLabel(id: string): string {
  return NEWS_CATEGORY_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

/** Search curated outlets by name, monogram, or id — e.g. "verge" → The Verge. */
export function searchNewsOutlets(query: string): NewsOutlet[] {
  const key = query.trim().toLowerCase()
  if (!key) return []

  return NEWS_SOURCE_CATALOG.filter((outlet) => {
    const name = outlet.name.toLowerCase()
    const stripped = name.replace(/^the\s+/, '')
    return (
      name.includes(key) ||
      stripped.includes(key) ||
      key.includes(stripped) ||
      outlet.id.includes(key) ||
      outlet.monogram.toLowerCase().includes(key)
    )
  }).slice(0, 8)
}

/** Default topic feed when adding an outlet by name search. */
export function defaultTopicForOutlet(outlet: NewsOutlet): NewsTopicFeed {
  return outlet.topics.find((topic) => topic.id === 'top') ?? outlet.topics[0]!
}
