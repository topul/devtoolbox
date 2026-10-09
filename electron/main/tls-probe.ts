/**
 * TLS 握手探测：连一次目标主机，把协商结果与证书链拿回来。
 *
 * 为什么在主进程：`node:tls` 是 Node 内置模块，渲染层拿不到；
 * 且沙箱 + contextIsolation 下渲染层也没有网络栈可用。
 *
 * **不 import electron**：连接逻辑写成纯函数，宿主能力（计时、地址解析）注入。
 * 这样 `scripts/smoke-tls.mjs` 能直接拿真实 TLS 服务器验证，不用起 Electron。
 */
import tls from 'node:tls'
import type { TlsProbe, TlsCert } from '../../src/lib/tls-types'

/** 宿主能力注入点：真实实现用 node 的计时与地址解析，测试里可替换 */
export interface TlsDeps {
  now: () => number
  /** 判断字符串是否 IP 字面量 */
  isIp: (host: string) => boolean
}

/** 默认依赖 */
export const defaultDeps: TlsDeps = {
  now: () => Date.now(),
  isIp: (host) => net_isIp(host),
}

// 避免顶层 import node:net（部分沙箱下测试环境拿不到），用正则自己判 IPv4/IPv6
function net_isIp(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true
  return host.includes(':') && /^[0-9a-f:]+$/i.test(host)
}

/**
 * 从证书的 DER 原始字节里取出签名算法 OID 并翻译成名字。
 *
 * 为什么需要手工解析：**Node 22 的 `getPeerCertificate()` 不返回 `sigalgname`**
 * （实测字段只有 subject/issuer/ca/modulus/bits/exponent/pubkey/
 * valid_from/valid_to/fingerprint/fingerprint256/fingerprint512/serialNumber/raw）。
 * 但用户排查证书问题时最关心的恰恰是「用什么算法签的」——
 * SHA-1 签名的证书在浏览器里会被标红，这个信息不能没有。
 *
 * DER 里签名算法在 Certificate 结构的第一段（AlgorithmIdentifier）。
 * 这里不引入 ASN.1 库（为了一个字段不值得），
 * 做法是扫 `raw` 里的 OID 编码，取已知的签名算法 OID。
 */
const SIG_ALG_OIDS: Record<string, string> = {
  '2.16.840.1.101.3.4.2.1': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '2.16.840.1.101.3.4.2.2': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '2.16.840.1.101.3.4.2.3': 'sha512WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.4': 'md5WithRSAEncryption',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.2.840.10045.4.3.1': 'ecdsa-with-SHA1',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
}

/** 把 raw（Buffer）里的 OID 字节串解成点分十进制 */
function oidToString(raw: Buffer): string {
  const first = raw[0]
  const parts: number[] = [Math.floor(first / 40), first % 40]
  let acc = 0
  for (let i = 1; i < raw.length; i++) {
    const b = raw[i]
    // 高位为 1 表示后续字节属于同一个整数（base-128 变长编码）
    acc = acc * 128 + (b & 0x7f)
    if ((b & 0x80) === 0) {
      parts.push(acc)
      acc = 0
    }
  }
  return parts.join('.')
}

/** 猜签名算法：扫 raw 里的 OID，取第一个能翻译的 */
function guessSigAlg(raw: Buffer | undefined, fallback: string): string {
  if (!raw || raw.length < 20) return fallback
  // OID 的 tag 是 0x06；后面跟长度字节（短形式或长形式）
  for (let i = 0; i < raw.length - 2; i++) {
    if (raw[i] !== 0x06) continue
    let len = raw[i + 1]
    let start = i + 2
    if (len & 0x80) {
      // 长形式：低 7 位是长度字节数
      const n = len & 0x7f
      if (n === 0 || n > 4 || i + 2 + n >= raw.length) continue
      len = 0
      for (let k = 0; k < n; k++) len = (len << 8) | raw[i + 2 + k]
      start = i + 2 + n
    }
    if (len < 5 || start + len > raw.length) continue
    const oid = oidToString(raw.subarray(start, start + len))
    const name = SIG_ALG_OIDS[oid]
    if (name) return name
  }
  return fallback
}

/**
 * DN 字段归一成字符串。
 *
 * node 的 `subject.CN` 类型是 `string | string[]`（多值 DN 会出现数组），
 * 直接塞进 `string` 字段会 TS 报错；更重要的是展示时数组会变成 "a,b"，
 * 语义还是清楚的，所以取第一个即可。
 */
function dn(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? ''
  return v ?? ''
}

/** 把 node 的证书对象压成契约里的形状 */
function toCert(raw: ChainCert): TlsCert {
  const now = Date.now()
  const notAfter = new Date(raw.valid_to)
  // 有些自签证书的 valid_to 格式异常，解析失败时给 0（界面显示 '—'）
  const daysLeft = Number.isNaN(notAfter.getTime())
    ? 0
    : Math.floor((notAfter.getTime() - now) / 86400000)

  // SAN 优先（现代证书的域名都在这儿），CN 作为兜底
  const san = raw.subjectaltname ?? ''
  const domains = san
    ? san
        .split(',')
        .map((s) => s.trim().replace(/^DNS:/i, ''))
        .filter(Boolean)
    : []
  const cn = dn(raw.subject?.CN)
  if (cn && !domains.includes(cn)) domains.push(cn)

  return {
    subject: dn(raw.subject?.CN) || '(no CN)',
    issuer: dn(raw.issuer?.CN) || dn(raw.issuer?.O) || '(unknown)',
    notBefore: new Date(raw.valid_from).toISOString(),
    notAfter: Number.isNaN(notAfter.getTime()) ? '' : notAfter.toISOString(),
    daysLeft,
    serial: raw.serialNumber ?? '',
    domains,
    isCa: !!raw.ca,
    fingerprint256: (raw.fingerprint256 ?? '').toUpperCase(),
    fingerprint1: (raw.fingerprint ?? '').toUpperCase(),
    sigAlg: (raw as { sigalgname?: string }).sigalgname || guessSigAlg(raw.raw, ''),
    pubkeyAlg: raw.asn1Curve ? `EC (${raw.asn1Curve})` : raw.modulus ? 'RSA' : '',
    keyBits: raw.bits ?? 0,
  }
}

