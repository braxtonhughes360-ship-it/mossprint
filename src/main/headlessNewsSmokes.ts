import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setSetting } from './database'
import { PREFERENCES_STORAGE_KEY, DEFAULT_PREFERENCES } from '@shared/preferences'
import { initHeadlessProfile, seedShotNewsItems } from './headlessCommon'

export async function runHeadlessNewsOffline(): Promise<void> {
  // Exercises the "offline / unreachable feed" path without touching the network:
  // an unresolvable .invalid host makes fetch throw, hitting the same catch branch
  // as a real offline sync. Asserts (a) already-fetched items stay visible and
  // (b) the source row records last_error.
  await initHeadlessProfile()
  try {
    const { randomUUID } = await import('node:crypto')
    const { getDb } = await import('./database')
    const { addNewsSource, syncNewsSource, listNewsItems, listNewsSources, deleteNewsSource } =
      await import('./news')

    // Idempotent: drop any leftover test source from a prior run before adding.
    const TEST_URL = 'https://offline-test.invalid/feed.xml'
    const stale = listNewsSources().find((s) => s.url === TEST_URL)
    if (stale) deleteNewsSource(stale.id)

    const source = await addNewsSource({ url: TEST_URL })

    // Seed a "last-good" item as if a prior sync had succeeded.
    getDb()
      .prepare(
        `INSERT INTO news_items (
           id, source_id, external_id, title, url, summary, published_at, read_at, created_at
         ) VALUES (@id, @sourceId, 'seed-1', 'Last good headline',
           'https://offline-test.invalid/a', 'cached summary', @ts, NULL, @ts)`
      )
      .run({ id: randomUUID(), sourceId: source.id, ts: new Date().toISOString() })

    const before = listNewsItems().filter((i) => i.sourceId === source.id).length

    let threw = false
    const syncResult = await syncNewsSource(source.id)
    if (syncResult.error) threw = true

    const after = listNewsItems().filter((i) => i.sourceId === source.id).length
    const row = listNewsSources().find((s) => s.id === source.id)
    const lastError = row?.lastError ?? null

    // Clean up so the test never leaves a phantom feed in the profile DB.
    deleteNewsSource(source.id)

    const itemsPreserved = before === 1 && after === 1
    const errorOnRow = Boolean(lastError)
    const ok = threw && itemsPreserved && errorOnRow

    process.stdout.write(
      `${JSON.stringify({ ok, threw, before, after, itemsPreserved, errorOnRow, lastError })}\n`
    )
    app.exit(ok ? 0 : 1)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}

export async function runHeadlessNewsWidgetShot(): Promise<void> {
  await initHeadlessProfile()
  try {
    await seedShotNewsItems()

    setSetting(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        colorMode: 'light',
        motionIntensity: 'off',
        ambientIntensity: 'off',
        profile: { displayName: 'Alex' },
        setup: { completedAt: new Date().toISOString(), version: 1 },
        modules: {
          ...DEFAULT_PREFERENCES.modules,
          inbox: { enabled: false },
          news: {
            enabled: true,
            maxItems: 9,
            widgetLayout: 'split',
            briefingMode: 'balanced',
            maxPerSource: 2
          }
        }
      })
    )

    const outDir = join(app.getAppPath(), 'agent_docs', 'screenshots')
    mkdirSync(outDir, { recursive: true })

    const captureWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      backgroundColor: '#dddcd8',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webgl: false
      }
    })

    await captureWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/' })

    await captureWindow.webContents.executeJavaScript(
      `new Promise((resolve, reject) => {
        const deadline = Date.now() + 20000
        const tick = () => {
          const headline = document.querySelector('.dashboard-news-hero-headline')
          const sync = document.querySelector('.dashboard-news-sync')
          if (
            headline &&
            headline.textContent?.trim() &&
            sync?.textContent?.includes('Updated')
          ) {
            resolve(true)
            return
          }
          if (Date.now() > deadline) {
            reject(new Error('News widget did not render briefing data in time'))
            return
          }
          requestAnimationFrame(tick)
        }
        tick()
      })`,
      true
    )

    await new Promise((resolve) => setTimeout(resolve, 600))

    const writeShot = async (filename: string): Promise<void> => {
      const image = await captureWindow.webContents.capturePage()
      writeFileSync(join(outDir, filename), image.toPNG())
    }

    await writeShot('news-widget-dashboard-light.png')

    await captureWindow.webContents.executeJavaScript(
      `(() => {
        document.documentElement.dataset.colorMode = 'dark'
        document.documentElement.style.colorScheme = 'dark'
      })()`,
      true
    )

    await new Promise((resolve) => setTimeout(resolve, 250))
    await writeShot('news-widget-dashboard-dark.png')

    if (!captureWindow.isDestroyed()) {
      captureWindow.destroy()
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        light: join(outDir, 'news-widget-dashboard-light.png'),
        dark: join(outDir, 'news-widget-dashboard-dark.png')
      })}\n`
    )
    app.exit(0)
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    app.exit(1)
  }
}
