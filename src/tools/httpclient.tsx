/**
 * HTTP 客户端工具：主组件只负责状态编排与装配。
 *
 * 拆分结构（行为等价的重构，逻辑原文搬迁）：
 *   - 表单模型与纯转换 → src/lib/httpclient-model.ts
 *   - 表单 → 请求的派生层（multipart / 正文 / 头 / 文档） → src/lib/httpclient-assembly.ts
 *   - 请求配置面板 / 响应视图 / 历史收藏 → src/components/http/{RequestPanel,ResponseTabs,HistoryPanel}.tsx
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Panel, Btn, Input, ErrorNote, Drawer, NoteList } from '../components/ui'
import { CodeSnippets } from '../components/http/CodeSnippets'
import { RequestTransfer } from '../components/http/RequestTransfer'
import { EnvPanel, newEnv, type HttpEnv } from '../components/http/EnvPanel'
import {
  SnapshotPanel,
  SNAPSHOT_KEY,
  addSnapshot,
  snapshotFromResponse,
  type ResponseSnapshot,
} from '../components/http/SnapshotPanel'
import type { Row } from '../components/http/KVEditor'
import { RequestPanel, Check } from '../components/http/RequestPanel'
import { ResponseTabs } from '../components/http/ResponseTabs'
import { HistoryPanel } from '../components/http/HistoryPanel'
import { useLocalized } from '../lib/i18n'
import { httpClientL } from '../lib/locales/httpclient'
import type { HttpRequestResult, HttpRequestSpec } from '../lib/http-types'
import { mergeRequests, type RequestDoc, type RequestEntry } from '../lib/http-codegen'
import * as U from '../lib/http-utils'
import { useRequestAssembly } from '../lib/httpclient-assembly'
import {
  applyEnvToRequest,
  authHeaderPairs,
  BODY_CT,
  buildFinalHeaders,
  DEFAULT_AUTH,
  DEFAULT_OPTIONS,
  docBodyFromDraft,
  draftFromDoc,
  DRAFT_KEY,
  ENVS_KEY,
  HISTORY_KEY,
  inferBodyMode,
  MAX_HISTORY,
  METHODS,
  row,
  sameParams,
  SAVED_KEY,
  type AuthState,
  type BodyMode,
  type Draft,
  type OptState,
  type PickedFile,
  type RespTab,
  type Tab,
  type ViewMode,
} from '../lib/httpclient-model'

/* ================= 主组件 ================= */

