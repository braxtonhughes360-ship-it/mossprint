/**
 * Describe parser lexicon — units, typos, compound phrases, OFF guardrails.
 * Single place to extend when a new failure mode appears in QA.
 */

/** Brand / restaurant names → prefer OFF when phrase mentions them. */
export const BRAND_HINTS = [
  'little caesars',
  'little caesar',
  'domino',
  'pizza hut',
  'mcdonald',
  'starbucks',
  'subway',
  'chipotle',
  'taco bell',
  'wendy',
  'burger king',
  'kfc',
  'costco',
  'trader joe',
  'chick fil',
  'chick-fil',
  'chickfila',
  'chick fil a',
  'chick-fil-a'
]

/** Packaged / restaurant-style foods — may prefer OFF when no estimate anchor. */
export const PACKAGED_FOOD_HINTS = [
  'pizza',
  'burger',
  'fries',
  'nugget',
  'sandwich',
  'wrap',
  'burrito',
  'taco',
  'latte',
  'mocha',
  'cereal',
  'bar',
  'chips',
  'cookie',
  'donut',
  'doughnut',
  'soda',
  'cola',
  'pepsi',
  'coke',
  'frozen',
  'microwave',
  'ramen',
  'noodle cup',
  'protein shake',
  'yogurt',
  'granola'
]
/** Generic ice cream → portion estimate, not packaged OFF (NotCo etc.). */

export const COMPOUND_UNITS: Record<string, string> = {
  'fluid ounce': 'oz',
  'fluid ounces': 'oz',
  'fl oz': 'oz',
  'fluid oz': 'oz'
}

/** Common unit typos → canonical key in DESCRIBE_UNIT_GRAMS. */
export const UNIT_TYPO_MAP: Record<string, string> = {
  scopps: 'scoops',
  scoopp: 'scoop',
  scoops: 'scoops',
  scoop: 'scoop',
  slicces: 'slices',
  slize: 'slice',
  slizes: 'slices',
  glasss: 'glass',
  bowll: 'bowl',
  bowlls: 'bowls',
  bown: 'bowl',
  cupp: 'cup',
  cupps: 'cups',
  peices: 'pieces',
  piecees: 'pieces',
  peice: 'piece',
  tablespoons: 'tbsp',
  tablespoon: 'tbsp',
  teaspoons: 'tsp',
  teaspoon: 'tsp',
  ounces: 'oz',
  ozs: 'oz',
  handfull: 'handful',
  handfulls: 'handfuls',
  pattys: 'patties',
  fillets: 'fillet',
  winggs: 'wings',
  servng: 'serving',
  servngs: 'servings'
}

/**
 * Phrases where internal "and" must not split segments.
 * Matched case-insensitively; internal "and" replaced with " & " before split.
 */
export const COMPOUND_DISH_PHRASES = [
  'mac and cheese',
  'fish and chips',
  'rice and beans',
  'peanut butter and jelly',
  'pb and j',
  'grilled cheese and tomato',
  'salt and vinegar',
  'alfredo and chicken',
  'alfredo & chicken',
  'chicken and alfredo',
  'bowl of alfredo and chicken'
]

/** Only collapse when the phrase is a named dish, not "food A and food B". */
export const COMPOUND_DISH_COLLAPSE: Record<string, string> = {}

/** Collapse common misspellings before compound / split logic. */
export const FOOD_SPELL_NORMALIZE: Array<[RegExp, string]> = [
  [/\bicecream\b/gi, 'ice cream'],
  [/\bice-cream\b/gi, 'ice cream'],
  [/\biceream\b/gi, 'ice cream'],
  [/\bceral\b/gi, 'cereal'],
  [/\bcapn\b/gi, "cap'n"],
  [/\bcaptain\s+crunch\b/gi, "cap'n crunch"],
  [/\breeses\b/gi, "reese's"],
  [/\breese\b/gi, "reese's"]
]

/** OFF hits that mislead when user did not ask for vegan / alt products. */
export const OFF_MISLEADING_MARKERS = [
  'notco',
  'not ice',
  'not milk',
  'vegan',
  'plant-based',
  'plant based',
  'dairy-free',
  'dairy free',
  'oat cream',
  'coconut bliss'
]

/** Single-word or tiny phrases — OFF search returns noise; use estimate or unresolved. */
export const OFF_AMBIGUOUS_PHRASES = new Set([
  'cone',
  'vanilla',
  'chocolate',
  'strawberry',
  'rice',
  'milk',
  'bread',
  'cheese',
  'butter',
  'oil',
  'sugar',
  'cream',
  'sauce',
  'meat',
  'fish',
  'beef',
  'pork',
  'ham',
  'salad',
  'soup',
  'tea',
  'water',
  'juice',
  'wine',
  'beer',
  'nuts',
  'fruit'
])

