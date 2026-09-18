import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel, Btn, TA, Input, ErrorNote, KV, Stat, CopyBtn, ToolGuide, Collapse } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { chatL } from '../lib/locales/chat'
import {
  costOf,
  estimateMessages,
  estimateTokens,
  formatMoney,
  findPrice,
  uuidV4,
  type ModelPrice,
} from '../lib/toolkit'
import type { ChatEvent, ChatMeta, ChatMessage, ChatToolCall, ChatToolResult, ChatToolServer } from '../lib/chat-types'
import { titleFromText, type ChatSessionMeta } from '../lib/chatstore-types'

/**
 * 流式对话调试（可选工具调用）。
 *
 * 界面本身不算任何指标、不做协议：token 估算与费用来自 `src/lib/toolkit/tokens.ts`，
 * 流式解析在 `electron/main/chat.ts`，工具调用循环在 `electron/main/chat-agent.ts`。
 * 这里只负责把事件按到达顺序铺成可读的对话。
 */

type L = typeof chatL['zh']

type TurnStatus = 'streaming' | 'done' | 'error' | 'stopped'

/** 一轮里内容与工具调用会交错出现，所以按「块」记录，而不是把正文和调用分成两个数组 */
type Block =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool'; call: ChatToolCall; result: ChatToolResult | null }

interface Turn {
  id: string
  role: 'user' | 'assistant'
  blocks: Block[]
  status: TurnStatus
  meta?: ChatMeta
  error?: string
  rounds?: number
}

interface ConfigState {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  temperature: string
  maxTokens: string
  topP: string
  proxy: string
  tlsVerify: boolean
  includeUsage: boolean
  extraHeaders: string
  toolsEnabled: boolean
  maxRounds: string
}

const DEFAULT_CONFIG: ConfigState = {
  baseUrl: '',
  apiKey: '',
  model: '',
  system: '',
  temperature: '',
  maxTokens: '',
  topP: '',
  proxy: '',
  tlsVerify: true,
  includeUsage: true,
  extraHeaders: '',
  toolsEnabled: true,
  maxRounds: '8',
}

/**
 * 价格表只是本机参考值：单价变动频繁，工具不该硬编码「权威价格」。
 * 默认给几条常用项，用户可改可加，改完立即生效并记住。
 * 单位统一为「元 / 百万 token」，以服务商官网为准。
 */
const DEFAULT_PRICES: ModelPrice[] = [
  { model: 'deepseek-chat', inPerM: 2, outPerM: 8, cacheInPerM: 0.5 },
  { model: 'deepseek-reasoner', inPerM: 4, outPerM: 16, cacheInPerM: 1 },
]

const PRESET_BASE_URLS: [string, string][] = [
  ['DeepSeek', 'https://api.deepseek.com/v1'],
  ['OpenAI', 'https://api.openai.com/v1'],
  ['Qwen / DashScope', 'https://dashscope.aliyuncs.com/compatible-mode/v1'],
  ['Zhipu GLM', 'https://open.bigmodel.cn/api/paas/v4'],
  ['Moonshot', 'https://api.moonshot.cn/v1'],
  ['Ollama', 'http://127.0.0.1:11434/v1'],
  ['LM Studio', 'http://127.0.0.1:1234/v1'],
]

/**
 * 自定义工具源。对话里除了本机内置的 55 项能力，还能挂任意 MCP 服务端
 * （stdio 或 Streamable HTTP），agent 循环会把它们与本机工具合并后交给模型。
 */
interface CustomServer {
  id: string
  label: string
  kind: 'stdio' | 'http'
  command: string
  args: string
  env: string
  url: string
  headers: string
}

const SRV_KEY = 'devtoolbox-chat-servers'

function loadServers(): CustomServer[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(SRV_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        id: typeof x.id === 'string' ? x.id : `s${Math.random().toString(36).slice(2, 10)}`,
        label: typeof x.label === 'string' ? x.label : '',
        kind: x.kind === 'http' ? 'http' as const : 'stdio' as const,
        command: typeof x.command === 'string' ? x.command : '',
        args: typeof x.args === 'string' ? x.args : '',
        env: typeof x.env === 'string' ? x.env : '',
        url: typeof x.url === 'string' ? x.url : '',
        headers: typeof x.headers === 'string' ? x.headers : '',
      }))
  } catch {
    return []
  }
}

/** `KEY=VALUE` 每行一条；解析不动的地方直接跳过，别让一个错行毁掉整个环境表 */
function parseEnvText(t: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of t.split('\n')) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim()
    if (k) out[k] = v
  }
  return out
}

/** 模型档案：切换器的数据源。换模型 = 换 baseUrl/key/model 三件套，其余参数不动。 */
interface ModelProfile {
  id: string
  baseUrl: string
  apiKey: string
  model: string
}

const PROFILES_KEY = 'devtoolbox-chat-profiles'

function loadProfiles(): ModelProfile[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        id: typeof x.id === 'string' ? x.id : `m${Math.random().toString(36).slice(2, 10)}`,
        baseUrl: typeof x.baseUrl === 'string' ? x.baseUrl : '',
        apiKey: typeof x.apiKey === 'string' ? x.apiKey : '',
        model: typeof x.model === 'string' ? x.model : '',
      }))
      .filter((p) => p.baseUrl && p.model)
  } catch {
    return []
  }
}

const CFG_KEY = 'devtoolbox-chat-config'
const PRICE_KEY = 'devtoolbox-chat-prices'

function loadConfig(): ConfigState {
  if (typeof localStorage === 'undefined') return DEFAULT_CONFIG
  try {
    const raw = localStorage.getItem(CFG_KEY)
    if (!raw) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<ConfigState>) }
  } catch {
    return DEFAULT_CONFIG
  }
}

function loadPrices(): ModelPrice[] {
  if (typeof localStorage === 'undefined') return DEFAULT_PRICES
  try {
    const raw = localStorage.getItem(PRICE_KEY)
    if (!raw) return DEFAULT_PRICES
    const parsed = JSON.parse(raw) as ModelPrice[]
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PRICES
  } catch {
    return DEFAULT_PRICES
  }
}

/** 数字输入留空表示「用服务端默认」，所以空串要保持空串 */
function numOrUndefined(v: string): number | undefined {
  const t = v.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

function parseHeaderLines(raw: string): [string, string][] {
  const out: [string, string][] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const i = t.indexOf(':')
    if (i > 0) out.push([t.slice(0, i).trim(), t.slice(i + 1).trim()])
  }
  return out
}

