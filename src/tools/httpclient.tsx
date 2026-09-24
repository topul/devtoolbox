import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, CopyBtn, Drawer, NoteList } from '../components/ui'
import { CodeSnippets } from '../components/http/CodeSnippets'
import { RequestTransfer } from '../components/http/RequestTransfer'
import { useLocalized } from '../lib/i18n'
import { httpClientL } from '../lib/locales/httpclient'
import type { HttpRequestResult, HttpRequestSpec } from '../lib/http-types'
import {
  docFromRequestSpec,
  generateCode,
  mergeRequests,
  type RequestBody,
  type RequestDoc,
  type RequestEntry,
} from '../lib/http-codegen'
import * as U from '../lib/http-utils'

/* ================= 类型 ================= */

interface Row {
  id: string
  name: string
  value: string
  enabled: boolean
}

type BodyMode = 'none' | 'json' | 'xml' | 'text' | 'html' | 'javascript' | 'form' | 'multipart'
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
}

const HISTORY_KEY = 'devtoolbox-http-history'
const SAVED_KEY = 'devtoolbox-http-saved'
const DRAFT_KEY = 'devtoolbox-http-draft'
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

/* ================= KV 编辑器 ================= */

function KVEditor({ rows, onChange, addLabel, nameLabel, valueLabel, removeLabel, headerSuggest }: {
  rows: Row[]
  onChange: (rows: Row[]) => void
  addLabel: string
  nameLabel: string
  valueLabel: string
  removeLabel: string
  headerSuggest?: boolean
}) {
  const update = (id: string, patch: Partial<Row>): void =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-1.5">
      {rows.length === 0 && <div className="text-[11.5px] text-muted">—</div>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(r.id, { enabled: e.target.checked })}
            className="shrink-0 accent-[color:var(--c-phosphor)]"
          />
          <input
            value={r.name}
            onChange={(e) => update(r.id, { name: e.target.value })}
            placeholder={nameLabel}
            spellCheck={false}
            list={headerSuggest ? 'http-header-names' : undefined}
            className="w-1/3 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
          />
          <input
            value={r.value}
            onChange={(e) => update(r.id, { value: e.target.value })}
            placeholder={valueLabel}
            spellCheck={false}
            className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
          />
          <button
            onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
            className="shrink-0 text-muted hover:text-danger px-1.5 text-[13px]"
            title={removeLabel}
          >×</button>
        </div>
      ))}
      <Btn variant="ghost" onClick={() => onChange([...rows, row()])}>+ {addLabel}</Btn>
      {headerSuggest && <HeaderSuggestList />}
    </div>
  )
}

const HEADER_NAMES = [
  'Accept', 'Accept-Encoding', 'Accept-Language', 'Authorization', 'Cache-Control', 'Content-Type',
  'Cookie', 'Origin', 'Referer', 'User-Agent', 'X-Requested-With', 'X-Forwarded-For', 'X-API-Key',
  'If-None-Match', 'If-Modified-Since', 'Range',
]

