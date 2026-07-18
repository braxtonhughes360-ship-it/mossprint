/** Offline serving anchors — review plate required; USDA/OFF preferred when network works. */
export interface FoodEstimateAnchor {
  match: string[]
  label: string
  unitKcal: number
  proteinG: number
  carbsG: number
  fatG: number
  unitHint: string
  gramWeight: number
}

export const FOOD_ESTIMATE_ANCHORS: FoodEstimateAnchor[] = [
  {
    match: [
      'chick fil a chicken sandwich',
      'chick-fil-a chicken sandwich',
      'chickfila chicken sandwich',
      'cfa chicken sandwich'
    ],
    label: 'Chicken sandwich (Chick-fil-A)',
    unitKcal: 440,
    proteinG: 28,
    carbsG: 41,
    fatG: 18,
    unitHint: 'sandwich',
    gramWeight: 210
  },
  {
    match: [
      'chick fil a 8 piece nuggets',
      'chick fil a nuggets meal',
      'chick-fil-a 8 piece nuggets',
      'cfa 8 piece nuggets'
    ],
    label: 'Nuggets 8 pc (Chick-fil-A)',
    unitKcal: 250,
    proteinG: 27,
    carbsG: 11,
    fatG: 12,
    unitHint: 'serving',
    gramWeight: 113
  },
  {
    match: ['big mac'],
    label: 'Big Mac (McDonald\'s)',
    unitKcal: 590,
    proteinG: 26,
    carbsG: 45,
    fatG: 34,
    unitHint: 'serving',
    gramWeight: 215
  },
  {
    match: ['quarter pounder with cheese', 'quarter pounder'],
    label: 'Quarter Pounder (McDonald\'s)',
    unitKcal: 520,
    proteinG: 30,
    carbsG: 42,
    fatG: 26,
    unitHint: 'serving',
    gramWeight: 200
  },
  {
    match: ['mcchicken'],
    label: 'McChicken (McDonald\'s)',
    unitKcal: 400,
    proteinG: 14,
    carbsG: 39,
    fatG: 21,
    unitHint: 'serving',
    gramWeight: 145
  },
  {
    match: ['10 piece mcnuggets', 'mcnuggets 10', '10 pc mcnuggets'],
    label: 'McNuggets 10 pc (McDonald\'s)',
    unitKcal: 420,
    proteinG: 23,
    carbsG: 26,
    fatG: 24,
    unitHint: 'serving',
    gramWeight: 162
  },
  {
    match: ['filet o fish', 'filet-o-fish'],
    label: 'Filet-O-Fish (McDonald\'s)',
    unitKcal: 390,
    proteinG: 16,
    carbsG: 38,
    fatG: 19,
    unitHint: 'serving',
    gramWeight: 136
  },
  {
    match: ['whopper'],
    label: 'Whopper (Burger King)',
    unitKcal: 660,
    proteinG: 28,
    carbsG: 49,
    fatG: 40,
    unitHint: 'serving',
    gramWeight: 270
  },
  {
    match: ['dave single burger', 'daves single', "dave's single"],
    label: 'Dave\'s Single (Wendy\'s)',
    unitKcal: 570,
    proteinG: 29,
    carbsG: 39,
    fatG: 34,
    unitHint: 'serving',
    gramWeight: 220
  },
  {
    match: ['crunchwrap supreme'],
    label: 'Crunchwrap Supreme (Taco Bell)',
    unitKcal: 530,
    proteinG: 16,
    carbsG: 47,
    fatG: 29,
    unitHint: 'serving',
    gramWeight: 254
  },
  {
    match: ['kfc 2 piece chicken', 'kfc 2 piece'],
    label: '2 pc chicken (KFC)',
    unitKcal: 380,
    proteinG: 28,
    carbsG: 8,
    fatG: 26,
    unitHint: 'serving',
    gramWeight: 180
  },
  {
    match: ['subway footlong sandwich', 'subway footlong'],
    label: 'Footlong sandwich (Subway avg)',
    unitKcal: 480,
    proteinG: 22,
    carbsG: 52,
    fatG: 18,
    unitHint: 'serving',
    gramWeight: 280
  },
  {
    match: ['chipotle bowl', 'chicken chipotle bowl', 'steak chipotle bowl', 'burrito bowl chipotle'],
    label: 'Burrito bowl (Chipotle avg)',
    unitKcal: 665,
    proteinG: 42,
    carbsG: 55,
    fatG: 28,
    unitHint: 'bowl',
    gramWeight: 450
  },
  {
    match: ['bag of chips', 'chips bag', 'lays classic chips'],
    label: 'Chips (single bag)',
    unitKcal: 240,
    proteinG: 3,
    carbsG: 23,
    fatG: 15,
    unitHint: 'serving',
    gramWeight: 42
  },
  {
    match: ['small fries', 'small french fries'],
    label: 'Small fries (fast food)',
    unitKcal: 220,
    proteinG: 3,
    carbsG: 29,
    fatG: 10,
    unitHint: 'serving',
    gramWeight: 71
  },
  {
    match: ['medium fries', 'medium french fries'],
    label: 'Medium fries (fast food)',
    unitKcal: 320,
    proteinG: 4,
    carbsG: 43,
    fatG: 15,
    unitHint: 'serving',
    gramWeight: 117
  },
  {
    match: ['large fries', 'large french fries'],
    label: 'Large fries (fast food)',
    unitKcal: 480,
    proteinG: 6,
    carbsG: 64,
    fatG: 23,
    unitHint: 'serving',
    gramWeight: 154
  },
  {
    match: ['small soft drink', 'small soda', 'small coke'],
    label: 'Soft drink (small)',
    unitKcal: 150,
    proteinG: 0,
    carbsG: 39,
    fatG: 0,
    unitHint: 'cup',
    gramWeight: 350
  },
  {
    match: ['medium soft drink', 'medium soda', 'medium coke', 'medium drink'],
    label: 'Soft drink (medium)',
    unitKcal: 210,
    proteinG: 0,
    carbsG: 56,
    fatG: 0,
    unitHint: 'cup',
    gramWeight: 470
  },
  {
    match: ['large soft drink', 'large soda', 'large coke', 'large drink'],
    label: 'Soft drink (large)',
    unitKcal: 290,
    proteinG: 0,
    carbsG: 77,
    fatG: 0,
    unitHint: 'cup',
    gramWeight: 650
  },
  {
    match: ['chipotle burrito', 'chicken burrito', 'burrito chipotle'],
    label: 'Chicken burrito (Chipotle avg)',
    unitKcal: 820,
    proteinG: 42,
    carbsG: 78,
    fatG: 35,
    unitHint: 'burrito',
    gramWeight: 450
  },
  {
    match: ['frosted lemonade', 'lemonade chick'],
    label: 'Frosted lemonade (Chick-fil-A)',
    unitKcal: 320,
    proteinG: 0,
    carbsG: 65,
    fatG: 6,
    unitHint: 'cup',
    gramWeight: 380
  },
  {
    match: ['pepperoni pizza'],
    label: 'Pepperoni pizza (avg slice)',
    unitKcal: 285,
    proteinG: 12,
    carbsG: 33,
    fatG: 12,
    unitHint: 'slice',
    gramWeight: 100
  },
  {
    match: ['cheese pizza', 'margherita pizza'],
    label: 'Cheese pizza (avg slice)',
    unitKcal: 250,
    proteinG: 11,
    carbsG: 31,
    fatG: 9,
    unitHint: 'slice',
    gramWeight: 100
  },
  {
    match: ['pizza slice', '^pizza$'],
    label: 'Pizza (avg slice)',
    unitKcal: 265,
    proteinG: 11,
    carbsG: 32,
    fatG: 10,
    unitHint: 'slice',
    gramWeight: 100
  },
  {
    match: ['apple juice'],
    label: 'Apple juice',
    unitKcal: 110,
    proteinG: 0.5,
    carbsG: 26,
    fatG: 0.2,
    unitHint: 'glass',
    gramWeight: 240
  },
  {
    match: ['orange juice'],
    label: 'Orange juice',
    unitKcal: 112,
    proteinG: 1.7,
    carbsG: 26,
    fatG: 0.5,
    unitHint: 'glass',
    gramWeight: 240
  },
  {
    match: ['grape juice'],
    label: 'Grape juice',
    unitKcal: 120,
    proteinG: 0.5,
    carbsG: 28,
    fatG: 0.2,
    unitHint: 'glass',
    gramWeight: 240
  },
  {
    match: ['chicken breast', 'grilled chicken breast', 'boneless chicken breast'],
    label: 'Chicken breast (cooked)',
    unitKcal: 280,
    proteinG: 52,
    carbsG: 0,
    fatG: 6,
    unitHint: 'breast',
    gramWeight: 172
  },
  {
    match: [
      'reeses peanut butter cereal',
      'reese peanut butter cereal',
      "reese's peanut butter cereal",
      'reeses cereal',
      'reese cereal',
      "reese's cereal",
      'reeses puffs',
      "reese's puffs"
    ],
    label: "Reese's Puffs cereal (1 cup, label)",
    unitKcal: 160,
    proteinG: 3,
    carbsG: 30,
    fatG: 4.5,
    unitHint: 'cup',
    gramWeight: 39
  },
  {
    match: [
      "cap'n crunch cereal",
      'capn crunch cereal',
      'captain crunch cereal',
      'captain crunch',
      "cap'n crunch"
    ],
    label: "Cap'n Crunch cereal (1 cup, label)",
    unitKcal: 150,
    proteinG: 2,
    carbsG: 33,
    fatG: 2,
    unitHint: 'cup',
    gramWeight: 38
  },
  {
    match: ['glass of milk', 'cup of milk', '^milk$'],
    label: 'Milk (whole)',
    unitKcal: 149,
    proteinG: 8,
    carbsG: 12,
    fatG: 8,
    unitHint: 'cup',
    gramWeight: 244
  },
  {
    match: ['milk with cereal', 'splash of milk'],
    label: 'Milk (with cereal, ½ cup skim)',
    unitKcal: 70,
    proteinG: 3.5,
    carbsG: 5,
    fatG: 2.5,
    unitHint: 'serving',
    gramWeight: 120
  },
  {
    match: [
      'bowl of alfredo and chicken',
      'alfredo and chicken',
      'alfredo & chicken',
      'chicken alfredo',
      'chicken and alfredo'
    ],
    label: 'Chicken alfredo (bowl)',
    unitKcal: 520,
    proteinG: 28,
    carbsG: 48,
    fatG: 22,
    unitHint: 'bowl',
    gramWeight: 350
  },
  {
    match: [
      'chick fil a frosted lemonade',
      'chick-fil-a frosted lemonade',
      'chickfila frosted lemonade'
    ],
    label: 'Frosted lemonade (Chick-fil-A)',
    unitKcal: 320,
    proteinG: 0,
    carbsG: 65,
    fatG: 6,
    unitHint: 'cup',
    gramWeight: 380
  },
  {
    match: [
      'teriyaki rice plate',
      'teriyaki chicken rice',
      'chicken teriyaki rice',
      'teriyaki chicken plate',
      'rice plate teriyaki',
      'teriyaki plate'
    ],
    label: 'Teriyaki chicken rice plate',
    unitKcal: 480,
    proteinG: 28,
    carbsG: 58,
    fatG: 14,
    unitHint: 'plate',
    gramWeight: 350
  },
  {
    match: ['teriyaki chicken', 'chicken teriyaki'],
    label: 'Teriyaki chicken',
    unitKcal: 320,
    proteinG: 29,
    carbsG: 18,
    fatG: 12,
    unitHint: 'serving',
    gramWeight: 200
  },
  {
    match: ['bowl of rice', 'white rice', 'rice cooked', 'steamed rice'],
    label: 'White rice (cooked)',
    unitKcal: 205,
    proteinG: 4.3,
    carbsG: 45,
    fatG: 0.4,
    unitHint: 'cup',
    gramWeight: 240
  },
  {
    match: ['^rice$'],
    label: 'White rice (cooked)',
    unitKcal: 205,
    proteinG: 4.3,
    carbsG: 45,
    fatG: 0.4,
    unitHint: 'bowl',
    gramWeight: 240
  },
  {
    match: ['protein shake', 'whey protein'],
    label: 'Protein shake',
    unitKcal: 160,
    proteinG: 30,
    carbsG: 6,
    fatG: 2,
    unitHint: 'serving',
    gramWeight: 330
  },
  {
    match: ['banana'],
    label: 'Banana',
    unitKcal: 105,
    proteinG: 1.3,
    carbsG: 27,
    fatG: 0.4,
    unitHint: 'serving',
    gramWeight: 118
  },
  {
    match: ['fried egg'],
    label: 'Fried egg',
    unitKcal: 90,
    proteinG: 6.3,
    carbsG: 0.6,
    fatG: 7,
    unitHint: 'serving',
    gramWeight: 50
  },
  {
    match: ['scrambled eggs', 'scrambled egg'],
    label: 'Scrambled eggs',
    unitKcal: 140,
    proteinG: 10,
    carbsG: 2,
    fatG: 10,
    unitHint: 'serving',
    gramWeight: 100
  },
  {
    match: ['^egg$', '^eggs$'],
    label: 'Egg (large)',
    unitKcal: 78,
    proteinG: 6.3,
    carbsG: 0.6,
    fatG: 5.3,
    unitHint: 'serving',
    gramWeight: 50
  },
  {
    match: ['toast', 'slice of toast', 'bread toast', 'buttered toast'],
    label: 'Toast (slice)',
    unitKcal: 80,
    proteinG: 3,
    carbsG: 15,
    fatG: 1,
    unitHint: 'slice',
    gramWeight: 30
  },
  {
    match: ['oatmeal', 'oats', 'bowl of oatmeal'],
    label: 'Oatmeal (cooked)',
    unitKcal: 150,
    proteinG: 5,
    carbsG: 27,
    fatG: 3,
    unitHint: 'bowl',
    gramWeight: 240
  },
  {
    match: ['coffee', 'black coffee', 'cup of coffee'],
    label: 'Coffee (black)',
    unitKcal: 2,
    proteinG: 0.3,
    carbsG: 0,
    fatG: 0,
    unitHint: 'cup',
    gramWeight: 240
  },
  {
    match: ['latte', 'cafe latte'],
    label: 'Latte',
    unitKcal: 190,
    proteinG: 10,
    carbsG: 18,
    fatG: 7,
    unitHint: 'cup',
    gramWeight: 350
  },
  {
    match: ['salad', 'side salad', 'garden salad'],
    label: 'Side salad',
    unitKcal: 35,
    proteinG: 2,
    carbsG: 6,
    fatG: 1,
    unitHint: 'serving',
    gramWeight: 85
  },
  {
    match: ['honey', 'drizzle of honey', 'spoon of honey'],
    label: 'Honey',
    unitKcal: 64,
    proteinG: 0.1,
    carbsG: 17,
    fatG: 0,
    unitHint: 'tbsp',
    gramWeight: 21
  },
  {
    match: ['bacon', 'bacon strip', 'strips of bacon'],
    label: 'Bacon strip',
    unitKcal: 43,
    proteinG: 3,
    carbsG: 0.1,
    fatG: 3.3,
    unitHint: 'strip',
    gramWeight: 8
  },
  {
    match: ['cheeseburger'],
    label: 'Cheeseburger',
    unitKcal: 580,
    proteinG: 28,
    carbsG: 45,
    fatG: 32,
    unitHint: 'serving',
    gramWeight: 200
  },
  {
    match: ['burger', 'hamburger'],
    label: 'Hamburger',
    unitKcal: 540,
    proteinG: 25,
    carbsG: 45,
    fatG: 28,
    unitHint: 'serving',
    gramWeight: 200
  },
  {
    match: ['turkey sandwich'],
    label: 'Turkey sandwich',
    unitKcal: 320,
    proteinG: 20,
    carbsG: 36,
    fatG: 10,
    unitHint: 'serving',
    gramWeight: 180
  },
  {
    match: ['ham sandwich'],
    label: 'Ham sandwich',
    unitKcal: 360,
    proteinG: 18,
    carbsG: 38,
    fatG: 16,
    unitHint: 'serving',
    gramWeight: 180
  },
  {
    match: ['sandwich'],
    label: 'Sandwich',
    unitKcal: 350,
    proteinG: 18,
    carbsG: 38,
    fatG: 14,
    unitHint: 'serving',
    gramWeight: 180
  },
  {
    match: ['avocado', 'half avocado'],
    label: 'Avocado (half)',
    unitKcal: 160,
    proteinG: 2,
    carbsG: 9,
    fatG: 15,
    unitHint: 'serving',
    gramWeight: 100
  },
  {
    match: ['greek yogurt', 'yogurt'],
    label: 'Greek yogurt',
    unitKcal: 130,
    proteinG: 17,
    carbsG: 8,
    fatG: 4,
    unitHint: 'cup',
    gramWeight: 170
  },
  {
    match: ['ice cream and cone', 'ice cream on a cone', 'ice cream cone'],
    label: 'Ice cream cone (serving)',
    unitKcal: 280,
    proteinG: 4,
    carbsG: 38,
    fatG: 14,
    unitHint: 'serving',
    gramWeight: 120
  },
  {
    match: ['^cone$', 'waffle cone', 'sugar cone', 'cake cone'],
    label: 'Waffle cone (empty)',
    unitKcal: 50,
    proteinG: 1,
    carbsG: 8,
    fatG: 2,
    unitHint: 'serving',
    gramWeight: 15
  },
  {
    match: [
      'vanilla ice cream',
      'chocolate ice cream',
      'strawberry ice cream',
      'ice cream',
      'icecream',
      'scoops of ice cream',
      'scoop of ice cream',
      'scoops of icecream',
      'scoop of icecream'
    ],
    label: 'Ice cream (scoop)',
    unitKcal: 137,
    proteinG: 2.3,
    carbsG: 16,
    fatG: 7,
    unitHint: 'scoop',
    gramWeight: 65
  },
  {
    match: ['^vanilla$', 'vanilla scoop', 'scoops of vanilla', 'scoop of vanilla'],
    label: 'Vanilla ice cream (scoop)',
    unitKcal: 137,
    proteinG: 2.3,
    carbsG: 16,
    fatG: 7,
    unitHint: 'scoop',
    gramWeight: 65
  },
  {
    match: ['french fries', 'fries', 'side of fries'],
    label: 'French fries',
    unitKcal: 365,
    proteinG: 4,
    carbsG: 48,
    fatG: 17,
    unitHint: 'serving',
    gramWeight: 117
  },
  {
    match: ['chicken wing', 'chicken wings', 'wings'],
    label: 'Chicken wing',
    unitKcal: 99,
    proteinG: 9.4,
    carbsG: 0,
    fatG: 6.4,
    unitHint: 'wing',
    gramWeight: 45
  },
  {
    match: ['handful of chips', 'chips', 'potato chips'],
    label: 'Potato chips (handful)',
    unitKcal: 152,
    proteinG: 2,
    carbsG: 15,
    fatG: 10,
    unitHint: 'handful',
    gramWeight: 30
  },
  {
    match: ['cookie', 'cookies'],
    label: 'Cookie',
    unitKcal: 148,
    proteinG: 2,
    carbsG: 20,
    fatG: 7,
    unitHint: 'serving',
    gramWeight: 30
  },
  {
    match: ['donut', 'doughnut'],
    label: 'Donut',
    unitKcal: 260,
    proteinG: 4,
    carbsG: 31,
    fatG: 14,
    unitHint: 'serving',
    gramWeight: 60
  }
]

