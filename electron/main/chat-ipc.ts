/**
 * 流式对话的 IPC 编排（主进程）。
 *
 * 单独拆出来是为了可被脚本验证：宿主只注入一个 `emit`（真实场景是 webContents.send），
 * 这样 `npm run smoke:chat` 就能在不启动 electron 的情况下断言
 * 「同一时刻只允许一条流」「新请求顶掉旧的」「取消后事件形态」这些容易静默失效的约定。
 */
import { chatStream } from './chat'
import { runChatAgent } from './chat-agent'
import type { ChatEvent, ChatSendResult, ChatSendSpec } from '../../src/lib/chat-types'

export interface ChatHost {
  /** 把事件推给渲染层 */
  emit: (evt: ChatEvent) => void
}

export interface ChatController {
  send: (spec: ChatSendSpec) => ChatSendResult
  abort: () => boolean
  /** 当前是否有流在跑（供测试与调试观察） */
  isActive: () => boolean
}

export function createChatController(host: ChatHost): ChatController {
  let active: { requestId: string; abort: () => void } | null = null
  let seq = 0

  return {
    send(spec: ChatSendSpec): ChatSendResult {
      // 新请求顶掉旧的：不这样做会出现两条流同时往界面上打字
      active?.abort()
      const requestId = spec.requestId || `chat-${Date.now().toString(36)}-${(++seq).toString(36)}`

      try {
        // 配了工具服务端就走 agent 循环：它会自己发 start（起点在它内部更自然），
        // 且一条 send 最终只应产生一个 start 事件 —— 由 smoke 断言
        const useTools = !!spec.tools && (!!spec.tools.server?.command || !!spec.tools.servers?.length)
        if (useTools) {
          const agent = runChatAgent({ ...spec, requestId, tools: spec.tools! }, { emit: host.emit })
          active = { requestId, abort: agent.abort }
          return { ok: true, requestId }
        }

        // start 必须在建流之前发出：参数不合法时 chatStream 会同步回调 onError，
        // 那样事件顺序就变成「错误在前、开始在后」，看着很怪
        host.emit({ type: 'start', requestId })
        const handle = chatStream({ ...spec, requestId }, {
          onDelta: (text, kind) => host.emit({ type: 'delta', requestId, text, kind, atMs: Date.now() }),
          onDone: (meta) => {
            if (active?.requestId === requestId) active = null
            host.emit({ type: 'done', requestId, meta })
          },
          onError: (message, code) => {
            if (active?.requestId === requestId) active = null
            host.emit({ type: 'error', requestId, message, code })
          },
        })
        active = { requestId, abort: handle.abort }
        return { ok: true, requestId }
      } catch (err) {
        host.emit({ type: 'error', requestId, message: (err as Error).message })
        return { ok: false, requestId, error: (err as Error).message }
      }
    },

    abort(): boolean {
      if (!active) return false
      active.abort()
      active = null
      return true
    },

    isActive: () => !!active,
  }
}
