/**
 * 网络调试类 IPC：HTTP 请求发送、端口占用查询、TLS 探测、SSE / WebSocket 调试。
 * 这几个工具彼此独立，但同属「对远端做一次性探测/联调」的域，收在一个注册入口里。
 */
import { ipcMain } from 'electron'
import { performRequest } from './http'
import { probeTls } from './tls-probe'
import { lookupPort } from './portlookup'
import { startSse, abortSse } from './sse-client'
import { connectWs, sendWs, closeWs } from './ws-client'
import type { TlsProbe } from '../../src/lib/tls-types'
import type { SseSendSpec } from '../../src/lib/sse-types'
import type { WsSendSpec } from '../../src/lib/ws-types'
import type { HttpRequestSpec, HttpRequestResult } from '../../src/lib/http-types'
import type { PortLookupResult } from '../../src/lib/portlookup-types'

export function setupNetIpc(): void {
  ipcMain.handle('http:send', async (_e, spec: HttpRequestSpec): Promise<HttpRequestResult> => {
    return performRequest(spec)
  })

  /* ================= 端口占用查询 ================= */

  ipcMain.handle('port:lookup', async (_e, port: number): Promise<PortLookupResult> => {
    try {
      return await lookupPort(Number(port))
    } catch (err) {
      return {
        ok: false,
        port: Number(port) || 0,
        entries: [],
        command: '',
        error: (err as Error).message,
      }
    }
  })

  /* ================= TLS 探测 ================= */

  ipcMain.handle('tls:probe', async (_e, host: string, port: number, timeoutMs: number) => {
    // 探测本身不会抛（连接失败也返回结构化结果），这里只兜住极端情况
    try {
      return await probeTls(String(host ?? ''), Number(port) || 0, Number(timeoutMs) || 10000)
    } catch (err) {
      return {
        ok: false,
        errorCode: 'PROBE_FAILED',
        errorDetail: (err as Error).message,
        host: String(host ?? ''),
        port: Number(port) || 0,
        protocol: '',
        cipher: '',
        cipherName: '',
        cipherSuiteName: '',
        alpn: '',
        sni: '',
        certs: [],
        elapsedMs: 0,
        authorized: false,
        authorizationError: '',
        isIpHost: false,
      } satisfies TlsProbe
    }
  })

  /* ================= SSE 调试 ================= */

  ipcMain.handle('sse:send', (e, spec: SseSendSpec): void => {
    const { sender } = e
    startSse(spec, (evt) => {
      if (!sender.isDestroyed()) sender.send('sse:event', evt)
    })
  })
  ipcMain.handle('sse:abort', (_e, id: string): void => {
    abortSse(id)
  })

  /* ================= WebSocket 调试 ================= */

  ipcMain.handle('ws:connect', (e, spec: WsSendSpec): void => {
    const { sender } = e
    connectWs(spec, (evt) => {
      if (!sender.isDestroyed()) sender.send('ws:event', evt)
    })
  })
  ipcMain.handle('ws:send', (_e, id: string, data: string): { ok: boolean; error?: string } => {
    return sendWs(id, data)
  })
  ipcMain.handle('ws:close', (_e, id: string, code?: number, reason?: string): void => {
    closeWs(id, code, reason)
  })
}
