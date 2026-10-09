/**
 * 正则替换的纯逻辑。
 *
 * 为什么要单独一个模块而不是并进 `text.ts`：替换的边界情况（零宽匹配、组引用不存在、
 * 灾难性回溯）比匹配复杂得多，单独成文件才好写针对性的冒烟。
 *
 * 两条硬约束（与项目其他 toolkit 一致）：
 *   1. 不 import DOM / React / electron / Node 内置 —— 渲染层与 MCP 端共用同一份；
 *   2. 只抛稳定错误码（`BAD_REGEX`），中英文提示语归界面词条。
 *
 * 语义刻意与 `String.prototype.replace` 对齐：没给 `g` 就只替换第一处、
 * 引用不存在的组原样输出 `$9`。用户从别处复制来的正则不该在这里变行为。
 */

/** 单处替换的明细，预览与「逐条定位」用它 */
export interface Replacement {
  /** 在**原文**中的起始下标 */
  index: number
  /** 命中的原文片段 */
  match: string
  /** 按替换串展开后的结果 */
  replacement: string
}

/** 单次替换的汇总 */
export interface ReplaceResult {
  output: string
  count: number
  /**
   * 命中数是否超出护栏。
   *
   * 注意：**output 永远完整**，截断的只是「明细列表」——
   * 截断输出等于静默改数据，用户会拿着半份结果去用。
   */
  truncated: boolean
}

/** 明细条数护栏：超出只截明细，不动output */
export const MAX_REPLACEMENT_DETAILS = 5000

/**
 * 构造正则对象。
 *
 * @throws {Error} `BAD_REGEX` —— 模式或 flags 非法
 */
function buildRegex(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags)
  } catch {
    // 模式非法、flags 重复、未知 flag、命名组语法错误都归到这里
    throw new Error('BAD_REGEX')
  }
}

/** 判断是否需要逐处收集（全局模式才有"多处"的概念） */
function isGlobal(re: RegExp): boolean {
  return re.global
}

/**
 * 收集每一处替换的明细。
 *
 * @param re 必须带 `g`，否则只有第一处
 * @param limit 明细条数上限（超出即停止收集，调用方可据此提示「还有更多」）
 */
export function collectReplacements(
  text: string,
  re: RegExp,
  replacement: string,
  limit = MAX_REPLACEMENT_DETAILS,
): Replacement[] {
  const out: Replacement[] = []
  if (!isGlobal(re)) {
    const m = re.exec(text)
    if (!m) return out
    out.push({
      index: m.index,
      match: m[0],
      replacement: expand(re.source, re.flags, m, replacement),
    })
    return out
  }
  // 克隆：避免污染调用方传入的正则对象的 lastIndex
  const rx = new RegExp(re.source, re.flags)
  let m: RegExpExecArray | null
  while (out.length < limit && (m = rx.exec(text)) !== null) {
    out.push({
      index: m.index,
      match: m[0],
      replacement: expand(rx.source, rx.flags, m, replacement),
    })
    // **零宽匹配必须手动推进 lastIndex**，否则 exec 会一直命中同一位置：
    // a* 这类模式能直接把界面挂死（浏览器主线程卡住，窗口无响应）
    if (m[0] === '') rx.lastIndex++
    // 末尾之后还推进会越界，下次 exec 返回 null 并自动重置 lastIndex
    if (rx.lastIndex > text.length) break
  }
  return out
}

/**
 * 按 `String.prototype.replace` 的规则展开替换串。
 *
 * **必须用独立构造的非 g 正则**，不能复用执行中的那个：
 * `String.replace` 内部会把正则的 lastIndex 归零，若传的是正在循环用的 `rx`，
 * 下一轮 `exec` 就又从 0 开始 —— index 恒等于第一处，直接死循环到撞上护栏。
 *
 * 「与原生一致」这点很关键：组引用（$1 / $<name>）、转义（$$）的边缘语义
 * 手写一遍极易跑偏，直接借用原生实现才是可靠契约。
 */
function expand(source: string, flags: string, m: RegExpExecArray, replacement: string): string {
  // 去掉 g/y：只处理 m[0] 这一处，不触碰任何外部状态
  const oneShot = new RegExp(source, flags.replace(/[gy]/g, ''))
  return m[0].replace(oneShot, replacement)
}

/**
 * 执行正则替换。
 *
 * @param pattern 正则模式
 * @param replacement 替换串，支持 `$1` / `$&` / `` $` `` / `$'` / `$$` / `$<name>`
 * @param flags 正则标志；不给 `g` 时只替换第一处（与原生一致）
 * @throws {Error} `BAD_REGEX`
 */
export function regexReplace(
  text: string,
  pattern: string,
  replacement: string,
  flags = 'g',
): ReplaceResult {
  const re = buildRegex(pattern, flags)
  const output = text.replace(buildRegex(pattern, flags), replacement)
  const count = countMatches(text, re)
  // truncated 只描述「计数是否撞上护栏」—— 输出与计数都是完整的，
  // 真正会被截断的只有界面上那份明细列表（collectReplacements 自己的 limit）
  return { output, count, truncated: count >= MAX_REPLACEMENT_COUNT }
}

/**
 * 计数护栏。
 *
 * 与 `MAX_REPLACEMENT_DETAILS` 分开：明细是「给界面看的列表」，超了可以只显示前N 条
 * 并告知总数；**计数是「一共改了几处」，必须如实**，否则用户看到的「已改 5001 处」
 * 会以为工具数错了。
 *
 * 独立上限只为防超大文本把CPU 烧穿（一个 10MB 文本全量扫描要几十毫秒到几百毫秒）。
 */
export const MAX_REPLACEMENT_COUNT = 1_000_000

/** 数一共有多少处命中（受独立护栏限制，避免超大文本把 CPU 烧穿） */
function countMatches(text: string, re: RegExp): number {
  if (!isGlobal(re)) return re.test(text) ? 1 : 0
  const rx = new RegExp(re.source, re.flags)
  let n = 0
  let m: RegExpExecArray | null
  while (n < MAX_REPLACEMENT_COUNT && (m = rx.exec(text)) !== null) {
    n++
    if (m[0] === '') rx.lastIndex++
    if (rx.lastIndex > text.length) break
  }
  return n
}

/** 预览用的汇总 */
export interface ReplacePreview {
  /** 实际放进列表的条数 */
  shown: number
  /** 真实命中总数 */
  total: number
  /** 是否因为超过 limit 而截断 */
  truncated: boolean
}

/**
 * 构造「替换预览」：只统计，不产出全文。
 *
 * 界面在用户按下按钮之前就该显示「会改几处」—— 让用户先看到影响面再决定，
 * 而不是替换完才发现动了 3000 行。
 */
export function buildReplacementPreview(
  text: string,
  re: RegExp,
  replacement: string,
  limit: number,
): ReplacePreview {
  const total = countMatches(text, re)
  return { shown: Math.min(total, limit), total, truncated: total > limit }
}
