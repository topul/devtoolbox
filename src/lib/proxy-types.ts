/**
 * 抓包代理的类型契约 —— 主进程与渲染进程共用。
 *
 * 主进程侧 `electron/main/proxy/*` 通过 `import type` 引入，编译后不产生运行时代码。
 * 改动这里等于改 IPC 协议，两端需同步。
 */

/** 头部改写动作 */
export interface HeaderOp {
  action: 'set' | 'add' | 'remove'
  name: string
  value?: string
}

export interface MockResponse {
  status: number
  headers: [string, string][]
  bodyText?: string
  bodyBase64?: string
}

/** 一条拦截规则；字段为空表示不参与该维度 */
export interface ProxyRule {
  id: string
  name: string
  enabled: boolean
  /** 'ANY' 或具体方法 */
  method: string
  /** 主机 glob，支持 * 与 ?，空=任意 */
  host: string
  /** 路径 glob，空=任意 */
  path: string
  scheme: 'any' | 'http' | 'https'
  /* ---- 请求阶段 ---- */
  /** 断点：命中后暂停，等待界面放行 */
  breakpoint: boolean
  /** 命中后延迟多少毫秒再转发 */
  delayMs: number
  /** 直接阻断，不下发上游 */
  block: boolean
  /** 直接返回伪造响应（优先级高于 block 之外的一切转发行为） */
  mock?: MockResponse | null
  reqHeaderOps: HeaderOp[]
  /** 请求体查找替换（文本） */
  reqBodyFind?: string
  reqBodyReplace?: string
  reqBodyRegex?: boolean
  /* ---- 响应阶段 ---- */
  resHeaderOps: HeaderOp[]
  resBodyFind?: string
  resBodyReplace?: string
  resBodyRegex?: boolean
}

export interface ProxySession {
  id: string
  seq: number
  startedAt: number
  /** http / https；tunnel 表示仅做了 CONNECT 隧道（未解密） */
  scheme: 'http' | 'https' | 'tunnel'
  method: string
  url: string
  host: string
  path: string
  reqHeaders: [string, string][]
  reqBodyBase64: string
  reqBodyBytes: number
  status: number | null
  statusText: string
  resHeaders: [string, string][]
  resBodyBase64: string
  resBodyBytes: number
  resContentEncoding: string
  resTruncated: boolean
  durationMs: number
  clientIp: string
  matchedRules: string[]
  modified: boolean
  intercepted: boolean
  mocked: boolean
  blocked: boolean
  tunneled: boolean
  /** 真实失败原因 */
  error?: string
  /** 流程性提示（如证书降级放行、隧道未解密），不是错误 */
  note?: string
}

export interface ProxyState {
  running: boolean
  port: number
  mitm: boolean
  sessionCount: number
  /** 无 MITM 时 CONNECT 只能盲隧道，正文不可见 */
  caReady: boolean
  caInfo: CaInfo | null
  systemProxy: SystemProxyState
  lastError?: string
}

export interface CaInfo {
  dir: string
  certPath: string
  keyPath: string
  certPem: string
  subject: string
  organization: string
  validFrom: string
  validTo: string
  fingerprintSha256: string
  createdAt: string
}

export interface SystemProxyState {
  enabled: boolean
  server: string
  supported: boolean
  /** 我们是否改写过系统设置（用于还原） */
  managed: boolean
  detail: string
}

/** 断点暂停时下发给界面的待编辑请求 */
export interface InterceptRequest {
  id: string
  method: string
  url: string
  host: string
  headers: [string, string][]
  bodyBase64: string
  ruleName: string
  clientIp: string
  receivedAt: number
}

/** 界面回传的处置结果 */
export interface InterceptDecision {
  action: 'forward' | 'drop'
  method?: string
  url?: string
  headers?: [string, string][]
  bodyBase64?: string
  mock?: MockResponse | null
}

export interface ProxyStartOptions {
  port: number
  mitm: boolean
}

/** 主进程 → 渲染进程的抓包事件 */
export type ProxyEvent =
  | { type: 'session'; session: ProxySession; phase: 'request' | 'complete' }
  | { type: 'intercept'; request: InterceptRequest }
  | { type: 'intercept-resolved'; id: string; auto?: boolean }
  | { type: 'state'; state: ProxyState }
  | { type: 'error'; message: string }
