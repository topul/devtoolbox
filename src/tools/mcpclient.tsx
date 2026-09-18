import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, Btn, TA, Input, ErrorNote, KV, CopyBtn, ToolGuide, Collapse } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { mcpclientL } from '../lib/locales/mcpclient'
import { uuidV4 } from '../lib/toolkit'
import type {
  McpCallOutcome,
  McpCatalog,
  McpClientEvent,
  McpConnectSpec,
  McpConnectStatus,
  McpServerInfo,
  McpTransportKind,
} from '../lib/mcpclient-types'

/**
 * MCP Inspector。
 *
 * 界面不做协议处理：握手、帧收发、超时全在 `electron/main/mcpclient.ts`。
 * 这里只负责表单、清单渲染与把原始帧按到达顺序展示出来。
 *
 * 默认预设指向本应用自己的 MCP 服务端 —— 也就是「AI 能调用我们自己的工具」这条路
 * 在人工视角下的同一个入口。
 */

type L = typeof mcpclientL['zh']
type Tab = 'tools' | 'resources' | 'prompts'

interface TimelineItem {
  seq: number
  kind: 'frame' | 'log'
  dir?: 'send' | 'recv'
  ok?: boolean
  source?: 'stderr' | 'info'
  text: string
  at: string
}

const TIMELINE_MAX = 300

interface FormState {
  command: string
  args: string
  env: string
  cwd: string
  url: string
  headers: string
  timeout: string
}

const DEFAULT_FORM: FormState = {
  command: '',
  args: '',
  env: '',
  cwd: '',
  url: '',
  headers: '',
  timeout: '30000',
}

const FORM_KEY = 'devtoolbox-mcpclient-form'

function loadForm(): Record<McpTransportKind, FormState> {
  const fallback: Record<McpTransportKind, FormState> = { stdio: DEFAULT_FORM, http: DEFAULT_FORM }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(FORM_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Record<McpTransportKind, FormState>>
    return {
      stdio: { ...DEFAULT_FORM, ...(parsed.stdio ?? {}) },
      http: { ...DEFAULT_FORM, ...(parsed.http ?? {}) },
    }
  } catch {
    return fallback
  }
}

/** 按 schema 生成参数骨架：只填必填项，可选项留空以免噪声 */
function skeleton(schema: McpCatalog['tools'][number]['inputSchema']): Record<string, unknown> {
  const props = schema?.properties ?? {}
  const required = new Set(schema?.required ?? [])
  const out: Record<string, unknown> = {}
  for (const [k, raw] of Object.entries(props)) {
    if (!required.has(k)) continue
    const p = raw as { type?: string; default?: unknown; enum?: unknown[] }
    if (p.default !== undefined) out[k] = p.default
    else if (Array.isArray(p.enum) && p.enum.length) out[k] = p.enum[0]
    else if (p.type === 'number') out[k] = 0
    else if (p.type === 'boolean') out[k] = false
    else out[k] = ''
  }
  return out
}

function parseLines(raw: string): string[] {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean)
}

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of parseLines(raw)) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

function parseHeaders(raw: string): [string, string][] {
  const out: [string, string][] = []
  for (const line of parseLines(raw)) {
    const i = line.indexOf(':')
    if (i > 0) out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()])
  }
  return out
}

