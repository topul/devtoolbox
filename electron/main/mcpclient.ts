/**
 * MCP 客户端（Inspector 的内核）。
 *
 * 支持两种传输：
 *   - **stdio**：spawn 一个进程，按行收发 JSON-RPC（LSP 风格）
 *   - **http**：Streamable HTTP，POST 一条 JSON-RPC，响应可能是 JSON 也可能是 SSE 流
 *
 * 不 import electron：宿主只注入 `emit`，因此 `npm run smoke:mcpclient` 能直接用
 * **本仓库自己构建出来的 MCP 服务端**当被测目标跑端到端 —— 客户端与服务端互为验证。
 *
 * 已知边界（界面上会说明）：HTTP 传输只覆盖「POST 直接带回响应」这一种形态；
 * 服务端返回 202 表示「响应走另一条 GET SSE 流」的用法暂不支持。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { streamHop } from './http'
import type {
  McpCallOutcome,
  McpCatalog,
  McpClientEvent,
  McpConnectSpec,
  McpPromptInfo,
  McpResourceInfo,
  McpServerInfo,
  McpToolInfo,
} from '../../src/lib/mcpclient-types'

/** 首选的协议版本；服务端若不认会回它自己的版本，我们照单全收 */
export const CLIENT_PROTOCOL_VERSION = '2025-06-18'
export const CLIENT_NAME = 'devtoolbox-inspector'
const DEFAULT_TIMEOUT_MS = 30_000

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
  result?: any
  error?: { code: number; message: string; data?: unknown }
}

interface PendingSlot {
  resolve: (msg: JsonRpcMessage) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

interface Transport {
  send: (msg: unknown) => void
  close: () => Promise<void>
  describe: () => string
}

export interface McpClientHooks {
  emit: (evt: McpClientEvent) => void
  /** 客户端自身版本号，initialize 时上报 */
  version?: string
}

/* ================= 传输：stdio ================= */

class StdioTransport implements Transport {
  private child: ChildProcess
  private buffer = ''
  private stderrTail = ''
  private exited = false

  constructor(
    spec: McpConnectSpec,
    private onMessage: (raw: string) => void,
    private onLog: (text: string, source: 'stderr' | 'info') => void,
    onExit: (code: number | null, signal: string | null) => void,
    onSpawnError: (err: Error) => void,
  ) {
    const command = (spec.command ?? '').trim()
    if (!command) throw new Error('未填写要启动的命令')
    this.child = spawn(command, spec.args ?? [], {
      env: { ...process.env, ...(spec.env ?? {}) },
      cwd: spec.cwd || undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.child.stdout?.setEncoding('utf8')
    this.child.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk
      let idx: number
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx)
        this.buffer = this.buffer.slice(idx + 1)
        if (line.trim()) this.onMessage(line)
      }
    })

    this.child.stderr?.setEncoding('utf8')
    this.child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000)
      this.onLog(chunk, 'stderr')
    })

    this.child.on('error', (err) => {
      this.exited = true
      onSpawnError(err)
    })
    this.child.on('exit', (code, signal) => {
      this.exited = true
      onExit(code, signal)
    })
  }

  send(msg: unknown): void {
    if (this.exited || !this.child.stdin?.writable) throw new Error('子进程已退出，无法写入')
    this.child.stdin.write(JSON.stringify(msg) + '\n')
  }

  /** 起不来时把 stderr 尾巴带出去，比「命令不存在」有用得多 */
  diagnostics(): string {
    return this.stderrTail.trim()
  }

  async close(): Promise<void> {
    if (this.exited) return
    try {
      this.child.stdin?.end()
    } catch {
      /* 已经关了就算了 */
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          this.child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolve()
      }, 1000)
      this.child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  describe(): string {
    return 'stdio'
  }
}

/* ================= 传输：Streamable HTTP ================= */

class HttpTransport implements Transport {
  private sessionId: string | null = null

  constructor(
    private spec: McpConnectSpec,
    private onMessage: (raw: string) => void,
    private onLog: (text: string, source: 'stderr' | 'info') => void,
    private onDown: (detail: string) => void,
  ) {
    if (!spec.url?.trim()) throw new Error('未填写服务端地址')
  }

  send(msg: unknown): void {
    void this.post(JSON.stringify(msg))
  }