/** 往块列表里追加内容：与上一块同类就并进去，否则新起一块 */
function appendText(blocks: Block[], kind: 'text' | 'reasoning', text: string): Block[] {
  const last = blocks[blocks.length - 1]
  if (last && last.kind === kind) {
    return [...blocks.slice(0, -1), { kind, text: last.text + text }]
  }
  return [...blocks, { kind, text }]
}

export function ChatTool() {
  const l = useLocalized(chatL)
  const [cfg, setCfg] = useState<ConfigState>(loadConfig)
  const [prices, setPrices] = useState<ModelPrice[]>(loadPrices)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [desktop, setDesktop] = useState(true)
  const [toolNames, setToolNames] = useState<string[]>([])
  const [roundInfo, setRoundInfo] = useState<{ round: number; max: number } | null>(null)
  const [toolServer, setToolServer] = useState<{ command: string; args: string[]; env: Record<string, string> } | null>(null)
  const [toolServerErr, setToolServerErr] = useState('')
  // 会话（持久化）
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])
  const [sessionId, setSessionId] = useState('')
  const [sessionTitle, setSessionTitle] = useState('')
  const [storeReady, setStoreReady] = useState(false)
  const [storeNote, setStoreNote] = useState('')
  const [showSessions, setShowSessions] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [storePath, setStorePath] = useState('')
  const [servers, setServers] = useState<CustomServer[]>(loadServers)
  const [agentNotice, setAgentNotice] = useState('')
  const [profiles, setProfiles] = useState<ModelProfile[]>(loadProfiles)
  const [showSettings, setShowSettings] = useState(false)

  // 增量片段先攒在 ref 里，按帧批量刷进 state —— 高频流下避免每个 token 都触发一次重渲染
  const pendingRef = useRef<{ id: string; text: string; reasoning: string }>({ id: '', text: '', reasoning: '' })
  const rafRef = useRef<number | null>(null)
  const activeIdRef = useRef('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const cfgRef = useRef(cfg)
  const turnsRef = useRef(turns)

  cfgRef.current = cfg
  turnsRef.current = turns

  useEffect(() => { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) }, [cfg])
  useEffect(() => { try { localStorage.setItem(SRV_KEY, JSON.stringify(servers)) } catch { /* ignore */ } }, [servers])
  useEffect(() => { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)) } catch { /* ignore */ } }, [profiles])
  useEffect(() => { localStorage.setItem(PRICE_KEY, JSON.stringify(prices)) }, [prices])

  useEffect(() => {
    setDesktop(typeof window !== 'undefined' && !!window.electronAPI)
  }, [])

  // 工具调用的服务端就是本应用自己的 MCP 服务端，启动配置由主进程算出
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcp : undefined
    if (!api) return
    api.info().then((v) => {
      if (v.launch.serverPathExists) {
        setToolServer({ command: v.launch.command, args: v.launch.args, env: v.launch.env })
      } else {
        setToolServerErr(l.toolsNotBuilt)
      }
    }).catch(() => setToolServerErr(l.toolsNotBuilt))
  }, [l])

  const patch = (p: Partial<ConfigState>): void => setCfg((c) => ({ ...c, ...p }))

  /* ================= 会话持久化 ================= */

  const storeApi = typeof window !== 'undefined' ? window.electronAPI?.chatStore : undefined

  /** 满足存储层的 id 白名单（字母数字，≥6 位） */
  const nextSessionId = (): string => `s${uuidV4().replace(/-/g, '')}`

  const refreshSessions = useCallback(async (): Promise<void> => {
    if (!storeApi) return
    try {
      const res = await storeApi.list()
      if (res.ok) setSessions(res.sessions)
    } catch { /* 列表刷新失败不打断对话 */ }
  }, [storeApi])

  /**
   * 写盘。**不含正在流式输出的那一轮** —— 半截回答落盘后，
   * 重启看到的半句话比看不到更让人困惑。
   */
  const persist = useCallback(async (id: string, title: string, list: Turn[]): Promise<void> => {
    if (!storeApi || !id) return
    const settled = list.filter((t) => t.status !== 'streaming')
    try {
      const res = await storeApi.save({ id, title, turns: settled })
      if (!res.ok) setStoreNote(res.tooLarge ? l.storeTooLarge : `${l.storeFailed}: ${res.error ?? ''}`)
      else void refreshSessions()
    } catch (e) {
      setStoreNote(`${l.storeFailed}: ${(e as Error).message}`)
    }
  }, [storeApi, l, refreshSessions])

  // 启动时把上次的会话读回来 —— 这是「像助手」与「刷新即失忆」的分界线
  useEffect(() => {
    if (!storeApi) {
      setStoreReady(true)
      return
    }
    let alive = true
    void (async () => {
      try {
        const res = await storeApi.list()
        if (!alive) return
        if (!res.ok) {
          setStoreNote(l.storeFailed)
          return
        }
        setSessions(res.sessions)
        if (res.recovered) setStoreNote(l.storeRecovered)
        const id = res.activeId && res.sessions.some((x) => x.id === res.activeId) ? res.activeId : ''
        if (!id) return
        const loaded = await storeApi.load(id)
        if (!alive || !loaded.ok) return
        setSessionId(id)
        setTurns(loaded.turns as Turn[])
        setSessionTitle(res.sessions.find((x) => x.id === id)?.title ?? '')
      } catch (e) {
        if (alive) setStoreNote(`${l.storeFailed}: ${(e as Error).message}`)
      } finally {
        if (alive) setStoreReady(true)
      }
    })()
    return () => { alive = false }
  }, [storeApi, l])

  // 数据文件在哪：数据都在本机，用户该能自己找到它
  useEffect(() => {
    if (!storeApi) return
    let alive = true
    storeApi.file().then((p) => { if (alive) setStorePath(p) }).catch(() => { /* 拿不到就不显示 */ })
    return () => { alive = false }
  }, [storeApi])

  // 对话停下来之后再落盘（流式期间 turns 每帧都在变，写盘没有意义）
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!storeReady || !sessionId || !turns.length) return
    if (turns.some((t) => t.status === 'streaming')) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void persist(sessionId, sessionTitle, turns) }, 700)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [turns, sessionId, sessionTitle, storeReady, persist])

  /** 切走之前先把当前会话写下来，否则会丢最后几条 */
  const flushCurrent = useCallback(async (): Promise<void> => {
    if (sessionId && turns.length) await persist(sessionId, sessionTitle, turns)
  }, [sessionId, sessionTitle, turns, persist])

  const newSession = async (): Promise<void> => {
    await flushCurrent()
    setSessionId(nextSessionId())
    setSessionTitle('')
    setTurns([])
    setShowSessions(false)
    setRenaming(false)
    setConfirmDel(false)
    setStoreNote('')
    // 新会话还没落盘，先不指认它，免得重启后打开一个空会话
    void storeApi?.setActive(null)
  }

  const switchSession = async (id: string): Promise<void> => {
    if (id === sessionId) {
      setShowSessions(false)
      return
    }
    if (!storeApi) return
    await flushCurrent()
    const loaded = await storeApi.load(id)
    if (!loaded.ok) {
      setStoreNote(`${l.storeFailed}: ${loaded.error ?? ''}`)
      return
    }
    setSessionId(id)
    setTurns(loaded.turns as Turn[])
    setSessionTitle(sessions.find((s) => s.id === id)?.title ?? '')
    setShowSessions(false)
    setRenaming(false)
    setConfirmDel(false)
    void storeApi.setActive(id)
  }

  const removeSession = async (id: string): Promise<void> => {
    if (!storeApi || !id) return
    await storeApi.remove(id)
    if (id === sessionId) {
      setSessionId(nextSessionId())
      setTurns([])
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
    if (sessionId && turns.length) await persist(sessionId, t, turns)
  }

  const flush = useCallback((): void => {
    rafRef.current = null
    const p = pendingRef.current
    if (!p.id || (!p.text && !p.reasoning)) return
    const { id, text, reasoning } = p
    p.text = ''
    p.reasoning = ''
    setTurns((prev) => prev.map((t) => {
      if (t.id !== id) return t
      let blocks = t.blocks
      if (reasoning) blocks = appendText(blocks, 'reasoning', reasoning)
      if (text) blocks = appendText(blocks, 'text', text)
      return { ...t, blocks }
    }))
  }, [])

  const schedule = (): void => {
    if (rafRef.current != null) return
    if (typeof requestAnimationFrame === 'undefined') {
      flush()
      return
    }
    rafRef.current = requestAnimationFrame(flush)
  }

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.chat : undefined
    if (!api) return
    return api.onEvent((evt: ChatEvent) => {
      if (evt.requestId !== activeIdRef.current) return
      switch (evt.type) {
        case 'delta':
          pendingRef.current.id = evt.requestId
          if (evt.kind === 'content') pendingRef.current.text += evt.text
          else pendingRef.current.reasoning += evt.text
          schedule()
          return
        case 'toolsReady':
          setToolNames(evt.tools.map((t) => t.name))
          return
        case 'round':
          setRoundInfo({ round: evt.round, max: evt.maxRounds })
          return
        case 'toolCall':
          flush()
          setTurns((prev) => prev.map((t) => (t.id === evt.requestId ? { ...t, blocks: [...t.blocks, { kind: 'tool', call: evt.call, result: null }] } : t)))
          return
        case 'notice':
          setAgentNotice(evt.text)
          return
        case 'toolResult':
          setTurns((prev) => prev.map((t) => {
            if (t.id !== evt.requestId) return t
            return {
              ...t,
              blocks: t.blocks.map((b) => (b.kind === 'tool' && b.call.id === evt.result.id ? { ...b, result: evt.result } : b)),
            }
          }))
          return
        default:
          break
      }

      // 收尾前先把攒着的片段落盘，否则最后几个字会丢
      flush()
      setStreaming(false)
      setRoundInfo(null)
      if (evt.type === 'done') {
        setTurns((prev) => prev.map((t) => (t.id === evt.requestId ? { ...t, status: 'done', meta: evt.meta, rounds: evt.rounds } : t)))
      } else if (evt.type === 'error') {
        const stopped = evt.code === 'ABORTED'
        setTurns((prev) => prev.map((t) => (t.id === evt.requestId ? { ...t, status: stopped ? 'stopped' : 'error', error: evt.message } : t)))
      }
    })
  }, [flush])

  // 贴底跟随：只有当前已经在底部附近才自动滚，避免打断向上翻阅
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [turns])

  const history = useMemo<ChatMessage[]>(() => {
    const out: ChatMessage[] = []
    for (const t of turns) {
      if (t.role === 'user') {
        out.push({ role: 'user', content: t.blocks.filter((b) => b.kind === 'text').map((b) => (b as { text: string }).text).join('') })
        continue
      }
      const text = t.blocks.filter((b) => b.kind === 'text').map((b) => (b as { text: string }).text).join('')
      if (text) out.push({ role: 'assistant', content: text })
    }
    return out
  }, [turns])

  const preflight = useMemo(() => {
    const msgs: { role: string; content: string }[] = []
    if (cfg.system.trim()) msgs.push({ role: 'system', content: cfg.system })
    msgs.push(...history)
    if (input.trim()) msgs.push({ role: 'user', content: input })
    return estimateMessages(msgs)
  }, [cfg.system, history, input])

  const send = async (): Promise<void> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.chat : undefined
    const text = input.trim()
    if (!api || !text || streaming) return
    if (!cfg.baseUrl.trim() || !cfg.model.trim()) return
    if (cfg.toolsEnabled && !toolServer && !customSpecs.length) return

    const requestId = uuidV4()
    activeIdRef.current = requestId
    setToolNames([])
    setRoundInfo(null)
    setAgentNotice('')
    // 会话：还没 id 就现开一个；标题取第一条用户消息
    const sid = sessionId || nextSessionId()
    const title = sessionTitle || titleFromText(text)
    if (!sessionId) setSessionId(sid)
    if (!sessionTitle) setSessionTitle(title)

    const userTurn: Turn = { id: `u-${requestId}`, role: 'user', blocks: [{ kind: 'text', text }], status: 'done' }
    const replyTurn: Turn = { id: requestId, role: 'assistant', blocks: [], status: 'streaming' }
    setTurns((prev) => [...prev, userTurn, replyTurn])
    setInput('')
    setStreaming(true)
    // 用户消息先落盘：万一聊天中途退出，至少问题还在
    void persist(sid, title, [...turns, userTurn])

    const messages: ChatMessage[] = []
    if (cfg.system.trim()) messages.push({ role: 'system', content: cfg.system })
    messages.push(...history)
    messages.push({ role: 'user', content: text })

    let res: { ok: boolean; error?: string }
    try {
      res = await api.send({
        requestId,
        baseUrl: cfg.baseUrl.trim(),
        apiKey: cfg.apiKey.trim(),
        model: cfg.model.trim(),
        messages,
        temperature: numOrUndefined(cfg.temperature),
        maxTokens: numOrUndefined(cfg.maxTokens),
        topP: numOrUndefined(cfg.topP),
        extraHeaders: parseHeaderLines(cfg.extraHeaders),
        proxy: cfg.proxy.trim() || null,
        rejectUnauthorized: cfg.tlsVerify,
        includeUsage: cfg.includeUsage,
        tools: cfg.toolsEnabled && (toolServer || customSpecs.length)
          ? {
              servers: [
                ...(toolServer ? [{ label: l.toolSelfLabel, command: toolServer.command, args: toolServer.args, env: toolServer.env }] : []),
                ...customSpecs,
              ],
              maxRounds: Math.max(1, Math.min(parseInt(cfg.maxRounds) || 8, 20)),
            }
          : null,
      })
    } catch (e) {
      // IPC 本身失败（主进程没了、通道没注册）也必须把状态收回来，
      // 否则界面会永远停在「接收中 / 停止」，用户以为还在生成
      res = { ok: false, error: (e as Error).message }
    }
    if (!res.ok) {
      setStreaming(false)
      setTurns((prev) => prev.map((t) => (t.id === requestId ? { ...t, status: 'error', error: res.error ?? '' } : t)))
    }
  }

  const stop = async (): Promise<void> => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.chat : undefined
    try {
      await api?.abort()
    } catch {
      // 取消失败不必打扰用户：主进程的 socket 超时会兜底收场
      setStreaming(false)
    }
  }

  const allText = useMemo(
    () => turns
      .map((t) => {
        const body = t.blocks.map((b) => (b.kind === 'tool' ? `→ ${b.call.name}(${b.call.args})${b.result ? ` = ${b.result.text || b.result.error || ''}` : ''}` : (b as { text: string }).text)).join('')
        return `[${t.role === 'user' ? l.roleUser : l.roleAssistant}] ${body}`
      })
      .join('\n\n'),
    [turns, l],
  )

  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')
  const cfgReady = Boolean(cfg.baseUrl.trim() && cfg.model.trim() && cfg.apiKey.trim())
  // 配置有效时自动记成模型档案（去重），切换器才有东西可列
  useEffect(() => {
    if (!cfgReady) return
    setProfiles((prev) =>
      prev.some((p) => p.baseUrl === cfg.baseUrl && p.model === cfg.model)
        ? prev
        : [...prev, { id: `m${Math.random().toString(36).slice(2, 10)}`, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model }],
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgReady, cfg.baseUrl, cfg.model, cfg.apiKey])

  /** 自定义工具源 → agent 能吃的形态；填了一半的条目直接跳过，别把残稿发出去 */
  const customSpecs = useMemo(
    () =>
      servers
        .map((s): ChatToolServer | null => {
          const label = s.label.trim() || undefined
          if (s.kind === 'http') {
            return s.url.trim() ? { label, url: s.url.trim(), headers: parseHeaderLines(s.headers) } : null
          }
          return s.command.trim()
            ? { label, command: s.command.trim(), args: s.args.split('\n').map((x) => x.trim()).filter(Boolean), env: parseEnvText(s.env) }
            : null
        })
        .filter((x): x is ChatToolServer => !!x),
    [servers],
  )

  // 还没配模型时：居中一张配置卡，填完自动进入对话
  if (!cfgReady) {
    return (
      <div className="max-w-[680px] mx-auto fade-in py-8">
        <Panel title={l.onboardTitle}>
          <p className="text-[12.5px] text-muted leading-relaxed mb-4">{l.onboardIntro}</p>
          {!desktop && <ErrorNote msg={l.noDesktop} />}
          <div className="space-y-3">
            <Input value={cfg.baseUrl} onChange={(v) => patch({ baseUrl: v })} label={l.baseUrl} placeholder={l.baseUrlPh} />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_BASE_URLS.map(([name, url]) => (
                <button key={name} onClick={() => patch({ baseUrl: url })}
                  className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
                  {name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 min-[640px]:grid-cols-2 gap-3">
              <Input value={cfg.model} onChange={(v) => patch({ model: v })} label={l.model} placeholder={l.modelPh} />
              <Input value={cfg.apiKey} onChange={(v) => patch({ apiKey: v })} label={l.apiKey} placeholder={l.apiKeyPh} type="password" />
            </div>
          </div>
          <p className="text-[11px] text-muted mt-4 leading-relaxed border-t border-line-soft pt-3">
            {l.apiKeyNote} {l.onboardTools}
          </p>
        </Panel>
      </div>
    )
  }

  const pickProfile = (p: ModelProfile): void => patch({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model })
  const renameInRail = (id: string): void => {
    const hit = sessions.find((x) => x.id === id)
    if (id === sessionId) {
      setTitleDraft(sessionTitle || hit?.title || '')
      setRenaming(true)
    }
  }

  const costOfLast = (() => {
    const t = lastAssistant
    if (!t?.meta) return null
    const price = findPrice(t.meta.model ?? cfg.model, prices)
    if (!price) return null
    const tokens = t.meta.usage?.completionTokens ?? Math.ceil(t.meta.chars / 3.2)
    return costOf(price, { promptTokens: t.meta.usage?.promptTokens ?? 0, completionTokens: tokens, cachedTokens: t.meta.usage?.cachedTokens ?? 0 }).total
  })()

  /* ================= 会话竖栏（桌面） ================= */
  const rail = (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-line bg-panel/60 lg:h-screen">
      <button
        onClick={() => void newSession()}
        disabled={streaming}
        className="m-2 border border-line-soft px-3 py-2 text-[12px] text-bright hover:border-phosphor/50 hover:text-phosphor transition-colors"
      >
        + {l.newSession}
      </button>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {sessions.length === 0 && <div className="px-2 py-4 text-[11px] text-muted leading-relaxed">{l.emptySessions}</div>}
        {sessions.map((sess) => (
          <div key={sess.id} className={`group flex items-center gap-1 rounded-sm mb-0.5 ${sess.id === sessionId ? 'bg-phosphor-faint' : 'hover:bg-phosphor-faint/50'}`}>
            <button
              onClick={() => void switchSession(sess.id)}
              className={`flex-1 min-w-0 text-left px-2 py-1.5 text-[12px] truncate ${sess.id === sessionId ? 'text-phosphor' : 'text-dim hover:text-bright'}`}
              title={sess.title || l.untitledSession}
            >
              {sess.title || l.untitledSession}
              <span className="ml-1.5 text-[9.5px] text-muted/50">{sess.turnCount}</span>
            </button>
            <button onClick={() => renameInRail(sess.id)} title={l.rename}
              className="hidden group-hover:block text-muted hover:text-phosphor text-[11px] px-0.5">✎</button>
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

  /* ================= 设置抽屉 ================= */
  const settings = showSettings && (
    <>
      <div className="fixed inset-0 z-40 bg-terminal/60" onClick={() => setShowSettings(false)} />
      <aside className="fixed right-0 top-0 z-50 h-full w-full sm:w-[460px] border-l border-line bg-panel overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line px-4 py-3 bg-panel">
          <span className="text-[13px] text-phosphor font-semibold tracking-wider">{l.settingsTitle}</span>
          <button onClick={() => setShowSettings(false)} aria-label={l.settingsTitle} className="text-muted hover:text-bright text-xl leading-none">×</button>
        </div>
        <div className="p-4 space-y-5">
          <section className="space-y-3">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted/70">{l.connTitle}</h3>
            <Input value={cfg.baseUrl} onChange={(v) => patch({ baseUrl: v })} label={l.baseUrl} placeholder={l.baseUrlPh} />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_BASE_URLS.map(([name, url]) => (
                <button key={name} onClick={() => patch({ baseUrl: url })}
                  className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
                  {name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input value={cfg.model} onChange={(v) => patch({ model: v })} label={l.model} placeholder={l.modelPh} />
              <Input value={cfg.apiKey} onChange={(v) => patch({ apiKey: v })} label={l.apiKey} placeholder={l.apiKeyPh} type="password" />
            </div>
            <div>
              <TA value={cfg.system} onChange={(v) => patch({ system: v })} label={l.system} placeholder={l.systemPh} rows={3} />
            </div>
            <p className="text-[10.5px] text-muted/70 leading-relaxed">{l.apiKeyNote}</p>
          </section>

          <section className="space-y-3 border-t border-line-soft pt-4">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted/70">{l.toolsEnable}</h3>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={cfg.toolsEnabled} onChange={(e) => patch({ toolsEnabled: e.target.checked })} className="accent-phosphor" />
              {l.toolsEnable}
            </label>
            {cfg.toolsEnabled && toolServerErr && <p className="text-[11px] text-amber">{toolServerErr}</p>}
            {cfg.toolsEnabled && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted shrink-0">{l.maxRounds}</span>
                <Input value={cfg.maxRounds} onChange={(v) => patch({ maxRounds: v })} />
                <span className="text-[10.5px] text-muted/70 shrink-0">{l.roundsRange}</span>
              </div>
            )}
          </section>

          <section className="border-t border-line-soft pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted/70">{l.customServersTitle}</h3>
              <Btn variant="ghost" onClick={() => setServers((p) => [...p, { id: `s${Math.random().toString(36).slice(2, 10)}`, label: '', kind: 'stdio' as const, command: '', args: '', env: '', url: '', headers: '' }])}>
                {l.addServer}
              </Btn>
            </div>
            <p className="text-[11px] text-muted mt-1 leading-relaxed">{l.customServersHint}</p>
            <div className="space-y-2 mt-2">
              {servers.map((sv, i) => (
                <div key={sv.id} className="border border-line-soft bg-panel-2 p-2 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <input value={sv.label} onChange={(e) => setServers((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      placeholder={l.serverLabelPh}
                      className="bg-transparent border border-line-soft px-2 py-1 text-[12px] text-bright flex-1 min-w-0 focus:outline-none focus:border-phosphor/40" />
                    <div className="flex shrink-0">
                      {(['stdio', 'http'] as const).map((k2) => (
                        <button key={k2} onClick={() => setServers((p) => p.map((x, j) => (j === i ? { ...x, kind: k2 } : x)))}
                          className={`px-2 py-1 text-[10.5px] border transition-colors ${sv.kind === k2 ? 'border-phosphor/50 text-phosphor' : 'border-line-soft text-muted hover:text-bright'}`}>
                          {k2 === 'stdio' ? l.serverKindStdio : l.serverKindHttp}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setServers((p) => p.filter((_, j) => j !== i))} title={l.removeServer}
                      className="text-muted hover:text-danger text-[13px] leading-none px-1 shrink-0" aria-label={l.removeServer}>×</button>
                  </div>
                  {sv.kind === 'stdio' ? (
                    <div className="space-y-2">
                      <Input value={sv.command} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, command: v } : x)))} placeholder={l.serverCmdPh} />
                      <TA value={sv.args} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, args: v } : x)))} rows={2} placeholder={l.serverArgsPh} />
                      <TA value={sv.env} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, env: v } : x)))} rows={2} placeholder={l.serverEnvPh} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Input value={sv.url} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, url: v } : x)))} placeholder={l.serverUrlPh} />
                      <TA value={sv.headers} onChange={(v) => setServers((p) => p.map((x, j) => (j === i ? { ...x, headers: v } : x)))} rows={2} placeholder={l.serverHeadersPh} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="border-t border-line-soft pt-4 space-y-3">
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-muted/70">{l.advanced}</h3>
            <div className="grid grid-cols-3 gap-2">
              <Input value={cfg.temperature} onChange={(v) => patch({ temperature: v })} label={l.temperature} placeholder="0.7" />
              <Input value={cfg.maxTokens} onChange={(v) => patch({ maxTokens: v })} label={l.maxTokens} placeholder="—" />
              <Input value={cfg.topP} onChange={(v) => patch({ topP: v })} label={l.topP} placeholder="—" />
            </div>
            <Input value={cfg.proxy} onChange={(v) => patch({ proxy: v })} label={l.proxy} placeholder={l.proxyPh} />
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={cfg.tlsVerify} onChange={(e) => patch({ tlsVerify: e.target.checked })} className="accent-phosphor" />
              {l.tlsVerify}
              <span className="text-[11px] text-muted/70">· {l.tlsVerifyNote}</span>
            </label>
            <label className="flex items-center gap-2 text-[12px] cursor-pointer">
              <input type="checkbox" checked={cfg.includeUsage} onChange={(e) => patch({ includeUsage: e.target.checked })} className="accent-phosphor" />
              {l.includeUsage}
              <span className="text-[11px] text-muted/70">· {l.includeUsageNote}</span>
            </label>
            <div>
              <TA value={cfg.extraHeaders} onChange={(v) => patch({ extraHeaders: v })} label={l.extraHeaders} placeholder={l.extraHeadersPh} rows={2} />
              <p className="text-[11px] text-muted mt-1">{l.extraHeadersNote}</p>
            </div>
          </section>

          <section className="border-t border-line-soft pt-4">
            <PriceTable prices={prices} setPrices={setPrices} l={l} />
          </section>

          <section className="border-t border-line-soft pt-4 pb-8">
            <ul className="text-[11.5px] text-muted space-y-1 list-none">
              {l.hintItems.map((x) => <li key={x}>· {x}</li>)}
            </ul>
          </section>
        </div>
      </aside>
    </>
  )

  /* ================= 主布局：会话栏 + 顶栏 + 消息流 + 输入 ================= */
  return (
    <div className="flex h-[calc(100dvh-3rem)] lg:h-screen">
      {rail}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 顶栏：模型切换器 + 会话（移动端）+ 设置 */}
        <header className="flex items-center gap-2 border-b border-line px-3 py-2 shrink-0 pt-safe">
          <ModelSwitcher profiles={profiles} cfg={cfg} onPick={pickProfile} onOpenSettings={() => setShowSettings(true)} />
          <span className="flex-1" />
          {(storeNote || agentNotice) && (
            <span className="hidden md:inline text-[10.5px] text-amber truncate max-w-[40%]" title={[storeNote, agentNotice].filter(Boolean).join(' · ')}>
              {[storeNote, agentNotice].filter(Boolean).join(' · ')}
            </span>
          )}
          <button
            onClick={() => setShowSessions((v) => !v)}
            disabled={!storeApi}
            className="lg:hidden border border-line-soft px-2 py-1 text-[11px] text-muted hover:text-phosphor"
          >{l.sessionsTitle}</button>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="border border-line-soft px-2.5 py-1 text-[12px] text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors"
            title={l.settingsTitle}
          >⚙</button>
        </header>

        {(storeNote || agentNotice) && (
          <p className="lg:hidden px-3 py-1.5 text-[11px] text-amber border-b border-line-soft">{[storeNote, agentNotice].filter(Boolean).join(' · ')}</p>
        )}

        {/* 移动端会话列表 */}
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

        {/* 消息流 */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          <div className="max-w-[860px] mx-auto space-y-4">
            {turns.length === 0 && (
              <div className="py-16 text-center">
                <div className="text-phosphor/40 text-2xl mb-2">✦</div>
                <p className="text-[12px] text-muted leading-relaxed">{l.empty}　{l.emptyHint}</p>
              </div>
            )}
            {turns.map((t) => (
              <TurnView key={t.id} turn={t} l={l} price={findPrice(t.meta?.model ?? cfg.model, prices)} />
            ))}
          </div>
        </div>

        {/* 输入区 */}
        <div className="border-t border-line px-4 py-3 shrink-0 pb-safe">
          <div className="max-w-[860px] mx-auto space-y-2">
            <TA value={input} onChange={setInput} rows={3} placeholder={l.inputPh} />
            <div className="flex items-center gap-3 flex-wrap">
              <Btn variant="primary" onClick={send} disabled={streaming || !input.trim() || !desktop}>{l.send}</Btn>
              {streaming && <Btn onClick={stop}>{l.stop}</Btn>}
              {streaming && roundInfo && roundInfo.round > 1 && (
                <span className="text-[11px] text-amber">{l.roundLabel.replace('{a}', String(roundInfo.round)).replace('{b}', String(roundInfo.max))}</span>
              )}
              {toolNames.length > 0 && <span className="text-[11px] text-muted">{l.toolsGranted.replace('{n}', String(toolNames.length))}</span>}
              <span className="text-[11px] text-muted">{l.preflight.replace('{n}', preflight.total.toLocaleString())}</span>
              {costOfLast && <span className="text-[11px] text-muted/70">{formatMoney(costOfLast)}</span>}
            </div>
          </div>
        </div>
      </div>

      {settings}
    </div>
  )
}