/** Minimum OFF relevance score (see scoreOffRelevance) for multi-word phrases. */
export const OFF_MIN_RELEVANCE_SCORE = 6

/** Minimum phrase length to query OFF at all. */
export const OFF_MIN_PHRASE_LENGTH = 5

const TYPO_PATTERN = Object.keys(UNIT_TYPO_MAP)
  .sort((a, b) => b.length - a.length)
  .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

const UNIT_TYPO_RE = new RegExp(`\\b(${TYPO_PATTERN})\\b`, 'gi')

/** Strip trailing meal-slot context before parse (MFP-style free text). */
const MEAL_CONTEXT_PATTERNS: RegExp[] = [
  /\s+for\s+(?:my\s+)?(?:breakfast|lunch|dinner|snack|brunch|supper)\s*$/i,
  /\s+at\s+(?:breakfast|lunch|dinner|snack|brunch|supper)\s*$/i,
  /^(?:for\s+)?(?:breakfast|lunch|dinner|snack|brunch|supper)\s*[:\-—]\s*/i
]

export function normalizeDescribeText(text: string): string {
  let out = text
    .trim()
    .replace(/\s+/g, ' ')
  for (const pattern of MEAL_CONTEXT_PATTERNS) {
    out = out.replace(pattern, '').trim()
  }
  for (const [pattern, replacement] of FOOD_SPELL_NORMALIZE) {
    out = out.replace(pattern, replacement)
  }
  return out
    .replace(UNIT_TYPO_RE, (match) => {
      const mapped = UNIT_TYPO_MAP[match.toLowerCase()]
      return mapped ?? match
    })
}

/** Ambiguous short phrases — skip OFF and cached local lookup noise. */
export function shouldSkipAmbiguousLookup(phrase: string): boolean {
  const trimmed = phrase.trim().toLowerCase()
  if (trimmed.length < OFF_MIN_PHRASE_LENGTH) return true
  return OFF_AMBIGUOUS_PHRASES.has(trimmed)
}

export function shouldSkipOffSearch(phrase: string): boolean {
  return shouldSkipAmbiguousLookup(phrase)
}

/**
 * Protect compound dish phrases before splitting on "and".
 * Replaces internal "and" with " & " inside known dishes.
 */
export function protectCompoundPhrases(text: string): string {
  let out = text
  for (const [from, to] of Object.entries(COMPOUND_DISH_COLLAPSE)) {
    out = out.replace(new RegExp(from.replace(/\s+/g, '\\s+'), 'gi'), to)
  }
  for (const dish of COMPOUND_DISH_PHRASES) {
    const re = new RegExp(dish.replace(/\s+and\s+/gi, '\\s+and\\s+'), 'gi')
    out = out.replace(re, (match) => match.replace(/\s+and\s+/gi, ' & '))
  }
  return out
}

export function isRecognizedUnitKey(raw: string, unitGrams: Record<string, number>): boolean {
  const lower = raw.toLowerCase()
  if (UNIT_TYPO_MAP[lower]) return true
  if (COMPOUND_UNITS[lower]) return true
  if (unitGrams[lower]) return true
  const singular = lower.replace(/s$/, '')
  if (unitGrams[singular]) return true
  return lower === 'g' || lower === 'gram' || lower === 'grams'
}

export function normalizeUnit(raw: string, unitGrams: Record<string, number>): string {
  const lower = raw.toLowerCase()
  const fromTypo = UNIT_TYPO_MAP[lower]
  if (fromTypo) {
    const base = fromTypo.replace(/s$/, '')
    if (unitGrams[base]) return base
    if (unitGrams[fromTypo]) return fromTypo
    return base
  }
  if (COMPOUND_UNITS[lower]) return COMPOUND_UNITS[lower]
  const singular = lower.replace(/s$/, '')
  if (unitGrams[singular]) return singular
  if (unitGrams[lower]) return lower
  return lower
}

