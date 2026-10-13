/**
 * 对话页拆分窗格 —— 窗格树 + 多模型 fan-out 的纯逻辑（node 可直接测）。
 *
 * 布局是一棵二叉树：split 节点带方向（row=左右、col=上下），叶节点绑定一个模型档案。
 * 任意叶可再拆，关闭叶时父 split 坍缩成兄弟子树 —— 与编辑器分屏同一套心智。
 * 一条用户消息 fan-out 到所有已配置且就绪的叶：每叶一个 requestId、独立累积
 * 多轮历史，事件回来按 activeRequestId 归组 —— 主进程已按 requestId 多路复用并发流。
 * 对比走纯文本路径：不带工具与系统提示，保证窗间唯一变量是模型本身。
 */
import { profileReady, type ModelProfile } from './chat-config'
import type { ChatEvent, ChatMessage, ChatSendSpec, ChatUsage } from './chat-types'

/** 窗格总数上限：约束并发 SSE 路数，拆到顶就拒 */
export const MAX_PANES = 8
/** 每窗保留的最多消息条数（user+assistant 成对计），超出截断最近的 */
export const MAX_HISTORY_MESSAGES = 50

export type SplitDir = 'row' | 'col'

export type PaneNode =
  | { kind: 'leaf'; id: string; profileId: string | null }
  | { kind: 'split'; id: string; dir: SplitDir; children: [PaneNode, PaneNode] }

export interface PaneRuntime {
  /** 已完成的多轮记录；发送瞬间用户消息即落进来，assistant 在 done 时落 */
  history: ChatMessage[]
  /** 当前这条回复的累积文本（流式中/刚完成）；下一条发送时清空 */
  text: string
  reasoningChars: number
  status: 'idle' | 'pending' | 'streaming' | 'done' | 'error' | 'aborted'
  error: string
  startedAt: number | null
  firstTokenMs: number | null
  totalMs: number | null
  usage: ChatUsage | null
  /** 在途请求的归组键；done/error 后摘除 */
  activeRequestId: string | null
}

export interface PaneSession {
  tree: PaneNode
  /** 按叶 id 存运行态；树操作与持久化都以叶 id 对齐 */
  panes: Record<string, PaneRuntime>
}

/* ==================== 树操作 ==================== */

function newRuntime(): PaneRuntime {
  return {
    history: [],
    text: '',
    reasoningChars: 0,
    status: 'idle',
    error: '',
    startedAt: null,
    firstTokenMs: null,
    totalMs: null,
    usage: null,
    activeRequestId: null,
  }
}

export function newPaneSession(): PaneSession {
  return { tree: { kind: 'leaf', id: 'pane-root', profileId: null }, panes: { 'pane-root': newRuntime() } }
}

export function leafIds(tree: PaneNode): string[] {
  return tree.kind === 'leaf' ? [tree.id] : [...leafIds(tree.children[0]), ...leafIds(tree.children[1])]
}

export const countLeaves = (tree: PaneNode): number => (tree.kind === 'leaf' ? 1 : countLeaves(tree.children[0]) + countLeaves(tree.children[1]))

/** 深度优先改树：命中叶就替换为 split(原叶, 新空叶) */
function mapTree(tree: PaneNode, fn: (n: PaneNode) => PaneNode): PaneNode {
  const mapped = fn(tree)
  if (mapped !== tree) return mapped
  if (mapped.kind === 'leaf') return mapped
  const a = mapTree(mapped.children[0], fn)
  const b = mapTree(mapped.children[1], fn)
  return a === mapped.children[0] && b === mapped.children[1] ? mapped : { ...mapped, children: [a, b] }
}

/** 拆叶：原叶留在前（保住会话与模型绑定），新叶在后（空绑定）。到上限或找不到 → null */
export function splitPane(sess: PaneSession, paneId: string, dir: SplitDir, makeId: () => string): PaneSession | null {
  if (countLeaves(sess.tree) >= MAX_PANES) return null
  if (!leafIds(sess.tree).includes(paneId)) return null
  const newLeafId = makeId()
  const tree = mapTree(sess.tree, (n) =>
    n.kind === 'leaf' && n.id === paneId
      ? { kind: 'split', id: makeId(), dir, children: [n, { kind: 'leaf', id: newLeafId, profileId: null }] }
      : n,
  )
  return { tree, panes: { ...sess.panes, [newLeafId]: newRuntime() } }
}

