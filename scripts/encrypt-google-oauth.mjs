#!/usr/bin/env node
/**
 * Encrypt the household Google OAuth client credentials for shipping.
 *
 * Reads  config/google-oauth.json      (plaintext, gitignored — never ships)
 * Writes config/google-oauth.enc.json  (committed + packaged via extraResources)
 *
 * HONESTY NOTE (see SECURITY.md + docs/GOOGLE_OAUTH_CREDENTIALS.md): this is
 * OBFUSCATION, not a security boundary. The decryption key is embedded in the
 * app (src/main/googleOAuth.ts — keep KEY_PASSPHRASE/KEY_SALT in sync), so a
 * motivated person can recover the client secret. That is the expected model
 * for a Google "Desktop app" OAuth client: per Google, an installed-app secret
 * is not confidential; user security comes from PKCE + the loopback redirect,
 * not from hiding it. Encrypting keeps the plaintext out of casual asar greps
 * and repo history, nothing more.
 *
 * Usage: node scripts/encrypt-google-oauth.mjs
 */
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep in sync with src/main/googleOAuth.ts (EMBEDDED_KEY_PASSPHRASE / _SALT).
const KEY_PASSPHRASE = 'moss-desktop-oauth-client-v1'
const KEY_SALT = 'moss-google-oauth-blob'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plainPath = path.join(root, 'config', 'google-oauth.json')
const encPath = path.join(root, 'config', 'google-oauth.enc.json')

let raw
try {
  raw = JSON.parse(readFileSync(plainPath, 'utf8'))
} catch (err) {
  console.error(`[encrypt-google-oauth] cannot read ${plainPath}: ${err?.message ?? err}`)
  console.error('[encrypt-google-oauth] put the Desktop-app client JSON there first (see config/google-oauth.example.json).')
  process.exit(1)
}

const clientId =
  raw.client_id?.trim() || raw.clientId?.trim() || raw.installed?.client_id?.trim() || raw.web?.client_id?.trim() || ''
const clientSecret =
  raw.client_secret?.trim() ||
  raw.clientSecret?.trim() ||
  raw.installed?.client_secret?.trim() ||
  raw.web?.client_secret?.trim() ||
  ''
if (!clientId || !clientSecret) {
  console.error('[encrypt-google-oauth] no client_id/client_secret found in the JSON.')
  process.exit(1)
}

const key = scryptSync(KEY_PASSPHRASE, KEY_SALT, 32)
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, iv)
const data = Buffer.concat([
  cipher.update(JSON.stringify({ clientId, clientSecret }), 'utf8'),
  cipher.final()
])
const blob = {
  v: 1,
  alg: 'aes-256-gcm',
  iv: iv.toString('base64'),
  tag: cipher.getAuthTag().toString('base64'),
  data: data.toString('base64')
}
writeFileSync(encPath, `${JSON.stringify(blob, null, 2)}\n`, 'utf8')
console.log(`[encrypt-google-oauth] wrote ${path.relative(root, encPath)} (client ${clientId.slice(0, 12)}…).`)
console.log('[encrypt-google-oauth] commit that file — it ships with the app and CI builds.')
