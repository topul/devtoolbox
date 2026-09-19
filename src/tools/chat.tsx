/**
 * 对话主界面（应用默认视图）。
 *
 * 分工（改这里之前先看清楚谁负责什么）：
 *   - 消息状态与流式渲染模型 = AI SDK 的 `useChat`（parts：text / reasoning / tool）。
 *   - 网络与工具循环 = 主进程原样保留（`electron/main/chat*.ts`）。渲染层不直连服务商，
 *     所以代理 / TLS / SOCKS5 / 自定义头这些能力都还在。
 *   - 两者之间的桥 = `src/lib/chat-transport.ts`（走 IPC 的自定义 transport）。
 *   - 纯逻辑（事件映射、历史转换、旧格式迁移）= `src/lib/chat-ui.ts`。
 *
 * 这个文件只留状态编排与布局，渲染细节在 `src/components/chat/*`。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { Btn, ErrorNote, Input, Panel } from '../components/ui'
import { MessageView } from '../components/chat/MessageView'
import { Composer } from '../components/chat/Composer'
import { SettingsDrawer } from '../components/chat/SettingsDrawer'
import { useLocalized } from '../lib/i18n'
import { chatL } from '../lib/locales/chat'
import { createIpcChatTransport, type ChatTransportHost } from '../lib/chat-transport'
import {
  messageMeta,
  messageText,
  normalizeStoredTurns,
  uiMessagesToHistory,
  type ChatUIMessage,
} from '../lib/chat-ui'
import {
  PRESET_BASE_URLS,
  blankProfile,
  findProfile,
  loadActiveProfileId,
  loadPrices,
  loadProfiles,
  loadServers,
  loadSettings,
  numOrUndefined,
  parseHeaderLines,
  profileName,
  profileReady,
  saveActiveProfileId,
  savePrices,
  saveProfiles,
  saveServers,
  saveSettings,
  toChatToolServers,
  type ChatSettings,
  type CustomServer,
  type ModelProfile,
} from '../lib/chat-config'
import { costOf, estimateMessages, findPrice, uuidV4, type ModelPrice } from '../lib/toolkit'
import type { ChatMessage, ChatSendSpec } from '../lib/chat-types'
import { titleFromText, type ChatSessionMeta } from '../lib/chatstore-types'

/**
 * Chat 实例的 id 固定不变。
 *
 * 会话切换走 `setMessages(载入的消息)` 而不是「换 id 重建 Chat」——
 * 后者会和「发第一条消息时才算会话 id」打架：id 一变 Chat 就重建，
 * 刚送出去的用户消息会从界面上消失。
 */
const CHAT_ID = 'devtoolbox-chat'

