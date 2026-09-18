/**
 * 网络与权限相关计算 —— 渲染进程与 MCP 服务端共用。
 * 覆盖：IPv4 ⇄ 整数、CIDR 子网信息、chmod、URL 拆解、Cookie 解析、User-Agent 解析。
 */

export interface Ipv4Options {
  /** 严格模式拒绝前导零（`01.2.3.4`），与子网计算器保持一致 */
  strict?: boolean
}

export function parseIpv4(ip: string, opts: Ipv4Options = {}): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (opts.strict) {
      const v = parseInt(p)
      if (Number.isNaN(v) || v < 0 || v > 255 || String(v) !== p.trim()) return null
      n = (n << 8) | v
    } else {
      if (!/^\d{1,3}$/.test(p)) return null
      const v = parseInt(p)
      if (v > 255) return null
      n = n * 256 + v
    }
  }
  return n >>> 0
}

export function intToIpv4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export interface IpEquivalents {
  ip: string
  decimal: number
  hex: string
  octal: string
  dottedHex: string
  dottedOctal: string
}

/** 把 IPv4 / 十进制 / 十六进制 / 八进制表示统一成各种等价写法 */
export function ipConvert(input: string): IpEquivalents {
  const t = input.trim()
  if (!t) throw new Error('EMPTY_INPUT')
  let n: number | null = null
  if (/^\d+$/.test(t)) n = parseInt(t) >>> 0
  else if (/^0x[0-9a-f]+$/i.test(t)) n = parseInt(t, 16) >>> 0
  else if (/^0[0-7]+$/.test(t)) n = parseInt(t, 8) >>> 0
  else n = parseIpv4(t)
  if (n === null || n > 0xFFFFFFFF) throw new Error('INVALID_IPV4')
  const ip = intToIpv4(n)
  return {
    ip,
    decimal: n,
    hex: '0x' + n.toString(16).padStart(8, '0').toUpperCase(),
    octal: '0' + n.toString(8),
    dottedHex: ip.split('.').map((o) => '0x' + parseInt(o).toString(16).padStart(2, '0')).join('.'),
    dottedOctal: ip.split('.').map((o) => '0' + parseInt(o).toString(8).padStart(3, '0')).join('.'),
  }
}

export interface CidrInfo {
  ip: string
  cidr: number
  mask: string
  wildcard: string
  network: string
  broadcast: string
  firstHost: string
  lastHost: string
  hosts: number
  ipClass: 'A' | 'B' | 'C' | 'D' | 'E'
  isPrivate: boolean
  binMask: string
}

export function cidrInfo(input: string): CidrInfo {
  const m = input.trim().match(/^([\d.]+)\s*\/\s*(\d{1,2})$/)
  if (!m) throw new Error('BAD_CIDR_FORMAT')
  const ip = parseIpv4(m[1], { strict: true })
  const cidr = parseInt(m[2])
  if (ip === null || cidr < 0 || cidr > 32) throw new Error('BAD_CIDR')
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0
  const network = (ip & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const hosts = cidr >= 31 ? (cidr === 31 ? 2 : 1) : Math.max(broadcast - network - 1, 0)
  const maskStr = intToIpv4(mask)
  return {
    ip: intToIpv4(ip),
    cidr,
    mask: maskStr,
    wildcard: intToIpv4(~mask >>> 0),
    network: intToIpv4(network),
    broadcast: intToIpv4(broadcast),
    firstHost: cidr >= 31 ? intToIpv4(network) : intToIpv4(network + 1),
    lastHost: cidr >= 31 ? intToIpv4(broadcast) : intToIpv4(broadcast - 1),
    hosts,
    ipClass: (ip >>> 24) < 128 ? 'A' : (ip >>> 24) < 192 ? 'B' : (ip >>> 24) < 224 ? 'C' : (ip >>> 24) < 240 ? 'D' : 'E',
    isPrivate: (ip >>> 24) === 10 || ((ip >>> 20) & 0xfff) === 0xac1 || (ip >>> 16) === 0xc0a8,
    binMask: maskStr.split('.').map((o) => parseInt(o).toString(2).padStart(8, '0')).join('.'),
  }
}

const PRIVATE_RANGES: [number, number][] = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
]

/** 该 IP 是否落在私有 / 保留网段（SSRF 判断、送模型前脱敏常用） */
export function isPrivateIp(ip: string): boolean {
  const n = parseIpv4(ip)
  if (n === null) return false
  return PRIVATE_RANGES.some(([lo, hi]) => n >= lo && n <= hi)
}

export interface ChmodEntry {
  /** 三位八进制，如 755 */
  octal: string
  /** 符号表示，如 rwxr-xr-x */
  symbolic: string
}

const CHMOD_BITS = ['ur', 'uw', 'ux', 'gr', 'gw', 'gx', 'or', 'ow', 'ox'] as const
export type ChmodBit = (typeof CHMOD_BITS)[number]
export type ChmodPerm = Record<ChmodBit, boolean>

export function chmodFromBits(perm: ChmodPerm): ChmodEntry {
  const digit = (r: boolean, w: boolean, x: boolean): number => (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0)
  const octal = `${digit(perm.ur, perm.uw, perm.ux)}${digit(perm.gr, perm.gw, perm.gx)}${digit(perm.or, perm.ow, perm.ox)}`
  const symbolic = ['u', 'g', 'o']
    .map((_, i) => {
      const r = i === 0 ? perm.ur : i === 1 ? perm.gr : perm.or
      const w = i === 0 ? perm.uw : i === 1 ? perm.gw : perm.ow
      const x = i === 0 ? perm.ux : i === 1 ? perm.gx : perm.ox
      return `${r ? 'r' : '-'}${w ? 'w' : '-'}${x ? 'x' : '-'}`
    })
    .join('')
  return { octal, symbolic }
}

