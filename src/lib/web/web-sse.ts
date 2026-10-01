/**
 * 浏览器版 SSE 引擎（`SseAPI` 契约的 fetch 实现）。
 *
 * 用 fetch + ReadableStream 而不是 EventSource：桌面版支持 POST 与自定义头，
 * 契约不能在浏览器端偷偷变窄。帧解析直接复用 `sse-parser.ts` 的有状态解码器 ——
 * 与桌面主进程同一份实现，解析行为不可能两样。
 */
import { SseDecoder } from '../sse-parser'
import type { SseAPI, SseEventFrame, SseSendSpec } from '../sse-types'

interface Conn {
  controller: AbortController
  decoder: SseDecoder
}

export function buildWebSse(): SseAPI {
  const conns = new Map<string, Conn>()
  const listeners = new Set<(evt: SseEventFrame) => void>()

  const emit = (evt: SseEventFrame): void => {
    for (const l of listeners) {
      try {
        l(evt)
      } catch {
        /* 监听者异常不拖垮连接 */
      }
    }
  }

  return {
    async send(spec: SseSendSpec): Promise<void> {
      const { id } = spec
      if (conns.has(id)) return

      const controller = new AbortController()
      const conn: Conn = { controller, decoder: new SseDecoder() }
      conns.set(id, conn)

      void (async () => {
        try {
          const headers = new Headers()
          for (const [k, v] of spec.headers ?? []) if (k) headers.append(k, v)
          const method = spec.method === 'POST' ? 'POST' : 'GET'
          const res = await fetch(spec.url, {
            method,
            headers,
            signal: controller.signal,
            credentials: 'omit',
          })
          emit({ id, kind: 'open', status: res.status })
          if (!res.ok || !res.body) {
            // 与桌面版一致：非 2xx 打开失败，收掉
            conns.delete(id)
            emit({ id, kind: 'error', error: `HTTP ${res.status}` })
            emit({ id, kind: 'close', reason: 'error' })
            return
          }
          const reader = res.body.getReader()
          const td = new TextDecoder()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            for (const frame of conn.decoder.push(td.decode(value, { stream: true }))) {
              emit({
                id,
                kind: 'frame',
                frame: { event: frame.event, data: frame.data, ...(frame.id ? { id: frame.id } : {}), ...(frame.retry !== undefined ? { retry: frame.retry } : {}) },
              })
            }
          }
          for (const frame of conn.decoder.end()) {
            emit({
              id,
              kind: 'frame',
              frame: { event: frame.event, data: frame.data, ...(frame.id ? { id: frame.id } : {}), ...(frame.retry !== undefined ? { retry: frame.retry } : {}) },
            })
          }
          conns.delete(id)
          emit({ id, kind: 'close', reason: 'ended' })
        } catch (e) {
          const err = e as Error
          const aborted = err.name === 'AbortError'
          conns.delete(id)
          if (!aborted) emit({ id, kind: 'error', error: err.message || 'NETWORK_ERROR' })
          emit({ id, kind: 'close', reason: aborted ? 'aborted' : 'error' })
        }
      })()
    },

    async abort(id: string): Promise<void> {
      conns.get(id)?.controller.abort()
      conns.delete(id)
    },

    onEvent(cb: (evt: SseEventFrame) => void): () => void {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
