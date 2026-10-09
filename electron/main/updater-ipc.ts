/**
 * 自动更新：事件推送到渲染层 + 手动检查 / 退出即安装。
 */
import { app, ipcMain } from 'electron'
// electron-updater 是 tsc 编译的 CJS 包，导出用 Object.defineProperty(getter) 定义，
// Node 的 ESM named-export 探测（cjs-module-lexer）识别不到 → 必须走 default 再解构
// （具名导入写法受 scripts/check-main-imports.mjs 校验，勿改成 import { autoUpdater }）
import electronUpdater from 'electron-updater'
import { getMainWindow } from './window'

const { autoUpdater } = electronUpdater

function sendUpdaterEvent(evt: Record<string, unknown>): void {
  getMainWindow()?.webContents.send('updater:event', evt)
}

export function setupAutoUpdater(): void {
  // 开发环境跳过自动更新
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendUpdaterEvent({ type: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    sendUpdaterEvent({ type: 'available', version: info.version }),
  )
  autoUpdater.on('update-not-available', () => sendUpdaterEvent({ type: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    sendUpdaterEvent({ type: 'progress', percent: p.percent }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    sendUpdaterEvent({ type: 'downloaded', version: info.version }),
  )
  autoUpdater.on('error', () => sendUpdaterEvent({ type: 'error' }))

  // 启动 3 秒后检查，之后每 4 小时检查一次
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 3000)
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch(() => {})
    },
    4 * 60 * 60 * 1000,
  )
}

export function setupUpdaterIpc(): void {
  ipcMain.handle('updater:check', () => {
    sendUpdaterEvent({ type: 'checking' })
    return autoUpdater.checkForUpdates().catch(() => {
      sendUpdaterEvent({ type: 'error' })
    })
  })

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall()
  })
}
