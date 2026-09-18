/**
 * JSON 处理与 JSONPath 求值 —— 渲染进程与 MCP 服务端共用。
 * 零依赖手写实现，不引入 jsonpath 之类的三方包。
 */

export function jsonFormat(text: string, indent = 2): string {
  return JSON.stringify(JSON.parse(text), null, indent)
}

export function jsonMinify(text: string): string {
  return JSON.stringify(JSON.parse(text))
}

export interface JsonValidation {
  ok: boolean
  error?: string
}

/** 只校验不解析成对象，便于界面显示原始错误信息 */
export function jsonValidate(text: string): JsonValidation {
  try {
    JSON.parse(text)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export function jsonSortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, jsonSortKeys((value as Record<string, unknown>)[k])]),
    )
  }
  return value
}

/**
 * JSONPath 求值。支持：`$.a.b`、`$['a b']`、`$.a[0]`、`$.a[*]`、`$..key`（递归下降）。
 * 出错时抛 Error，message 为 `NEED_DOLLAR` 或 `BAD_SEG:<残留片段>`，界面据此出对应文案。
 */
export function evalJsonPath(obj: unknown, path: string): unknown[] {
  let p = path.trim()
  if (!p.startsWith('$')) throw new Error('NEED_DOLLAR')
  p = p.slice(1)

  const tokens: ({ key: string } | { idx: number } | { recursive: string })[] = []
  const re = /(?:\.\.([A-Za-z_$][\w$-]*))|(?:\.([A-Za-z_$][\w$-]*))|(?:\['([^']+)'\])|(?:\[(\d+)\])|(?:\[\*\])/g
  let m: RegExpExecArray | null
  let consumed = ''
  while ((m = re.exec(p))) {
    consumed += m[0]
    if (m[1] !== undefined) tokens.push({ recursive: m[1] })
    else if (m[2] !== undefined) tokens.push({ key: m[2] })
    else if (m[3] !== undefined) tokens.push({ key: m[3] })
    else if (m[4] !== undefined) tokens.push({ idx: parseInt(m[4]) })
    else tokens.push({ key: '*' })
  }
  if (consumed !== p) throw new Error('BAD_SEG:' + (p.slice(consumed.length) || p))

  let current: unknown[] = [obj]
  for (const t of tokens) {
    const next: unknown[] = []
    for (const node of current) {
      if ('recursive' in t) {
        const walk = (n: unknown): void => {
          if (typeof n !== 'object' || n === null) return
          if (Array.isArray(n)) n.forEach(walk)
          else {
            Object.entries(n as Record<string, unknown>).forEach(([k, v]) => {
              if (k === t.recursive) next.push(v)
              walk(v)
            })
          }
        }
        walk(node)
      } else if ('key' in t) {
        if (t.key === '*') {
          if (Array.isArray(node)) next.push(...node)
          else if (typeof node === 'object' && node !== null) next.push(...Object.values(node))
        } else if (typeof node === 'object' && node !== null && !Array.isArray(node) && t.key in (node as object)) {
          next.push((node as Record<string, unknown>)[t.key])
        }
      } else {
        if (Array.isArray(node) && t.idx >= 0 && t.idx < node.length) next.push(node[t.idx])
      }
    }
    current = next
  }
  return current
}