/* ================= 模型切换器 ================= */

function ModelSwitcher({ profiles, cfg, onPick, onOpenSettings }: {
  profiles: ModelProfile[]
  cfg: ConfigState
  onPick: (p: ModelProfile) => void
  onOpenSettings: () => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const l = useLocalized(chatL)
  const current = profiles.find((p) => p.baseUrl === cfg.baseUrl && p.model === cfg.model)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2.5 py-1.5 border border-line-soft text-[12px] text-bright hover:border-phosphor/40 max-w-[300px] sm:max-w-[380px] transition-colors"
      >
        <span className="text-phosphor shrink-0">◆</span>
        <span className="truncate">{current?.model || cfg.model.trim() || '—'}</span>
        {cfg.baseUrl.trim() && <span className="text-muted/60 text-[10.5px] truncate hidden md:inline">@ {shortHost(cfg.baseUrl)}</span>}
        <span className="text-muted/60 text-[9px] shrink-0">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 w-[320px] border border-line bg-panel shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            <div className="px-3 py-1.5 text-[9.5px] uppercase tracking-[0.2em] text-muted/60 border-b border-line-soft">{l.profilesTitle}</div>
            {profiles.length === 0 && <div className="px-3 py-3 text-[11.5px] text-muted">{l.emptyProfiles}</div>}
            {profiles.map((p) => {
              const active = p.baseUrl === cfg.baseUrl && p.model === cfg.model
              return (
                <button key={p.id} onClick={() => { onPick(p); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 border-b border-line-soft last:border-0 text-[12px] transition-colors ${active ? 'bg-phosphor-faint text-phosphor' : 'text-bright hover:bg-phosphor-faint'}`}>
                  <div className="truncate">{p.model}</div>
                  <div className="text-[10px] text-muted truncate">{shortHost(p.baseUrl)}</div>
                </button>
              )
            })}
            <button onClick={() => { onOpenSettings(); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-[11.5px] text-phosphor hover:bg-phosphor-faint">
              {l.manageModels}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ================= 单条消息 ================= */

function TurnView({ turn, l, price }: { turn: Turn; l: L; price: ModelPrice | null }): React.ReactElement {
  const [showReasoning, setShowReasoning] = useState(false)
  const isUser = turn.role === 'user'
  const badge = turn.status === 'streaming' ? l.streaming : turn.status === 'stopped' ? l.stopped : turn.status === 'error' ? l.failed : l.done
  const badgeCls = turn.status === 'error' ? 'text-danger border-danger/40' : turn.status === 'streaming' ? 'text-amber border-amber/40' : 'text-muted border-line-soft'
  const textOnly = turn.blocks.filter((b) => b.kind === 'text').map((b) => (b as { text: string }).text).join('')
  const reasoning = turn.blocks.filter((b) => b.kind === 'reasoning').map((b) => (b as { text: string }).text).join('')
  const toolCount = turn.blocks.filter((b) => b.kind === 'tool').length

  return (
    <div className={`border-l-2 pl-3 ${isUser ? 'border-phosphor/50' : 'border-line-soft'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] uppercase tracking-wider ${isUser ? 'text-phosphor' : 'text-muted'}`}>{isUser ? l.roleUser : l.roleAssistant}</span>
        {!isUser && <span className={`text-[10px] px-1.5 border ${badgeCls}`}>{badge}</span>}
        {!isUser && turn.rounds && turn.rounds > 1 && <span className="text-[10px] text-muted">{l.roundsLabel.replace('{n}', String(turn.rounds))}</span>}
        {!isUser && textOnly && <CopyBtn text={textOnly} />}
        {reasoning && (
          <button onClick={() => setShowReasoning((v) => !v)} className="text-[11px] text-muted hover:text-phosphor transition-colors">
            {showReasoning ? l.hideReasoning : l.showReasoning}（{reasoning.length}）
          </button>
        )}
      </div>

      {reasoning && showReasoning && (
        <pre className="codeblock text-[11.5px] text-muted/90 whitespace-pre-wrap break-all mt-1.5">{reasoning}</pre>
      )}

      {/* 按到达顺序渲染：正文与工具调用交错出现，顺序本身就是信息 */}
      {turn.blocks.map((b, i) => {
        if (b.kind === 'reasoning') return null
        if (b.kind === 'text') {
          return <pre key={i} className={`text-[12.5px] whitespace-pre-wrap break-all mt-1.5 ${isUser ? 'text-bright' : 'text-phosphor'}`}>{b.text}</pre>
        }
        return <ToolBlock key={i} call={b.call} result={b.result} l={l} />
      })}

      {turn.status === 'streaming' && !turn.blocks.length && (
        <div className="text-[12px] text-muted mt-1.5">{l.streaming}…</div>
      )}
      {turn.status === 'done' && !textOnly && toolCount > 0 && (
        <div className="text-[11.5px] text-muted mt-1.5">{l.onlyToolNoAnswer}</div>
      )}
      {turn.error && <div className="mt-1.5"><ErrorNote msg={turn.error} /></div>}
      {!isUser && turn.meta && <InlineMetrics turn={turn} l={l} price={price} />}
    </div>
  )
}

/** 消息尾部的一行指标摘要（Kimi 式）：点开才是完整指标面板，不再常驻右栏 */
function InlineMetrics({ turn, l, price }: { turn: Turn; l: L; price: ModelPrice | null }): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const meta = turn.meta
  if (!meta) return null
  const tokensOut = meta.usage?.completionTokens ?? Math.ceil(meta.chars / 3.2)
  const tokensTotal = meta.usage?.totalTokens ?? (meta.usage?.promptTokens ?? 0) + tokensOut
  const cost = price
    ? costOf(price, { promptTokens: meta.usage?.promptTokens ?? 0, completionTokens: tokensOut, cachedTokens: meta.usage?.cachedTokens ?? 0 }).total
    : null
  const exact = !!meta.usage
  return (
    <div className="mt-1.5 text-[10px] text-muted/60">
      <button onClick={() => setOpen((o) => !o)} className="hover:text-phosphor transition-colors">
        {meta.firstTokenMs ? `首字 ${meta.firstTokenMs}ms` : ''}
        {` · ${(meta.totalMs / 1000).toFixed(1)}s · ${tokensTotal} token`}
        {exact ? '' : '（估）'}
        {cost !== null ? ` · ${formatMoney(cost)}` : ''}
        {turn.rounds && turn.rounds > 1 ? ` · ${turn.rounds} 轮` : ''}
        <span className="text-muted/40">{open ? ' ▾' : ' ▸'}</span>
      </button>
      {open && (
        <div className="mt-1.5 border border-line-soft bg-panel-2 p-2.5">
          <MetricsView meta={meta} blocks={turn.blocks} rounds={turn.rounds} l={l} price={price} />
        </div>
      )}
    </div>
  )
}

function ToolBlock({ call, result, l }: { call: ChatToolCall; result: ChatToolResult | null; l: L }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const state = !result ? 'running' : result.ok && !result.isError ? 'ok' : result.isError ? 'toolError' : 'failed'
  const cls = state === 'running' ? 'text-amber border-amber/40'
    : state === 'ok' ? 'text-phosphor border-phosphor/40'
      : state === 'toolError' ? 'text-amber border-amber/40'
        : 'text-danger border-danger/40'
  const label = state === 'running' ? l.toolRunning : state === 'ok' ? l.toolOk : state === 'toolError' ? l.toolReported : l.toolFailed
  const body = result?.error ?? result?.text ?? ''

  return (
    <div className="mt-1.5 border border-line-soft bg-panel-2/60 px-2.5 py-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted">→</span>
        <span className="text-[12px] text-[#7ec8ff] break-all">{call.name}</span>
        <span className={`text-[10px] px-1.5 border ${cls}`}>{label}</span>
        {result && <span className="text-[10px] text-muted">{result.durationMs} ms</span>}
        {body && (
          <button onClick={() => setOpen((v) => !v)} className="text-[11px] text-muted hover:text-phosphor transition-colors">
            {open ? l.hideToolOutput : l.showToolOutput}
          </button>
        )}
      </div>
      <div className="text-[11px] text-muted/80 break-all mt-0.5">{l.toolArgsLabel} {call.args || '{}'}</div>
      {open && body && (
        <pre className="codeblock text-[11.5px] text-phosphor whitespace-pre-wrap break-all max-h-[30vh] overflow-auto mt-1">{body}</pre>
      )}
    </div>
  )
}

/* ================= 指标 ================= */

function MetricsView({ meta, blocks, rounds, l, price }: { meta: ChatMeta; blocks: Block[]; rounds?: number; l: L; price: ModelPrice | null }): React.ReactElement {
  const genMs = Math.max(meta.totalMs - meta.firstTokenMs, 1)
  const speed = meta.chars > 0 ? Math.round((meta.chars / genMs) * 1000) : 0
  // 服务端没给 usage 时，用与共享层同一套估算规则兜底，避免两处口径不一样
  const textOnly = blocks.filter((b) => b.kind === 'text').map((b) => (b as { text: string }).text).join('')
  const est = meta.usage ? 0 : estimateTokens(textOnly).tokens
  const tokensOut = meta.usage?.completionTokens ?? est
  const exact = !!meta.usage
  const tools = blocks.filter((b) => b.kind === 'tool').length
  const cost = price && (exact || est)
    ? costOf(price, {
        promptTokens: meta.usage?.promptTokens ?? 0,
        completionTokens: tokensOut,
        cachedTokens: meta.usage?.cachedTokens ?? 0,
      })
    : null

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Stat label={l.firstToken} value={meta.firstTokenMs ? `${meta.firstTokenMs} ms` : '—'} />
        <Stat label={l.ttfb} value={`${meta.ttfbMs} ms`} />
        <Stat label={l.totalTime} value={`${meta.totalMs} ms`} />
        <Stat label={l.speed} value={speed ? `${speed} ${l.speedUnit}` : '—'} />
        <Stat label={l.tokensIn} value={exact ? meta.usage!.promptTokens : '—'} />
        <Stat label={l.tokensOut} value={`${tokensOut}${exact ? '' : ' *'}`} />
      </div>
      {rounds !== undefined && rounds > 1 && <KV k={l.roundsKey} v={String(rounds)} />}
      {tools > 0 && <KV k={l.toolCallsLabel} v={String(tools)} />}
      <KV k={l.chunks} v={String(meta.chunks)} />
      <KV k={l.chars} v={String(meta.chars)} />
      {meta.reasoningChars > 0 && <KV k={l.reasoningChars} v={String(meta.reasoningChars)} />}
      <KV k={l.tokensTotal} v={`${meta.usage ? meta.usage.totalTokens : tokensOut}${exact ? '' : ' *'}`} />
      {meta.model && <KV k={l.servedModel} v={meta.model} />}
      {meta.finishReason && <KV k={l.finishReason} v={meta.finishReason === 'max_rounds' ? l.finishMaxRounds : meta.finishReason} />}
      <KV
        k={l.costLabel}
        v={
          <span className="text-amber">
            {cost ? formatMoney(cost.total) : '—'}
            <span className="text-muted text-[10px] ml-1">{exact ? l.exact : l.estimated}</span>
          </span>
        }
      />
      {cost && (
        <p className="text-[11px] text-muted">
          {l.costDetail.replace('{in}', formatMoney(cost.input)).replace('{out}', formatMoney(cost.output))}
        </p>
      )}
      {!exact && <p className="text-[11px] text-muted">{l.noUsageNote}</p>}
      {exact && !price && <p className="text-[11px] text-muted">{l.noPriceNote}</p>}
    </div>
  )
}

/* ================= 价格表 ================= */

function PriceTable({ prices, setPrices, l }: {
  prices: ModelPrice[]
  setPrices: React.Dispatch<React.SetStateAction<ModelPrice[]>>
  l: L
}): React.ReactElement {
  // 单价要能输小数（如 0.5），所以数字格单独存一份原始输入：
  // 直接 Number(raw)|0 会把「0.」这种中间态吃掉，用户永远打不出小数
  const [draft, setDraft] = useState<Record<string, string>>({})

  const update = (i: number, patch: Partial<ModelPrice>): void => {
    setPrices((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  const numCell = (i: number, field: 'inPerM' | 'outPerM', v: number): React.ReactElement => {
    const k = `${i}:${field}`
    return (
      <input
        value={draft[k] ?? String(v)}
        inputMode="decimal"
        onChange={(e) => {
          const raw = e.target.value
          setDraft((d) => ({ ...d, [k]: raw }))
          const n = Number(raw)
          if (raw.trim() !== '' && Number.isFinite(n)) update(i, { [field]: n })
        }}
        onBlur={() => setDraft((d) => {
          const next = { ...d }
          delete next[k]
          return next
        })}
        className="bg-transparent border border-line-soft px-1.5 py-1 text-[12px] text-phosphor w-full focus:outline-none focus:border-phosphor/40"
      />
    )
  }

  return (
    <Collapse title={l.priceTitle} right={<Btn variant="ghost" onClick={() => setPrices(DEFAULT_PRICES)}>{l.priceReset}</Btn>}>
      <p className="text-[11px] text-muted mb-2">{l.priceNote}</p>
      <div className="space-y-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_28px] gap-1.5 text-[10px] uppercase tracking-wider text-muted">
          <span>{l.priceModel}</span>
          <span>{l.priceIn}</span>
          <span>{l.priceOut}</span>
          <span />
        </div>
        {prices.map((p, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_64px_64px_28px] gap-1.5 items-center">
            <input
              value={p.model}
              onChange={(e) => update(i, { model: e.target.value })}
              className="bg-transparent border border-line-soft px-1.5 py-1 text-[12px] text-bright w-full focus:outline-none focus:border-phosphor/40"
            />
            {numCell(i, 'inPerM', p.inPerM)}
            {numCell(i, 'outPerM', p.outPerM)}
            <button
              onClick={() => setPrices((prev) => prev.filter((_, idx) => idx !== i))}
              title={l.priceRemove}
              className="text-muted hover:text-danger text-[13px] leading-none"
            >×</button>
          </div>
        ))}
        <Btn variant="ghost" onClick={() => setPrices((prev) => [...prev, { model: '', inPerM: 0, outPerM: 0 }])}>{l.priceAdd}</Btn>
      </div>
    </Collapse>
  )
}

/** 配置摘要里只显示主机名，完整地址太长 */
function shortHost(u: string): string {
  const t = u.trim()
  if (!t) return '—'
  try {
    return new URL(t).host
  } catch {
    return t.replace(/^https?:\/\//, '').split('/')[0] || t
  }
}
