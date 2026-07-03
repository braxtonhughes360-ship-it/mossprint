import { safeStorage } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { profileDirectory } from './profilePaths'
import { usesPlainDbKeyStorage } from './headlessProfile'

const KEY_FILE = 'db.key.enc'

function keyFilePath(profileId: string): string {
  return join(profileDirectory(profileId), KEY_FILE)
}

function usePlainDbKeyFile(): boolean {
  return usesPlainDbKeyStorage()
}

function writePlainDbKeyFile(profileId: string, key: Buffer): void {
  mkdirSync(profileDirectory(profileId), { recursive: true })
  const path = keyFilePath(profileId)
  writeFileSync(path, key.toString('base64'), { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // best effort
  }
}

function readPlainDbKeyFile(profileId: string): Buffer | null {
  const path = keyFilePath(profileId)
  if (!existsSync(path)) return null
  try {
    return Buffer.from(readFileSync(path, 'utf8'), 'base64')
  } catch {
    return null
  }
}

export function storeProfileDbKeyInKeychain(profileId: string, key: Buffer): void {
  if (usePlainDbKeyFile()) {
    writePlainDbKeyFile(profileId, key)
    return
  }

  if (!safeStorage.isEncryptionAvailable()) {
    writePlainDbKeyFile(profileId, key)
    return
  }

  mkdirSync(profileDirectory(profileId), { recursive: true })
  const path = keyFilePath(profileId)
  try {
    const encrypted = safeStorage.encryptString(key.toString('base64'))
    writeFileSync(path, encrypted.toString('base64'), 'utf8')
  } catch {
    // Keychain unavailable or blocked — still allow profile creation with restricted perms.
    writePlainDbKeyFile(profileId, key)
    return
  }
  try {
    chmodSync(path, 0o600)
  } catch {
    // best effort
  }
}

export function readProfileDbKeyFromKeychain(profileId: string): Buffer | null {
  if (usePlainDbKeyFile()) {
    return readPlainDbKeyFile(profileId)
  }

  const path = keyFilePath(profileId)
  if (!existsSync(path)) {
    return null
  }

  if (safeStorage.isEncryptionAvailable()) {
    try {
      const blob = readFileSync(path, 'utf8')
      const decrypted = safeStorage.decryptString(Buffer.from(blob, 'base64'))
      return Buffer.from(decrypted, 'base64')
    } catch {
      // fall through — file may be a plain fallback from a prior create
    }
  }

  return readPlainDbKeyFile(profileId)
}

export function deleteProfileDbKeyFromKeychain(profileId: string): void {
  try {
    if (existsSync(keyFilePath(profileId))) {
      rmSync(keyFilePath(profileId))
    }
  } catch {
    // best effort
  }
}

export function hasProfileDbKeyInKeychain(profileId: string): boolean {
  return existsSync(keyFilePath(profileId))
}