  private post(body: string): Promise<void> {
    const timeoutMs = this.spec.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const headers: [string, string][] = [
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json, text/event-stream'],
      ...(this.sessionId ? ([['Mcp-Session-Id', this.sessionId]] as [string, string][]) : []),
      ...(this.spec.headers ?? []),
    ]

    return new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      streamHop(
        {
          url: new URL(this.spec.url!.trim()),
          method: 'POST',
          headers: Object.fromEntries(headers),
          body: Buffer.from(body, 'utf8'),
          timeoutMs,
          rejectUnauthorized: true,
          proxy: null,
          passthrough: false,
          isHttps: this.spec.url!.trim().startsWith('https:'),
        },
        {
          onHeaders: (res, ttfb) => {
            const sid = res.headers['mcp-session-id']
            if (typeof sid === 'string' && sid) this.sessionId = sid
            const status = res.statusCode ?? 0
            const ctype = String(res.headers['content-type'] ?? '')
            this.onLog(`← ${status} ${ctype || '(无 content-type)'} · 首字节 ${ttfb}ms\n`, 'info')

            if (status === 202) {
              // 服务端表示「响应稍后经另一条 SSE 流送达」，本实现不覆盖这种形态
              this.onDown('服务端返回 202：响应走独立的 SSE 流，本工具暂不支持这种用法')
              res.resume()
              done()
              return
            }
            if (status < 200 || status >= 300) {
              const parts: Buffer[] = []
              res.on('data', (c: Buffer) => parts.push(c))
              res.on('end', () => {
                this.onDown(`HTTP ${status}：${Buffer.concat(parts).toString('utf8').slice(0, 300)}`)
                done()
              })
              return
            }

            if (ctype.includes('text/event-stream')) {
              let buf = ''
              res.setEncoding('utf8')
              res.on('data', (chunk: string) => {
                buf += chunk
                let idx: number
                while ((idx = buf.indexOf('\n')) >= 0) {
                  const line = buf.slice(0, idx)
                  buf = buf.slice(idx + 1)
                  const t = line.trim()
                  if (!t || t.startsWith(':') || !t.startsWith('data:')) continue
                  const payload = t.slice(5).trim()
                  if (payload && payload !== '[DONE]') this.onMessage(payload)
                }
              })
              res.on('end', done)
              res.on('error', (e) => {
                this.onDown(`流中断：${(e as Error).message}`)
                done()
              })
              return
            }

            const parts: Buffer[] = []
            res.on('data', (c: Buffer) => parts.push(c))
            res.on('end', () => {
              const text = Buffer.concat(parts).toString('utf8').trim()
              if (text) {
                // 可能是一条消息，也可能是批量数组
                if (text.startsWith('[')) {
                  try {
                    for (const one of JSON.parse(text) as unknown[]) this.onMessage(JSON.stringify(one))
                  } catch {
                    this.onLog(`响应不是合法 JSON：${text.slice(0, 200)}\n`, 'stderr')
                  }
                } else {
                  this.onMessage(text)
                }
              }
              done()
            })
            res.on('error', (e) => {
              this.onDown(`读取响应失败：${(e as Error).message}`)
              done()
            })
          },
          onError: (err) => {
            this.onDown(err.message === 'ABORTED' ? '请求已取消' : err.message)
            done()
          },
        },
      )
    })
  }

  async close(): Promise<void> {
    this.sessionId = null
  }

  describe(): string {
    return 'http'
  }
}

/* ================= MCP 客户端 ================= */

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content === undefined ? '' : JSON.stringify(content, null, 2)
  const parts: string[] = []
  for (const block of content as Record<string, unknown>[]) {
    const type = String(block?.type ?? '')
    if (type === 'text') parts.push(String(block.text ?? ''))
    else if (type === 'image') parts.push(`[图片 ${String(block.mimeType ?? '未知类型')}，约 ${Math.round(String(block.data ?? '').length * 0.75)} 字节]`)
    else if (type === 'audio') parts.push(`[音频 ${String(block.mimeType ?? '未知类型')}]`)
    else if (type === 'resource') {
      const r = block.resource as Record<string, unknown> | undefined
      parts.push(typeof r?.text === 'string' ? String(r.text) : `[资源 ${String(r?.uri ?? '')}]`)
    } else parts.push(JSON.stringify(block))
  }
  return parts.join('\n')
}

export class McpClient {
  private transport: Transport | null = null
  private pending = new Map<string | number, PendingSlot>()
  private seq = 0
  private info: McpServerInfo | null = null
  private closed = false

  constructor(private spec: McpConnectSpec, private hooks: McpClientHooks) {}

  private emit(evt: McpClientEvent): void {
    this.hooks.emit(evt)
  }

