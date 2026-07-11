#!/usr/bin/env node
/**
 * Calendar Step 4 human QA helper — prints checklist + runs automated gates.
 * Operator: complete unchecked items in app, then mark calendar-s-tier.md.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const checklist = [
  'Open MOSS via npm run dev (Electron window) — Calendar bridge available',
  'Settings → Calendar → import .ics file or subscribe ICS URL — events appear in week view',
  'Quit and relaunch — imported events still visible (SQLite persistence)',
  'Settings → Google: secret iCal link OR Sign in with Google — sync populates week view',
  'Dashboard calendar door shows next real event (or honest empty when none)',
  'Quick-add NL: e.g. "dentist next tuesday 2pm" — lands in correct day column',
  'Tap a MOSS-created event → edit title/time → save → persists after relaunch',
  'Settings → class schedule builder — one course on M/W/F — recurring classes in week view',
  'Week nav (← →, Back to this week) — current week default on open',
  'Offline / stale: disable network or bad source — stale banner + Sync now recover'
]

console.log('Calendar Step 4 human QA (operator)\n')
for (const item of checklist) {
  console.log(`  [ ] ${item}`)
}
console.log('\nDocs: docs/GOOGLE_CALENDAR_SETUP.md, docs/CALENDAR_ACADEMICS.md')
console.log('\nAutomated gates:\n')

function runNpm(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['run', script], {
    cwd: root,
    stdio: 'inherit'
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

runNpm('verify:calendar-parse')
runNpm('verify:db')

console.log('\n✓ Automated calendar gates passed (NL parse fixtures + db calendar round-trip).')
console.log('Mark items in agent_docs/modules/calendar-s-tier.md when human QA complete.')
console.log('Then file agent_docs/sign-off-calendar-v1-2026-06-20.md and log.md entry.')