/** Tokens too generic to drive a display label — use anchor.label instead. */
const GENERIC_MATCH_TOKENS = new Set([
  'pizza',
  'rice',
  'burger',
  'hamburger',
  'sandwich',
  'salad',
  'fries',
  'chips',
  'coffee',
  'cone',
  'yogurt',
  'cookie',
  'cookies',
  'wings',
  'donut',
  'doughnut',
  'bacon',
  'latte',
  'oatmeal',
  'oats',
  'toast',
  'banana',
  'avocado',
  'honey',
  'ice cream',
  'icecream',
  'egg',
  'eggs'
])

interface EstimateMatchScore {
  anchor: FoodEstimateAnchor
  token: string
  score: number
}

function normalizeForAnchorMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreEstimateToken(phrase: string, token: string): number | null {
  const lower = normalizeForAnchorMatch(phrase)
  const rawToken = token.toLowerCase().trim()
  if (rawToken.startsWith('^') && rawToken.endsWith('$')) {
    const exact = normalizeForAnchorMatch(rawToken.slice(1, -1))
    if (lower !== exact) return null
    return exact.length + 10
  }

  const tokenLower = normalizeForAnchorMatch(rawToken)
  let matched = false
  let score = tokenLower.length

  if (lower === tokenLower) {
    matched = true
    score += 5
  } else if (lower.includes(tokenLower)) {
    matched = true
  }

  return matched ? score : null
}

