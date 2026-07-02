import { app, BrowserWindow } from 'electron'
import { isNewerVersion, type UpdateMode, type UpdateState } from '@shared/updates'
import { UPDATES_STATE_CHANGED_EVENT } from '@shared/ipc'

/**
 * App updates (V2 Phase R4). All network checks run in the MAIN process —
 * the renderer never talks to GitHub, so the renderer CSP stays unchanged.
 *
 * - Windows (NSIS) and Linux AppImage: electron-updater downloads the release
 *   silently, then the renderer shows "Restart to update". We NEVER call
 *   quitAndInstall on our own — quitting is always the person's choice, and a
 *   short grace delay lets any in-flight notes autosave land first.
 * - macOS: Squirrel.Mac refuses updates for unsigned builds, and MOSS ships
 *   unsigned for now (release Plan B — no Apple Developer account). So on
 *   macOS we only compare versions against the GitHub releases API and point
 *   at the download page. Flip MAC_SIGNED to true once notarized builds ship.
 * - Linux deb installs and dev builds also get the notify-only path.
 */

const GITHUB_OWNER = 'braxtonhughes360-ship-it'
const GITHUB_REPO = 'moss'
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 15_000
/** Notes autosave debounce is 450ms; give in-flight saves room before quitting. */
const RESTART_GRACE_MS = 800

const MAC_SIGNED = false

const CHECK_FAILED_COPY = "Couldn't check for updates. MOSS will try again later."

function resolveMode(): UpdateMode {
  if (!app.isPackaged) return 'notify'
  if (process.platform === 'darwin') return MAC_SIGNED ? 'auto' : 'notify'
  // electron-updater on Linux only handles AppImage; deb installs update by hand.
  if (process.platform === 'linux' && !process.env.APPIMAGE) return 'notify'
  return 'auto'
}

const state: UpdateState = {
  currentVersion: app.getVersion(),
  mode: resolveMode(),
  status: 'idle',
  lastCheckedAt: null,
  latestVersion: null,
  downloadUrl: null,
  message: null
}

let started = false
let checkTimer: NodeJS.Timeout | null = null
let checkInFlight: Promise<void> | null = null
let autoUpdaterWired = false

export function getUpdateState(): UpdateState {
  return { ...state }
}

function setState(patch: Partial<UpdateState>): void {
  Object.assign(state, patch)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATES_STATE_CHANGED_EVENT, getUpdateState())
    }
  }
}

/**
 * Called after the first successful profile activation (never before — launch
 * stays quiet until someone is actually in). Starts the immediate check plus
 * the daily re-check.
 */
export function startUpdateChecks(): void {
  if (started) return
  started = true

  // Small delay so the check never competes with post-unlock module syncs.
  setTimeout(() => {
    void checkForUpdates()
  }, FIRST_CHECK_DELAY_MS)

  checkTimer = setInterval(() => {
    void checkForUpdates()
  }, CHECK_INTERVAL_MS)
}

export function shutdownUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
}

export function checkForUpdates(): Promise<void> {
  if (checkInFlight) return checkInFlight
  // An update already sitting downloaded stays downloaded; re-checking would
  // only churn the banner.
  if (state.status === 'ready-to-install') return Promise.resolve()

  checkInFlight = (state.mode === 'auto' ? runAutoCheck() : runNotifyCheck()).finally(() => {
    checkInFlight = null
  })
  return checkInFlight
}

/** Renderer asked to restart into the downloaded update (auto mode only). */
export async function restartAndInstall(): Promise<void> {
  if (state.mode !== 'auto' || state.status !== 'ready-to-install') {
    throw new Error('No downloaded update to install')
  }
  const { autoUpdater } = await import('electron-updater')
  // Let any in-flight autosave IPC (notes debounce) finish writing first.
  await new Promise((resolve) => setTimeout(resolve, RESTART_GRACE_MS))
  autoUpdater.quitAndInstall()
}

// --- notify mode: GitHub releases API version compare -----------------------

interface GithubRelease {
  tag_name?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
}

async function fetchLatestRelease(): Promise<GithubRelease | null> {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `MOSS/${state.currentVersion}`
  }

  const latest = await fetch(`${RELEASES_API}/latest`, { headers })
  if (latest.ok) {
    return (await latest.json()) as GithubRelease
  }

  // During the beta everything may be marked "pre-release", which /latest
  // excludes (404). Fall back to the newest published release of any kind.
  if (latest.status === 404) {
    const list = await fetch(`${RELEASES_API}?per_page=10`, { headers })
    if (list.ok) {
      const releases = (await list.json()) as GithubRelease[]
      return releases.find((release) => !release.draft) ?? null
    }
    // 404 here means the repo itself isn't visible yet (still private
    // pre-Phase-3) — same as "no releases published": nothing to offer.
    if (list.status === 404) return null
    throw new Error(`GitHub releases list: HTTP ${list.status}`)
  }

  throw new Error(`GitHub latest release: HTTP ${latest.status}`)
}

async function runNotifyCheck(): Promise<void> {
  setState({ status: 'checking', message: null })
  try {
    const release = await fetchLatestRelease()
    const latestVersion = release?.tag_name?.replace(/^v/i, '') ?? null
    const checkedAt = new Date().toISOString()

    if (latestVersion && isNewerVersion(latestVersion, state.currentVersion)) {
      setState({
        status: 'update-available',
        lastCheckedAt: checkedAt,
        latestVersion,
        downloadUrl: release?.html_url ?? RELEASES_PAGE
      })
    } else {
      setState({
        status: 'up-to-date',
        lastCheckedAt: checkedAt,
        latestVersion: latestVersion ?? state.currentVersion,
        downloadUrl: null
      })
    }
  } catch {
    setState({
      status: 'error',
      lastCheckedAt: new Date().toISOString(),
      message: CHECK_FAILED_COPY
    })
  }
}

// --- auto mode: electron-updater silent download -----------------------------

async function runAutoCheck(): Promise<void> {
  try {
    const { autoUpdater } = await import('electron-updater')

    if (!autoUpdaterWired) {
      autoUpdaterWired = true
      autoUpdater.autoDownload = true
      // Belt and braces: if the person quits normally before clicking
      // "Restart to update", the pending update still lands on next launch.
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('update-available', (info) => {
        setState({
          status: 'downloading',
          lastCheckedAt: new Date().toISOString(),
          latestVersion: info.version,
          downloadUrl: null
        })
      })
      autoUpdater.on('update-not-available', (info) => {
        setState({
          status: 'up-to-date',
          lastCheckedAt: new Date().toISOString(),
          latestVersion: info.version ?? state.currentVersion,
          downloadUrl: null
        })
      })
      autoUpdater.on('update-downloaded', (info) => {
        setState({
          status: 'ready-to-install',
          lastCheckedAt: new Date().toISOString(),
          latestVersion: info.version,
          downloadUrl: null
        })
      })
      autoUpdater.on('error', () => {
        setState({
          status: 'error',
          lastCheckedAt: new Date().toISOString(),
          message: CHECK_FAILED_COPY
        })
      })
    }

    setState({ status: 'checking', message: null })
    await autoUpdater.checkForUpdates()
    // Terminal states arrive via the events above; 'checking' only remains if
    // a download is still streaming, which 'update-available' already covers.
  } catch {
    setState({
      status: 'error',
      lastCheckedAt: new Date().toISOString(),
      message: CHECK_FAILED_COPY
    })
  }
}
