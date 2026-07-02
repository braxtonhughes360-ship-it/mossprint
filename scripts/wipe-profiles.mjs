/**
 * Deletes all MOSS local profiles (registry + per-profile SQLite + keychain key files).
 * Usage: npm run moss:wipe-profiles
 */
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const mossDir = join(homedir(), 'Library', 'Application Support', 'moss')
const profilesDir = join(mossDir, 'profiles')

let removed = 0

if (existsSync(profilesDir)) {
  for (const entry of readdirSync(profilesDir)) {
    rmSync(join(profilesDir, entry), { recursive: true, force: true })
    removed += 1
  }
  rmSync(profilesDir, { recursive: true, force: true })
}

for (const name of ['active-profile.json', 'moss.sqlite', 'registry.sqlite']) {
  const path = join(mossDir, name)
  if (existsSync(path)) rmSync(path, { force: true })
}

console.log(`MOSS profiles wiped (${removed} profile folder(s) removed). Restart the app to run setup.`)
