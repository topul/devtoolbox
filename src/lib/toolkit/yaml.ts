/**
 * YAML ↔ JSON —— 渲染进程与 MCP 服务端共用。
 *
 * 手写的轻量解析器，只覆盖常见结构（映射 / 列表 / 块标量 / 行内标量 / 注释），
 * 不支持锚点、别名、多文档、复杂流式集合。要完整 YAML 语义请用三方库，
 * 这里刻意保持零依赖：MCP 产物要能打成单文件，不能带一堆运行时依赖。
 */

function parseScalar(v: string): unknown {
  const t = v.trim()
  if (t === '' || t === '~' || t === 'null') return null
  if (t === 'true') return true
  if (t === 'false') return false
  if (/^-?\d+$/.test(t)) return parseInt(t)
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t)
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1)
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map(parseScalar)
  }
  return t
}

export function parseYaml(src: string): unknown {
  const lines = src.replace(/\t/g, '  ').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))

  function block(startIdx: number, indent: number): [unknown, number] {
    let i = startIdx
    const firstLine = lines[i]
    const isList = firstLine?.trim().startsWith('- ')
    const result: any = isList ? [] : {}

    while (i < lines.length) {
      const raw = lines[i]
      const curIndent = raw.length - raw.trimStart().length
      if (curIndent < indent) break
      const content = raw.trim()

      if (content.startsWith('- ')) {
        if (!Array.isArray(result)) break
        const rest = content.slice(2)
        if (rest.includes(':')) {
          const sub: any = {}
          const idx = rest.indexOf(':')
          const k = rest.slice(0, idx).trim()
          const v = rest.slice(idx + 1).trim()
          if (v === '') {
            const [child, next] = block(i + 1, curIndent + 2)
            sub[k] = child
            i = next
          } else {
            sub[k] = parseScalar(v)
            i++
          }
          while (i < lines.length) {
            const ni = lines[i].length - lines[i].trimStart().length
            if (ni === curIndent + 2 && !lines[i].trim().startsWith('- ')) {
              const c2 = lines[i].trim()
              const i2 = c2.indexOf(':')
              const k2 = c2.slice(0, i2).trim()
              const v2 = c2.slice(i2 + 1).trim()
              if (v2 === '') {
                const [child, next] = block(i + 1, ni + 2)
                sub[k2] = child
                i = next
              } else {
                sub[k2] = parseScalar(v2)
                i++
              }
            } else break
          }
          result.push(sub)
        } else {
          result.push(parseScalar(rest))
          i++
        }
      } else {
        const idx = content.indexOf(':')
        if (idx < 0) { i++; continue }
        const key = content.slice(0, idx).trim().replace(/^["']|["']$/g, '')
        const val = content.slice(idx + 1).trim()
        if (val === '') {
          const next = lines[i + 1]
          if (next && (next.length - next.trimStart().length) > curIndent) {
            const [child, nextIdx] = block(i + 1, curIndent + 1)
            result[key] = child
            i = nextIdx
          } else {
            result[key] = null
            i++
          }
        } else if (val === '|' || val === '>') {
          const buf: string[] = []
          i++
          while (i < lines.length && (lines[i].length - lines[i].trimStart().length) > curIndent) {
            buf.push(lines[i].trim())
            i++
          }
          result[key] = val === '|' ? buf.join('\n') : buf.join(' ')
        } else {
          result[key] = parseScalar(val)
          i++
        }
      }
    }
    return [result, i]
  }

  if (!lines.length) return null
  return block(0, lines[0].length - lines[0].trimStart().length)[0]
}

function fmtScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') {
    if (v === '' || /[:#\[\]{}\n]|^\s|\s$|^[-?]/.test(v) || ['true', 'false', 'null', '~'].includes(v))
      return JSON.stringify(v)
    return v
  }
  return String(v)
}

export function toYaml(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(obj)) {
    return obj
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          const inner = toYaml(item, indent + 1)
          return `${pad}-\n${inner}`.replace(`${pad}-\n${'  '.repeat(indent + 1)}`, `${pad}- `)
        }
        return `${pad}- ${fmtScalar(item)}`
      })
      .join('\n')
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj as Record<string, unknown>)
      .map(([k, v]) => {
        if (typeof v === 'object' && v !== null) return `${pad}${k}:\n${toYaml(v, indent + 1)}`
        return `${pad}${k}: ${fmtScalar(v)}`
      })
      .join('\n')
  }
  return `${pad}${fmtScalar(obj)}`
}

/** YAML 文本 → 格式化 JSON 文本 */
export function yamlToJson(src: string, indent = 2): string {
  return JSON.stringify(parseYaml(src), null, indent)
}

/** JSON 文本 → YAML 文本 */
export function jsonToYaml(src: string): string {
  return toYaml(JSON.parse(src))
}