function HeaderSuggestList() {
  return (
    <datalist id="http-header-names">
      {HEADER_NAMES.map((h) => <option key={h} value={h} />)}
    </datalist>
  )
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
  const [panel, setPanel] = useState<'code' | 'transfer' | 'proxy' | 'history' | null>(null)
  /** 抽屉里产生的提示，关掉抽屉后要留在主界面上，否则用户看不到「填好了」 */
  const [transferNote, setTransferNote] = useState<string[]>([])

  /* ---- 初始化：抓包代理状态（历史/收藏由 useState 惰性读取） ---- */
  useEffect(() => {
    window.electronAPI?.proxy?.state()
      .then((s) => setProxyInfo({ running: s.running, port: s.port }))
      .catch(() => setProxyInfo(null))
  }, [])

  /* ---- 当前草稿持久化：代理、超时、请求头等配置重启后仍在 ---- */
  const draftSnapshot = useMemo(() => ({ method, url, headers, bodyMode, bodyRaw, fields, auth, options }), [method, url, headers, bodyMode, bodyRaw, fields, auth, options])
  useEffect(() => {
    U.saveJson(DRAFT_KEY, { ...draftSnapshot, id: 'draft', at: Date.now() })
  }, [draftSnapshot])

  useEffect(() => {
    U.saveJson(HISTORY_KEY, history.slice(0, MAX_HISTORY))
  }, [history])

  useEffect(() => {
    U.saveJson(SAVED_KEY, saved)
  }, [saved])

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
  }, [])

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

  const builtBody = useMemo((): { text: string | null; contentType: string | null } => {
    if (bodyMode === 'none') return { text: null, contentType: null }
    if (bodyMode === 'form') {
      const body = U.buildQueryRows(fields)
      return body ? { text: body, contentType: BODY_CT.form } : { text: null, contentType: null }
    }
    if (bodyMode === 'multipart' && multipart) {
      return { text: multipart.body, contentType: `multipart/form-data; boundary=${multipart.boundary}` }
    }
    if (!bodyRaw.trim()) return { text: null, contentType: null }
    return { text: bodyRaw, contentType: BODY_CT[bodyMode] || null }
  }, [bodyMode, bodyRaw, fields, multipart])

  /* ---- 认证派生请求头 ---- */
  const authHeaders = useMemo((): [string, string][] => authHeaderPairs(auth), [auth])

  /** 最终请求头：手工行 + 认证 + 正文类型 */
  const finalHeaders = useCallback((): [string, string][] =>
    buildFinalHeaders({ headers, authHeaders, bodyContentType: builtBody.contentType }),
  [headers, authHeaders, builtBody])

  const docBody = useCallback((): RequestBody => bodyFromParts(bodyMode, fields, bodyRaw), [bodyMode, fields, bodyRaw])

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
    const spec: HttpRequestSpec = {
      method,
      url: target.includes('://') ? target : `http://${target}`,
      headers: finalHeaders(),
      bodyText: builtBody.text,
      timeoutMs: options.timeout,
      followRedirects: options.follow,
      maxRedirects: options.maxRedirects,
      rejectUnauthorized: options.verifyTls,
      proxy: options.useProxy ? options.proxy.trim() : null,
    }
    setSending(true)
    setError(null)
    try {
      const res = await api.send(spec)
      setResponse(res)
      setSentSpec(spec)
      setView('pretty')
      setRespTab('body')
      if (!res.ok) setError(`${l.errors.requestFailed}: ${res.error ?? ''}`)
      const entry: Draft = { ...draft(), status: res.status, durationMs: res.timings.totalMs }
      setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY))
    } catch (err) {
      setError(`${l.errors.requestFailed}: ${(err as Error).message}`)
    } finally {
      setSending(false)
    }
  }, [url, method, finalHeaders, builtBody, options, l, draft])

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
              ]}
            />
            {(bodyMode === 'form' || bodyMode === 'multipart') && (
              <KVEditor rows={fields} onChange={setFields} addLabel={l.kv.add} nameLabel={l.kv.name} valueLabel={l.kv.value} removeLabel={l.kv.remove} />
            )}
            {bodyMode !== 'none' && bodyMode !== 'form' && bodyMode !== 'multipart' && (
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
              const entry: Draft = { ...draft(), name: saveName.trim() || `${method} ${url.slice(0, 40)}` }
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
    </div>
  )
}

/* ================= 响应视图 ================= */

function ResponseTabs({ respTab, setRespTab, view, setView, response, spec, l }: {
  respTab: RespTab
  setRespTab: (t: RespTab) => void
  view: ViewMode
  setView: (v: ViewMode) => void
  response: HttpRequestResult
  spec: HttpRequestSpec | null
  l: L
}) {
  /** 代码片段按「实际发出去的请求」生成，便于与当前表单对照 */
  const sentDoc = useMemo(
    () => docFromRequestSpec(spec ?? { method: response.method, url: response.url }, response.url),
    [spec, response],
  )

  const decoded = useMemo(() => {
    const ct = U.headerValueOf(response.headers, 'content-type')
    const bytes = U.b64ToBytes(response.bodyBase64)
    const charset = U.detectCharset(ct)
    const text = U.bytesToText(bytes, charset)
    return {
      ct,
      bytes,
      text,
      charset,
      binary: U.isProbablyBinary(bytes),
      pretty: U.prettyJson(text),
      cookies: U.parseSetCookies(response.headers),
    }
  }, [response])

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
          <div className="flex items-center gap-2">
            <CopyBtn text={generateCode('curl', sentDoc)} />
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
