/**
 * TOML 与 CSV 解析 —— 渲染进程与 MCP 服务端共用。
 *
 * TOML 覆盖 1.0 的常用子集：键值对（字符串/整数/浮点/布尔/日期时间）、
 * 数组、行内表、[table] 与 [[array of tables]]、点分键。
 * 日期时间原样转 ISO 字符串（JSON 没有日期类型，丢类型比丢数据好）。
 */

/* ================= TOML → JSON ================= */

export class TomlError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (第 ${line} 行)`)
    this.name = 'TomlError'
  }
}

/** 词法扫描后的 token：一行的「键 = 值」或段头 */
interface TomlLine {
  line: number
  /** 段头路径（[a.b] / [[a.b]]），普通行则为 null */
  section: string[] | null
  /** [[...]] 数组表 */
  append: boolean
  /** 点分键路径 */
  key: string[]
  raw: string
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/

function splitDottedKey(s: string, line: number): string[] {
  const parts: string[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '"' || ch === "'") {
      const end = s.indexOf(ch, i + 1)
      if (end < 0) throw new TomlError('引号键未闭合', line)
      parts.push(s.slice(i + 1, end))
      i = end + 1
    } else {
      let j = i
      while (j < s.length && s[j] !== '.') j++
      const seg = s.slice(i, j).trim()
      if (!BARE_KEY.test(seg)) throw new TomlError(`非法键名 "${seg}"`, line)
      parts.push(seg)
      i = j
    }
    while (i < s.length && (s[i] === '.' || s[i] === ' ')) i++
  }
  return parts
}

/** 切掉注释（引号内的 # 不算） */
function stripComment(s: string): string {
  let inBasic = false
  let inLiteral = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && inBasic) {
      i++
      continue
    }
    if (ch === '"' && !inLiteral) inBasic = !inBasic
    else if (ch === "'" && !inBasic) inLiteral = !inLiteral
    else if (ch === '#' && !inBasic && !inLiteral) return s.slice(0, i)
  }
  return s
}

function scanLines(src: string): TomlLine[] {
  const out: TomlLine[] = []
  const lines = src.split(/\r\n|\r|\n/)
  let i = 0
  while (i < lines.length) {
    const lineNo = i + 1
    let text = stripComment(lines[i]).trim()
    i++
    if (!text) continue

    // 多行字符串 / 多行数组：向后拼接直到收尾
    while (needsMore(text)) {
      if (i >= lines.length) throw new TomlError('多行结构未闭合', lineNo)
      text += '\n' + stripComment(lines[i])
      i++
    }

    let section: string[] | null = null
    let append = false
    if (text.startsWith('[')) {
      const close = text.endsWith(']]')
        ? text.length - 2
        : text.endsWith(']')
          ? text.length - 1
          : -1
      if (close < 0) throw new TomlError('段头未闭合', lineNo)
      append = text.startsWith('[[')
      section = splitDottedKey(text.slice(append ? 2 : 1, close).trim(), lineNo)
      out.push({ line: lineNo, section, append, key: [], raw: '' })
      continue
    }

    const eq = findAssign(text)
    if (eq < 0) throw new TomlError('缺少 = 或不是合法的段头', lineNo)
    const key = splitDottedKey(text.slice(0, eq).trim(), lineNo)
    out.push({ line: lineNo, section: null, append: false, key, raw: text.slice(eq + 1).trim() })
  }
  return out
}

function needsMore(text: string): boolean {
  let inBasic = false
  let inLiteral = false
  let inMlBasic = false
  let inMlLiteral = false
  for (let i = 0; i < text.length; i++) {
    const three = text.slice(i, i + 3)
    if (inMlBasic) {
      if (three === '"""') {
        inMlBasic = false
        i += 2
      }
      continue
    }
    if (inMlLiteral) {
      if (three === "'''") {
        inMlLiteral = false
        i += 2
      }
      continue
    }
    if (inBasic) {
      if (text[i] === '\\') {
        i++
        continue
      }
      if (text[i] === '"') inBasic = false
      continue
    }
    if (inLiteral) {
      if (text[i] === "'") inLiteral = false
      continue
    }
    if (three === '"""') {
      inMlBasic = true
      i += 2
      continue
    }
    if (three === "'''") {
      inMlLiteral = true
      i += 2
      continue
    }
    if (text[i] === '"') {
      inBasic = true
      continue
    }
    if (text[i] === "'") {
      inLiteral = true
      continue
    }
  }
  // 引号全部闭合后，还要看数组括号是否配平（行内数组允许跨行）
  if (inBasic || inLiteral || inMlBasic || inMlLiteral) return true
  return bracketDepth(text) > 0
}

function bracketDepth(text: string): number {
  let depth = 0
  let inBasic = false
  let inLiteral = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inBasic) {
      if (ch === '\\') i++
      else if (ch === '"') inBasic = false
      continue
    }
    if (inLiteral) {
      if (ch === "'") inLiteral = false
      continue
    }
    if (ch === '"') inBasic = true
    else if (ch === "'") inLiteral = true
    else if (ch === '[') depth++
    else if (ch === ']') depth--
  }
  return depth
}

function findAssign(text: string): number {
  let inBasic = false
  let inLiteral = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inBasic) {
      if (ch === '\\') i++
      else if (ch === '"') inBasic = false
      continue
    }
    if (inLiteral) {
      if (ch === "'") inLiteral = false
      continue
    }
    if (ch === '"') {
      inBasic = true
      continue
    }
    if (ch === "'") {
      inLiteral = true
      continue
    }
    if (ch === '=') return i
  }
  return -1
}

/** 多行字符串在 scanLines 阶段已用 \n 拼回，这里统一按原始文本解析 */
function parseValue(raw: string, line: number): unknown {
  const s = raw.trim()
  if (!s) throw new TomlError('值为空', line)

  if (s.startsWith('"""')) return parseMultiline(s, '"""', line, unescapeBasic)
  if (s.startsWith("'''")) return parseMultiline(s, "'''", line, (x) => x)
  if (s.startsWith('"')) return unescapeBasic(readQuoted(s, '"', line), line)
  if (s.startsWith("'")) return readQuoted(s, "'", line)
  if (s.startsWith('[')) return parseArray(s, line)
  if (s.startsWith('{')) return parseInlineTable(s, line)

  if (s === 'true') return true
  if (s === 'false') return false
  if (/^[+-]?(inf|nan)$/.test(s))
    return s.includes('nan') ? NaN : s[0] === '-' ? -Infinity : Infinity
  if (/^0x[0-9a-fA-F_]+$/.test(s)) return parseInt(s.slice(2).replace(/_/g, ''), 16)
  if (/^0o[0-7_]+$/.test(s)) return parseInt(s.slice(2).replace(/_/g, ''), 8)
  if (/^0b[01_]+$/.test(s)) return parseInt(s.slice(2).replace(/_/g, ''), 2)
  if (/^[+-]?\d[\d_]*$/.test(s)) return parseInt(s.replace(/_/g, ''), 10)
  if (/^[+-]?\d[\d_]*(\.[\d_]*)?([eE][+-]?\d+)?$/.test(s)) return parseFloat(s.replace(/_/g, ''))
  // 日期时间：TOML 有独立类型，JSON 没有 —— 统一转 ISO 字符串保留信息
  if (/^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(s))
    return normalizeDate(s)
  if (/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) return s
  throw new TomlError(`无法解析的值 "${s.slice(0, 40)}"`, line)
}

function normalizeDate(s: string): string {
  const d = new Date(s.includes(' ') ? s.replace(' ', 'T') : s)
  if (Number.isNaN(d.getTime())) return s
  return d.toISOString()
}

function unescapeBasic(s: string, line: number): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const n = s[++i]
    switch (n) {
      case 'n':
        out += '\n'
        break
      case 't':
        out += '\t'
        break
      case 'r':
        out += '\r'
        break
      case '"':
        out += '"'
        break
      case '\\':
        out += '\\'
        break
      case 'b':
        out += '\b'
        break
      case 'f':
        out += '\f'
        break
      case 'u':
        out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16))
        i += 4
        break
      case 'U':
        out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 9), 16))
        i += 8
        break
      default:
        throw new TomlError(`不认识的转义 \\${n ?? ''}`, line)
    }
  }
  return out
}

function readQuoted(s: string, q: string, line: number): string {
  const end = s.indexOf(q, 1)
  if (end < 0) throw new TomlError('字符串未闭合', line)
  if (s.slice(end + 1).trim()) throw new TomlError('字符串后面有多余内容', line)
  return s.slice(1, end)
}

function parseMultiline(
  s: string,
  delim: string,
  line: number,
  unescape: (x: string, l: number) => string,
): string {
  const end = s.indexOf(delim, 3)
  if (end < 0) throw new TomlError('多行字符串未闭合', line)
  let body = s.slice(3, end)
  if (body.startsWith('\n')) body = body.slice(1)
  else if (body.startsWith('\r\n')) body = body.slice(2)
  return unescape(body.replace(/\r\n/g, '\n'), line)
}

/** 数组 / 行内表可能跨行（scanLines 已拼起来），用深度扫描逐项切开 */
function splitTopLevel(s: string, open: string, close: string, line: number): string[] {
  const inner = s.trim()
  if (!inner.startsWith(open) || !inner.endsWith(close)) throw new TomlError('结构未闭合', line)
  const body = inner.slice(1, -1)
  const items: string[] = []
  let depth = 0
  let inBasic = false
  let inLiteral = false
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inBasic) {
      if (ch === '\\') i++
      else if (ch === '"') inBasic = false
      continue
    }
    if (inLiteral) {
      if (ch === "'") inLiteral = false
      continue
    }
    if (ch === '"') {
      inBasic = true
      continue
    }
    if (ch === "'") {
      inLiteral = true
      continue
    }
    if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) {
      items.push(body.slice(start, i))
      start = i + 1
    }
  }
  const tail = body.slice(start)
  if (tail.trim()) items.push(tail)
  return items.map((x) => x.trim()).filter((x) => x.length > 0)
}

function parseArray(s: string, line: number): unknown[] {
  return splitTopLevel(s, '[', ']', line).map((item) => parseValue(item, line))
}

function parseInlineTable(s: string, line: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const pair of splitTopLevel(s, '{', '}', line)) {
    const eq = findAssign(pair)
    if (eq < 0) throw new TomlError('行内表缺少 =', line)
    const key = splitDottedKey(pair.slice(0, eq).trim(), line)
    setPath(out, key, parseValue(pair.slice(eq + 1).trim(), line), line)
  }
  return out
}

/** 按点分键写入；已存在的标量被覆盖，中间节点自动建表 */
function setPath(
  root: Record<string, unknown>,
  path: string[],
  value: unknown,
  line: number,
): void {
  let node = root
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    const next = node[k]
    if (next === undefined) {
      node[k] = {}
    } else if (Array.isArray(next)) {
      node = next[next.length - 1] as Record<string, unknown>
      continue
    } else if (typeof next !== 'object' || next === null) {
      throw new TomlError(`键 "${path.slice(0, i + 1).join('.')}" 冲突`, line)
    } else {
      node = next as Record<string, unknown>
      continue
    }
    node = node[k] as Record<string, unknown>
  }
  node[path[path.length - 1]] = value
}

function descend(
  root: Record<string, unknown>,
  path: string[],
  line: number,
): Record<string, unknown> {
  let node = root
  for (const k of path) {
    const next = node[k]
    if (next === undefined) {
      node[k] = {}
      node = node[k] as Record<string, unknown>
    } else if (Array.isArray(next)) {
      node = next[next.length - 1] as Record<string, unknown>
    } else if (typeof next === 'object' && next !== null) {
      node = next as Record<string, unknown>
    } else {
      throw new TomlError(`段头 "${path.join('.')}" 与已有键冲突`, line)
    }
  }
  return node
}

export function tomlToJson(src: string): unknown {
  const lines = scanLines(src)
  const root: Record<string, unknown> = {}
  /** 当前 [section] 对应的节点；普通行写在这里 */
  let current = root
  for (const tl of lines) {
    if (tl.section) {
      current = tl.append
        ? appendArrayTable(root, tl.section, tl.line)
        : descend(root, tl.section, tl.line)
      continue
    }
    setPath(current, tl.key, parseValue(tl.raw, tl.line), tl.line)
  }
  return root
}

function appendArrayTable(
  root: Record<string, unknown>,
  path: string[],
  line: number,
): Record<string, unknown> {
  const parent = descend(root, path.slice(0, -1), line)
  const last = path[path.length - 1]
  const arr = parent[last]
  if (arr === undefined) parent[last] = []
  else if (!Array.isArray(arr)) throw new TomlError(`"${path.join('.')}" 不是数组表`, line)
  const table: Record<string, unknown> = {}
  ;(parent[last] as unknown[]).push(table)
  return table
}

/* ================= JSON → TOML ================= */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function tomlKey(k: string): string {
  return BARE_KEY.test(k) ? k : JSON.stringify(k)
}

function tomlString(s: string): string {
  // 基本串 + 必要转义；含换行时用多行串更可读
  if (s.includes('\n')) return '"""\n' + s.replace(/\\/g, '\\\\') + '"""'
  return JSON.stringify(s)
}

function tomlScalar(v: unknown): string {
  if (v === null) return '""'
  if (typeof v === 'string') return tomlString(v)
  if (typeof v === 'number')
    return Number.isFinite(v) ? String(v) : v > 0 ? 'inf' : v < 0 ? '-inf' : 'nan'
  if (typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  return JSON.stringify(v)
}

/** 全是标量的对象可以写成行内表，数组同理 —— 控制输出行数 */
function isInlineValue(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(isInlineValue) && v.length <= 8
  if (isPlainObject(v)) return Object.values(v).every(isInlineValue)
  return typeof v !== 'function'
}

function tomlInline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(tomlInline).join(', ')}]`
  if (isPlainObject(v))
    return `{ ${Object.entries(v)
      .map(([k, x]) => `${tomlKey(k)} = ${tomlInline(x)}`)
      .join(', ')} }`
  return tomlScalar(v)
}