export function isMisleadingOffProduct(phrase: string, productName: string): boolean {
  const phraseLower = phrase.toLowerCase().trim()
  const nameLower = productName.toLowerCase()
  const mentionsAlt =
    phraseLower.includes('vegan') ||
    phraseLower.includes('plant') ||
    phraseLower.includes('notco') ||
    phraseLower.includes('dairy-free') ||
    phraseLower.includes('dairy free')
  if (mentionsAlt) return false
  if (
    phraseLower.includes('cereal') &&
    (nameLower.includes('cup') ||
      nameLower.includes('candy') ||
      nameLower.includes('thins') ||
      nameLower.includes('snack size'))
  ) {
    return true
  }
  if (
    (phraseLower.includes('captain') ||
      phraseLower.includes("cap'n") ||
      phraseLower.includes('capn')) &&
    phraseLower.includes('crunch') &&
    !nameLower.includes('captain') &&
    !nameLower.includes("cap'n") &&
    !nameLower.includes('capn')
  ) {
    return true
  }
  if (phraseLower.includes('cereal') && nameLower.includes('caixa')) {
    return true
  }
  return OFF_MISLEADING_MARKERS.some((marker) => nameLower.includes(marker))
}

/**
 * Score how well an OFF product name matches the search phrase.
 * Returns 0 when match is too weak for multi-word queries.
 */
export type ComboSize = 'small' | 'medium' | 'large'

export interface ComboExpandedItem {
  phrase: string
  quantity: number
  unitHint: string | null
  assumed: boolean
}

const COMBO_SIZE_FRIES: Record<ComboSize, string> = {
  small: 'small fries',
  medium: 'medium fries',
  large: 'large fries'
}

const COMBO_SIZE_DRINK: Record<ComboSize, string> = {
  small: 'small soft drink',
  medium: 'medium soft drink',
  large: 'large soft drink'
}

function parseComboSize(text: string): ComboSize {
  if (/\b(large|lg)\b/i.test(text)) return 'large'
  if (/\b(small|sm)\b/i.test(text)) return 'small'
  return 'medium'
}

function comboSides(size: ComboSize): ComboExpandedItem[] {
  return [
    { phrase: COMBO_SIZE_FRIES[size], quantity: 1, unitHint: 'serving', assumed: true },
    { phrase: COMBO_SIZE_DRINK[size], quantity: 1, unitHint: 'cup', assumed: true }
  ]
}

function primaryComboItem(phrase: string, unitHint: string | null = null): ComboExpandedItem {
  return { phrase, quantity: 1, unitHint, assumed: false }
}

/** Branded fast-food combos — expand only when user says meal/combo (not "bowl" alone). */
const COMBO_MEAL_RULES: Array<{
  test: (normalized: string) => boolean
  expand: (normalized: string, size: ComboSize) => ComboExpandedItem[]
}> = [
  {
    test: (t) =>
      /\b(meal|combo)\b/.test(t) &&
      /chick[- ]?fil[- ]?a|chickfila/.test(t) &&
      /(chicken )?sandwich|spicy sandwich/.test(t),
    expand: (_t, size) => [
      primaryComboItem('chick fil a chicken sandwich', 'sandwich'),
      ...comboSides(size)
    ]
  },
  {
    test: (t) =>
      /\b(meal|combo)\b/.test(t) &&
      /chick[- ]?fil[- ]?a|chickfila/.test(t) &&
      /nugget/.test(t),
    expand: (_t, size) => [
      primaryComboItem('chick fil a 8 piece nuggets'),
      ...comboSides(size)
    ]
  },
  {
    test: (t) => /\b(meal|combo|value meal)\b/.test(t) && /\bbig mac\b/.test(t),
    expand: (_t, size) => [primaryComboItem('big mac'), ...comboSides(size)]
  },
  {
    test: (t) =>
      /\b(meal|combo|value meal)\b/.test(t) &&
      /(quarter pounder|qp with cheese|quarter pounder with cheese)/.test(t),
    expand: (_t, size) => [primaryComboItem('quarter pounder with cheese'), ...comboSides(size)]
  },
  {
    test: (t) => /\b(meal|combo|value meal)\b/.test(t) && /\bmcchicken\b/.test(t),
    expand: (_t, size) => [primaryComboItem('mcchicken'), ...comboSides(size)]
  },
  {
    test: (t) =>
      /\b(meal|combo|value meal)\b/.test(t) &&
      /(mcnugget|mc nugget|chicken nugget).*(10|ten)|\b10\b.*(mcnugget|nugget)/.test(t),
    expand: (_t, size) => [primaryComboItem('10 piece mcnuggets'), ...comboSides(size)]
  },
  {
    test: (t) => /\b(meal|combo|value meal)\b/.test(t) && /\bfilet[- ]?o[- ]?fish\b/.test(t),
    expand: (_t, size) => [primaryComboItem('filet o fish'), ...comboSides(size)]
  },
  {
    test: (t) => /\b(meal|combo|value meal)\b/.test(t) && /\bwhopper\b/.test(t),
    expand: (_t, size) => [primaryComboItem('whopper'), ...comboSides(size)]
  },
  {
    test: (t) =>
      /\b(meal|combo|value meal)\b/.test(t) &&
      /(dave'?s single|wendy'?s single|single burger)/.test(t),
    expand: (_t, size) => [primaryComboItem('dave single burger'), ...comboSides(size)]
  },
  {
    test: (t) => /\b(meal|combo|value meal)\b/.test(t) && /crunchwrap/.test(t),
    expand: (_t, size) => [primaryComboItem('crunchwrap supreme'), ...comboSides(size)]
  },
  {
    test: (t) =>
      /\b(meal|combo|value meal)\b/.test(t) &&
      /\bkfc\b/.test(t) &&
      /(2 piece|two piece|drumstick|thigh)/.test(t),
    expand: (_t, size) => [primaryComboItem('kfc 2 piece chicken'), ...comboSides(size)]
  },
  {
    test: (t) =>
      /\b(meal|combo|value meal)\b/.test(t) &&
      /\bsubway\b/.test(t) &&
      /(footlong|6 inch|6-inch)/.test(t),
    // Subway combos come with chips, not fries.
    expand: (_t, size) => [
      primaryComboItem('subway footlong sandwich'),
      { phrase: 'bag of chips', quantity: 1, unitHint: 'serving', assumed: true },
      { phrase: COMBO_SIZE_DRINK[size], quantity: 1, unitHint: 'cup', assumed: true }
    ]
  },
  {
    test: (t) => /\b(meal|combo|value meal)\b/.test(t) && /\bcheeseburger\b/.test(t) && /\bmcdonald/.test(t),
    expand: (_t, size) => [primaryComboItem('cheeseburger'), ...comboSides(size)]
  }
]

