/**
 * 对话界面的消息模型与「主进程事件 → UI 消息流片段」的映射（纯逻辑）。
 *
 * 为什么要有这一层：界面从「自己攒 Block 数组」换成了 AI SDK 的 `useChat`
 * （消息 = parts 数组，text / reasoning / tool / data 各成部件）。换掉的是**渲染模型**，
 * 主进程的流式内核、代理、工具循环一行没动 —— 所以两边之间需要一个纯函数做翻译，
 * 而不是把翻译逻辑塞进组件（那样它就没法被脚本直接断言）。
 *
 * 这里不 import React / electron，可被冒烟脚本直接驱动。
 */
import type { UIMessage, UIMessageChunk } from 'ai'
import type { ChatEvent, ChatMessage, ChatMeta, ChatToolResult } from './chat-types'
import { uuidV4 } from './toolkit'

/**
 * 挂在消息 metadata 上的一轮统计。跟着消息一起落盘，
 * 所以「重启后还能看到上一轮的首字延迟/token/费用」。
 */
export interface ChatTurnMeta {
  meta?: ChatMeta
  /** 本轮实际跑了几轮工具调用 */
  rounds?: number
  /** 用户中途停止 */
  aborted?: boolean
  /** 这一轮失败的原因（界面直接显示） */
  error?: string
}

export type ChatUIMessage = UIMessage<ChatTurnMeta>

/** 工具部件的状态（与 AI SDK 的 `UIToolInvocation` 对齐，只取界面要用的部分） */
export interface ToolPartView {
  toolCallId: string
  toolName: string
  state: 'input-available' | 'output-available' | 'output-error'
  input: unknown
  output?: unknown
  errorText?: string
  /** 工具自己执行耗时；从结果文本里带不出来，单独由主进程事件补 */
  durationMs?: number
}

/* ==================== 主进程事件 → UI 消息流片段 ==================== */

/**
 * 正文与思考会**交替**出现，而 SDK 要求 `text-delta` 之前必须先 `text-start`
 * （否则内部按 id 取活动部件会取到 undefined 直接抛错）。所以这里维护
 * 「当前打开的是哪个部件」，切换种类前先收尾。
 */
export interface ChunkState {
  textId: string | null
  reasoningId: string | null
}

export function createChunkState(): ChunkState {
  return { textId: null, reasoningId: null }
}

function closeParts(state: ChunkState): UIMessageChunk[] {
  const out: UIMessageChunk[] = []
  if (state.reasoningId) {
    out.push({ type: 'reasoning-end', id: state.reasoningId })
    state.reasoningId = null
  }
  if (state.textId) {
    out.push({ type: 'text-end', id: state.textId })
    state.textId = null
  }
  return out
}

/** 工具的原始参数是**文本**，可能不是合法 JSON —— 能解析就解析，不能就把原文交给界面显示 */
export function parseToolArgs(raw: string): unknown {
  const t = (raw ?? '').trim()
  if (!t) return {}
  try {
    return JSON.parse(t)
  } catch {
    return raw
  }
}

/**
 * 把一个主进程事件翻译成零个或多个消息流片段。
 *
 * `nextId` 用来给新部件取 id，默认用 uuid；测试里传固定序列可得到稳定断言。
 */
