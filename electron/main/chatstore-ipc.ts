/**
 * 对话会话存储的 IPC：会话的增删读存与活跃会话指针。
 * 存储实现在 electron/main/chat-store.ts（可被 smoke:chatstore 单独驱动）。
 */
import { app, ipcMain } from 'electron'
import { createChatStore, type ChatStore } from './chat-store'

// 惰性创建：userData 路径在 app ready 之后才最终确定，别在模块加载时就解析
let chatStoreRef: ChatStore | null = null
function chatStore(): ChatStore {
  return (chatStoreRef ??= createChatStore(app.getPath('userData')))
}

export function setupChatStoreIpc(): void {
  ipcMain.handle('chatstore:list', () => chatStore().list())
  ipcMain.handle('chatstore:load', (_e, id: string) => chatStore().load(String(id ?? '')))
  ipcMain.handle(
    'chatstore:save',
    (_e, input: { id?: string; title?: string; turns?: unknown[] }) =>
      chatStore().save({
        id: String(input?.id ?? ''),
        title: String(input?.title ?? ''),
        turns: Array.isArray(input?.turns) ? input.turns : [],
      }),
  )
  ipcMain.handle('chatstore:remove', (_e, id: string) => chatStore().remove(String(id ?? '')))
  ipcMain.handle('chatstore:file', () => chatStore().filePath())
  ipcMain.handle('chatstore:set-active', (_e, id: string | null) =>
    chatStore().setActive(id === null || id === undefined ? null : String(id)),
  )
}
