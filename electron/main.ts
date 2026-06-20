import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { SiteRepository } from './services/SiteRepository'
import { registerSitesIpc } from './ipc/sites'
import { registerNetworkIpc } from './ipc/network'
import { registerRecoverTunnelIpc } from './ipc/recover'
import { registerWatchdogIpc } from './ipc/watchdog'
import { registerRemoteSupportIpc } from './ipc/remoteSupport'
import { registerWifiIpc } from './ipc/wifi'
import { registerSetupIpc } from './ipc/setup'

// vite-plugin-electron bundles this file to dist-electron/main.js (CommonJS), so __dirname
// here is dist-electron/ both in dev and once packaged.
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
export const MAIN_DIST = path.join(process.env.APP_ROOT!, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT!, 'dist')

let mainWindow: BrowserWindow | null = null

// Single-instance lock — this app has no tray/background behaviour but SSH sessions to a router
// shouldn't be opened twice from two app instances by accident.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    icon: path.join(process.env.APP_ROOT!, 'build/app.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(MAIN_DIST, 'preload.js'),
    },
  })

  // Open any target="_blank" links in the OS browser instead of a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerAllIpc() {
  const csvPath = path.join(app.getPath('userData'), 'sites.csv')
  seedSitesCsvIfMissing(csvPath)
  const repo = new SiteRepository(csvPath)

  registerSitesIpc(repo)
  registerNetworkIpc()
  registerRecoverTunnelIpc()
  registerWatchdogIpc()
  registerRemoteSupportIpc()
  registerWifiIpc()
  registerSetupIpc(repo)
}

/**
 * On first run (no sites.csv yet in this user's app-data folder), seeds it from the bundled
 * seed-sites.csv so existing tracked sites show up immediately instead of an empty list.
 * In dev this reads electron/seed-sites.csv next to this file; once packaged, electron-builder's
 * extraResources copies it to process.resourcesPath instead (see electron-builder.yml).
 */
function seedSitesCsvIfMissing(csvPath: string) {
  if (fs.existsSync(csvPath)) return
  const seedPath = app.isPackaged
    ? path.join(process.resourcesPath, 'seed-sites.csv')
    : path.join(process.env.APP_ROOT!, 'electron/seed-sites.csv')
  try {
    if (fs.existsSync(seedPath)) {
      fs.mkdirSync(path.dirname(csvPath), { recursive: true })
      fs.copyFileSync(seedPath, csvPath)
    }
  } catch {
    // No seed file available — app just starts with an empty site list, which is fine.
  }
}

app.whenReady().then(() => {
  registerAllIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
