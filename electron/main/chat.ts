/**
 * OpenAI 兼容接口的流式对话客户端（主进程）。
 *
 * 为什么放主进程：渲染层的 fetch 拿不到原始响应头、不能走代理、不能关 TLS 校验，
 * 也拿不到逐帧到达时间（TTFT / tokens/s 这些指标就没法算准）。
 * 这里复用 `http.ts` 的 `streamHop`，因此**代理 / SOCKS5 / TLS 开关 / 重定向**能力与
 * HTTP 请求调试工具完全一致 —— 同一套连接逻辑，不会两处行为不一样。
 *
 * 不 import electron：错误经回调注入，可被 `npm run smoke:chat` 用本地假服务端直接验证。
 */
import { Buffer } from 'node:buffer'
import { isCertError, streamHop, type HopStreamHooks } from './http'
import type {
  ChatDeltaKind,
  ChatMessage,
  ChatMeta,
  ChatRole,
  ChatSendSpec as ChatConfig,
  ChatToolCall,
  ChatUsage,
} from '../../src/lib/chat-types'

export type { ChatDeltaKind, ChatMessage, ChatMeta, ChatRole, ChatUsage, ChatToolCall }

/** OpenAI 形态的函数定义（agent 从 MCP 目录转换而来） */
export interface OpenAiToolDef {
  type: 'function'
  function: { name: string; description?: string; parameters?: unknown }
}

/**
 * 单次流式请求的配置。
 * 注意 `toolDefs` 与 `ChatSendSpec.tools` 不是一回事：前者是**发给模型的工具清单**，
 * 后者是「启用工具调用、用哪个 MCP 服务端」，由 agent 消费。分开命名免得看混。
 */
export interface ChatStreamConfig extends Omit<ChatConfig, 'tools'> {
  toolDefs?: OpenAiToolDef[]
}

export interface ChatHooks {
  onDelta: (text: string, kind: ChatDeltaKind) => void
  onDone: (meta: ChatMeta) => void
  onError: (message: string, code?: string) => void
}

const DEFAULT_TIMEOUT_MS = 120_000

function completionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('缺少接口地址')
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

/** 把服务端的错误响应翻译成能直接看懂的一句话 */
function describeFailure(status: number, bodyText: string): string {
  const snippet = bodyText.trim().slice(0, 500)
  let detail = snippet
  try {
    const j = JSON.parse(snippet) as { error?: { message?: string } | string; message?: string }
    const e = j.error
    detail = (typeof e === 'string' ? e : e?.message) ?? j.message ?? snippet
  } catch {
    /* 非 JSON 就原样给出 */
  }
  if (status === 401) return `鉴权失败（401）：${detail || 'API Key 无效或未设置'}`
  if (status === 403) return `无权限（403）：${detail}`
  if (status === 404) return `接口不存在（404）：检查接口地址是否包含正确的版本前缀，如 /v1`
  if (status === 429) return `限流或余额不足（429）：${detail}`
  return `请求失败（${status}）：${detail}`
}

/**
 * 发起一次流式对话。返回句柄用于中途取消。
 *
 * 错误契约（重要，调用方据此分工）：
 *   - **同步**参数错误（地址为空/不合法、代理地址不合法）→ 直接 `throw`；
 *   - **运行期**错误（连接失败、鉴权、超时、取消）→ 经 `hooks.onError` 回报。
 * 混在一起会让调用方分不清「还没开始」和「开始了又失败」，进而把已失败的请求记成进行中。
 */
