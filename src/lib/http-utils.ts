/**
 * HTTP 客户端与流量分析共用的纯函数工具
 * 只做数据转换，不依赖 React / i18n，便于单独验证。
 */

export function b64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function textToB64(text: string): string {
  return bytesToB64(new TextEncoder().encode(text))
}

/** 从 Content-Type 里取字符集，拿不到或不被支持时回落 utf-8 */
export function detectCharset(contentType?: string | null): string {
  const m = (contentType ?? '').match(/charset\s*=\s*"?([\w-]+)"?/i)
  const label = m?.[1]?.toLowerCase() ?? 'utf-8'
  try {
    new TextDecoder(label)
    return label
  } catch {
    return 'utf-8'
  }
}

export function bytesToText(bytes: Uint8Array, charset = 'utf-8'): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** 统计控制字符与非 ASCII 比例，判断是否值得按文本展示 */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  const sample = bytes.subarray(0, 2048)
  let bad = 0
  for (const b of sample) {
    if (b === 0) return true
    if (b < 9 || (b > 13 && b < 32)) bad++
  }
  return bad / sample.length > 0.08
}

export function hexDump(bytes: Uint8Array, limit = 4096): string {
  const view = bytes.subarray(0, limit)
  const lines: string[] = []
  for (let i = 0; i < view.length; i += 16) {
    const row = view.subarray(i, i + 16)
    const hex = Array.from(row).map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = Array.from(row).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`)
  }
  if (bytes.length > limit) lines.push(`… 共 ${bytes.length} 字节，仅展示前 ${limit} 字节`)
  return lines.join('\n')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function formatTime(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function prettyJson(text: string): string | null {
  const t = text.trim()
  if (!t || !/^[[{]/.test(t)) return null
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return null
  }
}

export function headerValueOf(headers: [string, string][], name: string): string | null {
  const hit = headers.find(([k]) => k.toLowerCase() === name.toLowerCase())
  return hit ? hit[1] : null
}

export function hasHeader(headers: [string, string][], name: string): boolean {
  return headers.some(([k]) => k.toLowerCase() === name.toLowerCase())
}

export type StatusClass = 'ok' | 'redirect' | 'client' | 'server' | 'none'

export function statusClass(status: number | null): StatusClass {
  if (status == null || status === 0) return 'none'
  if (status < 300) return 'ok'
  if (status < 400) return 'redirect'
  if (status < 500) return 'client'
  return 'server'
}

export function statusColorClass(status: number | null): string {
  switch (statusClass(status)) {
    case 'ok': return 'text-phosphor'
    case 'redirect': return 'text-amber'
    case 'client': return 'text-danger'
    case 'server': return 'text-danger'
    default: return 'text-muted'
  }
}

export interface CookieInfo {
  name: string
  value: string
  attrs: string[]
}

export function parseSetCookies(headers: [string, string][]): CookieInfo[] {
  return headers
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .map(([, v]) => {
      const segs = v.split(';').map((s) => s.trim()).filter(Boolean)
      const first = segs[0] ?? ''
      const eq = first.indexOf('=')
      return {
        name: eq > 0 ? first.slice(0, eq) : first,
        value: eq > 0 ? first.slice(eq + 1) : '',
        attrs: segs.slice(1),
      }
    })
}

/* ================= 查询参数 <-> URL ================= */

export interface QueryRow {
  id: string
  name: string
  value: string
  enabled: boolean
}

export function newRowId(): string {
  return `r${Math.random().toString(36).slice(2, 9)}`
}

/** 解析 URL 查询串为可编辑行；重复参数名会原样保留 */
export function queryRows(url: string): QueryRow[] {
  const q = url.indexOf('?')
  if (q < 0) return []
  const raw = url.slice(q + 1).split('#')[0]
  if (!raw) return []
  return raw.split('&').filter(Boolean).map((pair) => {
    const i = pair.indexOf('=')
    const name = i >= 0 ? pair.slice(0, i) : pair
    const value = i >= 0 ? pair.slice(i + 1) : ''
    let decodedName = name
    let decodedValue = value
    try { decodedName = decodeURIComponent(name.replace(/\+/g, ' ')) } catch { /* 保留原文 */ }
    try { decodedValue = decodeURIComponent(value.replace(/\+/g, ' ')) } catch { /* 保留原文 */ }
    return { id: newRowId(), name: decodedName, value: decodedValue, enabled: true }
  })
}

/** 用编辑后的行重写 URL（保留路径与锚点） */
export function applyQueryRows(url: string, rows: QueryRow[]): string {
  const hashAt = url.indexOf('#')
  const hash = hashAt >= 0 ? url.slice(hashAt) : ''
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url
  const q = noHash.indexOf('?')
  const base = q >= 0 ? noHash.slice(0, q) : noHash
  const pairs = rows
    .filter((r) => r.enabled && (r.name || r.value))
    .map((r) => `${encodeURIComponent(r.name)}=${encodeURIComponent(r.value)}`)
  return `${base}${pairs.length ? `?${pairs.join('&')}` : ''}${hash}`
}

export function buildQueryRows(rows: QueryRow[]): string {
  return rows
    .filter((r) => r.enabled && (r.name || r.value))
    .map((r) => `${encodeURIComponent(r.name)}=${encodeURIComponent(r.value)}`)
    .join('&')
}

/* ================= cURL 生成 ================= */

export interface CurlInput {
  method: string
  url: string
  headers: [string, string][]
  bodyText?: string | null
  followRedirects?: boolean
  verifyTls?: boolean
  proxy?: string | null
}

export function buildCurl(o: CurlInput): string {
  const parts = ['curl', `-X ${o.method}`]
  if (o.followRedirects) parts.push('-L')
  if (o.verifyTls === false) parts.push('-k')
  if (o.proxy) parts.push(`--proxy ${shellQuote(o.proxy)}`)
  parts.push(shellQuote(o.url))
  for (const [k, v] of o.headers) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`)
  if (o.bodyText) parts.push(`--data-raw ${shellQuote(o.bodyText)}`)
  return parts.join(' \\\n  ')
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/* ================= 代码片段 ================= */

export function buildFetchSnippet(o: CurlInput): string {
  const headers: Record<string, string> = {}
  for (const [k, v] of o.headers) headers[k] = v
  const init: string[] = [`  method: ${JSON.stringify(o.method)}`]
  if (Object.keys(headers).length) init.push(`  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')}`)
  if (o.bodyText) init.push(`  body: ${JSON.stringify(o.bodyText)}`)
  return `const res = await fetch(${JSON.stringify(o.url)}, {\n${init.join(',\n')}\n})\nconsole.log(res.status, await res.text())`
}

export function buildPythonSnippet(o: CurlInput): string {
  const headerLines = o.headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')
  const lines = [
    'import requests',
    '',
    `url = ${JSON.stringify(o.url)}`,
    'headers = {',
    headerLines,
    '}',
  ]
  if (o.bodyText) lines.push(`data = ${JSON.stringify(o.bodyText)}`)
  lines.push(`r = requests.${o.method.toLowerCase()}(${o.bodyText ? 'url, headers=headers, data=data' : 'url, headers=headers'}${o.verifyTls === false ? ', verify=False' : ''})`)
  lines.push('print(r.status_code, r.text)')
  return lines.join('\n')
}

export function buildNodeSnippet(o: CurlInput): string {
  const headers = o.headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')
  return [
    `const res = await fetch(${JSON.stringify(o.url)}, {`,
    `  method: ${JSON.stringify(o.method)},`,
    '  headers: {',
    headers,
    '  },',
    ...(o.bodyText ? [`  body: ${JSON.stringify(o.bodyText)},`] : []),
    '})',
    'console.log(res.status, await res.text())',
  ].join('\n')
}

/* ================= 本地存储 ================= */

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* 配额或隐私模式，忽略 */ }
}
