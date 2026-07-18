import { app } from 'electron'
import { join } from 'node:path'
import { runHealthCheck, closeDatabase, setSetting } from './database'
import {
  activateProfile,
  createProfile,
  initializeProfiles,
  listProfiles,
  lockActiveProfile
} from './profiles'
import { PREFERENCES_STORAGE_KEY } from '@shared/preferences'
import { initHeadlessProfile } from './headlessCommon'

export async function runDemoProfilesSeed(): Promise<void> {
  initializeProfiles()
  const existing = listProfiles()
  if (existing.length === 0) {
    const first = createProfile({ displayName: 'You' })
    await activateProfile(first.profile.id, undefined, { bypassPassword: true }).catch(
      () => undefined
    )
    setSetting(PREFERENCES_STORAGE_KEY, JSON.stringify({
      profile: { displayName: 'You' },
      setup: { completedAt: new Date().toISOString(), version: 1 }
    }))
    closeDatabase()
  }

  let profiles = listProfiles()
  if (profiles.length < 2) {
    createProfile({ displayName: 'Roommate', avatarColor: 'ember' })
    profiles = listProfiles()
  }

  const roommate = profiles.find((p) => p.displayName === 'Roommate')
  if (roommate) {
    await activateProfile(roommate.id, undefined, { bypassPassword: true })
    setSetting('demo.profile.marker', 'roommate-data')
    closeDatabase()
  }

  const primary = profiles.find((p) => p.displayName === 'You') ?? profiles[0]!
  await activateProfile(primary.id, undefined, { bypassPassword: true })
  setSetting('demo.profile.marker', 'primary-data')
  closeDatabase()
  lockActiveProfile()

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      profiles: listProfiles().map((p) => ({
        id: p.id,
        displayName: p.displayName,
        databasePath: join(app.getPath('userData'), 'profiles', p.id, 'moss.sqlite')
      }))
    })}\n`
  )
  app.exit(0)
}

export async function runHeadlessHealthCheck(): Promise<void> {
  try {
    await initHeadlessProfile()
    const result = runHealthCheck()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessCalendarParse(): Promise<void> {
  const { runCalendarParseFixtures } = await import('../shared/calendarEventParse')
  try {
    const result = runCalendarParseFixtures()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessDescribeParse(): Promise<void> {
  const { runDescribeParseFixtures } = await import('./nutritionDescribeParse')
  try {
    const result = runDescribeParseFixtures()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessCaptureRouting(): Promise<void> {
  // sanitizeCaptureIntent resolves envelope guesses and describeMeal reads the
  // food cache — both need an active (isolated) profile database.
  await initHeadlessProfile()
  const { runCaptureRoutingFixtures } = await import('./captureRoutingFixtures')
  try {
    const result = await runCaptureRoutingFixtures()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessDescribeSmoke(): Promise<void> {
  // describeMeal reads the food cache, so a profile DB must be active —
  // since per-profile DBs (V2a) getDb() no longer opens a legacy DB by default.
  await initHeadlessProfile()
  const { describeMeal } = await import('./nutritionDescribe')
  try {
    const cases = [
      '2 slices pepperoni pizza, 1 glass apple juice',
      'one slize of cheese pizza',
      '2 scoops icecream and cone',
      'two scopps of ice cream and cone',
      'scopps of vanilla',
      'one bowl of reeses peanut butter cereal and milk',
      'one bowl of captain crunch cereal and milk',
      'chick fil a chicken sandwich meal',
      'big mac meal large',
      'chipotle bowl'
    ]
    const results: Array<{
      text: string
      items: Array<{ label: string; source: string; kcal: number; assumed?: boolean }>
    }> = []

    for (const text of cases) {
      const result = await describeMeal({
        text,
        dateKey: '2026-06-19',
        mealSlot: 'snack'
      })
      results.push({
        text,
        items: result.items.map((i) => ({
          label: i.label,
          source: i.source,
          kcal: Math.round(i.snapshotKcal),
          ...(i.assumed ? { assumed: true } : {})
        }))
      })
    }

    const ok = results.every((row) => {
      if (row.text.includes('cheese pizza')) {
        return row.items.some(
          (i) =>
            i.source === 'estimate' &&
            i.label.toLowerCase().includes('cheese') &&
            !i.label.toLowerCase().includes('pepperoni')
        )
      }
      if (row.text.includes('pepperoni')) {
        return row.items.some(
          (i) =>
            i.source === 'estimate' &&
            i.label.toLowerCase().includes('pepperoni')
        )
      }
      if (row.text.includes('vanilla')) {
        return row.items.some(
          (i) =>
            i.source === 'estimate' &&
            i.kcal >= 100 &&
            !i.label.toLowerCase().includes('notco')
        )
      }
      if (row.text.includes('icecream') || row.text.includes('ice cream')) {
        const estimates = row.items.filter((i) => i.source === 'estimate')
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        const hasIce = estimates.some((i) => /ice cream/i.test(i.label))
        const noMisleading = row.items.every(
          (i) =>
            !i.label.toLowerCase().includes('notco') &&
            !i.label.toLowerCase().includes('not ice')
        )
        if (row.text.includes(' and ')) {
          return row.items.length >= 2 && hasIce && totalKcal >= 200 && noMisleading
        }
        return estimates.length >= 1 && totalKcal >= 100 && noMisleading
      }
      if (row.text.includes('reeses') && row.text.includes('cereal')) {
        const cereal = row.items.find((i) => /reese|cereal/i.test(i.label))
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        return (
          cereal != null &&
          cereal.kcal >= 140 &&
          cereal.kcal <= 220 &&
          totalKcal >= 200 &&
          totalKcal <= 320 &&
          !row.items.some((i) => i.kcal > 400)
        )
      }
      if (row.text.includes('crunch') && row.text.includes('cereal')) {
        const cereal = row.items.find((i) => /crunch|cereal/i.test(i.label))
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        return (
          cereal != null &&
          cereal.kcal >= 130 &&
          cereal.kcal <= 220 &&
          totalKcal >= 200 &&
          totalKcal <= 320 &&
          !row.items.some((i) => i.kcal > 400)
        )
      }
      if (row.text.includes('chick fil a') && row.text.includes('meal')) {
        const assumed = row.items.filter((i) => i.assumed)
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        return (
          row.items.length >= 3 &&
          assumed.length >= 2 &&
          row.items.some((i) => /sandwich|chick/i.test(i.label) && !i.assumed) &&
          row.items.some((i) => /fries/i.test(i.label)) &&
          row.items.some((i) => /drink|soda|soft/i.test(i.label)) &&
          totalKcal >= 850 &&
          totalKcal <= 1100
        )
      }
      if (row.text.includes('big mac') && row.text.includes('meal')) {
        const assumed = row.items.filter((i) => i.assumed)
        const totalKcal = row.items.reduce((sum, i) => sum + i.kcal, 0)
        return (
          row.items.length >= 3 &&
          assumed.length >= 2 &&
          row.items.some((i) => /big mac/i.test(i.label) && !i.assumed) &&
          row.items.some((i) => /large fries|fries/i.test(i.label)) &&
          totalKcal >= 1200 &&
          totalKcal <= 1500
        )
      }
      if (row.text === 'chipotle bowl') {
        return (
          row.items.length === 1 &&
          !row.items.some((i) => i.assumed) &&
          row.items.some((i) => /bowl|chipotle/i.test(i.label)) &&
          row.items[0].kcal >= 500
        )
      }
      return row.items.some((i) => i.source !== 'unresolved')
    })

    process.stdout.write(`${JSON.stringify({ ok, results })}\n`)
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessEstimateLabels(): Promise<void> {
  const { runEstimateLabelRegressions, runEstimateKcalAnchorRegressions } = await import(
    './nutritionEstimates'
  )
  const labelResult = runEstimateLabelRegressions()
  const kcalResult = runEstimateKcalAnchorRegressions()
  const result = {
    ok: labelResult.ok && kcalResult.ok,
    failures: [...labelResult.failures, ...kcalResult.failures]
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  app.exit(result.ok ? 0 : 1)
}

export async function runHeadlessUsdaImport(): Promise<void> {
  await initHeadlessProfile()
  const { downloadAndImportUsdaFoundation } = await import('./nutritionUsdaImport')
  try {
    const result = await downloadAndImportUsdaFoundation()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(0)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}
