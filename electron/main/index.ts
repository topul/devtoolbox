import { app, BrowserWindow, nativeTheme, ipcMain, shell } from 'electron'
import { join } from 'path'
// electron-updater 是 tsc 编译的 CJS 包，导出用 Object.defineProperty(getter) 定义，
// Node 的 ESM named-export 探测（cjs-module-lexer）识别不到 → 必须走 default 再解构
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

// 主进程产物为 ESM（package.json type: module），electron-vite 会把 __dirname 编译成 import.meta.dirname

let mainWindow: BrowserWindow | null = null

/* ================= 自动更新 ================= */

function sendUpdaterEvent(evt: Record<string, unknown>): void {
  mainWindow?.webContents.send('updater:event', evt)
}

function setupAutoUpdater(): void {
  // 开发环境跳过自动更新
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendUpdaterEvent({ type: 'checking' }))
  autoUpdater.on('update-available', (info) => sendUpdaterEvent({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => sendUpdaterEvent({ type: 'none' }))
  autoUpdater.on('download-progress', (p) => sendUpdaterEvent({ type: 'progress', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => sendUpdaterEvent({ type: 'downloaded', version: info.version }))
  autoUpdater.on('error', () => sendUpdaterEvent({ type: 'error' }))

  // 启动 3 秒后检查，之后每 4 小时检查一次
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 3000)
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 4 * 60 * 60 * 1000)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'DevOps Toolbox',
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 默认暗黑主题
  nativeTheme.themeSource = 'dark'

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 外部链接在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 主题变化 → 通知渲染进程
nativeTheme.on('updated', () => {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  mainWindow?.webContents.send('theme:changed', theme)
})

// ---- IPC ----
ipcMain.handle('app:get-version', () => app.getVersion())

ipcMain.handle('updater:check', () => {
  sendUpdaterEvent({ type: 'checking' })
  return autoUpdater.checkForUpdates().catch(() => {
    sendUpdaterEvent({ type: 'error' })
  })
})

ipcMain.handle('updater:quit-and-install', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('theme:get', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

ipcMain.handle('theme:set', (_event, theme: 'dark' | 'light' | 'system') => {
  nativeTheme.themeSource = theme
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

// ---- App lifecycle ----
app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
