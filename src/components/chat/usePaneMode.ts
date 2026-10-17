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
  /** 处于全屏态的叶 id；null = 平铺。失效（已关闭/已退出）时自动为 null */
  maximized: string | null
  /** split 节点两侧的宽度比例（0.1–0.9），缺省 0.5；拖动分隔条时更新 */
  ratioOf: (nodeId: string) => number
  /** 设定分隔条比例；越界自动夹到 [0.1, 0.9] */
  setSplitRatio: (nodeId: string, ratio: number) => void
  profileOf: (id: string) => ModelProfile | null
  /** 进入分窗：原叶绑定当前模型，新叶按 dir 开在对应方向；dir 省略 = 左右 */
  enter: (activeProfileId: string | null, dir?: SplitDir) => void
  split: (paneId: string, dir: SplitDir) => void
  close: (paneId: string) => void
  assign: (paneId: string, profileId: string | null) => void
  /** 单叶在「全屏 ↔ 平铺」之间切换；再点同一个叶即还原 */
  toggleMaximize: (paneId: string) => void
  /** fan-out 发送；返回发出的路数（0 = 没有就绪窗格，调用方别清输入框） */
  send: (question: string) => number
  stopPane: (paneId: string) => void
  stopAll: () => void
}

export function usePaneMode(profiles: ModelProfile[]): PaneModeCtl {
  const [sess, setSess] = useState<PaneSession>(loadInitial)
  /** 全屏态的叶 id（纯视图状态，不进窗格会话、刷新即还原） */
  const [maximized, setMaximized] = useState<string | null>(null)
  /** split 节点 id → 两侧比例（纯视图状态，同上）；缺省 0.5 */
  const [ratios, setRatios] = useState<Record<string, number>>({})
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
  const treeLeafIds = leafIds(sess.tree)
  const busy = Object.values(sess.panes).some(
    (rt) => rt.status === 'pending' || rt.status === 'streaming',
  )
  // 退出分窗（回单叶）或被全屏的叶已被关掉时，全屏态自然失效 —— 不留下幽灵引用
  const activeMaximized =
    leaves >= 2 && maximized && treeLeafIds.includes(maximized) ? maximized : null

  const enter = useCallback((activeProfileId: string | null, dir: SplitDir = 'row') => {
    let s = newPaneSession()
    s = assignProfile(s, leafIds(s.tree)[0], activeProfileId)
    const sp = splitPane(s, leafIds(s.tree)[0], dir, () => newId('pane'))
    if (sp) setSess(sp)
    setMaximized(null)
    // 全新会话的窗格 id 全是新的，旧比例键已成孤儿 —— 清掉
    setRatios({})
  }, [])

  const split = useCallback((paneId: string, dir: SplitDir) => {
    setSess((prev) => splitPane(prev, paneId, dir, () => newId('pane')) ?? prev)
    // 拆分后要能同时看到两片，先退出全屏
    setMaximized(null)
  }, [])

  const close = useCallback((paneId: string) => {
    setSess((prev) => {
      const next = closePane(prev, paneId)
      if (!next) return prev
      // 关回单叶 = 退出分窗模式：窗格会话清零（对比残留没有回看价值，避免下次进入冒出旧历史）
      return countLeaves(next.tree) >= 2 ? next : newPaneSession()
    })
    setMaximized((cur) => (cur === paneId ? null : cur))
  }, [])

  const assign = useCallback((paneId: string, profileId: string | null) => {
    setSess((prev) => assignProfile(prev, paneId, profileId))
  }, [])

  const toggleMaximize = useCallback((paneId: string) => {
    setMaximized((cur) => (cur === paneId ? null : paneId))
  }, [])

  const ratioOf = useCallback((nodeId: string) => ratios[nodeId] ?? 0.5, [ratios])
  const setSplitRatio = useCallback((nodeId: string, ratio: number) => {
    const r = Math.min(0.9, Math.max(0.1, Math.round(ratio * 1000) / 1000))
    setRatios((prev) => (prev[nodeId] === r ? prev : { ...prev, [nodeId]: r }))
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
    maximized: activeMaximized,
    ratioOf,
    setSplitRatio,
    profileOf,
    enter,
    split,
    close,
    assign,
    toggleMaximize,
    send,
    stopPane,
    stopAll,
  }
}
