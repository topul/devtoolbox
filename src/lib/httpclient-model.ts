/**
 * HTTP 客户端工具的表单模型：类型、常量与「表单 ↔ 中立文档」互转纯函数。
 *
 * 从 src/tools/httpclient.tsx 拆出：组装规则（认证头合并、正文类型推断、
 * curl 导入回填、环境变量插值）是纯数据转换，脱离 React 才能单独验证，
 * 组件层只负责状态编排。
 */
import type { Row } from '../components/http/KVEditor'
import { httpClientL } from './locales/httpclient'
import { applyEnvVars, mergeMissing, type EnvApplyResult } from './toolkit'
import { buildQueryRows, bytesToB64, headerValueOf, newRowId, prettyJson } from './http-utils'
import type { RequestBody, RequestDoc } from './http-codegen'

/** 词条对象类型：zh / en 结构一致，取 zh 分支即可 */
export type L = (typeof httpClientL)['zh']

export type BodyMode =
  'none' | 'json' | 'xml' | 'text' | 'html' | 'javascript' | 'form' | 'multipart' | 'binary'
export type AuthType = 'none' | 'basic' | 'bearer' | 'apikey'
export type Tab = 'params' | 'headers' | 'body' | 'auth' | 'options'
export type RespTab = 'body' | 'headers' | 'cookies' | 'timing' | 'sent' | 'snippets'
export type ViewMode = 'pretty' | 'raw' | 'hex'

export interface AuthState {
  type: AuthType
  username: string
  password: string
  token: string
  headerName: string
  headerPrefix: string
}

export interface OptState {
  timeout: number
  follow: boolean
  maxRedirects: number
  verifyTls: boolean
  useProxy: boolean
  proxy: string
}

export interface Draft {
  id: string
  at: number
  name?: string
  method: string
  url: string
  headers: Row[]
  bodyMode: BodyMode
  bodyRaw: string
  fields: Row[]
  auth: AuthState
  options: OptState
  status?: number | null
  durationMs?: number
  /** bodyRaw 入库时被截断过；回填时提示，防止把截断稿当原文发出去 */
  bodyTrimmed?: boolean
}

/** 选中的上传文件；只活在内存里（base64 不进 localStorage，否则一条就顶穿配额） */
export interface PickedFile {
  name: string
  base64: string
  bytes: number
  contentType: string
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']

export const BODY_CT: Record<BodyMode, string> = {
  none: '',
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  html: 'text/html',
  javascript: 'application/javascript',
  form: 'application/x-www-form-urlencoded',
  multipart: '', // 发送时带 boundary
  binary: '', // 发送时用文件自身的 Content-Type
}

export const HISTORY_KEY = 'devtoolbox-http-history'
export const SAVED_KEY = 'devtoolbox-http-saved'
export const DRAFT_KEY = 'devtoolbox-http-draft'
export const ENVS_KEY = 'devtoolbox-http-envs'
export const MAX_HISTORY = 50

export function row(name = '', value = '', enabled = true): Row {
  return { id: newRowId(), name, value, enabled }
}

export const DEFAULT_AUTH: AuthState = {
  type: 'none',
  username: '',
  password: '',
  token: '',
  headerName: 'X-API-Key',
  headerPrefix: '',
}
export const DEFAULT_OPTIONS: OptState = {
  timeout: 30000,
  follow: true,
  maxRedirects: 10,
  verifyTls: true,
  useProxy: false,
  proxy: 'http://127.0.0.1:8899',
}

/** 只比较名称与值：避免 URL 同步时抖动行 id 导致输入框失焦 */
export function sameParams(a: Row[], b: Row[]): boolean {
  if (a.length !== b.length) return false
  return a.every((r, i) => r.name === b[i].name && r.value === b[i].value)
}

/* ================= 表单 / 文档 互转（导出与回填共用） ================= */

/** 认证方式 → 实际要加的请求头 */
export function authHeaderPairs(auth: AuthState): [string, string][] {
  if (auth.type === 'basic') {
    const b64 = bytesToB64(new TextEncoder().encode(`${auth.username}:${auth.password}`))
    return [['Authorization', `Basic ${b64}`]]
  }
  if (auth.type === 'bearer') return auth.token ? [['Authorization', `Bearer ${auth.token}`]] : []
  if (auth.type === 'apikey')
    return [[auth.headerName.trim() || 'X-API-Key', `${auth.headerPrefix}${auth.token}`]]
  return []
}

/** 最终请求头 = 手工行 + 认证 + 正文类型。表单发送与收藏导出走同一份，避免两边不一致。 */
export function buildFinalHeaders(o: {
  headers: Row[]
  authHeaders: [string, string][]
  bodyContentType: string | null
}): [string, string][] {
  const out: [string, string][] = o.headers
    .filter((h) => h.enabled && h.name.trim())
    .map((h) => [h.name.trim(), h.value])
  for (const [k, v] of o.authHeaders) {
    const i = out.findIndex(([n]) => n.toLowerCase() === k.toLowerCase())
    if (i >= 0) out[i] = [out[i][0], v]
    else out.push([k, v])
  }
  if (o.bodyContentType && !out.some(([n]) => n.toLowerCase() === 'content-type')) {
    out.push(['Content-Type', o.bodyContentType])
  }
  return out
}

export function bodyFromParts(mode: BodyMode, fields: Row[], raw: string): RequestBody {
  if (mode === 'form' || mode === 'multipart') {
    return {
      kind: 'fields',
      fields: fields
        .filter((f) => f.enabled && f.name)
        .map((f) => [f.name, f.value] as [string, string]),
      multipart: mode === 'multipart',
    }
  }
  if (mode === 'none' || !raw.trim()) return { kind: 'none' }
  return { kind: 'text', text: raw }
}

/** 从 Content-Type 猜正文类型；认不出来就按内容嗅一下，比一律当 JSON 更少误报 */
export function inferBodyMode(contentType: string, body: string): BodyMode {
  const ct = contentType.toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('html')) return 'html'
  if (ct.includes('javascript')) return 'javascript'
  return prettyJson(body) ? 'json' : 'text'
}

