/**
 * JSON Diff —— 对象递归比较 + 数组按 LCS 对齐，渲染进程与 MCP 服务端共用。
 *
 * 做的是「结构 diff」而不是文本 diff：结果用 JSON Pointer 风格的 path 直接定位
 * 变化位置（/user/name、/tags/2）。数组对齐用「序列化值匹配的 LCS」——序列化
 * 保留键序，所以两个元素只要深层相等序列化串必然一致；反过来说命中的元素对
 * 就是深层相等，直接跳过、无需再递归。未命中的按对齐顺序输出 removed（A 的
 * 下标）/ added（B 的下标）。顶层（或任一层）类型分支不同（对象 vs 数组 vs
 * 标量）不强行递归，直接给一条 changed。数组过大时 LCS 是 O(n*m)，超过阈值
 * 退化成按下标对齐，宁可结果糙一点也不把界面冻住。
 */

export interface JsonDiffEntry {
  /** JSON Pointer 风格路径；根节点是空串（界面显示为 /） */
  path: string
  kind: 'added' | 'removed' | 'changed'
  left?: unknown
  right?: unknown
}

export type DiffJsonResult = { ok: true; entries: JsonDiffEntry[] } | { ok: false; error: string }

/** 值超过 120 字符截断加省略号，界面与 MCP 两边的展示口径一致 */
const VALUE_LIMIT = 120

export function diffJson(a: string, b: string): DiffJsonResult {
  let av: unknown
  let bv: unknown
  try {
    av = JSON.parse(a)
  } catch (e) {
    return { ok: false, error: `左侧 JSON 解析失败：${(e as Error).message}` }
  }
  try {
    bv = JSON.parse(b)
  } catch (e) {
    return { ok: false, error: `右侧 JSON 解析失败：${(e as Error).message}` }
  }
  const entries: JsonDiffEntry[] = []
  diffValue(av, bv, '', entries)
  return { ok: true, entries }
}

/** 对象/数组/标量分支归类：null 单独一类，数组不与普通对象混同 */
function kindOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function diffValue(a: unknown, b: unknown, path: string, out: JsonDiffEntry[]): void {
  if (kindOf(a) !== kindOf(b)) {
    out.push({ path, kind: 'changed', left: a, right: b })
    return
  }
  if (Array.isArray(a)) {
    diffArray(a, b as unknown[], path, out)
    return
  }
  if (kindOf(a) === 'object') {
    diffObject(a as Record<string, unknown>, b as Record<string, unknown>, path, out)
    return
  }
  // 标量：Object.is 让 NaN===NaN 成立，不产生假 diff
  if (!Object.is(a, b)) out.push({ path, kind: 'changed', left: a, right: b })
}

function diffObject(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  path: string,
  out: JsonDiffEntry[],
): void {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const child = `${path}/${pointerEscape(k)}`
    // 必须查自有属性：'toString' 这类键会命中原型链上的成员，`in` 会误判
    const inA = Object.prototype.hasOwnProperty.call(a, k)
    const inB = Object.prototype.hasOwnProperty.call(b, k)
    if (inA && inB) diffValue(a[k], b[k], child, out)
    else if (inA) out.push({ path: child, kind: 'removed', left: a[k] })
    else out.push({ path: child, kind: 'added', right: b[k] })
  }
}

function diffArray(a: unknown[], b: unknown[], path: string, out: JsonDiffEntry[]): void {
  // 超过阈值（O(n*m) 的 DP 表会吃掉数百 MB）退化为按下标对齐
  if (a.length * b.length > 400_000) {
    const common = Math.min(a.length, b.length)
    for (let i = 0; i < common; i++) diffValue(a[i], b[i], `${path}/${i}`, out)
    for (let i = common; i < a.length; i++)
      out.push({ path: `${path}/${i}`, kind: 'removed', left: a[i] })
    for (let j = common; j < b.length; j++)
      out.push({ path: `${path}/${j}`, kind: 'added', right: b[j] })
    return
  }

  const sa = a.map(serialize)
  const sb = b.map(serialize)
  // dp[i][j] = sa[i..] 与 sb[j..] 的 LCS 长度，自底向上填表
  const n = sa.length
  const m = sb.length
  const dp: Uint32Array[] = []
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = sa[i] === sb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  // 回溯出正向操作序列：相等跳过（序列化相等即深层相等），否则按删/加推进
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (sa[i] === sb[j]) {
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ path: `${path}/${i}`, kind: 'removed', left: a[i] })
      i += 1
    } else {
      out.push({ path: `${path}/${j}`, kind: 'added', right: b[j] })
      j += 1
    }
  }
  for (; i < n; i++) out.push({ path: `${path}/${i}`, kind: 'removed', left: a[i] })
  for (; j < m; j++) out.push({ path: `${path}/${j}`, kind: 'added', right: b[j] })
}

/** JSON Pointer 转义：~ → ~0，/ → ~1（RFC 6901） */
function pointerEscape(k: string): string {
  return k.replace(/~/g, '~0').replace(/\//g, '~1')
}

function serialize(v: unknown): string {
  return JSON.stringify(v) ?? String(v)
}

/** 值展示：对象 JSON.stringify，超长截断加 … */
export function stringifyValue(v: unknown): string {
  let s: string
  if (v === undefined) s = 'undefined'
  else {
    try {
      s = JSON.stringify(v) ?? String(v)
    } catch {
      s = String(v) // 循环引用等极端情况（不该出现，来源是 JSON.parse）兜底
    }
  }
  return s.length > VALUE_LIMIT ? s.slice(0, VALUE_LIMIT) + '…' : s
}
