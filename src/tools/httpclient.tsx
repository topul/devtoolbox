import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, CopyBtn } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { httpClientL } from '../lib/locales/httpclient'
import type { HttpRequestResult, HttpRequestSpec } from '../lib/http-types'
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
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('https://httpbin.org/get?limit=10')
  const [params, setParams] = useState<Row[]>([])
  const [headers, setHeaders] = useState<Row[]>([row('Accept', 'application/json')])
  const [bodyMode, setBodyMode] = useState<BodyMode>('none')
  const [bodyRaw, setBodyRaw] = useState('')
  const [fields, setFields] = useState<Row[]>([])
  const [auth, setAuth] = useState<AuthState>(DEFAULT_AUTH)
  const [options, setOptions] = useState<OptState>(DEFAULT_OPTIONS)
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

  /* ---- 初始化：抓包代理状态（历史/收藏由 useState 惰性读取） ---- */
  useEffect(() => {
    window.electronAPI?.proxy?.state()
      .then((s) => setProxyInfo({ running: s.running, port: s.port }))
      .catch(() => setProxyInfo(null))
  }, [])

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
  const authHeaders = useMemo((): [string, string][] => {
    if (auth.type === 'basic') {
      const raw = `${auth.username}:${auth.password}`
      const b64 = U.bytesToB64(new TextEncoder().encode(raw))
      return [['Authorization', `Basic ${b64}`]]
    }
    if (auth.type === 'bearer') return auth.token ? [['Authorization', `Bearer ${auth.token}`]] : []
    if (auth.type === 'apikey') {
      const name = auth.headerName.trim() || 'X-API-Key'
      return [[name, `${auth.headerPrefix}${auth.token}`]]
    }
    return []
  }, [auth])

  /** 最终请求头：手工行 + 认证 + 正文类型 */
  const finalHeaders = useCallback((): [string, string][] => {
    const out: [string, string][] = headers
      .filter((h) => h.enabled && h.name.trim())
      .map((h) => [h.name.trim(), h.value])
    for (const [k, v] of authHeaders) {
      const i = out.findIndex(([n]) => n.toLowerCase() === k.toLowerCase())
      if (i >= 0) out[i] = [out[i][0], v]
      else out.push([k, v])
    }
    if (builtBody.contentType) {
      const has = out.some(([n]) => n.toLowerCase() === 'content-type')
      if (!has) out.push(['Content-Type', builtBody.contentType])
    }
    return out
  }, [headers, authHeaders, builtBody])

  const curlText = useMemo(() => U.buildCurl({
    method,
    url,
    headers: finalHeaders(),
    bodyText: builtBody.text,
    followRedirects: options.follow,
    verifyTls: options.verifyTls,
    proxy: options.useProxy ? options.proxy : null,
  }), [method, url, finalHeaders, builtBody, options])

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
      <div className="text-[10.5px] text-muted">{l.misc.sendTip}</div>

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
            <div className="space-y-1.5">
              <Check label={l.options.proxy} checked={options.useProxy} onChange={(v) => setOptions((o) => ({ ...o, useProxy: v }))} />
              {options.useProxy && (
                <>
                  <Input value={options.proxy} onChange={(v) => setOptions((o) => ({ ...o, proxy: v }))} placeholder={l.options.proxyPlaceholder} />
                  <div className="flex items-center gap-2 flex-wrap">
                    <Btn
                      variant="ghost"
                      onClick={() => { setProxyInfo(proxyInfo); void window.electronAPI?.proxy.state().then((s) => { setProxyInfo({ running: s.running, port: s.port }); setOptions((o) => ({ ...o, proxy: `http://127.0.0.1:${s.port}` })) }) }}
                    >
                      {l.options.useCaptured}{proxyInfo?.running ? ` :${proxyInfo.port}` : ''}
                    </Btn>
                    <span className="text-[11px] text-muted">
                      {proxyInfo?.running ? l.options.capturedTip : l.options.capturedUnavailable}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Panel>

      {error && <ErrorNote msg={error} />}

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
            curlText={curlText}
            l={l}
          />
        </Panel>
      )}

      {/* ===== 历史 / 收藏 ===== */}
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
        l={l}
      />
    </div>
  )
}

/* ================= 响应视图 ================= */

function ResponseTabs({ respTab, setRespTab, view, setView, response, spec, curlText, l }: {
  respTab: RespTab
  setRespTab: (t: RespTab) => void
  view: ViewMode
  setView: (v: ViewMode) => void
  response: HttpRequestResult
  spec: HttpRequestSpec | null
  curlText: string
  l: L
}) {
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
    { id: 'snippets', label: l.snippets.title },
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
            <CopyBtn text={curlText} />
          </div>
        </div>
      )}

      {respTab === 'snippets' && (
        <div className="space-y-3">
          <SnippetBlock title={l.snippets.curl} code={curlText} />
          <SnippetBlock title={l.snippets.fetch} code={U.buildFetchSnippet({ method: spec?.method ?? 'GET', url: spec?.url ?? response.url, headers: spec?.headers ?? [], bodyText: spec?.bodyText ?? null })} />
          <SnippetBlock title={l.snippets.node} code={U.buildNodeSnippet({ method: spec?.method ?? 'GET', url: spec?.url ?? response.url, headers: spec?.headers ?? [], bodyText: spec?.bodyText ?? null })} />
          <SnippetBlock title={l.snippets.python} code={U.buildPythonSnippet({ method: spec?.method ?? 'GET', url: spec?.url ?? response.url, headers: spec?.headers ?? [], bodyText: spec?.bodyText ?? null, verifyTls: spec?.rejectUnauthorized !== false })} />
        </div>
      )}
    </div>
  )
}

function SnippetBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted">{title}</span>
        <CopyBtn text={code} />
      </div>
      <pre className="codeblock max-h-[220px] overflow-auto bg-panel-2 border border-line-soft px-3 py-2 text-[11.5px] text-bright">{code}</pre>
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

function HistoryPanel({ history, saved, saveName, setSaveName, onLoad, onSave, onRemoveSaved, onClearHistory, l }: {
  history: Draft[]
  saved: Draft[]
  saveName: string
  setSaveName: (v: string) => void
  onLoad: (d: Draft) => void
  onSave: () => void
  onRemoveSaved: (id: string) => void
  onClearHistory: () => void
  l: L
}) {
  const [which, setWhich] = useState<'history' | 'saved'>('history')
  const [filter, setFilter] = useState('')
  const list = (which === 'history' ? history : saved).filter((d) =>
    !filter.trim() || `${d.method} ${d.url}`.toLowerCase().includes(filter.trim().toLowerCase()))

  return (
    <Panel
      title={which === 'history' ? l.history.title : l.history.saved}
      right={
        <div className="flex items-center gap-1">
          <button onClick={() => setWhich('history')} className={`px-2 py-0.5 text-[11px] border ${which === 'history' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}>{l.history.title}</button>
          <button onClick={() => setWhich('saved')} className={`px-2 py-0.5 text-[11px] border ${which === 'saved' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}>{l.history.saved}</button>
        </div>
      }
    >
      <div className="space-y-2">
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
        <div className="max-h-[260px] overflow-auto divide-y divide-[color:var(--c-line-soft)]">
          {list.map((d) => (
            <div key={d.id} className="flex items-center gap-2 py-1.5 group">
              <button onClick={() => onLoad(d)} className="flex-1 min-w-0 text-left">
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
    </Panel>
  )
}
