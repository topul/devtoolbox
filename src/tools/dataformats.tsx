import React, { useState, useMemo } from 'react'
import { Btn, TA, Input, ErrorNote, Select } from '../components/ui'

/* ================= YAML ↔ JSON（轻量解析器） ================= */

function parseScalar(v: string): any {
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

function parseYaml(src: string): any {
  const lines = src.replace(/\t/g, '  ').split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))

  function block(startIdx: number, indent: number): [any, number] {
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
          // inline map in list: - key: value
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
          // merge following deeper-indented keys of same item
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
          // block scalar
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

function toYaml(obj: any, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(obj)) {
    return obj.map(item => {
      if (typeof item === 'object' && item !== null) {
        const inner = toYaml(item, indent + 1)
        return `${pad}-\n${inner}`.replace(`${pad}-\n${'  '.repeat(indent + 1)}`, `${pad}- `)
      }
      return `${pad}- ${fmtScalar(item)}`
    }).join('\n')
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj).map(([k, v]) => {
      if (typeof v === 'object' && v !== null) return `${pad}${k}:\n${toYaml(v, indent + 1)}`
      return `${pad}${k}: ${fmtScalar(v)}`
    }).join('\n')
  }
  return `${pad}${fmtScalar(obj)}`
}

function fmtScalar(v: any): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') {
    if (v === '' || /[:#\[\]{}\n]|^\s|\s$|^[-?]/.test(v) || ['true', 'false', 'null', '~'].includes(v)) return JSON.stringify(v)
    return v
  }
  return String(v)
}

export function YamlTool() {
  const [input, setInput] = useState('server:\n  host: 0.0.0.0\n  port: 8080\n  tags:\n    - web\n    - prod\n  tls: true')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const run = (mode: 'y2j' | 'j2y') => {
    setErr(null)
    try {
      if (mode === 'y2j') setOutput(JSON.stringify(parseYaml(input), null, 2))
      else setOutput(toYaml(JSON.parse(input)))
    } catch (e) {
      setErr((mode === 'y2j' ? 'YAML' : 'JSON') + ' 解析失败：' + (e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="输入 YAML 或 JSON" rows={9} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => run('y2j')}>YAML → JSON</Btn>
        <Btn onClick={() => run('j2y')}>JSON → YAML</Btn>
        <Btn variant="ghost" onClick={() => { setInput(output); setOutput('') }}>⇅ 交换</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label="输出" rows={9} />
      <p className="text-[11px] text-muted">* 轻量解析器，支持常见配置结构（嵌套、列表、多行字符串 | / &gt;）；复杂锚点(&amp;)、引用(*)语法暂不支持。</p>
    </div>
  )
}

/* ================= JSONPath ================= */

function evalJsonPath(obj: any, path: string): any[] {
  // 支持 $.a.b[0].c、$..key（递归下降）、$['key']
  let p = path.trim()
  if (!p.startsWith('$')) throw new Error('路径需以 $ 开头')
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
  if (consumed !== p) throw new Error(`无法解析路径片段：${p.slice(consumed.length) || p}`)

  let current: any[] = [obj]
  for (const t of tokens) {
    const next: any[] = []
    for (const node of current) {
      if ('recursive' in t) {
        const walk = (n: any) => {
          if (typeof n !== 'object' || n === null) return
          if (Array.isArray(n)) n.forEach(walk)
          else {
            Object.entries(n).forEach(([k, v]) => {
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
        } else if (typeof node === 'object' && node !== null && !Array.isArray(node) && t.key in node) {
          next.push(node[t.key])
        }
      } else {
        if (Array.isArray(node) && t.idx >= 0 && t.idx < node.length) next.push(node[t.idx])
      }
    }
    current = next
  }
  return current
}

const JSONPATH_EXAMPLES = [
  ['根对象', '$'],
  ['取字段', '$.store.book[0].title'],
  ['所有作者（递归）', '$..author'],
  ['数组全部', '$.store.book[*].price'],
]

export function JsonPathTool() {
  const [json, setJson] = useState('{\n  "store": {\n    "book": [\n      { "title": " hacking 入门", "author": "alice", "price": 39 },\n      { "title": "web 安全", "author": "bob", "price": 59 }\n    ]\n  }\n}')
  const [path, setPath] = useState('$.store.book[*].price')
  const [err, setErr] = useState<string | null>(null)

  const result = useMemo(() => {
    setErr(null)
    if (!json.trim() || !path.trim()) return null
    try {
      const obj = JSON.parse(json)
      const r = evalJsonPath(obj, path)
      return r
    } catch (e) {
      setErr((e as Error).message)
      return null
    }
  }, [json, path])

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <Input value={path} onChange={setPath} label="JSONPath 表达式" placeholder="$.store.book[0].title" />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {JSONPATH_EXAMPLES.map(([name, p]) => (
          <button key={name} onClick={() => setPath(p)}
            className="px-2 py-1 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
            {name}
          </button>
        ))}
      </div>
      <TA value={json} onChange={setJson} label="JSON 数据" rows={8} />
      <ErrorNote msg={err} />
      {result && (
        <TA value={result.length === 1 ? JSON.stringify(result[0], null, 2) : JSON.stringify(result, null, 2)} readOnly label={`匹配 ${result.length} 个结果`} rows={7} />
      )}
    </div>
  )
}

/* ================= CSS 格式化 ================= */

function formatCss(css: string): string {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  let out = ''
  let depth = 0
  let buf = ''
  const flush = () => {
    const t = buf.trim()
    if (t) out += '  '.repeat(depth) + t
    buf = ''
  }
  for (const ch of css) {
    if (ch === '{') {
      out += buf.trim() + ' {\n'
      buf = ''
      depth++
    } else if (ch === '}') {
      flush()
      depth--
      out += '  '.repeat(depth) + '}\n'
      buf = ''
    } else if (ch === ';') {
      out += '  '.repeat(depth) + buf.trim() + ';\n'
      buf = ''
    } else {
      buf += ch
    }
  }
  flush()
  return out.replace(/\n{2,}/g, '\n').trim()
}

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}

export function CssTool() {
  const [input, setInput] = useState('body{color:#0f0; margin: 0}a:hover{ text-decoration : underline }')
  const [output, setOutput] = useState('')

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="输入 CSS" rows={7} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => setOutput(formatCss(input))}>格式化</Btn>
        <Btn onClick={() => setOutput(minifyCss(input))}>压缩</Btn>
      </div>
      {output && (
        <div className="text-[11px] text-muted">
          {input.length} → {output.length} 字符（{output.length < input.length ? '减少' : '增加'} {Math.abs(100 - Math.round(output.length / Math.max(input.length, 1) * 100))}%）
        </div>
      )}
      <TA value={output} readOnly label="输出" rows={10} />
    </div>
  )
}
