/**
 * 浏览器版 MCP 客户端 —— 只支持 Streamable HTTP 传输（JSON-RPC over fetch）。
 *
 * 桌面版的 McpClient 还带 stdio（spawn 本机进程），浏览器没有进程模型，物理上做不到。
 * 协议面尽量对齐：initialize → notifications/initialized → tools/list → tools/call，
 * 响应可能是 JSON 也可能是 SSE 流（同一份解码器语义），会话头 mcp-session-id 要带回传。
 */
import type { ChatToolServer } from '../chat-types'

const PROTOCOL_VERSION = '2025-03-26'
const DEFAULT_TIMEOUT_MS = 30_000

export interface McpToolDef {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpCallOutput {
  ok: boolean
  isError: boolean
  text: string
  durationMs: number
  error?: string
}

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

/** 从一段响应体（JSON 或 SSE 文本）里抠出 JSON-RPC 响应 */
function extractResponse(contentType: string, body: string): JsonRpcResponse | null {
  if (contentType.includes('text/event-stream')) {
    // SSE 形态：逐帧找 data 行，拼出第一份合法 JSON 响应
    for (const line of body.split(/\r?\n/)) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload) as JsonRpcResponse
        if (j && (j.result !== undefined || j.error !== undefined)) return j
      } catch {
        /* 半截帧，忽略 */
      }
    }
    return null
  }
  try {
    return JSON.parse(body) as JsonRpcResponse
  } catch {
    return null
  }
}

export class WebMcpHttpClient {
  private url: string
  private headers: [string, string][]
  private sessionId: string | null = null
  private nextId = 1
  private timeoutMs: number

  constructor(src: ChatToolServer, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.url = (src.url ?? '').trim()
    this.headers = src.headers ?? []
    this.timeoutMs = timeoutMs
  }

  get connected(): boolean {
    return this.sessionId !== null
  }

  private async rpc(
    method: string,
    params?: Record<string, unknown>,
    notify = false,
  ): Promise<JsonRpcResponse | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers = new Headers({
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      })
      for (const [k, v] of this.headers) if (k) headers.append(k, v)
      if (this.sessionId) headers.set('mcp-session-id', this.sessionId)

      const body: Record<string, unknown> = { jsonrpc: '2.0', method }
      if (!notify) body.id = this.nextId++
      if (params !== undefined) body.params = params

      const res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const sid = res.headers.get('mcp-session-id')
      if (sid) this.sessionId = sid
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (notify) return null
      const text = await res.text()
      const out = extractResponse(res.headers.get('content-type') ?? '', text)
      if (!out) throw new Error('响应里没有 JSON-RPC 结果')
      if (out.error) throw new Error(out.error.message || `JSON-RPC 错误 ${out.error.code}`)
      return out
    } finally {
      clearTimeout(timer)
    }
  }

  /** initialize + initialized 通知；失败抛错（调用方决定怎么降级） */
  async connect(): Promise<{ serverName?: string; serverVersion?: string }> {
    if (!this.url) throw new Error('服务端地址为空')
    const res = await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'devtoolbox-web', version: '1.0.0' },
    })
    const info = (res?.result?.serverInfo ?? {}) as { name?: string; version?: string }
    try {
      await this.rpc('notifications/initialized', undefined, true)
    } catch {
      /* 通知失败不致命 */
    }
    return { serverName: info.name, serverVersion: info.version }
  }

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.rpc('tools/list', {})
    const tools = (res?.result?.tools ?? []) as McpToolDef[]
    return Array.isArray(tools) ? tools : []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallOutput> {
    const started = Date.now()
    try {
      const res = await this.rpc('tools/call', { name, arguments: args })
      const result = res?.result ?? {}
      const isError = result.isError === true
      const content = (result.content ?? []) as { type?: string; text?: string }[]
      const text =
        content
          .filter((c) => !c.type || c.type === 'text')
          .map((c) => c.text ?? '')
          .filter(Boolean)
          .join('\n') || '(空结果)'
      return { ok: true, isError, text, durationMs: Date.now() - started }
    } catch (e) {
      return {
        ok: false,
        isError: true,
        text: '',
        durationMs: Date.now() - started,
        error: (e as Error).message,
      }
    }
  }

  async disconnect(): Promise<void> {
    if (!this.sessionId) return
    const sid = this.sessionId
    this.sessionId = null
    try {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      for (const [k, v] of this.headers) if (k) headers.append(k, v)
      headers.set('mcp-session-id', sid)
      await fetch(this.url, { method: 'DELETE', headers })
    } catch {
      /* 断开失败不影响收场 */
    }
  }
}
