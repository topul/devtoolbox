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
 * 这个文件只留状态编排与布局，渲染细节在 `src/components/chat/*`：
 * 消息流 MessageList、输入区 Composer、引导页 OnboardPanel、会话栏 SessionRail、
 * 顶栏 ChatHeader、会话持久化 useChatSessions。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { MessageList } from '../components/chat/MessageList'
import { ChatEmptyState } from '../components/chat/ChatEmptyState'
import { Composer } from '../components/chat/Composer'
import { OnboardPanel } from '../components/chat/OnboardPanel'
import { ChatHeader } from '../components/chat/ChatHeader'
import { MobileSessionList, SessionRail } from '../components/chat/SessionRail'
import { useChatSessions } from '../components/chat/useChatSessions'
import { usePaneMode } from '../components/chat/usePaneMode'
import { PaneEnterButton, PaneView } from '../components/chat/PaneView'
import { SettingsDrawer } from '../components/chat/SettingsDrawer'
import { TraceDrawer } from '../components/chat/TraceView'
import { useLocalized } from '../lib/i18n'
import { chatL } from '../lib/locales/chat'
import { chatpanesL } from '../lib/locales/chatpanes'
import { createIpcChatTransport } from '../lib/chat-transport'
import { buildChatSendSpec, lastReplyCost } from '../lib/chat-spec'
import { estimatePreflight, messageMeta, messageText, type ChatUIMessage } from '../lib/chat-ui'
import {
  blankProfile,
  findProfile,
  loadActiveProfileId,
  loadPrices,
  loadProfiles,
  loadServers,
  loadSettings,
  profileName,
  profileReady,
  saveActiveProfileId,
  savePrices,
  saveProfiles,
  saveServers,
  saveSettings,
  type ChatSettings,
  type CustomServer,
  type ModelProfile,
} from '../lib/chat-config'
import { uuidV4, type ModelPrice } from '../lib/toolkit'
import type { ChatMessage, ChatSendSpec } from '../lib/chat-types'
import { WEB_BUILD } from '../lib/platform'
import { titleFromText } from '../lib/chatstore-types'

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
  const lp = useLocalized(chatpanesL)

  /* ================= 本机配置 ================= */
  const [profiles, setProfiles] = useState<ModelProfile[]>(loadProfiles)
  const [activeId, setActiveId] = useState<string>(loadActiveProfileId)
  const [settings, setSettings] = useState<ChatSettings>(loadSettings)
  const [servers, setServers] = useState<CustomServer[]>(loadServers)
  const [prices, setPrices] = useState<ModelPrice[]>(loadPrices)
  const [showSettings, setShowSettings] = useState(false)
  const [input, setInput] = useState('')
  const [desktop, setDesktop] = useState(true)
  /** 正在查看调用链路的消息 id（= requestId）；null = 关闭 */
  const [traceId, setTraceId] = useState<string | null>(null)

  useEffect(() => {
    saveProfiles(profiles)
  }, [profiles])
  useEffect(() => {
    saveSettings(settings)
  }, [settings])
  useEffect(() => {
    saveServers(servers)
  }, [servers])
  useEffect(() => {
    savePrices(prices)
  }, [prices])
  useEffect(() => {
    setDesktop(typeof window !== 'undefined' && !!window.electronAPI)
  }, [])

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

  const patchProfile = useCallback(
    (p: Partial<ModelProfile>) => {
      setProfiles((list) => {
        const hit = findProfile(list, activeId) ?? list[0]
        if (!hit) return list
        return list.map((x) => (x.id === hit.id ? { ...x, ...p } : x))
      })
    },
    [activeId],
  )

  /* ================= 工具服务端 ================= */
  const [toolServer, setToolServer] = useState<{
    command: string
    args: string[]
    env: Record<string, string>
  } | null>(null)
  const [toolServerErr, setToolServerErr] = useState('')
  const [toolNames, setToolNames] = useState<string[]>([])
  const [roundInfo, setRoundInfo] = useState<{ round: number; max: number } | null>(null)
  const [agentNotice, setAgentNotice] = useState('')

  // 工具调用的服务端就是本应用自己的 MCP 服务端，启动配置由主进程算出
  useEffect(() => {
    if (WEB_BUILD) {
      // 浏览器没有进程模型：内置本机工具不可用。如实说明，并把用户引向 HTTP 自定义源。
      setToolServerErr(l.toolsWebOnly)
      return
    }
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcp : undefined
    if (!api) return
    let alive = true
    api
      .info()
      .then((v) => {
        if (!alive) return
        if (v.launch.serverPathExists)
          setToolServer({ command: v.launch.command, args: v.launch.args, env: v.launch.env })
        else setToolServerErr(l.toolsNotBuilt)
      })
      .catch(() => {
        if (alive) setToolServerErr(l.toolsNotBuilt)
      })
    return () => {
      alive = false
    }
  }, [l])

  /* ================= 传输层 ================= */
  // session/persist 的实际值来自 useChatSessions（在后面调用），
  // 但 transport 的回调闭包要先拿到稳定 ref —— 声明提前，赋值在 hook 之后
  const sessionRef = useRef({ id: '', title: '' })
  const persistRef = useRef<(id: string, title: string, msgs: ChatUIMessage[]) => Promise<void>>(
    async () => {},
  )

  /** 供 transport 读取的实时状态（Chat 实例只创建一次，闭包会过期，必须走 ref） */
  const ctxRef = useRef({
    active: active as ModelProfile | null,
    settings,
    servers,
    toolServer,
    l,
  })
  ctxRef.current = { active, settings, servers, toolServer, l }

  const buildSpec = useCallback(
    (history: ChatMessage[], requestId: string): ChatSendSpec => {
      const c = ctxRef.current
      return buildChatSendSpec(
        {
          active: c.active,
          settings: c.settings,
          servers: c.servers,
          toolServer: c.toolServer,
          noModel: c.l.noModel,
          toolSelfLabel: c.l.toolSelfLabel,
        },
        history,
        requestId,
      )
    },
    [],
  )

  const transport = useMemo(
    () =>
      createIpcChatTransport({
        get api() {
          return typeof window !== 'undefined' ? window.electronAPI?.chat : undefined
        },
        buildSpec,
        onUserMessage: (msgs) => {
          // 用户消息先落盘：万一聊天中途退出，至少问题还在
          const { id, title } = sessionRef.current
          void persistRef.current(id, title, msgs)
        },
        onTools: (tools) => setToolNames(tools.map((t) => t.name)),
        onRound: (info) => setRoundInfo(info),
        onNotice: (text) => setAgentNotice(text),
        onRequestStart: () => {
          setToolNames([])
          setRoundInfo(null)
          setAgentNotice('')
        },
      }),
    [buildSpec],
  )

  const setMessagesRef = useRef<(m: ChatUIMessage[]) => void>(() => {})
  const errorRef = useRef('')

  const chat = useChat({
    id: CHAT_ID,
    transport,
    generateId: () => uuidV4(),
    onError: (err) => {
      errorRef.current = err.message
    },
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

  /* ================= 分窗对比模式 ================= */
  const panes = usePaneMode(profiles)

  /* ================= 会话持久化 ================= */
  const sessionsCtl = useChatSessions({
    busy,
    messages,
    setMessages,
    strings: { storeTooLarge: l.storeTooLarge, storeFailed: l.storeFailed, storeRecovered: l.storeRecovered },
  })
  const {
    storeApi,
    sessions,
    sessionId,
    sessionTitle,
    setSessionTitle,
    storeNote,
    showSessions,
    setShowSessions,
    renaming,
    setRenaming,
    titleDraft,
    setTitleDraft,
    confirmDel,
    setConfirmDel,
    storePath,
    persist,
    newSession,
    switchSession,
    removeSession,
    commitRename,
  } = sessionsCtl

  sessionRef.current = { id: sessionId, title: sessionTitle }
  persistRef.current = persist

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

  const stopStream = (): void => {
    stop()
  }

  /* ================= 派生数据 ================= */

  const preflightTotal = useMemo(
    () => estimatePreflight(settings.system, messages, input),
    [settings.system, messages, input],
  )

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const lastMeta = lastAssistant ? messageMeta(lastAssistant).meta : undefined
  const lastCost = lastReplyCost(lastMeta, active?.model ?? '', prices)

  const notice = [storeNote, agentNotice].filter(Boolean).join(' · ')
  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant'
  /** 发送阶段就失败（配置不全 / IPC 断了）时没有助手消息，错误单独显示 */
  const sendError = status === 'error' && !lastIsAssistant ? (error?.message ?? '') : ''

  /* ================= 未配模型：配置引导 ================= */
  if (!cfgReady) {
    return <OnboardPanel desktop={desktop} active={active} onPatchProfile={patchProfile} />
  }

  /* ================= 主布局 ================= */
  const railProps = {
    sessions,
    currentId: sessionId,
    currentTitle: sessionTitle,
    busy,
    storePath,
    confirmDel,
    onConfirmDel: setConfirmDel,
    onNew: () => void newSession(),
    onSwitch: (id: string) => void switchSession(id),
    onStartRename: (title: string) => {
      setTitleDraft(sessionTitle || title)
      setRenaming(true)
    },
    onRemove: (id: string) => void removeSession(id),
  }

  // 高度见 index.css 的 .chat-viewport：宽屏下要抵消 <main> 的 zoom
  // 分窗模式下发送 = fan-out 到所有就绪窗格；输入框保留在底部共享
  const onComposerSend = (): void => {
    if (panes.active) {
      if (panes.send(input) > 0) setInput('')
      return
    }
    void send()
  }
  const onComposerStop = (): void => {
    if (panes.active) panes.stopAll()
    else stopStream()
  }
  const composer = (
    <Composer
      input={input}
      onInput={setInput}
      onSend={onComposerSend}
      onStop={onComposerStop}
      streaming={busy || panes.busy}
      profiles={profiles}
      activeId={active?.id ?? ''}
      onPickProfile={activate}
      onManageModels={() => setShowSettings(true)}
      onAddProfile={addProfile}
      estimate={preflightTotal}
      cost={panes.active ? null : lastCost}
      roundInfo={roundInfo}
      toolCount={panes.active ? 0 : toolNames.length}
      disabled={!desktop || !cfgReady}
    />
  )

  return (
    <div className="flex chat-viewport">
      <SessionRail {...railProps} />
      <div className="flex-1 min-w-0 flex flex-col">
        <ChatHeader
          sessionTitle={sessionTitle}
          activeLabel={active ? `${profileName(active)} · ${active.model}` : ''}
          notice={notice}
          hasStore={!!storeApi}
          renaming={renaming}
          titleDraft={titleDraft}
          onTitleDraft={setTitleDraft}
          onStartRename={() => {
            setTitleDraft(sessionTitle)
            setRenaming(true)
          }}
          onCommitRename={() => void commitRename()}
          onCancelRename={() => setRenaming(false)}
          onToggleSessions={() => setShowSessions((v) => !v)}
          onOpenSettings={() => setShowSettings(true)}
          extra={
            panes.active ? undefined : (
              <PaneEnterButton onClick={() => panes.enter(active?.id ?? null)} label={lp.enter} />
            )
          }
        />

        {notice && (
          <p className="lg:hidden px-3 py-1.5 text-[11px] text-amber border-b border-line-soft">
            {notice}
          </p>
        )}

        {showSessions && (
          <MobileSessionList
            {...railProps}
            onStartRename={(title: string) => {
              setTitleDraft(sessionTitle || title)
              setRenaming(true)
              setShowSessions(false)
            }}
          />
        )}

        {panes.active ? (
          <>
            <div className="flex-1 min-h-0 px-1 pt-1">
              <PaneView
                sess={panes.sess}
                profiles={profiles}
                ctl={panes}
                onManageModels={() => setShowSettings(true)}
                onAddProfile={addProfile}
              />
            </div>
            <div className="px-4 pt-1 pb-4 shrink-0 pb-safe">
              <div className="max-w-[860px] mx-auto">{composer}</div>
            </div>
          </>
        ) : messages.length === 0 ? (
          <ChatEmptyState hero={l.heroTitle}>{composer}</ChatEmptyState>
        ) : (
          <>
            <MessageList
              messages={messages}
              busy={busy}
              prices={prices}
              model={active?.model ?? ''}
              emptyText={`${l.empty}　${l.emptyHint}`}
              sendError={sendError}
              onRetry={retry}
              onTrace={setTraceId}
            />

            <div className="px-4 pt-1 pb-4 shrink-0 pb-safe">
              <div className="max-w-[860px] mx-auto">{composer}</div>
            </div>
          </>
        )}
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

      {traceId && <TraceDrawer requestId={traceId} onClose={() => setTraceId(null)} />}
    </div>
  )
}
