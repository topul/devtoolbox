/**
 * 流式对话（AI 调试）的 IPC 注册。
 *
 * 编排逻辑在 electron/main/chat-ipc.ts，宿主能力从外面注入 —— 那一层不 import electron，
 * 才能被 smoke 脚本直接验证；本文件只负责把它接到 ipcMain 与真实窗口上。
 */
import { ipcMain } from 'electron'
import { createChatController } from './chat-ipc'
import { probeServer } from './mcp-probe'
import { getMainWindow } from './window'
import type {
  ChatEvent,
  ChatSendResult,
  ChatSendSpec,
  ChatToolServer,
  ChatTraceResult,
} from '../../src/lib/chat-types'

function sendChatEvent(evt: ChatEvent): void {
  getMainWindow()?.webContents.send('chat:event', evt)
}

const chatController = createChatController({ emit: sendChatEvent })

export function setupChatIpc(): void {
  ipcMain.handle('chat:send', (_e, spec: ChatSendSpec): ChatSendResult => chatController.send(spec))
  ipcMain.handle('chat:abort', (): boolean => chatController.abort())
  ipcMain.handle('chat:trace', (_e, id: unknown): ChatTraceResult =>
    chatController.trace(String(id ?? '')),
  )
  // 工具源连通性探测：一次性连接（连上→拉目录→立刻断开），与 agent 会话互不相干
  ipcMain.handle('chat:probe-server', (_e, src: ChatToolServer) => probeServer(src))
}
