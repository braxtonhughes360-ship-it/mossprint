import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_KEYLEN = 64
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }

/** 512-word list — 12 picks ≈ 108 bits of entropy (local profile recovery). */
const RECOVERY_WORDS: readonly string[] = [
  'amber', 'anchor', 'april', 'arrow', 'atlas', 'audio', 'autumn', 'avenue', 'badge', 'bamboo',
  'banner', 'barrel', 'beacon', 'berry', 'birch', 'blade', 'blanket', 'blaze', 'bloom', 'bluff',
  'board', 'boulder', 'branch', 'brass', 'brick', 'bridge', 'bronze', 'brook', 'brush', 'bubble',
  'cabin', 'cactus', 'canal', 'candle', 'canvas', 'carbon', 'cargo', 'cedar', 'chain', 'chalk',
  'charm', 'cherry', 'chest', 'chime', 'cider', 'cipher', 'cliff', 'cloud', 'clover', 'coast',
  'cobalt', 'comet', 'compass', 'coral', 'cotton', 'couch', 'creek', 'crest', 'crisp', 'crown',
  'crystal', 'daisy', 'delta', 'denim', 'desert', 'diamond', 'dolphin', 'drift', 'dune', 'eagle',
  'earth', 'ember', 'engine', 'fable', 'falcon', 'fern', 'fiber', 'field', 'flame', 'flint',
  'flora', 'forest', 'forge', 'frost', 'galaxy', 'garden', 'garnet', 'glacier', 'globe', 'gold',
  'granite', 'grape', 'grass', 'harbor', 'hazel', 'helix', 'heron', 'hollow', 'honey', 'horizon',
  'ivory', 'jade', 'jasmine', 'jelly', 'jetty', 'jigsaw', 'journey', 'jungle', 'kernel', 'kettle',
  'knight', 'lagoon', 'lantern', 'latch', 'laurel', 'lemon', 'lichen', 'light', 'lilac', 'linen',
  'lotus', 'lunar', 'maple', 'marble', 'meadow', 'mercury', 'metal', 'metro', 'mint', 'mirror',
  'mist', 'mosaic', 'moss', 'motor', 'mountain', 'nebula', 'nectar', 'needle', 'nickel', 'night',
  'noble', 'north', 'nova', 'oak', 'ocean', 'olive', 'onyx', 'opal', 'orbit', 'orchid',
  'otter', 'oxide', 'oyster', 'paddle', 'palm', 'paper', 'parcel', 'pearl', 'pebble', 'pencil',
  'pepper', 'petal', 'piano', 'pilot', 'pine', 'pixel', 'planet', 'plasma', 'plate', 'plume',
  'polar', 'pond', 'prism', 'pulse', 'quartz', 'quill', 'rabbit', 'radar', 'rain', 'raven',
  'reef', 'ridge', 'river', 'robin', 'rocket', 'rose', 'rust', 'sage', 'sail', 'salmon',
  'sandal', 'satin', 'savanna', 'scarf', 'scout', 'shell', 'shield', 'shore', 'signal', 'silver',
  'siren', 'sketch', 'sky', 'slate', 'smoke', 'snow', 'solar', 'spark', 'spear', 'sphere',
  'spice', 'spine', 'spruce', 'square', 'stable', 'star', 'steel', 'stone', 'storm', 'stream',
  'summit', 'sunset', 'swan', 'swift', 'tangle', 'tapestry', 'terra', 'thistle', 'thorn', 'tide',
  'tiger', 'timber', 'token', 'topaz', 'torch', 'tower', 'trail', 'tulip', 'tunnel', 'turquoise',
  'twilight', 'umbrella', 'valley', 'velvet', 'violet', 'vista', 'voyage', 'walnut', 'wave', 'willow',
  'wind', 'window', 'winter', 'wisdom', 'wonder', 'wood', 'wool', 'yarn', 'yellow', 'zenith',
  'zephyr', 'zone', 'acorn', 'alpine', 'arcade', 'artist', 'aspect', 'attic', 'baker', 'ballad',
  'basket', 'beach', 'beetle', 'beyond', 'bison', 'blazer', 'breeze', 'bronco', 'bucket', 'butter',
  'canyon', 'carrot', 'castle', 'celery', 'center', 'circle', 'citron', 'clover', 'coffee', 'copper',
  'cosmos', 'cotton', 'cougar', 'cradle', 'crater', 'creek', 'cruise', 'currant', 'cypress', 'dagger',
  'dancer', 'decade', 'desert', 'detail', 'device', 'dinner', 'doctor', 'dragon', 'drawer', 'dream',
  'driver', 'dynamo', 'echo', 'editor', 'effect', 'elder', 'empire', 'energy', 'escape', 'estate',
  'fabric', 'factor', 'family', 'farmer', 'fathom', 'feather', 'festival', 'figure', 'filter', 'finger',
  'finish', 'fisher', 'flower', 'folder', 'forest', 'fossil', 'fountain', 'frame', 'friend', 'frozen',
  'future', 'gadget', 'garden', 'gather', 'gentle', 'ginger', 'giraffe', 'glider', 'glossy', 'golden',
  'gopher', 'gravel', 'green', 'grove', 'growth', 'guard', 'guitar', 'hammer', 'harvest', 'health',
  'hearth', 'helium', 'hermit', 'hidden', 'hiking', 'hollow', 'honest', 'hornet', 'hotel', 'house',
  'humble', 'hybrid', 'icon', 'igloo', 'impact', 'inbox', 'indigo', 'inland', 'insect', 'inside',
  'island', 'jacket', 'jester', 'jewel', 'jigsaw', 'jockey', 'jovial', 'joyful', 'jumper', 'jungle',
  'kayak', 'keeper', 'kernel', 'kettle', 'kindle', 'kitten', 'knight', 'label', 'ladder', 'lagoon',
  'laptop', 'latch', 'laugh', 'layer', 'leader', 'league', 'lemon', 'letter', 'level', 'light',
  'linen', 'liquid', 'listen', 'little', 'lively', 'lizard', 'local', 'logic', 'lonely', 'lotus',
  'lucky', 'lunar', 'lyric', 'magic', 'magnet', 'maiden', 'maker', 'mango', 'manor', 'marble',
  'market', 'master', 'matrix', 'meadow', 'melody', 'memory', 'mercury', 'method', 'middle', 'mighty',
  'mineral', 'mirror', 'mobile', 'model', 'modern', 'moment', 'monkey', 'mosaic', 'mother', 'motion',
  'mount', 'mouse', 'muffin', 'museum', 'music', 'mystic', 'narrow', 'nation', 'native', 'nature',
  'nectar', 'needle', 'neuron', 'nickel', 'night', 'noble', 'normal', 'north', 'notion', 'novel',
  'nurse', 'oasis', 'object', 'ocean', 'olive', 'onion', 'orange', 'orchid', 'origin', 'otter',
  'outdoor', 'oxide', 'oyster', 'paddle', 'painter', 'panda', 'panel', 'paper', 'parcel', 'party',
  'patch', 'pathway', 'patrol', 'pattern', 'peach', 'pearl', 'pebble', 'pencil', 'people', 'pepper',
  'perfect', 'petal', 'photo', 'piano', 'pickle', 'picture', 'pilot', 'pine', 'pioneer', 'pixel',
  'planet', 'plasma', 'plate', 'plume', 'pocket', 'poetry', 'polar', 'pond', 'portal', 'potato',
  'powder', 'prairie', 'prism', 'profit', 'proof', 'proton', 'public', 'pulse', 'puppy', 'purple',
  'puzzle', 'quartz', 'queen', 'quest', 'quick', 'quiet', 'quill', 'quote', 'rabbit', 'radar',
  'radio', 'rain', 'rally', 'ranch', 'random', 'rapid', 'raven', 'reader', 'reason', 'rebel',
  'record', 'reef', 'regal', 'relax', 'relay', 'remedy', 'remote', 'repair', 'rescue', 'resin',
  'resort', 'result', 'retro', 'review', 'rhythm', 'ribbon', 'ridge', 'rifle', 'right', 'ripple',
  'ritual', 'river', 'robin', 'rocket', 'roman', 'rooftop', 'rose', 'rotate', 'round', 'route',
  'royal', 'ruby', 'rugged', 'ruler', 'rumble', 'runner', 'rustic', 'saddle', 'safety', 'sage',
  'sailor', 'salmon', 'salon', 'sandal', 'satin', 'savanna', 'scale', 'scarf', 'scene', 'scent',
  'school', 'scout', 'screen', 'script', 'scroll', 'season', 'secret', 'sector', 'secure', 'seed',
  'segment', 'select', 'senior', 'sensor', 'serene', 'server', 'shadow', 'shallow', 'shape', 'share',
  'sharp', 'shelf', 'shell', 'shield', 'shift', 'shine', 'ship', 'shirt', 'shock', 'shore',
  'short', 'shower', 'signal', 'silent', 'silk', 'silver', 'simple', 'singer', 'single', 'siren',
  'sister', 'sketch', 'skill', 'skirt', 'skull', 'skyline', 'sleep', 'slice', 'slide', 'slope',
  'smart', 'smile', 'smoke', 'smooth', 'snack', 'snake', 'snow', 'soap', 'soccer', 'social',
  'socket', 'soda', 'soft', 'solar', 'solid', 'solve', 'sonic', 'sorry', 'sound', 'south',
  'space', 'spare', 'spark', 'speak', 'speed', 'spell', 'spend', 'sphere', 'spice', 'spider',
  'spike', 'spin', 'spirit', 'split', 'spoke', 'sport', 'spot', 'spray', 'spring', 'spruce',
  'squad', 'square', 'stable', 'stack', 'staff', 'stage', 'stain', 'stair', 'stamp', 'stand',
  'star', 'start', 'state', 'station', 'statue', 'stay', 'steady', 'steam', 'steel', 'steep',
  'stem', 'step', 'stick', 'still', 'stock', 'stone', 'stool', 'store', 'storm', 'story',
  'stove', 'strand', 'strap', 'stream', 'street', 'stress', 'stretch', 'strict', 'strike', 'string',
  'strip', 'stroke', 'strong', 'structure', 'studio', 'study', 'stuff', 'style', 'subject', 'submit',
  'subtle', 'sugar', 'suit', 'summer', 'summit', 'sunny', 'sunset', 'super', 'supply', 'sure',
  'surface', 'surge', 'survey', 'sushi', 'swan', 'sweet', 'swift', 'swim', 'swing', 'switch',
  'sword', 'symbol', 'syntax', 'system', 'table', 'tackle', 'tactic', 'tag', 'tail', 'talent',
  'talk', 'tank', 'tape', 'target', 'task', 'taste', 'teach', 'team', 'teller', 'temple',
  'tenant', 'tender', 'tennis', 'tension', 'tent', 'term', 'terra', 'test', 'text', 'thank',
  'theme', 'theory', 'thick', 'thing', 'think', 'third', 'thorn', 'thread', 'threat', 'three',
  'thrive', 'throw', 'thumb', 'thunder', 'ticket', 'tide', 'tiger', 'tilt', 'timber', 'time',
  'tiny', 'tissue', 'title', 'toast', 'today', 'token', 'tomato', 'tone', 'tool', 'tooth',
  'topic', 'topaz', 'torch', 'total', 'touch', 'tough', 'tower', 'town', 'track', 'trade',
  'traffic', 'trail', 'train', 'transfer', 'trap', 'trash', 'travel', 'treat', 'tree', 'trend',
  'trial', 'tribe', 'trick', 'trigger', 'trim', 'trip', 'trophy', 'trouble', 'truck', 'true',
  'trumpet', 'trust', 'truth', 'try', 'tube', 'tulip', 'tuna', 'tunnel', 'turbo', 'turkey',
  'turn', 'turtle', 'twelve', 'twenty', 'twice', 'twilight', 'twin', 'twist', 'type', 'typical',
  'umbrella', 'unable', 'uncle', 'under', 'undo', 'unicorn', 'union', 'unique', 'unit', 'universe',
  'unknown', 'unlock', 'until', 'unusual', 'update', 'upgrade', 'upload', 'upon', 'upper', 'urban',
  'urge', 'usage', 'use', 'used', 'useful', 'user', 'usual', 'utility', 'vacant', 'vacuum',
  'valid', 'valley', 'value', 'valve', 'van', 'vanilla', 'various', 'vast', 'vault', 'vector',
  'velvet', 'vendor', 'venture', 'venue', 'verb', 'verify', 'version', 'very', 'vessel', 'veteran',
  'viable', 'vibrant', 'victim', 'victory', 'video', 'view', 'village', 'vine', 'vintage', 'violin',
  'virtual', 'virus', 'visa', 'visit', 'visual', 'vital', 'vivid', 'vocal', 'voice', 'void',
  'volcano', 'volume', 'vote', 'voyage', 'wage', 'wagon', 'wait', 'wake', 'walk', 'wall',
  'walnut', 'want', 'warfare', 'warm', 'warn', 'wash', 'wasp', 'waste', 'watch', 'water',
  'wave', 'way', 'wealth', 'weapon', 'wear', 'weasel', 'weather', 'web', 'wedding', 'weekend',
  'weird', 'welcome', 'west', 'wet', 'whale', 'what', 'wheat', 'wheel', 'when', 'where',
  'which', 'while', 'whisper', 'white', 'whole', 'who', 'whom', 'whose', 'why', 'wicked',
  'wide', 'width', 'wife', 'wild', 'will', 'willing', 'win', 'window', 'wine', 'wing',
  'wink', 'winner', 'winter', 'wire', 'wisdom', 'wise', 'wish', 'witness', 'wolf', 'woman',
  'wonder', 'wood', 'wool', 'word', 'work', 'world', 'worry', 'worth', 'wrap', 'wreck',
  'wrestle', 'wrist', 'write', 'wrong', 'yard', 'yarn', 'year', 'yellow', 'young', 'youth',
  'zebra', 'zero', 'zone', 'zoo'
]

export { PROFILE_PASSWORD_MIN_LENGTH, validateProfilePassword } from '@shared/profiles'

export const RECOVERY_PHRASE_WORD_COUNT = 12

export function generateRecoveryPhrase(): string {
  const bytes = randomBytes(RECOVERY_PHRASE_WORD_COUNT * 2)
  const words: string[] = []
  for (let i = 0; i < RECOVERY_PHRASE_WORD_COUNT; i += 1) {
    const index = bytes.readUInt16BE(i * 2) % RECOVERY_WORDS.length
    words.push(RECOVERY_WORDS[index]!)
  }
  return words.join(' ')
}

export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hashRecoveryPhrase(phrase: string, salt: Buffer): string {
  return scryptSync(normalizeRecoveryPhrase(phrase), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString(
    'hex'
  )
}

export function hashProfilePassword(password: string, salt: Buffer): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString('hex')
}

export function verifyRecoveryPhrase(phrase: string, saltHex: string, hashHex: string): boolean {
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(normalizeRecoveryPhrase(phrase), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function verifyProfilePassword(password: string, saltHex: string, hashHex: string): boolean {
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