export function bodyModeOf(doc: RequestDoc): BodyMode {
  if (doc.body.kind === 'none') return 'none'
  if (doc.body.kind === 'fields') return doc.body.multipart ? 'multipart' : 'form'
  return inferBodyMode(headerValueOf(doc.headers, 'content-type') ?? '', doc.body.text)
}

export function docBodyFromDraft(d: Draft): RequestBody {
  return bodyFromParts(d.bodyMode ?? 'none', d.fields ?? [], d.bodyRaw ?? '')
}

export function draftFromDoc(doc: RequestDoc, name: string, at: number): Draft {
  return {
    id: newRowId(),
    at,
    name,
    method: doc.method,
    url: doc.url,
    headers: doc.headers.map(([n, v]) => row(n, v)),
    bodyMode: bodyModeOf(doc),
    bodyRaw: doc.body.kind === 'text' ? doc.body.text : '',
    fields: doc.body.kind === 'fields' ? doc.body.fields.map(([n, v]) => row(n, v)) : [],
    auth: { ...DEFAULT_AUTH },
    options: {
      ...DEFAULT_OPTIONS,
      follow: doc.followRedirects,
      verifyTls: doc.verifyTls,
      useProxy: !!doc.proxy,
      proxy: doc.proxy ?? DEFAULT_OPTIONS.proxy,
    },
    status: null,
  }
}

/* ================= 发送前的环境变量插值 ================= */

export type EnvApplyOutcome =
  | { ok: true; url: string; headers: [string, string][]; bodyText: string | null }
  | { ok: false; missing: string[] }

/**
 * 把 {{}} 占位符一次性插进 URL / 请求头 / 正文，返回发送用的最终值。
 *
 * 表单正文按字段插值后再整体 urlencoded（直接替换整串会破坏 & = 结构），
 * 其余正文整串替换；任何缺失变量都让调用方阻断发送，绝不带着原占位符发出去。
 * formFields 传 null 表示非表单正文（multipart / binary 不走字段插值）。
 */
export function applyEnvToRequest(o: {
  url: string
  headers: [string, string][]
  bodyText: string | null
  envMap: Record<string, string>
  formFields: Row[] | null
}): EnvApplyOutcome {
  const f = (s: string): EnvApplyResult => applyEnvVars(s, o.envMap)
  const urlRes = f(o.url)
  const headerRes = o.headers.map(([n, v]) => [f(n), f(v)] as const)
  const fieldRes = o.formFields ? o.formFields.map((x) => [f(x.name), f(x.value)] as const) : null
  const bodyRes = o.formFields || o.bodyText == null ? null : f(o.bodyText)
  const missing = mergeMissing([
    urlRes,
    ...headerRes.flat(),
    ...(fieldRes ?? []).flat(),
    ...(bodyRes ? [bodyRes] : []),
  ])
  if (missing.length > 0) return { ok: false, missing }
  let bodyText: string | null = o.bodyText
  if (fieldRes) {
    bodyText = buildQueryRows(
      o.formFields!.map((x, i) => ({
        ...x,
        name: fieldRes[i][0].text,
        value: fieldRes[i][1].text,
      })),
    )
  } else if (bodyRes) {
    bodyText = bodyRes.text
  }
  return {
    ok: true,
    url: urlRes.text,
    headers: headerRes.map(([rn, rv]) => [rn.text, rv.text]),
    bodyText,
  }
}