function findBestEstimateMatch(phrase: string): EstimateMatchScore | null {
  const normalizedPhrase = normalizeForAnchorMatch(phrase)
  let best: EstimateMatchScore | null = null

  for (const anchor of FOOD_ESTIMATE_ANCHORS) {
    for (const token of anchor.match) {
      const score = scoreEstimateToken(normalizedPhrase, token)
      if (score !== null && (!best || score > best.score)) {
        best = { anchor, token, score }
      }
    }
  }

  return best
}

function titleCasePhrase(text: string): string {
  return text.replace(/\b\w/g, (char) => char.toUpperCase())
}

export function resolveEstimateAnchor(phrase: string): FoodEstimateAnchor | null {
  return findBestEstimateMatch(phrase)?.anchor ?? null
}

/** Prefer the matched food phrase over a shared anchor default label. */
export function estimateDisplayLabel(phrase: string, anchor: FoodEstimateAnchor): string {
  const best = findBestEstimateMatch(phrase)
  if (!best || best.anchor !== anchor) {
    return anchor.label
  }

  const normalized = best.token.replace(/^\^|\$$/g, '').toLowerCase()
  if (GENERIC_MATCH_TOKENS.has(normalized) || normalized.length < 5) {
    return anchor.label
  }

  const titled = titleCasePhrase(normalized)
  const suffix = anchor.label.match(/(\([^)]+\))\s*$/)?.[1]
  return suffix ? `${titled} ${suffix}` : titled
}

