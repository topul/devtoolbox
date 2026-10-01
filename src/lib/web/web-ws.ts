/**
 * 浏览器版 WebSocket 引擎（`WsAPI` 契约的原生 WebSocket 实现）。
 *
 * 已知物理差异（诚实降级）：
 *   - 浏览器 WebSocket 不支持自定义请求头（桌面版 undici 可以）→ headers 忽略；
 *   - 二进制帧 v1 契约不支持 → 收到二进制帧时按 UTF-8 尝试解码，失败则丢弃。
 */
import type { WsAPI, WsEventFrame, WsSendSpec } from '../ws-types'

interface Conn {
  ws: WebSocket
}

export function buildWebWs(): WsAPI {
  const conns = new Map<string, Conn>()
  const listeners = new Set<(evt: WsEventFrame) => void>()

  const emit = (evt: WsEventFrame): void => {
    for (const l of listeners) {
      try {
        l(evt)
      } catch {
        /* 监听者异常不拖垮连接 */
      }
    }
  }

  return {
    async connect(spec: WsSendSpec): Promise<void> {
      if (conns.has(spec.id)) return
      const { id } = spec
      let ws: WebSocket
      try {
        ws = new WebSocket(spec.url)
      } catch (e) {
        emit({ id, kind: 'error', error: (e as Error).message || 'URL_INVALID' })
        emit({ id, kind: 'close', code: -1, reason: 'connect failed' })
        return
      }
      conns.set(id, { ws })

      ws.onopen = () => emit({ id, kind: 'open', ...(ws.protocol ? { protocol: ws.protocol } : {}) })
      ws.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === 'string') {
          emit({ id, kind: 'message', dir: 'in', data: ev.data })
          return
        }
        // 二进制帧：尽力转成文本（契约 v1 只有文本帧）
        const blob = ev.data as Blob
        void blob.text().then((text) => {
          emit({ id, kind: 'message', dir: 'in', data: text })
        }).catch(() => undefined)
      }
      ws.onerror = () => {
        // onclose 一定跟着来，这里只报错误不重复收场
        emit({ id, kind: 'error', error: '连接失败（浏览器可能拦截了不安全的 ws:// 或跨源）' })
      }
      ws.onclose = (ev: CloseEvent) => {
        conns.delete(id)
        emit({ id, kind: 'close', code: ev.code, reason: ev.reason || '' })
      }
    },

    async send(id: string, data: string): Promise<{ ok: boolean; error?: string }> {
      const conn = conns.get(id)
      if (!conn) return { ok: false, error: 'NOT_CONNECTED' }
      if (conn.ws.readyState !== WebSocket.OPEN) return { ok: false, error: 'NOT_OPEN' }
      conn.ws.send(data)
      emit({ id, kind: 'message', dir: 'out', data })
      return { ok: true }
    },

    async close(id: string, code?: number, reason?: string): Promise<void> {
      const conn = conns.get(id)
      if (!conn) return
      try {
        conn.ws.close(code ?? 1000, reason ?? '')
      } catch {
        /* 已关 */
      }
      conns.delete(id)
    },

    onEvent(cb: (evt: WsEventFrame) => void): () => void {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
