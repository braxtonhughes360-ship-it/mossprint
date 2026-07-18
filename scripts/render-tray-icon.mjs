// Renders build/tray-template.svg → build/trayTemplate.png (macOS @2x template)
// and build/trayIcon.png (Windows/Linux tray). Run: npm run icon:tray
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'build', 'tray-template.svg')

async function renderPng(svg, size, outPath) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden;display:grid;place-items:center}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`

  const win = new BrowserWindow({
    width: size,
    height: size,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise((r) => setTimeout(r, 200))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
    writeFileSync(outPath, image.toPNG())
    console.log(`wrote ${outPath}`)
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}

app.disableHardwareAcceleration()
app
  .whenReady()
  .then(async () => {
    if (!existsSync(svgPath)) throw new Error(`missing ${svgPath}`)
    const svg = readFileSync(svgPath, 'utf8')
  await renderPng(svg, 44, join(root, 'build', 'trayTemplate.png'))
  await new Promise((r) => setTimeout(r, 100))
  await renderPng(svg, 32, join(root, 'build', 'trayIcon.png'))
    app.exit(0)
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