export function ChatTool(): React.ReactElement {
  const l = useLocalized(chatL)

  /* ================= 本机配置 ================= */
  const [profiles, setProfiles] = useState<ModelProfile[]>(loadProfiles)
  const [activeId, setActiveId] = useState<string>(loadActiveProfileId)
  const [settings, setSettings] = useState<ChatSettings>(loadSettings)
  const [servers, setServers] = useState<CustomServer[]>(loadServers)
  const [prices, setPrices] = useState<ModelPrice[]>(loadPrices)
  const [showSettings, setShowSettings] = useState(false)
  const [input, setInput] = useState('')
  const [desktop, setDesktop] = useState(true)

  useEffect(() => { saveProfiles(profiles) }, [profiles])
  useEffect(() => { saveSettings(settings) }, [settings])
  useEffect(() => { saveServers(servers) }, [servers])
  useEffect(() => { savePrices(prices) }, [prices])
  useEffect(() => { setDesktop(typeof window !== 'undefined' && !!window.electronAPI) }, [])

  /** 当前模型：档案列表里选中的那条；选不到就退回第一条 */
  const active = findProfile(profiles, activeId) ?? profiles[0] ?? null
  const cfgReady = profileReady(active)

  const activate = useCallback((id: string) => {
    setActiveId(id)
    saveActiveProfileId(id)
  }, [])

  const patchSettings = useCallback((p: Partial<ChatSettings>) => {
    setSettings((s) => ({ ...s, ...p }))
  }, [])

  const addProfile = useCallback((): void => {
    const p = blankProfile()
    setProfiles((prev) => [...prev, p])
    activate(p.id)
  }, [activate])

  // 空清单时先补一条空的：onboard 表单是直接编辑「当前模型」的，
  // 列表为空就没地方写，用户会对着一个填不进去的表单发呆
  useEffect(() => {
    if (profiles.length) return
    const p = blankProfile()
    setProfiles([p])
    activate(p.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patchProfile = useCallback((p: Partial<ModelProfile>) => {
    setProfiles((list) => {
      const hit = findProfile(list, activeId) ?? list[0]
      if (!hit) return list
      return list.map((x) => (x.id === hit.id ? { ...x, ...p } : x))
    })
  }, [activeId])

  /* ================= 工具服务端 ================= */
  const [toolServer, setToolServer] = useState<{ command: string; args: string[]; env: Record<string, string> } | null>(null)
  const [toolServerErr, setToolServerErr] = useState('')
  const [toolNames, setToolNames] = useState<string[]>([])
  const [roundInfo, setRoundInfo] = useState<{ round: number; max: number } | null>(null)
  const [agentNotice, setAgentNotice] = useState('')

  // 工具调用的服务端就是本应用自己的 MCP 服务端，启动配置由主进程算出
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcp : undefined
    if (!api) return
    let alive = true
    api.info().then((v) => {
      if (!alive) return
      if (v.launch.serverPathExists) setToolServer({ command: v.launch.command, args: v.launch.args, env: v.launch.env })
      else setToolServerErr(l.toolsNotBuilt)
    }).catch(() => { if (alive) setToolServerErr(l.toolsNotBuilt) })
    return () => { alive = false }
  }, [l])

  /* ================= 会话持久化 ================= */
  const storeApi = typeof window !== 'undefined' ? window.electronAPI?.chatStore : undefined
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])
  const [sessionId, setSessionId] = useState(() => `s${uuidV4().replace(/-/g, '')}`)
  const [sessionTitle, setSessionTitle] = useState('')
  const [storeNote, setStoreNote] = useState('')
  const [showSessions, setShowSessions] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [storePath, setStorePath] = useState('')

  const sessionRef = useRef({ id: sessionId, title: sessionTitle })
  sessionRef.current = { id: sessionId, title: sessionTitle }

  const refreshSessions = useCallback(async (): Promise<void> => {
    if (!storeApi) return
    try {
      const res = await storeApi.list()
      if (res.ok) setSessions(res.sessions)
    } catch { /* 列表刷新失败不打断对话 */ }
  }, [storeApi])

  /**
   * 写盘。**不含正在流式输出的那条助手消息** —— 半截回答落盘后，
   * 重启看到的半句话比看不到更让人困惑。
   */
  const persist = useCallback(async (id: string, title: string, msgs: ChatUIMessage[]): Promise<void> => {
    if (!storeApi || !id) return
    const settled = msgs.filter((m, i) => !(i === msgs.length - 1 && m.role === 'assistant' && !messageMeta(m).meta && !m.parts.length))
    try {
      const res = await storeApi.save({ id, title, turns: settled })
      if (!res.ok) setStoreNote(res.tooLarge ? l.storeTooLarge : `${l.storeFailed}: ${res.error ?? ''}`)
      else void refreshSessions()
    } catch (e) {
      setStoreNote(`${l.storeFailed}: ${(e as Error).message}`)
    }
  }, [storeApi, l, refreshSessions])

  const persistRef = useRef(persist)
  persistRef.current = persist

  useEffect(() => {
    if (!storeApi) return
    let alive = true
    storeApi.file().then((p) => { if (alive) setStorePath(p) }).catch(() => { /* 拿不到就不显示 */ })
    return () => { alive = false }
  }, [storeApi])

  /* ================= 传输层 ================= */
  /** 供 transport 读取的实时状态（Chat 实例只创建一次，闭包会过期，必须走 ref） */
  const ctxRef = useRef({
    active: active as ModelProfile | null,
    settings,
    servers,
    toolServer,
    l,
  })
  ctxRef.current = { active, settings, servers, toolServer, l }

  const buildSpec = useCallback((history: ChatMessage[], requestId: string): ChatSendSpec => {
    const c = ctxRef.current
    const prof = c.active
    if (!prof || !profileReady(prof)) throw new Error(c.l.noModel)
    const custom = toChatToolServers(c.servers)
    const maxRounds = Math.max(1, Math.min(parseInt(c.settings.maxRounds) || 8, 20))
    const useTools = c.settings.toolsEnabled && (!!c.toolServer || custom.length > 0)
    return {
      requestId,
      baseUrl: prof.baseUrl.trim(),
      apiKey: prof.apiKey.trim(),
      model: prof.model.trim(),
      messages: history,
      temperature: numOrUndefined(c.settings.temperature),
      maxTokens: numOrUndefined(c.settings.maxTokens),
      topP: numOrUndefined(c.settings.topP),
      extraHeaders: parseHeaderLines(c.settings.extraHeaders),
      proxy: c.settings.proxy.trim() || null,
      rejectUnauthorized: c.settings.tlsVerify,
      includeUsage: c.settings.includeUsage,
      tools: useTools
        ? {
            servers: [
              ...(c.toolServer ? [{ label: c.l.toolSelfLabel, command: c.toolServer.command, args: c.toolServer.args, env: c.toolServer.env }] : []),
              ...custom,
            ],
            maxRounds,
          }
        : null,
    }
  }, [])

  const transport = useMemo(() => createIpcChatTransport({
    get api() { return typeof window !== 'undefined' ? window.electronAPI?.chat : undefined },
    buildSpec,
    onUserMessage: (msgs) => {
      // 用户消息先落盘：万一聊天中途退出，至少问题还在
      const { id, title } = sessionRef.current
      void persistRef.current(id, title, msgs)
    },
    onTools: (tools) => setToolNames(tools.map((t) => t.name)),
    onRound: (info) => setRoundInfo(info),
    onNotice: (text) => setAgentNotice(text),
    onRequestStart: () => { setToolNames([]); setRoundInfo(null); setAgentNotice('') },
  }), [buildSpec])

  const setMessagesRef = useRef<(m: ChatUIMessage[]) => void>(() => {})
  const errorRef = useRef('')

  const chat = useChat({
    id: CHAT_ID,
    transport,
    generateId: () => uuidV4(),
    onError: (err) => { errorRef.current = err.message },
    onFinish: ({ messages, isAbort, isError }) => {
      const { id, title } = sessionRef.current
      const patched = messages.map((m, i) => {
        if (i !== messages.length - 1 || m.role !== 'assistant') return m
        const meta = { ...messageMeta(m) }
        if (isAbort) meta.aborted = true
        if (isError) meta.error = errorRef.current || 'ERROR'
        return { ...m, metadata: meta }
      })
      if (isAbort || isError) setMessagesRef.current(patched)
      void persistRef.current(id, title, patched)
    },
  })

  const { messages, status, error, stop, sendMessage, setMessages } = chat
  setMessagesRef.current = setMessages

  const busy = status === 'submitted' || status === 'streaming'

  /** 切走之前先把当前会话写下来，否则会丢最后几条 */
  const flushCurrent = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    // 流式中的那一轮不落盘（onFinish 会负责收尾）
    if (status === 'submitted' || status === 'streaming') return
    if (!messages.length) return
    await persist(sessionId, sessionTitle, messages)
  }, [sessionId, sessionTitle, messages, status, persist])

  // 启动：读回上次的会话列表与当前会话
  useEffect(() => {
    if (!storeApi) return
    let alive = true
    void (async () => {
      try {
        const res = await storeApi.list()
        if (!alive) return
        if (!res.ok) { setStoreNote(l.storeFailed); return }
        setSessions(res.sessions)
        if (res.recovered) setStoreNote(l.storeRecovered)
        const id = res.activeId && res.sessions.some((x) => x.id === res.activeId) ? res.activeId : ''
        if (!id) return
        const loaded = await storeApi.load(id)
        if (!alive || !loaded.ok) return
        setSessionId(id)
        setSessionTitle(res.sessions.find((x) => x.id === id)?.title ?? '')
        setMessages(normalizeStoredTurns(loaded.turns))
      } catch (e) {
        if (alive) setStoreNote(`${l.storeFailed}: ${(e as Error).message}`)
      }
    })()
    return () => { alive = false }
  }, [storeApi, l, setMessages])

  const newSession = async (): Promise<void> => {
    await flushCurrent()
    setSessionId(`s${uuidV4().replace(/-/g, '')}`)
    setSessionTitle('')
    setMessages([])
    setShowSessions(false)
    setRenaming(false)
    setConfirmDel(false)
    setStoreNote('')
    // 新会话还没落盘，先不指认它，免得重启后打开一个空会话
    void storeApi?.setActive(null)
  }

  const switchSession = async (id: string): Promise<void> => {
    if (id === sessionId) { setShowSessions(false); return }
    if (!storeApi || busy) return
    await flushCurrent()
    const loaded = await storeApi.load(id)
    if (!loaded.ok) { setStoreNote(`${l.storeFailed}: ${loaded.error ?? ''}`); return }
    setSessionId(id)
    setSessionTitle(sessions.find((s) => s.id === id)?.title ?? '')
    setMessages(normalizeStoredTurns(loaded.turns))
    setShowSessions(false)
    setRenaming(false)
    setConfirmDel(false)
    void storeApi.setActive(id)
  }

  const removeSession = async (id: string): Promise<void> => {
    if (!storeApi || !id) return
    await storeApi.remove(id)
    if (id === sessionId) {
      setSessionId(`s${uuidV4().replace(/-/g, '')}`)
      setMessages([])
      setSessionTitle('')
    }
    setConfirmDel(false)
    await refreshSessions()
  }

  const commitRename = async (): Promise<void> => {
    const t = titleDraft.trim()
    setRenaming(false)
    if (!t || t === sessionTitle) return
    setSessionTitle(t)
    if (messages.length) await persist(sessionId, t, messages)
  }

  /* ================= 发送 / 停止 / 重试 ================= */

  const send = async (override?: string): Promise<void> => {
    const text = (override ?? input).trim()
    if (!desktop || !text || busy || !cfgReady) return
    if (!sessionTitle) setSessionTitle(titleFromText(text))
    setInput('')
    await sendMessage({ text })
  }

  /** 出错后重试：把刚发出去的那条用户消息撤掉再发一次，避免同一句话在列表里堆两份 */
  const retry = async (): Promise<void> => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'user') return
    const text = messageText(last)
    setMessages(messages.slice(0, -1))
    await send(text)
  }

  const stopStream = (): void => { stop() }

  /* ================= 派生数据 ================= */

  const preflight = useMemo(() => {
    const msgs: { role: string; content: string }[] = []
    if (settings.system.trim()) msgs.push({ role: 'system', content: settings.system })
    msgs.push(...uiMessagesToHistory(messages))
    if (input.trim()) msgs.push({ role: 'user', content: input })
    return estimateMessages(msgs)
  }, [settings.system, messages, input])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const lastMeta = lastAssistant ? messageMeta(lastAssistant).meta : undefined
  const lastCost = (() => {
    if (!lastMeta) return null
    const price = findPrice(lastMeta.model ?? active?.model ?? '', prices)
    if (!price) return null
    const tokens = lastMeta.usage?.completionTokens ?? Math.ceil(lastMeta.chars / 3.2)
    return costOf(price, {
      promptTokens: lastMeta.usage?.promptTokens ?? 0,
      completionTokens: tokens,
      cachedTokens: lastMeta.usage?.cachedTokens ?? 0,
    }).total
  })()

  const notice = [storeNote, agentNotice].filter(Boolean).join(' · ')
  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
  /** 发送阶段就失败（配置不全 / IPC 断了）时没有助手消息，错误单独显示 */
  const sendError = status === 'error' && !lastIsAssistant ? (error?.message ?? '') : ''

  /* ================= 未配模型：配置引导 ================= */
  if (!cfgReady) {
    return (
      <div className="max-w-[680px] mx-auto fade-in py-8">
        <Panel title={l.onboardTitle}>
          <p className="text-[12.5px] text-muted leading-relaxed mb-4">{l.onboardIntro}</p>
          {!desktop && <ErrorNote msg={l.noDesktop} />}
          <div className="space-y-3">
            <Input value={active?.baseUrl ?? ''} onChange={(v) => patchProfile({ baseUrl: v })} label={l.baseUrl} placeholder={l.baseUrlPh} />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_BASE_URLS.map(([name, url]) => (
                <button key={name} onClick={() => patchProfile({ baseUrl: url })}
                  className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
                  {name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 min-[640px]:grid-cols-2 gap-3">
              <Input value={active?.model ?? ''} onChange={(v) => patchProfile({ model: v })} label={l.model} placeholder={l.modelPh} />
              <Input value={active?.apiKey ?? ''} onChange={(v) => patchProfile({ apiKey: v })} label={l.apiKey} placeholder={l.apiKeyPh} type="password" />
            </div>
          </div>
          <p className="text-[11px] text-muted mt-4 leading-relaxed border-t border-line-soft pt-3">
            {l.apiKeyNote} {l.onboardTools}
          </p>
        </Panel>
      </div>
    )
  }

  /* ================= 主布局 ================= */
  const rail = (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-line bg-panel/60 lg:h-screen">
      <button
        onClick={() => void newSession()}
        disabled={busy}
        className="m-2 border border-line-soft px-3 py-2 text-[12px] text-bright hover:border-phosphor/50 hover:text-phosphor transition-colors disabled:opacity-40"
      >
        + {l.newSession}
      </button>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {sessions.length === 0 && <div className="px-2 py-4 text-[11px] text-muted leading-relaxed">{l.emptySessions}</div>}
        {sessions.map((sess) => (
          <div key={sess.id} className={`group flex items-center gap-1 rounded-sm mb-0.5 ${sess.id === sessionId ? 'bg-phosphor-faint' : 'hover:bg-phosphor-faint/50'}`}>
            <button
              onClick={() => void switchSession(sess.id)}
              disabled={busy}
              className={`flex-1 min-w-0 text-left px-2 py-1.5 text-[12px] truncate ${sess.id === sessionId ? 'text-phosphor' : 'text-dim hover:text-bright'}`}
              title={sess.title || l.untitledSession}
            >
              {sess.title || l.untitledSession}
              <span className="ml-1.5 text-[9.5px] text-muted/50">{sess.turnCount}</span>
            </button>
            <button
              onClick={() => { if (sess.id === sessionId) { setTitleDraft(sessionTitle || sess.title); setRenaming(true) } }}
              title={l.rename}
              className="hidden group-hover:block text-muted hover:text-phosphor text-[11px] px-0.5"
            >✎</button>
            <button
              onClick={() => { if (sess.id === sessionId) { if (confirmDel) void removeSession(sess.id); else setConfirmDel(true) } else void removeSession(sess.id) }}
              title={confirmDel && sess.id === sessionId ? l.confirmDelete : l.deleteSession}
              className={`hidden group-hover:block text-[12px] px-0.5 ${confirmDel && sess.id === sessionId ? 'text-danger' : 'text-muted hover:text-danger'}`}
            >×</button>
          </div>
        ))}
      </div>
      <div className="border-t border-line-soft px-2.5 py-2">
        <p className="text-[9.5px] text-muted/50 leading-snug break-all" title={storePath || l.savedHint}>{l.savedHint}</p>
      </div>
    </aside>
  )

  // 高度见 index.css 的 .chat-viewport：宽屏下要抵消 <main> 的 zoom
  return (
    <div className="flex chat-viewport">
      {rail}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2 shrink-0 pt-safe">
          {renaming ? (
            <>
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void commitRename(); if (e.key === 'Escape') setRenaming(false) }}
                autoFocus
                spellCheck={false}
                className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright focus:outline-none focus:border-phosphor/40"
              />
              <Btn variant="ghost" onClick={() => void commitRename()}>{l.renameSave}</Btn>
              <Btn variant="ghost" onClick={() => setRenaming(false)}>{l.renameCancel}</Btn>
            </>
          ) : (
            <>
              <span className="text-[12.5px] text-bright truncate">{sessionTitle || l.untitledSession}</span>
              <span className="text-[10px] text-muted/60 truncate hidden md:inline">
                {active ? `${profileName(active)} · ${active.model}` : ''}
              </span>
              <span className="flex-1" />
              {notice && (
                <span className="hidden md:inline text-[10.5px] text-amber truncate max-w-[40%]" title={notice}>{notice}</span>
              )}
              <button
                onClick={() => setShowSessions((v) => !v)}
                disabled={!storeApi}
                className="lg:hidden border border-line-soft px-2 py-1 text-[11px] text-muted hover:text-phosphor"
              >{l.sessionsTitle}</button>
              <button
                onClick={() => setShowSettings(true)}
                className="border border-line-soft px-2.5 py-1 text-[12px] text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors"
                title={l.settingsTitle}
              >⚙</button>
            </>
          )}
        </header>

        {notice && <p className="lg:hidden px-3 py-1.5 text-[11px] text-amber border-b border-line-soft">{notice}</p>}

        {showSessions && (
          <div className="lg:hidden border-b border-line max-h-[40vh] overflow-auto">
            <button onClick={() => void newSession()} className="w-full text-left px-3 py-2 text-[12px] text-phosphor border-b border-line-soft">
              + {l.newSession}
            </button>
            {sessions.length === 0 && <div className="px-3 py-3 text-[11.5px] text-muted">{l.emptySessions}</div>}
            {sessions.map((sess) => (
              <button key={sess.id} onClick={() => void switchSession(sess.id)}
                className={`w-full text-left px-3 py-2 border-b border-line-soft last:border-0 text-[12px] ${sess.id === sessionId ? 'bg-phosphor-faint text-phosphor' : 'text-bright'}`}>
                <div className="truncate">{sess.title || l.untitledSession}</div>
                <div className="text-[10px] text-muted">{l.msgCount(sess.turnCount)} · {new Date(sess.updatedAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
        )}

        <MessageList
          messages={messages}
          busy={busy}
          prices={prices}
          model={active?.model ?? ''}
          emptyText={`${l.empty}　${l.emptyHint}`}
          sendError={sendError}
          onRetry={retry}
        />

        <div className="border-t border-line px-4 py-3 shrink-0 pb-safe">
          <div className="max-w-[860px] mx-auto">
            <Composer
              input={input}
              onInput={setInput}
              onSend={() => void send()}
              onStop={stopStream}
              streaming={busy}
              profiles={profiles}
              activeId={active?.id ?? ''}
              onPickProfile={activate}
              onManageModels={() => setShowSettings(true)}
              onAddProfile={addProfile}
              estimate={preflight.total}
              cost={lastCost}
              roundInfo={roundInfo}
              toolCount={toolNames.length}
              disabled={!desktop || !cfgReady}
            />
          </div>
        </div>
      </div>

      <SettingsDrawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        profiles={profiles}
        setProfiles={setProfiles}
        activeId={active?.id ?? ''}
        onActivate={activate}
        settings={settings}
        patchSettings={patchSettings}
        servers={servers}
        setServers={setServers}
        prices={prices}
        setPrices={setPrices}
        toolServerErr={toolServerErr}
      />
    </div>
  )
}

/* ================= 消息流 ================= */

function MessageList({ messages, busy, prices, model, emptyText, sendError, onRetry }: {
  messages: ChatUIMessage[]
  busy: boolean
  prices: ModelPrice[]
  model: string
  emptyText: string
  sendError: string
  onRetry: () => Promise<void>
}): React.ReactElement {
  const l = useLocalized(chatL)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 贴底跟随：只有当前已经在底部附近才自动滚，避免打断向上翻阅
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
      <div className="max-w-[860px] mx-auto space-y-4">
        {messages.length === 0 && (
          <div className="py-16 text-center">
            <div className="text-phosphor/40 text-2xl mb-2">✦</div>
            <p className="text-[12px] text-muted leading-relaxed">{emptyText}</p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView
            key={m.id}
            msg={m}
            live={busy && i === messages.length - 1}
            price={findPrice(messageMeta(m).meta?.model ?? model, prices)}
          />
        ))}
        {sendError && (
          <div className="space-y-2">
            <ErrorNote msg={sendError} />
            <Btn onClick={() => void onRetry()}>{l.retry}</Btn>
          </div>
        )}
      </div>
    </div>
  )
}
