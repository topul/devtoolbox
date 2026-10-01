/**
 * 浏览器版对话引擎 —— ChatAPI 契约（send / abort / trace / probeServer / onEvent）的实现。
 *
 * agent 循环逐字对齐 electron/main/chat-agent.ts：轮数上限、工具名撞名加后缀、
 * 非法 JSON 原样喂回自纠、20k 结果截断、三处显式 ABORTED 收场。
 * 唯一能力差异：stdio 工具源需要本机进程，浏览器里跳过并给 notice（HTTP 源照常可用）。
 */
import type {
  ChatEvent,
  ChatMeta,
  ChatMessage,
  ChatSendResult,
  ChatSendSpec,
  ChatToolCall,
  ChatToolResult,
  ChatToolServer,
  ChatTrace,
  ChatTraceResult,
  ChatToolsSpec,
  McpProbeResult,
} from '../chat-types'
import { chatStream, type ChatStreamConfig, type OpenAiToolDef } from './web-chat-stream'
import { WebMcpHttpClient } from './web-mcp'
import { uuidV4 } from '../toolkit'

/** 单次工具结果喂回模型时的长度上限（与桌面版一致） */
const TOOL_RESULT_MAX = 20_000
const TRACE_BODY_MAX = 20_000
const TRACE_FRAMES_MAX = 300

interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

/** 链路记录器（纯内存态，浏览器版与桌面版同构） */
export class TraceRecorder {
  readonly trace: ChatTrace
  private rounds = new Map<number, ChatTrace['rounds'][number]>()

  constructor(requestId: string) {
    this.trace = { requestId, startedAt: Date.now(), url: '', headers: [], rounds: [] }
  }

  private round(n: number): ChatTrace['rounds'][number] {
    let r = this.rounds.get(n)
    if (!r) {
      r = { round: n, requestBody: '', truncated: false, frames: [], framesTruncated: false, meta: null, tools: [] }
      this.rounds.set(n, r)
      this.trace.rounds.push(r)
    }
    return r
  }

  request(round: number, info: { url: string; headers: [string, string][]; body: string }): void {
    this.trace.url = info.url
    this.trace.headers = info.headers
    const r = this.round(round)
    if (info.body.length > TRACE_BODY_MAX) {
      r.requestBody = info.body.slice(0, TRACE_BODY_MAX)
      r.truncated = true
    } else {
      r.requestBody = info.body
    }
  }

  frame(round: number, line: string): void {
    const r = this.round(round)
    if (r.frames.length >= TRACE_FRAMES_MAX) {
      r.framesTruncated = true
      return
    }
    r.frames.push(line)
  }

  meta(round: number, meta: ChatMeta): void {
    this.round(round).meta = meta
  }

  toolCall(round: number, call: ChatToolCall): void {
    this.round(round).tools.push({ call, result: null })
  }

  toolResult(round: number, callId: string, result: ChatToolResult): void {
    const r = this.round(round)
    const hit = r.tools.find((t) => t.call.id === callId && !t.result)
    if (hit) hit.result = result
  }
}

interface Engine {
  abort: (requestId?: string) => void
}

