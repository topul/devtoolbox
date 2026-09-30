/**
 * WebSocket 调试的主进程客户端：用 Node 22+ 内置的全局 WebSocket（undici 实现），零依赖。
 *
 * 限制：自定义头走 undici 的非标准 headers 选项，构造失败时降级为无头连接并回报错误；
 * 二进制入站消息不落地（只报字节数），v1 聚焦文本帧调试。
 */
import type { WsSendSpec, WsEventFrame } from '../../src/lib/ws-types'

/** 全局 WebSocket 的 undici 扩展构造签名（headers 选项） */
type WsCtor = new (url: string | URL, opts?: { headers?: Record<string, string> }) => WebSocket

const sockets = new Map<string, WebSocket>()

export function connectWs(spec: WsSendSpec, push: (evt: WsEventFrame) => void): void {
  closeWs(spec.id) // 同 id 重连先断旧连接

  let url: URL
  try {
    url = new URL(spec.url)
  } catch {
    push({ id: spec.id, kind: 'error', error: `URL 无法解析: ${spec.url}` })
    push({ id: spec.id, kind: 'close', code: 0, reason: '' })
    return
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    push({ id: spec.id, kind: 'error', error: `仅支持 ws/wss 协议，当前为 ${url.protocol}` })
    push({ id: spec.id, kind: 'close', code: 0, reason: '' })
    return
  }

  let ws: WebSocket
  try {
    const Ctor = WebSocket as WsCtor
    ws = spec.headers?.length
      ? new Ctor(url, { headers: Object.fromEntries(spec.headers) })
      : new WebSocket(url)
  } catch (err) {
    push({ id: spec.id, kind: 'error', error: (err as Error).message })
    push({ id: spec.id, kind: 'close', code: 0, reason: '' })
    return
  }

  sockets.set(spec.id, ws)

  ws.onopen = () => {
    push({ id: spec.id, kind: 'open', protocol: ws.protocol || undefined })
  }
  ws.onmessage = (e) => {
    const data = e.data as string | ArrayBuffer | Blob
    if (typeof data === 'string') {
      push({ id: spec.id, kind: 'message', dir: 'in', data })
    } else {
      // 二进制帧：不落地，报字节数让用户知道有东西进来
      const size = data instanceof ArrayBuffer ? data.byteLength : (data as Blob).size
      push({ id: spec.id, kind: 'message', dir: 'in', data: `[binary ${size} bytes]` })
    }
  }
  ws.onerror = () => {
    // undici 的 error 事件不带可读 message，连不上时 onclose 会给 code
    push({ id: spec.id, kind: 'error', error: 'WebSocket 连接失败（检查 URL、网络或握手头）' })
  }
  ws.onclose = (e) => {
    sockets.delete(spec.id)
    push({ id: spec.id, kind: 'close', code: e.code, reason: e.reason })
  }
}

export function sendWs(id: string, data: string): { ok: boolean; error?: string } {
  const ws = sockets.get(id)
  if (!ws) return { ok: false, error: 'NOT_CONNECTED' }
  if (ws.readyState !== WebSocket.OPEN) return { ok: false, error: 'NOT_OPEN' }
  try {
    ws.send(data)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function closeWs(id: string, code?: number, reason?: string): void {
  const ws = sockets.get(id)
  if (!ws) return
  sockets.delete(id)
  try {
    ws.close(code ?? 1000, reason ?? '')
  } catch {
    /* 已处于 CLOSING/CLOSED，无需处理 */
  }
}

export function closeAllWs(): void {
  for (const [id] of sockets) closeWs(id)
}
