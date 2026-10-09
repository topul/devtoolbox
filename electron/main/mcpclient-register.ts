/**
 * MCP 客户端（Inspector）的 IPC 注册。
 *
 * 编排逻辑在 electron/main/mcpclient-ipc.ts（不 import electron，供 smoke 直接驱动），
 * 本文件只负责把控制器接到 ipcMain 与真实窗口上。
 */
import { app, ipcMain } from 'electron'
import { createMcpClientController } from './mcpclient-ipc'
import { getMainWindow } from './window'
import type { McpClientEvent, McpConnectSpec } from '../../src/lib/mcpclient-types'

function sendMcpClientEvent(evt: McpClientEvent): void {
  getMainWindow()?.webContents.send('mcpclient:event', evt)
}

export function setupMcpClientIpc(): void {
  const ctl = createMcpClientController({ emit: sendMcpClientEvent }, { version: app.getVersion() })
  ipcMain.handle('mcpclient:connect', (_e, spec: McpConnectSpec) => ctl.connect(spec))
  ipcMain.handle('mcpclient:call', (_e, arg: { name: string; args?: Record<string, unknown> }) =>
    ctl.callTool(String(arg?.name ?? ''), arg?.args ?? {}),
  )
  ipcMain.handle('mcpclient:read-resource', (_e, uri: string) => ctl.readResource(String(uri)))
  ipcMain.handle(
    'mcpclient:get-prompt',
    (_e, arg: { name: string; args?: Record<string, unknown> }) =>
      ctl.getPrompt(String(arg?.name ?? ''), arg?.args ?? {}),
  )
  ipcMain.handle('mcpclient:ping', () => ctl.ping())
  ipcMain.handle('mcpclient:disconnect', () => ctl.disconnect())
}
