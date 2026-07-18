import { createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { google } from 'googleapis'
import { getSetting, setSetting } from './database'

/** URL-safe base64 (RFC 7636 — PKCE / state values). */
function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Shared Google OAuth client config + a loopback (system-browser) auth-code flow.
 *
 * The household Google Cloud app is the *same* registration for Calendar and Gmail, so the
 * client id/secret live here once and are read by both modules.
 */

const CLIENT_ID_KEY = 'google_oauth_client_id'
const CLIENT_SECRET_KEY = 'google_oauth_client_secret'

/** Default loopback port — dynamic port is used at connect time to avoid clashes. */
export const REDIRECT_PORT = 42813
export const REDIRECT_PATH = '/oauth2callback'
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`

const OAUTH_TIMEOUT_MS = 120000

export interface GoogleOAuthLoopbackResult {
  code: string
  redirectUri: string
  /** PKCE verifier — caller must pass it to getToken to complete the exchange. */
  codeVerifier: string
}

function readOAuthJsonFile(path: string): { clientId: string; clientSecret: string } | null {
  if (!existsSync(path)) {
    return null
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      client_id?: string
      client_secret?: string
      installed?: { client_id?: string; client_secret?: string }
      web?: { client_id?: string; client_secret?: string }
      clientId?: string
      clientSecret?: string
    }

    const clientId =
      raw.client_id?.trim() ||
      raw.clientId?.trim() ||
      raw.installed?.client_id?.trim() ||
      raw.web?.client_id?.trim() ||
      ''
    const clientSecret =
      raw.client_secret?.trim() ||
      raw.clientSecret?.trim() ||
      raw.installed?.client_secret?.trim() ||
      raw.web?.client_secret?.trim() ||
      ''

    if (!clientId || !clientSecret) {
      return null
    }

    return { clientId, clientSecret }
  } catch {
    return null
  }
}

// Decrypts the shipped google-oauth.enc.json (written by
// scripts/encrypt-google-oauth.mjs — keep these constants in sync with it).
//
// This is OBFUSCATION, not a security boundary: the key ships inside the app,
// so the client secret is recoverable by anyone determined enough to look.
// That is Google's expected model for a Desktop-app OAuth client — the secret
// is "not treated as confidential"; user security is PKCE (RFC 7636) + the
// loopback redirect + tokens in the OS keychain, none of which depend on this
// blob staying private. Worst case for a leaked desktop secret is app
// impersonation / quota abuse, never user data. See docs/GOOGLE_OAUTH_CREDENTIALS.md.
const EMBEDDED_KEY_PASSPHRASE = 'moss-desktop-oauth-client-v1'
const EMBEDDED_KEY_SALT = 'moss-google-oauth-blob'

function readEncryptedOAuthFile(path: string): { clientId: string; clientSecret: string } | null {
  if (!existsSync(path)) {
    return null
  }
  try {
    const blob = JSON.parse(readFileSync(path, 'utf8')) as {
      v?: number
      alg?: string
      iv?: string
      tag?: string
      data?: string
    }
    if (blob.v !== 1 || blob.alg !== 'aes-256-gcm' || !blob.iv || !blob.tag || !blob.data) {
      return null
    }
    const key = scryptSync(EMBEDDED_KEY_PASSPHRASE, EMBEDDED_KEY_SALT, 32)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(blob.data, 'base64')),
      decipher.final()
    ]).toString('utf8')
    const parsed = JSON.parse(plain) as { clientId?: string; clientSecret?: string }
    const clientId = parsed.clientId?.trim() ?? ''
    const clientSecret = parsed.clientSecret?.trim() ?? ''
    if (!clientId || !clientSecret) {
      return null
    }
    return { clientId, clientSecret }
  } catch {
    return null
  }
}

/** Household OAuth — .env / Settings / plaintext drop-ins override the shipped blob. */
export function getGoogleOAuthClientConfig(): { clientId: string; clientSecret: string } | null {
  const fromEnv =
    process.env.MOSS_GOOGLE_CLIENT_ID?.trim() && process.env.MOSS_GOOGLE_CLIENT_SECRET?.trim()
      ? {
          clientId: process.env.MOSS_GOOGLE_CLIENT_ID.trim(),
          clientSecret: process.env.MOSS_GOOGLE_CLIENT_SECRET.trim()
        }
      : null

  if (fromEnv) {
    return fromEnv
  }

  const fromSettings = getSetting(CLIENT_ID_KEY)?.value?.trim()
  const secretSettings = getSetting(CLIENT_SECRET_KEY)?.value?.trim()
  if (fromSettings && secretSettings) {
    return { clientId: fromSettings, clientSecret: secretSettings }
  }

  const bundledPaths: string[] = []

  if (app.isReady()) {
    bundledPaths.push(join(app.getPath('userData'), 'google-oauth.json'))
    if (app.isPackaged) {
      bundledPaths.push(join(process.resourcesPath, 'google-oauth.json'))
      bundledPaths.push(join(app.getAppPath(), 'google-oauth.json'))
    }
  }

  // Dev / unpackaged — repo config folder.
  bundledPaths.push(join(process.cwd(), 'config', 'google-oauth.json'))
  bundledPaths.push(join(process.cwd(), 'google-oauth.json'))

  for (const path of bundledPaths) {
    const fromFile = readOAuthJsonFile(path)
    if (fromFile) {
      return fromFile
    }
  }

  // Shipped encrypted blob — the default for installed builds; every path
  // above is an operator/tester override that wins over it.
  const encryptedPaths: string[] = []
  if (app.isReady() && app.isPackaged) {
    encryptedPaths.push(join(process.resourcesPath, 'google-oauth.enc.json'))
  }
  encryptedPaths.push(join(process.cwd(), 'config', 'google-oauth.enc.json'))
  for (const path of encryptedPaths) {
    const fromBlob = readEncryptedOAuthFile(path)
    if (fromBlob) {
      return fromBlob
    }
  }

  return null
}

export function isGoogleOAuthConfigured(): boolean {
  return getGoogleOAuthClientConfig() !== null
}

export function storeGoogleOAuthClientConfig(clientId: string, clientSecret: string): void {
  setSetting(CLIENT_ID_KEY, clientId.trim())
  setSetting(CLIENT_SECRET_KEY, clientSecret.trim())
}

/** Build a configured OAuth2 client for token refresh (post-connect). */
export function createGoogleOAuthClient(): InstanceType<typeof google.auth.OAuth2> {
  const config = getGoogleOAuthClientConfig()
  if (!config) {
    throw new Error('Google OAuth is not configured')
  }
  return new google.auth.OAuth2(config.clientId, config.clientSecret, REDIRECT_URI)
}

export function createGoogleOAuthClientForRedirect(
  redirectUri: string
): InstanceType<typeof google.auth.OAuth2> {
  const config = getGoogleOAuthClientConfig()
  if (!config) {
    throw new Error('Google OAuth is not configured')
  }
  return new google.auth.OAuth2(config.clientId, config.clientSecret, redirectUri)
}

/** Cancels a pending loopback (e.g. the user closed the browser tab and wants to retry). */
let activeLoopbackCancel: (() => void) | null = null

export function cancelGoogleOAuthLoopback(): void {
  activeLoopbackCancel?.()
}

/**
 * Opens the system browser to Google's consent screen and listens on a loopback port for
 * the redirect. Uses a dynamic port so dev + packaged MOSS (or Calendar + Gmail connect)
 * don't fight over 42813. A fresh call supersedes any pending one, so closing the consent
 * tab never wedges the connect button — clicking Connect again just starts over.
 */
export function runGoogleOAuthLoopback(scopes: string[]): Promise<GoogleOAuthLoopbackResult> {
  const config = getGoogleOAuthClientConfig()
  if (!config) {
    throw new Error('Google OAuth is not configured')
  }

  // Tear down any in-flight attempt before starting a new one.
  activeLoopbackCancel?.()

  // PKCE (RFC 7636) + CSRF state — required by Google's "use secure flows" policy.
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  const state = base64url(randomBytes(16))

  return new Promise((resolve, reject) => {
    let settled = false
    let server: ReturnType<typeof import('node:http').createServer> | null = null
    let redirectUri = REDIRECT_URI

    const finish = (handler: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      server?.close()
      if (activeLoopbackCancel === cancel) activeLoopbackCancel = null
      handler()
    }

    const cancel = (): void => finish(() => reject(new Error('Google sign-in canceled')))
    activeLoopbackCancel = cancel

    const timeout = setTimeout(() => {
      finish(() => reject(new Error('Google sign-in timed out — try again')))
    }, OAUTH_TIMEOUT_MS)

    void import('node:http').then(({ createServer }) => {
      if (settled) return

      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', redirectUri)
        if (url.pathname !== REDIRECT_PATH) {
          res.writeHead(404)
          res.end()
          return
        }

        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        const returnedState = url.searchParams.get('state')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;padding:2rem">' +
            '<h1>Connected</h1><p>You can close this tab and return to MOSS.</p></body></html>'
        )

        if (error) {
          finish(() => reject(new Error(`Google sign-in denied: ${error}`)))
          return
        }
        // CSRF guard — the redirect must echo the exact state we generated.
        if (returnedState !== state) {
          finish(() => reject(new Error('Google sign-in failed a security check — try again')))
          return
        }
        if (!code) {
          finish(() => reject(new Error('Google sign-in returned no authorization code')))
          return
        }
        finish(() => resolve({ code, redirectUri, codeVerifier }))
      })

      server.on('error', (err) => {
        finish(() =>
          reject(
            err instanceof Error && 'code' in err && err.code === 'EADDRINUSE'
              ? new Error(
                  'Google sign-in port busy — quit other MOSS windows and try again'
                )
              : err instanceof Error
                ? err
                : new Error(String(err))
          )
        )
      })

      server.listen(0, '127.0.0.1', () => {
        const address = server?.address()
        const port =
          typeof address === 'object' && address && 'port' in address ? address.port : REDIRECT_PORT
        redirectUri = `http://127.0.0.1:${port}${REDIRECT_PATH}`
        // Built explicitly so PKCE (code_challenge) + state ride along — the system browser
        // opens this; MOSS never embeds a webview for the consent screen.
        const authParams = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: scopes.join(' '),
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256'
        })
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`
        void shell.openExternal(authUrl)
      })
    })
  })
}