/** Generic meal phrases with offline anchors — prefer estimate over OFF/USDA noise. */
export function isStrongEstimatePhrase(phrase: string): boolean {
  const best = findBestEstimateMatch(phrase)
  return best !== null && best.score >= 8
}

export const ESTIMATE_LABEL_REGRESSIONS: Array<{
  phrase: string
  mustInclude: string
  mustNotInclude?: string
}> = [
  { phrase: 'cheese pizza', mustInclude: 'cheese', mustNotInclude: 'pepperoni' },
  { phrase: 'pepperoni pizza', mustInclude: 'pepperoni' },
  { phrase: 'orange juice', mustInclude: 'orange', mustNotInclude: 'apple' },
  { phrase: 'grape juice', mustInclude: 'grape', mustNotInclude: 'apple' },
  { phrase: 'cheeseburger', mustInclude: 'cheeseburger', mustNotInclude: 'hamburger' },
  { phrase: 'ham sandwich', mustInclude: 'ham' },
  { phrase: 'turkey sandwich', mustInclude: 'turkey' },
  { phrase: 'chocolate ice cream', mustInclude: 'chocolate' },
  { phrase: 'strawberry ice cream', mustInclude: 'strawberry' },
  { phrase: 'fried egg', mustInclude: 'fried' },
  { phrase: 'scrambled eggs', mustInclude: 'scrambled' }
]

