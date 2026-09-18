/**
 * Token 估算与费用计算 —— 渲染进程与 MCP 服务端共用。
 *
 * 关于精度的态度：**这里是估算，不是分词**。
 * 真正的分词需要各家自己的词表（tiktoken / deepseek 的 tokenizer 各不相同），
 * 本项目不引那种体积的依赖。因此实际用量一律以**服务端返回的 usage 为准**，
 * 本文件只在两种场合出场：
 *   1. 发送前想知道这条 prompt 大概多长（估算 ±20% 足够做取舍）；
 *   2. 服务端不给 usage 时兜底（界面会明确标注「估算」）。
 *
 * 估算规则（透明可核）：
 *   - ASCII 字母数字：约 4 字符 / token
 *   - CJK 汉字：约 0.75 token / 字（主流 BPE 词表下常见字多为 1 字 1 词元，
 *     但常用词会被合并，整体略低于 1）
 *   - 其余字符（符号、emoji、其他语系）：约 2 字符 / token
 */

export interface TokenEstimate {
  tokens: number
  latinChars: number
  cjkChars: number
  otherChars: number
  /** 英文单词数，便于和「按词估算」的直觉对照 */
  words: number
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/
const LATIN_RE = /[A-Za-z0-9]/

export function estimateTokens(text: string): TokenEstimate {
  let latinChars = 0
  let cjkChars = 0
  let otherChars = 0
  for (const ch of text) {
    if (CJK_RE.test(ch)) cjkChars++
    else if (LATIN_RE.test(ch)) latinChars++
    else otherChars++
  }
  const words = (text.match(/[A-Za-z0-9_'-]+/g) || []).length
  const tokens = Math.ceil(latinChars / 4 + cjkChars * 0.75 + otherChars / 2)
  return { tokens, latinChars, cjkChars, otherChars, words }
}

export interface ChatMessageLike {
  role: string
  content: string
}

export interface MessagesEstimate {
  /** 全部消息正文的估算 token */
  tokens: number
  /** 每条消息的正文估算，便于找出哪条最占地方 */
  perMessage: number[]
  /** 协议固定开销：每条消息约 4 token，外加回复起始 3 token */
  overhead: number
  total: number
}

/** OpenAI 风格对话的估算：per-message 开销按官方文档的既有约定（约 4 token/条） */
export function estimateMessages(messages: ChatMessageLike[]): MessagesEstimate {
  const perMessage = messages.map((m) => estimateTokens(`${m.role}\n${m.content}`).tokens)
  const tokens = perMessage.reduce((a, b) => a + b, 0)
  const overhead = messages.length * 4 + 3
  return { tokens, perMessage, overhead, total: tokens + overhead }
}

/* ================= 费用 ================= */

export interface ModelPrice {
  /** 模型名，支持前缀匹配（如填 deepseek 可命中 deepseek-chat） */
  model: string
  /** 每百万输入 token 单价 */
  inPerM: number
  /** 每百万输出 token 单价 */
  outPerM: number
  /** 命中缓存时的输入单价，留空表示不区分 */
  cacheInPerM?: number
}

export interface CostBreakdown {
  input: number
  output: number
  total: number
  /** 命中了哪条价格记录 */
  price: ModelPrice
  /** 是否用了缓存价 */
  usedCache: boolean
}

/**
 * 按模型名找价格：先精确匹配（忽略大小写），再退化为最长前缀匹配，
 * 这样填 `deepseek` 就能覆盖 `deepseek-chat` / `deepseek-reasoner-v3` 之类的变体。
 */
export function findPrice(model: string, table: ModelPrice[]): ModelPrice | null {
  const m = model.trim().toLowerCase()
  if (!m) return null
  const exact = table.find((p) => p.model.trim().toLowerCase() === m)
  if (exact) return exact
  const prefixed = table
    .filter((p) => p.model.trim() && m.startsWith(p.model.trim().toLowerCase()))
    .sort((a, b) => b.model.length - a.model.length)
  if (prefixed.length) return prefixed[0]
  // 反向：价格表里写的是完整名，调用方给的是短名（如只填了 gpt-4o 而表里是 gpt-4o-2024-11-20）
  const contained = table
    .filter((p) => m.length >= 4 && p.model.trim().toLowerCase().startsWith(m))
    .sort((a, b) => a.model.length - b.model.length)
  return contained[0] ?? null
}

export function costOf(
  price: ModelPrice,
  usage: { promptTokens: number; completionTokens: number; cachedTokens?: number },
): CostBreakdown {
  const cached = Math.min(usage.cachedTokens ?? 0, usage.promptTokens)
  const fresh = usage.promptTokens - cached
  const useCache = cached > 0 && typeof price.cacheInPerM === 'number'
  const input =
    (fresh / 1e6) * price.inPerM + (useCache ? (cached / 1e6) * (price.cacheInPerM as number) : (cached / 1e6) * price.inPerM)
  const output = (usage.completionTokens / 1e6) * price.outPerM
  return { input, output, total: input + output, price, usedCache: useCache }
}

/**
 * 金额展示：小额也要能看出来，所以按量级决定小数位，
 * 而不是一律 toFixed(2)（0.003 元会显示成 0.00）。
 */
export function formatMoney(v: number, symbol = '¥'): string {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return `${symbol}0`
  if (v < 0.01) return `${symbol}${v.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')}`
  if (v < 1) return `${symbol}${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`
  if (v < 100) return `${symbol}${v.toFixed(3)}`
  return `${symbol}${v.toFixed(2)}`
}
