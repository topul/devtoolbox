/**
 * 环境变量插值 —— `{{name}}` 占位符的解析与替换。
 *
 * 设计约束：
 * - 纯函数、无 DOM / Node 依赖（toolkit 分层红线）；
 * - 单遍替换：变量值里再出现 `{{...}}` 不会二次展开，从根上排除递归注入与死循环；
 * - 未定义的占位符原样保留并进入 missing，由调用方决定阻断还是放行。
 */

/** 占位符名：字母/下划线开头，允许数字、点、连字符（如 base_url、api-key） */
const VAR_RE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g

/** 抽出文本里引用的全部变量名，按出现顺序去重 */
export function listEnvVars(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(VAR_RE)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

export interface EnvApplyResult {
  /** 替换后的文本；缺失变量保留原占位符 */
  text: string
  /** 值缺失（undefined / null）的变量名，按首次出现顺序去重 */
  missing: string[]
}

/** 把多个文本的缺失变量合并去重 */
export function mergeMissing(results: { missing: string[] }[]): string[] {
  const out: string[] = []
  for (const r of results) {
    for (const n of r.missing) if (!out.includes(n)) out.push(n)
  }
  return out
}

/**
 * 单遍插值：只扫描输入文本本身，替换进去的变量值不会被再次扫描。
 * 变量名匹配不到（undefined / null）时保留 `{{name}}` 原样并记入 missing。
 */
export function applyEnvVars(text: string, vars: Record<string, string | undefined>): EnvApplyResult {
  const missing: string[] = []
  const out = text.replace(VAR_RE, (whole, name: string) => {
    const v = vars[name]
    if (v === undefined || v === null) {
      if (!missing.includes(name)) missing.push(name)
      return whole
    }
    return v
  })
  return { text: out, missing }
}
