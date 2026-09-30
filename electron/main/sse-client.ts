/**
 * SSE 调试的主进程客户端：node:http/https 发起请求，逐 chunk 解析帧后推给渲染层。
 *
 * 为什么在主进程：渲染层 CSP 限制 connect-src 'self'，外部请求只能走主进程（与 http:send 同理）。
 */
import http from 'node:http'
import https from 'node:https'
import { SseDecoder } from '../../src/lib/sse-parser'
import type { SseSendSpec, SseEventFrame } from '../../src/lib/sse-types'

/** 活跃连接：id → 请求对象，abort 用 */
const active = new Map<string, http.ClientRequest>()

export function startSse(
  spec: SseSendSpec,
  push: (evt: SseEventFrame) => void,
): void {
  abortSse(spec.id) // 同 id 重连先断旧连接，避免双流

  let url: URL
  try {
    url = new URL(spec.url)
  } catch {
    push({ id: spec.id, kind: 'error', error: `URL 无法解析: ${spec.url}` })
    push({ id: spec.id, kind: 'close', reason: 'error' })
    return
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    push({ id: spec.id, kind: 'error', error: `仅支持 http/https，当前为 ${url.protocol}` })
    push({ id: spec.id, kind: 'close', reason: 'error' })
    return
  }

  const headers: Record<string, string> = {
    accept: 'text/event-stream',
    // SSE 不压缩：gzip 会把帧边界藏进步里，逐 chunk 解析会乱
    'accept-encoding': 'identity',
    'cache-control': 'no-cache',
    ...(Object.fromEntries(spec.headers ?? [])),
  }
  const mod = url.protocol === 'https:' ? https : http
  const req = mod.request(url, { method: spec.method ?? 'GET', headers })
  active.set(spec.id, req)

  const closeWith = (reason: 'ended' | 'aborted' | 'error'): void => {
    if (!active.has(spec.id)) return // 已关过（abort 与 error 竞态时只发一次 close）
    active.delete(spec.id)
    push({ id: spec.id, kind: 'close', reason })
  }

  req.on('timeout', () => {
    req.destroy(new Error('连接超时'))
  })

  req.on('error', (err) => {
    push({ id: spec.id, kind: 'error', error: (err as Error).message })
    closeWith('error')
  })

  req.on('response', (res) => {
    push({ id: spec.id, kind: 'open', status: res.statusCode ?? 0 })
    const decoder = new SseDecoder()
    res.on('data', (chunk: Buffer) => {
      for (const frame of decoder.push(chunk.toString('utf8'))) {
        push({ id: spec.id, kind: 'frame', frame: { event: frame.event, data: frame.data, id: frame.id, retry: frame.retry } })
      }
    })
    res.on('end', () => {
      for (const frame of decoder.end()) {
        push({ id: spec.id, kind: 'frame', frame: { event: frame.event, data: frame.data, id: frame.id, retry: frame.retry } })
      }
      closeWith('ended')
    })
    res.on('error', (err) => {
      push({ id: spec.id, kind: 'error', error: (err as Error).message })
      closeWith('error')
    })
  })

  req.end()
}

export function abortSse(id: string): void {
  const req = active.get(id)
  if (!req) return
  active.delete(id)
  req.destroy()
}