/** 关叶：父 split 坍缩为兄弟子树；根叶不可关。找不到 → null */
export function closePane(sess: PaneSession, paneId: string): PaneSession | null {
  if (sess.tree.kind === 'leaf' || !leafIds(sess.tree).includes(paneId)) return null
  const drop = (n: PaneNode): PaneNode | null => {
    if (n.kind === 'leaf') return n.id === paneId ? null : n
    const a = drop(n.children[0])
    const b = drop(n.children[1])
    if (a === null && b === null) return null
    if (a === null) return b
    if (b === null) return a
    return a === n.children[0] && b === n.children[1] ? n : { ...n, children: [a, b] }
  }
  const tree = drop(sess.tree)
  if (!tree) return null
  const panes = { ...sess.panes }
  delete panes[paneId]
  return { tree, panes }
}

export function assignProfile(sess: PaneSession, paneId: string, profileId: string | null): PaneSession {
  const tree = mapTree(sess.tree, (n) =>
    n.kind === 'leaf' && n.id === paneId ? { ...n, profileId } : n,
  )
  return { ...sess, tree }
}

/* ==================== fan-out ==================== */

/** 纯文本规格：不带工具、不带系统提示 —— 窗间唯一变量是模型 */
export function buildPaneSpec(p: ModelProfile, messages: ChatMessage[], requestId: string): ChatSendSpec {
  return {
    requestId,
    baseUrl: p.baseUrl.trim(),
    apiKey: p.apiKey.trim(),
    model: p.model.trim(),
    messages,
    proxy: null,
    rejectUnauthorized: true,
    includeUsage: true,
    tools: null,
  }
}

export interface PaneFanOut {
  paneId: string
  requestId: string
  spec: ChatSendSpec
}

/**
 * 一条消息发往全部就绪叶：用户消息立即落各叶历史，状态置 pending；
 * 未配置模型或档案未就绪的叶原样跳过（界面据此提示「未配置模型」）。
 */
export function beginFanOut(
  sess: PaneSession,
  question: string,
  profileOf: (profileId: string) => ModelProfile | null,
  makeRequestId: () => string,
): { session: PaneSession; specs: PaneFanOut[] } {
  const q = question.trim()
  if (!q) return { session: sess, specs: [] }
  const panes = { ...sess.panes }
  const specs: PaneFanOut[] = []
  for (const leaf of leafList(sess.tree)) {
    if (!leaf.profileId) continue
    const p = profileOf(leaf.profileId)
    if (!profileReady(p)) continue
    const rt = panes[leaf.id] ?? newRuntime()
    const history = trimHistory([...rt.history, { role: 'user' as const, content: q }])
    const requestId = makeRequestId()
    panes[leaf.id] = { ...newRuntime(), history, status: 'pending', activeRequestId: requestId }
    specs.push({ paneId: leaf.id, requestId, spec: buildPaneSpec(p!, history, requestId) })
  }
  return { session: { ...sess, panes }, specs }
}

function trimHistory(h: ChatMessage[]): ChatMessage[] {
  return h.length > MAX_HISTORY_MESSAGES ? h.slice(h.length - MAX_HISTORY_MESSAGES) : h
}

function leafList(tree: PaneNode): Extract<PaneNode, { kind: 'leaf' }>[] {
  return tree.kind === 'leaf' ? [tree] : [...leafList(tree.children[0]), ...leafList(tree.children[1])]
}

/* ==================== 事件归组 ==================== */

function findPaneId(sess: PaneSession, requestId: string): string | null {
  for (const [id, rt] of Object.entries(sess.panes)) {
    if (rt.activeRequestId === requestId) return id
  }
  return null
}

