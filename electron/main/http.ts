/**
 * 主进程 HTTP 请求引擎
 *
 * 为什么放在主进程：渲染进程的 fetch 受 CORS 与同源策略限制，且无法读取原始响应头、
 * 无法控制重定向与 TLS 校验。这里用 Node 的 http/https 模块实现，能力对齐 Postman：
 *
 *   - 任意方法 / 任意头（含重复头）/ 原始字节体
 *   - 重定向链可控（301/302/303 降级为 GET，307/308 保留方法体）
 *   - 超时、TLS 校验开关、gzip/deflate/br/zstd 自动解压、响应体截断保护
 *   - 可经 HTTP 代理发出：http 走绝对 URI，https 走 CONNECT 隧道后再 TLS
 *   - 完整耗时分解（连接 / TLS / 首字节 / 总计）
 *
 * 该模块不依赖 electron，可被脚本直接引入做端到端验证（scripts/smoke-proxy.mjs）。
 */
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import net from 'node:net'
import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'

/** 逐跳头：转发时必须剥离，由下一跳自行决定 */
export const HOP_BY_HOP = [
  'connection',
  'proxy-connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

/** 单次响应体保留上限，超出只保留前 N 字节（避免抓大文件把内存打爆） */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

// 类型契约与渲染进程共用（src/lib/http-types.ts），两端同步修改
export type {
  HttpRequestSpec,
  HttpRequestResult,
  HttpTimings,
  TlsInfo,
} from '../../src/lib/http-types'
import type {
  HttpRequestSpec,
  HttpRequestResult,
  HttpTimings,
  TlsInfo,
} from '../../src/lib/http-types'

/* ================= 工具函数 ================= */

export function parseProxyUrl(raw: string | null | undefined): URL | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`)
    if (!u.port) u.port = u.protocol === 'https:' ? '443' : '80'
    return u
  } catch {
    return null
  }
}

/** 有序头列表 → Node 请求头对象；重名合并为数组，保持可读 */
function toHeaderObject(list: [string, string][]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const seen = new Map<string, string>() // lower → 实际使用的 key
  for (const [rawK, rawV] of list) {
    const k = String(rawK ?? '').trim()
    if (!k) continue
    const v = String(rawV ?? '')
    const lower = k.toLowerCase()
    const exists = seen.get(lower)
    if (exists) {
      const cur = out[exists]
      if (Array.isArray(cur)) cur.push(v)
      else out[exists] = [cur as string, v]
    } else {
      seen.set(lower, k)
      out[k] = v
    }
  }
  return out
}

function specBody(spec: HttpRequestSpec): Buffer | null {
  if (spec.bodyBase64 != null && spec.bodyBase64 !== '') return Buffer.from(spec.bodyBase64, 'base64')
  if (spec.bodyText != null && spec.bodyText !== '') return Buffer.from(spec.bodyText, 'utf8')
  return null
}

function decompressBody(buf: Buffer, encoding: string): { body: Buffer; decompressed: boolean } {
  const enc = encoding.toLowerCase().trim()
  if (!enc || enc === 'identity' || buf.length === 0) return { body: buf, decompressed: false }
  try {
    if (enc.includes('gzip')) return { body: zlib.gunzipSync(buf), decompressed: true }
    if (enc.includes('br')) return { body: zlib.brotliDecompressSync(buf), decompressed: true }
    if (enc.includes('zstd')) {
      const z = zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }
      if (z.zstdDecompressSync) return { body: z.zstdDecompressSync(buf), decompressed: true }
      return { body: buf, decompressed: false }
    }
    if (enc.includes('deflate')) {
      try {
        return { body: zlib.inflateSync(buf), decompressed: true }
      } catch {
        return { body: zlib.inflateRawSync(buf), decompressed: true }
      }
    }
  } catch {
    return { body: buf, decompressed: false }
  }
  return { body: buf, decompressed: false }
}

/** 证书校验类错误的判定：抓包代理据此决定是否降级重试 */
const CERT_ERROR_CODES = [
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_UNTRUSTED',
  'ERR_TLS_INVALID_PROTOCOL_VERSION',
]

export function isCertError(code?: string, message?: string): boolean {
  if (code && CERT_ERROR_CODES.includes(code)) return true
  const m = (message ?? '').toLowerCase()
  return /self.signed|unable to verify|certificate has expired|altname|depth zero/.test(m)
}

function clip(buf: Buffer): { buf: Buffer; truncated: boolean } {
  if (buf.length <= MAX_BODY_BYTES) return { buf, truncated: false }
  return { buf: buf.subarray(0, MAX_BODY_BYTES), truncated: true }
}

function statusTextOf(status: number, fallback?: string): string {
  return fallback || http.STATUS_CODES[status] || ''
}

/** 从 TLS socket 现场取证：握手失败时 secureConnect 不触发，只能在这里读 */
function describeTls(s: tls.TLSSocket, err?: Error): TlsInfo | null {
  try {
    const cert = s.getPeerCertificate()
    return {
      protocol: s.getProtocol?.() ?? '',
      cipher: s.getCipher?.()?.name ?? '',
      authorized: !!s.authorized,
      authorizationError: s.authorizationError ? String(s.authorizationError) : (err?.message ?? null),
      subject: cert?.subject ? Object.values(cert.subject).join(', ') : '',
      issuer: cert?.issuer ? Object.values(cert.issuer).join(', ') : '',
      validTo: cert?.valid_to ?? '',
    }
  } catch {
    return null
  }
}

interface HopOptions {
  url: URL
  method: string
  headers: Record<string, string | string[]>
  body: Buffer | null
  timeoutMs: number
  rejectUnauthorized: boolean
  proxy: URL | null
  passthrough: boolean
  isHttps: boolean
}

interface HopResult {
  status: number
  statusText: string
  httpVersion: string
  headers: [string, string][]
  body: Buffer
  timings: HttpTimings
  remoteAddress: string
  tls: TlsInfo | null
}

/** 经 CONNECT 建立到目标主机的 TLS 隧道，返回已握手的 TLSSocket */
function openTunnel(
  proxy: URL,
  host: string,
  port: number,
  servername: string,
  rejectUnauthorized: boolean,
  timeoutMs: number,
): Promise<{ socket: tls.TLSSocket; connectMs: number; tlsMs: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    let connectMs = 0
    const req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { Host: `${host}:${port}` },
      agent: false,
      timeout: timeoutMs,
    })
    req.on('connect', (res, socket, head) => {
      connectMs = Date.now() - started
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`代理 CONNECT 失败: ${res.statusCode} ${res.statusMessage ?? ''}`))
        return
      }
      if (head && head.length) socket.unshift(head)
      const tlsStarted = Date.now()
      const tlsSocket = tls.connect({
        socket,
        servername,
        rejectUnauthorized,
        ALPNProtocols: ['http/1.1'],
      })
      tlsSocket.once('secureConnect', () => {
        resolve({ socket: tlsSocket, connectMs, tlsMs: Date.now() - tlsStarted })
      })
      tlsSocket.once('error', (err) => {
        socket.destroy()
        reject(Object.assign(err, { tls: describeTls(tlsSocket, err) }))
      })
    })
    req.on('timeout', () => { req.destroy(new Error(`代理连接超时 (${timeoutMs}ms)`)) })
    req.on('error', reject)
    req.end()
  })
}

/** 把已建立的隧道 socket 交给 node 的 http 客户端复用（避免自己写 HTTP 报文解析） */
function tunnelAgent(socket: tls.TLSSocket): http.Agent {
  const agent = new http.Agent({ keepAlive: false, maxSockets: 1 })
  // createConnection 是 node 内部约定回调，类型声明与实现签名不一致，这里显式改写
  const patched = agent as unknown as {
    createConnection: (options: unknown, callback: (err: Error | null, stream?: tls.TLSSocket) => void) => void
  }
  patched.createConnection = (_options, callback) => callback(null, socket)
  return agent
}

/** 发出单跳请求（不含重定向） */
function sendHop(o: HopOptions): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const { url, method, headers, body, proxy, isHttps } = o
    const started = Date.now()
    let connectMs = 0
    let tlsMs = 0
    let ttfbMs = 0
    let tlsInfo: TlsInfo | null = null
    let socketRef: net.Socket | null = null

    /** TLS 握手失败时 secureConnect 不触发，只能从 socket 现场取证 */
    const readTlsInfo = (s: tls.TLSSocket, err?: Error): TlsInfo | null => describeTls(s, err)

    const onSocket = (socket: net.Socket): void => {
      socketRef = socket
      if (connectMs === 0) connectMs = socket.connecting ? 0 : -1
      if (socket.connecting) socket.once('connect', () => { connectMs = Date.now() - started })
      else connectMs = Date.now() - started
      const s = socket as tls.TLSSocket
      if (typeof s.getPeerCertificate === 'function') {
        socket.once('secureConnect', () => {
          tlsMs = Date.now() - started - connectMs
          tlsInfo = readTlsInfo(s)
        })
      }
    }

    const finish = (req: http.ClientRequest) => {
      req.on('response', () => { ttfbMs = Date.now() - started })
      if (body && body.length) req.write(body)
      req.end()
    }

    const collect = (res: http.IncomingMessage) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => { chunks.push(c); size += c.length })
      res.on('end', () => {
        const headers: [string, string][] = []
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.push([res.rawHeaders[i], res.rawHeaders[i + 1]])
        resolve({
          status: res.statusCode ?? 0,
          statusText: statusTextOf(res.statusCode ?? 0, res.statusMessage),
          httpVersion: res.httpVersion,
          headers,
          body: Buffer.concat(chunks, size),
          timings: {
            connectMs: Math.max(connectMs, 0),
            tlsMs: Math.max(tlsMs, 0),
            ttfbMs: Math.max(ttfbMs - started, 0),
            totalMs: Date.now() - started,
          },
          remoteAddress: res.socket?.remoteAddress ?? '',
          tls: tlsInfo,
        })
      })
      res.on('error', reject)
    }

    const handleError = (err: Error & { code?: string }) => {
      const s = socketRef as tls.TLSSocket | null
      if (s && typeof s.getPeerCertificate === 'function' && !tlsInfo) tlsInfo = describeTls(s, err)
      reject(Object.assign(err, { tls: tlsInfo }))
    }

    if (proxy && !isHttps) {
      // 明文 http 经代理：请求行使用绝对 URI
      const headersWithHost = { ...headers }
      if (!Object.keys(headersWithHost).some((k) => k.toLowerCase() === 'host')) {
        headersWithHost.Host = url.host
      }
      const req = http.request({
        host: proxy.hostname,
        port: Number(proxy.port),
        method,
        path: url.href,
        headers: headersWithHost,
        agent: false,
        timeout: o.timeoutMs,
        setHost: false,
      })
      req.on('socket', onSocket)
      req.on('timeout', () => req.destroy(Object.assign(new Error(`请求超时 (${o.timeoutMs}ms)`), { code: 'ETIMEDOUT' })))
      req.on('error', handleError)
      req.on('response', collect)
      finish(req)
      return
    }

    if (proxy && isHttps) {
      // 密文 https 经代理：先 CONNECT 隧道，再在同一条 socket 上跑 HTTP/1.1
      openTunnel(proxy, url.hostname, Number(url.port || 443), url.hostname, o.rejectUnauthorized, o.timeoutMs)
        .then(({ socket, connectMs: cMs, tlsMs: tMs }) => {
          connectMs = cMs
          tlsMs = tMs
          tlsInfo = describeTls(socket)
          const req = http.request({
            host: url.hostname,
            port: Number(url.port || 443),
            method,
            path: url.pathname + url.search,
            headers,
            agent: tunnelAgent(socket),
            timeout: o.timeoutMs,
            setHost: true,
            createConnection: undefined,
          })
          req.on('timeout', () => req.destroy(Object.assign(new Error(`请求超时 (${o.timeoutMs}ms)`), { code: 'ETIMEDOUT' })))
          req.on('error', handleError)
          req.on('response', collect)
          finish(req)
        })
        .catch(handleError)
      return
    }

    const headersForDirect = { ...headers }
    const req = (isHttps ? https : http).request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: headersForDirect,
      agent: false,
      timeout: o.timeoutMs,
      rejectUnauthorized: o.rejectUnauthorized,
    })
    req.on('socket', onSocket)
    req.on('timeout', () => req.destroy(Object.assign(new Error(`请求超时 (${o.timeoutMs}ms)`), { code: 'ETIMEDOUT' })))
    req.on('error', handleError)
    req.on('response', collect)
    finish(req)
  })
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function headerValue(headers: [string, string][], name: string): string | null {
  const found = headers.find(([k]) => k.toLowerCase() === name)
  return found ? found[1] : null
}

/** 发出完整请求（含重定向处理） */
export async function performRequest(spec: HttpRequestSpec): Promise<HttpRequestResult> {
  const t0 = Date.now()
  const method0 = (spec.method || 'GET').toUpperCase()
  const timeoutMs = spec.timeoutMs && spec.timeoutMs > 0 ? spec.timeoutMs : 30_000
  const follow = spec.followRedirects !== false
  const maxRedirects = spec.maxRedirects ?? 10
  const rejectUnauthorized = spec.rejectUnauthorized !== false
  const passthrough = spec.passthrough === true
  const proxy = parseProxyUrl(spec.proxy)

  const base: HttpRequestResult = {
    ok: false,
    url: spec.url,
    method: method0,
    status: 0,
    statusText: '',
    httpVersion: '',
    headers: [],
    bodyBase64: '',
    bodyBytes: 0,
    rawBodyBase64: '',
    rawBytes: 0,
    contentEncoding: '',
    decompressed: false,
    truncated: false,
    timings: { connectMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: 0 },
    redirects: [],
    viaProxy: !!proxy,
    remoteAddress: '',
    tls: null,
  }

  let current: URL
  try {
    const raw = (spec.url || '').trim()
    current = new URL(raw.includes('://') ? raw : `http://${raw}`)
  } catch {
    return { ...base, error: `URL 无法解析: ${spec.url}`, errorCode: 'EBADURL', timings: { ...base.timings, totalMs: Date.now() - t0 } }
  }
  if (current.protocol !== 'http:' && current.protocol !== 'https:') {
    return { ...base, error: `仅支持 http/https，当前为 ${current.protocol}`, errorCode: 'EBADPROTOCOL' }
  }

  let method = method0
  let body = specBody(spec)
  const rawHeaderList: [string, string][] = (spec.headers ?? []).filter(([k]) => String(k ?? '').trim() !== '')
  const redirects: { status: number; location: string }[] = []

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const isHttps = current.protocol === 'https:'
    const headers = toHeaderObject(rawHeaderList)
    if (!passthrough) {
      if (body && body.length > 0) {
        if (!('Content-Length' in headers)) headers['Content-Length'] = String(body.length)
      } else if (method !== 'GET' && method !== 'HEAD' && !('Content-Length' in headers)) {
        headers['Content-Length'] = '0'
      }
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'connection')) headers.Connection = 'close'
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'accept-encoding')) {
        headers['Accept-Encoding'] = 'gzip, deflate, br'
      }
    }

    let res: HopResult
    try {
      res = await sendHop({
        url: current,
        method,
        headers,
        body,
        timeoutMs,
        rejectUnauthorized,
        proxy,
        passthrough,
        isHttps,
      })
    } catch (err) {
      const e = err as Error & { code?: string; tls?: TlsInfo | null }
      return {
        ...base,
        url: current.href,
        method,
        error: e.message,
        errorCode: e.code ?? '',
        tls: e.tls ?? null,
        redirects,
        timings: { ...base.timings, totalMs: Date.now() - t0 },
      }
    }

    if (follow && isRedirect(res.status) && hop < maxRedirects) {
      const loc = headerValue(res.headers, 'location')
      if (loc) {
        let next: URL
        try {
          next = new URL(loc, current)
        } catch {
          break
        }
        redirects.push({ status: res.status, location: next.href })
        // 303 一律改 GET；301/302 对 POST 按浏览器习惯改 GET；307/308 保留
        const downgrade = res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')
        if (downgrade) {
          method = 'GET'
          body = null
          for (let i = rawHeaderList.length - 1; i >= 0; i--) {
            const n = rawHeaderList[i][0].toLowerCase()
            if (n === 'content-length' || n === 'content-type' || n === 'transfer-encoding') rawHeaderList.splice(i, 1)
          }
        }
        current = next
        continue
      }
    }

    const enc = headerValue(res.headers, 'content-encoding') ?? ''
    const { body: decoded, decompressed } = decompressBody(res.body, enc)
    const shown = clip(decoded)
    const rawClip = clip(res.body)
    return {
      ok: true,
      url: current.href,
      method,
      status: res.status,
      statusText: res.statusText,
      httpVersion: res.httpVersion,
      headers: res.headers,
      bodyBase64: shown.buf.toString('base64'),
      bodyBytes: decoded.length,
      rawBodyBase64: rawClip.buf.toString('base64'),
      rawBytes: res.body.length,
      contentEncoding: enc,
      decompressed,
      truncated: shown.truncated || rawClip.truncated,
      timings: { ...res.timings, totalMs: Date.now() - t0 },
      redirects,
      viaProxy: !!proxy,
      remoteAddress: res.remoteAddress,
      tls: res.tls,
    }
  }

  return { ...base, url: current.href, error: `重定向次数超过上限 (${maxRedirects})`, errorCode: 'EMAXREDIRECT' }
}
