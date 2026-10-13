/**
 * 分窗对比模式的状态管理（chat.tsx 接线，渲染在 PaneView）。
 *
 * 与普通对话的关系：窗格树 ≥2 叶时进入分窗模式（纯文本并行对比，
 * 各窗多轮上下文独立累积）；关回单叶自动退出，回到 useChat 的单窗对话。
 * 整个窗格会话（布局 + 模型绑定 + 各窗历史）持久化到 localStorage，刷新可续。
 * 事件按 activeRequestId 归窗（chat-panes.ts），主进程按 requestId 多路复用并发流。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_PANES,
  applyPaneEvent,
  assignProfile,
  beginFanOut,
  closePane,
  countLeaves,
  leafIds,
  loadPaneSession,
  newPaneSession,
  serializePanes,
  splitPane,
  type PaneSession,
  type SplitDir,
} from '../../lib/chat-panes'
import { findProfile, newId, type ModelProfile } from '../../lib/chat-config'
import { uuidV4 } from '../../lib/toolkit'
import type { ChatEvent } from '../../lib/chat-types'

export const PANES_KEY = 'devtoolbox-chat-panes'

function loadInitial(): PaneSession {
  if (typeof window === 'undefined') return newPaneSession()
  try {
    return loadPaneSession(window.localStorage.getItem(PANES_KEY)) ?? newPaneSession()
  } catch {
    return newPaneSession()
  }
}

export interface PaneModeCtl {
  /** 窗格树 ≥2 叶 = 分窗模式激活 */
  active: boolean
  sess: PaneSession
  /** 任一窗格在途（pending/streaming） */
  busy: boolean
  canSplit: boolean
  profileOf: (id: string) => ModelProfile | null
  /** 进入分窗：左叶绑定当前模型，右叶待选 */
  enter: (activeProfileId: string | null) => void
  split: (paneId: string, dir: SplitDir) => void
  close: (paneId: string) => void
  assign: (paneId: string, profileId: string | null) => void
  /** fan-out 发送；返回发出的路数（0 = 没有就绪窗格，调用方别清输入框） */
  send: (question: string) => number
  stopPane: (paneId: string) => void
  stopAll: () => void
}

export function usePaneMode(profiles: ModelProfile[]): PaneModeCtl {
  const [sess, setSess] = useState<PaneSession>(loadInitial)
  const sessRef = useRef(sess)
  sessRef.current = sess
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles

  const profileOf = useCallback((id: string) => findProfile(profilesRef.current, id), [])

  // 持久化：布局 + 模型绑定 + 各窗历史，刷新可续；存不下不影响本次会话
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(PANES_KEY, serializePanes(sess))
    } catch {
      /* ignore */
    }
  }, [sess])

  // 全局事件流按 activeRequestId 归窗；归不到的事件原样忽略（同一引用不触发渲染）
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.chat : undefined
    if (!api?.onEvent) return
    return api.onEvent((evt: ChatEvent) => {
      setSess((prev) => applyPaneEvent(prev, evt))
    })
  }, [])

  const leaves = countLeaves(sess.tree)
  const busy = Object.values(sess.panes).some(
    (rt) => rt.status === 'pending' || rt.status === 'streaming',
  )

  const enter = useCallback((activeProfileId: string | null) => {
    let s = newPaneSession()
    s = assignProfile(s, leafIds(s.tree)[0], activeProfileId)
    const sp = splitPane(s, leafIds(s.tree)[0], 'row', () => newId('pane'))
    if (sp) setSess(sp)
  }, [])

  const split = useCallback((paneId: string, dir: SplitDir) => {
    setSess((prev) => splitPane(prev, paneId, dir, () => newId('pane')) ?? prev)
  }, [])

  const close = useCallback((paneId: string) => {
    setSess((prev) => {
      const next = closePane(prev, paneId)
      if (!next) return prev
      // 关回单叶 = 退出分窗模式：窗格会话清零（对比残留没有回看价值，避免下次进入冒出旧历史）
      return countLeaves(next.tree) >= 2 ? next : newPaneSession()
    })
  }, [])

  const assign = useCallback((paneId: string, profileId: string | null) => {
    setSess((prev) => assignProfile(prev, paneId, profileId))
  }, [])

  const send = useCallback(
    (question: string): number => {
      const api = typeof window !== 'undefined' ? window.electronAPI?.chat : undefined
      if (!api?.send) return 0
      const { session, specs } = beginFanOut(
        sessRef.current,
        question,
        profileOf,
        () => `pane-${uuidV4().replace(/-/g, '')}`,
      )
      if (!specs.length) return 0
      setSess(session)
      // 逐条发出即可：主进程按 requestId 多路复用，事件回来各自归窗
      for (const s of specs) void api.send(s.spec)
      return specs.length
    },
    [profileOf],
  )

  const stopPane = useCallback((paneId: string) => {
    const rid = sessRef.current.panes[paneId]?.activeRequestId
    if (rid) void window.electronAPI?.chat?.abort(rid).catch(() => undefined)
  }, [])

  const stopAll = useCallback(() => {
    void window.electronAPI?.chat?.abort().catch(() => undefined)
  }, [])

  return {
    active: leaves >= 2,
    sess,
    busy,
    canSplit: leaves < MAX_PANES,
    profileOf,
    enter,
    split,
    close,
    assign,
    send,
    stopPane,
    stopAll,
  }
}
