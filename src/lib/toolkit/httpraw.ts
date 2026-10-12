/**
 * 原始 HTTP 请求解析与安全观察 —— 渲染进程与 MCP 共用的纯函数。
 *
 * 输入是从 Burp / 浏览器「复制为 cURL」上游、代理日志里拿到的原始请求文本，
 * 输出结构化的请求行 / 头 / Cookie / 参数，以及语言中立的安全观察点（id + 证据）。
 * 本模块不发起任何网络请求，只对粘贴的文本做本地分析。
 */

export interface RawHeader {
  name: string
  value: string
}

export type ParamLocation = 'query' | 'body' | 'cookie'

/** 参数名命中的攻击面标签 */
export type ParamTag = 'ssrf' | 'redirect' | 'lfi' | 'sqli' | 'xss' | 'ssti' | 'idor' | 'xxe'

export interface RawParam {
  location: ParamLocation
  name: string
  value: string
  tags: ParamTag[]
}

export interface ParsedRequest {
  method: string
  /** 原始 request target，如 /api?x=1 */
  target: string
  path: string
  query: string
  version: string
  headers: RawHeader[]
  body: string
  cookies: RawHeader[]
  params: RawParam[]
  contentType: string
}

export type ObservationLevel = 'info' | 'warn' | 'bad'

export interface Observation {
  id: string
  level: ObservationLevel
  /** 机器推导的证据：参数名 / 头名等，界面拼进双语模板 */
  evidence: string
}

export interface ParseResult {
  ok: boolean
  request?: ParsedRequest
  observations?: Observation[]
  error?: string
}

/** 请求/响应头空行切分（兼容 CRLF 与 LF） */
function splitHeadBody(raw: string): { head: string; body: string } {
  const crlf = raw.indexOf('\r\n\r\n')
  if (crlf >= 0) return { head: raw.slice(0, crlf), body: raw.slice(crlf + 4) }
  const lf = raw.indexOf('\n\n')
  if (lf >= 0) return { head: raw.slice(0, lf), body: raw.slice(lf + 2) }
  return { head: raw, body: '' }
}

function parseHeaderLine(line: string): RawHeader | null {
  const idx = line.indexOf(':')
  if (idx <= 0) return null
  const name = line.slice(0, idx).trim()
  const value = line.slice(idx + 1).trim()
  if (!name) return null
  return { name, value }
}

function splitQuery(query: string): [string, string][] {
  if (!query) return []
  const out: [string, string][] = []
  for (const pair of query.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const k = eq < 0 ? pair : pair.slice(0, eq)
    const v = eq < 0 ? '' : pair.slice(eq + 1)
    try {
      out.push([
        decodeURIComponent(k.replace(/\+/g, ' ')),
        decodeURIComponent(v.replace(/\+/g, ' ')),
      ])
    } catch {
      out.push([k, v])
    }
  }
  return out
}

function parseCookies(cookieHeader: string | undefined): RawHeader[] {
  if (!cookieHeader) return []
  return cookieHeader
    .split(';')
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq <= 0) return null
      return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() }
    })
    .filter((c): c is RawHeader => c !== null)
}

/* ---- 参数攻击面识别（只按名字特征给线索，不做结论） ---- */

const PARAM_PATTERNS: { re: RegExp; tag: ParamTag }[] = [
  {
    re: /^(url|uri|dest|destination|target|to|rurl|u|link|domain|host|site|from|proxy|fetch|web|open)$/,
    tag: 'ssrf',
  },
  {
    re: /^(redirect|redirect_?url|redirect_?to|next|return|return_?url|continue|goto|callback|callback_?url|back|redir|rurl|r2|location)$/,
    tag: 'redirect',
  },
  {
    re: /^(file|filename|filepath|path|page|template|include|inc|doc|document|folder|dir|load|read|root|conf|config)$/,
    tag: 'lfi',
  },
  { re: /^(id|uid|user_?id|account_?id|order_?id|no|num|pid|rid|gid)$/, tag: 'idor' },
  {
    re: /^(id|uid|user|name|q|query|search|keyword|kw|sort|order|orderby|filter|cat|class|p|page|select|where|table)$/,
    tag: 'sqli',
  },
  {
    re: /^(q|query|search|keyword|kw|name|msg|message|comment|content|text|title|term|html)$/,
    tag: 'xss',
  },
  { re: /^(template|tpl|view|theme|content|render|page)$/, tag: 'ssti' },
  { re: /^(xml|data)$/, tag: 'xxe' },
]

const SECRET_NAME =
  /^(password|passwd|pwd|secret|token|access_?token|refresh_?token|id_?token|api_?key|apikey|key|signature|sig|auth|authorization|private_?key)$/

