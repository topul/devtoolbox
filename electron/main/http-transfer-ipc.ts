/**
 * 请求导入 / 导出（系统文件对话框）：HTTP 工具的文件落盘与回读。
 */
import { app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import fs from 'node:fs'
import { askSavePath, getMainWindow } from './window'
import type { HttpPickFileResult, HttpTransferResult } from '../../src/lib/http-types'

/** 只留文件名安全字符，避免用户填的名字带路径分隔符 */
function sanitizeFileName(name: string): string {
  const base = String(name ?? '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim()
  return base || 'devtoolbox-requests.json'
}

export function setupHttpTransferIpc(): void {
  ipcMain.handle(
    'http:export-file',
    async (
      _e,
      payload: { title?: string; name?: string; content?: string } = {},
    ): Promise<HttpTransferResult> => {
      const content = typeof payload.content === 'string' ? payload.content : ''
      if (!content) return { ok: false, path: '', error: 'EMPTY_PAYLOAD' }
      const filePath = await askSavePath({
        title: payload.title,
        defaultPath: join(app.getPath('downloads'), sanitizeFileName(payload.name ?? '')),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (!filePath) return { ok: false, canceled: true, path: '' }
      try {
        fs.writeFileSync(filePath, content, 'utf8')
        return { ok: true, path: filePath }
      } catch (err) {
        return { ok: false, path: '', error: (err as Error).message }
      }
    },
  )

  ipcMain.handle('http:import-file', async (_e, title?: string): Promise<HttpTransferResult> => {
    const win = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title,
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const result =
      win && !win.isDestroyed()
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
    const filePath = result.canceled ? '' : (result.filePaths[0] ?? '')
    if (!filePath) return { ok: false, canceled: true, path: '' }
    try {
      if (fs.statSync(filePath).size > 8 * 1024 * 1024)
        return { ok: false, path: filePath, error: 'FILE_TOO_LARGE' }
      return { ok: true, path: filePath, content: fs.readFileSync(filePath, 'utf8') }
    } catch (err) {
      return { ok: false, path: '', error: (err as Error).message }
    }
  })

  // 上传体选择：只回文件名与 Base64 正文，路径不回流渲染进程
  ipcMain.handle('http:pick-file', async (): Promise<HttpPickFileResult> => {
    const win = getMainWindow()
    const options: Electron.OpenDialogOptions = { properties: ['openFile'] }
    const result =
      win && !win.isDestroyed()
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
    const filePath = result.canceled ? '' : (result.filePaths[0] ?? '')
    if (!filePath) return { ok: false, canceled: true }
    try {
      if (fs.statSync(filePath).size > 8 * 1024 * 1024)
        return { ok: false, error: 'FILE_TOO_LARGE' }
      const buf = fs.readFileSync(filePath)
      return {
        ok: true,
        name: filePath.split(/[\\/]/).pop() ?? 'file',
        base64: buf.toString('base64'),
        bytes: buf.length,
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