export function jsonToToml(value: unknown): string {
  if (!isPlainObject(value)) throw new TomlError('TOML 根必须是对象（JSON 对象）', 1)
  const lines: string[] = []
  writeTable(value, [], lines, false)
  return lines.join('\n') + '\n'
}

function writeTable(
  obj: Record<string, unknown>,
  path: string[],
  lines: string[],
  headerWritten: boolean,
): void {
  const scalars = Object.entries(obj).filter(
    ([, v]) => !isPlainObject(v) && !(Array.isArray(v) && v.some(isPlainObject)),
  )
  const tables = Object.entries(obj).filter(
    ([, v]) =>
      (isPlainObject(v) && Object.keys(v).length > 0) ||
      (Array.isArray(v) && v.some(isPlainObject)),
  )
  const emptyTables = Object.entries(obj).filter(
    ([, v]) =>
      (isPlainObject(v) && Object.keys(v).length === 0) ||
      (Array.isArray(v) && !v.some(isPlainObject) && v.length === 0),
  )

  if (
    path.length > 0 &&
    !headerWritten &&
    (scalars.length > 0 || emptyTables.length > 0 || tables.length > 0)
  ) {
    lines.push(`[${path.map(tomlKey).join('.')}]`)
  }
  for (const [k, v] of scalars) {
    lines.push(`${tomlKey(k)} = ${isInlineValue(v) ? tomlInline(v) : tomlScalar(v)}`)
  }
  for (const [k, v] of emptyTables) {
    if (Array.isArray(v)) lines.push(`${tomlKey(k)} = []`)
    else lines.push(`${tomlKey(k)} = {}`)
  }
  if (scalars.length > 0 && tables.length > 0) lines.push('')
  for (const [k, v] of tables) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (!isPlainObject(item)) throw new TomlError('数组表元素必须是对象', 1)
        lines.push(`[[${[...path, k].map(tomlKey).join('.')}]]`)
        writeTable(item, [...path, k], lines, true)
        lines.push('')
      }
    } else {
      lines.push('')
      writeTable(v as Record<string, unknown>, [...path, k], lines, false)
    }
  }
}