/** 事件按 activeRequestId 归窗；不认识的 requestId 原样返回（同一引用） */
export function applyPaneEvent(sess: PaneSession, evt: ChatEvent): PaneSession {
  const paneId = findPaneId(sess, evt.requestId)
  if (!paneId) return sess
  const rt = sess.panes[paneId]
  const now = Date.now()
  const next: PaneRuntime = { ...rt }

  switch (evt.type) {
    case 'start':
      next.status = 'streaming'
      next.startedAt = now
      break
    case 'delta':
      if (evt.kind === 'content') {
        next.text += evt.text
        if (next.firstTokenMs === null && next.startedAt !== null) next.firstTokenMs = now - next.startedAt
      } else {
        next.reasoningChars += evt.text.length
      }
      break
    case 'done':
      next.status = 'done'
      next.totalMs = evt.meta.totalMs ?? (rt.startedAt !== null ? now - rt.startedAt : null)
      next.firstTokenMs = next.firstTokenMs ?? evt.meta.firstTokenMs ?? null
      next.usage = evt.meta.usage
      if (rt.text) next.history = trimHistory([...rt.history, { role: 'assistant', content: rt.text }])
      next.activeRequestId = null
      break
    case 'error':
      // 取消不是失败：界面显示「已停止」，跟出错区分开
      next.status = evt.code === 'ABORTED' ? 'aborted' : 'error'
      next.error = evt.message
      next.totalMs = rt.startedAt !== null ? now - rt.startedAt : null
      next.activeRequestId = null
      break
    default:
      return sess
  }
  return { ...sess, panes: { ...sess.panes, [paneId]: next } }
}

/** 指标行数据（界面拼装用；空值跳过） */
export function paneMetrics(rt: PaneRuntime): { firstToken: number | null; totalMs: number | null; tokens: number | null } {
  return { firstToken: rt.firstTokenMs, totalMs: rt.totalMs, tokens: rt.usage?.totalTokens ?? null }
}

/* ==================== 持久化 ==================== */

export const PANE_SESSION_VERSION = 1

export function serializePanes(sess: PaneSession): string {
  return JSON.stringify({ version: PANE_SESSION_VERSION, tree: sess.tree, panes: sess.panes })
}

function coerceRuntime(raw: unknown): PaneRuntime | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const base = newRuntime()
  const history = Array.isArray(o.history)
    ? o.history
        .filter(
          (m): m is ChatMessage =>
            typeof m === 'object' && m !== null &&
            ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
            typeof (m as ChatMessage).content === 'string',
        )
    : []
  const status = typeof o.status === 'string' && ['idle', 'pending', 'streaming', 'done', 'error', 'aborted'].includes(o.status) ? (o.status as PaneRuntime['status']) : 'idle'
  return {
    ...base,
    history,
    text: typeof o.text === 'string' ? o.text : '',
    reasoningChars: typeof o.reasoningChars === 'number' ? o.reasoningChars : 0,
    status,
    error: typeof o.error === 'string' ? o.error : '',
    usage: typeof o.usage === 'object' && o.usage !== null ? (o.usage as ChatUsage) : null,
    activeRequestId: null, // 在途请求不可恢复，刷新后回到空闲态
  }
}

function coerceTree(raw: unknown, seen: Set<string>): PaneNode | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (o.kind === 'leaf') {
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) return null
    seen.add(o.id)
    return { kind: 'leaf', id: o.id, profileId: typeof o.profileId === 'string' ? o.profileId : null }
  }
  if (o.kind === 'split') {
    if (o.dir !== 'row' && o.dir !== 'col') return null
    const children = Array.isArray(o.children) ? (o.children as unknown[]) : []
    const a = coerceTree(children[0], seen)
    const b = coerceTree(children[1], seen)
    return a && b ? { kind: 'split', id: typeof o.id === 'string' ? o.id : '', dir: o.dir, children: [a, b] } : null
  }
  return null
}

/**
 * 反序列化：任何不对齐都返回 null（调用方回落 newPaneSession），
 * 绝不部分恢复 —— 半吊子状态比从头开始更难排查。
 * 叶 id 在树里但缺 runtime 补默认；runtime 里树没有的（幽灵）丢弃。
 */
export function loadPaneSession(raw: string | null): PaneSession | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (o.version !== PANE_SESSION_VERSION) return null
    const seen = new Set<string>()
    const tree = coerceTree(o.tree, seen)
    if (!tree || typeof o.panes !== 'object' || o.panes === null) return null
    const panes: Record<string, PaneRuntime> = {}
    for (const id of leafIds(tree)) {
      panes[id] = coerceRuntime((o.panes as Record<string, unknown>)[id]) ?? newRuntime()
    }
    return { tree, panes }
  } catch {
    return null
  }
}
