/**
 * 对话会话的本地存储契约（main / renderer 共用）。
 *
 * 为什么要落盘：`turns` 原本只是组件 state，刷新或重启就全丢了 ——
 * 一个「聊两句就蒸发」的对话区，用起来不会像助手，只像个播放器。
 *
 * 存哪儿：主进程写到 `userData/chat-sessions.json`（单文件 + 全量写）。
 * 不用 localStorage 的原因很实际：历史里含工具调用结果（单条可达 20k 字符），
 * 几个长会话就能顶到 5MB 上限，而 localStorage 是同步的、还会阻塞渲染。
 *
 * 主进程把 `turns` 当**黑盒**原样存取，不理解它的内部结构 ——
 * 界面的渲染模型怎么演化都不会牵动存储层。
 */

/** 会话列表项（不含消息本体，切换时才按需读取） */
export interface ChatSessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 消息条数，列表里显示用 */
  turnCount: number
}

export interface ChatStoreListResult {
  ok: boolean
  sessions: ChatSessionMeta[]
  /** 上次打开的会话，重启后回到原处；没有则为 null */
  activeId: string | null
  /** 数据文件损坏、已旁置备份并从空开始（界面需要提醒用户，别静默吞掉） */
  recovered?: boolean
  error?: string
}

export interface ChatStoreLoadResult {
  ok: boolean
  turns: unknown[]
  error?: string
}

export interface ChatStoreWriteResult {
  ok: boolean
  error?: string
  /** 超过单文件上限被拒绝（界面提示用户开新会话） */
  tooLarge?: boolean
}

/** 单文件上限：与 localStorage 的 5MB 相比宽松得多，但仍要有个闸 */
export const CHAT_STORE_MAX_BYTES = 24 * 1024 * 1024

export const CHAT_STORE_FILENAME = 'chat-sessions.json'

/** 会话标题由首条用户消息生成；太长会撑坏列表 */
export function titleFromText(text: string, max = 28): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** id 只允许出现在文件名之外的安全字符集 —— 纵深防御，别让脏数据拼出奇怪的东西 */
export function isSafeSessionId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(id)
}
