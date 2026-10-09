/**
 * 主进程入口：只保留窗口编排与应用生命周期（ready / activate / will-quit / window-all-closed）。
 *
 * 各功能域的 IPC 注册拆在同目录的域文件里，入口只负责按序调用注册函数：
 *   - window.ts            主窗口引用 / 创建 / 保存对话框 / 主题
 *   - updater-ipc.ts       自动更新
 *   - proxy-ipc.ts         抓包代理（含启动同步与退出清理）
 *   - http-transfer-ipc.ts 请求导入 / 导出（系统文件对话框）
 *   - net-ipc.ts           HTTP 发送 / 端口 / TLS / SSE / WebSocket
 *   - app-ipc.ts           应用版本 / 外链 / MCP 接入信息
 *   - chat-register.ts     流式对话（编排逻辑在 chat-ipc.ts）
 *   - mcpclient-register.ts MCP 客户端（编排逻辑在 mcpclient-ipc.ts）
 *   - chatstore-ipc.ts     对话会话存储
 *   - agentrules-register.ts Agent 规则文件生成器（编排逻辑在 agentrules-ipc.ts）
 *
 * 注意：IPC 通道名必须以字面量写在 ipcMain.handle/on 调用处，
 * scripts/check-ipc-channels.mjs（smoke:ipc）靠正则抓取它们与 preload 对齐。
 */
import { app, BrowserWindow } from 'electron'
import { createWindow } from './window'
import { setupAutoUpdater, setupUpdaterIpc } from './updater-ipc'
import { cleanupProxyBeforeQuit, setupProxyIpc, startProxyServices } from './proxy-ipc'
import { setupHttpTransferIpc } from './http-transfer-ipc'
import { setupNetIpc } from './net-ipc'
import { setupAppIpc } from './app-ipc'
import { setupChatIpc } from './chat-register'
import { setupMcpClientIpc } from './mcpclient-register'
import { setupChatStoreIpc } from './chatstore-ipc'
import { setupAgentRulesIpc } from './agentrules-register'

// ---- IPC：各功能域注册 ----
setupAppIpc()
setupUpdaterIpc()
setupProxyIpc()
setupHttpTransferIpc()
setupNetIpc()
setupChatIpc()
setupMcpClientIpc()
setupChatStoreIpc()
setupAgentRulesIpc()

// ---- App lifecycle ----
app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()
  startProxyServices()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', (event) => {
  cleanupProxyBeforeQuit(event)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