export function HttpClientTool() {
  const l = useLocalized(httpClientL)
  /** 上次未发出去的请求草稿（代理等配置随它一起记住） */
  const [restored] = useState<Draft | null>(() => U.loadJson<Draft | null>(DRAFT_KEY, null))
  const [method, setMethod] = useState(() => restored?.method ?? 'GET')
  const [url, setUrl] = useState(() => restored?.url ?? 'https://httpbin.org/get?limit=10')
  const [params, setParams] = useState<Row[]>([])
  const [headers, setHeaders] = useState<Row[]>(() =>
    restored?.headers?.length ? restored.headers : [row('Accept', 'application/json')],
  )
  const [bodyMode, setBodyMode] = useState<BodyMode>(
    () => (restored?.bodyMode as BodyMode) ?? 'none',
  )
  const [bodyRaw, setBodyRaw] = useState(() => restored?.bodyRaw ?? '')
  const [fields, setFields] = useState<Row[]>(() => restored?.fields ?? [])
  const [auth, setAuth] = useState<AuthState>(() => restored?.auth ?? DEFAULT_AUTH)
  const [options, setOptions] = useState<OptState>(() => ({
    ...DEFAULT_OPTIONS,
    ...(restored?.options ?? {}),
  }))
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
  const [panel, setPanel] = useState<
    'code' | 'transfer' | 'proxy' | 'history' | 'envs' | 'snaps' | null
  >(null)
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
    U.loadJson(ENVS_KEY, { envs: [] as HttpEnv[], activeId: null }),
  )
  /** 响应快照：解码后的正文文本，供「保存 → 再发一次 → 对比」 */
  const [snapshots, setSnapshots] = useState<ResponseSnapshot[]>(() =>
    U.loadJson<ResponseSnapshot[]>(SNAPSHOT_KEY, []),
  )

  /* ---- 初始化：抓包代理状态（历史/收藏由 useState 惰性读取） ---- */
  useEffect(() => {
    window.electronAPI?.proxy
      ?.state()
      .then((s) => setProxyInfo({ running: s.running, port: s.port }))
      .catch(() => setProxyInfo(null))
  }, [])

  /* ---- 当前草稿持久化：代理、超时、请求头等配置重启后仍在 ---- */
  const draftSnapshot = useMemo(
    () => ({ method, url, headers, bodyMode, bodyRaw, fields, auth, options }),
    [method, url, headers, bodyMode, bodyRaw, fields, auth, options],
  )

  /** 所有 localStorage 写入收敛在这里：失败必须在主界面上可感知，绝不静默丢数据 */
  const persist = useCallback(
    (key: string, value: unknown): void => {
      if (!U.saveJson(key, value)) setTransferNote([l.errors.storageFull])
    },
    [l],
  )

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
  const pickInto = useCallback(
    async (apply: (f: PickedFile | null) => void): Promise<void> => {
      const api = window.electronAPI?.http
      if (!api) {
        setTransferNote([l.errors.desktopOnly])
        return
      }
      const r = await api.pickFile()
      if (!r.ok) {
        if (!r.canceled) {
          setTransferNote([
            r.error === 'FILE_TOO_LARGE'
              ? l.body.fileTooLarge
              : `${l.errors.requestFailed}: ${r.error ?? ''}`,
          ])
        }
        return
      }
      apply({
        name: r.name ?? 'file',
        base64: r.base64 ?? '',
        bytes: r.bytes ?? 0,
        contentType: U.guessContentType(r.name ?? ''),
      })
    },
    [l],
  )

  const pickBodyFile = useCallback(() => void pickInto(setFilePick), [pickInto])

  /** 把响应里的 Set-Cookie 汇成一个 Cookie 请求头：同名替换，没有就追加 */
  const addCookieHeader = useCallback(
    (value: string) => {
      setHeaders((rows) => {
        const i = rows.findIndex((r) => r.name.toLowerCase() === 'cookie')
        if (i >= 0) return rows.map((r, j) => (j === i ? { ...r, value, enabled: true } : r))
        return [...rows, { id: U.newRowId(), name: 'Cookie', value, enabled: true }]
      })
      setTransferNote([l.headers.cookieAdded])
    },
    [l],
  )

  const pickFieldFile = useCallback(
    (rowId: string) => {
      void pickInto((f) => {
        if (f) setFileFieldData((m) => ({ ...m, [rowId]: f }))
      })
    },
    [pickInto],
  )

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
  const draft = useCallback(
    (): Draft => ({
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
    }),
    [method, url, headers, bodyMode, bodyRaw, fields, auth, options],
  )

  const loadDraft = useCallback(
    (d: Draft) => {
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
    },
    [l],
  )

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
  const buildExportEntries = useCallback(
    (): RequestEntry[] =>
      saved.map((d) => ({
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
      })),
    [saved],
  )

  /** 导入的条目并入收藏（同「名称 + 方法 + URL」跳过） */
  const mergeImportEntries = useCallback(
    (entries: RequestEntry[]): { added: number; skipped: number } => {
      const res = mergeRequests(buildExportEntries(), entries)
      if (res.added > 0) {
        const now = Date.now()
        const fresh = res.merged
          .slice(0, res.added)
          .map((e, i) => draftFromDoc(e.doc, e.name, now + i))
        setSaved((s) => [...fresh, ...s].slice(0, 40))
      }
      return { added: res.added, skipped: res.skipped }
    },
    [buildExportEntries],
  )

  /* ---- 表单 → 请求的派生（multipart / 正文 / 头 / 中立文档），见 httpclient-assembly ---- */
  const { builtBody, authHeaders, finalHeaders, currentDoc } = useRequestAssembly({
    method,
    url,
    headers,
    bodyMode,
    bodyRaw,
    fields,
    auth,
    options,
    filePick,
    fileFields,
    fileFieldData,
  })

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
    /* ---- 环境变量插值：只在这一步替换，表单 / 收藏 / 导出始终是 {{}} 原文 ----
       未启用环境时原样发送（占位符不进 missing，否则没配环境就没法发含 {{}} 的请求） */
    const applied = envMap
      ? applyEnvToRequest({
          url: target.includes('://') ? target : `http://${target}`,
          headers: finalHeaders(),
          bodyText: builtBody.text,
          envMap,
          formFields: bodyMode === 'form' ? fields : null,
        })
      : {
          ok: true as const,
          url: target.includes('://') ? target : `http://${target}`,
          headers: finalHeaders(),
          bodyText: builtBody.text,
        }
    if (!applied.ok) {
      setError(l.errors.missingVars(applied.missing))
      return
    }
    const spec: HttpRequestSpec = {
      method,
      url: applied.url,
      headers: applied.headers,
      bodyText: applied.bodyText,
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
        const entry: Draft = {
          ...U.trimBodyForStorage(draft()),
          status: last.status,
          durationMs: last.timings.totalMs,
        }
        setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY))
      }
      if (repeat > 1 && runs.length > 0)
        setTransferNote([l.misc.repeatDone(runs.length, runs.join(' · '))])
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
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
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
          onChange={(e) =>
            setRepeat(Math.min(20, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))
          }
          title={l.misc.repeatTip}
          spellCheck={false}
          className="w-12 shrink-0 bg-panel-2 border border-line-soft px-1.5 py-1.5 text-[12px] text-bright text-center focus:border-phosphor/40"
        />
        <Btn variant="primary" onClick={() => void send()} disabled={sending}>
          {sending ? l.sending : l.send}
        </Btn>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Btn
          onClick={() => {
            setTransferNote([])
            setPanel('transfer')
          }}
        >
          {l.transfer.open}
        </Btn>
        <Btn onClick={() => setPanel('code')}>{l.code.title}</Btn>
        {/* 代理与历史也收在这里：状态直接写在按钮上，收起来不等于看不见 */}
        <Btn
          onClick={() => setPanel('proxy')}
          className={options.useProxy ? 'border-phosphor/50 text-phosphor' : ''}
        >
          {l.options.proxyTitle} ·{' '}
          {options.useProxy && options.proxy ? options.proxy : l.options.proxyDirect}
        </Btn>
        <Btn onClick={() => setPanel('history')}>
          {l.history.title}
          {history.length > 0 ? ` · ${history.length}` : ''}
        </Btn>
        <Btn
          onClick={() => setPanel('envs')}
          className={envMap ? 'border-phosphor/50 text-phosphor' : ''}
        >
          {l.envs.title} ·{' '}
          {envStore.envs.find((e) => e.id === envStore.activeId)?.name?.trim() || l.envs.none}
        </Btn>
        <span className="text-[10.5px] text-muted">{l.misc.sendTip}</span>
      </div>
      <NoteList lines={transferNote} />

      <div className="space-y-3 min-[1700px]:grid min-[1700px]:grid-cols-2 min-[1700px]:items-start min-[1700px]:gap-3 min-[1700px]:space-y-0">
        <div className="space-y-3">
          {/* ===== 请求配置 ===== */}
          <RequestPanel
            l={l}
            tab={tab}
            setTab={setTab}
            params={params}
            onParamsChange={onParamsChange}
            headers={headers}
            setHeaders={setHeaders}
            bodyMode={bodyMode}
            setBodyMode={setBodyMode}
            bodyRaw={bodyRaw}
            setBodyRaw={setBodyRaw}
            fields={fields}
            setFields={setFields}
            auth={auth}
            setAuth={setAuth}
            options={options}
            setOptions={setOptions}
            authHeaders={authHeaders}
            contentType={builtBody.contentType}
            filePick={filePick}
            setFilePick={setFilePick}
            pickBodyFile={pickBodyFile}
            fileFields={fileFields}
            setFileFields={setFileFields}
            fileFieldData={fileFieldData}
            setFileFieldData={setFileFieldData}
            pickFieldFile={pickFieldFile}
          />

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
                  <span
                    className={`text-[13px] font-semibold ${U.statusColorClass(response.status)}`}
                  >
                    {response.status || '—'} {response.statusText}
                  </span>
                  <span className="text-[11px] text-muted">
                    {U.formatDuration(response.timings.totalMs)}
                  </span>
                  <span className="text-[11px] text-muted">
                    {U.formatBytes(response.bodyBytes)}
                  </span>
                  <button
                    onClick={saveSnapshot}
                    className="text-[11px] text-muted hover:text-phosphor"
                  >
                    {l.snaps.save}
                  </button>
                  <button
                    onClick={() => setPanel('snaps')}
                    className="text-[11px] text-muted hover:text-phosphor"
                  >
                    {l.snaps.title}
                    {snapshots.length > 0 ? ` · ${snapshots.length}` : ''}
                  </button>
                  <button
                    onClick={() => setResponse(null)}
                    className="text-[11px] text-muted hover:text-phosphor"
                  >
                    {l.misc.clearResponse}
                  </button>
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
            onDone={(notes) => {
              setTransferNote(notes)
              setPanel(null)
            }}
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
                {l.options.useCaptured}
                {proxyInfo?.running ? ` :${proxyInfo.port}` : ''}
              </Btn>
              <span className="text-[11px] text-muted">
                {options.useProxy ? l.options.proxyHint : l.options.proxyRemember}
              </span>
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
              const entry: Draft = {
                ...U.trimBodyForStorage(draft()),
                name: saveName.trim() || `${method} ${url.slice(0, 40)}`,
              }
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
            onAdd={() =>
              setEnvStore((s) => {
                const env = newEnv()
                return { envs: [...s.envs, env], activeId: s.activeId ?? env.id }
              })
            }
            onUpdate={(id, patch) =>
              setEnvStore((s) => ({
                ...s,
                envs: s.envs.map((e) => (e.id === id ? { ...e, ...patch } : e)),
              }))
            }
            onRemove={(id) =>
              setEnvStore((s) => ({
                ...s,
                envs: s.envs.filter((e) => e.id !== id),
                activeId: s.activeId === id ? null : s.activeId,
              }))
            }
            l={l}
          />
        </Drawer>
      )}
    </div>
  )
}
