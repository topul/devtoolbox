/**
 * 对话会话的本地持久化状态（chat.tsx 的编排逻辑抽离，行为不变）。
 *
 * 存储走主进程 chatStore（userData/chat-sessions.json），渲染层不碰磁盘。
 * 提示语文本以 strings 注入（经 ref 读取，避免调用方每次渲染新建对象
 * 导致 effect 反复触发）；写盘失败必须让用户看见（storeNote）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { messageMeta, normalizeStoredTurns, type ChatUIMessage } from '../../lib/chat-ui'
import type { ChatSessionMeta } from '../../lib/chatstore-types'
import { uuidV4 } from '../../lib/toolkit'
import type { ElectronAPI } from '../../electron-env'

export interface ChatSessionStrings {
  storeTooLarge: string
  storeFailed: string
  storeRecovered: string
}

export interface UseChatSessionsOpts {
  busy: boolean
  messages: ChatUIMessage[]
  setMessages: (msgs: ChatUIMessage[]) => void
  strings: ChatSessionStrings
}

export interface ChatSessionsCtl {
  storeApi: ElectronAPI['chatStore'] | undefined
  sessions: ChatSessionMeta[]
  sessionId: string
  sessionTitle: string
  setSessionTitle: (v: string) => void
  storeNote: string
  showSessions: boolean
  setShowSessions: (v: boolean | ((p: boolean) => boolean)) => void
  renaming: boolean
  setRenaming: (v: boolean) => void
  titleDraft: string
  setTitleDraft: (v: string) => void
  confirmDel: boolean
  setConfirmDel: (v: boolean) => void
  storePath: string
  /** 写盘。**不含正在流式输出的那条助手消息** —— 半截回答落盘比看不到更困惑 */
  persist: (id: string, title: string, msgs: ChatUIMessage[]) => Promise<void>
  /** 切走之前先把当前会话写下来，否则会丢最后几条 */
  flushCurrent: () => Promise<void>
  refreshSessions: () => Promise<void>
  newSession: () => Promise<void>
  switchSession: (id: string) => Promise<void>
  removeSession: (id: string) => Promise<void>
  commitRename: () => Promise<void>
}

function storeApiOf(): ElectronAPI['chatStore'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI?.chatStore : undefined
}

export function useChatSessions({
  busy,
  messages,
  setMessages,
  strings,
}: UseChatSessionsOpts): ChatSessionsCtl {
  const storeApi = storeApiOf()
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])
  const [sessionId, setSessionId] = useState(() => `s${uuidV4().replace(/-/g, '')}`)
  const [sessionTitle, setSessionTitle] = useState('')
  const [storeNote, setStoreNote] = useState('')
  const [showSessions, setShowSessions] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [storePath, setStorePath] = useState('')

  // 提示语走 ref：调用方传的对象字面量每渲染都是新引用，直接进 deps 会让 effect 反复跑
  const stringsRef = useRef(strings)
  stringsRef.current = strings

  const sessionRef = useRef({ id: sessionId, title: sessionTitle })
  sessionRef.current = { id: sessionId, title: sessionTitle }

  const refreshSessions = useCallback(async (): Promise<void> => {
    if (!storeApi) return
    try {
      const res = await storeApi.list()
      if (res.ok) setSessions(res.sessions)
    } catch {
      /* 列表刷新失败不打断对话 */
    }
  }, [storeApi])

  const persist = useCallback(
    async (id: string, title: string, msgs: ChatUIMessage[]): Promise<void> => {
      if (!storeApi || !id) return
      const s = stringsRef.current
      const settled = msgs.filter(
        (m, i) =>
          !(
            i === msgs.length - 1 &&
            m.role === 'assistant' &&
            !messageMeta(m).meta &&
            !m.parts.length
          ),
      )
      try {
        const res = await storeApi.save({ id, title, turns: settled })
        if (!res.ok)
          setStoreNote(res.tooLarge ? s.storeTooLarge : `${s.storeFailed}: ${res.error ?? ''}`)
        else void refreshSessions()
      } catch (e) {
        setStoreNote(`${s.storeFailed}: ${(e as Error).message}`)
      }
    },
    [storeApi, refreshSessions],
  )

  useEffect(() => {
    if (!storeApi) return
    let alive = true
    storeApi
      .file()
      .then((p) => {
        if (alive) setStorePath(p)
      })
      .catch(() => {
        /* 拿不到就不显示 */
      })
    return () => {
      alive = false
    }
  }, [storeApi])

  const flushCurrent = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    // 流式中的那一轮不落盘（发送方会负责收尾）
    if (busy) return
    if (!messages.length) return
    await persist(sessionId, sessionTitle, messages)
  }, [sessionId, sessionTitle, messages, busy, persist])

  // 启动：读回上次的会话列表与当前会话
  useEffect(() => {
    if (!storeApi) return
    let alive = true
    const s = stringsRef.current
    void (async () => {
      try {
        const res = await storeApi.list()
        if (!alive) return
        if (!res.ok) {
          setStoreNote(s.storeFailed)
          return
        }
        setSessions(res.sessions)
        if (res.recovered) setStoreNote(s.storeRecovered)
        const id =
          res.activeId && res.sessions.some((x) => x.id === res.activeId) ? res.activeId : ''
        if (!id) return
        const loaded = await storeApi.load(id)
        if (!alive || !loaded.ok) return
        setSessionId(id)
        setSessionTitle(res.sessions.find((x) => x.id === id)?.title ?? '')
        setMessages(normalizeStoredTurns(loaded.turns))
      } catch (e) {
        if (alive) setStoreNote(`${s.storeFailed}: ${(e as Error).message}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [storeApi, setMessages])

  const newSession = useCallback(async (): Promise<void> => {
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
  }, [flushCurrent, setMessages, storeApi])

  const switchSession = useCallback(
    async (id: string): Promise<void> => {
      if (id === sessionId) {
        setShowSessions(false)
        return
      }
      const s = stringsRef.current
      if (!storeApi || busy) return
      await flushCurrent()
      const loaded = await storeApi.load(id)
      if (!loaded.ok) {
        setStoreNote(`${s.storeFailed}: ${loaded.error ?? ''}`)
        return
      }
      setSessionId(id)
      setSessionTitle(sessions.find((x) => x.id === id)?.title ?? '')
      setMessages(normalizeStoredTurns(loaded.turns))
      setShowSessions(false)
      setRenaming(false)
      setConfirmDel(false)
      void storeApi.setActive(id)
    },
    [sessionId, storeApi, busy, flushCurrent, sessions, setMessages],
  )

  const removeSession = useCallback(
    async (id: string): Promise<void> => {
      if (!storeApi || !id) return
      await storeApi.remove(id)
      if (id === sessionId) {
        setSessionId(`s${uuidV4().replace(/-/g, '')}`)
        setMessages([])
        setSessionTitle('')
      }
      setConfirmDel(false)
      await refreshSessions()
    },
    [storeApi, sessionId, setMessages, refreshSessions],
  )

  const commitRename = useCallback(async (): Promise<void> => {
    const t = titleDraft.trim()
    setRenaming(false)
    if (!t || t === sessionTitle) return
    setSessionTitle(t)
    if (messages.length) await persist(sessionId, t, messages)
  }, [titleDraft, sessionTitle, messages, sessionId, persist])

  return {
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
    flushCurrent,
    refreshSessions,
    newSession,
    switchSession,
    removeSession,
    commitRename,
  }
}
