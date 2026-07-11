import { DESCRIBE_UNIT_GRAMS } from '@shared/nutrition'
import { resolveEstimateAnchor } from './nutritionEstimates'
import {
  BRAND_HINTS,
  COMPOUND_UNITS,
  PACKAGED_FOOD_HINTS,
  protectCompoundPhrases,
  normalizeDescribeText,
  isRecognizedUnitKey,
  normalizeUnit,
  COMPOUND_DISH_PHRASES,
  expandComboMeal,
  isBeveragePhrase
} from '@shared/nutritionDescribeLexicon'

export interface ParsedMealChunk {
  quantity: number
  unitHint: string | null
  phrase: string
  preferBranded: boolean
  preferPackaged: boolean
  /** True when this row came from a combo expansion (fries, drink, etc.). */
  assumed?: boolean
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
}

function normalizeLeadingWordNumber(segment: string): string {
  return segment.replace(
    /^(one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
    (match) => String(WORD_NUMBERS[match.toLowerCase()])
  )
}

function preferFlagsForPhrase(phrase: string): { preferBranded: boolean; preferPackaged: boolean } {
  const lower = phrase.toLowerCase()
  const preferBranded = BRAND_HINTS.some((hint) => lower.includes(hint))
  const preferPackaged =
    preferBranded || PACKAGED_FOOD_HINTS.some((hint) => lower.includes(hint))
  return { preferBranded, preferPackaged }
}

function splitMealSegments(text: string): string[] {
  const protectedText = protectCompoundPhrases(text)
  return protectedText
    .split(/\s*,\s*|\s*\+\s*|\s+\band\b\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

function splitCompoundPhrase(phrase: string): string[] {
  const lower = phrase.toLowerCase().trim()
  if (!phrase.includes(' and ')) return [phrase]
  if (COMPOUND_DISH_PHRASES.some((dish) => lower.includes(dish.toLowerCase()))) return [phrase]
  if (resolveEstimateAnchor(phrase)) return [phrase]

  const parts = phrase
    .split(/\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)

  return parts.length > 1 ? parts : [phrase]
}

function mergeAmbiguousParts(parts: string[]): string[] {
  const result: string[] = []
  let index = 0

  while (index < parts.length) {
    const part = parts[index]
    const next = parts[index + 1]

    if (
      next &&
      part.length <= 14 &&
      !resolveEstimateAnchor(part) &&
      (next.includes('plate') || resolveEstimateAnchor(`${part} ${next}`))
    ) {
      result.push(`${part} ${next}`)
      index += 2
      continue
    }

    result.push(part)
    index += 1
  }

  return result
}

function inferUnitForPart(part: string, fallback: string | null): string | null {
  const lower = part.toLowerCase()
  if (lower === 'rice' || lower.endsWith(' rice')) return 'bowl'
  if (lower.includes('plate')) return 'plate'
  if (/\bbowl\b/.test(lower) && !lower.startsWith('bowl of')) return 'bowl'
  if (lower === 'toast' || lower.endsWith(' toast')) return 'slice'
  if (lower === 'egg' || lower === 'eggs' || lower.endsWith(' eggs')) return null
  return fallback
}

function expandParsedChunks(chunk: ParsedMealChunk): ParsedMealChunk[] {
  if (!chunk.phrase.includes(' and ')) return [chunk]

  const parts = mergeAmbiguousParts(splitCompoundPhrase(chunk.phrase))
  if (parts.length <= 1) return [chunk]

  return parts.map((part) => {
    const flags = preferFlagsForPhrase(part)
    return {
      ...chunk,
      phrase: part,
      unitHint: inferUnitForPart(part, chunk.unitHint),
      ...flags
    }
  })
}

function tryUnitOfPattern(
  segment: string,
  flags: { preferBranded: boolean; preferPackaged: boolean }
): ParsedMealChunk | null {
  const withQty = segment.match(
    /^(?:(\d+(?:\.\d+)?)|(?:a|an|one))\s+(\w+)\s+of\s+(.+)$/i
  )
  if (withQty && isRecognizedUnitKey(withQty[2], DESCRIBE_UNIT_GRAMS)) {
    const qtyRaw = withQty[1]
    return {
      quantity: qtyRaw ? Number(qtyRaw) : 1,
      unitHint: normalizeUnit(withQty[2], DESCRIBE_UNIT_GRAMS),
      phrase: withQty[3].trim(),
      ...flags
    }
  }

  const bare = segment.match(/^(\w+)\s+of\s+(.+)$/i)
  if (bare && isRecognizedUnitKey(bare[1], DESCRIBE_UNIT_GRAMS)) {
    return {
      quantity: 1,
      unitHint: normalizeUnit(bare[1], DESCRIBE_UNIT_GRAMS),
      phrase: bare[2].trim(),
      ...flags
    }
  }

  return null
}

export function parseChunk(segment: string): ParsedMealChunk {
  segment = normalizeLeadingWordNumber(normalizeDescribeText(segment))
  const flags = preferFlagsForPhrase(segment)

  for (const [compound, unit] of Object.entries(COMPOUND_UNITS)) {
    const compoundQty = segment.match(
      new RegExp(`^(\\d+(?:\\.\\d+)?)\\s+${compound.replace(/\s+/g, '\\s+')}\\s+(?:of\\s+)?(.+)$`, 'i')
    )
    if (compoundQty) {
      return {
        quantity: Number(compoundQty[1]),
        unitHint: unit,
        phrase: compoundQty[2].trim(),
        ...flags
      }
    }
    const articleCompound = segment.match(
      new RegExp(`^(?:a|an|one)\\s+${compound.replace(/\s+/g, '\\s+')}\\s+(?:of\\s+)?(.+)$`, 'i')
    )
    if (articleCompound) {
      return {
        quantity: 1,
        unitHint: unit,
        phrase: articleCompound[1].trim(),
        ...flags
      }
    }
  }

  const unitOf = tryUnitOfPattern(segment, flags)
  if (unitOf) return unitOf

  const leadingQty = segment.match(/^(\d+(?:\.\d+)?)\s*(?:[x×]\s*)?(\w+)\s+(?:of\s+)?(.+)$/i)
  if (leadingQty && isRecognizedUnitKey(leadingQty[2], DESCRIBE_UNIT_GRAMS)) {
    return {
      quantity: Number(leadingQty[1]),
      unitHint: normalizeUnit(leadingQty[2], DESCRIBE_UNIT_GRAMS),
      phrase: leadingQty[3].trim(),
      ...flags
    }
  }

  const articleQty = segment.match(/^(?:a|an|one)\s+(\w+)\s+(?:of\s+)?(.+)$/i)
  if (articleQty && isRecognizedUnitKey(articleQty[1], DESCRIBE_UNIT_GRAMS)) {
    return {
      quantity: 1,
      unitHint: normalizeUnit(articleQty[1], DESCRIBE_UNIT_GRAMS),
      phrase: articleQty[2].trim(),
      ...flags
    }
  }

  const articleOnly = segment.match(/^(?:a|an|one)\s+(.+)$/i)
  if (articleOnly) {
    return {
      quantity: 1,
      unitHint: null,
      phrase: articleOnly[1].trim(),
      ...flags
    }
  }

  const leadingOnly = segment.match(/^(\d+(?:\.\d+)?)\s+(.+)$/i)
  if (leadingOnly) {
    return {
      quantity: Number(leadingOnly[1]),
      unitHint: null,
      phrase: leadingOnly[2].trim(),
      ...flags
    }
  }

  return {
    quantity: 1,
    unitHint: null,
    phrase: segment,
    ...flags
  }
}

export function parseMealText(text: string): ParsedMealChunk[] {
  const normalized = normalizeDescribeText(text)
  if (!normalized) return []

  const segments = splitMealSegments(normalized)
  // "big mac meal and a milkshake": the user named their drink in another
  // segment, so the combo's assumed soft drink is substituted out (QA2-12).
  const comboBySegment = segments.map((segment) => expandComboMeal(segment))
  const beverageNamedElsewhere = segments.some(
    (segment, index) => !comboBySegment[index] && isBeveragePhrase(segment)
  )
  return segments
    .flatMap((segment, segmentIndex) => {
      // Combo check per segment, so "big mac meal and a milkshake" keeps the milkshake.
      const comboItems = comboBySegment[segmentIndex]?.filter(
        (item) => !(item.assumed && beverageNamedElsewhere && isBeveragePhrase(item.phrase))
      )
      if (comboItems) {
        return comboItems.map((item) => {
          const flags = preferFlagsForPhrase(item.phrase)
          return {
            quantity: item.quantity,
            unitHint: item.unitHint ?? inferUnitForPart(item.phrase, null),
            phrase: item.phrase,
            assumed: item.assumed,
            ...flags
          }
        })
      }
      return expandParsedChunks(parseChunk(segment))
    })
    .map((chunk) => {
      if (chunk.unitHint) return chunk
      const inferred = inferUnitForPart(chunk.phrase, null)
      return inferred ? { ...chunk, unitHint: inferred } : chunk
    })
}

/** Regression cases — parse only, no network. */
export const DESCRIBE_PARSE_FIXTURES: Array<{
  input: string
  expect: Array<{
    quantity: number
    unitHint: string | null
    phrase: string
    assumed?: boolean
  }>
}> = [
  {
    input: '2 scoops icecream and cone',
    expect: [
      { quantity: 2, unitHint: 'scoop', phrase: 'ice cream' },
      { quantity: 1, unitHint: null, phrase: 'cone' }
    ]
  },
  {
    input: 'icecream and cone',
    expect: [
      { quantity: 1, unitHint: null, phrase: 'ice cream' },
      { quantity: 1, unitHint: null, phrase: 'cone' }
    ]
  },
  {
    input: 'two scopps of ice cream and cone',
    expect: [
      { quantity: 2, unitHint: 'scoop', phrase: 'ice cream' },
      { quantity: 1, unitHint: null, phrase: 'cone' }
    ]
  },
  {
    input: 'one ice cream cone',
    expect: [{ quantity: 1, unitHint: null, phrase: 'ice cream cone' }]
  },
  {
    input: 'scopps of vanilla',
    expect: [{ quantity: 1, unitHint: 'scoop', phrase: 'vanilla' }]
  },
  {
    input: 'one slize of cheese pizza',
    expect: [{ quantity: 1, unitHint: 'slice', phrase: 'cheese pizza' }]
  },
  {
    input: '2 slices pepperoni pizza, 1 glass apple juice',
    expect: [
      { quantity: 2, unitHint: 'slice', phrase: 'pepperoni pizza' },
      { quantity: 1, unitHint: 'glass', phrase: 'apple juice' }
    ]
  },
  {
    input: 'mac and cheese',
    expect: [{ quantity: 1, unitHint: null, phrase: 'mac & cheese' }]
  },
  {
    input: 'a bowl of rice and teriyaki chicken',
    expect: [
      { quantity: 1, unitHint: 'bowl', phrase: 'rice' },
      { quantity: 1, unitHint: null, phrase: 'teriyaki chicken' }
    ]
  },
  {
    input: '3 chicken wings and a glass of water',
    expect: [
      { quantity: 3, unitHint: null, phrase: 'chicken wings' },
      { quantity: 1, unitHint: 'glass', phrase: 'water' }
    ]
  },
  {
    input: '1 handful of chips',
    expect: [{ quantity: 1, unitHint: 'handful', phrase: 'chips' }]
  },
  {
    input: '2 eggs and toast',
    expect: [
      { quantity: 2, unitHint: null, phrase: 'eggs' },
      { quantity: 1, unitHint: 'slice', phrase: 'toast' }
    ]
  },
  {
    input: 'oatmeal and coffee for breakfast',
    expect: [
      { quantity: 1, unitHint: null, phrase: 'oatmeal' },
      { quantity: 1, unitHint: null, phrase: 'coffee' }
    ]
  },
  {
    input: 'breakfast: 2 eggs and toast',
    expect: [
      { quantity: 2, unitHint: null, phrase: 'eggs' },
      { quantity: 1, unitHint: 'slice', phrase: 'toast' }
    ]
  },
  {
    input: 'chick fil a chicken sandwich meal',
    expect: [
      { quantity: 1, unitHint: 'sandwich', phrase: 'chick fil a chicken sandwich', assumed: false },
      { quantity: 1, unitHint: 'serving', phrase: 'medium fries', assumed: true },
      { quantity: 1, unitHint: 'cup', phrase: 'medium soft drink', assumed: true }
    ]
  },
  {
    input: 'big mac meal large',
    expect: [
      { quantity: 1, unitHint: null, phrase: 'big mac', assumed: false },
      { quantity: 1, unitHint: 'serving', phrase: 'large fries', assumed: true },
      { quantity: 1, unitHint: 'cup', phrase: 'large soft drink', assumed: true }
    ]
  },
  {
    input: 'chipotle bowl',
    expect: [{ quantity: 1, unitHint: 'bowl', phrase: 'chipotle bowl' }]
  },
  {
    // QA2-12: the named milkshake substitutes the combo's assumed soft drink.
    input: 'big mac meal and a milkshake',
    expect: [
      { quantity: 1, unitHint: null, phrase: 'big mac', assumed: false },
      { quantity: 1, unitHint: 'serving', phrase: 'medium fries', assumed: true },
      { quantity: 1, unitHint: null, phrase: 'milkshake' }
    ]
  },
  {
    // QA2-12: in-segment named drink replaces the assumed one.
    input: 'quarter pounder meal with a coke',
    expect: [
      { quantity: 1, unitHint: null, phrase: 'quarter pounder with cheese', assumed: false },
      { quantity: 1, unitHint: 'serving', phrase: 'medium fries', assumed: true },
      { quantity: 1, unitHint: 'cup', phrase: 'coke', assumed: false }
    ]
  },
  {
    // QA2-12 guard: no drink named → assumed soft drink stays.
    input: 'mcchicken meal and an apple pie',
    expect: [
      { quantity: 1, unitHint: null, phrase: 'mcchicken', assumed: false },
      { quantity: 1, unitHint: 'serving', phrase: 'medium fries', assumed: true },
      { quantity: 1, unitHint: 'cup', phrase: 'medium soft drink', assumed: true },
      { quantity: 1, unitHint: null, phrase: 'apple pie' }
    ]
  },
  {
    input: 'subway footlong combo',
    expect: [
      { quantity: 1, unitHint: null, phrase: 'subway footlong sandwich', assumed: false },
      { quantity: 1, unitHint: 'serving', phrase: 'bag of chips', assumed: true },
      { quantity: 1, unitHint: 'cup', phrase: 'medium soft drink', assumed: true }
    ]
  }
]

export function runDescribeParseFixtures(): { ok: boolean; failures: string[] } {
  const failures: string[] = []

  for (const fixture of DESCRIBE_PARSE_FIXTURES) {
    const chunks = parseMealText(fixture.input)
    const actual = chunks.map((c) => ({
      quantity: c.quantity,
      unitHint: c.unitHint,
      phrase: c.phrase,
      ...(c.assumed !== undefined ? { assumed: c.assumed } : {})
    }))

    const match =
      actual.length === fixture.expect.length &&
      actual.every((row, i) => {
        const exp = fixture.expect[i]
        const assumedOk =
          exp.assumed === undefined || row.assumed === exp.assumed
        return (
          row.quantity === exp.quantity &&
          row.unitHint === exp.unitHint &&
          row.phrase.toLowerCase() === exp.phrase.toLowerCase() &&
          assumedOk
        )
      })

    if (!match) {
      failures.push(
        `${fixture.input} → expected ${JSON.stringify(fixture.expect)} got ${JSON.stringify(actual)}`
      )
    }
  }

  return { ok: failures.length === 0, failures }
}
