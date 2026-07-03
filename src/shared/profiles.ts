export type ProfileAvatarColor = 'moss' | 'ember' | 'slate' | 'violet' | 'rose'

export interface ProfileRecord {
  id: string
  displayName: string
  avatarColor: ProfileAvatarColor
  passwordEnabled: boolean
  recoveryEnabled: boolean
  createdAt: string
  sortOrder: number
}

/** Public summary — no password hash or secrets. */
export interface ProfileSummary {
  id: string
  displayName: string
  avatarColor: ProfileAvatarColor
  passwordEnabled: boolean
  recoveryEnabled: boolean
  createdAt: string
  sortOrder: number
}

export interface ActiveProfileState {
  profile: ProfileSummary
  databasePath: string
}

export interface CreateProfileInput {
  displayName: string
  avatarColor?: ProfileAvatarColor
}

/** Returned once at profile creation — user must save the recovery phrase offline. */
export interface CreateProfileResult {
  profile: ProfileSummary
  recoveryPhrase: string
}

export interface UpdateProfileInput {
  displayName?: string
  avatarColor?: ProfileAvatarColor
}

export interface SetProfilePasswordInput {
  password: string
  currentPassword?: string
}

export interface ResetProfilePasswordInput {
  recoveryPhrase: string
  newPassword: string
}

export interface RegenerateRecoveryPhraseInput {
  password?: string
  recoveryPhrase?: string
}

export interface RegenerateRecoveryPhraseResult {
  profile: ProfileSummary
  recoveryPhrase: string
}

export interface DeleteProfileInput {
  confirmName: string
  password?: string
}

export interface ActivateProfileResult {
  ok: true
  profile: ProfileSummary
  databasePath: string
}

export type ActivateProfileErrorCode =
  | 'not_found'
  | 'wrong_password'
  | 'password_required'
  | 'locked'
  | 'rate_limited'

export interface ActivateProfileError {
  ok: false
  code: ActivateProfileErrorCode
  message: string
}

export type ActivateProfileResponse = ActivateProfileResult | ActivateProfileError

export const PROFILE_AVATAR_COLORS: ProfileAvatarColor[] = [
  'moss',
  'ember',
  'slate',
  'violet',
  'rose'
]

/** Required user-facing security copy — honest limits, no false claims. */
export const PROFILE_SECURITY_COPY =
  'MOSS encrypts your profile database on disk (SQLCipher). Your password and recovery phrase unlock it. Turn on FileVault (Mac) or device encryption (Windows) for the rest of your computer.'

export const PROFILE_CASUAL_PRIVACY_LABEL =
  'Stops casual access and unreadable copies of your data — not a defense against malware on an unlocked session.'

export const PROFILE_PASSWORD_MIN_LENGTH = 8

/** Plain-language hint for setup + settings password fields. */
export const PROFILE_PASSWORD_HINT = `At least ${PROFILE_PASSWORD_MIN_LENGTH} characters with a special character (like ! or #).`

export function validateProfilePassword(password: string): string | null {
  const trimmed = password.trim()
  if (trimmed.length < PROFILE_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PROFILE_PASSWORD_MIN_LENGTH} characters.`
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(trimmed)) {
    return 'Password must include a special character (like ! or #).'
  }
  return null
}

export function profileSummaryFromRecord(record: ProfileRecord): ProfileSummary {
  return {
    id: record.id,
    displayName: record.displayName,
    avatarColor: record.avatarColor,
    passwordEnabled: record.passwordEnabled,
    recoveryEnabled: record.recoveryEnabled,
    createdAt: record.createdAt,
    sortOrder: record.sortOrder
  }
}

export function normalizeAvatarColor(value: unknown): ProfileAvatarColor {
  if (
    value === 'moss' ||
    value === 'ember' ||
    value === 'slate' ||
    value === 'violet' ||
    value === 'rose'
  ) {
    return value
  }
  return 'moss'
}

/** Stable FNV-1a hash for deterministic palette picks from arbitrary strings. */
export function hashStringFNV1a(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Pick a profile avatar swatch from a label — same technique as manual color pickers. */
export function avatarColorFromString(input: string): ProfileAvatarColor {
  const normalized = input.trim().toLowerCase()
  const hash = hashStringFNV1a(normalized || '?')
  return PROFILE_AVATAR_COLORS[hash % PROFILE_AVATAR_COLORS.length]!
}
