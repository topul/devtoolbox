/**
 * 工具调用循环（agent）。
 *
 * 让模型自己决定调用哪些本机能力：把 MCP 服务端的工具清单转成 OpenAI 函数定义发给模型，
 * 模型返回 tool_calls 就执行、把结果作为 role=tool 的消息喂回去，直到它不再调工具为止。
 *
 * 分工：
 *   - `chat.ts` 只负责「一次流式请求」（含 tool_calls 分片解析）
 *   - `mcpclient.ts` 只负责 MCP 协议
 *   - 本文件负责把两者串成循环，并把过程作为 ChatEvent 抛给界面
 *
 * 不 import electron：宿主注入 `emit`，`npm run smoke:chatagent` 可以用
 * 假模型服务端 + **本仓库真实的 MCP 服务端**跑完整闭环。
 */
import { chatStream, type ChatStreamConfig, type OpenAiToolDef } from './chat'
import { McpClient } from './mcpclient'
import type {
  ChatEvent,
  ChatMessage,
  ChatMeta,
  ChatSendSpec,
  ChatToolCall,
  ChatToolResult,
  ChatToolServer,
  ChatToolsSpec,
} from '../../src/lib/chat-types'

/** 发给模型的对话消息（比界面用的 ChatMessage 多 tool/tool_calls 两种形态） */
type WireMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatAgentSpec extends Omit<ChatSendSpec, 'tools'> {
  requestId: string
  tools: ChatToolsSpec
}

export interface ChatAgentHost {
  emit: (evt: ChatEvent) => void
}

/** 单次工具结果喂回模型时的长度上限：http_request 之类的输出可能很大，别把上下文撑爆 */
const TOOL_RESULT_MAX = 20_000