export function chmodFromOctal(v: string): ChmodPerm {
  if (!/^[0-7]{3}$/.test(v)) throw new Error('BAD_OCTAL')
  const d = v.split('').map(Number)
  return {
    ur: !!(d[0] & 4), uw: !!(d[0] & 2), ux: !!(d[0] & 1),
    gr: !!(d[1] & 4), gw: !!(d[1] & 2), gx: !!(d[1] & 1),
    or: !!(d[2] & 4), ow: !!(d[2] & 2), ox: !!(d[2] & 1),
  }
}

export function chmodConvert(input: string): ChmodEntry {
  const t = input.trim()
  if (/^[0-7]{3}$/.test(t)) return chmodFromBits(chmodFromOctal(t))
  const m = t.match(/^([r-][w-][x-]){3}$/)
  if (!m) throw new Error('BAD_CHMOD')
  const on = (c: string): boolean => c !== '-'
  const [u, g, o] = [t.slice(0, 3), t.slice(3, 6), t.slice(6, 9)]
  return chmodFromBits({
    ur: on(u[0]), uw: on(u[1]), ux: on(u[2]),
    gr: on(g[0]), gw: on(g[1]), gx: on(g[2]),
    or: on(o[0]), ow: on(o[1]), ox: on(o[2]),
  })
}

export interface ParsedUrl {
  protocol: string
  username: string
  password: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  params: { k: string; v: string }[]
}

export function parseUrl(input: string): ParsedUrl {
  const t = input.trim()
  if (!t) throw new Error('EMPTY_INPUT')
  let u: URL
  try {
    u = new URL(t.includes('://') ? t : 'http://' + t)
  } catch {
    throw new Error('INVALID_URL')
  }
  const params: { k: string; v: string }[] = []
  u.searchParams.forEach((v, k) => params.push({ k, v }))
  return {
    protocol: u.protocol.replace(':', ''),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : ''),
    pathname: decodeURIComponent(u.pathname),
    search: u.search,
    hash: decodeURIComponent(u.hash.replace(/^#/, '')),
    params,
  }
}

export interface CookieAttr {
  k: string
  v: string
  /** 无值属性（Secure / HttpOnly），渲染时只显示名字 */
  flag: boolean
}

export interface ParsedCookie {
  cookie: { name: string; value: string } | null
  attrs: CookieAttr[]
}

export function parseCookie(input: string): ParsedCookie {
  const t = input.trim()
  if (!t) throw new Error('EMPTY_INPUT')
  const segs = t.split(';').map((s) => s.trim()).filter(Boolean)
  if (!segs.length) throw new Error('EMPTY_INPUT')
  const first = segs[0]
  const eq = first.indexOf('=')
  const cookie = eq > 0 ? { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() } : null
  const attrs = segs.slice(cookie ? 1 : 0).map((s) => {
    const i = s.indexOf('=')
    return {
      k: (i > 0 ? s.slice(0, i) : s).trim().toLowerCase(),
      v: i > 0 ? s.slice(i + 1).trim() : '',
      flag: i <= 0,
    }
  })
  return { cookie, attrs }
}

export interface UaInfo {
  browser: string
  version: string
  os: string
  /** 结构化设备类型，界面自行本地化文案 */
  device: 'desktop' | 'mobile' | 'tablet'
  bot: string | null
}

export function parseUserAgent(ua: string): UaInfo {
  const t = ua
  let bot: string | null = null
  const botMatch = t.match(/(Googlebot|Bingbot|Baiduspider|YandexBot|DuckDuckBot|Slurp|Sogou|Bytespider|GPTBot|ClaudeBot|curl|wget|python-requests|PostmanRuntime|sqlmap|nmap|Nikto|masscan|Go-http-client)/i)
  if (botMatch) bot = botMatch[1]

  let browser = ''
  let version = ''
  const rules: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
    [/MSIE ([\d.]+)/, 'IE'],
    [/Trident.*rv:([\d.]+)/, 'IE'],
    [/MicroMessenger\/([\d.]+)/, 'WeChat'],
    [/CriOS\/([\d.]+)/, 'Chrome (iOS)'],
    [/curl\/([\d.]+)/, 'curl'],
    [/python-requests\/([\d.]+)/, 'python-requests'],
  ]
  for (const [re, name] of rules) {
    const m = t.match(re)
    if (m) { browser = name; version = m[1]; break }
  }

  let os = ''
  if (/Windows NT 10/.test(t)) os = 'Windows 10/11'
  else if (/Windows NT 6\.3/.test(t)) os = 'Windows 8.1'
  else if (/Windows NT 6\.1/.test(t)) os = 'Windows 7'
  else if (/iPhone|iPod/.test(t)) {
    const m = t.match(/OS ([\d_]+)/)
    os = 'iOS (iPhone)' + (m ? ' ' + m[1].replace(/_/g, '.') : '')
  } else if (/iPad/.test(t)) os = 'iOS (iPad)'
  else if (/Android ([\d.]+)/.test(t)) os = 'Android ' + t.match(/Android ([\d.]+)/)![1]
  else if (/Mac OS X ([\d_]+)/.test(t)) os = 'macOS ' + t.match(/Mac OS X ([\d_]+)/)![1].replace(/_/g, '.')
  else if (/Linux/.test(t)) os = 'Linux'

  let device: UaInfo['device'] = 'desktop'
  if (/Mobile|iPhone|Android.*Mobile/.test(t)) device = 'mobile'
  else if (/iPad|Tablet|Android(?!.*Mobile)/.test(t)) device = 'tablet'

  return { browser, version, os, device, bot }
}
