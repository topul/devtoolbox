/**
 * HTTP 请求引擎的类型契约 —— 主进程与渲染进程共用。
 *
 * 主进程侧 `electron/main/http.ts` 通过 `import type` 引入，编译后不产生任何运行时代码；
 * 渲染进程侧直接引入用于界面状态标注。改动这里等于改 IPC 协议，两端需同步。
 */

export interface HttpRequestSpec {
  method: string
  url: string
  /** 有序头列表，允许重名 */
  headers?: [string, string][]
  /** 文本体（UTF-8） */
  bodyText?: string | null
  /** 原始字节体（Base64），与 bodyText 二选一，本字段优先 */
  bodyBase64?: string | null
  timeoutMs?: number
  followRedirects?: boolean
  maxRedirects?: number
  rejectUnauthorized?: boolean
  /** 上游代理，如 http://127.0.0.1:8899；空表示直连 */
  proxy?: string | null
  /** 抓包代理转发模式：尽量按原样透传头，不补 Host / Connection */
  passthrough?: boolean
}

export interface HttpTimings {
  /** TCP 连接耗时（含 DNS） */
  connectMs: number
  /** TLS 握手耗时 */
  tlsMs: number
  /** 首个响应字节耗时（自本次请求发出算起） */
  ttfbMs: number
  /** 全流程耗时（含重定向） */
  totalMs: number
}

export interface TlsInfo {
  protocol: string
  cipher: string
  authorized: boolean
  authorizationError: string | null
  subject: string
  issuer: string
  validTo: string
}

export interface HttpRequestResult {
  ok: boolean
  error?: string
  errorCode?: string
  url: string
  method: string
  status: number
  statusText: string
  httpVersion: string
  /** 响应头，按原始顺序、保留重复项 */
  headers: [string, string][]
  /** 展示用响应体：已解压（Base64） */
  bodyBase64: string
  bodyBytes: number
  /** 上游实际下发的原始字节（未解压，Base64），抓包代理转发用 */
  rawBodyBase64: string
  rawBytes: number
  contentEncoding: string
  decompressed: boolean
  truncated: boolean
  timings: HttpTimings
  redirects: { status: number; location: string }[]
  viaProxy: boolean
  remoteAddress: string
  tls: TlsInfo | null
}
