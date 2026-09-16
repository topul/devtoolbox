/**
 * 抓包代理内核
 *
 * 一条链路：客户端 → 本机代理（明文直读 / 密文用本地 CA 现场签发叶证书解密）
 *        → 命中规则（阻断 / 伪造 / 断点暂停 / 改头改体 / 延迟）→ 转发上游
 *        → 上游响应 → 响应规则（改头改体）→ 回写客户端 → 全程记录会话
 *
 * 刻意不引入 electron：宿主通过回调注入「上报会话 / 请求用户放行 / 报错」，
 * 这样同一份内核既能跑在应用里，也能被 scripts/smoke-proxy.mjs 用真实请求端到端验证。
 */
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import { Buffer } from 'node:buffer'
import { HOP_BY_HOP, isCertError, performRequest } from '../http'
import { CertAuthority } from './ca'
import { RuleSet, applyHeaderOps, replaceText } from './rules'
import type {
  InterceptDecision,
  InterceptRequest,
  ProxyRule,
  ProxySession,
} from '../../../src/lib/proxy-types'

const PROXY_NAME = 'DevOpsToolbox/1.0'

export interface CaptureProxyOptions {
  port: number
  mitm: boolean
  caDir: string
  rulesFile: string
  maxSessions?: number
  maxBody?: number
  upstreamTimeoutMs?: number
  /** 会话状态回调：请求阶段与响应完成各一次 */
  onSession?: (session: ProxySession, phase: 'request' | 'complete') => void
  /** 断点：宿主把待编辑请求展示给用户并等待放行 */
  onIntercept?: (req: InterceptRequest, timeoutMs: number) => Promise<InterceptDecision>
  onError?: (message: string) => void
}

interface RequestContext {
  scheme: 'http' | 'https'
  host: string
  url: URL
}

function splitHostPort(authority: string): { host: string; port: number } {
  const a = authority.trim()
  if (a.startsWith('[')) {
    const idx = a.indexOf(']')
    const host = a.slice(1, idx)
    const rest = a.slice(idx + 1)
    return { host, port: rest.startsWith(':') ? Number(rest.slice(1)) : 443 }
  }
  const i = a.lastIndexOf(':')
  if (i < 0) return { host: a, port: 443 }
  return { host: a.slice(0, i), port: Number(a.slice(i + 1)) || 443 }
}

function headerLookup(headers: [string, string][], name: string): string | null {
  const hit = headers.find(([k]) => k.toLowerCase() === name.toLowerCase())
  return hit ? hit[1] : null
}

function readBody(req: http.IncomingMessage, limit: number): Promise<{ buf: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let truncated = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size <= limit) chunks.push(c)
      else truncated = true
    })
    req.on('end', () => resolve({ buf: Buffer.concat(chunks), truncated }))
    req.on('error', reject)
    req.on('aborted', () => resolve({ buf: Buffer.concat(chunks), truncated }))
  })
}

function stripHopByHop(headers: [string, string][]): [string, string][] {
  const drop = new Set([...HOP_BY_HOP, 'content-length'])
  return headers.filter(([k]) => !drop.has(k.toLowerCase()))
}

function toHeaderPairs(headers: [string, string][]): [string, string][] {
  return headers.map(([k, v]) => [String(k), String(v)] as [string, string])
}

export class CaptureProxy {
  private opts: CaptureProxyOptions
  private server: http.Server | null = null
  private mitmServer: http.Server | null = null
  private ca: CertAuthority
  private rules: RuleSet
  private sessions: ProxySession[] = []
  private index = new Map<string, ProxySession>()
  private seq = 0
  private running = false
  private currentPort = 0
  private mitmEnabled = false
  private maxBody: number
  private maxSessions: number

  constructor(options: CaptureProxyOptions) {
    this.opts = options
    this.ca = new CertAuthority(options.caDir)
    this.rules = new RuleSet(options.rulesFile)
    this.maxBody = options.maxBody ?? 8 * 1024 * 1024
    this.maxSessions = options.maxSessions ?? 500
    this.mitmEnabled = options.mitm
    this.currentPort = options.port
  }

  /* ================= 生命周期 ================= */

  get isRunning(): boolean {
    return this.running
  }

  get port(): number {
    return this.currentPort
  }

  get mitm(): boolean {
    return this.mitmEnabled
  }

  get authority(): CertAuthority {
    return this.ca
  }