export function runEstimateLabelRegressions(): { ok: boolean; failures: string[] } {
  const failures: string[] = []

  for (const row of ESTIMATE_LABEL_REGRESSIONS) {
    const anchor = resolveEstimateAnchor(row.phrase)
    if (!anchor) {
      failures.push(`${row.phrase}: no anchor matched`)
      continue
    }

    const label = estimateDisplayLabel(row.phrase, anchor).toLowerCase()
    if (!label.includes(row.mustInclude.toLowerCase())) {
      failures.push(`${row.phrase}: label "${label}" missing "${row.mustInclude}"`)
    }
    if (row.mustNotInclude && label.includes(row.mustNotInclude.toLowerCase())) {
      failures.push(`${row.phrase}: label "${label}" incorrectly includes "${row.mustNotInclude}"`)
    }
  }

  return { ok: failures.length === 0, failures }
}

/** Label-backed serving sizes — General Mills / Quaker SmartLabel references. */
export const ESTIMATE_KCAL_ANCHOR_REGRESSIONS: Array<{
  phrase: string
  unitKcal: number
  gramWeight: number
}> = [
  { phrase: 'reeses peanut butter cereal', unitKcal: 160, gramWeight: 39 },
  { phrase: 'captain crunch cereal', unitKcal: 150, gramWeight: 38 }
]

export function runEstimateKcalAnchorRegressions(): { ok: boolean; failures: string[] } {
  const failures: string[] = []

  for (const row of ESTIMATE_KCAL_ANCHOR_REGRESSIONS) {
    const anchor = resolveEstimateAnchor(row.phrase)
    if (!anchor) {
      failures.push(`${row.phrase}: no anchor matched`)
      continue
    }
    if (anchor.unitKcal !== row.unitKcal) {
      failures.push(`${row.phrase}: expected ${row.unitKcal} kcal, got ${anchor.unitKcal}`)
    }
    if (anchor.gramWeight !== row.gramWeight) {
      failures.push(`${row.phrase}: expected ${row.gramWeight}g serving, got ${anchor.gramWeight}`)
    }
  }

  return { ok: failures.length === 0, failures }
}