function tagsForParam(name: string): ParamTag[] {
  const n = name.toLowerCase()
  const tags: ParamTag[] = []
  for (const { re, tag } of PARAM_PATTERNS) {
    if (re.test(n) && !tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** 从 body 里提参数：表单 / JSON（顶层及一层嵌套）/ multipart 字段 */
function parseBodyParams(body: string, contentType: string): RawParam[] {
  if (!body) return []
  const ct = contentType.toLowerCase()
  if (ct.includes('application/x-www-form-urlencoded')) {
    return splitQuery(body.trim()).map(([name, value]) => ({
      location: 'body',
      name,
      value,
      tags: tagsForParam(name),
    }))
  }
  if (ct.includes('application/json')) {
    try {
      const data = JSON.parse(body)
      const out: RawParam[] = []
      const walk = (obj: unknown, prefix: string, depth: number): void => {
        if (obj === null || typeof obj !== 'object' || depth > 1) {
          out.push({
            location: 'body',
            name: prefix,
            value: scalarPreview(obj),
            tags: tagsForParam(prefix),
          })
          return
        }
        if (Array.isArray(obj)) {
          obj.slice(0, 50).forEach((v, i) => walk(v, `${prefix}[${i}]`, depth + 1))
          return
        }
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          const name = prefix ? `${prefix}.${k}` : k
          walk(v, name, depth + 1)
        }
      }
      walk(data, '', 0)
      return out
    } catch {
      return []
    }
  }
  // boundary 区分大小写，必须用原始 contentType 提取（ct 已被小写化）
  const m = contentType.match(/multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i)
  if (m) {
    const boundary = (m[1] ?? m[2]).trim()
    const out: RawParam[] = []
    for (const part of body.split(`--${boundary}`)) {
      const nameM = /name="([^"]*)"/.exec(part)
      if (!nameM) continue
      const blank = part.indexOf('\r\n\r\n')
      const value = blank >= 0 ? part.slice(blank + 4).replace(/\r\n$/, '') : ''
      out.push({
        location: 'body',
        name: nameM[1],
        value: scalarPreview(value),
        tags: tagsForParam(nameM[1]),
      })
    }
    return out
  }
  return []
}

