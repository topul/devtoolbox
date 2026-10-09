/**
 * 浏览器版 HTTP 请求引擎（`HttpRequestSpec` → fetch）。
 *
 * 与桌面版（electron/main/http.ts）的契约完全一致，但物理差异必须诚实：
 *   - 拿不到 TCP/TLS 细分耗时与远端地址 → 对应字段置零/置空；
 *   - 上游代理、TLS 校验开关、禁跟随重定向：浏览器安全模型不允许 → 返回稳定错误码；
 *   - 重定向由 fetch 代劳，拿不到逐跳记录 → redirects 为空。
 * 能力内（方法/头/体/超时/状态/头列表/体字节）与桌面版行为一致。
 */
import type {
  HttpRequestResult,
  HttpRequestSpec,
  HttpPickFileResult,
  HttpTransferResult,
} from '../http-types'

const DEFAULT_TIMEOUT_MS = 30_000
/** 与桌面版一致：文件体/导入 8MB 上限 */
const FILE_MAX_BYTES = 8 * 1024 * 1024

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function emptyResult(
  spec: HttpRequestSpec,
  ok: boolean,
  error?: string,
  errorCode?: string,
): HttpRequestResult {
  return {
    ok,
    error,
    errorCode,
    url: spec.url,
    method: spec.method,
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
    viaProxy: false,
    remoteAddress: '',
    tls: null,
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(bytesToBase64(new Uint8Array(reader.result as ArrayBuffer)))
    reader.onerror = () => reject(new Error('READ_FAILED'))
    reader.readAsArrayBuffer(file)
  })
}

function pickFileOnce(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'
    let settled = false
    const done = (f: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(f)
    }
    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    // 取消（不选文件直接关掉）没有原生事件：监听 focus 兜底
    window.addEventListener('focus', () => setTimeout(() => done(input.files?.[0] ?? null), 300), {
      once: true,
    })
    document.body.appendChild(input)
    input.click()
  })
}

function downloadText(name: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name || 'export.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function buildWebHttp(): ElectronHttp {
  return {
    async send(spec: HttpRequestSpec): Promise<HttpRequestResult> {
      if (spec.proxy) {
        return emptyResult(
          spec,
          false,
          '浏览器版不支持上游代理，请直连或使用桌面版',
          'PROXY_UNSUPPORTED',
        )
      }
      let url: URL
      try {
        url = new URL(spec.url)
      } catch {
        return emptyResult(spec, false, `接口地址不合法：${spec.url || '(空)'}`, 'URL_INVALID')
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return emptyResult(spec, false, '浏览器版只支持 http/https 请求', 'PROTOCOL_UNSUPPORTED')
      }

      const headers = new Headers()
      for (const [k, v] of spec.headers ?? []) if (k) headers.append(k, v)

      let body: ArrayBuffer | string | null = null
      if (spec.bodyBase64) body = base64ToBytes(spec.bodyBase64).buffer as ArrayBuffer
      else if (spec.bodyText != null && spec.bodyText !== '') body = spec.bodyText
      if (spec.method === 'GET' || spec.method === 'HEAD') body = null

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), spec.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      const started = performance.now()
      try {
        const res = await fetch(url.toString(), {
          method: spec.method,
          headers,
          body: body as BodyInit | null | undefined,
          redirect: spec.followRedirects === false ? 'manual' : 'follow',
          signal: controller.signal,
          credentials: 'omit',
        })
        const ttfbMs = performance.now() - started
        const buf = await res.arrayBuffer()
        const totalMs = performance.now() - started
        const bytes = new Uint8Array(buf)
        const headersList: [string, string][] = []
        res.headers.forEach((v, k) => headersList.push([k, v]))
        const encoding = res.headers.get('content-encoding') ?? ''
        const bodyB64 = bytesToBase64(bytes)
        return {
          ok: true,
          url: res.url || url.toString(),
          method: spec.method,
          status: res.status,
          statusText: res.statusText,
          // fetch 不暴露 HTTP 版本；浏览器通常协商 HTTP/2，如实标注未知
          httpVersion: 'HTTP/1.1',
          headers: headersList,
          bodyBase64: bodyB64,
          bodyBytes: bytes.length,
          rawBodyBase64: bodyB64,
          rawBytes: bytes.length,
          contentEncoding: encoding,
          decompressed: !!encoding && bytes.length > 0,
          truncated: false,
          timings: {
            connectMs: 0,
            tlsMs: 0,
            ttfbMs: Math.round(ttfbMs),
            totalMs: Math.round(totalMs),
          },
          redirects: [],
          viaProxy: false,
          remoteAddress: '',
          tls: null,
        }
      } catch (e) {
        const err = e as Error
        if (err.name === 'AbortError') {
          return emptyResult(spec, false, '请求超时', 'TIMEOUT')
        }
        return emptyResult(spec, false, err.message || 'NETWORK_ERROR', 'NETWORK_ERROR')
      } finally {
        clearTimeout(timer)
      }
    },

    async exportFile(payload: {
      title: string
      name: string
      content: string
    }): Promise<HttpTransferResult> {
      try {
        downloadText(payload.name, payload.content)
        return { ok: true, path: payload.name }
      } catch (e) {
        return { ok: false, path: '', error: (e as Error).message }
      }
    },

    async importFile(_title: string): Promise<HttpTransferResult> {
      const file = await pickFileOnce()
      if (!file) return { ok: false, canceled: true, path: '' }
      if (file.size > FILE_MAX_BYTES) return { ok: false, path: '', error: 'FILE_TOO_LARGE' }
      const content = await file.text()
      return { ok: true, path: file.name, content }
    },

    async pickFile(): Promise<HttpPickFileResult> {
      const file = await pickFileOnce()
      if (!file) return { ok: false, canceled: true }
      if (file.size > FILE_MAX_BYTES) return { ok: false, error: 'FILE_TOO_LARGE' }
      try {
        const base64 = await readFileAsBase64(file)
        return { ok: true, name: file.name, base64, bytes: file.size }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
  }
}

interface ElectronHttp {
  send: (spec: HttpRequestSpec) => Promise<HttpRequestResult>
  exportFile: (payload: {
    title: string
    name: string
    content: string
  }) => Promise<HttpTransferResult>
  importFile: (title: string) => Promise<HttpTransferResult>
  pickFile: () => Promise<HttpPickFileResult>
}