  get ruleSet(): RuleSet {
    return this.rules
  }

  async initCa(): Promise<void> {
    await this.ca.init()
  }

  async start(port?: number, mitm?: boolean): Promise<number> {
    if (typeof port === 'number' && port > 0) this.currentPort = port
    if (typeof mitm === 'boolean') this.mitmEnabled = mitm
    if (this.mitmEnabled) await this.ca.init()
    if (this.running) return this.currentPort

    this.mitmServer = http.createServer((req, res) => { void this.onDecryptedRequest(req, res) })
    this.mitmServer.on('clientError', () => { /* 客户端主动断连，忽略 */ })
    this.mitmServer.keepAliveTimeout = 8000

    const server = http.createServer((req, res) => { void this.onProxyRequest(req, res) })
    // node 把 connect/upgrade 的 socket 声明为 Duplex，运行期实际是 net.Socket
    server.on('connect', (req, socket, head) => this.onConnect(req, socket as net.Socket, head))
    server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket as net.Socket, head))
    server.on('clientError', (_err, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    })
    server.keepAliveTimeout = 8000
    server.headersTimeout = 30_000
    server.requestTimeout = 0

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err)
      server.once('error', onError)
      server.listen(this.currentPort, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })

    const addr = server.address()
    this.currentPort = typeof addr === 'object' && addr ? addr.port : this.currentPort
    this.server = server
    this.running = true
    return this.currentPort
  }

  async stop(): Promise<void> {
    this.running = false
    const server = this.server
    this.server = null
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        // 已建立的 keep-alive 连接会拖住 close，主动断开
        server.closeAllConnections?.()
        setTimeout(resolve, 800)
      })
    }
    this.mitmServer = null
  }

  async setMitm(enabled: boolean): Promise<void> {
    this.mitmEnabled = enabled
    if (enabled) await this.ca.init()
  }

  /* ================= 会话 ================= */

  listSessions(): ProxySession[] {
    return this.sessions.map((s) => ({ ...s }))
  }

  getSession(id: string): ProxySession | null {
    const s = this.index.get(id)
    return s ? { ...s } : null
  }

  clearSessions(): void {
    this.sessions = []
    this.index.clear()
    this.seq = 0
  }

  private record(session: ProxySession, phase: 'request' | 'complete'): void {
    this.index.set(session.id, session)
    this.opts.onSession?.({ ...session }, phase)
  }

  private newSession(partial: Partial<ProxySession>): ProxySession {
    const session: ProxySession = {
      id: partial.id ?? `s${Date.now().toString(36)}_${(this.seq + 1).toString(36)}`,
      seq: ++this.seq,
      startedAt: Date.now(),
      scheme: partial.scheme ?? 'http',
      method: partial.method ?? 'GET',
      url: partial.url ?? '',
      host: partial.host ?? '',
      path: partial.path ?? '/',
      reqHeaders: partial.reqHeaders ?? [],
      reqBodyBase64: partial.reqBodyBase64 ?? '',
      reqBodyBytes: partial.reqBodyBytes ?? 0,
      status: partial.status ?? null,
      statusText: partial.statusText ?? '',
      resHeaders: partial.resHeaders ?? [],
      resBodyBase64: partial.resBodyBase64 ?? '',
      resBodyBytes: partial.resBodyBytes ?? 0,
      resContentEncoding: partial.resContentEncoding ?? '',
      resTruncated: partial.resTruncated ?? false,
      durationMs: 0,
      clientIp: partial.clientIp ?? '',
      matchedRules: partial.matchedRules ?? [],
      modified: partial.modified ?? false,
      intercepted: partial.intercepted ?? false,
      mocked: partial.mocked ?? false,
      blocked: partial.blocked ?? false,
      tunneled: partial.tunneled ?? false,
      error: partial.error,
      note: partial.note,
    }
    this.sessions.push(session)
    if (this.sessions.length > this.maxSessions) {
      const drop = this.sessions.splice(0, this.sessions.length - this.maxSessions)
      for (const d of drop) this.index.delete(d.id)
    }
    return session
  }

  /* ================= 入口：明文代理 ================= */

  private async onProxyRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const raw = req.url ?? ''
    let url: URL | null = null
    try {
      url = new URL(raw)
    } catch {
      url = null
    }
    if (!url || !/^https?:$/.test(url.protocol)) {
      // 客户端把代理当普通服务器访问（如直接 GET /health）
      const host = headerLookup(toHeaderPairs(Object.entries(req.headers).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, String(v ?? '')] as [string, string]])), 'host')
      if (raw === '/__devtoolbox__' || raw.startsWith('/__devtoolbox__?')) {
        this.writePlain(res, 200, 'DevOps Toolbox 抓包代理运行中\n', 'text/plain; charset=utf-8')
        return
      }
      this.writePlain(res, 400, `该端口是 HTTP 代理，请把 http/https 代理指向 127.0.0.1:${this.currentPort}\n`, 'text/plain; charset=utf-8')
      this.opts.onError?.(`收到非代理格式请求：${host ?? ''} ${raw}`)
      return
    }
    await this.serve(req, res, {
      scheme: url.protocol === 'https:' ? 'https' : 'http',
      host: url.hostname,
      url,
    })
  }

  /* ================= 入口：MITM 解密后的请求 ================= */

  private async onDecryptedRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const socket = req.socket as tls.TLSSocket & { __mitmHost?: string; __mitmAuthority?: string }
    // CONNECT 的 authority 才是真实目标（含端口），Host 头仅作兜底
    const authority = socket.__mitmAuthority ?? req.headers.host ?? ''
    const host = socket.__mitmHost ?? authority.split(':')[0]
    if (!host) {
      this.writePlain(res, 400, '缺少 Host\n', 'text/plain; charset=utf-8')
      return
    }
    let url: URL
    try {
      url = new URL(`${req.url ?? '/'}`, `https://${authority || host}`)
    } catch {
      this.writePlain(res, 400, 'URL 非法\n', 'text/plain; charset=utf-8')
      return
    }
    await this.serve(req, res, { scheme: 'https', host, url })
  }

  /* ================= 核心处理 ================= */

  private async serve(req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext): Promise<void> {
    const startedAt = Date.now()
    let reqBody: Buffer
    try {
      reqBody = (await readBody(req, this.maxBody)).buf
    } catch (err) {
      this.writePlain(res, 400, `读取请求体失败: ${(err as Error).message}\n`, 'text/plain; charset=utf-8')
      return
    }

    const headerPairs = toHeaderPairs(
      Object.entries(req.headers).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, String(v ?? '')] as [string, string]]),
    )

    const session = this.newSession({
      scheme: ctx.scheme,
      method: (req.method ?? 'GET').toUpperCase(),
      url: ctx.url.href,
      host: ctx.host,
      path: ctx.url.pathname + ctx.url.search,
      reqHeaders: headerPairs,
      reqBodyBase64: reqBody.length ? reqBody.toString('base64') : '',
      reqBodyBytes: reqBody.length,
      clientIp: (req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''),
    })

    let method = session.method
    let url = ctx.url
    let headers = headerPairs
    let body = reqBody
    const matched = this.rules.match({ method, host: ctx.host, path: session.path, scheme: ctx.scheme })
    session.matchedRules = matched.map((r) => r.name || r.id)

    // ---- 请求阶段规则 ----
    if (matched.length) {
      const headerOps = matched.flatMap((r) => r.reqHeaderOps)
      if (headerOps.length) {
        headers = applyHeaderOps(headers, headerOps)
        session.modified = true
      }
      for (const rule of matched) {
        if (!rule.reqBodyFind || !body.length) continue
        const text = body.toString('utf8')
        const next = replaceText(text, rule.reqBodyFind, rule.reqBodyReplace, rule.reqBodyRegex)
        if (next !== text) {
          body = Buffer.from(next, 'utf8')
          session.modified = true
        }
      }
      const delay = matched.reduce((max, r) => Math.max(max, r.delayMs || 0), 0)
      const blocked = matched.find((r) => r.block)
      const mocked = matched.find((r) => r.mock)
      const breakRule = matched.find((r) => r.breakpoint)

      if (blocked) {
        session.blocked = true
        session.status = 403
        session.statusText = 'Blocked'
        session.durationMs = Date.now() - startedAt
        session.reqHeaders = headers
        session.reqBodyBase64 = body.length ? body.toString('base64') : ''
        session.reqBodyBytes = body.length
        session.modified = true
        const payload = JSON.stringify({ error: 'blocked by DevOps Toolbox', rule: blocked.name || blocked.id })
        this.writePlain(res, 403, payload, 'application/json; charset=utf-8')
        this.record(session, 'complete')
        return
      }

      if (mocked?.mock) {
        const m = mocked.mock
        session.mocked = true
        session.status = m.status
        session.statusText = 'Mocked'
        session.resHeaders = m.headers
        const mBody = m.bodyBase64 != null && m.bodyBase64 !== ''
          ? Buffer.from(m.bodyBase64, 'base64')
          : Buffer.from(m.bodyText ?? '', 'utf8')
        session.resBodyBase64 = mBody.toString('base64')
        session.resBodyBytes = mBody.length
        session.durationMs = Date.now() - startedAt
        session.reqHeaders = headers
        session.reqBodyBase64 = body.length ? body.toString('base64') : ''
        session.reqBodyBytes = body.length
        session.modified = true
        this.writePlain(res, m.status, mBody, headerLookup(m.headers, 'content-type') ?? 'application/json; charset=utf-8', m.headers)
        this.record(session, 'complete')
        return
      }

      if (breakRule && this.opts.onIntercept) {
        session.intercepted = true
        this.record(session, 'request')
        let decision: InterceptDecision = { action: 'forward' }
        try {
          decision = await this.opts.onIntercept({
            id: session.id,
            method,
            url: url.href,
            host: ctx.host,
            headers,
            bodyBase64: body.toString('base64'),
            ruleName: breakRule.name || breakRule.id,
            clientIp: session.clientIp,
            receivedAt: Date.now(),
          }, 120_000)
        } catch (err) {
          this.opts.onError?.(`断点等待失败: ${(err as Error).message}`)
        }
        if (decision.action === 'drop') {
          session.error = '断点中丢弃'
          session.durationMs = Date.now() - startedAt
          this.writePlain(res, 502, '已被断点丢弃', 'text/plain; charset=utf-8')
          this.record(session, 'complete')
          return
        }
        if (decision.mock) {
          session.mocked = true
          session.status = decision.mock.status
          const mBody = decision.mock.bodyBase64 != null && decision.mock.bodyBase64 !== ''
            ? Buffer.from(decision.mock.bodyBase64, 'base64')
            : Buffer.from(decision.mock.bodyText ?? '', 'utf8')
          session.resHeaders = decision.mock.headers
          session.resBodyBase64 = mBody.toString('base64')
          session.resBodyBytes = mBody.length
          session.durationMs = Date.now() - startedAt
          this.writePlain(res, decision.mock.status, mBody, headerLookup(decision.mock.headers, 'content-type') ?? 'text/plain; charset=utf-8', decision.mock.headers)
          this.record(session, 'complete')
          return
        }
        if (decision.method) method = decision.method.toUpperCase()
        if (decision.url) {
          try { url = new URL(decision.url) } catch { /* 保留原 URL */ }
        }
        if (decision.headers) headers = decision.headers
        if (decision.bodyBase64 != null) body = Buffer.from(decision.bodyBase64, 'base64')
        if (method !== session.method || url.href !== session.url || decision.headers || decision.bodyBase64 != null) {
          session.modified = true
        }
      }

      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    }

    session.method = method
    session.url = url.href
    session.host = url.hostname
    session.path = url.pathname + url.search
    session.reqHeaders = headers
    session.reqBodyBase64 = body.length ? body.toString('base64') : ''
    session.reqBodyBytes = body.length
    this.record(session, 'request')

    // ---- 转发上游 ----
    const upstreamHeaders = stripHopByHop(headers)
    if (!headerLookup(upstreamHeaders, 'host')) upstreamHeaders.push(['Host', url.host])
    if (!headerLookup(upstreamHeaders, 'user-agent')) upstreamHeaders.push(['User-Agent', 'DevOpsToolbox/1.0'])
    // 正文已在本地缓冲，长度可确定，避免上游收到 chunked
    if (body.length > 0) upstreamHeaders.push(['Content-Length', String(body.length)])

    const sendUpstream = (rejectUnauthorized: boolean) => performRequest({
      method,
      url: url.href,
      headers: upstreamHeaders,
      bodyBase64: body.length ? body.toString('base64') : undefined,
      followRedirects: false,
      rejectUnauthorized,
      timeoutMs: this.opts.upstreamTimeoutMs ?? 60_000,
      passthrough: true,
    })

    let upstream = await sendUpstream(true)
    let downgraded = false
    if (!upstream.ok && (upstream.tls?.authorized === false || isCertError(upstream.errorCode, upstream.error))) {
      // 上游证书不被信任（自签 / 过期 / 域名不符）：降级放行并如实标注
      upstream = await sendUpstream(false)
      downgraded = upstream.ok
    }
    if (downgraded) {
      session.note = `上游证书未通过校验（${upstream.tls?.authorizationError ?? '验证失败'}），已降级放行`
    }

    if (!upstream.ok) {
      session.error = upstream.error || upstream.errorCode || '上游请求失败'
      session.durationMs = Date.now() - startedAt
      this.opts.onError?.(`上游失败 ${method} ${url.href} → ${upstream.errorCode ?? ''} ${upstream.error ?? ''}`)
      this.record(session, 'complete')
      this.writePlain(res, 502, `上游请求失败: ${session.error}\n`, 'text/plain; charset=utf-8')
      return
    }

    // ---- 响应阶段规则 ----
    let resHeaders = upstream.headers
    let resBodyRaw = Buffer.from(upstream.rawBodyBase64, 'base64')
    let bodyChanged = false

    const resHeaderOps = matched.flatMap((r) => r.resHeaderOps)
    if (resHeaderOps.length) {
      resHeaders = applyHeaderOps(resHeaders, resHeaderOps)
      session.modified = true
    }
    const bodyEdits = matched.filter((r) => r.resBodyFind)
    if (bodyEdits.length && upstream.bodyBase64) {
      let text = Buffer.from(upstream.bodyBase64, 'base64').toString('utf8')
      const before = text
      for (const rule of bodyEdits) {
        text = replaceText(text, rule.resBodyFind, rule.resBodyReplace, rule.resBodyRegex)
      }
      if (text !== before) {
        resBodyRaw = Buffer.from(text, 'utf8')
        bodyChanged = true
        session.modified = true
      }
    }

    session.status = upstream.status
    session.statusText = upstream.statusText
    session.resHeaders = resHeaders
    session.resBodyBase64 = bodyChanged ? resBodyRaw.toString('base64') : upstream.bodyBase64
    session.resBodyBytes = bodyChanged ? resBodyRaw.length : upstream.bodyBytes
    session.resContentEncoding = bodyChanged ? '' : upstream.contentEncoding
    session.resTruncated = upstream.truncated
    session.durationMs = Date.now() - startedAt
    this.record(session, 'complete')

    const outHeaders = stripHopByHop(resHeaders)
    // 改过响应体：内容已是解压后的明文，必须去掉 content-encoding，并让 node 重算长度
    if (bodyChanged) {
      for (let i = outHeaders.length - 1; i >= 0; i--) {
        if (outHeaders[i][0].toLowerCase() === 'content-encoding') outHeaders.splice(i, 1)
      }
    }
    outHeaders.push(['Content-Length', String(resBodyRaw.length)])
    try {
      res.writeHead(upstream.status, upstream.statusText, outHeaders)
      res.end(resBodyRaw)
    } catch {
      /* 客户端已断开 */
    }
  }

  /* ================= CONNECT / 隧穿 ================= */

  private onConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
    const { host, port } = splitHostPort(req.url ?? '')
    if (!host) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    if (!this.mitmEnabled) {
      this.tunnelBlind(clientSocket, head, host, port, req)
      return
    }

    clientSocket.write(`HTTP/1.1 200 Connection Established\r\nProxy-Agent: ${PROXY_NAME}\r\n\r\n`)
    clientSocket.setNoDelay(true)

    const attach = (socket: tls.TLSSocket) => {
      socket.setNoDelay(true)
      socket.on('error', (err) => {
        const raw = (err as Error).message
        // 客户端不信任我们的叶证书时会拒绝握手（unknown ca / handshake failure）。
        // 这类失败本身不是 bug，但要给出可执行的处置建议，否则用户只看到一串 TLS 报错。
        const rejectedByClient = /unknown ca|certificate unknown|handshake failure|bad certificate|dh key too small|tlsv1 alert/i.test(raw)
          || ['ECONNRESET', 'EPIPE'].includes((err as NodeJS.ErrnoException).code ?? '')
        this.opts.onError?.(rejectedByClient
          ? `客户端拒绝了本地证书（${host}）：请先把根证书加入系统信任，或关闭「解密 HTTPS」只做隧道转发`
          : `解密连接出错 (${host}): ${raw}`)
        socket.destroy()
      })
      this.mitmServer?.emit('connection', socket)
    }

    try {
      const tlsSocket = new tls.TLSSocket(clientSocket, {
        isServer: true,
        secureContext: this.ca.contextFor(host),
        SNICallback: (servername, cb) => {
          try {
            cb(null, this.ca.contextFor(servername || host))
          } catch (err) {
            cb(err as Error, undefined)
          }
        },
        ALPNProtocols: ['http/1.1'],
      }) as tls.TLSSocket & { __mitmHost?: string; __mitmAuthority?: string }

      tlsSocket.__mitmHost = host
      tlsSocket.__mitmAuthority = port === 443 ? host : `${host}:${port}`
      attach(tlsSocket)
      if (head && head.length) tlsSocket.unshift(head)
    } catch (err) {
      this.opts.onError?.(`签发证书失败 (${host}): ${(err as Error).message}`)
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    }
  }

  /** 未开启解密时的盲隧道：只记录连接事实，正文不可见 */
  private tunnelBlind(clientSocket: net.Socket, head: Buffer, host: string, port: number, req: http.IncomingMessage): void {
    const session = this.newSession({
      scheme: 'tunnel',
      method: 'CONNECT',
      url: `${host}:${port}`,
      host,
      path: `:${port}`,
      reqHeaders: toHeaderPairs(Object.entries(req.headers).map(([k, v]) => [k, String(v ?? '')])),
      clientIp: (clientSocket.remoteAddress ?? '').replace(/^::ffff:/, ''),
      tunneled: true,
      modified: true,
      note: '未开启 HTTPS 解密，仅隧道转发（正文不可见）',
    })
    this.record(session, 'complete')

    const upstream = net.connect(port, host, () => {
      clientSocket.write(`HTTP/1.1 200 Connection Established\r\nProxy-Agent: ${PROXY_NAME}\r\n\r\n`)
      if (head && head.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    const cleanup = () => { clientSocket.destroy(); upstream.destroy() }
    upstream.on('error', (err) => {
      this.opts.onError?.(`隧道上游失败 (${host}:${port}): ${(err as Error).message}`)
      cleanup()
    })
    clientSocket.on('error', cleanup)
    clientSocket.on('close', () => upstream.destroy())
    upstream.on('close', () => clientSocket.destroy())
  }

  /** WebSocket 等 upgrade 请求：直接隧穿（不做解密改写） */
  private onUpgrade(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
    let target: URL
    try {
      target = new URL(req.url ?? '')
    } catch {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    const port = Number(target.port || (target.protocol === 'wss:' ? 443 : 80))
    const session = this.newSession({
      scheme: target.protocol === 'wss:' ? 'tunnel' : 'http',
      method: 'UPGRADE',
      url: target.href,
      host: target.hostname,
      path: target.pathname + target.search,
      reqHeaders: toHeaderPairs(Object.entries(req.headers).map(([k, v]) => [k, String(v ?? '')])),
      clientIp: (clientSocket.remoteAddress ?? '').replace(/^::ffff:/, ''),
      tunneled: true,
      modified: true,
      note: 'WebSocket / Upgrade 请求按隧道转发（正文不可见）',
    })
    this.record(session, 'complete')

    const upstream = net.connect(port, target.hostname, () => {
      const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`]
      for (const [k, v] of Object.entries(req.headers)) lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : String(v ?? '')}`)
      upstream.write(lines.join('\r\n') + '\r\n\r\n')
      if (head && head.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    const cleanup = () => { clientSocket.destroy(); upstream.destroy() }
    upstream.on('error', cleanup)
    clientSocket.on('error', cleanup)
    clientSocket.on('close', () => upstream.destroy())
    upstream.on('close', () => clientSocket.destroy())
  }

  /* ================= 回写工具 ================= */

  private writePlain(
    res: http.ServerResponse,
    status: number,
    body: string | Buffer,
    contentType: string,
    extra: [string, string][] = [],
  ): void {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')
    const headers = stripHopByHop(extra.filter(([k]) => k.toLowerCase() !== 'content-type'))
    headers.push(['Content-Type', contentType])
    headers.push(['Content-Length', String(buf.length)])
    headers.push(['Proxy-Agent', PROXY_NAME])
    try {
      res.writeHead(status, headers)
      res.end(buf)
    } catch { /* 客户端已断开 */ }
  }
}
