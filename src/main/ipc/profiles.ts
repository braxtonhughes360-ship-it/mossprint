import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { assertTrustedSender } from './trust'
import type {
  CreateProfileInput,
  DeleteProfileInput,
  RegenerateRecoveryPhraseInput,
  ResetProfilePasswordInput,
  SetProfilePasswordInput,
  UpdateProfileInput
} from '@shared/profiles'
import {
  activateProfile,
  clearProfilePassword,
  clearProfilePasswordWithRecovery,
  closeProfilesRegistry,
  createProfile,
  deleteProfile,
  getActiveProfileState,
  initializeProfiles,
  issueRecoveryPhraseForPasswordSetup,
  listProfiles,
  lockActiveProfile,
  regenerateRecoveryPhrase,
  requireActiveProfileDatabase,
  resetProfilePassword,
  setProfilePassword,
  setupRecoveryPhraseForLegacyProfile,
  updateProfile
} from '../profiles'
import { startUpdateChecks } from '../updater'

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
}

function assertActiveDatabase(event: Electron.IpcMainInvokeEvent): void {
  assertTrustedSender(event)
  requireActiveProfileDatabase()
}

export function registerProfileHandlers(): void {
  initializeProfiles()
  // Every GUI launch starts at the profile picker — no resumed sessions across runs.
  lockActiveProfile()

  ipcMain.handle(IPC_CHANNELS.PROFILES_LIST, (event) => {
    assertTrustedSender(event)
    return listProfiles()
  })

  ipcMain.handle(IPC_CHANNELS.PROFILES_GET_ACTIVE, (event) => {
    assertTrustedSender(event)
    return getActiveProfileState()
  })

  ipcMain.handle(IPC_CHANNELS.PROFILES_ACTIVATE, async (event, profileId: unknown, password?: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(profileId, 'profileId')
    if (password !== undefined && password !== null && typeof password !== 'string') {
      throw new Error('password must be a string')
    }
    const result = await activateProfile(
      profileId,
      typeof password === 'string' ? password : undefined
    )
    if (result.ok) {
      // R4: update checks start only after someone is actually in a profile
      // (never at bare launch), and only for real GUI sessions — headless
      // verify runs activate profiles directly, not through this handler.
      startUpdateChecks()
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.PROFILES_LOCK, (event) => {
    assertTrustedSender(event)
    lockActiveProfile()
    return { ok: true as const }
  })

  ipcMain.handle(IPC_CHANNELS.PROFILES_CREATE, (event, input: unknown) => {
    assertTrustedSender(event)
    const parsed = (input && typeof input === 'object' ? input : {}) as CreateProfileInput
    assertNonEmptyString(parsed.displayName, 'displayName')
    return createProfile(parsed)
  })

  ipcMain.handle(IPC_CHANNELS.PROFILES_UPDATE, (event, profileId: unknown, input: unknown) => {
    assertActiveDatabase(event)
    assertNonEmptyString(profileId, 'profileId')
    return updateProfile(profileId, (input ?? {}) as UpdateProfileInput)
  })

  ipcMain.handle(IPC_CHANNELS.PROFILES_SET_PASSWORD, (event, profileId: unknown, input: unknown) => {
    assertActiveDatabase(event)
    assertNonEmptyString(profileId, 'profileId')
    const parsed = (input && typeof input === 'object' ? input : {}) as SetProfilePasswordInput
    assertNonEmptyString(parsed.password, 'password')
    return setProfilePassword(profileId, parsed)
  })

  ipcMain.handle(IPC_CHANNELS.PROFILES_RESET_PASSWORD, (event, profileId: unknown, input: unknown) => {
    assertTrustedSender(event)
    assertNonEmptyString(profileId, 'profileId')
    const parsed = (input && typeof input === 'object' ? input : {}) as ResetProfilePasswordInput
    assertNonEmptyString(parsed.recoveryPhrase, 'recoveryPhrase')
    assertNonEmptyString(parsed.newPassword, 'newPassword')
    return resetProfilePassword(profileId, parsed)
  })

  ipcMain.handle(
    IPC_CHANNELS.PROFILES_CLEAR_PASSWORD,
    (event, profileId: unknown, currentPassword: unknown) => {
      assertActiveDatabase(event)
      assertNonEmptyString(profileId, 'profileId')
      assertNonEmptyString(currentPassword, 'currentPassword')
      return clearProfilePassword(profileId, currentPassword)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.PROFILES_REGENERATE_RECOVERY,
    (event, profileId: unknown, input: unknown) => {
      assertActiveDatabase(event)
      assertNonEmptyString(profileId, 'profileId')
      return regenerateRecoveryPhrase(profileId, (input ?? {}) as RegenerateRecoveryPhraseInput)
    }
  )

  ipcMain.handle(IPC_CHANNELS.PROFILES_SETUP_RECOVERY, (event, profileId: unknown) => {
    assertActiveDatabase(event)
    assertNonEmptyString(profileId, 'profileId')
    return setupRecoveryPhraseForLegacyProfile(profileId)
  })

  ipcMain.handle(IPC_CHANNELS.PROFILES_ISSUE_RECOVERY_FOR_PASSWORD, (event, profileId: unknown) => {
    assertActiveDatabase(event)
    assertNonEmptyString(profileId, 'profileId')
    return issueRecoveryPhraseForPasswordSetup(profileId)
  })

  ipcMain.handle(
    IPC_CHANNELS.PROFILES_CLEAR_PASSWORD_WITH_RECOVERY,
    (event, profileId: unknown, recoveryPhrase: unknown) => {
      assertTrustedSender(event)
      assertNonEmptyString(profileId, 'profileId')
      assertNonEmptyString(recoveryPhrase, 'recoveryPhrase')
      return clearProfilePasswordWithRecovery(profileId, recoveryPhrase)
    }
  )

  ipcMain.handle(IPC_CHANNELS.PROFILES_DELETE, (event, profileId: unknown, input: unknown) => {
    // Deletable from the picker (no active profile) too — the typed-name + password check in
    // deleteProfile is the real gate, validated against the registry, not the active database.
    assertTrustedSender(event)
    assertNonEmptyString(profileId, 'profileId')
    deleteProfile(profileId, (input ?? {}) as DeleteProfileInput)
    return { ok: true as const }
  })
}

export function shutdownProfiles(): void {
  lockActiveProfile()
  closeProfilesRegistry()
}
