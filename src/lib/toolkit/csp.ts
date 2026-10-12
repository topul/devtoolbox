/**
 * Content-Security-Policy 静态分析 —— 纯函数。
 *
 * 输入一条 CSP 头值（或 meta 内容），逐条解释指令并标记危险来源。
 * 只分析策略文本本身，不判断页面实际是否内联脚本（那需要跑起来才知道）。
 */

export type CspSeverity = 'bad' | 'warn' | 'info' | 'ok'

export interface CspDirective {
  name: string
  /** 小写后的完整值（'self' 等保留引号） */
  value: string
  sources: string[]
}

export interface CspFinding {
  id: string
  severity: CspSeverity
  /** 触发的指令名 */
  directive: string
  /** 触发证据：具体 source 或原始片段 */
  evidence: string
}

export interface CspResult {
  ok: boolean
  error?: string
  directives: CspDirective[]
  findings: CspFinding[]
  /** 所有指令里出现过的来源并集，便于看白名单全貌 */
  sources: string[]
}

/** 已知可被 JSONP / 任意用户内容利用、放进 script-src 等于白给的主机（同源方案） */
const JSONP_HOSTS: { host: string; id: string }[] = [
  { host: 'ajax.googleapis.com', id: 'jsonp.googleapis' },
  { host: 'www.google.com', id: 'jsonp.google' },
  { host: 'ssl.google-analytics.com', id: 'jsonp.googleanalytics' },
  { host: 'www.google-analytics.com', id: 'jsonp.googleanalytics' },
  { host: 'googletagmanager.com', id: 'jsonp.gtm' },
  { host: 'cdn.jsdelivr.net', id: 'usercontent.jsdelivr' },
]

const FETCH_DIRECTIVES = new Set([
  'default-src',
  'script-src',
  'script-src-elem',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'media-src',
  'object-src',
  'frame-src',
  'child-src',
  'worker-src',
  'manifest-src',
  'frame-ancestors',
  'form-action',
  'base-uri',
  'navigate-to',
])

export function parseCsp(raw: string): { directives: CspDirective[]; sources: string[] } {
  const directives: CspDirective[] = []
  const sourceSet = new Set<string>()
  for (const part of raw.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const name = tokens[0].toLowerCase()
    const sources = tokens.slice(1)
    directives.push({ name, value: sources.join(' '), sources })
    for (const s of sources) sourceSet.add(s)
  }
  return { directives, sources: [...sourceSet] }
}

function findDirective(directives: CspDirective[], ...names: string[]): CspDirective | undefined {
  for (const n of names) {
    const d = directives.find((x) => x.name === n)
    if (d) return d
  }
  return undefined
}

/** script 实际生效的来源：script-src-elem > script-src > default-src */
function effectiveScript(d: CspDirective[]): CspDirective | undefined {
  return findDirective(d, 'script-src-elem', 'script-src', 'default-src')
}

export function analyzeCsp(raw: string): CspResult {
  const text = raw.trim()
  if (!text) return { ok: false, error: 'EMPTY', directives: [], findings: [], sources: [] }

  const { directives, sources } = parseCsp(text)
  if (directives.length === 0)
    return { ok: false, error: 'NO_DIRECTIVE', directives: [], findings: [], sources: [] }

  const findings: CspFinding[] = []
  const add = (id: string, severity: CspSeverity, directive: string, evidence: string): void => {
    findings.push({ id, severity, directive, evidence })
  }

  const unknown = directives.filter(
    (d) => !FETCH_DIRECTIVES.has(d.name) && !d.name.endsWith('-src'),
  )
  for (const d of unknown) add('directive.unknown', 'info', d.name, d.value)

  // ---- 脚本来源是 CSP 的核心 ----
  const script = effectiveScript(directives)
  if (!script) {
    add('script.fallbackNone', 'bad', 'default-src', '')
  } else {
    if (script.sources.includes("'unsafe-inline'"))
      add('script.unsafeInline', 'bad', script.name, "'unsafe-inline'")
    if (script.sources.includes("'unsafe-eval'"))
      add('script.unsafeEval', 'warn', script.name, "'unsafe-eval'")
    if (script.sources.includes('*')) add('script.wildcard', 'bad', script.name, '*')
    if (script.sources.includes('data:')) add('script.dataUri', 'bad', script.name, 'data:')
    if (script.sources.includes('http:')) add('script.schemeHttp', 'bad', script.name, 'http:')
    if (script.sources.includes('https:')) add('script.schemeHttps', 'warn', script.name, 'https:')
    if (script.sources.some((s) => s === "'strict-dynamic'"))
      add('script.strictDynamic', 'ok', script.name, "'strict-dynamic'")
    for (const s of script.sources) {
      const host = s
        .replace(/^\*\./, '')
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .toLowerCase()
      for (const j of JSONP_HOSTS) {
        if (host === j.host || host.endsWith('.' + j.host)) add(j.id, 'warn', script.name, s)
      }
      if (s.startsWith('*.')) add('script.wildcardSubdomain', 'warn', script.name, s)
    }
    // nonce / hash 是推荐路线
    if (script.sources.some((s) => /^'nonce-/.test(s) || /^'sha(256|384|512)-/.test(s))) {
      add('script.nonceOrHash', 'ok', script.name, '')
    }
  }

  // ---- style 里 unsafe-inline 影响小很多（绝大多数站点都需要） ----
  const style = findDirective(directives, 'style-src-elem', 'style-src', 'default-src')
  if (style?.sources.includes('*')) add('style.wildcard', 'info', style.name, '*')

  // ---- object-src：插件嵌入，建议直接 none ----
  const object = findDirective(directives, 'object-src', 'default-src')
  if (!object) add('object.missing', 'warn', 'object-src', '')
  else if (!object.sources.includes("'none'"))
    add('object.notNone', 'info', object.name, object.value)

  // ---- base-uri：防 <base> 劫持相对路径脚本 ----
  if (!findDirective(directives, 'base-uri')) add('baseUri.missing', 'warn', 'base-uri', '')

  // ---- frame-ancestors：防点击劫持（比 X-Frame-Options 更现代） ----
  if (!findDirective(directives, 'frame-ancestors'))
    add('frameAncestors.missing', 'warn', 'frame-ancestors', '')

  // ---- form-action：防表单外提 ----
  if (!findDirective(directives, 'form-action'))
    add('formAction.missing', 'info', 'form-action', '')

  // ---- 部署形态提示 ----
  if (!findDirective(directives, 'upgrade-insecure-requests'))
    add('deploy.noUpgrade', 'info', 'upgrade-insecure-requests', '')
  if (!findDirective(directives, 'default-src'))
    add('defaultSrc.missing', 'info', 'default-src', '')

  // 报告类
  if (findDirective(directives, 'report-to', 'report-uri'))
    add('deploy.reporting', 'ok', 'report', '')

  // 严重度排序：bad > warn > info > ok
  const rank: Record<CspSeverity, number> = { bad: 0, warn: 1, info: 2, ok: 3 }
  findings.sort((a, b) => rank[a.severity] - rank[b.severity])
  return { ok: true, directives, findings, sources }
}
