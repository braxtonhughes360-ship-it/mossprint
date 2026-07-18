#!/usr/bin/env node
/**
 * Nutrition S-tier human QA helper — prints checklist + runs automated gates.
 * Operator: complete unchecked items in app, then mark nutrition-s-tier.md.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const checklist = [
  'Import USDA foundation (Settings → Nutrition → Foods tab) — Describe resolves apple juice offline',
  'Describe: chipotle burrito + chick fil a frosted lemonade — review plate sane',
  'Describe: chicken breast + bowl of rice — review plate sane',
  'Describe: 2 slices pepperoni pizza + 1 glass apple juice — review plate sane',
  'Describe: two scopps of ice cream and cone — estimate ~250–320 kcal, not OFF noise',
  'Re-resolve on unresolved row finds OFF/USDA match',
  'Manual entry modal from diary toolbar',
  'Tap diary entry → edit macros + qty',
  'Log a meal — dashboard door remaining kcal + macros match diary',
  'Relaunch app — today log and food cache persist'
]

console.log('Nutrition S-tier human QA (operator)\n')
console.log('Runbook: agent_docs/operator-qa-v1-gates.md § Step 3\n')
for (const item of checklist) {
  console.log(`  [ ] ${item}`)
}
console.log('\nAutomated gates:\n')

function runNpm(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['run', script], {
    cwd: root,
    stdio: 'inherit'
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

runNpm('verify:describe-parse')
runNpm('verify:describe')
runNpm('verify:db')

console.log('\n✓ Automated nutrition gates passed (parse fixtures + describe smoke + db).')
console.log('Mark items in agent_docs/modules/nutrition-s-tier.md when human QA complete.')
console.log('Update agent_docs/sign-off-shell-nutrition-s-2026-06-20.md when USDA + door rows pass.')