  private get id(): string {
    return this.spec.id
  }

  /* ---- 收发 ---- */

  private handleRaw(raw: string): void {
    const trimmed = raw.trim()
    if (!trimmed) return
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage
    } catch {
      // 服务端把日志打到 stdout 了 —— 这会把协议搞坏，必须让人看见，但别让整条连接崩掉
      this.emit({ type: 'frame', id: this.id, dir: 'recv', payload: trimmed, ok: false })
      return
    }
    this.emit({ type: 'frame', id: this.id, dir: 'recv', payload: JSON.stringify(msg), ok: true })

    if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
      const slot = this.pending.get(msg.id)
      if (slot) {
        clearTimeout(slot.timer)
        this.pending.delete(msg.id)
        slot.resolve(msg)
      }
      return
    }
    if (typeof msg.method === 'string') {
      this.emit({ type: 'notification', id: this.id, method: msg.method, params: msg.params })
    }
  }

  private sendFrame(msg: JsonRpcMessage): void {
    this.emit({ type: 'frame', id: this.id, dir: 'send', payload: JSON.stringify(msg), ok: true })
    if (!this.transport) throw new Error('尚未连接')
    this.transport.send(msg)
  }

  private request(method: string, params?: unknown, timeoutOverride?: number): Promise<JsonRpcMessage> {
    const timeoutMs = timeoutOverride ?? this.spec.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const id = ++this.seq
    return new Promise<JsonRpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 超时（${timeoutMs}ms 内没有响应）`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.sendFrame({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e as Error)
      }
    })
  }

  private notify(method: string, params?: unknown): void {
    try {
      this.sendFrame({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
    } catch {
      /* 通知发不出去不影响主流程 */
    }
  }

  /**
   * 连接断了要把还在等的请求全部拒掉。
   * 只清计时器是不够的 —— 那样 await 永远不返回，界面会一直是「调用中」。
   */
  private failAllPending(reason: string): void {
    for (const [, slot] of this.pending) {
      clearTimeout(slot.timer)
      slot.reject(new Error(reason))
    }
    this.pending.clear()
  }

  /** 关掉传输但不发状态事件（用于连接失败的清理，免得把 error 状态冲掉） */
  private async teardown(): Promise<void> {
    this.failAllPending('连接已关闭')
    const t = this.transport
    this.transport = null
    if (t) await t.close()
  }

  /* ---- 生命周期 ---- */

  async connect(): Promise<McpServerInfo> {
    this.emit({ type: 'status', id: this.id, status: 'connecting' })
    const onLog = (text: string, source: 'stderr' | 'info'): void => {
      this.emit({ type: 'log', id: this.id, source, text })
    }

    if (this.spec.transport === 'stdio') {
      this.transport = new StdioTransport(
        this.spec,
        (raw) => this.handleRaw(raw),
        onLog,
        (code, signal) => {
          this.closed = true
          this.failAllPending('子进程已退出')
          this.emit({ type: 'exit', id: this.id, code, signal })
          this.emit({ type: 'status', id: this.id, status: 'disconnected', detail: `子进程退出（code=${code ?? '-'}）` })
        },
        (err) => {
          this.closed = true
          this.failAllPending(err.message)
          this.emit({ type: 'status', id: this.id, status: 'error', detail: `启动失败：${err.message}` })
        },
      )
    } else {
      this.transport = new HttpTransport(
        this.spec,
        (raw) => this.handleRaw(raw),
        onLog,
        (detail) => {
          this.emit({ type: 'status', id: this.id, status: 'error', detail })
        },
      )
    }

    let res: JsonRpcMessage
    try {
      res = await this.request('initialize', {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: this.hooks.version ?? '0' },
      })
    } catch (e) {
      // 握手失败要把传输收干净（别留下一个没人管的后台进程），但不要发 disconnected 把 error 状态冲掉
      this.closed = true
      await this.teardown()
      throw e
    }
    if (res.error) {
      this.closed = true
      await this.teardown()
      throw new Error(`initialize 失败：${res.error.message}`)
    }
    const result = res.result ?? {}
    const info: McpServerInfo = {
      name: String(result.serverInfo?.name ?? '(未命名)'),
      version: String(result.serverInfo?.version ?? ''),
      protocolVersion: String(result.protocolVersion ?? ''),
      instructions: typeof result.instructions === 'string' ? result.instructions : undefined,
      capabilities: (result.capabilities ?? {}) as Record<string, unknown>,
    }
    this.info = info
    this.emit({ type: 'serverInfo', id: this.id, info })
    // 协议要求：initialize 之后必须发这条通知，否则部分服务端会拒绝后续请求
    this.notify('notifications/initialized')
    this.emit({ type: 'status', id: this.id, status: 'connected' })
    return info
  }

  async loadCatalog(): Promise<McpCatalog> {
    const caps = this.info?.capabilities ?? {}
    const declared = {
      tools: 'tools' in caps,
      resources: 'resources' in caps,
      prompts: 'prompts' in caps,
    }
    const catalog: McpCatalog = { tools: [], resources: [], prompts: [], declared }

    if (declared.tools) {
      const res = await this.request('tools/list')
      if (res.error) throw new Error(`tools/list 失败：${res.error.message}`)
      catalog.tools = ((res.result?.tools ?? []) as McpToolInfo[]).map((t) => ({
        name: String(t.name),
        description: typeof t.description === 'string' ? t.description : undefined,
        inputSchema: t.inputSchema as McpToolInfo['inputSchema'],
      }))
    }
    if (declared.resources) {
      // 资源能力常常存在但列表为空或直接报错，不该因此让整次连接失败
      try {
        const res = await this.request('resources/list')
        if (!res.error) catalog.resources = (res.result?.resources ?? []) as McpResourceInfo[]
      } catch { /* 忽略 */ }
    }
    if (declared.prompts) {
      try {
        const res = await this.request('prompts/list')
        if (!res.error) catalog.prompts = (res.result?.prompts ?? []) as McpPromptInfo[]
      } catch { /* 忽略 */ }
    }
    this.emit({ type: 'catalog', id: this.id, catalog })
    return catalog
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallOutcome> {
    const started = Date.now()
    try {
      const res = await this.request('tools/call', { name, arguments: args })
      const durationMs = Date.now() - started
      if (res.error) {
        return {
          ok: false,
          isError: true,
          text: '',
          raw: res.error,
          durationMs,
          error: `协议错误 ${res.error.code}：${res.error.message}`,
        }
      }
      const result = res.result ?? {}
      return {
        ok: true,
        isError: !!result.isError,
        text: contentToText(result.content),
        raw: result,
        durationMs,
      }
    } catch (e) {
      return { ok: false, isError: false, text: '', raw: null, durationMs: Date.now() - started, error: (e as Error).message }
    }
  }

  /** 读资源；返回文本内容（二进制资源只报类型与大小） */
  async readResource(uri: string): Promise<McpCallOutcome> {
    const started = Date.now()
    try {
      const res = await this.request('resources/read', { uri })
      const durationMs = Date.now() - started
      if (res.error) return { ok: false, isError: true, text: '', raw: res.error, durationMs, error: `${res.error.message}` }
      const contents = (res.result?.contents ?? []) as Record<string, unknown>[]
      const text = contents
        .map((c) => (typeof c.text === 'string' ? c.text : `[${String(c.mimeType ?? '二进制')} ${String(c.uri ?? '')}]`))
        .join('\n')
      return { ok: true, isError: false, text, raw: res.result, durationMs }
    } catch (e) {
      return { ok: false, isError: false, text: '', raw: null, durationMs: Date.now() - started, error: (e as Error).message }
    }
  }

  /** 取提示词模板；返回拼接后的文本与原始 messages */
  async getPrompt(name: string, args: Record<string, unknown>): Promise<McpCallOutcome> {
    const started = Date.now()
    try {
      const res = await this.request('prompts/get', { name, arguments: args })
      const durationMs = Date.now() - started
      if (res.error) return { ok: false, isError: true, text: '', raw: res.error, durationMs, error: `${res.error.message}` }
      const text = contentToText(res.result?.messages)
      return { ok: true, isError: false, text, raw: res.result, durationMs }
    } catch (e) {
      return { ok: false, isError: false, text: '', raw: null, durationMs: Date.now() - started, error: (e as Error).message }
    }
  }

  async ping(): Promise<number> {
    const started = Date.now()
    const res = await this.request('ping')
    if (res.error) throw new Error(`ping 失败：${res.error.message}`)
    return Date.now() - started
  }

  async disconnect(): Promise<void> {
    this.closed = true
    await this.teardown()
    this.emit({ type: 'status', id: this.id, status: 'disconnected' })
  }

  isClosed(): boolean {
    return this.closed
  }

  describe(): string {
    return this.transport?.describe() ?? this.spec.transport
  }
}
