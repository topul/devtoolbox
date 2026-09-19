/**
 * 让 AI SDK 的 `useChat` 走**本应用自己的 IPC 通道**。
 *
 * 为什么不直接用 AI SDK 自带的 fetch transport：渲染层在生产构建里受严格 CSP 约束
 * （`connect-src 'self'`），直连模型服务商会被静默挡掉；而且绕过主进程就等于丢掉
 * 上游代理（HTTP / SOCKS5）、TLS 校验开关、自定义请求头与 zstd 解压这些能力。
 * 所以这里把 `ChatTransport` 接到既有的 `chat:send` / `chat:event` 上：
 * 主进程的流式内核与工具循环一行没动，`useChat` 只管界面状态。
 *
 * 两个必须守住的时序：
 *   1. **先订阅再发送** —— 主进程可能在回复 invoke 之前就把前几个增量发出去了，
 *      订阅晚了会丢掉开头几个字（所以下面的 buffer 不是冗余设计）。
 *   2. **取消要双向** —— `abortSignal` 触发时既要立刻收掉本流，也要通知主进程停掉
 *      上游请求，否则 token 还在烧。
 */
import type { ChatTransport, UIMessageChunk } from 'ai'
import type { ChatEvent, ChatSendResult, ChatSendSpec } from './chat-types'
import {
  chunksForEvent,
  createChunkState,
  uiMessagesToHistory,
  type ChatUIMessage,
} from './chat-ui'
import { uuidV4 } from './toolkit'

/** 只依赖三个方法，便于用假实现驱动（真机上是 `window.electronAPI.chat`） */
export interface ChatIpcBridge {
  send: (spec: ChatSendSpec) => Promise<ChatSendResult>
  abort: () => Promise<boolean>
  onEvent: (callback: (evt: ChatEvent) => void) => () => void
}

export interface ChatTransportHost {
  api: ChatIpcBridge | undefined
  /**
   * 组装发往主进程的请求。**没有默认值**：baseUrl / 模型 / 工具源都在界面状态里，
   * 由调用方按当前配置生成；配置不完整时抛错，界面会看到失败原因。
   */
  buildSpec: (messages: ChatSendSpec['messages'], requestId: string) => ChatSendSpec
  /** 用户消息已进列表 —— 立刻落盘，中途退出至少问题还在 */
  onUserMessage: (messages: ChatUIMessage[]) => void
  /** 工具清单就绪（界面瞬时状态，不写进消息） */
  onTools?: (tools: { name: string; description: string }[]) => void
  /** 第几轮工具调用 */
  onRound?: (info: { round: number; max: number } | null) => void
  /** 工具源部分失败的提示 */
  onNotice?: (text: string) => void
  /** 一次新请求开始：调用方借此复位上一轮的瞬时状态 */
  onRequestStart?: () => void
  /** 取消息 id（默认 uuid）；测试里传固定值可得到稳定断言 */
  nextId?: () => string
}

export function createIpcChatTransport(host: ChatTransportHost): ChatTransport<ChatUIMessage> {
  const nextId = host.nextId ?? uuidV4

  return {
    async sendMessages({ messages, abortSignal }): Promise<ReadableStream<UIMessageChunk>> {
      const api = host.api
      if (!api) throw new Error('NO_DESKTOP')

      const requestId = nextId()
      const state = createChunkState()
      host.onRequestStart?.()
      // 用户消息先落盘（不含还没开始的助手消息）
      host.onUserMessage(messages)

      /* ---- 缓冲区：订阅先于发送，期间到的片段先攒着 ---- */
      let controller: ReadableStreamDefaultController<UIMessageChunk> | null = null
      let finished = false
      const buffered: UIMessageChunk[] = []

      const enqueue = (chunk: UIMessageChunk): void => {
        if (controller) {
          try {
            controller.enqueue(chunk)
          } catch {
            /* 消费者已经关掉，忽略 */
          }
        } else {
          buffered.push(chunk)
        }
      }

      const finish = (): void => {
        if (finished) return
        finished = true
        if (controller) {
          try {
            controller.close()
          } catch {
            /* 已经关了 */
          }
        }
      }

      let unsubscribe: (() => void) | null = null
      let abortListener: (() => void) | null = null
      const cleanup = (): void => {
        unsubscribe?.()
        unsubscribe = null
        if (abortListener && abortSignal) {
          abortSignal.removeEventListener('abort', abortListener)
          abortListener = null
        }
      }

      // 助手消息先挂上去：接口慢的时候界面不能一片空白
      enqueue({ type: 'start', messageId: requestId })

      unsubscribe = api.onEvent((evt: ChatEvent) => {
        if (evt.requestId !== requestId) return
        switch (evt.type) {
          case 'toolsReady':
            host.onTools?.(evt.tools)
            return
          case 'round':
            host.onRound?.({ round: evt.round, max: evt.maxRounds })
            return
          case 'notice':
            host.onNotice?.(evt.text)
            return
          default:
            break
        }
        for (const chunk of chunksForEvent(state, evt)) enqueue(chunk)
        if (evt.type === 'done') {
          cleanup()
          finish()
        } else if (evt.type === 'error') {
          cleanup()
          // ABORTED 已经在映射里收成 abort 片段，不当失败收场（否则「已停止」会显示成「失败」）
          finish()
        }
      })

      if (abortSignal) {
        abortListener = () => {
          cleanup()
          // 双向取消：本流立刻收掉，同时让主进程停掉上游请求
          void api.abort().catch(() => undefined)
          finish()
        }
        if (abortSignal.aborted) abortListener()
        else abortSignal.addEventListener('abort', abortListener)
      }

      /* ---- 发请求 ---- */
      let result: ChatSendResult
      try {
        result = await api.send(host.buildSpec(uiMessagesToHistory(messages), requestId))
      } catch (e) {
        result = { ok: false, error: (e as Error).message }
      }

      if (!result.ok) {
        // 参数错误也要让用户看得见：助手气泡里直接标出来
        enqueue({ type: 'error', errorText: result.error || 'SEND_FAILED' })
        cleanup()
        finish()
      }

      return new ReadableStream<UIMessageChunk>({
        start(c) {
          controller = c
          for (const chunk of buffered) {
            try {
              c.enqueue(chunk)
            } catch {
              break
            }
          }
          buffered.length = 0
          if (finished) {
            try {
              c.close()
            } catch {
              /* 已经关了 */
            }
          }
        },
        cancel() {
          cleanup()
          void api.abort().catch(() => undefined)
        },
      })
    },

    /** 本应用的流不跨进程存续，没有「重连」这回事 */
    async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
      return null
    },
  }
}
