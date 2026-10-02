import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, CopyBtn, Drawer, NoteList } from '../components/ui'
import { CodeSnippets } from '../components/http/CodeSnippets'
import { RequestTransfer } from '../components/http/RequestTransfer'
import { EnvPanel, newEnv, type HttpEnv } from '../components/http/EnvPanel'
import { SnapshotPanel, SNAPSHOT_KEY, addSnapshot, snapshotFromResponse, type ResponseSnapshot } from '../components/http/SnapshotPanel'
import { KVEditor, type Row } from '../components/http/KVEditor'
import { useLocalized } from '../lib/i18n'
import { httpClientL } from '../lib/locales/httpclient'
import { evalJsonPath } from '../lib/toolkit'
import { applyEnvVars, mergeMissing, type EnvApplyResult } from '../lib/toolkit'
import type { HttpRequestResult, HttpRequestSpec } from '../lib/http-types'
import {
  buildWireRequest,
  docFromRequestSpec,
  generateCode,
  mergeRequests,
  type RequestBody,
  type RequestDoc,
  type RequestEntry,
} from '../lib/http-codegen'
import * as U from '../lib/http-utils'

/* ================= 类型 ================= */

type BodyMode = 'none' | 'json' | 'xml' | 'text' | 'html' | 'javascript' | 'form' | 'multipart' | 'binary'
type AuthType = 'none' | 'basic' | 'bearer' | 'apikey'
type Tab = 'params' | 'headers' | 'body' | 'auth' | 'options'
type RespTab = 'body' | 'headers' | 'cookies' | 'timing' | 'sent' | 'snippets'
type ViewMode = 'pretty' | 'raw' | 'hex'

interface AuthState {
  type: AuthType
  username: string
  password: string
  token: string
  headerName: string
  headerPrefix: string
}

interface OptState {
  timeout: number
  follow: boolean
  maxRedirects: number
  verifyTls: boolean
  useProxy: boolean
  proxy: string
}

