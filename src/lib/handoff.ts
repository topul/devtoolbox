/**
 * 请求交接总线 —— 抓包 / HTTP 客户端 / 各分析器之间的「内存传送带」。
 *
 * 为什么需要它：这些工具过去只通过剪贴板连接，看一条抓包要复制 raw、挑响应头、
 * 再粘到三四个工具里。交接总线让「发送到 →」在内存里直达，零粘贴。
 *
 * 安全与生命周期约定（务必遵守）：
 *   - **纯内存，绝不落盘**。载荷里常有 Cookie / Authorization，写入 localStorage
 *     会违背项目「敏感数据不持久化」的红线；刷新 / 重启即清空；
 *   - 按目标工具分槽的小队列（有容量上限与 TTL），发送方 push 后跳转 hash，
 *     接收方挂载时 drain 一次；
 *   - 适配函数全部是纯函数（raw 重建、hop-by-hop 过滤、CORS/CSP 提取），
 *     便于在 Vitest 里断言；本文件不 import React、不碰 DOM。
 */
import type { RequestDoc } from './http-codegen'

export type HandoffTarget =
  | 'http-client'
  | 'httpreq'
  | 'reqdiff-a'
  | 'reqdiff-b'
  | 'corsaudit'
  | 'cspaudit'
  | 'smuggling'
  | 'header-audit'

/** 一份在工具间流转的请求快照（字段尽量可选，发送方有什么给什么） */
export interface HandoffPayload {
  /** 人类可读来源，如「#12 POST /api/login」；语言中立，界面自行拼前缀 */
  sourceLabel: string
  method?: string
  url?: string
  reqHeaders?: [string, string][]
  /** 文本正文；二进制请求给 null（接收方自行降级，不伪造乱码） */
  reqBodyText?: string | null
  /** 请求体是二进制、未以文本交接（接收方提示用户） */
  reqBodyBinary?: boolean
  /** 规范原始请求文本（请求行 + CRLF 头 + 空行 + body） */
  rawRequest?: string
  resStatus?: number | null
  resHeaders?: [string, string][]
  /** 重放时走的代理（抓包重放默认经原代理端口，可观测新请求） */
  proxy?: string | null
}

export interface HandoffEnvelope extends HandoffPayload {
  id: number
  at: number
}

/* ============================== 纯适配函数 ============================== */

/**
 * 重放时必须丢弃的逐跳头 / 与连接绑定的头：
 * HTTP 客户端内核会自己管理 Host / Content-Length / 压缩 / 代理语义，
 * 原样带上容易造成重复头、错误长度或协议异常。
 */
export const HOP_BY_HOP =
  /^(host|content-length|connection|proxy-connection|keep-alive|transfer-encoding|upgrade|te|trailer|accept-encoding)$/i

export function filterReplayHeaders(headers: [string, string][]): [string, string][] {
  return headers.filter(([k]) => !HOP_BY_HOP.test(k))
}

/** 由结构化字段重建原始 HTTP 请求文本（httpreq / reqdiff 的输入） */
export function buildRawRequest(input: {
  method: string
  /** request target：origin-form 路径或绝对 URL */
  target: string
  headers: [string, string][]
  bodyText?: string | null
}): string {
  const head = [`${input.method} ${input.target} HTTP/1.1`]
  for (const [k, v] of input.headers) head.push(`${k}: ${v}`)
  return head.join('\r\n') + '\r\n\r\n' + (input.bodyText ?? '')
}

function headerOf(headers: [string, string][] | undefined, name: string): string | null {
  if (!headers) return null
  const hit = headers.find(([k]) => k.toLowerCase() === name.toLowerCase())
  return hit ? hit[1] : null
}

/** 优先用现成 raw，缺则按字段拼 */
export function handoffToRaw(p: HandoffPayload): string {
  if (p.rawRequest) return p.rawRequest
  if (!p.method || !p.url) return ''
  let target = p.url
  try {
    const u = new URL(p.url)
    target = u.pathname + u.search
  } catch {
    /* 非绝对 URL 就原样当 target */
  }
  return buildRawRequest({
    method: (p.method ?? 'GET').toUpperCase(),
    target,
    headers: p.reqHeaders ?? [],
    bodyText: p.reqBodyText ?? '',
  })
}