export function buildWebChat(): ElectronChat {
  const listeners = new Set<(evt: ChatEvent) => void>()
  const engines = new Map<string, Engine>()
  const traces = new Map<string, TraceRecorder>()

  const emit = (evt: ChatEvent): void => {
    for (const l of listeners) {
      try {
        l(evt)
      } catch {
        /* 监听者异常不拖垮引擎 */
      }
    }
  }

  const runAgent = (spec: ChatSendSpec): void => {
    const requestId = spec.requestId || uuidV4()
    const trace = new TraceRecorder(requestId)
    traces.set(requestId, trace)

    let aborted = false
    let streamHandle: { abort: () => void } | null = null
    const clients: WebMcpHttpClient[] = []
    const registry = new Map<string, { client: WebMcpHttpClient; original: string }>()

    const finishAborted = (): void => {
      emit({ type: 'error', requestId, message: '已取消', code: 'ABORTED' })
    }

    const runRound = (round: number, messages: WireMessage[], toolDefs: OpenAiToolDef[]): Promise<{ meta: ChatMeta; content: string }> =>
      new Promise((resolve, reject) => {
        let content = ''
        const cfg: ChatStreamConfig = {
          baseUrl: spec.baseUrl,
          apiKey: spec.apiKey,
          model: spec.model,
          temperature: spec.temperature,
          maxTokens: spec.maxTokens,
          topP: spec.topP,
          extraHeaders: spec.extraHeaders,
          timeoutMs: spec.timeoutMs,
          includeUsage: spec.includeUsage,
          messages: messages as unknown as ChatMessage[],
          ...(toolDefs.length ? { toolDefs } : {}),
        }
        streamHandle = chatStream(cfg, {
          onDelta: (text, kind) => {
            if (kind === 'content') content += text
            emit({ type: 'delta', requestId, text, kind, atMs: Date.now() })
          },
          onDone: (m) => {
            streamHandle = null
            trace.meta(round, m)
            resolve({ meta: m, content })
          },
          onError: (message, code) => {
            streamHandle = null
            reject(Object.assign(new Error(message), { code }))
          },
          onRequest: (info) => trace.request(round, info),
          onFrame: (line) => trace.frame(round, line),
        })
      })

    const executeTool = async (call: ChatToolCall): Promise<ChatToolResult> => {
      let args: Record<string, unknown>
      try {
        const parsed = call.args.trim() ? JSON.parse(call.args) : {}
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数必须是 JSON 对象')
        args = parsed as Record<string, unknown>
      } catch (e) {
        return {
          id: call.id,
          name: call.name,
          ok: false,
          isError: true,
          text: `参数解析失败：${(e as Error).message}\n收到的原始参数：${call.args || '(空)'}`,
          durationMs: 0,
        }
      }
      const hit = registry.get(call.name)
      if (!hit) {
        return { id: call.id, name: call.name, ok: false, isError: true, text: '未知工具，或对应的工具源没有连上', durationMs: 0 }
      }
      const out = await hit.client.callTool(hit.original, args)
      return {
        id: call.id,
        name: call.name,
        ok: out.ok,
        isError: out.isError,
        text: out.text,
        durationMs: out.durationMs,
        error: out.error,
      }
    }

    void (async () => {
      emit({ type: 'start', requestId })
      try {
        const toolsSpec: ChatToolsSpec | null | undefined = spec.tools
        const servers: ChatToolServer[] = toolsSpec ? [...(toolsSpec.servers ?? [])] : []
        if (toolsSpec?.server?.command) {
          servers.push({ label: toolsSpec.server.label, command: toolsSpec.server.command, args: toolsSpec.server.args ?? [], env: toolsSpec.server.env, cwd: toolsSpec.server.cwd })
        }

        /* ---- 无工具：单轮流式（与桌面版纯对话路径一致） ---- */
        if (!servers.length) {
          const { meta } = await runRound(1, spec.messages.map((m) => ({ role: m.role, content: m.content })), [])
          if (aborted) {
            finishAborted()
            return
          }
          emit({ type: 'done', requestId, meta, rounds: 1 })
          return
        }

        /* ---- 有工具：agent 循环 ---- */
        const maxRounds = Math.max(1, Math.min(toolsSpec?.maxRounds ?? 8, 20))
        const failed: string[] = []
        const skipped: string[] = []
        const toolDefs: OpenAiToolDef[] = []
        const usable: { name: string; description: string }[] = []
        const allow = new Set(toolsSpec?.allow ?? [])

        for (const [i, src] of servers.entries()) {
          if (aborted) {
            finishAborted()
            return
          }
          const label = src.label?.trim() || `server-${i + 1}`
          if (!src.url?.trim()) {
            // stdio 源：浏览器没有进程模型，跳过而不是装死
            skipped.push(label)
            continue
          }
          const client = new WebMcpHttpClient(src, 30_000)
          try {
            await client.connect()
            const catalog = await client.listTools()
            clients.push(client)
            for (const tool of catalog) {
              let wire = tool.name
              let n = 2
              while (registry.has(wire)) wire = `${tool.name}_${n++}`
              registry.set(wire, { client, original: tool.name })
              if (allow.size && !allow.has(tool.name)) continue
              toolDefs.push({
                type: 'function',
                function: {
                  name: wire,
                  description: tool.description ?? '',
                  parameters: tool.inputSchema ?? { type: 'object', properties: {} },
                },
              })
              usable.push({ name: wire, description: tool.description ?? '' })
            }
          } catch (e) {
            failed.push(`${label}: ${(e as Error).message}`)
          }
        }

        const notes: string[] = []
        if (skipped.length) notes.push(`stdio 工具源需要桌面版，已跳过：${skipped.join('、')}`)
        if (notes.length) emit({ type: 'notice', requestId, text: notes.join('；') })

        if (!registry.size) {
          if (skipped.length && !failed.length) {
            // 只有 stdio 源：等于没工具，退回纯对话并说明
            const { meta } = await runRound(1, spec.messages.map((m) => ({ role: m.role, content: m.content })), [])
            emit({ type: 'done', requestId, meta, rounds: 1 })
            return
          }
          throw new Error(failed.length ? `工具源全部连接失败 —— ${failed.join('；')}` : '工具源没有声明任何工具')
        }
        if (failed.length) emit({ type: 'notice', requestId, text: `部分工具源没有连上：${failed.join('；')}` })
        emit({ type: 'toolsReady', requestId, tools: usable })

        const messages: WireMessage[] = spec.messages.map((m) => ({ role: m.role, content: m.content }))
        let rounds = 0
        let lastMeta: ChatMeta | null = null

        while (rounds < maxRounds) {
          if (aborted) {
            finishAborted()
            return
          }
          rounds++
          emit({ type: 'round', requestId, round: rounds, maxRounds })
          const { meta, content } = await runRound(rounds, messages, toolDefs)
          lastMeta = meta
          if (aborted) {
            finishAborted()
            return
          }

          const calls = meta.toolCalls ?? []
          if (!calls.length) {
            emit({ type: 'done', requestId, meta, rounds })
            return
          }

          messages.push({
            role: 'assistant',
            content: content || null,
            tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args } })),
          })

          for (const call of calls) {
            if (aborted) {
              finishAborted()
              return
            }
            emit({ type: 'toolCall', requestId, round: rounds, call })
            trace.toolCall(rounds, call)
            const result = await executeTool(call)
            emit({ type: 'toolResult', requestId, round: rounds, result })
            trace.toolResult(rounds, call.id, result)
            const body = result.error ? `调用失败：${result.error}` : result.text
            const clipped = body.length > TOOL_RESULT_MAX
              ? `${body.slice(0, TOOL_RESULT_MAX)}\n…（结果过长已截断，原始长度 ${body.length} 字符）`
              : body
            messages.push({ role: 'tool', tool_call_id: call.id, content: clipped })
          }
        }

        if (lastMeta) emit({ type: 'done', requestId, meta: { ...lastMeta, finishReason: 'max_rounds' }, rounds })
      } catch (e) {
        const code = (e as Error & { code?: string }).code
        if (aborted || code === 'ABORTED') {
          emit({ type: 'error', requestId, message: '已取消', code: 'ABORTED' })
          return
        }
        emit({ type: 'error', requestId, message: (e as Error).message, code })
      } finally {
        const cs = clients.splice(0, clients.length)
        for (const c of cs) {
          try {
            await c.disconnect()
          } catch {
            /* 断开失败不影响收场 */
          }
        }
      }
    })()

    engines.set(requestId, {
      abort: (id?: string) => {
        if (id && id !== requestId) return
        aborted = true
        streamHandle?.abort()
      },
    })
  }

  return {
    send: async (spec: ChatSendSpec): Promise<ChatSendResult> => {
      // 参数错误同步抛（与桌面契约一致）；运行期错误走 error 事件。
      // 校验方式与 web-chat-stream 的 completionsUrl 完全一致，保证「缺地址」在这里就被拦住。
      const base = spec.baseUrl.trim().replace(/\/+$/, '')
      try {
        void new URL(/\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`)
      } catch {
        throw new Error(`接口地址不合法：${base || '(空)'}`)
      }
      const requestId = spec.requestId || uuidV4()
      runAgent({ ...spec, requestId })
      return { ok: true, requestId }
    },

    abort: async (requestId?: string): Promise<boolean> => {
      const hit = requestId ? engines.get(requestId) : null
      if (requestId && !hit) return false
      if (hit) hit.abort(requestId)
      else for (const [, e] of engines) e.abort()
      return true
    },

    trace: async (requestId: string): Promise<ChatTraceResult> => {
      const t = traces.get(requestId)
      return t ? { ok: true, trace: t.trace } : { ok: false, error: 'NOT_FOUND' }
    },

    probeServer: async (src: ChatToolServer): Promise<McpProbeResult> => {
      if (!src.url?.trim()) {
        return { ok: false, error: '浏览器版不支持 stdio 工具源（需要本机进程），请使用 Streamable HTTP 服务端' }
      }
      const client = new WebMcpHttpClient(src)
      try {
        const info = await client.connect()
        const tools = await client.listTools()
        return {
          ok: true,
          serverName: info.serverName,
          serverVersion: info.serverVersion,
          tools: tools.slice(0, 50).map((t) => ({ name: t.name, description: (t.description ?? '').slice(0, 120) })),
          prompts: 0,
          resources: 0,
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },

    onEvent: (cb: (evt: ChatEvent) => void): (() => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

/** 只列 web-api 关心的形态，避免引 electron-env 产生环 */
interface ElectronChat {
  send: (spec: ChatSendSpec) => Promise<ChatSendResult>
  abort: (requestId?: string) => Promise<boolean>
  trace: (requestId: string) => Promise<ChatTraceResult>
  probeServer: (src: ChatToolServer) => Promise<McpProbeResult>
  onEvent: (callback: (evt: ChatEvent) => void) => () => void
}