interface Draft {
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
interface PickedFile {
  name: string
  base64: string
  bytes: number
  contentType: string
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']

const BODY_CT: Record<BodyMode, string> = {
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

const HISTORY_KEY = 'devtoolbox-http-history'
const SAVED_KEY = 'devtoolbox-http-saved'
const DRAFT_KEY = 'devtoolbox-http-draft'
const ENVS_KEY = 'devtoolbox-http-envs'
const MAX_HISTORY = 50

/** 词条对象类型：zh / en 结构一致，取 zh 分支即可 */
type L = typeof httpClientL['zh']

function row(name = '', value = '', enabled = true): Row {
  return { id: U.newRowId(), name, value, enabled }
}

const DEFAULT_AUTH: AuthState = { type: 'none', username: '', password: '', token: '', headerName: 'X-API-Key', headerPrefix: '' }
const DEFAULT_OPTIONS: OptState = {
  timeout: 30000, follow: true, maxRedirects: 10, verifyTls: true, useProxy: false, proxy: 'http://127.0.0.1:8899',
}

/** 只比较名称与值：避免 URL 同步时抖动行 id 导致输入框失焦 */
function sameParams(a: Row[], b: Row[]): boolean {
  if (a.length !== b.length) return false
  return a.every((r, i) => r.name === b[i].name && r.value === b[i].value)
}

/* ================= 表单 / 文档 互转（导出与回填共用） ================= */

/** 认证方式 → 实际要加的请求头 */
function authHeaderPairs(auth: AuthState): [string, string][] {
  if (auth.type === 'basic') {
    const b64 = U.bytesToB64(new TextEncoder().encode(`${auth.username}:${auth.password}`))
    return [['Authorization', `Basic ${b64}`]]
  }
  if (auth.type === 'bearer') return auth.token ? [['Authorization', `Bearer ${auth.token}`]] : []
  if (auth.type === 'apikey') return [[auth.headerName.trim() || 'X-API-Key', `${auth.headerPrefix}${auth.token}`]]
  return []
}

/** 最终请求头 = 手工行 + 认证 + 正文类型。表单发送与收藏导出走同一份，避免两边不一致。 */
function buildFinalHeaders(o: { headers: Row[]; authHeaders: [string, string][]; bodyContentType: string | null }): [string, string][] {
  const out: [string, string][] = o.headers.filter((h) => h.enabled && h.name.trim()).map((h) => [h.name.trim(), h.value])
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

function bodyFromParts(mode: BodyMode, fields: Row[], raw: string): RequestBody {
  if (mode === 'form' || mode === 'multipart') {
    return {
      kind: 'fields',
      fields: fields.filter((f) => f.enabled && f.name).map((f) => [f.name, f.value] as [string, string]),
      multipart: mode === 'multipart',
    }
  }
  if (mode === 'none' || !raw.trim()) return { kind: 'none' }
  return { kind: 'text', text: raw }
}

/** 从 Content-Type 猜正文类型；认不出来就按内容嗅一下，比一律当 JSON 更少误报 */
function inferBodyMode(contentType: string, body: string): BodyMode {
  const ct = contentType.toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('html')) return 'html'
  if (ct.includes('javascript')) return 'javascript'
  return U.prettyJson(body) ? 'json' : 'text'
}

function bodyModeOf(doc: RequestDoc): BodyMode {
  if (doc.body.kind === 'none') return 'none'
  if (doc.body.kind === 'fields') return doc.body.multipart ? 'multipart' : 'form'
  return inferBodyMode(U.headerValueOf(doc.headers, 'content-type') ?? '', doc.body.text)
}

function docBodyFromDraft(d: Draft): RequestBody {
  return bodyFromParts(d.bodyMode ?? 'none', d.fields ?? [], d.bodyRaw ?? '')
}

function draftFromDoc(doc: RequestDoc, name: string, at: number): Draft {
  return {
    id: U.newRowId(),
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

/* ================= 主组件 ================= */

export function HttpClientTool() {
  const l = useLocalized(httpClientL)
  /** 上次未发出去的请求草稿（代理等配置随它一起记住） */
  const [restored] = useState<Draft | null>(() => U.loadJson<Draft | null>(DRAFT_KEY, null))
  const [method, setMethod] = useState(() => restored?.method ?? 'GET')
  const [url, setUrl] = useState(() => restored?.url ?? 'https://httpbin.org/get?limit=10')
  const [params, setParams] = useState<Row[]>([])
  const [headers, setHeaders] = useState<Row[]>(() => (restored?.headers?.length ? restored.headers : [row('Accept', 'application/json')]))
  const [bodyMode, setBodyMode] = useState<BodyMode>(() => (restored?.bodyMode as BodyMode) ?? 'none')
  const [bodyRaw, setBodyRaw] = useState(() => restored?.bodyRaw ?? '')
  const [fields, setFields] = useState<Row[]>(() => restored?.fields ?? [])
  const [auth, setAuth] = useState<AuthState>(() => restored?.auth ?? DEFAULT_AUTH)
  const [options, setOptions] = useState<OptState>(() => ({ ...DEFAULT_OPTIONS, ...(restored?.options ?? {}) }))
  const [tab, setTab] = useState<Tab>('params')
  const [respTab, setRespTab] = useState<RespTab>('body')
  const [view, setView] = useState<ViewMode>('pretty')
  const [response, setResponse] = useState<HttpRequestResult | null>(null)
  const [sentSpec, setSentSpec] = useState<HttpRequestSpec | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Draft[]>(() => U.loadJson<Draft[]>(HISTORY_KEY, []))
  const [saved, setSaved] = useState<Draft[]>(() => U.loadJson<Draft[]>(SAVED_KEY, []))
  const [saveName, setSaveName] = useState('')
  const [proxyInfo, setProxyInfo] = useState<{ running: boolean; port: number } | null>(null)
  /** 次要功能收在抽屉里：主界面只留「发请求 → 看响应」这条主线，别把它割开 */
  const [panel, setPanel] = useState<'code' | 'transfer' | 'proxy' | 'history' | 'envs' | 'snaps' | null>(null)
  /** 重发次数（1-20）：压测初探用，顺序发送失败即停 */
  const [repeat, setRepeat] = useState(1)
  /** binary 上传文件（内存态，不持久化） */
  const [filePick, setFilePick] = useState<PickedFile | null>(null)
  /** multipart 文件字段：行（名字可持久化部分走 docBody 占位）+ 内存中的文件数据 */
  const [fileFields, setFileFields] = useState<{ id: string; name: string }[]>([])
  const [fileFieldData, setFileFieldData] = useState<Record<string, PickedFile>>({})
  /** 抽屉里产生的提示，关掉抽屉后要留在主界面上，否则用户看不到「填好了」 */
  const [transferNote, setTransferNote] = useState<string[]>([])
  /** 环境变量：存原文（{{}} 占位符），发送时才插值 */
  const [envStore, setEnvStore] = useState<{ envs: HttpEnv[]; activeId: string | null }>(() =>
    U.loadJson(ENVS_KEY, { envs: [] as HttpEnv[], activeId: null }))
  /** 响应快照：解码后的正文文本，供「保存 → 再发一次 → 对比」 */
  const [snapshots, setSnapshots] = useState<ResponseSnapshot[]>(() => U.loadJson<ResponseSnapshot[]>(SNAPSHOT_KEY, []))

  /* ---- 初始化：抓包代理状态（历史/收藏由 useState 惰性读取） ---- */
  useEffect(() => {
    window.electronAPI?.proxy?.state()
      .then((s) => setProxyInfo({ running: s.running, port: s.port }))
      .catch(() => setProxyInfo(null))
  }, [])

  /* ---- 当前草稿持久化：代理、超时、请求头等配置重启后仍在 ---- */
  const draftSnapshot = useMemo(() => ({ method, url, headers, bodyMode, bodyRaw, fields, auth, options }), [method, url, headers, bodyMode, bodyRaw, fields, auth, options])

  /** 所有 localStorage 写入收敛在这里：失败必须在主界面上可感知，绝不静默丢数据 */
  const persist = useCallback((key: string, value: unknown): void => {
    if (!U.saveJson(key, value)) setTransferNote([l.errors.storageFull])
  }, [l])

  useEffect(() => {
    persist(DRAFT_KEY, { ...draftSnapshot, id: 'draft', at: Date.now() })
  }, [draftSnapshot, persist])

  useEffect(() => {
    persist(HISTORY_KEY, history.slice(0, MAX_HISTORY))
  }, [history, persist])

  useEffect(() => {
    persist(SAVED_KEY, saved)
  }, [saved, persist])

  useEffect(() => {
    persist(ENVS_KEY, envStore)
  }, [envStore, persist])

  useEffect(() => {
    persist(SNAPSHOT_KEY, snapshots)
  }, [snapshots, persist])

  /** 主进程选文件 → 内存态 PickedFile；base64 不落盘 */
  const pickInto = useCallback(async (apply: (f: PickedFile | null) => void): Promise<void> => {
    const api = window.electronAPI?.http
    if (!api) {
      setTransferNote([l.errors.desktopOnly])
      return
    }
    const r = await api.pickFile()
    if (!r.ok) {
      if (!r.canceled) {
        setTransferNote([r.error === 'FILE_TOO_LARGE' ? l.body.fileTooLarge : `${l.errors.requestFailed}: ${r.error ?? ''}`])
      }
      return
    }
    apply({ name: r.name ?? 'file', base64: r.base64 ?? '', bytes: r.bytes ?? 0, contentType: U.guessContentType(r.name ?? '') })
  }, [l])

  const pickBodyFile = useCallback(() => void pickInto(setFilePick), [pickInto])

  /** 把响应里的 Set-Cookie 汇成一个 Cookie 请求头：同名替换，没有就追加 */
  const addCookieHeader = useCallback((value: string) => {
    setHeaders((rows) => {
      const i = rows.findIndex((r) => r.name.toLowerCase() === 'cookie')
      if (i >= 0) return rows.map((r, j) => (j === i ? { ...r, value, enabled: true } : r))
      return [...rows, { id: U.newRowId(), name: 'Cookie', value, enabled: true }]
    })
    setTransferNote([l.headers.cookieAdded])
  }, [l])

  const pickFieldFile = useCallback((rowId: string) => {
    void pickInto((f) => { if (f) setFileFieldData((m) => ({ ...m, [rowId]: f })) })
  }, [pickInto])

  /** 保存当前响应为快照；二进制响应不存，给出提示 */
  const saveSnapshot = useCallback(() => {
    if (!response) return
    const decoded = U.decodeResponseBody(response)
    const snap = snapshotFromResponse(response, decoded)
    if (!snap) {
      setTransferNote([l.snaps.saveBinary])
      return
    }
    setSnapshots((prev) => addSnapshot(prev, snap))
    setTransferNote([l.snaps.saved])
  }, [response, l])

  /** 激活环境的变量表 → 查找映射；未启用环境时为 null（发送路径零开销） */
  const envMap = useMemo<Record<string, string> | null>(() => {
    const env = envStore.envs.find((e) => e.id === envStore.activeId)
    if (!env) return null
    const map: Record<string, string> = {}
    for (const v of env.vars) {
      if (v.enabled && v.name.trim()) map[v.name.trim()] = v.value
    }
    return map
  }, [envStore])

  /* ---- URL ↔ 参数双向同步 ---- */
  useEffect(() => {
    const parsed = U.queryRows(url)
    setParams((prev) => (sameParams(prev, parsed) ? prev : parsed))
  }, [url])

  const onParamsChange = useCallback((next: Row[]) => {
    setParams(next)
    setUrl((cur) => U.applyQueryRows(cur, next))
  }, [])

  /* ---- 请求草稿 ---- */
  const draft = useCallback((): Draft => ({
    id: U.newRowId(),
    at: Date.now(),
    method,
    url,
    headers,
    bodyMode,
    bodyRaw,
    fields,
    auth,
    options,
  }), [method, url, headers, bodyMode, bodyRaw, fields, auth, options])

  const loadDraft = useCallback((d: Draft) => {
    setMethod(d.method)
    setUrl(d.url)
    setHeaders(d.headers?.length ? d.headers : [row('Accept', 'application/json')])
    setBodyMode(d.bodyMode ?? 'none')
    setBodyRaw(d.bodyRaw ?? '')
    setFields(d.fields ?? [])
    setAuth(d.auth ?? DEFAULT_AUTH)
    setOptions({ ...DEFAULT_OPTIONS, ...(d.options ?? {}) })
    setResponse(null)
    setError(null)
    // 截断稿必须亮明身份：回填的是前 64k，直接发出去不是用户当初的完整请求
    if (d.bodyTrimmed) setTransferNote([l.history.bodyTrimmed(U.MAX_SAVED_BODY_CHARS)])
  }, [l])

  /** 把解析出来的 curl / 导入的单条请求填进表单。只覆盖请求本身，不动超时等出口配置。 */
  const applyDoc = useCallback((doc: RequestDoc, name?: string) => {
    setMethod(METHODS.includes(doc.method) ? doc.method : 'GET')
    setUrl(doc.url)
    setHeaders(doc.headers.map(([n, v]) => row(n, v)))
    if (doc.body.kind === 'fields') {
      setBodyMode(doc.body.multipart ? 'multipart' : 'form')
      setFields(doc.body.fields.map(([n, v]) => row(n, v)))
      setBodyRaw('')
    } else if (doc.body.kind === 'text') {
      const ct = (U.headerValueOf(doc.headers, 'content-type') ?? '').toLowerCase()
      if (ct.includes('x-www-form-urlencoded')) {
        // 表单正文拆成可编辑的行，否则切到表单视图后正文会丢
        setBodyMode('form')
        setFields(U.queryRows(`?${doc.body.text}`).map((r) => row(r.name, r.value)))
        setBodyRaw('')
      } else {
        setBodyMode(inferBodyMode(ct, doc.body.text))
        setBodyRaw(doc.body.text)
        setFields([])
      }
    } else {
      setBodyMode('none')
      setBodyRaw('')
      setFields([])
    }
    setAuth({ ...DEFAULT_AUTH })
    // 跟随重定向 / TLS 校验属于请求本身的语义，照做；
    // 代理是「本机怎么出去」的配置，命令里没写就保留用户原设置，避免粘一条命令把连通性弄断。
    setOptions((o) => ({
      ...o,
      follow: doc.followRedirects,
      verifyTls: doc.verifyTls,
      ...(doc.proxy ? { useProxy: true, proxy: doc.proxy } : {}),
    }))
    setResponse(null)
    setError(null)
    if (name) setSaveName(name)
  }, [])

  /** 收藏 → 导出条目（含认证与正文类型，导出的请求能独立发出去） */
  const buildExportEntries = useCallback((): RequestEntry[] => saved.map((d) => ({
    name: d.name?.trim() || `${d.method} ${d.url}`.slice(0, 60),
    doc: {
      method: d.method,
      url: d.url,
      headers: buildFinalHeaders({
        headers: d.headers ?? [],
        authHeaders: authHeaderPairs(d.auth ?? DEFAULT_AUTH),
        bodyContentType: BODY_CT[d.bodyMode ?? 'none'] || null,
      }),
      body: docBodyFromDraft(d),
      followRedirects: d.options?.follow ?? false,
      verifyTls: d.options?.verifyTls !== false,
      proxy: d.options?.useProxy ? (d.options?.proxy ?? null) : null,
    },
  })), [saved])

  /** 导入的条目并入收藏（同「名称 + 方法 + URL」跳过） */
  const mergeImportEntries = useCallback((entries: RequestEntry[]): { added: number; skipped: number } => {
    const res = mergeRequests(buildExportEntries(), entries)
    if (res.added > 0) {
      const now = Date.now()
      const fresh = res.merged.slice(0, res.added).map((e, i) => draftFromDoc(e.doc, e.name, now + i))
      setSaved((s) => [...fresh, ...s].slice(0, 40))
    }
    return { added: res.added, skipped: res.skipped }
  }, [buildExportEntries])

  /* ---- 组装请求体 ---- */
  const multipart = useMemo(() => {
    if (bodyMode !== 'multipart') return null
    const boundary = `----DevToolboxBoundary${Math.random().toString(36).slice(2, 10)}`
    const lines: string[] = []
    for (const f of fields.filter((x) => x.enabled && x.name)) {
      lines.push(`--${boundary}`)
      lines.push(`Content-Disposition: form-data; name="${f.name}"`)
      lines.push('')
      lines.push(f.value)
    }
    lines.push(`--${boundary}--`)
    lines.push('')
    return { boundary, body: lines.join('\r\n') }
  }, [bodyMode, fields])

  /** multipart 含文件字段时走字节拼装（文本 part 用 UTF-8 编码，文件 part 直接还原字节） */
  const multipartBinary = useMemo(() => {
    if (bodyMode !== 'multipart') return null
    const withFile = fileFields.filter((f) => f.name && fileFieldData[f.id])
    if (withFile.length === 0) return null
    const boundary = `----DevToolboxBoundary${Math.random().toString(36).slice(2, 10)}`
    const enc = new TextEncoder()
    const parts: Uint8Array[] = []
    const pushText = (s: string): void => { parts.push(enc.encode(s)) }
    for (const f of fields.filter((x) => x.enabled && x.name)) {
      pushText(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`)
    }
    for (const f of withFile) {
      const file = fileFieldData[f.id]
      pushText(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${file.name}"\r\nContent-Type: ${file.contentType}\r\n\r\n`)
      parts.push(U.b64ToBytes(file.base64))
      pushText('\r\n')
    }
    pushText(`--${boundary}--\r\n`)
    const total = parts.reduce((n, p) => n + p.length, 0)
    const body = new Uint8Array(total)
    let off = 0
    for (const p of parts) { body.set(p, off); off += p.length }
    return { boundary, base64: U.bytesToB64(body) }
  }, [bodyMode, fields, fileFields, fileFieldData])

  const builtBody = useMemo((): { text: string | null; base64: string | null; contentType: string | null } => {
    if (bodyMode === 'none') return { text: null, base64: null, contentType: null }
    if (bodyMode === 'binary') {
      return filePick
        ? { text: null, base64: filePick.base64, contentType: filePick.contentType }
        : { text: null, base64: null, contentType: null }
    }
    if (bodyMode === 'form') {
      const body = U.buildQueryRows(fields)
      return body ? { text: body, base64: null, contentType: BODY_CT.form } : { text: null, base64: null, contentType: null }
    }
    if (bodyMode === 'multipart') {
      const ct = `multipart/form-data; boundary=${(multipartBinary ?? multipart)?.boundary ?? ''}`
      if (multipartBinary) return { text: null, base64: multipartBinary.base64, contentType: ct }
      if (multipart) return { text: multipart.body, base64: null, contentType: ct }
      return { text: null, base64: null, contentType: null }
    }
    if (!bodyRaw.trim()) return { text: null, base64: null, contentType: null }
    return { text: bodyRaw, base64: null, contentType: BODY_CT[bodyMode] || null }
  }, [bodyMode, bodyRaw, fields, multipart, multipartBinary, filePick])

  /* ---- 认证派生请求头 ---- */
  const authHeaders = useMemo((): [string, string][] => authHeaderPairs(auth), [auth])

  /** 最终请求头：手工行 + 认证 + 正文类型 */
  const finalHeaders = useCallback((): [string, string][] =>
    buildFinalHeaders({ headers, authHeaders, bodyContentType: builtBody.contentType }),
  [headers, authHeaders, builtBody])

  const docBody = useCallback((): RequestBody => {
    // binary / 文件字段进中立文档时用 <<file: ...>> 占位，导出与代码生成不内嵌文件内容
    if (bodyMode === 'binary') {
      return filePick ? { kind: 'text', text: `<<file: ${filePick.name}>>` } : { kind: 'none' }
    }
    const base = bodyFromParts(bodyMode, fields, bodyRaw)
    if (bodyMode === 'multipart' && base.kind === 'fields' && fileFields.some((f) => f.name)) {
      return {
        ...base,
        fields: [
          ...base.fields,
          ...fileFields.filter((f) => f.name).map((f) => [f.name, `<<file: ${fileFieldData[f.id]?.name ?? '?'}>>`] as [string, string]),
        ],
      }
    }
    return base
  }, [bodyMode, fields, bodyRaw, filePick, fileFields, fileFieldData])

  /** 中立文档：生成代码 / 导出 / 复制 JSON 的唯一输入 */
  const currentDoc = useCallback((): RequestDoc => ({
    method,
    url: url.includes('://') || !url ? url : `http://${url}`,
    headers: finalHeaders(),
    body: docBody(),
    followRedirects: options.follow,
    verifyTls: options.verifyTls,
    proxy: options.useProxy ? options.proxy.trim() : null,
  }), [method, url, finalHeaders, docBody, options])

  /* ---- 发送 ---- */
  const send = useCallback(async () => {
    const target = url.trim()
    if (!target) {
      setError(l.errors.emptyUrl)
      return
    }
    if (options.useProxy && !/^https?:\/\//i.test(options.proxy.trim())) {
      setError(l.errors.badProxy)
      return
    }
    const api = window.electronAPI?.http
    if (!api) {
      setError(l.errors.desktopOnly)
      return
    }
    /* ---- 环境变量插值：只在这一步替换，表单 / 收藏 / 导出始终是 {{}} 原文 ---- */
    let sendUrl = target.includes('://') ? target : `http://${target}`
    let sendHeaders = finalHeaders()
    let sendBodyText = builtBody.text
    if (envMap) {
      const f = (s: string): EnvApplyResult => applyEnvVars(s, envMap)
      const urlRes = f(sendUrl)
      const headerRes = sendHeaders.map(([n, v]) => [f(n), f(v)] as const)
      // 表单按字段插值后再编码，替换值里的 & = 不会破坏 urlencoded 结构
      const fieldRes = bodyMode === 'form'
        ? fields.map((x) => [f(x.name), f(x.value)] as const)
        : null
      const bodyRes = bodyMode === 'form' || sendBodyText == null ? null : f(sendBodyText)
      const missing = mergeMissing([
        urlRes,
        ...headerRes.flat(),
        ...(fieldRes ?? []).flat(),
        ...(bodyRes ? [bodyRes] : []),
      ])
      if (missing.length > 0) {
        setError(l.errors.missingVars(missing))
        return
      }
      sendUrl = urlRes.text
      sendHeaders = headerRes.map(([rn, rv]) => [rn.text, rv.text])
      if (fieldRes) {
        sendBodyText = U.buildQueryRows(fields.map((x, i) => ({ ...x, name: fieldRes[i][0].text, value: fieldRes[i][1].text })))
      } else if (bodyRes) {
        sendBodyText = bodyRes.text
      }
    }
    const spec: HttpRequestSpec = {
      method,
      url: sendUrl,
      headers: sendHeaders,
      bodyText: sendBodyText,
      bodyBase64: builtBody.base64,
      timeoutMs: options.timeout,
      followRedirects: options.follow,
      maxRedirects: options.maxRedirects,
      rejectUnauthorized: options.verifyTls,
      proxy: options.useProxy ? options.proxy.trim() : null,
    }
    setSending(true)
    setError(null)
    try {
      let last: HttpRequestResult | null = null
      const runs: string[] = []
      /* 重发 ×N：顺序发送，失败即停；最后一次的响应进入响应区 */
      for (let i = 0; i < repeat; i++) {
        const res = await api.send(spec)
        last = res
        if (!res.ok) {
          // 网络错误码给一条可执行建议，别让用户对着 ECONNREFUSED 发呆
          const hint = l.errHints[res.errorCode ?? '']
          setError(`${l.errors.requestFailed}: ${res.error ?? ''}${hint ? `\n${hint}` : ''}`)
          break
        }
        runs.push(`${res.status} ${U.formatDuration(res.timings.totalMs)}`)
      }
      if (last) {
        setResponse(last)
        setSentSpec(spec)
        setView('pretty')
        setRespTab('body')
        // 入库前裁剪超长正文：发送仍用原文，历史只负责回填表单
        const entry: Draft = { ...U.trimBodyForStorage(draft()), status: last.status, durationMs: last.timings.totalMs }
        setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY))
      }
      if (repeat > 1 && runs.length > 0) setTransferNote([l.misc.repeatDone(runs.length, runs.join(' · '))])
    } catch (err) {
      setError(`${l.errors.requestFailed}: ${(err as Error).message}`)
    } finally {
      setSending(false)
    }
  }, [url, method, finalHeaders, builtBody, options, l, draft, envMap, bodyMode, fields, repeat])

  /* ---- 快捷键 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void send()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [send])

  /** 一键把出口切到内置抓包代理（跑起来的话） */
  const useBuiltinProxy = useCallback(async () => {
    const s = await window.electronAPI?.proxy.state()
    if (!s) return
    setProxyInfo({ running: s.running, port: s.port })
    setOptions((o) => ({ ...o, useProxy: true, proxy: `http://127.0.0.1:${s.port}` }))
  }, [])

  const closePanel = useCallback(() => setPanel(null), [])

  const desktop = typeof window !== 'undefined' && !!window.electronAPI

  return (
    <div className="space-y-3">
      {!desktop && <ErrorNote msg={l.errors.desktopOnly} />}

      {/* ===== 请求行 ===== */}
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="bg-panel-2 border border-line-soft px-2 py-1.5 text-[12.5px] text-phosphor focus:border-phosphor/40"
        >
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={l.urlPlaceholder}
          spellCheck={false}
          className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2.5 py-1.5 text-[12.5px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
        />
        <input
          value={String(repeat)}
          onChange={(e) => setRepeat(Math.min(20, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))}
          title={l.misc.repeatTip}
          spellCheck={false}
          className="w-12 shrink-0 bg-panel-2 border border-line-soft px-1.5 py-1.5 text-[12px] text-bright text-center focus:border-phosphor/40"
        />
        <Btn variant="primary" onClick={() => void send()} disabled={sending}>
          {sending ? l.sending : l.send}
        </Btn>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Btn onClick={() => { setTransferNote([]); setPanel('transfer') }}>{l.transfer.open}</Btn>
        <Btn onClick={() => setPanel('code')}>{l.code.title}</Btn>
        {/* 代理与历史也收在这里：状态直接写在按钮上，收起来不等于看不见 */}
        <Btn
          onClick={() => setPanel('proxy')}
          className={options.useProxy ? 'border-phosphor/50 text-phosphor' : ''}
        >
          {l.options.proxyTitle} · {options.useProxy && options.proxy ? options.proxy : l.options.proxyDirect}
        </Btn>
        <Btn onClick={() => setPanel('history')}>
          {l.history.title}{history.length > 0 ? ` · ${history.length}` : ''}
        </Btn>
        <Btn
          onClick={() => setPanel('envs')}
          className={envMap ? 'border-phosphor/50 text-phosphor' : ''}
        >
          {l.envs.title} · {envStore.envs.find((e) => e.id === envStore.activeId)?.name?.trim() || l.envs.none}
        </Btn>
        <span className="text-[10.5px] text-muted">{l.misc.sendTip}</span>
      </div>
      <NoteList lines={transferNote} />

      <div className="space-y-3 min-[1700px]:grid min-[1700px]:grid-cols-2 min-[1700px]:items-start min-[1700px]:gap-3 min-[1700px]:space-y-0">
        <div className="space-y-3">

      {/* ===== 请求配置 ===== */}
      <Panel
        title={l.tabs[tab]}
        right={
          <div className="flex gap-1">
            {(['params', 'headers', 'body', 'auth', 'options'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2 py-0.5 text-[11px] border transition-colors ${tab === t ? 'border-phosphor/60 text-phosphor bg-phosphor-faint' : 'border-line-soft text-muted hover:text-phosphor'}`}
              >
                {l.tabs[t]}
                {t === 'headers' && headers.filter((h) => h.enabled && h.name).length > 0 && <span className="ml-1 text-phosphor/70">{headers.filter((h) => h.enabled && h.name).length}</span>}
                {t === 'params' && params.length > 0 && <span className="ml-1 text-phosphor/70">{params.length}</span>}
              </button>
            ))}
          </div>
        }
      >
        {tab === 'params' && (
          <div className="space-y-2">
            <div className="text-[11px] text-muted">{l.params.hint}</div>
            <KVEditor rows={params} onChange={onParamsChange} addLabel={l.kv.add} nameLabel={l.kv.name} valueLabel={l.kv.value} removeLabel={l.kv.remove} />
          </div>
        )}

        {tab === 'headers' && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-muted self-center">{l.headers.presets}:</span>
              <PresetBtn label={l.headers.presetJson} onClick={() => setHeaders((h) => [
                ...h,
                row('Content-Type', 'application/json'),
                row('Accept', 'application/json'),
              ])} />
              <PresetBtn label={l.headers.presetForm} onClick={() => setHeaders((h) => [...h, row('Content-Type', 'application/x-www-form-urlencoded')])} />
              <PresetBtn label={l.headers.presetBrowser} onClick={() => setHeaders((h) => [...h, row('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')])} />
              <PresetBtn label={l.headers.presetNoCache} onClick={() => setHeaders((h) => [...h, row('Cache-Control', 'no-cache'), row('Pragma', 'no-cache')])} />
              <PresetBtn label={l.headers.presetCors} onClick={() => setHeaders((h) => [...h, row('Origin', 'https://example.com'), row('Access-Control-Request-Method', 'POST')])} />
              <PresetBtn label={l.headers.presetAuth} onClick={() => setHeaders((h) => [...h, row('Authorization', 'Bearer YOUR_TOKEN')])} />
            </div>
            <KVEditor rows={headers} onChange={setHeaders} addLabel={l.kv.add} nameLabel={l.kv.name} valueLabel={l.kv.value} removeLabel={l.kv.remove} headerSuggest />
            <div className="text-[11px] text-muted">{l.headers.hint}</div>
          </div>
        )}

        {tab === 'body' && (
          <div className="space-y-2">
            <Select
              label={l.body.mode}
              value={bodyMode}
              onChange={(v) => setBodyMode(v as BodyMode)}
              options={[
                { value: 'none', label: l.body.none },
                { value: 'json', label: l.body.json },
                { value: 'xml', label: l.body.xml },
                { value: 'text', label: l.body.text },
                { value: 'html', label: l.body.html },
                { value: 'javascript', label: l.body.javascript },
                { value: 'form', label: l.body.form },
                { value: 'multipart', label: l.body.multipart },
                { value: 'binary', label: l.body.binary },
              ]}
            />
            {(bodyMode === 'form' || bodyMode === 'multipart') && (
              <KVEditor rows={fields} onChange={setFields} addLabel={l.kv.add} nameLabel={l.kv.name} valueLabel={l.kv.value} removeLabel={l.kv.remove} />
            )}
            {bodyMode === 'binary' && (
              <div className="space-y-2">
                {filePick ? (
                  <div className="flex items-center gap-2 border border-line-soft bg-panel-2 px-3 py-2 text-[12px]">
                    <span className="text-phosphor break-all">{filePick.name}</span>
                    <span className="text-muted shrink-0">{U.formatBytes(filePick.bytes)}</span>
                    <button onClick={() => setFilePick(null)} className="ml-auto text-muted hover:text-danger px-1" title={l.body.clearFile}>×</button>
                  </div>
                ) : (
                  <div className="text-[11.5px] text-muted">{l.body.noFile}</div>
                )}
                <Btn variant="ghost" onClick={pickBodyFile}>{filePick ? l.body.replaceFile : l.body.pickFile}</Btn>
                {filePick && <div className="text-[11px] text-muted">{l.body.contentType}: <span className="text-phosphor">{filePick.contentType}</span> · {l.body.fileNotPersisted}</div>}
              </div>
            )}
            {bodyMode === 'multipart' && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-muted">{l.body.fileFieldsTitle}</div>
                {fileFields.length === 0 && <div className="text-[11.5px] text-muted">—</div>}
                {fileFields.map((f) => (
                  <div key={f.id} className="flex items-center gap-1.5">
                    <input
                      value={f.name}
                      onChange={(e) => setFileFields((rows) => rows.map((r) => (r.id === f.id ? { ...r, name: e.target.value } : r)))}
                      placeholder={l.kv.name}
                      spellCheck={false}
                      className="w-1/3 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
                    />
                    <span className="flex-1 min-w-0 text-[12px] text-dim truncate">
                      {fileFieldData[f.id] ? `${fileFieldData[f.id].name} · ${U.formatBytes(fileFieldData[f.id].bytes)}` : l.body.noFile}
                    </span>
                    <Btn variant="ghost" onClick={() => pickFieldFile(f.id)}>{l.body.pickFile}</Btn>
                    <button
                      onClick={() => {
                        setFileFields((rows) => rows.filter((r) => r.id !== f.id))
                        setFileFieldData((m) => {
                          const next = { ...m }
                          delete next[f.id]
                          return next
                        })
                      }}
                      className="shrink-0 text-muted hover:text-danger px-1.5 text-[13px]"
                      title={l.kv.remove}
                    >×</button>
                  </div>
                ))}
                <Btn variant="ghost" onClick={() => setFileFields((rows) => [...rows, { id: U.newRowId(), name: '' }])}>+ {l.body.addFileField}</Btn>
              </div>
            )}
            {bodyMode !== 'none' && bodyMode !== 'form' && bodyMode !== 'multipart' && bodyMode !== 'binary' && (
              <>
                <TA value={bodyRaw} onChange={setBodyRaw} label={l.body.mode} rows={10} placeholder={l.body.placeholder} />
                <div className="flex items-center gap-2 flex-wrap">
                  <Btn variant="ghost" onClick={() => setBodyRaw((v) => U.prettyJson(v) ?? v)}>{l.body.beautify}</Btn>
                  {bodyRaw.trim() && (bodyMode === 'json') && !U.prettyJson(bodyRaw) && (
                    <span className="text-[11px] text-amber">{l.body.badJson}</span>
                  )}
                  <span className="text-[11px] text-muted">{l.body.byteNote(new TextEncoder().encode(bodyRaw).length)}</span>
                </div>
              </>
            )}
            {bodyMode === 'multipart' && <div className="text-[11px] text-muted">{l.body.fileNote}</div>}
            {builtBody.contentType && (
              <div className="text-[11px] text-muted">{l.body.contentType}: <span className="text-phosphor">{builtBody.contentType}</span></div>
            )}
          </div>
        )}

        {tab === 'auth' && (
          <div className="space-y-2">
            <Select
              label={l.auth.type}
              value={auth.type}
              onChange={(v) => setAuth((a) => ({ ...a, type: v as AuthType }))}
              options={[
                { value: 'none', label: l.auth.none },
                { value: 'basic', label: l.auth.basic },
                { value: 'bearer', label: l.auth.bearer },
                { value: 'apikey', label: l.auth.apiKey },
              ]}
            />
            {auth.type === 'basic' && (
              <div className="grid sm:grid-cols-2 gap-2">
                <Input label={l.auth.username} value={auth.username} onChange={(v) => setAuth((a) => ({ ...a, username: v }))} />
                <Input label={l.auth.password} value={auth.password} onChange={(v) => setAuth((a) => ({ ...a, password: v }))} type="password" />
              </div>
            )}
            {auth.type === 'bearer' && (
              <Input label={l.auth.token} value={auth.token} onChange={(v) => setAuth((a) => ({ ...a, token: v }))} />
            )}
            {auth.type === 'apikey' && (
              <div className="grid sm:grid-cols-3 gap-2">
                <Input label={l.auth.headerName} value={auth.headerName} onChange={(v) => setAuth((a) => ({ ...a, headerName: v }))} />
                <Input label={l.auth.headerPrefix} value={auth.headerPrefix} onChange={(v) => setAuth((a) => ({ ...a, headerPrefix: v }))} placeholder="Bearer " />
                <Input label={l.auth.token} value={auth.token} onChange={(v) => setAuth((a) => ({ ...a, token: v }))} />
              </div>
            )}
            {authHeaders.length > 0 && (
              <div className="border border-line-soft bg-panel-2 px-3 py-2 space-y-1">
                <div className="text-[11px] text-muted">{l.auth.generatedNote}</div>
                {authHeaders.map(([k, v]) => (
                  <div key={k} className="text-[12px] break-all">
                    <span className="text-phosphor">{k}</span>
                    <span className="text-muted">: </span>
                    <span className="text-bright">{k.toLowerCase() === 'authorization' ? v.replace(/^(\w+ ).*/, '$1••••••') : v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'options' && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Input label={l.options.timeout} value={String(options.timeout)} onChange={(v) => setOptions((o) => ({ ...o, timeout: Number(v.replace(/\D/g, '')) || 0 }))} />
              <Input label={l.options.maxRedirects} value={String(options.maxRedirects)} onChange={(v) => setOptions((o) => ({ ...o, maxRedirects: Number(v.replace(/\D/g, '')) || 0 }))} />
            </div>
            <div className="space-y-1.5">
              <Check label={l.options.followRedirects} checked={options.follow} onChange={(v) => setOptions((o) => ({ ...o, follow: v }))} />
              <Check label={l.options.verifyTls} checked={options.verifyTls} onChange={(v) => setOptions((o) => ({ ...o, verifyTls: v }))} />
            </div>
            {!options.verifyTls && <div className="text-[11px] text-amber">{l.options.tlsNote}</div>}
          </div>
        )}
      </Panel>

      {error && <ErrorNote msg={error} />}
        </div>

        <div className="space-y-3">

      {/* ===== 响应 ===== */}
      {!response ? (
        <div className="border border-line-soft bg-panel px-4 py-8 text-center text-[12px] text-muted">
          {l.response.empty}
        </div>
      ) : (
        <Panel
          title={l.response.body}
          right={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className={`text-[13px] font-semibold ${U.statusColorClass(response.status)}`}>
                {response.status || '—'} {response.statusText}
              </span>
              <span className="text-[11px] text-muted">{U.formatDuration(response.timings.totalMs)}</span>
              <span className="text-[11px] text-muted">{U.formatBytes(response.bodyBytes)}</span>
              <button onClick={saveSnapshot} className="text-[11px] text-muted hover:text-phosphor">{l.snaps.save}</button>
              <button onClick={() => setPanel('snaps')} className="text-[11px] text-muted hover:text-phosphor">
                {l.snaps.title}{snapshots.length > 0 ? ` · ${snapshots.length}` : ''}
              </button>
              <button onClick={() => setResponse(null)} className="text-[11px] text-muted hover:text-phosphor">{l.misc.clearResponse}</button>
            </div>
          }
        >
          <ResponseTabs
            respTab={respTab}
            setRespTab={setRespTab}
            view={view}
            setView={setView}
            response={response}
            spec={sentSpec}
            onAddCookie={addCookieHeader}
            l={l}
          />
        </Panel>
      )}
        </div>
      </div>

      {/* 抽屉按需挂载：关掉即卸载，粘过的内容不会残留到下一次 */}
      {panel === 'code' && (
        <Drawer title={l.code.title} onClose={closePanel} width={860}>
          <CodeSnippets doc={currentDoc()} l={l} codeHeight="64vh" />
        </Drawer>
      )}
      {panel === 'transfer' && (
        <Drawer title={l.transfer.title} onClose={closePanel}>
          <RequestTransfer
            toDoc={currentDoc}
            applyDoc={applyDoc}
            buildExport={buildExportEntries}
            mergeImport={mergeImportEntries}
            onDone={(notes) => { setTransferNote(notes); setPanel(null) }}
            l={l}
          />
        </Drawer>
      )}
      {panel === 'proxy' && (
        <Drawer title={l.options.proxyTitle} onClose={closePanel} width={640}>
          <div className="space-y-3">
            <Check
              label={l.options.proxyEnable}
              checked={options.useProxy}
              onChange={(v) => setOptions((o) => ({ ...o, useProxy: v }))}
            />
            <Input
              label={l.options.proxy}
              value={options.proxy}
              onChange={(v) => setOptions((o) => ({ ...o, proxy: v, useProxy: true }))}
              placeholder={l.options.proxyPlaceholder}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Btn
                variant="ghost"
                // useBuiltinProxy 是 useCallback 创建的回调（不是 hook），
                // rules-of-hooks 按 use 前缀命名误判，这里显式豁免
                // eslint-disable-next-line react-hooks/rules-of-hooks
                onClick={() => void useBuiltinProxy()}
                title={proxyInfo?.running ? l.options.capturedTip : l.options.capturedUnavailable}
              >
                {l.options.useCaptured}{proxyInfo?.running ? ` :${proxyInfo.port}` : ''}
              </Btn>
              <span className="text-[11px] text-muted">{options.useProxy ? l.options.proxyHint : l.options.proxyRemember}</span>
            </div>
          </div>
        </Drawer>
      )}
      {panel === 'history' && (
        <Drawer title={l.history.title} onClose={closePanel} width={760}>
          <HistoryPanel
            history={history}
            saved={saved}
            saveName={saveName}
            setSaveName={setSaveName}
            onLoad={loadDraft}
            onSave={() => {
              const entry: Draft = { ...U.trimBodyForStorage(draft()), name: saveName.trim() || `${method} ${url.slice(0, 40)}` }
              setSaved((s) => [entry, ...s].slice(0, 40))
              setSaveName('')
            }}
            onRemoveSaved={(id) => setSaved((s) => s.filter((x) => x.id !== id))}
            onClearHistory={() => setHistory([])}
            onDone={closePanel}
            l={l}
          />
        </Drawer>
      )}
      {panel === 'snaps' && (
        <Drawer title={l.snaps.title} onClose={closePanel} width={760}>
          <SnapshotPanel
            snapshots={snapshots}
            current={response ? U.decodeResponseBody(response).text : null}
            onRemove={(id) => setSnapshots((prev) => prev.filter((s) => s.id !== id))}
            l={l}
          />
        </Drawer>
      )}
      {panel === 'envs' && (
        <Drawer title={l.envs.title} onClose={closePanel} width={640}>
          <EnvPanel
            envs={envStore.envs}
            activeId={envStore.activeId}
            onActivate={(id) => setEnvStore((s) => ({ ...s, activeId: id }))}
            onAdd={() => setEnvStore((s) => {
              const env = newEnv()
              return { envs: [...s.envs, env], activeId: s.activeId ?? env.id }
            })}
            onUpdate={(id, patch) => setEnvStore((s) => ({
              ...s,
              envs: s.envs.map((e) => (e.id === id ? { ...e, ...patch } : e)),
            }))}
            onRemove={(id) => setEnvStore((s) => ({
              ...s,
              envs: s.envs.filter((e) => e.id !== id),
              activeId: s.activeId === id ? null : s.activeId,
            }))}
            l={l}
          />
        </Drawer>
      )}
    </div>
  )
}

/* ================= 响应视图 ================= */

function ResponseTabs({ respTab, setRespTab, view, setView, response, spec, onAddCookie, l }: {
  respTab: RespTab
  setRespTab: (t: RespTab) => void
  view: ViewMode
  setView: (v: ViewMode) => void
  response: HttpRequestResult
  spec: HttpRequestSpec | null
  onAddCookie: (value: string) => void
  l: L
}) {
  /** 代码片段按「实际发出去的请求」生成，便于与当前表单对照 */
  const sentDoc = useMemo(
    () => docFromRequestSpec(spec ?? { method: response.method, url: response.url }, response.url),
    [spec, response],
  )

  /** 实际发出的 wire 报文（请求行 + 头 + 正文） */
  const wire = useMemo(() => buildWireRequest(sentDoc), [sentDoc])

  const decoded = useMemo(() => U.decodeResponseBody(response), [response])

  /** JSON 路径过滤（$.a.b[0] 语法，复用 toolkit 的 evalJsonPath）；仅 JSON 响应可用 */
  const [jsonPath, setJsonPath] = useState('')
  const pathHits = useMemo<{ text: string; error: string | null }>(() => {
    if (!jsonPath.trim() || !decoded.pretty) return { text: '', error: null }
    try {
      const hits = evalJsonPath(JSON.parse(decoded.text), jsonPath)
      return { text: hits.map((h) => JSON.stringify(h, null, 2)).join('\n---\n'), error: null }
    } catch (err) {
      return { text: '', error: (err as Error).message }
    }
  }, [jsonPath, decoded])

  const tabs: { id: RespTab; label: string }[] = [
    { id: 'body', label: l.response.body },
    { id: 'headers', label: l.response.headers },
    { id: 'cookies', label: l.tabs.cookies },
    { id: 'timing', label: l.response.timing },
    { id: 'sent', label: l.response.requestSent },
    { id: 'snippets', label: l.code.responseTab },
  ]

  const bodyText = view === 'pretty' && decoded.pretty ? decoded.pretty : (view === 'hex' ? U.hexDump(decoded.bytes) : decoded.text)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setRespTab(t.id)}
            className={`px-2 py-0.5 text-[11px] border transition-colors ${respTab === t.id ? 'border-phosphor/60 text-phosphor bg-phosphor-faint' : 'border-line-soft text-muted hover:text-phosphor'}`}
          >{t.label}</button>
        ))}
        {respTab === 'body' && (
          <span className="ml-auto flex gap-1">
            {(['pretty', 'raw', 'hex'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-0.5 text-[11px] border ${view === v ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted hover:text-phosphor'}`}
              >{l.response[v]}</button>
            ))}
          </span>
        )}
      </div>

      {respTab === 'body' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted">
            <span>{decoded.ct ?? l.response.noBody}</span>
            <span>{U.formatBytes(response.bodyBytes)}</span>
            <span>{l.response.encoding}: {decoded.charset}</span>
            {response.decompressed && <span className="text-amber">{l.response.decompressed(response.contentEncoding)}</span>}
            {response.truncated && <span className="text-danger">{l.response.truncated}</span>}
            <CopyBtn text={decoded.text} className="ml-auto" />
          </div>
          {decoded.pretty && (
            <div className="space-y-1">
              <input
                value={jsonPath}
                onChange={(e) => setJsonPath(e.target.value)}
                placeholder={l.response.jsonPathHint}
                spellCheck={false}
                className="w-full bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
              />
              {pathHits.error && <div className="text-[11px] text-amber">{l.response.jsonPathBad}: {pathHits.error}</div>}
              {pathHits.text && (
                <pre className="codeblock max-h-[300px] overflow-auto bg-panel-2 border border-phosphor/30 px-3 py-2 text-[12px] text-bright">{pathHits.text}</pre>
              )}
            </div>
          )}
          {decoded.bytes.length === 0 ? (
            <div className="text-[12px] text-muted">{l.response.noBody}</div>
          ) : (
            <pre className="codeblock max-h-[420px] overflow-auto bg-panel-2 border border-line-soft px-3 py-2 text-[12px] text-bright">{bodyText}</pre>
          )}
        </div>
      )}

      {respTab === 'headers' && (
        <div className="space-y-1">
          {response.headers.map(([k, v], i) => (
            <div key={`${k}-${i}`} className="flex gap-2 py-0.5 border-b border-line-soft last:border-0 text-[12px]">
              <span className="shrink-0 w-48 text-phosphor break-all">{k}</span>
              <span className="text-bright break-all">{v}</span>
            </div>
          ))}
          {response.headers.length === 0 && <div className="text-[12px] text-muted">—</div>}
        </div>
      )}

      {respTab === 'cookies' && (
        <div className="space-y-2">
          {decoded.cookies.length === 0 && <div className="text-[12px] text-muted">{l.response.cookieNone}</div>}
          {decoded.cookies.length > 0 && (
            <Btn variant="ghost" onClick={() => onAddCookie(decoded.cookies.map((c) => `${c.name}=${c.value}`).join('; '))}>
              {l.response.cookieToHeader(decoded.cookies.length)}
            </Btn>
          )}
          {decoded.cookies.map((c, i) => (
            <div key={i} className="border border-line-soft bg-panel-2 px-3 py-2 space-y-0.5">
              <div className="text-[12px]">
                <span className="text-phosphor">{c.name}</span>
                <span className="text-muted"> = </span>
                <span className="text-bright break-all">{c.value}</span>
              </div>
              {c.attrs.length > 0 && <div className="text-[11px] text-muted">{c.attrs.join(' · ')}</div>}
            </div>
          ))}
        </div>
      )}

      {respTab === 'timing' && (
        <div className="space-y-2">
          <TimingBar label={l.response.connect} value={response.timings.connectMs} total={response.timings.totalMs} />
          {response.timings.tlsMs > 0 && <TimingBar label={l.response.tls} value={response.timings.tlsMs} total={response.timings.totalMs} />}
          <TimingBar label={l.response.ttfb} value={response.timings.ttfbMs} total={response.timings.totalMs} />
          <TimingBar label={l.response.total} value={response.timings.totalMs} total={response.timings.totalMs} />
          <div className="pt-1 space-y-0.5">
            {response.remoteAddress && <InfoLine k={l.response.remote} v={response.remoteAddress} />}
            {response.redirects.length > 0 && (
              <div className="text-[12px]">
                <span className="text-muted">{l.response.redirects}:</span>
                {response.redirects.map((r, i) => (
                  <div key={i} className="text-bright break-all pl-3">{r.status} → {r.location}</div>
                ))}
              </div>
            )}
          </div>
          {response.tls && (
            <div className="border border-line-soft bg-panel-2 px-3 py-2 space-y-1">
              <div className={`text-[12px] ${response.tls.authorized ? 'text-phosphor' : 'text-danger'}`}>
                {response.tls.authorized ? `✓ ${l.response.tlsOk}` : `✗ ${l.response.tlsBad}`}
              </div>
              <InfoLine k={l.response.protocol} v={response.tls.protocol} />
              <InfoLine k={l.response.cipher} v={response.tls.cipher} />
              <InfoLine k={l.response.issuer} v={response.tls.issuer} />
              <InfoLine k={l.response.validTo} v={response.tls.validTo} />
              {response.tls.authorizationError && <InfoLine k={l.response.tlsBad} v={response.tls.authorizationError} />}
            </div>
          )}
        </div>
      )}

      {respTab === 'sent' && (
        <div className="space-y-2">
          <div className="text-[12px] text-phosphor break-all">{spec?.method} {spec?.url ?? response.url}</div>
          <div className="space-y-0.5">
            {(spec?.headers ?? response.headers).map(([k, v], i) => (
              <div key={i} className="text-[12px] break-all">
                <span className="text-phosphor">{k}</span><span className="text-muted">: </span><span className="text-bright">{v}</span>
              </div>
            ))}
          </div>
          {spec?.bodyText && <pre className="codeblock max-h-[240px] overflow-auto bg-panel-2 border border-line-soft px-3 py-2 text-[12px] text-bright">{spec.bodyText}</pre>}
          <div className="flex items-center gap-2 flex-wrap">
            <CopyBtn text={generateCode('curl', sentDoc)} />
            <CopyBtn text={wire} label={l.response.copyWire} />
          </div>
          <div>
            <div className="text-[11px] text-muted mb-1">{l.response.wire}</div>
            <pre className="codeblock max-h-[240px] overflow-auto bg-panel-2 border border-line-soft px-3 py-2 text-[12px] text-bright">{wire}</pre>
          </div>
        </div>
      )}

      {respTab === 'snippets' && <CodeSnippets doc={sentDoc} l={l} />}
    </div>
  )
}

function TimingBar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.max(2, Math.round((value / total) * 100)) : 0
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11.5px]">
        <span className="text-muted">{label}</span>
        <span className="text-bright">{U.formatDuration(value)} <span className="text-muted">({pct}%)</span></span>
      </div>
      <div className="h-1.5 bg-panel-2 border border-line-soft">
        <div className="h-full bg-phosphor/60" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function InfoLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-[12px]">
      <span className="shrink-0 text-muted">{k}:</span>
      <span className="text-bright break-all">{v}</span>
    </div>
  )
}

function PresetBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors"
    >{label}</button>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-bright cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[color:var(--c-phosphor)]" />
      {label}
    </label>
  )
}

/* ================= 历史 / 收藏 ================= */

function HistoryPanel({ history, saved, saveName, setSaveName, onLoad, onSave, onRemoveSaved, onClearHistory, onDone, l }: {
  history: Draft[]
  saved: Draft[]
  saveName: string
  setSaveName: (v: string) => void
  onLoad: (d: Draft) => void
  onSave: () => void
  onRemoveSaved: (id: string) => void
  onClearHistory: () => void
  /** 选中某条后回调：调用方据此关掉抽屉，让用户直接看到填好的表单 */
  onDone?: () => void
  l: L
}) {
  const [which, setWhich] = useState<'history' | 'saved'>('history')
  const [filter, setFilter] = useState('')
  const list = (which === 'history' ? history : saved).filter((d) =>
    !filter.trim() || `${d.method} ${d.url}`.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <div className="space-y-2">
      {/* 内容在抽屉里，标题由 Drawer 给 —— 这里的页签负责在「历史」与「收藏」之间切 */}
      <div className="flex items-center gap-1">
        <button onClick={() => setWhich('history')} className={`px-2 py-0.5 text-[11px] border ${which === 'history' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}>
          {l.history.title} <span className="text-phosphor/60">{history.length}</span>
        </button>
        <button onClick={() => setWhich('saved')} className={`px-2 py-0.5 text-[11px] border ${which === 'saved' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}>
          {l.history.saved} <span className="text-phosphor/60">{saved.length}</span>
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={l.history.filter}
          className="flex-1 min-w-[140px] bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
        />
        <input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder={l.history.savePrompt}
          className="w-40 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
        />
        <Btn onClick={onSave}>{l.history.save}</Btn>
        {which === 'history' && history.length > 0 && <Btn variant="ghost" onClick={onClearHistory}>{l.history.clear}</Btn>}
      </div>

      {list.length === 0 && (
        <div className="text-[12px] text-muted">{which === 'history' ? l.history.empty : l.history.noSaved}</div>
      )}
      {/* 抽屉里高度够，列表跟着放宽，别让人在小窗口里翻 */}
      <div className="max-h-[60vh] overflow-auto divide-y divide-[color:var(--c-line-soft)]">
        {list.map((d) => (
          <div key={d.id} className="flex items-center gap-2 py-1.5 group">
            <button onClick={() => { onLoad(d); onDone?.() }} className="flex-1 min-w-0 text-left">
              <div className="flex items-center gap-2 text-[11.5px]">
                <span className="shrink-0 text-phosphor w-14">{d.method}</span>
                {d.status != null && <span className={`shrink-0 ${U.statusColorClass(d.status)}`}>{d.status}</span>}
                {d.durationMs != null && <span className="shrink-0 text-muted">{U.formatDuration(d.durationMs)}</span>}
                <span className="text-muted shrink-0">{U.formatTime(d.at)}</span>
              </div>
              <div className="text-[11.5px] text-dim truncate">{d.name ? `${d.name} — ` : ''}{d.url}</div>
            </button>
            {which === 'saved' && (
              <button onClick={() => onRemoveSaved(d.id)} className="shrink-0 text-muted hover:text-danger px-1" title={l.history.remove}>×</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