/** 转成 HTTP 客户端的 RequestDoc（过滤逐跳头；重放不跟随跳转、不校验 TLS） */
export function handoffToDoc(p: HandoffPayload): RequestDoc {
  return {
    method: (p.method ?? 'GET').toUpperCase(),
    url: p.url ?? '',
    headers: filterReplayHeaders(p.reqHeaders ?? []),
    body: p.reqBodyText ? { kind: 'text', text: p.reqBodyText } : { kind: 'none' },
    followRedirects: false,
    verifyTls: false,
    proxy: p.proxy ?? null,
  }
}

/**
 * CORS 分析器的输入：请求 Origin（没有就留空让用户补）+ 响应头块。
 * parseHeaderBlock 只按 `名: 值` 解析，状态行可有可无，这里带上更贴近真实。
 */
export function handoffToCorsBlock(p: HandoffPayload): { origin: string; block: string } {
  const origin = headerOf(p.reqHeaders, 'origin') ?? ''
  const lines: string[] = []
  if (p.resStatus) lines.push(`HTTP/1.1 ${p.resStatus}`)
  for (const [k, v] of p.resHeaders ?? []) lines.push(`${k}: ${v}`)
  return { origin, block: lines.join('\r\n') }
}

/** 提取 Content-Security-Policy 头值；多条（报告专用 -Report-Only 也算）逗号合并 */
export function handoffToCsp(p: HandoffPayload): string | null {
  const vals = (p.resHeaders ?? [])
    .filter(([k]) => /^content-security-policy(-report-only)?$/i.test(k))
    .map(([, v]) => v.trim())
    .filter(Boolean)
  return vals.length ? vals.join(', ') : null
}

/** 走私实验台只需要 host（含非默认端口）与入口路径 */
export function handoffToHostPath(p: HandoffPayload): { host: string; path: string } | null {
  if (!p.url) return null
  try {
    const u = new URL(p.url)
    const port =
      (u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')
        ? ''
        : u.port
    return { host: u.hostname + (port ? `:${port}` : ''), path: u.pathname || '/' }
  } catch {
    return null
  }
}

/* ============================== 总线工厂 ============================== */

export interface HandoffBus {
  push: (target: HandoffTarget, payload: HandoffPayload) => HandoffEnvelope
  /** 取出并移除该槽最早一条（过期返回 null） */
  take: (target: HandoffTarget) => HandoffEnvelope | null
  pending: (target: HandoffTarget) => boolean
  clear: (target?: HandoffTarget) => void
  subscribe: (fn: () => void) => () => void
}

export function createHandoffBus(opts?: {
  ttlMs?: number
  capPerTarget?: number
  now?: () => number
}): HandoffBus {
  const ttlMs = opts?.ttlMs ?? 30 * 60 * 1000
  const cap = opts?.capPerTarget ?? 20
  const now = opts?.now ?? Date.now
  const queues = new Map<HandoffTarget, HandoffEnvelope[]>()
  const listeners = new Set<() => void>()
  let seq = 0

  const prune = (target: HandoffTarget): HandoffEnvelope[] => {
    const q = queues.get(target)
    if (!q) return []
    const fresh = q.filter((e) => now() - e.at <= ttlMs)
    // 没有过期项时必须返回原数组——take 的 shift 要改到存储里的同一个引用
    if (fresh.length === q.length) return q
    queues.set(target, fresh)
    return fresh
  }

  return {
    push(target, payload) {
      const env: HandoffEnvelope = { ...payload, id: ++seq, at: now() }
      const q = prune(target)
      q.push(env)
      // 超出容量丢最旧的（交接是即时动作，堆积没有意义）
      queues.set(target, q.length > cap ? q.slice(q.length - cap) : q)
      listeners.forEach((fn) => fn())
      return env
    },
    take(target) {
      return prune(target).shift() ?? null
    },
    pending(target) {
      return prune(target).length > 0
    },
    clear(target) {
      if (target) queues.delete(target)
      else queues.clear()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

/** 应用级单例：纯内存，页面刷新即销毁 */
export const handoffBus = createHandoffBus()
