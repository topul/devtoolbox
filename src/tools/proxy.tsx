import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Panel, Btn, TA, Input, ErrorNote, CopyBtn } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { proxyL } from '../lib/locales/proxy'
import type {
  CaInfo,
  HeaderOp,
  InterceptRequest,
  ProxyEvent,
  ProxyRule,
  ProxySession,
  ProxyState,
} from '../lib/proxy-types'
import * as U from '../lib/http-utils'

type L = typeof proxyL['zh']

/** 断点处置结果（与主进程 InterceptDecision 对齐，额外带 id） */
type InterceptDecisionInput = {
  id: string
  action: 'forward' | 'drop'
  method?: string
  url?: string
  headers?: [string, string][]
  bodyBase64?: string
  mock?: { status: number; headers: [string, string][]; bodyText?: string } | null
}

const DEFAULT_PORT = 8899

/* ================= 文本 <-> 头部 ================= */

function headersToText(list: [string, string][]): string {
  return list.map(([k, v]) => `${k}: ${v}`).join('\n')
}

function textToHeaders(text: string): [string, string][] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':')
      if (i < 0) return [line, ''] as [string, string]
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()] as [string, string]
    })
    .filter(([k]) => k.length > 0)
}

function emptyRule(): ProxyRule {
  return {
    id: `r_${Math.random().toString(36).slice(2, 10)}`,
    name: '',
    enabled: true,
    method: 'ANY',
    host: '',
    path: '',
    scheme: 'any',
    breakpoint: false,
    delayMs: 0,
    block: false,
    mock: null,
    reqHeaderOps: [],
    resHeaderOps: [],
    reqBodyFind: '',
    reqBodyReplace: '',
    reqBodyRegex: false,
    resBodyFind: '',
    resBodyReplace: '',
    resBodyRegex: false,
  }
}

/* ================= 主组件 ================= */

