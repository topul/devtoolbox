/**
 * 浏览器版流式对话客户端 —— electron/main/chat.ts 的 fetch 移植。
 *
 * 事件与错误契约与桌面版逐字对齐（同一套 ChatMeta / tool_calls 分片拼接 /
 * usage 记账 / 非流式降级），调用方（agent 循环）感知不到宿主差异。
 *
 * 物理差异：浏览器拿不到逐字节的 TTFB 之前的 TCP/TLS 细分（无此概念），
 * 且不能关 TLS 校验、不能走上游代理 —— 这两项在 spec 里被忽略前会先被 agent 侧处理。
 */
import type { ChatDeltaKind, ChatMeta, ChatSendSpec, ChatToolCall, ChatUsage } from '../chat-types'

export interface OpenAiToolDef {
  type: 'function'
  function: { name: string; description?: string; parameters?: unknown }
}

export interface ChatStreamConfig extends Omit<ChatSendSpec, 'tools'> {
  toolDefs?: OpenAiToolDef[]
}

export interface ChatRequestInfo {
  url: string
  headers: [string, string][]
  body: string
}

export interface ChatHooks {
  onDelta: (text: string, kind: ChatDeltaKind) => void
  onDone: (meta: ChatMeta) => void
  onError: (message: string, code?: string) => void
  onRequest?: (info: ChatRequestInfo) => void
  onFrame?: (line: string) => void
}

const DEFAULT_TIMEOUT_MS = 120_000

/** 与桌面版同款脱敏：密钥类的值只留形态 */
export function redactHeaders(headers: [string, string][]): [string, string][] {
  return headers.map(([k, v]) => {
    if (!/^(authorization|api-key|x-api-key)$/i.test(k)) return [k, v]
    const i = v.indexOf(' ')
    return [k, i > 0 ? `${v.slice(0, i)} ***` : '***']
  })
}

function completionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('缺少接口地址')
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

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
  let sseBuffer = ''
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
    hooks.onFrame?.(t)
    if (!t.startsWith('data:')) return false
    const payload = t.slice(5).trim()
    if (!payload) return false
    if (payload === '[DONE]') return true

    let json: Record<string, any>
    try {
      json = JSON.parse(payload)
    } catch {
      return false
    }
    if (json.model) servedModel = String(json.model)
    if (json.usage) {
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
      if (typeof delta.reasoning_content === 'string') emit(delta.reasoning_content, 'reasoning')
      if (typeof delta.content === 'string') emit(delta.content, 'content')
      if (Array.isArray(delta.tool_calls)) {
        for (const part of delta.tool_calls as Record<string, any>[]) {
          const idx = typeof part?.index === 'number' ? part.index : 0
          const slot = toolAcc.get(idx) ?? { id: '', name: '', args: '' }
          if (typeof part?.id === 'string' && part.id) slot.id = part.id
          if (typeof part?.function?.name === 'string' && part.function.name)
            slot.name += part.function.name
          if (typeof part?.function?.arguments === 'string') slot.args += part.function.arguments
          toolAcc.set(idx, slot)
        }
      }
    }
    return false
  }

  let url: URL
  try {
    url = new URL(completionsUrl(cfg.baseUrl))
  } catch {
    throw new Error(`接口地址不合法：${cfg.baseUrl.trim() || '(空)'}`)
  }

  const headers: [string, string][] = [
    ['Content-Type', 'application/json'],
    ['Accept', 'text/event-stream'],
    ['User-Agent', 'devtoolbox-chat/1'],
  ]
  if (cfg.apiKey) headers.push(['Authorization', `Bearer ${cfg.apiKey}`])
  for (const [k, v] of cfg.extraHeaders ?? []) if (k) headers.push([k, v])

  const body = JSON.stringify({
    model: cfg.model,
    messages: cfg.messages,
    stream: true,
    ...(cfg.includeUsage === false ? {} : { stream_options: { include_usage: true } }),
    ...(cfg.toolDefs && cfg.toolDefs.length ? { tools: cfg.toolDefs, tool_choice: 'auto' } : {}),
    ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
    ...(cfg.maxTokens === undefined ? {} : { max_tokens: cfg.maxTokens }),
    ...(cfg.topP === undefined ? {} : { top_p: cfg.topP }),
  })

  hooks.onRequest?.({ url: url.toString(), headers: redactHeaders(headers), body })

  const controller = new AbortController()
  // 空闲超时：每收到一段数据就重置（与「流中途长时间无数据按超时」的语义一致）
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  }

  void (async () => {
    try {
      armIdle()
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: new Headers(headers),
        body,
        signal: controller.signal,
        credentials: 'omit',
      })
      ttfbMs = Date.now() - started

      if (!res.ok) {
        const text = await res.text()
        fail(describeFailure(res.status, text))
        return
      }

      const contentType = res.headers.get('content-type') ?? ''
      // 有些网关不支持流式，直接吐一个完整 JSON —— 按一次性响应处理
      if (!contentType.includes('text/event-stream') || !res.body) {
        const text = await res.text()
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
          if (typeof choice.message?.reasoning_content === 'string')
            emit(choice.message.reasoning_content, 'reasoning')
          if (Array.isArray(choice.message?.tool_calls)) {
            ;(choice.message.tool_calls as Record<string, any>[]).forEach((tc, i) => {
              toolAcc.set(i, {
                id: String(tc?.id ?? ''),
                name: String(tc?.function?.name ?? ''),
                args: String(tc?.function?.arguments ?? ''),
              })
            })
          }
          const content = choice.message?.content ?? choice.text ?? ''
          if (content) emit(String(content), 'content')
          if (choice.finish_reason) finishReason = String(choice.finish_reason)
          finish()
        } catch {
          fail('响应不是合法的 JSON：' + text.slice(0, 300))
        }
        return
      }

      const reader = res.body.getReader()
      const td = new TextDecoder()
      let done = false
      for (;;) {
        const { done: eof, value } = await reader.read()
        if (eof) break
        armIdle()
        sseBuffer += td.decode(value, { stream: true })
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
      }
      if (done) return
      if (sseBuffer && handleLine(sseBuffer)) {
        finish()
        return
      }
      finish()
    } catch (e) {
      const err = e as Error & { name?: string }
      if (err.name === 'AbortError') {
        fail('已取消', 'ABORTED')
        return
      }
      fail(err.message || 'NETWORK_ERROR', 'NETWORK_ERROR')
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
    }
  })()

  return { abort: () => controller.abort() }
}
