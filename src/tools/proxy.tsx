/**
 * 抓包代理工具 —— 主组件与组装层。
 * UI 拆分：规则页（proxy-rules）、断点卡片（proxy-intercept）、会话详情
 * （proxy-session-detail）、会话页（proxy-sessions）、设置页（proxy-settings），
 * 纯视图逻辑在 lib/proxy-view。本文件保留状态编排、顶栏与根证书面板；
 * CaPanel 的声明必须留在文件末尾 —— smoke:ux 第 14 节从 CaPanel 声明处
 * 截取到文件尾做防并发断言（busy 统一、行内二次确认、aria-busy）。
 */
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Panel, Btn, ErrorNote, CopyBtn, ConfirmButton, useAsyncAction } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { proxyL } from '../lib/locales/proxy'
import type {
  CaInfo,
  InterceptRequest,
  ProxyEvent,
  ProxyRule,
  ProxySession,
  ProxyState,
} from '../lib/proxy-types'
import { DEFAULT_PORT, emptyRule, type InterceptDecisionInput } from '../lib/proxy-view'
import { InterceptCard } from './proxy-intercept'
import { RulesPanel } from './proxy-rules'
import { SessionsTab } from './proxy-sessions'
import { SettingsTab } from './proxy-settings'

type L = (typeof proxyL)['zh']

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
  /** 页签：会话是主战场，设置类操作收进「设置」页 */
  const [tab, setTab] = useState<'sessions' | 'rules' | 'settings'>('sessions')
  /** 暂停刷新：流量一直在动时，清空/观察单条都要先按住列表 */
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)

  const api = typeof window !== 'undefined' ? window.electronAPI?.proxy : undefined
  const httpApi = typeof window !== 'undefined' ? window.electronAPI?.http : undefined

  /* ---- 事件订阅 ---- */
  useEffect(() => {
    if (!api) return
    const off = api.onEvent((evt: ProxyEvent) => {
      if (evt.type === 'session') {
        // 暂停期间只计数不落表，继续时从主进程拉全量（主进程才是权威来源）
        if (pausedRef.current) {
          setPendingCount((n) => n + 1)
          return
        }
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
    api
      .state()
      .then((s) => {
        setState(s)
        setPortInput(String(s.port || DEFAULT_PORT))
      })
      .catch(() => {})
    api
      .sessions()
      .then(setSessions)
      .catch(() => {})
    api
      .rules()
      .then(setRules)
      .catch(() => {})
  }, [api])

  const start = useCallback(
    async (mitm: boolean) => {
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
    },
    [api, portInput, l],
  )

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

  const toggleMitm = useCallback(
    async (mitm: boolean) => {
      if (!api) return
      await api.setMitm(mitm)
      if (state?.running) setState(await api.start(state.port, mitm))
      else setState(await api.state())
    },
    [api, state],
  )

  const clearSessions = useCallback(async () => {
    if (!api) return
    setConfirmClear(false)
    setState(await api.clear())
    setSessions([])
    setSelected(null)
    setPendingCount(0)
  }, [api])

  /** 暂停 / 继续刷新（继续时以主进程列表为准补齐） */
  const togglePause = useCallback(async () => {
    const next = !pausedRef.current
    pausedRef.current = next
    setPaused(next)
    if (!next && api) {
      const all = await api.sessions().catch(() => null)
      if (all) setSessions(all)
      setPendingCount(0)
    }
  }, [api])

  const exportSessions = useCallback(
    async (format: 'json' | 'har') => {
      if (!api) return
      const res = await api.exportSessions(format)
      if (res.ok) setNotice(l.controls.exported(res.count))
      else if (!res.canceled) setError(l.errors.exportFailed(res.error ?? ''))
    },
    [api, l],
  )

  const saveRule = useCallback(
    async (rule: ProxyRule) => {
      if (!api) return
      setRules(await api.rulesUpsert(rule))
      setEditing(null)
      setNotice(l.rules.saved)
    },
    [api, l],
  )

  const removeRule = useCallback(
    async (id: string) => {
      if (!api) return
      setRules(await api.rulesRemove(id))
    },
    [api],
  )

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return sessions.filter((s) => {
      if (schemeFilter !== 'all' && s.scheme !== schemeFilter) return false
      if (!q) return true
      return `${s.method} ${s.host} ${s.path} ${s.status ?? ''}`.toLowerCase().includes(q)
    })
  }, [sessions, filter, schemeFilter])

  const resolveIntercept = useCallback(
    async (decision: InterceptDecisionInput) => {
      if (!api) return
      await api.resolveIntercept(decision)
      setIntercept(null)
    },
    [api],
  )

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
          <button onClick={() => setNotice(null)} className="text-muted hover:text-phosphor">
            ×
          </button>
        </div>
      )}

      {/* ===== 断点拦截 ===== */}
      {intercept && <InterceptCard request={intercept} l={l} onResolve={resolveIntercept} />}

      {/* ===== 顶栏：只留高频操作（状态 / 启停 / 页签），其余收进「设置」页 ===== */}
      <div className="border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-b border-line-soft">
          <span className={`text-[12.5px] ${running ? 'text-phosphor' : 'text-muted'}`}>
            ● {running ? l.status.running : l.status.stopped}
          </span>
          <span className="text-[11.5px] text-muted">
            {running ? `127.0.0.1:${state?.port ?? DEFAULT_PORT}` : l.controls.portHint}
          </span>
          {!running ? (
            <Btn
              variant="primary"
              onClick={() => void start(state?.mitm ?? true)}
              disabled={busy || !api}
            >
              {l.controls.start}
            </Btn>
          ) : (
            <Btn variant="danger" onClick={() => void stop()} disabled={busy}>
              {l.controls.stop}
            </Btn>
          )}
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge ok={running && (state?.mitm ?? false)} title={l.controls.mitmHint}>
              {l.controls.mitmLabel}: {(state?.mitm ?? false) ? l.status.mitmOn : l.status.mitmOff}
            </Badge>
            <Badge ok={!!state?.systemProxy.enabled} title={state?.systemProxy.detail ?? ''}>
              {l.system.title}: {state?.systemProxy.enabled ? l.system.enabled : l.system.disabled}
            </Badge>
            <Badge ok={!!ca}>
              {l.ca.title}: {ca ? l.ca.ready : l.ca.notReady}
            </Badge>
          </span>
          <span className="text-[11px] text-muted ml-auto">
            {l.status.sessions}: {sessions.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1 px-3 py-2">
          {(['sessions', 'rules', 'settings'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2.5 py-1 text-[12px] border transition-colors ${tab === t ? 'border-phosphor/60 text-phosphor bg-phosphor-faint' : 'border-line-soft text-muted hover:text-phosphor'}`}
            >
              {l.tabs[t]}
              {t === 'sessions' && sessions.length > 0 && (
                <span className="ml-1 text-phosphor/70">{sessions.length}</span>
              )}
              {t === 'rules' && rules.length > 0 && (
                <span className="ml-1 text-phosphor/70">
                  {rules.filter((r) => r.enabled).length}/{rules.length}
                </span>
              )}
            </button>
          ))}
          <span className="text-[11px] text-muted ml-auto hidden md:inline">{l.tabsHint[tab]}</span>
        </div>
      </div>

      {/* ===== 设置页：端口 / HTTPS 解密 / 系统代理 / 根证书 / 导出 ===== */}
      {tab === 'settings' && (
        <SettingsTab
          l={l}
          api={api}
          busy={busy}
          setBusy={setBusy}
          state={state}
          setState={setState}
          portInput={portInput}
          setPortInput={setPortInput}
          running={running}
          toggleMitm={toggleMitm}
          isMac={isMac}
          onError={setError}
          onNotice={setNotice}
          onExport={exportSessions}
          sessionCount={sessions.length}
          caPanel={
            <CaPanel
              ca={ca}
              l={l}
              api={api}
              onError={setError}
              onNotice={setNotice}
              onUpdate={(info) => setState((p) => (p ? { ...p, caInfo: info, caReady: true } : p))}
            />
          }
        />
      )}

      {/* ===== 规则页 ===== */}
      {tab === 'rules' && (
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
      )}

      {/* ===== 会话页：主战场，占满剩余空间 ===== */}
      {tab === 'sessions' && (
        <SessionsTab
          l={l}
          sessions={sessions}
          filtered={filtered}
          selected={selected}
          onSelect={setSelected}
          filter={filter}
          onFilterChange={setFilter}
          schemeFilter={schemeFilter}
          onSchemeFilterChange={setSchemeFilter}
          follow={follow}
          onToggleFollow={() => setFollow(!follow)}
          paused={paused}
          onTogglePause={() => void togglePause()}
          pendingCount={pendingCount}
          confirmClear={confirmClear}
          onAskClear={() => setConfirmClear(true)}
          onClear={() => void clearSessions()}
          onCancelClear={() => setConfirmClear(false)}
          listRef={listRef}
          httpApi={httpApi}
          proxyPort={state?.port ?? DEFAULT_PORT}
          proxyRunning={running}
          statePort={state ? state.port : null}
        />
      )}
    </div>
  )
}

/* ================= 顶栏状态徽标 ================= */

function Badge({
  ok,
  title,
  children,
}: {
  ok: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <span
      title={title}
      className={`px-1.5 py-0.5 text-[10.5px] border whitespace-nowrap ${ok ? 'border-phosphor/40 text-phosphor' : 'border-line-soft text-muted'}`}
    >
      <span className={ok ? 'text-phosphor' : 'text-muted/70'}>●</span> {children}
    </span>
  )
}

/* ================= 根证书 ================= */

function CaPanel({
  ca,
  l,
  api,
  onError,
  onNotice,
  onUpdate,
}: {
  ca: CaInfo | null
  l: L
  api: NonNullable<Window['electronAPI']>['proxy'] | undefined
  onError: (m: string | null) => void
  onNotice: (m: string | null) => void
  onUpdate: (info: CaInfo) => void
}) {
  const [open, setOpen] = useState(false)
  // CA 操作全部涉及磁盘：caReset 要写密钥+生成证书，caExport 要读证书写文件。
  // 原来 4 个按钮只 disabled={!api}，连点两下就并发跑 caReset + caExport，
  // 竞态结果是拿到哪个文件根本不确定。用 useAsyncAction 统一防重入。
  const { busy, run } = useAsyncAction(async (op: 'pem' | 'crt' | 'open' | 'reset') => {
    if (op === 'open') {
      await api?.caOpen()
      return
    }
    if (op === 'reset') {
      const info = await api?.caReset()
      if (info) {
        onUpdate(info)
        onNotice(l.ca.ready)
      }
      return
    }
    const r = await api?.caExport(op)
    if (r?.ok) onNotice(l.ca.exported(r.path))
    else if (r && !r.canceled) onError(l.errors.exportFailed(r.error ?? ''))
  })

  return (
    <Panel
      title={l.ca.title}
      right={
        <button
          onClick={() => setOpen(!open)}
          className="text-[11px] text-muted hover:text-phosphor"
        >
          {open ? l.misc.close : l.misc.apply}
        </button>
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[12px] ${ca ? 'text-phosphor' : 'text-amber'}`}>
            {ca ? `✓ ${l.ca.ready}` : `! ${l.ca.notReady}`}
          </span>
          {/* 4 个按钮共用一个 busy：任何一个在跑，其余全部禁用 */}
          <Btn
            variant="ghost"
            onClick={() => void run('pem')}
            disabled={!api || busy}
            aria-busy={busy}
          >
            {busy ? l.misc.working : l.ca.exportPem}
          </Btn>
          <Btn variant="ghost" onClick={() => void run('crt')} disabled={!api || busy}>
            {l.ca.exportCrt}
          </Btn>
          <Btn variant="ghost" onClick={() => void run('open')} disabled={!api || busy}>
            {l.ca.openFolder}
          </Btn>
          {/* 重置会销毁现有 CA（已签发的证书全部失效），走行内二次确认而不是原生弹窗 */}
          <ConfirmButton
            label={l.ca.reset}
            confirmLabel={l.ca.resetConfirm}
            onConfirm={() => void run('reset')}
            disabled={!api || busy}
          />
        </div>

        {open && (
          <div className="space-y-2 border-t border-line-soft pt-2">
            {ca && (
              <div className="space-y-0.5 text-[11.5px]">
                <div>
                  <span className="text-muted">{l.ca.subject}: </span>
                  <span className="text-bright break-all">{ca.subject}</span>
                </div>
                <div>
                  <span className="text-muted">{l.ca.validTo}: </span>
                  <span className="text-bright">{new Date(ca.validTo).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted">{l.ca.path}: </span>
                  <span className="text-bright break-all">{ca.certPath}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted">{l.ca.fingerprint}:</span>
                  <span className="text-bright break-all text-[10.5px]">
                    {ca.fingerprintSha256}
                  </span>
                  <CopyBtn text={ca.fingerprintSha256} />
                </div>
              </div>
            )}
            <div className="border border-line-soft bg-panel-2 px-3 py-2 space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider text-muted">
                {l.ca.installTitle}
              </div>
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