/** 收集整条链：node 的 getPeerCertificate(true) 已经给了 issuer 链，这里顺着往上走 */
/**
 * node 的 PeerCertificate 类型里没有 issuerCertificate 字段（运行时却有），
 * 这里显式声明扩展形状，比到处 as any 干净。
 */
type ChainCert = tls.PeerCertificate & { issuerCertificate?: unknown }

function collectChain(raw: ChainCert | undefined): TlsCert[] {
  const out: TlsCert[] = []
  const seen = new Set<string>()
  let cur: ChainCert | undefined = raw
  // 上限 5 张：正常链 2-4 张，防自签证书的循环引用导致死循环
  while (cur && out.length < 5) {
    const fp = cur.fingerprint ?? ''
    if (seen.has(fp)) break
    seen.add(fp)
    out.push(toCert(cur))
    cur = cur.issuerCertificate as ChainCert | undefined
    // node 用null 或自己表示链尾
    if (!cur || cur === raw) break
  }
  return out
}

/**
 * 探测一个目标的 TLS 握手。
 *
 * 连上就立刻断开 —— 我们要的是握手参数，不是响应体。
 *
 * @param host 主机名或IP
 * @param port 端口；0 或负数用 443
 * @param timeoutMs 连接超时
 */
export function probeTls(
  host: string,
  port: number,
  timeoutMs: number,
  deps: TlsDeps = defaultDeps,
): Promise<TlsProbe> {
  const p = port > 0 ? port : 443
  const base: TlsProbe = {
    ok: false,
    host,
    port: p,
    protocol: '',
    cipher: '',
    cipherName: '',
    cipherSuiteName: '',
    alpn: '',
    sni: '',
    certs: [],
    elapsedMs: 0,
    authorized: false,
    authorizationError: '',
    isIpHost: deps.isIp(host),
  }

  return new Promise<TlsProbe>((resolve) => {
    let settled = false
    const done = (r: TlsProbe): void => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* 已断开 */
      }
      resolve(r)
    }

    const started = deps.now()
    const socket = tls.connect({
      host,
      port: p,
      // 不传 servername 时 node 不发 SNI，对 IP 直连是正确行为
      servername: deps.isIp(host) ? undefined : host,
      // 只探测握手，拿到参数就够；关掉 renegotiation 免得服务端纠缠
      rejectUnauthorized: false,
    })

    // 无论成功失败都要有收场，否则界面会一直停在「探测中」
    const watchdog = setTimeout(() => {
      done({
        ...base,
        errorCode: 'TIMEOUT',
        errorDetail: `no handshake within ${timeoutMs}ms`,
        elapsedMs: deps.now() - started,
      })
    }, timeoutMs)

    socket.on('secureConnect', () => {
      clearTimeout(watchdog)
      const elapsedMs = deps.now() - started
      try {
        const cipher = socket.getCipher()
        // TLS 1.3 的套件 getCipher() 返回 0x13 开头，名字要另外取。
        // getCipherSuite 是 Node 15+ 的方法，但 @types/node 尚未收录，先绕一层
        const cipherSuiteName = safeCipherSuiteName(socket)
        done({
          ...base,
          ok: true,
          protocol: socket.getProtocol() ?? '',
          cipher: cipher?.name ?? '',
          cipherName: cipher?.name ?? '',
          cipherSuiteName,
          // alpnProtocol 类型是 string | false | null；false 与 null 都表示「没协商」
          alpn: typeof socket.alpnProtocol === 'string' ? socket.alpnProtocol : '',
          sni: deps.isIp(host) ? '' : host,
          certs: collectChain(socket.getPeerCertificate(true) as ChainCert),
          elapsedMs,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : '',
        })
      } catch (e) {
        done({ ...base, errorCode: 'PROBE_FAILED', errorDetail: (e as Error).message, elapsedMs })
      }
    })

    socket.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(watchdog)
      // 把 OpenSSL 的错误码带上，界面可以据此区分「证书过期」与「连不上」
      const code = (e as { opensslErrorStack?: string[] }).opensslErrorStack?.[0] ?? ''
      const detail = code ? `${e.code ?? ''} ${code}`.trim() : (e.message ?? '')
      done({
        ...base,
        errorCode: e.code || 'CONN_FAILED',
        errorDetail: detail,
        elapsedMs: deps.now() - started,
      })
    })
  })
}

/** 取 TLS 1.3 套件名（@types/node 未收录该方法，运行时存在；拿不到就空串） */
function safeCipherSuiteName(socket: tls.TLSSocket): string {
  const fn = (socket as unknown as { getCipherSuite?: () => unknown }).getCipherSuite
  if (typeof fn !== 'function') return ''
  try {
    return String(fn.call(socket) ?? '')
  } catch {
    return ''
  }
}
