/**
 * 流式对话的 IPC 编排（主进程）。
 *
 * 单独拆出来是为了可被脚本验证：宿主只注入一个 `emit`（真实场景是 webContents.send），
 * 这样 `npm run smoke:chat` 就能在不启动 electron 的情况下断言
 * 「多流并发互不干扰」「同 id 重发顶掉旧流」「定向取消」这些容易静默失效的约定。
 *
 * 多路复用：事件全部带 requestId，协议层天然支持并行 —— 主对话页同时只有一条，
 * 模型对比页（chat-compare）需要同一次 fan-out 多条流并行，所以 active 按 requestId 管理。
 */
import { chatStream } from './chat'
import { runChatAgent } from './chat-agent'
import { createChatTraceRegistry, type ChatTraceRecorder } from './chat-trace'
import type { ChatEvent, ChatSendResult, ChatSendSpec, ChatTraceResult } from '../../src/lib/chat-types'

export interface ChatHost {
  /** 把事件推给渲染层 */
  emit: (evt: ChatEvent) => void
}

export interface ChatController {
  send: (spec: ChatSendSpec) => ChatSendResult
  /** 取消：给定 id 只停那条；不给 id 停掉全部（主对话页只有一条流，语义不变） */
  abort: (requestId?: string) => boolean
  /** 是否有任何流在跑（供测试与调试观察） */
  isActive: () => boolean
  /** 当前活跃流条数（多路复用的观察口） */
  activeCount: () => number
  /** 取一条对话的链路记录；没有（旧会话 / 已淘汰）返回 NOT_FOUND */
  trace: (requestId: string) => ChatTraceResult
}

export function createChatController(host: ChatHost): ChatController {
  const active = new Map<string, { abort: () => void }>()
  let seq = 0
  const traces = createChatTraceRegistry()

  /** 纯对话路径的 trace 转发（agent 路径由 runChatAgent 自己接） */
  const plainTrace = (recorder: ChatTraceRecorder) => ({
    onRequest: (info: { url: string; headers: [string, string][]; body: string }): void => recorder.request(1, info),
    onFrame: (line: string): void => recorder.frame(1, line),
  })

  return {
    send(spec: ChatSendSpec): ChatSendResult {
      const requestId = spec.requestId || `chat-${Date.now().toString(36)}-${(++seq).toString(36)}`
      // 同一个 id 重发：顶掉旧流（防重复），不同 id 并行 —— 界面按 requestId 归组，互不打架
      active.get(requestId)?.abort()

      try {
        // 配了工具服务端就走 agent 循环：它会自己发 start（起点在它内部更自然），
        // 且一条 send 最终只应产生一个 start 事件 —— 由 smoke 断言
        const useTools = !!spec.tools && (!!spec.tools.server?.command || !!spec.tools.servers?.length)
        const recorder = traces.begin(requestId)
        if (useTools) {
          const agent = runChatAgent({ ...spec, requestId, tools: spec.tools!, trace: recorder }, { emit: host.emit })
          active.set(requestId, { abort: agent.abort })
          return { ok: true, requestId }
        }

        // start 必须在建流之前发出：参数不合法时 chatStream 会同步回调 onError，
        // 那样事件顺序就变成「错误在前、开始在后」，看着很怪
        host.emit({ type: 'start', requestId })
        const t = plainTrace(recorder)
        const handle = chatStream({ ...spec, requestId }, {
          onDelta: (text, kind) => host.emit({ type: 'delta', requestId, text, kind, atMs: Date.now() }),
          onDone: (meta) => {
            active.delete(requestId)
            recorder.meta(1, meta)
            host.emit({ type: 'done', requestId, meta })
          },
          onError: (message, code) => {
            active.delete(requestId)
            host.emit({ type: 'error', requestId, message, code })
          },
          onRequest: t.onRequest,
          onFrame: t.onFrame,
        })
        active.set(requestId, { abort: handle.abort })
        return { ok: true, requestId }
      } catch (err) {
        host.emit({ type: 'error', requestId, message: (err as Error).message })
        return { ok: false, requestId, error: (err as Error).message }
      }
    },

    abort(requestId?: string): boolean {
      if (requestId) {
        const hit = active.get(requestId)
        if (!hit) return false
        active.delete(requestId)
        hit.abort()
        return true
      }
      if (!active.size) return false
      const all = [...active.values()]
      active.clear()
      for (const a of all) a.abort()
      return true
    },

    isActive: () => active.size > 0,

    activeCount: () => active.size,

    trace: (requestId: string): ChatTraceResult => {
      const hit = traces.get(requestId)
      return hit ? { ok: true, trace: hit } : { ok: false, error: 'NOT_FOUND' }
    },
  }
}