export function chatStream(cfg: ChatStreamConfig, hooks: ChatHooks): { abort: () => void } {
  const started = Date.now()
  let firstTokenMs = 0
  let ttfbMs = 0
  let chunks = 0
  let chars = 0
  let reasoningChars = 0
  let usage: ChatUsage | null = null
  let finishReason: string | null = null
  let servedModel: string | null = null
  let settled = false
  let handle: { abort: () => void } | null = null
  let sseBuffer = ''
  /** 工具调用按 index 分片到达：id 只来一次（赋值），name/arguments 是分片拼接 */
  const toolAcc = new Map<number, ChatToolCall>()

  const meta = (): ChatMeta => ({
    ttfbMs,
    firstTokenMs,
    totalMs: Date.now() - started,
    chunks,
    chars,
    reasoningChars,
    usage,
    finishReason,
    model: servedModel,
    toolCalls: [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
  })

  const fail = (message: string, code?: string): void => {
    if (settled) return
    settled = true
    hooks.onError(message, code)
  }

  const finish = (): void => {
    if (settled) return
    settled = true
    hooks.onDone(meta())
  }

  const emit = (text: string, kind: ChatDeltaKind): void => {
    if (!text) return
    if (!firstTokenMs) firstTokenMs = Date.now() - started
    chunks++
    if (kind === 'content') chars += text.length
    else reasoningChars += text.length
    hooks.onDelta(text, kind)
  }

  /** 解析一行 SSE；返回 true 表示收到结束标记 */
  const handleLine = (line: string): boolean => {
    const t = line.trim()
    if (!t || t.startsWith(':')) return false
    if (!t.startsWith('data:')) return false
    const payload = t.slice(5).trim()
    if (!payload) return false
    if (payload === '[DONE]') return true

    let json: any
    try {
      json = JSON.parse(payload)
    } catch {
      return false // 半截或非标准帧，忽略即可
    }
    if (json.model) servedModel = String(json.model)
    if (json.usage) {
      // 带 usage 的帧通常没有任何 delta，只记账
      usage = {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
        totalTokens: json.usage.total_tokens ?? 0,
      }
    }
    const choice = json.choices?.[0]
    if (!choice) return false
    if (choice.finish_reason) finishReason = String(choice.finish_reason)
    const delta = choice.delta ?? choice.message
    if (delta) {
      // DeepSeek 等推理模型把思考过程放在 reasoning_content 里
      if (typeof delta.reasoning_content === 'string') emit(delta.reasoning_content, 'reasoning')
      if (typeof delta.content === 'string') emit(delta.content, 'content')
      // 工具调用：分片到达，按 index 累积（id 只在首片出现，name/arguments 要拼）
      if (Array.isArray(delta.tool_calls)) {
        for (const part of delta.tool_calls as Record<string, any>[]) {
          const idx = typeof part?.index === 'number' ? part.index : 0
          const slot = toolAcc.get(idx) ?? { id: '', name: '', args: '' }
          if (typeof part?.id === 'string' && part.id) slot.id = part.id
          if (typeof part?.function?.name === 'string' && part.function.name) slot.name += part.function.name
          if (typeof part?.function?.arguments === 'string') slot.args += part.function.arguments
          toolAcc.set(idx, slot)
        }
      }
    }
    return false
  }

  const streamHooks: HopStreamHooks = {
    onHeaders: (res, t) => {
      ttfbMs = t
      const status = res.statusCode ?? 0
      const contentType = String(res.headers['content-type'] ?? '')

      // 出错时服务端通常回一小段 JSON，这里自己收完再统一翻译
      if (status < 200 || status >= 300) {
        const parts: Buffer[] = []
        res.on('data', (c: Buffer) => parts.push(c))
        res.on('end', () => fail(describeFailure(status, Buffer.concat(parts).toString('utf8'))))
        res.on('error', (e) => fail((e as Error).message))
        return
      }

      // 有些网关/代理不支持流式，会直接吐一个完整 JSON —— 按一次性响应处理
      if (!contentType.includes('text/event-stream')) {
        const parts: Buffer[] = []
        res.on('data', (c: Buffer) => parts.push(c))
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8')
          try {
            const json = JSON.parse(text) as any
            if (json.model) servedModel = String(json.model)
            if (json.usage) {
              usage = {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
              }
            }
            const choice = json.choices?.[0]
            if (!choice) {
              fail('响应里没有 choices，返回内容：' + text.slice(0, 300))
              return
            }
            if (typeof choice.message?.reasoning_content === 'string') emit(choice.message.reasoning_content, 'reasoning')
            // 非流式时工具调用是完整给出的
            if (Array.isArray(choice.message?.tool_calls)) {
              (choice.message.tool_calls as Record<string, any>[]).forEach((tc, i) => {
                toolAcc.set(i, { id: String(tc?.id ?? ''), name: String(tc?.function?.name ?? ''), args: String(tc?.function?.arguments ?? '') })
              })
            }
            const content = choice.message?.content ?? choice.text ?? ''
            if (content) emit(String(content), 'content')
            if (choice.finish_reason) finishReason = String(choice.finish_reason)
            finish()
          } catch {
            fail('响应不是合法的 JSON：' + text.slice(0, 300))
          }
        })
        res.on('error', (e) => fail((e as Error).message))
        return
      }

      let done = false
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        if (done) return
        sseBuffer += chunk
        let idx: number
        while ((idx = sseBuffer.indexOf('\n')) >= 0) {
          const line = sseBuffer.slice(0, idx)
          sseBuffer = sseBuffer.slice(idx + 1)
          if (handleLine(line)) {
            done = true
            finish()
            return
          }
        }
      })
      res.on('end', () => {
        if (done) return
        // 收尾：可能最后一行没有换行符
        if (sseBuffer && handleLine(sseBuffer)) {
          finish()
          return
        }
        finish()
      })
      res.on('error', (e) => fail((e as Error).message))
    },
    onError: (err) => {
      const aborted = err.code === 'ABORTED' || err.message === 'ABORTED'
      if (aborted) {
        fail('已取消', 'ABORTED')
        return
      }
      const message = isCertError(err.code, err.message)
        ? 'TLS 证书校验失败：内网自签证书请关掉「校验 TLS 证书」'
        : err.message
      fail(message, err.code)
    },
  }

  let url: URL
  try {
    url = new URL(completionsUrl(cfg.baseUrl))
  } catch {
    throw new Error(`接口地址不合法：${cfg.baseUrl.trim() || '(空)'}`)
  }
  let proxyUrl: URL | null = null
  if (cfg.proxy) {
    try {
      proxyUrl = new URL(cfg.proxy)
    } catch {
      throw new Error(`代理地址不合法：${cfg.proxy}`)
    }
  }

  const headers: [string, string][] = [
    ['Content-Type', 'application/json'],
    ['Accept', 'text/event-stream'],
    // 关键：流式不解压，明确要求服务端别压缩，否则 SSE 会变成二进制乱码
    ['Accept-Encoding', 'identity'],
    ['User-Agent', 'devtoolbox-chat/1'],
  ]
  if (cfg.apiKey) headers.push(['Authorization', `Bearer ${cfg.apiKey}`])
  for (const [k, v] of cfg.extraHeaders ?? []) if (k) headers.push([k, v])

  const body = JSON.stringify({
    model: cfg.model,
    messages: cfg.messages,
    stream: true,
    // 让服务端在最后补一个带 usage 的帧，这样 token 与费用是准确的而不是估算
    ...(cfg.includeUsage === false ? {} : { stream_options: { include_usage: true } }),
    // 工具调用：把工具清单发给模型，由它决定是否调用
    ...(cfg.toolDefs && cfg.toolDefs.length ? { tools: cfg.toolDefs, tool_choice: 'auto' } : {}),
    ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
    ...(cfg.maxTokens === undefined ? {} : { max_tokens: cfg.maxTokens }),
    ...(cfg.topP === undefined ? {} : { top_p: cfg.topP }),
  })

  handle = streamHop(
    {
      url,
      method: 'POST',
      headers: Object.fromEntries(headers),
      body: Buffer.from(body, 'utf8'),
      timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      rejectUnauthorized: cfg.rejectUnauthorized ?? true,
      proxy: proxyUrl,
      passthrough: false,
      isHttps: url.protocol === 'https:',
    },
    streamHooks,
  )
  return { abort: () => handle?.abort() }
}