export function chunksForEvent(
  state: ChunkState,
  evt: ChatEvent,
  nextId: () => string = uuidV4,
): UIMessageChunk[] {
  switch (evt.type) {
    case 'start':
      return [{ type: 'start', messageId: evt.requestId }]

    case 'delta': {
      const out: UIMessageChunk[] = []
      if (evt.kind === 'content') {
        if (state.reasoningId) {
          out.push({ type: 'reasoning-end', id: state.reasoningId })
          state.reasoningId = null
        }
        if (!state.textId) {
          state.textId = nextId()
          out.push({ type: 'text-start', id: state.textId })
        }
        out.push({ type: 'text-delta', id: state.textId, delta: evt.text })
      } else {
        if (state.textId) {
          out.push({ type: 'text-end', id: state.textId })
          state.textId = null
        }
        if (!state.reasoningId) {
          state.reasoningId = nextId()
          out.push({ type: 'reasoning-start', id: state.reasoningId })
        }
        out.push({ type: 'reasoning-delta', id: state.reasoningId, delta: evt.text })
      }
      return out
    }

    case 'toolCall': {
      // 工具调用会打断正文：先收尾再插入工具部件，顺序本身就是信息
      const out = closeParts(state)
      out.push({
        type: 'tool-input-available',
        toolCallId: evt.call.id,
        toolName: evt.call.name,
        input: parseToolArgs(evt.call.args),
        dynamic: true,
      })
      return out
    }

    case 'toolResult': {
      const r = evt.result
      const errorText = toolResultError(r)
      return [
        errorText === null
          ? { type: 'tool-output-available', toolCallId: r.id, output: r.text, dynamic: true }
          : { type: 'tool-output-error', toolCallId: r.id, errorText, dynamic: true },
      ]
    }

    case 'done': {
      const out = closeParts(state)
      out.push({
        type: 'message-metadata',
        messageMetadata: { meta: evt.meta, ...(evt.rounds !== undefined ? { rounds: evt.rounds } : {}) },
      })
      out.push({ type: 'finish', finishReason: 'stop' })
      return out
    }

    /**
     * 取消**不发** error 片段：SDK 对 error 片段的处理是抛错 → 状态变 error，
     * 而取消不是故障（`abortSignal` 那条路径已经会把状态收回 ready）。
     * 发出去只会让「已停止」显示成「失败」，正文还会丢掉。
     */
    case 'error':
      if (evt.code === 'ABORTED') {
        return [...closeParts(state), { type: 'abort' }]
      }
      return [{ type: 'error', errorText: evt.message }]

    // toolsReady / round / notice 属于界面瞬时状态，不进消息（否则会被写进会话文件）
    default:
      return []
  }
}

/** 工具结果是否算失败；成功返回 null，失败返回给界面看的文本 */
export function toolResultError(r: ChatToolResult): string | null {
  if (r.error) return r.error
  if (!r.ok) return r.text || 'FAILED'
  if (r.isError) return r.text || 'TOOL_ERROR'
  return null
}

/* ==================== 消息读取 ==================== */

export function messageText(msg: ChatUIMessage): string {
  return msg.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('')
}

function rawReasoning(msg: ChatUIMessage): string {
  return msg.parts.filter((p) => p.type === 'reasoning').map((p) => (p as { text: string }).text).join('')
}

/** 思考内容（供折叠块显示） */
export function messageReasoning(msg: ChatUIMessage): string {
  return rawReasoning(msg)
}

/** 思考是否还在流式输出（决定折叠块的默认展开状态） */
export function reasoningStreaming(msg: ChatUIMessage): boolean {
  return msg.parts.some((p) => p.type === 'reasoning' && (p as { state?: string }).state === 'streaming')
}

export function messageToolParts(msg: ChatUIMessage): ToolPartView[] {
  const out: ToolPartView[] = []
  for (const p of msg.parts) {
    const part = p as Record<string, unknown>
    if (p.type === 'dynamic-tool') {
      out.push({
        toolCallId: String(part.toolCallId ?? ''),
        toolName: String(part.toolName ?? ''),
        state: (part.state as ToolPartView['state']) ?? 'input-available',
        input: part.input,
        output: part.output,
        errorText: typeof part.errorText === 'string' ? part.errorText : undefined,
      })
    } else if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
      out.push({
        toolCallId: String(part.toolCallId ?? ''),
        toolName: p.type.slice('tool-'.length),
        state: (part.state as ToolPartView['state']) ?? 'input-available',
        input: part.input,
        output: part.output,
        errorText: typeof part.errorText === 'string' ? part.errorText : undefined,
      })
    }
  }
  return out
}

export function messageMeta(msg: ChatUIMessage): ChatTurnMeta {
  return (msg.metadata ?? {}) as ChatTurnMeta
}

/**
 * 把界面消息压成发给模型的对话历史。
 *
 * **只带正文**：思考内容与工具调用不回收 —— 工具闭环由主进程的 agent 循环管理，
 * 它自己会把 assistant(tool_calls) 与 role=tool 补齐；这里再塞一遍就会重复。
 */