/**
 * Beverage cue for combo substitution: when the user names their own drink,
 * the combo's assumed soft drink must not also be logged (QA2-12 — "big mac
 * meal and a milkshake" logged a soft drink AND a milkshake).
 * Longest alternatives first so extraction grabs "milkshake" over "shake".
 */
const BEVERAGE_PHRASES =
  'chocolate milkshake|vanilla milkshake|strawberry milkshake|milkshake|milk shake|protein shake|shake|smoothie|frosty|slushie|slush|icee|soft drink|root beer|dr pepper|dr\\. pepper|mountain dew|diet coke|coke zero|coca cola|coca-cola|coke|pepsi|sprite|fanta|soda|cola|lemonade|sweet tea|iced tea|hot chocolate|chocolate milk|frappuccino|frappe|cappuccino|espresso|latte|mocha|coffee|tea|orange juice|apple juice|juice|sparkling water|water|milk|energy drink|gatorade|powerade|beer|wine'

const BEVERAGE_PHRASE_RE = new RegExp(`\\b(?:${BEVERAGE_PHRASES})\\b`, 'i')

export function isBeveragePhrase(text: string): boolean {
  return BEVERAGE_PHRASE_RE.test(text)
}

/**
 * If the combo segment itself names a drink ("… meal with a coke"), swap the
 * assumed soft drink for what the user actually said; the named drink is not
 * assumed — the user typed it.
 */
function substituteNamedBeverage(
  items: ComboExpandedItem[],
  normalized: string
): ComboExpandedItem[] {
  const named = normalized.match(BEVERAGE_PHRASE_RE)?.[0]
  if (!named) return items
  return items.map((item) =>
    item.assumed && isBeveragePhrase(item.phrase)
      ? { phrase: named, quantity: 1, unitHint: 'cup', assumed: false }
      : item
  )
}

/**
 * When a describe segment names a branded combo/meal, expand into component items.
 * Returns null for single dishes (e.g. "chipotle bowl") — no meal/combo cue required.
 */
export function expandComboMeal(text: string): ComboExpandedItem[] | null {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!/\b(meal|combo|value meal|happy meal)\b/.test(normalized)) {
    return null
  }

  const size = parseComboSize(normalized)
  for (const rule of COMBO_MEAL_RULES) {
    if (rule.test(normalized)) {
      return substituteNamedBeverage(rule.expand(normalized, size), normalized)
    }
  }
  return null
}

export function scoreOffRelevance(phrase: string, productName: string): number {
  const phraseLower = phrase.toLowerCase().trim()
  const nameLower = productName.toLowerCase()
  const words = phraseLower.split(/\s+/).filter((w) => w.length > 2)

  if (words.length === 0) return 0

  let score = 0
  for (const word of words) {
    if (nameLower.includes(word)) score += word.length
  }

  if (words.length >= 2 && score < OFF_MIN_RELEVANCE_SCORE) return 0
  if (words.length === 1 && words[0].length >= 4 && score < words[0].length) return 0

  return score
}