/* ================= CSV ================= */

export interface CsvOptions {
  /** 列分隔符，默认逗号；分号适合欧式 Excel 导出 */
  delimiter?: string
  /** 首行是否为表头，默认 true；false 时列名为 col1..colN */
  header?: boolean
}

export interface CsvTable {
  columns: string[]
  rows: Record<string, string>[]
}

/** 按 RFC 4180 解析：引号内可含分隔符/换行，"" 表示字面引号 */
export function csvParse(text: string, opts: CsvOptions = {}): string[][] {
  const delim = opts.delimiter ?? ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const src = text.replace(/^\uFEFF/, '')
  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delim) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export function csvToJson(text: string, opts: CsvOptions = {}): CsvTable {
  const grid = csvParse(text, opts)
  if (grid.length === 0) return { columns: [], rows: [] }
  const header = opts.header === false ? grid[0].map((_, i) => `col${i + 1}`) : grid[0]
  const columns = header.map((h, i) => h.trim() || `col${i + 1}`)
  const body = opts.header === false ? grid : grid.slice(1)
  const rows = body.map((r) => {
    const obj: Record<string, string> = {}
    columns.forEach((c, i) => {
      obj[c] = r[i] ?? ''
    })
    return obj
  })
  return { columns, rows }
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function jsonToCsv(rows: Record<string, unknown>[], opts: CsvOptions = {}): string {
  const delim = opts.delimiter ?? ','
  if (rows.length === 0) return ''
  const columns: string[] = []
  for (const r of rows) {
    for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k)
  }
  const escape = (s: string): string =>
    s.includes(delim) || s.includes('"') || s.includes('\n') || s.includes('\r')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  const lines = [columns.map(escape).join(delim)]
  for (const r of rows) {
    lines.push(columns.map((c) => escape(csvCell(r[c]))).join(delim))
  }
  return lines.join('\r\n') + '\r\n'
}