export function uiMessagesToHistory(msgs: ChatUIMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const text = messageText(m)
    if (!text) continue
    out.push({ role: m.role, content: text })
  }
  return out
}

/* ==================== 旧格式迁移 ==================== */

interface LegacyBlock {
  kind?: string
  text?: string
  call?: { id?: string; name?: string; args?: string }
  result?: { text?: string; ok?: boolean; isError?: boolean; error?: string; durationMs?: number } | null
}

interface LegacyTurn {
  id?: string
  role?: string
  blocks?: LegacyBlock[]
  status?: string
  meta?: ChatMeta
  error?: string
  rounds?: number
}

/**
 * 旧版会话文件（turn = { blocks: [...] }）→ UI 消息。
 *
 * 存储层把 `turns` 当黑盒，所以这里必须容错：文件是用户可见、可手工编辑的，
 * 形状不对就跳过这一条，绝不因为一条坏数据让整个会话打不开。
 */
export function legacyTurnsToUIMessages(turns: unknown[]): ChatUIMessage[] {
  const out: ChatUIMessage[] = []
  for (const raw of turns) {
    if (typeof raw !== 'object' || raw === null) continue
    const t = raw as LegacyTurn
    if (t.role !== 'user' && t.role !== 'assistant') continue
    if (!Array.isArray(t.blocks)) continue
    const id = typeof t.id === 'string' && t.id ? t.id : uuidV4()

    if (t.role === 'user') {
      const text = t.blocks.filter((b) => b.kind === 'text').map((b) => b.text ?? '').join('')
      out.push({ id, role: 'user', parts: [{ type: 'text', text }] })
      continue
    }

    const parts: ChatUIMessage['parts'] = []
    for (const b of t.blocks) {
      if (b.kind === 'text') {
        parts.push({ type: 'text', text: b.text ?? '', state: 'done' })
      } else if (b.kind === 'reasoning') {
        parts.push({ type: 'reasoning', id: `r-${parts.length}`, text: b.text ?? '', state: 'done' })
      } else if (b.kind === 'tool' && b.call) {
        const errorText = b.result ? toolResultError({
          id: b.call.id ?? '',
          name: b.call.name ?? '',
          ok: b.result.ok ?? true,
          isError: b.result.isError ?? false,
          text: b.result.text ?? '',
          durationMs: b.result.durationMs ?? 0,
          error: b.result.error,
        }) : null
        const base = {
          type: 'dynamic-tool' as const,
          toolCallId: b.call.id ?? `t-${parts.length}`,
          toolName: b.call.name ?? '',
          input: parseToolArgs(b.call.args ?? ''),
        }
        if (!b.result) parts.push({ ...base, state: 'input-available' })
        else if (errorText === null) parts.push({ ...base, state: 'output-available', output: b.result.text ?? '' })
        else parts.push({ ...base, state: 'output-error', errorText })
      }
    }

    const metadata: ChatTurnMeta = {}
    if (t.meta) metadata.meta = t.meta
    if (t.rounds !== undefined) metadata.rounds = t.rounds
    if (t.status === 'stopped') metadata.aborted = true
    if (t.error) metadata.error = t.error
    out.push({ id, role: 'assistant', parts, ...(Object.keys(metadata).length ? { metadata } : {}) })
  }
  return out
}

/** 会话文件里存的 turns 是新格式（parts）还是旧格式（blocks）？一条一条判，允许混排 */
export function normalizeStoredTurns(turns: unknown[]): ChatUIMessage[] {
  if (!Array.isArray(turns) || turns.length === 0) return []
  const isNew = turns.every((t) => {
    if (typeof t !== 'object' || t === null) return false
    const m = t as { parts?: unknown; blocks?: unknown }
    return Array.isArray(m.parts) && m.blocks === undefined
  })
  if (isNew) return turns as ChatUIMessage[]
  return legacyTurnsToUIMessages(turns)
}

/** 界面消息是否为空轮（一个字都没出、也没调工具）—— 用来决定要不要显示「本轮无输出」 */
export function isEmptyAssistant(msg: ChatUIMessage): boolean {
  return messageText(msg) === '' && messageToolParts(msg).length === 0 && rawReasoning(msg) === ''
}
