/**
 * SSRF URL 变体生成 —— 纯函数。
 *
 * 给定一个目标 URL（或内部主机），生成一批语义等价但写法不同的形式，
 * 每类变体标注它针对的弱校验类型。用于在授权靶场上验证自家服务的
 * URL 白名单 / 黑名单 / DNS 解析逻辑是否可绕过。不发起任何请求。
 */

export type SsrfCategory =
  | 'notation' // 进制 / 省略写法
  | 'ipv6' // IPv6 映射地址
  | 'userinfo' // @ 用户信息段混淆
  | 'dot' // 结尾点 / 多余点
  | 'encoding' // URL 编码
  | 'wildcard' // 0.0.0.0 类
  | 'dns' // 需要 DNS 的公共解析形式

export interface SsrfVariant {
  category: SsrfCategory
  /** 等价目标的呈现形式（host 部分或完整 URL） */
  value: string
  /** 针对的弱校验，语言中立 id */
  bypassId: string
}

export interface SsrfResult {
  ok: boolean
  error?: string
  variants: SsrfVariant[]
  /** 解析出的目标主机 */
  host: string
  /** 是否 IPv4（决定能否生成进制类变体） */
  isIpv4: boolean
}

/** 点分十进制 → 32 位无符号整数 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = Number(p)
    if (!Number.isInteger(v) || v < 0 || v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

/** 32 位整数 → 点分十进制 */
function intToIpv4(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 0xff).join('.')
}

/** IPv4 的全部点分形式：十进制 / 0x 十六进制 / 0 八进制，逐 octet 混合 */
function dottedForms(ip: string): string[] {
  const octets = ip.split('.').map((o) => Number(o))
  const forms: string[] = []
  // 全十进制（原值）
  forms.push(octets.join('.'))
  // 全十六进制
  forms.push(octets.map((o) => '0x' + o.toString(16)).join('.'))
  // 全八进制（补齐 3 位与不补齐两种）
  forms.push(octets.map((o) => '0' + o.toString(8).padStart(3, '0')).join('.'))
  forms.push(octets.map((o) => '0' + o.toString(8)).join('.'))
  // 混合：最后一段十进制长整的常见形态 127.1
  forms.push(`${octets[0]}.${((octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0}`)
  // 混合：hex 头两段 + dec 后两段
  forms.push(`0x${octets[0].toString(16)}.0x${octets[1].toString(16)}.${octets[2]}.${octets[3]}`)
  return [...new Set(forms)]
}

function ipv6Mappings(ip: string): string[] {
  const n = ipv4ToInt(ip)
  if (n === null) return []
  const hex = n.toString(16).padStart(8, '0')
  // 紧凑写法：去掉每组前导 0，如 7f00:0001 → 7f00:1
  const hi = parseInt(hex.slice(0, 4), 16).toString(16)
  const lo = parseInt(hex.slice(4), 16).toString(16)
  return [
    '[::ffff:' + intToIpv4(n) + ']',
    `[::ffff:${hi}:${lo}]`,
    '[0:0:0:0:0:ffff:' + intToIpv4(n) + ']',
  ]
}

export function generateSsrfVariants(input: string): SsrfResult {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'EMPTY', variants: [], host: '', isIpv4: false }

  // 解析出 host：支持 URL 或裸主机
  let host = raw
  let scheme = 'http'
  let path = '/'
  const urlM = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(raw)
  if (urlM) {
    scheme = urlM[1].toLowerCase()
    const authority = urlM[2]
    host = authority.split('@').pop()!
    // 去端口 / 去 IPv6 括号
    host = host.replace(/^\[(.+)\](:\d+)?$/, '$1').replace(/:\d+$/, '')
    path = urlM[3] || '/'
  }

  const variants: SsrfVariant[] = []
  const seen = new Set<string>()
  const push = (category: SsrfCategory, value: string, bypassId: string): void => {
    if (!seen.has(value)) {
      seen.add(value)
      variants.push({ category, value, bypassId })
    }
  }

  const wrap = (hostForm: string): string => {
    const h = hostForm.includes(':') && !hostForm.startsWith('[') ? `[${hostForm}]` : hostForm
    return urlM ? `${scheme}://${h}${path}` : hostForm
  }

  const n = ipv4ToInt(host)
  const isIpv4 = n !== null

  if (isIpv4) {
    const ip = host
    // 进制 / 省略
    for (const f of dottedForms(ip)) push('notation', wrap(f), 'check.blacklistNotation')
    push('notation', wrap(String(n)), 'check.decimalLong')
    push('notation', wrap('0x' + n.toString(16).padStart(8, '0')), 'check.hexLong')
    push('notation', wrap('0' + n.toString(8).padStart(11, '0')), 'check.octalLong')
    push(
      'notation',
      wrap(intToIpv4(n).replace(/\.0+/g, '.0').replace(/\.0$/, '')),
      'check.zeroOctet',
    )

    // IPv6 映射
    for (const v6 of ipv6Mappings(ip)) push('ipv6', wrap(v6.slice(1, -1)), 'check.ipv6Mapped')
    push('ipv6', wrap('::'), 'check.wildcardLocal')

    // 0.0.0.0 类（本机）
    if (n === 0x7f000001) {
      push('wildcard', wrap('0.0.0.0'), 'check.zeroLocalhost')
      push('wildcard', wrap('0'), 'check.zeroLocalhost')
    }

    // 结尾点
    push('dot', wrap(ip + '.'), 'check.trailingDot')
    // 多余点（解析器容忍）
    push('dot', wrap(ip + '..'), 'check.trailingDot')

    // 编码：整段 percent-encode
    push(
      'encoding',
      wrap(
        ip
          .split('.')
          .map((o) => '%' + Number(o).toString(16).padStart(2, '0'))
          .join('.'),
      ),
      'check.percentDecode',
    )
    if (n === 0x7f000001) push('encoding', wrap('127%252f1'), 'check.doubleEncodePath')

    // userinfo 混淆（需要有个「可信」host 当幌子）
    if (urlM) {
      const legit = 'allowed.example'
      push('userinfo', `${scheme}://${legit}@${host}${path}`, 'check.userinfoBeforeHost')
      push('userinfo', `${scheme}://${host}@${legit}${path}`, 'check.userinfoSuffixTrust')
    }

    // 公共 DNS 解析形式（需要网络，单独一类）
    push('dns', wrap(`${ip}.nip.io`), 'check.dnsResolver')
    if (n === 0x7f000001) {
      push('dns', wrap('localtest.me'), 'check.dnsLocalDomain')
    }
  } else {
    // 域名形态：能做的变体少但仍然有意义
    push('dot', wrap(host + '.'), 'check.trailingDot')
    push('notation', wrap(host.toLowerCase()), 'check.caseSensitive')
    push('notation', wrap(host.toUpperCase()), 'check.caseSensitive')
    push('encoding', wrap(host.replace(/\./g, '%2e')), 'check.percentDecode')
    if (urlM) {
      push('userinfo', `${scheme}://allowed.example@${host}${path}`, 'check.userinfoBeforeHost')
    }
    push('dns', wrap(host + '.nip.io'), 'check.dnsResolver')
  }

  return { ok: true, variants, host, isIpv4 }
}