export function runChatAgent(spec: ChatAgentSpec, host: ChatAgentHost): { abort: () => void } {
  const requestId = spec.requestId
  const maxRounds = Math.max(1, Math.min(spec.tools.maxRounds ?? 8, 20))

  let aborted = false
  let streamHandle: { abort: () => void } | null = null
  const clients: McpClient[] = []
  /** wireName → 客户端与原始名。模型看到的名字一旦给出就不能变，重名在这里消化。 */
  const registry = new Map<string, { client: McpClient; original: string }>()

  const { tools: toolsSpec, requestId: _rid, messages: _msgs, ...streamBase } = spec
  const baseConfig = streamBase as ChatStreamConfig

  const abort = (): void => {
    aborted = true
    streamHandle?.abort()
  }

  const emit = (evt: ChatEvent): void => host.emit(evt)

  /**
   * 取消要显式收场。
   * 只把 aborted 置真然后 return 是不够的 —— 界面收不到任何终止事件，会永远停在「接收中」。
   * 每个可能被取消打断的等待点后面都要走一次这个分支。
   */
  const finishAborted = (): void => {
    emit({ type: 'error', requestId, message: '已取消', code: 'ABORTED' })
  }

  /** 跑一轮流式请求；deltas 直接转发给界面 */
  const runRound = (messages: WireMessage[], toolDefs: OpenAiToolDef[]): Promise<{ meta: ChatMeta; content: string }> =>
    new Promise((resolve, reject) => {
      let content = ''
      streamHandle = chatStream(
        { ...baseConfig, messages: messages as unknown as ChatMessage[], toolDefs: toolDefs.length ? toolDefs : undefined },
        {
          onDelta: (text, kind) => {
            if (kind === 'content') content += text
            emit({ type: 'delta', requestId, text, kind, atMs: Date.now() })
          },
          onDone: (meta) => {
            streamHandle = null
            resolve({ meta, content })
          },
          onError: (message, code) => {
            streamHandle = null
            reject(Object.assign(new Error(message), { code }))
          },
        },
      )
    })

  const executeTool = async (call: ChatToolCall): Promise<ChatToolResult> => {
    let args: Record<string, unknown>
    try {
      const parsed = call.args.trim() ? JSON.parse(call.args) : {}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数必须是 JSON 对象')
      args = parsed as Record<string, unknown>
    } catch (e) {
      // 模型给的参数不是合法 JSON —— 把错误原样喂回去让它自己改，这是标准做法
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
      /* 1. 连接全部工具源并合并清单 */
      const servers: ChatToolServer[] = [...(toolsSpec.servers ?? [])]
      if (toolsSpec.server?.command) {
        // 兼容旧字段：并进 servers，位置在最后（拿不到干净名字也无妨，它是过渡形态）
        servers.push({
          label: toolsSpec.server.label,
          command: toolsSpec.server.command,
          args: toolsSpec.server.args ?? [],
          env: toolsSpec.server.env,
          cwd: toolsSpec.server.cwd,
        })
      }
      if (!servers.length) throw new Error('未配置任何工具源')

      const failed: string[] = []
      const toolDefs: OpenAiToolDef[] = []
      const usable: { name: string; description: string }[] = []
      const allow = new Set(toolsSpec.allow ?? [])

      for (const [i, src] of servers.entries()) {
        // 连接可能耗时，每个源连之前都检查一次取消
        if (aborted) {
          finishAborted()
          return
        }
        const label = src.label?.trim() || `server-${i + 1}`
        const client = new McpClient(
          src.url?.trim()
            ? {
                id: `agent-${requestId}-${i}`,
                transport: 'http' as const,
                url: src.url.trim(),
                ...(src.headers ? { headers: src.headers } : {}),
                timeoutMs: 30_000,
              }
            : {
                id: `agent-${requestId}-${i}`,
                transport: 'stdio' as const,
                command: src.command ?? '',
                args: src.args ?? [],
                ...(src.env ? { env: src.env } : {}),
                ...(src.cwd ? { cwd: src.cwd } : {}),
                timeoutMs: 30_000,
              },
          // agent 内部的 MCP 事件不转发给界面：它们属于 Inspector 那条时间轴，混进对话会很难看
          { emit: () => { /* 静默 */ } },
        )
        try {
          await client.connect()
          const catalog = await client.loadCatalog()
          clients.push(client)
          for (const tool of catalog.tools) {
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
          // 一个工具源挂了不该拖垮整场对话 —— 报告出来，其余照常
          failed.push(`${label}: ${(e as Error).message}`)
        }
      }

      if (!registry.size) {
        throw new Error(failed.length ? `工具源全部连接失败 —— ${failed.join('；')}` : '工具源没有声明任何工具')
      }
      if (failed.length) emit({ type: 'notice', requestId, text: `部分工具源没有连上：${failed.join('；')}` })
      emit({ type: 'toolsReady', requestId, tools: usable })

      /* 2. 循环 */
      const messages: WireMessage[] = spec.messages.map((m) => ({ role: m.role, content: m.content })) as WireMessage[]
      let rounds = 0
      let lastMeta: ChatMeta | null = null

      while (rounds < maxRounds) {
        // 取消可能落在两轮之间（上一轮的流已经结束、这一轮还没开始），这里必须拦住
        if (aborted) {
          finishAborted()
          return
        }
        rounds++
        emit({ type: 'round', requestId, round: rounds, maxRounds })
        const { meta, content } = await runRound(messages, toolDefs)
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

        // 助手消息必须连同 tool_calls 一起回填，否则下一轮服务端会抱怨「tool 消息没有对应的调用」
        messages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: c.args },
          })),
        })

        for (const call of calls) {
          // 工具执行也可能耗时，执行前再确认一次
          if (aborted) {
            finishAborted()
            return
          }
          emit({ type: 'toolCall', requestId, round: rounds, call })
          const result = await executeTool(call)
          emit({ type: 'toolResult', requestId, round: rounds, result })
          const body = result.error ? `调用失败：${result.error}` : result.text
          const clipped = body.length > TOOL_RESULT_MAX
            ? `${body.slice(0, TOOL_RESULT_MAX)}\n…（结果过长已截断，原始长度 ${body.length} 字符）`
            : body
          messages.push({ role: 'tool', tool_call_id: call.id, content: clipped })
        }
      }

      // 轮数用尽：不是错误，但要让界面说得清楚为什么停了
      if (lastMeta) emit({ type: 'done', requestId, meta: { ...lastMeta, finishReason: 'max_rounds' }, rounds })
    } catch (e) {
      const code = (e as Error & { code?: string }).code
      // 取消要当成正常收场（界面据此显示「已停止」），不能走失败分支
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
        } catch { /* 断开失败不影响收场 */ }
      }
    }
  })()

  return { abort }
}
