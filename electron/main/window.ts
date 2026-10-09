/**
 * 主窗口：持有唯一引用、创建与窗口相关的外观设置。
 *
 * mainWindow 被更新器、抓包代理、对话等多个域用来向渲染层推事件，
 * 统一在这里持有，其他模块通过 getMainWindow() 取引用，
 * 避免各域各自维护一份会失同步的窗口指针。
 */
import { BrowserWindow, app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// 主进程产物为 ESM（package.json type: module），electron-vite 会把 __dirname 编译成 import.meta.dirname
export function createWindow(): void {
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
      // 必须是 .cjs：sandbox: true 时 Electron 以经典脚本加载 preload，ESM 会直接加载失败
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
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

/** 统一的保存对话框（有无主窗口两种情况的重载不同，这里包一层） */
export async function askSavePath(options: Electron.SaveDialogOptions): Promise<string | null> {
  const win = mainWindow
  const result =
    win && !win.isDestroyed()
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

// 主题变化 → 通知渲染进程
nativeTheme.on('updated', () => {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  mainWindow?.webContents.send('theme:changed', theme)
})

ipcMain.handle('theme:get', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

ipcMain.handle('theme:set', (_event, theme: 'dark' | 'light' | 'system') => {
  nativeTheme.themeSource = theme
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})