function scalarPreview(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function parseRawRequest(raw: string): ParseResult {
  if (!raw.trim()) return { ok: false, error: 'EMPTY' }
  const { head, body } = splitHeadBody(raw.replace(/^\s+/, ''))
  const lines = head.split(/\r?\n/)
  const requestLine = lines.shift() ?? ''
  const parts = requestLine.trim().split(/\s+/)
  if (parts.length < 2) return { ok: false, error: 'BAD_REQUEST_LINE' }
  const [method, target, version] = parts
  // 方法是大写 token；目标以 / 、http(s):// 或绝对源（OPTIONS *）开头；
  // 出现版本时必须形如 HTTP/1.1 —— 用来把普通文本挡在门外。
  const methodOk = /^[A-Z][A-Z0-9-]{1,19}$/.test(method)
  const targetOk = /^(\/|https?:\/\/|\*$)/i.test(target)
  const versionOk = version === undefined || /^HTTP\/\d(\.\d)?$/.test(version)
  if (!methodOk || !targetOk || !versionOk) return { ok: false, error: 'BAD_REQUEST_LINE' }

  const headers: RawHeader[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const h = parseHeaderLine(line)
    if (h) headers.push(h)
  }
  const hmap = new Map(headers.map((h) => [h.name.toLowerCase(), h.value]))
  const qIdx = target.indexOf('?')
  const path = qIdx < 0 ? target : target.slice(0, qIdx)
  const query = qIdx < 0 ? '' : target.slice(qIdx + 1)
  const contentType = hmap.get('content-type') ?? ''
  const cookies = parseCookies(hmap.get('cookie'))

  const params: RawParam[] = [
    ...splitQuery(query).map(([name, value]) => ({
      location: 'query' as const,
      name,
      value,
      tags: tagsForParam(name),
    })),
    ...cookies.map((c) => ({
      location: 'cookie' as const,
      name: c.name,
      value: c.value,
      tags: tagsForParam(c.name),
    })),
    ...parseBodyParams(body, contentType),
  ]

  const request: ParsedRequest = {
    method,
    target,
    path,
    query,
    version: version ?? 'HTTP/1.1',
    headers,
    body,
    cookies,
    params,
    contentType,
  }
  return { ok: true, request, observations: observe(request) }
}

/* ---- 安全观察：只给证据与线索，是否可利用由使用者在授权范围内验证 ---- */

const SPOOF_HEADERS = new Set([
  'x-forwarded-for',
  'x-real-ip',
  'client-ip',
  'x-client-ip',
  'true-client-ip',
  'forwarded-for',
  'x-forwarded',
  'x-cluster-client-ip',
])

const HOST_OVERRIDE = new Set([
  'x-forwarded-host',
  'x-forwarded-server',
  'x-http-host-override',
  'forwarded',
  'host',
])

export function observe(req: ParsedRequest): Observation[] {
  const obs: Observation[] = []
  const hmap = new Map(req.headers.map((h) => [h.name.toLowerCase(), h.value]))

  // 1. 认证凭据
  const auth = hmap.get('authorization')
  if (auth) {
    const scheme = /^([a-zA-Z]+)/.exec(auth)?.[1].toLowerCase() ?? 'unknown'
    obs.push({ id: 'auth.header', level: 'info', evidence: scheme })
  }
  if (req.cookies.some((c) => /session|token|sid|jwt|auth/i.test(c.name))) {
    obs.push({
      id: 'auth.cookie',
      level: 'info',
      evidence: req.cookies.map((c) => c.name).join(', '),
    })
  }
  for (const name of ['x-api-key', 'proxy-authorization']) {
    if (hmap.has(name)) obs.push({ id: 'auth.custom', level: 'info', evidence: name })
  }

  // 2. 参数攻击面
  for (const p of req.params) {
    for (const tag of p.tags) {
      obs.push({ id: `param.${tag}`, level: 'warn', evidence: `${p.location}:${p.name}` })
    }
    if (SECRET_NAME.test(p.name.toLowerCase())) {
      obs.push({ id: 'secret.in.param', level: 'bad', evidence: `${p.location}:${p.name}` })
    }
  }

  // 3. 伪造面：IP / Host 头
  for (const h of req.headers) {
    const n = h.name.toLowerCase()
    if (SPOOF_HEADERS.has(n)) obs.push({ id: 'spoof.ip', level: 'info', evidence: h.name })
    if (HOST_OVERRIDE.has(n) && n !== 'host')
      obs.push({ id: 'spoof.host', level: 'info', evidence: h.name })
  }

  // 4. body 有内容但没声明 Content-Type
  if (req.body.trim() && !req.contentType)
    obs.push({ id: 'body.noContentType', level: 'info', evidence: '' })

  // 5. XML body → XXE 面
  if (/xml/i.test(req.contentType) || /^\s*<\?xml/.test(req.body)) {
    obs.push({ id: 'body.xml', level: 'warn', evidence: req.contentType || 'xml prolog' })
  }

  // 去重（同一 id + evidence 只保留一条，级别取最高）
  const rank: Record<ObservationLevel, number> = { info: 0, warn: 1, bad: 2 }
  const dedup = new Map<string, Observation>()
  for (const o of obs) {
    const key = `${o.id}|${o.evidence}`
    const prev = dedup.get(key)
    if (!prev || rank[o.level] > rank[prev.level]) dedup.set(key, o)
  }
  return [...dedup.values()].sort((a, b) => rank[b.level] - rank[a.level])
}

/* ================= 请求差异对比（工具5） ================= */

export interface FieldDiff {
  kind: 'method' | 'path' | 'header' | 'body'
  name?: string
  before: string
  after: string
  change: 'added' | 'removed' | 'changed'
}

export function diffRequests(a: ParsedRequest, b: ParsedRequest): FieldDiff[] {
  const out: FieldDiff[] = []
  if (a.method !== b.method)
    out.push({ kind: 'method', before: a.method, after: b.method, change: 'changed' })
  if (a.target !== b.target)
    out.push({ kind: 'path', before: a.target, after: b.target, change: 'changed' })

  const ha = new Map(a.headers.map((h) => [h.name.toLowerCase(), h]))
  const hb = new Map(b.headers.map((h) => [h.name.toLowerCase(), h]))
  for (const [k, hv] of ha) {
    if (!hb.has(k))
      out.push({ kind: 'header', name: hv.name, before: hv.value, after: '', change: 'removed' })
    else if (hb.get(k)!.value !== hv.value)
      out.push({
        kind: 'header',
        name: hv.name,
        before: hv.value,
        after: hb.get(k)!.value,
        change: 'changed',
      })
  }
  for (const [k, hv] of hb) {
    if (!ha.has(k))
      out.push({ kind: 'header', name: hv.name, before: '', after: hv.value, change: 'added' })
  }
  if (a.body !== b.body)
    out.push({ kind: 'body', before: a.body, after: b.body, change: 'changed' })
  return out
}