function clock(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function McpInspectorTool() {
  const l = useLocalized(mcpclientL)
  const [transport, setTransport] = useState<McpTransportKind>('stdio')
  const [forms, setForms] = useState<Record<McpTransportKind, FormState>>(loadForm)
  const [status, setStatus] = useState<McpConnectStatus>('disconnected')
  const [detail, setDetail] = useState('')
  const [info, setInfo] = useState<McpServerInfo | null>(null)
  const [catalog, setCatalog] = useState<McpCatalog | null>(null)
  const [tab, setTab] = useState<Tab>('tools')
  const [target, setTarget] = useState('')
  const [argsText, setArgsText] = useState('{}')
  const [argsErr, setArgsErr] = useState('')
  const [outcome, setOutcome] = useState<McpCallOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [paused, setPaused] = useState(false)
  const [dropped, setDropped] = useState(0)
  const [desktop, setDesktop] = useState(true)
  const [connErr, setConnErr] = useState('')

  const idRef = useRef(uuidV4())
  const seqRef = useRef(0)
  const pausedRef = useRef(paused)
  const streamRef = useRef<HTMLDivElement | null>(null)
  pausedRef.current = paused

  const form = forms[transport]
  const patchForm = (p: Partial<FormState>): void =>
    setForms((prev) => ({ ...prev, [transport]: { ...prev[transport], ...p } }))

  useEffect(() => { localStorage.setItem(FORM_KEY, JSON.stringify(forms)) }, [forms])
  useEffect(() => { setDesktop(typeof window !== 'undefined' && !!window.electronAPI) }, [])

  const push = (item: Omit<TimelineItem, 'seq' | 'at'>): void => {
    if (pausedRef.current) {
      setDropped((n) => n + 1)
      return
    }
    seqRef.current += 1
    const next: TimelineItem = { ...item, seq: seqRef.current, at: clock() }
    setTimeline((prev) => {
      const merged = [...prev, next]
      return merged.length > TIMELINE_MAX ? merged.slice(merged.length - TIMELINE_MAX) : merged
    })
  }

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcpClient : undefined
    if (!api) return
    return api.onEvent((evt: McpClientEvent) => {
      if (evt.id !== idRef.current) return
      switch (evt.type) {
        case 'frame':
          push({ kind: 'frame', dir: evt.dir, ok: evt.ok, text: evt.payload })
          break
        case 'log':
          push({ kind: 'log', source: evt.source, text: evt.text })
          break
        case 'status':
          setStatus(evt.status)
          if (evt.detail) setDetail(evt.detail)
          break
        case 'serverInfo':
          setInfo(evt.info)
          break
        case 'catalog':
          setCatalog(evt.catalog)
          break
        case 'notification':
          push({ kind: 'log', source: 'info', text: `notification ${evt.method} ${evt.params ? JSON.stringify(evt.params) : ''}` })
          break
        default:
          break
      }
    })
  }, [])

  // 贴底跟随：只在已经在底部附近时自动滚动，避免打断向上翻阅
  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [timeline])

  const buildSpec = (t: McpTransportKind, f: FormState): McpConnectSpec => ({
    id: idRef.current,
    transport: t,
    timeoutMs: Math.max(parseInt(f.timeout) || 30000, 500),
    ...(t === 'stdio'
      ? {
          command: f.command.trim(),
          args: parseLines(f.args),
          env: parseEnv(f.env),
          cwd: f.cwd.trim() || undefined,
        }
      : {
          url: f.url.trim(),
          headers: parseHeaders(f.headers),
        }),
  })

  /**
   * 显式接收 transport 与表单值：用预设按钮时要立刻按**新值**连接，
   * 而 setState 在同一轮里还没生效，不能读 state。
   */
  const connect = async (t: McpTransportKind = transport, f: FormState = form): Promise<void> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcpClient : undefined
    if (!api) return
    setConnErr('')
    setDetail('')
    setOutcome(null)
    setCatalog(null)
    setInfo(null)
    setBusy(true)
    // 换一次连接就换一个 id：避免上一轮的迟到事件混进这一轮
    idRef.current = uuidV4()
    const res = await api.connect(buildSpec(t, f))
    setBusy(false)
    if (!res.ok) {
      setConnErr(res.error ?? '')
      setStatus('error')
      return
    }
    // 服务端信息与能力清单以**返回值**为准，不依赖事件到达顺序
    // （事件只负责状态、原始帧与诊断日志）
    if (res.info) setInfo(res.info)
    if (res.catalog) setCatalog(res.catalog)
    setStatus('connected')
  }

  const disconnect = async (): Promise<void> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcpClient : undefined
    await api?.disconnect()
    setStatus('disconnected')
    setInfo(null)
    setCatalog(null)
    setOutcome(null)
    setTarget('')
  }

  const useSelfPreset = async (): Promise<void> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcp : undefined
    const info = await api?.info().catch(() => null)
    if (!info) return
    const next: FormState = {
      ...DEFAULT_FORM,
      command: info.launch.command,
      args: info.launch.args.join('\n'),
      env: Object.entries(info.launch.env).map(([k, v]) => `${k}=${v}`).join('\n'),
      timeout: '30000',
    }
    setTransport('stdio')
    setForms((prev) => ({ ...prev, stdio: next }))
    await connect('stdio', next)
  }

  const useFilesystemPreset = (): void => {
    const next: FormState = {
      ...DEFAULT_FORM,
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-filesystem\n/tmp',
      timeout: '60000',
    }
    setTransport('stdio')
    setForms((prev) => ({ ...prev, stdio: next }))
  }

  const pick = (name: string, schema?: McpCatalog['tools'][number]['inputSchema']): void => {
    setTarget(name)
    setOutcome(null)
    setArgsErr('')
    setArgsText(JSON.stringify(schema ? skeleton(schema) : {}, null, 2))
  }

  const invoke = async (): Promise<void> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcpClient : undefined
    if (!api || !target) return
    let args: Record<string, unknown> = {}
    if (tab !== 'resources') {
      try {
        const parsed = JSON.parse(argsText || '{}') as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
        else {
          setArgsErr(l.argsInvalid)
          return
        }
      } catch {
        setArgsErr(l.argsInvalid)
        return
      }
    }
    setArgsErr('')
    setBusy(true)
    const res = tab === 'tools'
      ? await api.call(target, args)
      : tab === 'resources'
        ? await api.readResource(target)
        : await api.getPrompt(target, args)
    setBusy(false)
    setOutcome(res)
  }

  const pingIt = async (): Promise<void> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcpClient : undefined
    if (!api) return
    const res = await api.ping()
    push({ kind: 'log', source: res.ok ? 'info' : 'stderr', text: res.ok ? l.pingOk(res.ms ?? 0) : l.pingFail(String(res.error ?? '')) })
  }

  const statusText = status === 'connected' ? l.connected
    : status === 'connecting' ? l.connecting
      : status === 'error' ? l.connFailed
        : l.disconnected
  const statusCls = status === 'connected' ? 'text-phosphor border-phosphor/40'
    : status === 'connecting' ? 'text-amber border-amber/40'
      : status === 'error' ? 'text-danger border-danger/40'
        : 'text-muted border-line-soft'

  const items = useMemo<{ name: string; hint: string; schema?: McpCatalog['tools'][number]['inputSchema'] }[]>(() => {
    if (!catalog) return []
    if (tab === 'tools') {
      return catalog.tools.map((t) => ({
        name: t.name,
        hint: t.description ?? '',
        schema: t.inputSchema,
      }))
    }
    if (tab === 'resources') {
      return catalog.resources.map((r) => ({ name: r.uri, hint: [r.name, r.mimeType, r.description].filter(Boolean).join(' · ') }))
    }
    return catalog.prompts.map((p) => ({
      name: p.name,
      hint: [p.description, p.arguments?.length ? l.argCount(p.arguments.length) : ''].filter(Boolean).join(' · '),
    }))
  }, [catalog, tab, l])

  const declaredForTab = catalog?.declared[tab] ?? false

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-bright leading-relaxed max-w-[1200px]">{l.intro}</p>

      <ToolGuide title={l.guideTitle} steps={l.guideSteps} />

      {!desktop && <ErrorNote msg={l.noDesktop} />}

      <Panel title={l.connTitle} right={<span className={`text-[10px] px-1.5 py-0.5 border ${statusCls}`}>{statusText}</span>}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted uppercase tracking-wider">{l.transportLabel}</span>
            {(['stdio', 'http'] as McpTransportKind[]).map((t) => (
              <button key={t} onClick={() => setTransport(t)} disabled={status === 'connected'}
                className={`px-2 py-0.5 text-[11px] border transition-colors ${transport === t ? 'border-phosphor/50 text-phosphor' : 'border-line-soft text-muted hover:text-bright'}`}>
                {t === 'stdio' ? l.transportStdio : l.transportHttp}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-muted uppercase tracking-wider">{l.presetLabel}</span>
            <button onClick={useSelfPreset} disabled={status === 'connected' || busy} title={l.presetSelfNote}
              className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
              {l.presetSelf}
            </button>
            <button onClick={useFilesystemPreset} disabled={status === 'connected'} title={l.presetFilesystemNote}
              className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
              {l.presetFilesystem}
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-3">
          {transport === 'stdio' ? (
            <>
              <Input value={form.command} onChange={(v) => patchForm({ command: v })} label={l.commandLabel} placeholder={l.commandPh} />
              <div className="grid grid-cols-1 min-[1500px]:grid-cols-2 gap-3">
                <TA value={form.args} onChange={(v) => patchForm({ args: v })} label={l.argsLabel} placeholder={l.argsPh} rows={3} />
                <TA value={form.env} onChange={(v) => patchForm({ env: v })} label={l.envLabel} placeholder={l.envPh} rows={3} />
              </div>
              <div className="grid grid-cols-1 min-[1500px]:grid-cols-2 gap-3">
                <Input value={form.cwd} onChange={(v) => patchForm({ cwd: v })} label={l.cwdLabel} placeholder={l.cwdPh} />
                <Input value={form.timeout} onChange={(v) => patchForm({ timeout: v })} label={l.timeoutLabel} type="number" />
              </div>
            </>
          ) : (
            <>
              <Input value={form.url} onChange={(v) => patchForm({ url: v })} label={l.urlLabel} placeholder={l.urlPh} />
              <div className="grid grid-cols-1 min-[1500px]:grid-cols-2 gap-3">
                <TA value={form.headers} onChange={(v) => patchForm({ headers: v })} label={l.headersLabel} placeholder={l.headersPh} rows={3} />
                <Input value={form.timeout} onChange={(v) => patchForm({ timeout: v })} label={l.timeoutLabel} type="number" />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Btn variant="primary" onClick={() => connect()} disabled={status === 'connected' || busy}>{l.connect}</Btn>
          <Btn onClick={disconnect} disabled={status !== 'connected'}>{l.disconnect}</Btn>
          <Btn onClick={pingIt} disabled={status !== 'connected'}>{l.ping}</Btn>
          {busy && <span className="text-[11px] text-amber">{l.calling}…</span>}
          {detail && <span className="text-[11px] text-muted">{detail}</span>}
        </div>
        {connErr && <div className="mt-2"><ErrorNote msg={connErr} /></div>}

        {info && (
          <div className="mt-3 border-t border-line-soft pt-3">
            <div className="text-[11px] uppercase tracking-wider text-muted mb-1">{l.serverInfoTitle}</div>
            <KV k={l.serverName} v={info.name} />
            <KV k={l.serverVersion} v={info.version || '—'} />
            <KV k={l.protocol} v={info.protocolVersion || '—'} />
            <KV k={l.capabilities} v={Object.keys(info.capabilities).join(', ') || '—'} />
            {info.instructions && (
              <div className="mt-2">
                <div className="text-[11px] uppercase tracking-wider text-muted mb-1">{l.instructionsTitle}</div>
                <pre className="codeblock text-[11.5px] text-muted whitespace-pre-wrap break-all">{info.instructions}</pre>
              </div>
            )}
          </div>
        )}
      </Panel>

      {!catalog && (
        <Panel title={l.catalogTitle}>
          <p className="text-[12px] text-muted">{l.empty}</p>
        </Panel>
      )}

      {catalog && (
      <div className="grid grid-cols-1 min-[1500px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <Panel title={l.catalogTitle} right={
          <span className="flex items-center gap-1.5">
            {(['tools', 'resources', 'prompts'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2 py-0.5 text-[11px] border transition-colors ${tab === t ? 'border-phosphor/50 text-phosphor' : 'border-line-soft text-muted hover:text-bright'}`}>
                {t === 'tools' ? l.tabTools : t === 'resources' ? l.tabResources : l.tabPrompts}
              </button>
            ))}
          </span>
        }>
          {!catalog && <p className="text-[12px] text-muted">{l.empty}</p>}
          {catalog && !declaredForTab && (
            <p className="text-[12px] text-muted">{l.notDeclared.replace('{x}', tab === 'tools' ? l.tabTools : tab === 'resources' ? l.tabResources : l.tabPrompts)}</p>
          )}
          {catalog && declaredForTab && items.length === 0 && <p className="text-[12px] text-muted">{l.emptyList}</p>}
          {catalog && declaredForTab && items.length > 0 && (
            <div className="border border-line-soft max-h-[46vh] overflow-auto">
              {items.map((it) => (
                <button key={it.name} onClick={() => pick(it.name, it.schema)}
                  className={`w-full text-left px-3 py-2 border-b border-line-soft last:border-0 transition-colors ${target === it.name ? 'bg-phosphor-faint' : 'hover:bg-phosphor-faint'}`}>
                  <div className={`text-[12.5px] break-all ${target === it.name ? 'text-phosphor' : 'text-bright'}`}>{it.name}</div>
                  {it.hint && <div className="text-[11.5px] text-muted leading-snug mt-0.5">{it.hint}</div>}
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={l.callTitle} right={target ? <CopyBtn text={target} /> : undefined}>
          {!target && <p className="text-[12px] text-muted">{l.pickHint}</p>}
          {target && (
            <div className="space-y-3">
              <KV k={l.targetLabel} v={<span className="break-all">{target}</span>} />
              {tab === 'resources' ? (
                <p className="text-[11px] text-muted">{l.noArgs}</p>
              ) : (
                <div>
                  <TA value={argsText} onChange={setArgsText} label={l.argsJsonLabel} rows={6} />
                  {argsErr && <div className="mt-1"><ErrorNote msg={argsErr} /></div>}
                </div>
              )}
              <Btn variant="primary" onClick={invoke} disabled={busy}>
                {busy ? `${l.calling}…` : tab === 'tools' ? l.runTool : tab === 'resources' ? l.readResource : l.getPrompt}
              </Btn>

              {outcome && (
                <div className="border-t border-line-soft pt-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] uppercase tracking-wider text-muted">{l.resultTitle}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 border ${outcome.ok && !outcome.isError ? 'text-phosphor border-phosphor/40' : outcome.isError ? 'text-amber border-amber/40' : 'text-danger border-danger/40'}`}>
                      {outcome.ok ? (outcome.isError ? l.resToolError : l.resOk) : l.resFailed}
                    </span>
                    <span className="text-[11px] text-muted">{l.durationLabel} {outcome.durationMs} ms</span>
                  </div>
                  {outcome.error && <ErrorNote msg={outcome.error} />}
                  {outcome.text && (
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted">{l.resultTitle}</span>
                        <CopyBtn text={outcome.text} />
                      </div>
                      <pre className="codeblock text-[12px] text-phosphor whitespace-pre-wrap break-all max-h-[26vh] overflow-auto">{outcome.text}</pre>
                    </div>
                  )}
                  {outcome.raw !== null && outcome.raw !== undefined && (
                    <details>
                      <summary className="text-[11px] text-muted cursor-pointer">{l.rawResult}</summary>
                      <pre className="codeblock text-[11px] text-muted whitespace-pre-wrap break-all max-h-[26vh] overflow-auto mt-1">{JSON.stringify(outcome.raw, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
      )}

      <Collapse title={l.framesTitle} right={
        <span className="flex items-center gap-2">
          {dropped > 0 && <span className="text-[11px] text-amber">{l.dropped.replace('{n}', String(dropped))}</span>}
          <Btn variant="ghost" onClick={() => { setPaused((v) => !v); if (paused) setDropped(0) }}>{paused ? l.resume : l.pause}</Btn>
          <Btn variant="ghost" onClick={() => { setTimeline([]); setDropped(0) }}>{l.clear}</Btn>
        </span>
      }>
        <div ref={streamRef} className="border border-line-soft bg-panel-2 max-h-[34vh] overflow-auto p-2 font-mono text-[11.5px] leading-relaxed">
          {timeline.length === 0 && <div className="text-muted px-1 py-2">{l.emptyFrames}</div>}
          {timeline.map((it) => (
            <div key={it.seq} className="flex gap-2 px-1 py-0.5">
              <span className="text-muted/60 shrink-0">{it.at}</span>
              {it.kind === 'frame' ? (
                <>
                  <span className={`shrink-0 w-10 ${it.dir === 'send' ? 'text-[#7ec8ff]' : it.ok === false ? 'text-danger' : 'text-amber'}`}>
                    {it.dir === 'send' ? l.frameSend : it.ok === false ? l.frameJunk : l.frameRecv}
                  </span>
                  <span className={`break-all ${it.ok === false ? 'text-danger' : it.dir === 'send' ? 'text-bright' : 'text-phosphor'}`}>{it.text}</span>
                </>
              ) : (
                <>
                  <span className={`shrink-0 w-10 ${it.source === 'stderr' ? 'text-muted' : 'text-[#7ec8ff]'}`}>
                    {it.source === 'stderr' ? l.logStderr : l.logInfo}
                  </span>
                  <span className="break-all text-muted whitespace-pre-wrap">{it.text}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </Collapse>

      <Collapse title={l.hint}>
        <ul className="text-[12px] text-muted space-y-1 list-none">
          {l.hintItems.map((x) => <li key={x}>· {x}</li>)}
        </ul>
      </Collapse>
    </div>
  )
}
