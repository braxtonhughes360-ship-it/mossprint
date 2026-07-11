import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { normalizeRecoveryPhrase } from './profileSecurity'

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }
const WRAP_KEY_LENGTH = 32

export function deriveWrapSecret(password: string, salt: Buffer): Buffer {
  return scryptSync(password.trim(), salt, WRAP_KEY_LENGTH, SCRYPT_OPTIONS)
}

export function deriveRecoveryWrapSecret(phrase: string, salt: Buffer): Buffer {
  return scryptSync(normalizeRecoveryPhrase(phrase), salt, WRAP_KEY_LENGTH, SCRYPT_OPTIONS)
}

export function wrapDbKey(dbKey: Buffer, secret: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secret, iv)
  const encrypted = Buffer.concat([cipher.update(dbKey), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function unwrapDbKey(wrapped: string, secret: Buffer): Buffer {
  const payload = Buffer.from(wrapped, 'base64')
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const encrypted = payload.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', secret, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()])
}
