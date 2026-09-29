/**
 * 对话链路记录（主进程内存态）。
 *
 * 目的：把「一次对话到底发了什么」原样留下来 —— 每轮的完整请求体（含 tool loop
 * 逐轮重发的 wire 消息序列）、服务端返回的 SSE 帧样例、工具调用与结果 —— 供
 * 界面按需查看，用于学习 OpenAI 兼容协议与工具调用机制。
 *
 * 边界（刻意的）：
 *   - **只存内存**：应用重启即清空，不是持久化功能；条数与体积都有上限，
 *     超限淘汰最旧 / 截断，绝不给主进程内存埋雷。
 *   - **密钥不在本层处理**：chat.ts 回调出去的请求头已经脱敏，这里照单全收。
 *   - 不 import electron：`npm run smoke:chattrace` 可以直接驱动它。
 */
import type {
  ChatMeta,
  ChatToolCall,
  ChatToolResult,
  ChatTrace,
  ChatTraceRound,
} from '../../src/lib/chat-types'

/** 最多保留多少条链路（超过淘汰最旧；Map 迭代序 = 插入序，天然支持 FIFO） */
export const CHAT_TRACE_MAX_TRACES = 20
/** 单轮请求体保留上限（字符）；超过截断并标记 truncated */
export const CHAT_TRACE_MAX_BODY = 48_000
/** 单轮最多保留多少条 SSE 帧 */
export const CHAT_TRACE_MAX_FRAMES = 300
/** 单条 SSE 帧保留上限（字符） */
export const CHAT_TRACE_MAX_FRAME = 1_500
/** 单次对话最多记多少轮（与 agent 的硬上限 20 对齐再留余量） */
export const CHAT_TRACE_MAX_ROUNDS = 24
/** 单轮最多记多少次工具调用（防御异常剧本） */
export const CHAT_TRACE_MAX_TOOLS = 64

/** chat.ts 的 onRequest/onFrame → 记录器的转发接口（agent 与纯对话路径都用它） */
export interface ChatTraceRecorder {
  request: (round: number, info: { url: string; headers: [string, string][]; body: string }) => void
  frame: (round: number, line: string) => void
  meta: (round: number, meta: ChatMeta | null) => void
  toolCall: (round: number, call: ChatToolCall) => void
  toolResult: (round: number, callId: string, result: ChatToolResult) => void
}

export interface ChatTraceRegistry {
  /** 一次对话开始时领取记录器；重复 begin 同一 id 会重置该条 */
  begin: (requestId: string) => ChatTraceRecorder
  get: (requestId: string) => ChatTrace | null
}

function clip(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false }
}

function ensureRound(trace: ChatTrace, round: number): ChatTraceRound | null {
  if (!Number.isInteger(round) || round < 1 || round > CHAT_TRACE_MAX_ROUNDS) return null
  let hit = trace.rounds.find((r) => r.round === round)
  if (!hit) {
    hit = {
      round,
      requestBody: '',
      truncated: false,
      frames: [],
      framesTruncated: false,
      meta: null,
      tools: [],
    }
    trace.rounds.push(hit)
    trace.rounds.sort((a, b) => a.round - b.round)
  }
  return hit
}

export function createChatTraceRegistry(): ChatTraceRegistry {
  const traces = new Map<string, ChatTrace>()

  return {
    begin(requestId: string): ChatTraceRecorder {
      const trace: ChatTrace = {
        requestId,
        startedAt: Date.now(),
        url: '',
        headers: [],
        rounds: [],
      }
      traces.delete(requestId) // 重发同一 id 时旧记录作废，且重新排到队尾
      traces.set(requestId, trace)
      while (traces.size > CHAT_TRACE_MAX_TRACES) {
        const oldest = traces.keys().next().value
        if (oldest === undefined) break
        traces.delete(oldest)
      }

      return {
        request: (round, info) => {
          const r = ensureRound(trace, round)
          if (!r) return
          if (!trace.url) {
            trace.url = info.url
            trace.headers = info.headers
          }
          const body = clip(info.body, CHAT_TRACE_MAX_BODY)
          r.requestBody = body.text
          r.truncated = r.truncated || body.truncated
        },
        frame: (round, line) => {
          const r = ensureRound(trace, round)
          if (!r) return
          if (r.frames.length >= CHAT_TRACE_MAX_FRAMES) {
            r.framesTruncated = true
            return
          }
          const f = clip(line, CHAT_TRACE_MAX_FRAME)
          r.frames.push(f.text)
          if (f.truncated) r.framesTruncated = true
        },
        meta: (round, meta) => {
          const r = ensureRound(trace, round)
          if (r) r.meta = meta
        },
        toolCall: (round, call) => {
          const r = ensureRound(trace, round)
          if (!r || r.tools.length >= CHAT_TRACE_MAX_TOOLS) return
          r.tools.push({ call, result: null })
        },
        toolResult: (round, callId, result) => {
          const r = ensureRound(trace, round)
          if (!r) return
          // 结果按 id 回填到对应的调用上；找不到（防御）就追加
          const hit = r.tools.find((t) => t.call.id === callId && t.result === null)
          if (hit) hit.result = result
          else if (r.tools.length < CHAT_TRACE_MAX_TOOLS) r.tools.push({ call: { id: callId, name: '', args: '' }, result })
        },
      }
    },

    get(requestId: string): ChatTrace | null {
      return traces.get(requestId) ?? null
    },
  }
}
