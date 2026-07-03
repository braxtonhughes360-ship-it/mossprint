// Renders build/icon.svg → build/icon.png (1024², alpha) with Electron's own
// Chromium, then assembles build/icon.icns via sips/iconutil on macOS.
// electron-builder picks both up from build/ automatically (and derives the
// Windows .ico from icon.png). Run: npm run icon:render
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'build', 'icon.svg')
const pngPath = join(root, 'build', 'icon.png')

async function renderPng() {
  const svg = readFileSync(svgPath, 'utf8')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;width:1024px;height:1024px;overflow:hidden}
    svg{display:block}
  </style></head><body>${svg}</body></html>`

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })

  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  // One breath so filters/gradients settle before capture.
  await new Promise((r) => setTimeout(r, 400))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  writeFileSync(pngPath, image.toPNG())
  win.destroy()
  console.log(`wrote ${pngPath}`)
}

function buildIcns() {
  if (process.platform !== 'darwin') {
    console.log('skipping .icns (not macOS)')
    return
  }
  const iconset = join(root, 'build', 'icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]
  for (const [size, name] of sizes) {
    execSync(`sips -z ${size} ${size} "${pngPath}" --out "${join(iconset, name)}"`, {
      stdio: 'pipe'
    })
  }
  execSync(`iconutil -c icns "${iconset}" -o "${join(root, 'build', 'icon.icns')}"`)
  rmSync(iconset, { recursive: true, force: true })
  console.log(`wrote ${join(root, 'build', 'icon.icns')}`)
}

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(async () => {
    if (!existsSync(svgPath)) throw new Error(`missing ${svgPath}`)
    await renderPng()
    buildIcns()
    app.exit(0)
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