export function TrafficProxyTool() {
  const l = useLocalized(proxyL)
  const [state, setState] = useState<ProxyState | null>(null)
  const [sessions, setSessions] = useState<ProxySession[]>([])
  const [selected, setSelected] = useState<ProxySession | null>(null)
  const [filter, setFilter] = useState('')
  const [schemeFilter, setSchemeFilter] = useState<'all' | 'http' | 'https' | 'tunnel'>('all')
  const [follow, setFollow] = useState(true)
  const [rules, setRules] = useState<ProxyRule[]>([])
  const [editing, setEditing] = useState<ProxyRule | null>(null)
  const [intercept, setIntercept] = useState<InterceptRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [portInput, setPortInput] = useState(String(DEFAULT_PORT))
  const [busy, setBusy] = useState(false)

  const api = typeof window !== 'undefined' ? window.electronAPI?.proxy : undefined
  const httpApi = typeof window !== 'undefined' ? window.electronAPI?.http : undefined

  /* ---- 事件订阅 ---- */
  useEffect(() => {
    if (!api) return
    const off = api.onEvent((evt: ProxyEvent) => {
      if (evt.type === 'session') {
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === evt.session.id)
          if (idx >= 0) {
            const next = prev.slice()
            next[idx] = evt.session
            return next
          }
          // 主进程侧上限 500，渲染侧同样封顶，避免长跑后表格重绘变慢
          const appended = [...prev, evt.session]
          return appended.length > 600 ? appended.slice(appended.length - 600) : appended
        })
        setSelected((cur) => (cur && cur.id === evt.session.id ? evt.session : cur))
      } else if (evt.type === 'state') {
        setState(evt.state)
      } else if (evt.type === 'intercept') {
        setIntercept(evt.request)
      } else if (evt.type === 'intercept-resolved') {
        setIntercept((cur) => (cur && cur.id === evt.id ? null : cur))
        if (evt.auto) setNotice(l.intercept.autoResolved)
      } else if (evt.type === 'error') {
        setError(evt.message)
      }
    })
    return off
  }, [api, l])

  /* ---- 初始状态 ---- */
  useEffect(() => {
    if (!api) return
    api.state().then((s) => {
      setState(s)
      setPortInput(String(s.port || DEFAULT_PORT))
    }).catch(() => {})
    api.sessions().then(setSessions).catch(() => {})
    api.rules().then(setRules).catch(() => {})
  }, [api])

  const start = useCallback(async (mitm: boolean) => {
    if (!api) return
    setBusy(true)
    setError(null)
    try {
      const s = await api.start(Number(portInput) || DEFAULT_PORT, mitm)
      setState(s)
      if (!s.running && s.lastError) setError(l.errors.startFailed(s.lastError))
    } finally {
      setBusy(false)
    }
  }, [api, portInput, l])

  const stop = useCallback(async () => {
    if (!api) return
    setBusy(true)
    try {
      const next = await api.stop()
      // 代理停了但系统代理还指着它，会把用户网络带断；这里自动还原
      if (state?.systemProxy.enabled) {
        const restored = await api.systemRestore()
        setState({ ...next, systemProxy: restored })
      } else {
        setState(next)
      }
    } finally {
      setBusy(false)
    }
  }, [api, state])

  const toggleMitm = useCallback(async (mitm: boolean) => {
    if (!api) return
    await api.setMitm(mitm)
    if (state?.running) setState(await api.start(state.port, mitm))
    else setState(await api.state())
  }, [api, state])

  const clearSessions = useCallback(async () => {
    if (!api) return
    if (!window.confirm(l.controls.clearConfirm)) return
    setState(await api.clear())
    setSessions([])
    setSelected(null)
  }, [api, l])

  const exportSessions = useCallback(async (format: 'json' | 'har') => {
    if (!api) return
    const res = await api.exportSessions(format)
    if (res.ok) setNotice(l.controls.exported(res.count))
    else if (!res.canceled) setError(l.errors.exportFailed(res.error ?? ''))
  }, [api, l])

  const saveRule = useCallback(async (rule: ProxyRule) => {
    if (!api) return
    setRules(await api.rulesUpsert(rule))
    setEditing(null)
    setNotice(l.rules.saved)
  }, [api, l])

  const removeRule = useCallback(async (id: string) => {
    if (!api) return
    if (!window.confirm(l.rules.removeConfirm)) return
    setRules(await api.rulesRemove(id))
  }, [api, l])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return sessions.filter((s) => {
      if (schemeFilter !== 'all' && s.scheme !== schemeFilter) return false
      if (!q) return true
      return `${s.method} ${s.host} ${s.path} ${s.status ?? ''}`.toLowerCase().includes(q)
    })
  }, [sessions, filter, schemeFilter])

  const resolveIntercept = useCallback(async (decision: InterceptDecisionInput) => {
    if (!api) return
    await api.resolveIntercept(decision)
    setIntercept(null)
  }, [api])

  /* ---- 抓包列表自动滚动 ---- */
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [sessions.length, follow])

  if (typeof window !== 'undefined' && !window.electronAPI) {
    return <ErrorNote msg={l.errors.desktopOnly} />
  }

  const running = state?.running ?? false
  const ca = state?.caInfo ?? null
  // macOS 上改系统代理需要管理员授权，界面要提前说明，否则用户会以为失败了
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

  return (
    <div className="space-y-3">
      {error && <ErrorNote msg={error} />}
      {notice && (
        <div className="border border-phosphor/40 bg-phosphor-faint px-3 py-1.5 text-[12px] text-phosphor flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-muted hover:text-phosphor">×</button>
        </div>
      )}

      {/* ===== 断点拦截 ===== */}
      {intercept && (
        <InterceptCard
          request={intercept}
          l={l}
          onResolve={resolveIntercept}
        />
      )}

      {/* ===== 控制条 ===== */}
      <Panel
        title={l.status[running ? 'running' : 'stopped']}
        right={
          <span className="flex items-center gap-2 text-[11px]">
            <span className={running ? 'text-phosphor' : 'text-muted'}>● {running ? l.status.running : l.status.stopped}</span>
            <span className="text-muted">{l.status.sessions}: {sessions.length}</span>
          </span>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-24">
              <Input label={l.controls.portLabel} value={portInput} onChange={setPortInput} />
            </div>
            {!running ? (
              <Btn variant="primary" onClick={() => void start(true)} disabled={busy || !api}>{l.controls.start}</Btn>
            ) : (
              <Btn variant="danger" onClick={() => void stop()} disabled={busy}>{l.controls.stop}</Btn>
            )}
            <Btn variant="ghost" onClick={() => void clearSessions()} disabled={!api || sessions.length === 0}>{l.controls.clear}</Btn>
            <Btn variant="ghost" onClick={() => void exportSessions('json')} disabled={!api || sessions.length === 0}>{l.controls.exportJson}</Btn>
            <Btn variant="ghost" onClick={() => void exportSessions('har')} disabled={!api || sessions.length === 0}>{l.controls.exportHar}</Btn>
            <label className="flex items-center gap-1.5 text-[12px] text-bright cursor-pointer select-none ml-auto">
              <input type="checkbox" checked={state?.mitm ?? true} onChange={(e) => void toggleMitm(e.target.checked)} className="accent-[color:var(--c-phosphor)]" />
              {l.controls.mitmLabel}
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] text-muted">
            <div>{l.controls.portHint}</div>
            <div>{l.controls.mitmHint}</div>
          </div>
          {running && (state?.mitm ?? false) && (
            <div className="border border-amber/40 bg-amber/5 px-3 py-2 text-[11.5px] text-amber">
              {l.controls.mitmTrustWarn}
            </div>
          )}

          <div className="border-t border-line-soft pt-2 grid sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted">{l.system.title}</div>
              <div className="flex flex-wrap items-center gap-2">
                {(state?.systemProxy.enabled && state.systemProxy.managed) ? (
                  <Btn
                    variant="danger"
                    disabled={!api || busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        const s = await api?.systemRestore()
                        if (!s) return
                        setState((p) => (p ? { ...p, systemProxy: s } : p))
                        // 还原结果以主进程回报为准：取消授权 / 失败都不能报成功
                        if (s.enabled) setError(s.detail || l.errors.systemFailed)
                        else setNotice(s.detail || l.system.disabled)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    {l.system.disable}
                  </Btn>
                ) : (
                  <Btn
                    disabled={!api || !running || busy}
                    onClick={async () => {
                      setError(null)
                      setBusy(true)
                      try {
                        const s = await api?.systemSet()
                        if (!s) return
                        setState((p) => (p ? { ...p, systemProxy: s } : p))
                        // 只有主进程确认系统代理真的指向本机时才提示成功
                        if (s.enabled && s.managed) setNotice(`${l.system.done} · ${s.server}`)
                        else setError(s.detail || l.errors.systemFailed)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    {l.system.enable}
                  </Btn>
                )}
                <span className={`text-[11.5px] ${state?.systemProxy.enabled ? 'text-phosphor' : 'text-muted'}`}>
                  {state?.systemProxy.enabled ? `${l.system.enabled} · ${state.systemProxy.server}` : l.system.disabled}
                </span>
              </div>
              <div className="text-[11px] text-muted">{l.system.hint}</div>
              {isMac && <div className="text-[11px] text-amber">{l.system.authHint}</div>}
              {state?.systemProxy.detail && <div className="text-[11px] text-muted">{state.systemProxy.detail}</div>}
              {state?.systemProxy.enabled && state.systemProxy.managed && (
                <div className="text-[11px] text-amber">{l.system.restoreTip}</div>
              )}
              {state && !state.systemProxy.supported && <div className="text-[11px] text-amber">{l.errors.systemUnsupported}</div>}
            </div>

            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-muted">{l.ca.title}</div>
              <CaSummary ca={ca} l={l} />
            </div>
          </div>
        </div>
      </Panel>

      {/* ===== 根证书详情 ===== */}
      <CaPanel ca={ca} l={l} api={api} onError={setError} onNotice={setNotice} onUpdate={(info) => setState((p) => (p ? { ...p, caInfo: info, caReady: true } : p))} />

      {/* ===== 规则 ===== */}
      <RulesPanel
        rules={rules}
        editing={editing}
        l={l}
        api={api}
        onNew={() => setEditing(emptyRule())}
        onEdit={(r) => setEditing(r)}
        onCancel={() => setEditing(null)}
        onSave={(r) => void saveRule(r)}
        onRemove={(id) => void removeRule(id)}
        onToggleAll={async (enabled) => {
          if (!api) return
          setRules(await api.rulesSave(rules.map((r) => ({ ...r, enabled }))))
        }}
      />

      {/* ===== 会话 ===== */}
      <Panel
        title={`${l.sessions.title} (${filtered.length}/${sessions.length})`}
        right={
          <div className="flex items-center gap-1">
            <select
              value={schemeFilter}
              onChange={(e) => setSchemeFilter(e.target.value as typeof schemeFilter)}
              className="bg-panel-2 border border-line-soft px-1.5 py-0.5 text-[11px] text-bright"
            >
              <option value="all">{l.sessions.schemeAll}</option>
              <option value="http">http</option>
              <option value="https">https</option>
              <option value="tunnel">tunnel</option>
            </select>
            <button
              onClick={() => setFollow(!follow)}
              className={`px-2 py-0.5 text-[11px] border ${follow ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}
            >{follow ? l.sessions.follow : l.sessions.notFollowed}</button>
          </div>
        }
      >
        <div className="space-y-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={l.sessions.filterPlaceholder}
            className="w-full bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
          />

          {sessions.length === 0 && (
            <div className="border border-line-soft bg-panel-2 px-3 py-6 text-center">
              <div className="text-[12.5px] text-muted">{l.sessions.empty}</div>
              <div className="text-[11.5px] text-muted/80 mt-1">{l.sessions.emptyHint}</div>
              {state && <div className="text-[11.5px] text-muted/80 mt-1">{l.errors.manualProxy} 127.0.0.1:{state.port || DEFAULT_PORT}</div>}
            </div>
          )}

          <div className="grid min-[1500px]:grid-cols-2 gap-3">
            <div className="border border-line-soft max-h-[420px] overflow-auto" ref={listRef}>
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-panel-2 text-muted">
                  <tr>
                    <th className="text-left px-2 py-1 font-normal">{l.sessions.method}</th>
                    <th className="text-left px-2 py-1 font-normal">{l.sessions.host}</th>
                    <th className="text-left px-2 py-1 font-normal">{l.sessions.status}</th>
                    <th className="text-right px-2 py-1 font-normal">{l.sessions.size}</th>
                    <th className="text-right px-2 py-1 font-normal">{l.sessions.duration}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelected(s)}
                      className={`cursor-pointer border-t border-line-soft hover:bg-phosphor-faint ${selected?.id === s.id ? 'bg-phosphor-faint' : ''}`}
                    >
                      <td className="px-2 py-1 text-phosphor whitespace-nowrap">{s.method}</td>
                      <td className="px-2 py-1 text-bright">
                        <div className="truncate max-w-[220px]" title={`${s.host}${s.path}`}>{s.host}</div>
                        <div className="truncate max-w-[220px] text-muted text-[10.5px]" title={s.path}>{s.path}</div>
                      </td>
                      <td className={`px-2 py-1 whitespace-nowrap ${U.statusColorClass(s.status)}`}>
                        {s.status ?? (s.tunneled ? '⇆' : '…')}
                        {s.mocked && <span className="ml-1 text-amber text-[9.5px]">M</span>}
                        {s.blocked && <span className="ml-1 text-danger text-[9.5px]">B</span>}
                        {s.intercepted && <span className="ml-1 text-phosphor text-[9.5px]">P</span>}
                        {s.modified && <span className="ml-1 text-amber text-[9.5px]">✎</span>}
                        {s.tunneled && <span className="ml-1 text-muted text-[9.5px]">T</span>}
                      </td>
                      <td className="px-2 py-1 text-right text-muted whitespace-nowrap">{U.formatBytes(s.resBodyBytes)}</td>
                      <td className="px-2 py-1 text-right text-muted whitespace-nowrap">
                        {U.formatDuration(s.durationMs)}
                        <div className="text-[10px] text-muted/70">{U.formatTime(s.startedAt)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sessions.length > 0 && filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-[12px] text-muted">{l.sessions.noMatch}</div>
              )}
            </div>

            <div className="border border-line-soft bg-panel-2 min-h-[200px]">
              {selected ? (
                <SessionDetail session={selected} l={l} httpApi={httpApi} proxyPort={state?.port ?? DEFAULT_PORT} proxyRunning={running} />
              ) : (
                <div className="px-3 py-6 text-center text-[12px] text-muted">{l.detail.title}</div>
              )}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}

/* ================= 根证书 ================= */

function CaSummary({ ca, l }: { ca: CaInfo | null; l: L }) {
  if (!ca) return <div className="text-[11.5px] text-amber">{l.status.caMissing}</div>
  return (
    <div className="space-y-0.5 text-[11px] text-muted">
      <div><span className="text-muted">{l.ca.subject}: </span><span className="text-bright break-all">{ca.subject}</span></div>
      <div><span className="text-muted">{l.ca.fingerprint}: </span><span className="text-bright break-all text-[10.5px]">{ca.fingerprintSha256}</span></div>
    </div>
  )
}

function CaPanel({ ca, l, api, onError, onNotice, onUpdate }: {
  ca: CaInfo | null
  l: L
  api: NonNullable<Window['electronAPI']>['proxy'] | undefined
  onError: (m: string | null) => void
  onNotice: (m: string | null) => void
  onUpdate: (info: CaInfo) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Panel
      title={l.ca.title}
      right={
        <button onClick={() => setOpen(!open)} className="text-[11px] text-muted hover:text-phosphor">
          {open ? l.misc.close : l.misc.apply}
        </button>
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[12px] ${ca ? 'text-phosphor' : 'text-amber'}`}>
            {ca ? `✓ ${l.ca.ready}` : `! ${l.ca.notReady}`}
          </span>
          <Btn variant="ghost" onClick={async () => {
            const r = await api?.caExport('pem')
            if (r?.ok) onNotice(l.ca.exported(r.path))
            else if (r && !r.canceled) onError(l.errors.exportFailed(r.error ?? ''))
          }} disabled={!api}>{l.ca.exportPem}</Btn>
          <Btn variant="ghost" onClick={async () => {
            const r = await api?.caExport('crt')
            if (r?.ok) onNotice(l.ca.exported(r.path))
            else if (r && !r.canceled) onError(l.errors.exportFailed(r.error ?? ''))
          }} disabled={!api}>{l.ca.exportCrt}</Btn>
          <Btn variant="ghost" onClick={() => void api?.caOpen()} disabled={!api}>{l.ca.openFolder}</Btn>
          <Btn variant="ghost" onClick={async () => {
            if (!window.confirm(l.ca.resetConfirm)) return
            const info = await api?.caReset()
            if (info) { onUpdate(info); onNotice(l.ca.ready) }
          }} disabled={!api}>{l.ca.reset}</Btn>
        </div>

        {open && (
          <div className="space-y-2 border-t border-line-soft pt-2">
            {ca && (
              <div className="space-y-0.5 text-[11.5px]">
                <div><span className="text-muted">{l.ca.subject}: </span><span className="text-bright break-all">{ca.subject}</span></div>
                <div><span className="text-muted">{l.ca.validTo}: </span><span className="text-bright">{new Date(ca.validTo).toLocaleString()}</span></div>
                <div><span className="text-muted">{l.ca.path}: </span><span className="text-bright break-all">{ca.certPath}</span></div>
                <div className="flex items-center gap-2">
                  <span className="text-muted">{l.ca.fingerprint}:</span>
                  <span className="text-bright break-all text-[10.5px]">{ca.fingerprintSha256}</span>
                  <CopyBtn text={ca.fingerprintSha256} />
                </div>
              </div>
            )}
            <div className="border border-line-soft bg-panel-2 px-3 py-2 space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider text-muted">{l.ca.installTitle}</div>
              <div className="text-[11.5px] text-bright">{l.ca.installMac}</div>
              <div className="text-[11.5px] text-bright">{l.ca.installWin}</div>
              <div className="text-[11.5px] text-bright">{l.ca.installLinux}</div>
              <div className="text-[11px] text-amber">{l.ca.installNote}</div>
            </div>
            <div className="text-[11px] text-amber">{l.ca.warning}</div>
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ================= 规则 ================= */

function RulesPanel({ rules, editing, l, api, onNew, onEdit, onCancel, onSave, onRemove, onToggleAll }: {
  rules: ProxyRule[]
  editing: ProxyRule | null
  l: L
  api: NonNullable<Window['electronAPI']>['proxy'] | undefined
  onNew: () => void
  onEdit: (r: ProxyRule) => void
  onCancel: () => void
  onSave: (r: ProxyRule) => void
  onRemove: (id: string) => void
  onToggleAll: (enabled: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const enabledCount = rules.filter((r) => r.enabled).length

  return (
    <Panel
      title={`${l.rules.title} (${enabledCount}/${rules.length})`}
      right={
        <div className="flex items-center gap-1">
          <button onClick={() => setOpen(!open)} className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor">
            {open ? l.misc.close : l.misc.apply}
          </button>
          <button onClick={onNew} className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor" disabled={!api}>
            + {l.rules.add}
          </button>
        </div>
      }
    >
      <div className="space-y-2">
        {rules.length === 0 && !editing && (
          <div className="text-[12px] text-muted">{l.rules.empty} — {l.rules.emptyHint}</div>
        )}
        {rules.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <button onClick={() => onToggleAll(true)} className="hover:text-phosphor">{l.rules.toggleAll} ✓</button>
            <button onClick={() => onToggleAll(false)} className="hover:text-phosphor">{l.rules.toggleAll} ✗</button>
            <span className="ml-auto">{l.rules.subtitle}</span>
          </div>
        )}

        <div className="divide-y divide-[color:var(--c-line-soft)]">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1.5">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={() => onSave({ ...r, enabled: !r.enabled })}
                className="accent-[color:var(--c-phosphor)]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-bright truncate">{r.name || r.id}</div>
                <div className="text-[10.5px] text-muted truncate">
                  {r.method !== 'ANY' ? `${r.method} ` : ''}{r.host || '*'} {r.path || '*'}
                  {r.breakpoint && <span className="text-phosphor ml-1.5">{l.rules.breakpoint}</span>}
                  {r.block && <span className="text-danger ml-1.5">{l.rules.block}</span>}
                  {r.mock && <span className="text-amber ml-1.5">{l.rules.mockTitle} {r.mock.status}</span>}
                  {r.delayMs > 0 && <span className="text-muted ml-1.5">+{r.delayMs}ms</span>}
                </div>
              </div>
              <button onClick={() => onEdit(r)} className="text-[11px] text-muted hover:text-phosphor px-1">{l.rules.edit}</button>
              <button onClick={() => onRemove(r.id)} className="text-muted hover:text-danger px-1">×</button>
            </div>
          ))}
        </div>

        {open && rules.length > 0 && (
          <div className="border-t border-line-soft pt-2 text-[11px] text-muted">{l.rules.hostHint}</div>
        )}

        {editing && (
          <RuleEditor rule={editing} l={l} onCancel={onCancel} onSave={onSave} />
        )}
      </div>
    </Panel>
  )
}

function RuleEditor({ rule, l, onCancel, onSave }: {
  rule: ProxyRule
  l: L
  onCancel: () => void
  onSave: (r: ProxyRule) => void
}) {
  const [draft, setDraft] = useState<ProxyRule>(rule)
  const set = (patch: Partial<ProxyRule>): void => setDraft((d) => ({ ...d, ...patch }))

  const preset = (kind: 'cors' | 'mock' | 'break' | 'delay'): void => {
    if (kind === 'cors') set({
      name: draft.name || l.rules.presetCors,
      resHeaderOps: [
        ...draft.resHeaderOps.filter((o) => !/^access-control-allow-(origin|methods|headers)$/i.test(o.name)),
        { action: 'set', name: 'Access-Control-Allow-Origin', value: '*' },
        { action: 'set', name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
        { action: 'set', name: 'Access-Control-Allow-Headers', value: '*' },
      ],
    })
    if (kind === 'mock') set({
      name: draft.name || l.rules.presetMock,
      mock: { status: 200, headers: [['content-type', 'application/json']], bodyText: '{"code":0,"data":{"mocked":true}}' },
    })
    if (kind === 'break') set({ name: draft.name || l.rules.presetBreak, breakpoint: true })
    if (kind === 'delay') set({ name: draft.name || l.rules.presetDelay, delayMs: 2000 })
  }

  const opEditor = (key: 'reqHeaderOps' | 'resHeaderOps', title: string) => (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider text-muted">{title}</div>
      {(draft[key] ?? []).map((op, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select
            value={op.action}
            onChange={(e) => set({ [key]: draft[key].map((x, xi) => (xi === i ? { ...x, action: e.target.value as HeaderOp['action'] } : x)) } as Partial<ProxyRule>)}
            className="bg-panel-2 border border-line-soft px-1 py-0.5 text-[11px] text-bright"
          >
            <option value="set">{l.rules.opSet}</option>
            <option value="add">{l.rules.opAdd}</option>
            <option value="remove">{l.rules.opRemove}</option>
          </select>
          <input
            value={op.name}
            onChange={(e) => set({ [key]: draft[key].map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)) } as Partial<ProxyRule>)}
            placeholder={l.rules.headerName}
            className="w-40 bg-panel-2 border border-line-soft px-1.5 py-0.5 text-[11px] text-bright"
          />
          {op.action !== 'remove' && (
            <input
              value={op.value ?? ''}
              onChange={(e) => set({ [key]: draft[key].map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)) } as Partial<ProxyRule>)}
              placeholder={l.rules.headerValue}
              className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-1.5 py-0.5 text-[11px] text-bright"
            />
          )}
          <button
            onClick={() => set({ [key]: draft[key].filter((_, xi) => xi !== i) } as Partial<ProxyRule>)}
            className="text-muted hover:text-danger px-1"
          >×</button>
        </div>
      ))}
      <button
        onClick={() => set({ [key]: [...draft[key], { action: 'set', name: '', value: '' }] } as Partial<ProxyRule>)}
        className="text-[11px] text-muted hover:text-phosphor"
      >+ {l.rules.addOp}</button>
    </div>
  )

  return (
    <div className="border border-phosphor/30 bg-phosphor-faint/40 p-3 space-y-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <Input label={l.rules.name} value={draft.name} onChange={(v) => set({ name: v })} placeholder={l.rules.namePlaceholder} />
        <Input label={l.rules.host} value={draft.host} onChange={(v) => set({ host: v })} placeholder={l.rules.hostPlaceholder} />
        <Input label={l.rules.path} value={draft.path} onChange={(v) => set({ path: v })} placeholder={l.rules.pathPlaceholder} />
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted uppercase tracking-wider">{l.rules.method}</span>
            <select value={draft.method} onChange={(e) => set({ method: e.target.value })} className="bg-panel-2 border border-line-soft px-2 py-1.5 text-[12px] text-bright">
              {['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].map((m) => <option key={m} value={m}>{m === 'ANY' ? l.rules.any : m}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted uppercase tracking-wider">{l.rules.scheme}</span>
            <select value={draft.scheme} onChange={(e) => set({ scheme: e.target.value as ProxyRule['scheme'] })} className="bg-panel-2 border border-line-soft px-2 py-1.5 text-[12px] text-bright">
              <option value="any">{l.rules.any}</option>
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </div>
          <Input label={l.rules.delay} value={String(draft.delayMs)} onChange={(v) => set({ delayMs: Number(v.replace(/\D/g, '')) || 0 })} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-[11px] text-muted self-center">{l.rules.presets}:</span>
        {(['cors', 'mock', 'break', 'delay'] as const).map((k) => (
          <button key={k} onClick={() => preset(k)} className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40">
            {k === 'cors' ? l.rules.presetCors : k === 'mock' ? l.rules.presetMock : k === 'break' ? l.rules.presetBreak : l.rules.presetDelay}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 text-[12px]">
        <label className="flex items-center gap-1.5 text-bright cursor-pointer">
          <input type="checkbox" checked={draft.breakpoint} onChange={(e) => set({ breakpoint: e.target.checked })} className="accent-[color:var(--c-phosphor)]" />
          {l.rules.breakpoint}
        </label>
        <label className="flex items-center gap-1.5 text-bright cursor-pointer">
          <input type="checkbox" checked={draft.block} onChange={(e) => set({ block: e.target.checked })} className="accent-[color:var(--c-phosphor)]" />
          {l.rules.block}
        </label>
        <label className="flex items-center gap-1.5 text-bright cursor-pointer">
          <input
            type="checkbox"
            checked={!!draft.mock}
            onChange={(e) => set({ mock: e.target.checked ? { status: 200, headers: [['content-type', 'application/json']], bodyText: '{}' } : null })}
            className="accent-[color:var(--c-phosphor)]"
          />
          {l.rules.mockEnabled}
        </label>
      </div>

      {draft.mock && (
        <div className="space-y-2 border border-line-soft p-2">
          <div className="grid sm:grid-cols-4 gap-2">
            <Input label={l.rules.mockStatus} value={String(draft.mock.status)} onChange={(v) => set({ mock: { ...draft.mock!, status: Number(v.replace(/\D/g, '')) || 200 } })} />
            <div className="sm:col-span-3">
              <Input
                label="Content-Type"
                value={U.headerValueOf(draft.mock.headers, 'content-type') ?? ''}
                onChange={(v) => set({
                  mock: {
                    ...draft.mock!,
                    headers: [['content-type', v], ...draft.mock!.headers.filter(([k]) => k.toLowerCase() !== 'content-type')],
                  },
                })}
              />
            </div>
          </div>
          <TA label={l.rules.mockBody} rows={4} value={draft.mock.bodyText ?? ''} onChange={(v) => set({ mock: { ...draft.mock!, bodyText: v } })} />
        </div>
      )}

      {opEditor('reqHeaderOps', l.rules.reqHeaders)}
      {opEditor('resHeaderOps', l.rules.resHeaders)}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted">{l.rules.reqBody}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input label={l.rules.find} value={draft.reqBodyFind ?? ''} onChange={(v) => set({ reqBodyFind: v })} />
            <Input label={l.rules.replace} value={draft.reqBodyReplace ?? ''} onChange={(v) => set({ reqBodyReplace: v })} />
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-bright cursor-pointer">
            <input type="checkbox" checked={!!draft.reqBodyRegex} onChange={(e) => set({ reqBodyRegex: e.target.checked })} className="accent-[color:var(--c-phosphor)]" />
            {l.rules.regex}
          </label>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-muted">{l.rules.resBody}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input label={l.rules.find} value={draft.resBodyFind ?? ''} onChange={(v) => set({ resBodyFind: v })} />
            <Input label={l.rules.replace} value={draft.resBodyReplace ?? ''} onChange={(v) => set({ resBodyReplace: v })} />
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-bright cursor-pointer">
            <input type="checkbox" checked={!!draft.resBodyRegex} onChange={(e) => set({ resBodyRegex: e.target.checked })} className="accent-[color:var(--c-phosphor)]" />
            {l.rules.regex}
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => onSave(draft)}>{l.rules.save}</Btn>
        <Btn variant="ghost" onClick={onCancel}>{l.rules.cancel}</Btn>
      </div>
    </div>
  )
}

/* ================= 断点 ================= */

function InterceptCard({ request, l, onResolve }: {
  request: InterceptRequest
  l: L
  onResolve: (decision: { id: string; action: 'forward' | 'drop'; method?: string; url?: string; headers?: [string, string][]; bodyBase64?: string; mock?: { status: number; headers: [string, string][]; bodyText?: string } | null }) => void
}) {
  const [method, setMethod] = useState(request.method)
  const [url, setUrl] = useState(request.url)
  const [headers, setHeaders] = useState(headersToText(request.headers))
  const [body, setBody] = useState(() => {
    const bytes = U.b64ToBytes(request.bodyBase64)
    return U.isProbablyBinary(bytes) ? '' : U.bytesToText(bytes)
  })
  const [mockOn, setMockOn] = useState(false)
  const [mockStatus, setMockStatus] = useState('200')
  const [mockBody, setMockBody] = useState('{"mocked":true}')

  return (
    <Panel
      title={`⚠ ${l.intercept.title} · ${request.ruleName}`}
      right={<span className="text-[11px] text-amber">{l.intercept.badge}</span>}
    >
      <div className="space-y-2">
        <div className="text-[11.5px] text-amber">{l.intercept.notice}</div>
        <div className="flex gap-2">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-phosphor">
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright" />
        </div>
        <div className="grid lg:grid-cols-2 gap-3">
          <TA label={l.intercept.headers} rows={8} value={headers} onChange={setHeaders} />
          <TA label={l.intercept.body} rows={8} value={body} onChange={setBody} />
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-bright cursor-pointer">
          <input type="checkbox" checked={mockOn} onChange={(e) => setMockOn(e.target.checked)} className="accent-[color:var(--c-phosphor)]" />
          {l.intercept.mock}
        </label>
        {mockOn && (
          <div className="flex gap-2">
            <input value={mockStatus} onChange={(e) => setMockStatus(e.target.value)} className="w-20 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright" />
            <input value={mockBody} onChange={(e) => setMockBody(e.target.value)} className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright" />
          </div>
        )}
        <div className="flex gap-2">
          <Btn variant="primary" onClick={() => onResolve({
            id: request.id,
            action: 'forward',
            method,
            url,
            headers: textToHeaders(headers),
            bodyBase64: U.textToB64(body),
            mock: mockOn ? { status: Number(mockStatus) || 200, headers: [['content-type', 'application/json']], bodyText: mockBody } : null,
          })}>{l.intercept.forward}</Btn>
          <Btn variant="danger" onClick={() => onResolve({ id: request.id, action: 'drop' })}>{l.intercept.drop}</Btn>
        </div>
      </div>
    </Panel>
  )
}

/* ================= 会话详情 ================= */

function SessionDetail({ session, l, httpApi, proxyPort, proxyRunning }: {
  session: ProxySession
  l: L
  httpApi: NonNullable<Window['electronAPI']>['http'] | undefined
  proxyPort: number
  proxyRunning: boolean
}) {
  const [side, setSide] = useState<'req' | 'res'>('res')
  const [view, setView] = useState<'pretty' | 'raw' | 'hex'>('pretty')
  const [resendOpen, setResendOpen] = useState(false)
  const [rMethod, setRMethod] = useState(session.method)
  const [rUrl, setRUrl] = useState(session.url)
  const [rHeaders, setRHeaders] = useState(headersToText(session.reqHeaders))
  const [rBody, setRBody] = useState(() => {
    const bytes = U.b64ToBytes(session.reqBodyBase64)
    return U.isProbablyBinary(bytes) ? '' : U.bytesToText(bytes)
  })
  const [result, setResult] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    setRMethod(session.method)
    setRUrl(session.url)
    setRHeaders(headersToText(session.reqHeaders))
    const bytes = U.b64ToBytes(session.reqBodyBase64)
    setRBody(U.isProbablyBinary(bytes) ? '' : U.bytesToText(bytes))
    setResult(null)
    setResendOpen(false)
  }, [session])

  const shown = useMemo(() => {
    const b64 = side === 'req' ? session.reqBodyBase64 : session.resBodyBase64
    const bytes = U.b64ToBytes(b64)
    const headers = side === 'req' ? session.reqHeaders : session.resHeaders
    const ct = U.headerValueOf(headers, 'content-type')
    const text = U.bytesToText(bytes, U.detectCharset(ct))
    return { bytes, text, binary: U.isProbablyBinary(bytes), pretty: U.prettyJson(text), ct }
  }, [session, side])

  const curl = useMemo(() => {
    const reqBytes = U.b64ToBytes(session.reqBodyBase64)
    return U.buildCurl({
      method: session.method,
      url: session.url,
      headers: session.reqHeaders.filter(([k]) => !/^(proxy-|host|content-length|connection|accept-encoding)$/i.test(k)),
      bodyText: U.isProbablyBinary(reqBytes) ? null : U.bytesToText(reqBytes),
      verifyTls: false,
    })
  }, [session])

  const resend = useCallback(async () => {
    if (!httpApi) return
    setSending(true)
    setResult(null)
    try {
      const res = await httpApi.send({
        method: rMethod,
        url: rUrl,
        headers: textToHeaders(rHeaders),
        bodyText: rBody || null,
        followRedirects: false,
        rejectUnauthorized: false,
        proxy: proxyRunning ? `http://127.0.0.1:${proxyPort}` : null,
      })
      setResult(res.ok
        ? `${res.status} ${res.statusText} · ${U.formatDuration(res.timings.totalMs)} · ${U.formatBytes(res.bodyBytes)}\n\n${U.bytesToText(U.b64ToBytes(res.bodyBase64), U.detectCharset(U.headerValueOf(res.headers, 'content-type'))).slice(0, 4000)}`
        : `${l.detail.error}: ${res.error ?? ''}`)
    } catch (err) {
      setResult(`${l.detail.error}: ${(err as Error).message}`)
    } finally {
      setSending(false)
    }
  }, [httpApi, rMethod, rUrl, rHeaders, rBody, proxyRunning, proxyPort, l])

  const headers = side === 'req' ? session.reqHeaders : session.resHeaders

  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-phosphor font-semibold">{session.method}</span>
        <span className={`${U.statusColorClass(session.status)} font-semibold`}>{session.status ?? '—'} {session.statusText}</span>
        <span className="text-muted">{U.formatDuration(session.durationMs)}</span>
        <span className="text-muted">{U.formatBytes(session.resBodyBytes)}</span>
        {session.tunneled && <span className="text-muted border border-line-soft px-1">{l.sessions.tunneled}</span>}
        {session.mocked && <span className="text-amber border border-amber/40 px-1">{l.sessions.mocked}</span>}
        {session.blocked && <span className="text-danger border border-danger/40 px-1">{l.sessions.blocked}</span>}
        {session.intercepted && <span className="text-phosphor border border-phosphor/40 px-1">{l.sessions.intercepted}</span>}
        {session.modified && <span className="text-amber border border-amber/40 px-1">{l.sessions.modified}</span>}
      </div>

      <div className="text-[11.5px] break-all text-bright">{session.url}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        <div><span className="text-muted">{l.detail.host}: </span><span className="text-bright">{session.host}</span></div>
        <div><span className="text-muted">{l.detail.clientIp}: </span><span className="text-bright">{session.clientIp || '—'}</span></div>
        <div><span className="text-muted">{l.detail.startedAt}: </span><span className="text-bright">{new Date(session.startedAt).toLocaleTimeString()}</span></div>
        <div><span className="text-muted">{l.detail.matchedRules}: </span><span className="text-bright">{session.matchedRules.join(', ') || l.detail.none}</span></div>
      </div>
      {session.note && <div className="text-[11px] text-amber">{l.detail.note}: {session.note}</div>}
      {session.error && <div className="text-[11px] text-danger">{l.detail.error}: {session.error}</div>}
      {session.tunneled && <div className="text-[11px] text-muted">{l.detail.tunnelNotice}</div>}

      <div className="flex items-center gap-1 flex-wrap">
        <button onClick={() => setSide('req')} className={`px-2 py-0.5 text-[11px] border ${side === 'req' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}>{l.detail.request}</button>
        <button onClick={() => setSide('res')} className={`px-2 py-0.5 text-[11px] border ${side === 'res' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}>{l.detail.response}</button>
        <span className="flex gap-1 ml-auto">
          {(['pretty', 'raw', 'hex'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-2 py-0.5 text-[11px] border ${view === v ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}>{l.detail[v]}</button>
          ))}
        </span>
      </div>

      <div className="max-h-[160px] overflow-auto space-y-0.5">
        {headers.map(([k, v], i) => (
          <div key={`${k}-${i}`} className="text-[11px] break-all">
            <span className="text-phosphor">{k}</span><span className="text-muted">: </span><span className="text-bright">{v}</span>
          </div>
        ))}
        {headers.length === 0 && <div className="text-[11px] text-muted">—</div>}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted">{l.detail.body}</span>
        <span className="text-[11px] text-muted">{U.formatBytes(shown.bytes.length)}</span>
        <CopyBtn text={shown.text} className="ml-auto" />
      </div>
      {shown.bytes.length === 0 ? (
        <div className="text-[11px] text-muted">{l.detail.emptyBody}</div>
      ) : (
        <pre className="codeblock max-h-[220px] overflow-auto bg-panel border border-line-soft px-2 py-1.5 text-[11px] text-bright">
          {view === 'hex' ? U.hexDump(shown.bytes, 2048) : view === 'pretty' && shown.pretty ? shown.pretty : shown.text}
        </pre>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Btn variant="ghost" onClick={() => setResendOpen(!resendOpen)}>{l.detail.resend}</Btn>
        <CopyBtn text={curl} />
        <span className="text-[10.5px] text-muted">{resendOpen ? l.detail.resendHint : ''}</span>
      </div>

      {resendOpen && (
        <div className="space-y-2 border border-line-soft p-2">
          <div className="flex gap-2">
            <select value={rMethod} onChange={(e) => setRMethod(e.target.value)} className="bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-phosphor">
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input value={rUrl} onChange={(e) => setRUrl(e.target.value)} className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright" />
          </div>
          <TA label={l.intercept.headers} rows={4} value={rHeaders} onChange={setRHeaders} />
          <TA label={l.intercept.body} rows={4} value={rBody} onChange={setRBody} />
          <Btn variant="primary" onClick={() => void resend()} disabled={sending || !httpApi}>{sending ? l.detail.sending : l.detail.send}</Btn>
          {result && (
            <div>
              <div className="text-[11px] text-muted mb-1">{l.detail.resendResult}</div>
              <pre className="codeblock max-h-[220px] overflow-auto bg-panel border border-line-soft px-2 py-1.5 text-[11px] text-bright">{result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
