/**
 * X.509 证书解析 —— 渲染进程与 MCP 服务端共用。
 *
 * 一个最小但忠实的 DER/TLV 解析器 + RFC 5280 常用字段提取：
 * 主题/颁发者、序列号、有效期、SAN、指纹、公钥算法与位数、Basic Constraints。
 * 不验签、不校链 —— 那是调用方（或系统信任库）的事。
 */
import CryptoJS from 'crypto-js'

/* ================= DER TLV ================= */

export interface DerNode {
  /** 低 5 位标签号（多字节标签取最后一字节） */
  tag: number
  /** tag class：0=universal 1=application 2=context 3=private */
  cls: number
  constructed: boolean
  /** 值区间（不含 tag/length 头） */
  value: Uint8Array
  /** 整个节点（含头）在输入中的区间 */
  raw: Uint8Array
}

class DerReader {
  pos = 0
  constructor(readonly bytes: Uint8Array) {}

  get eof(): boolean {
    return this.pos >= this.bytes.length
  }

  readNode(): DerNode {
    const start = this.pos
    const first = this.bytes[this.pos++]
    const cls = (first >> 6) & 0x03
    const constructed = (first & 0x20) !== 0
    let tag = first & 0x1f
    if (tag === 0x1f) {
      // 多字节标签：后续字节高比特位为 1 表示继续
      tag = 0
      for (;;) {
        if (this.pos >= this.bytes.length) throw new Error('DER_TRUNCATED_TAG')
        const b = this.bytes[this.pos++]
        tag = (tag << 7) | (b & 0x7f)
        if ((b & 0x80) === 0) break
      }
    }
    if (this.pos >= this.bytes.length) throw new Error('DER_TRUNCATED_LEN')
    const lenByte = this.bytes[this.pos++]
    let length: number
    if ((lenByte & 0x80) === 0) {
      length = lenByte
    } else {
      const numBytes = lenByte & 0x7f
      if (numBytes === 0 || numBytes > 4) throw new Error('DER_BAD_LENGTH') // 不定长编码本解析器不支持
      length = 0
      for (let i = 0; i < numBytes; i++) {
        if (this.pos >= this.bytes.length) throw new Error('DER_TRUNCATED_LEN')
        length = (length << 8) | this.bytes[this.pos++]
      }
    }
    if (this.pos + length > this.bytes.length) throw new Error('DER_TRUNCATED_VALUE')
    const value = this.bytes.subarray(this.pos, this.pos + length)
    this.pos += length
    const raw = this.bytes.subarray(start, this.pos)
    return { tag, cls, constructed, value, raw }
  }

  /** 读取一个 SEQUENCE（tag=16 universal）并返回子节点列表 */
  readSequence(): DerNode[] {
    const node = this.readNode()
    if (node.tag !== 16 || !node.constructed) throw new Error('DER_EXPECT_SEQUENCE')
    const r = new DerReader(node.value)
    const out: DerNode[] = []
    while (!r.eof) out.push(r.readNode())
    return out
  }
}

function readAll(bytes: Uint8Array): DerNode[] {
  const r = new DerReader(bytes)
  const out: DerNode[] = []
  while (!r.eof) out.push(r.readNode())
  return out
}

/* ================= PEM ================= */

/** 从文本中提取第一个（或全部）PEM 证书块的 DER 字节 */
export function pemToDerBlocks(pem: string): Uint8Array[] {
  const re = /-----BEGIN CERTIFICATE-----\s*([\s\S]*?)\s*-----END CERTIFICATE-----/g
  const out: Uint8Array[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(pem)) !== null) {
    out.push(base64ToBytes(m[1].replace(/\s+/g, '')))
  }
  if (!out.length) throw new Error('NO_PEM_CERTIFICATE')
  return out
}

/** base64 → 原始字节（自建实现，跨环境无 atob/Buffer 依赖） */
function base64ToBytes(b64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8))
  let buffer = 0
  let bits = 0
  let n = 0
  for (const ch of clean) {
    buffer = (buffer << 6) | alphabet.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[n++] = (buffer >> bits) & 0xff
    }
  }
  return out.subarray(0, n)
}

/* ================= OID ================= */

const OID_ATTR: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.42': 'GN',
  '2.5.4.46': 'dnQualifier',
  '2.5.4.65': 'pseudonym',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.1': 'UID',
  '0.9.2342.19200300.100.1.25': 'DC',
}

const OID_SIG: Record<string, string> = {
  '1.2.840.113549.1.1.4': 'md5WithRSAEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'rsassaPss',
  '1.2.840.10045.4.1': 'ecdsa-with-SHA1',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '2.16.840.1.101.3.4.3.2': 'dsa-with-sha256',
}

const OID_PK: Record<string, string> = {
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.113549.1.1.10': 'RSA-PSS',
  '1.2.840.10045.2.1': 'EC',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '1.2.840.10040.4.1': 'DSA',
}

const OID_CURVE: Record<string, string> = {
  '1.2.840.10045.3.1.7': 'prime256v1 (P-256)',
  '1.3.132.0.34': 'secp384r1 (P-384)',
  '1.3.132.0.35': 'secp521r1 (P-521)',
  '1.3.132.0.10': 'secp256k1',
}

const OID_EXT: Record<string, string> = {
  '2.5.29.9': 'subjectDirectoryAttributes',
  '2.5.29.14': 'subjectKeyIdentifier',
  '2.5.29.15': 'keyUsage',
  '2.5.29.16': 'privateKeyUsagePeriod',
  '2.5.29.17': 'subjectAltName',
  '2.5.29.18': 'issuerAltName',
  '2.5.29.19': 'basicConstraints',
  '2.5.29.20': 'cRLNumber',
  '2.5.29.21': 'cRLReason',
  '2.5.29.24': 'invalidityDate',
  '2.5.29.27': 'deltaCRLIndicator',
  '2.5.29.28': 'issuingDistributionPoint',
  '2.5.29.29': 'certificateIssuer',
  '2.5.29.30': 'nameConstraints',
  '2.5.29.31': 'cRLDistributionPoints',
  '2.5.29.32': 'certificatePolicies',
  '2.5.29.33': 'policyMappings',
  '2.5.29.35': 'authorityKeyIdentifier',
  '2.5.29.36': 'policyConstraints',
  '2.5.29.37': 'extKeyUsage',
  '2.5.29.46': 'freshestCRL',
  '2.5.29.54': 'inhibitAnyPolicy',
  '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess',
  '1.3.6.1.5.5.7.1.24': 'tlsFeature',
}

/** DER OID 值 → 点分十进制 */
function decodeOid(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  const parts: number[] = []
  parts.push(Math.floor(bytes[0] / 40))
  parts.push(bytes[0] % 40)
  let n = 0
  for (let i = 1; i < bytes.length; i++) {
    n = (n << 7) | (bytes[i] & 0x7f)
    if ((bytes[i] & 0x80) === 0) {
      parts.push(n)
      n = 0
    }
  }
  return parts.join('.')
}

/* ================= 值解码 ================= */

function decodeString(node: DerNode): string {
  // 0x0c UTF8String / 0x13 PrintableString / 0x16 IA5String / 0x14 T61String 等
  // 现代证书基本是 UTF8String；T61 按 latin1 兜底，保证不抛异常
  if (node.tag === 0x1e) return new TextDecoder('latin1').decode(node.value)
  return new TextDecoder('utf-8', { fatal: false }).decode(node.value)
}

function decodeInt(node: DerNode): bigint {
  if (node.tag !== 0x02) throw new Error('DER_EXPECT_INTEGER')
  let n = 0n
  for (const b of node.value) n = (n << 8n) | BigInt(b)
  return n
}

function decodeTime(node: DerNode): string {
  // UTCTime(23) YYMMDDHHMM[SS]Z / GeneralizedTime(24) YYYYMMDDHHMM[SS]Z
  const s = new TextDecoder('ascii').decode(node.value)
  if (node.tag === 23) {
    const m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/)
    if (!m) throw new Error('DER_BAD_UTCTIME')
    const yy = parseInt(m[1])
    const year = yy >= 50 ? 1900 + yy : 2000 + yy
    return utcIso(year, +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)
  }
  if (node.tag === 24) {
    const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/)
    if (!m) throw new Error('DER_BAD_GENTIME')
    return utcIso(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0)
  }
  throw new Error('DER_BAD_TIME')
}

function utcIso(y: number, mo: number, d: number, h: number, mi: number, s: number): string {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString()
}

/* ================= Name（RDNSequence） ================= */

export interface Attr {
  type: string
  value: string
}

/** Name ::= SEQUENCE OF SET OF SEQUENCE { OID, value }，展平成属性列表（保序） */
function parseName(node: DerNode): Attr[] {
  if (node.tag !== 16 || !node.constructed) throw new Error('DER_EXPECT_NAME')
  const r = new DerReader(node.value)
  const out: Attr[] = []
  while (!r.eof) {
    const rdn = r.readNode() // SET
    const rr = new DerReader(rdn.value)
    while (!rr.eof) {
      const atv = rr.readNode() // SEQUENCE
      const children = readAll(atv.value)
      if (children.length < 2) continue
      const oid = decodeOid(children[0].value)
      out.push({ type: OID_ATTR[oid] ?? oid, value: decodeString(children[1]) })
    }
  }
  return out
}

/* ================= 扩展 ================= */

export interface SanEntry {
  kind: 'dns' | 'ip' | 'email' | 'uri' | 'other'
  value: string
}

export interface ExtEntry {
  name: string
  oid: string
  critical: boolean
}

export interface CertExtension {
  san: SanEntry[] | null
  basicConstraints: { isCa: boolean; pathLen: number | null } | null
  keyUsage: string[] | null
  all: ExtEntry[]
}

const KEY_USAGE_BITS = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
]

function parseSan(octetValue: Uint8Array): SanEntry[] {
  const seq = readAll(octetValue)
  const r = new DerReader(seq[0]?.value ?? new Uint8Array(0))
  const out: SanEntry[] = []
  while (!r.eof) {
    const gn = r.readNode()
    if (gn.cls !== 2) continue // context-specific
    switch (gn.tag) {
      case 1:
        out.push({ kind: 'email', value: new TextDecoder().decode(gn.value) })
        break
      case 2:
        out.push({ kind: 'dns', value: new TextDecoder().decode(gn.value) })
        break
      case 6:
        out.push({ kind: 'uri', value: new TextDecoder().decode(gn.value) })
        break
      case 7:
        out.push({
          kind: 'ip',
          value:
            gn.value.length === 4 || gn.value.length === 16
              ? Array.from(gn.value).join('.')
              : Array.from(gn.value)
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join(':'),
        })
        break
      default:
        break
    }
  }
  return out
}

function parseBasicConstraints(octetValue: Uint8Array): { isCa: boolean; pathLen: number | null } {
  const seq = readAll(octetValue)
  const r = new DerReader(seq[0]?.value ?? new Uint8Array(0))
  let isCa = false
  let pathLen: number | null = null
  if (!r.eof) {
    const first = r.readNode()
    if (first.tag === 0x01) {
      isCa = first.value[0] !== 0
      if (!r.eof) pathLen = Number(decodeInt(r.readNode()))
    } else if (first.tag === 0x02) {
      pathLen = Number(decodeInt(first))
    }
  }
  return { isCa, pathLen }
}

function parseKeyUsage(octetValue: Uint8Array): string[] {
  const bitStr = readAll(octetValue)[0]
  if (!bitStr || bitStr.tag !== 0x03) return []
  const bytes = bitStr.value
  const unused = bytes[0] ?? 0
  const totalBits = (bytes.length - 1) * 8 - unused
  const out: string[] = []
  for (let i = 0; i < totalBits && i < KEY_USAGE_BITS.length; i++) {
    const byte = bytes[1 + (i >> 3)]
    if (byte !== undefined && (byte & (0x80 >> (i & 7))) !== 0) out.push(KEY_USAGE_BITS[i])
  }
  return out
}

/* ================= 公钥 ================= */

export interface PubKeyInfo {
  algorithm: string
  /** RSA 模长（bit）；EC 给曲线名；其他给 null */
  keySize: number | null
  curve: string | null
}

function parseSpki(node: DerNode): PubKeyInfo {
  const children = readAll(node.value)
  if (children.length < 2) throw new Error('DER_BAD_SPKI')
  const algChildren = readAll(children[0].value)
  const algOid = decodeOid(algChildren[0].value)
  const algorithm = OID_PK[algOid] ?? algOid
  // children[1] 是 BIT STRING：首字节是未用位数，其后是密钥 DER
  const bitStr = children[1]
  if (bitStr.tag !== 0x03) throw new Error('DER_BAD_SPKI_BITS')
  const keyDer = bitStr.value.subarray(1)
  if (algorithm === 'RSA') {
    const seq = readAll(keyDer)
    const modulus = readAll(seq[0]?.value ?? new Uint8Array(0))[0]
    // 模数首位可能是补 0，位长 = 字节数 * 8 - 前导零位数
    const bytes = modulus?.value ?? new Uint8Array(0)
    let leadZero = 0
    while (leadZero < bytes.length && bytes[leadZero] === 0) leadZero++
    return { algorithm, keySize: (bytes.length - leadZero) * 8, curve: null }
  }
  if (algorithm === 'EC') {
    const curveOid = algChildren[1] ? decodeOid(algChildren[1].value) : ''
    return { algorithm, keySize: null, curve: OID_CURVE[curveOid] ?? curveOid }
  }
  return { algorithm, keySize: null, curve: null }
}

/* ================= 证书整体 ================= */

export interface CertInfo {
  version: number
  serialNumber: string
  signatureAlgorithm: string
  issuer: Attr[]
  subject: Attr[]
  notBefore: string
  notAfter: string
  /** 是否在给定时间点有效 */
  validity: { valid: boolean; expired: boolean; notYetValid: boolean }
  publicKey: PubKeyInfo
  san: SanEntry[]
  isCa: boolean | null
  pathLen: number | null
  keyUsage: string[]
  extensions: ExtEntry[]
  fingerprints: { sha1: string; sha256: string }
  /** DER 总字节数 */
  derSize: number
}

/** 格式化指纹：大写 hex，冒号分隔 */
function fmtFp(hex: string): string {
  return (hex.match(/../g) ?? []).join(':').toUpperCase()
}

function shaFingerprints(der: Uint8Array): { sha1: string; sha256: string } {
  const wa = CryptoJS.lib.WordArray.create(der)
  return {
    sha1: fmtFp(CryptoJS.SHA1(wa).toString()),
    sha256: fmtFp(CryptoJS.SHA256(wa).toString()),
  }
}

/** 解析单个证书的 DER 字节 */
export function parseCertificateDer(der: Uint8Array, now = new Date()): CertInfo {
  const certSeq = readAll(der)
  if (certSeq.length !== 1 || certSeq[0].tag !== 16) throw new Error('DER_NOT_CERTIFICATE')
  const certChildren = readAll(certSeq[0].value)
  if (certChildren.length < 3) throw new Error('DER_BAD_CERTIFICATE')

  const tbs = certChildren[0]
  // 外层签名算法（certChildren[1]）与 TBS 内的一致，解析用 TBS 里的那份
  const tbsChildren = readAll(tbs.value)

  let idx = 0
  // version [0] EXPLICIT INTEGER DEFAULT v1
  let version = 1
  if (tbsChildren[0] && tbsChildren[0].cls === 2 && tbsChildren[0].tag === 0) {
    const inner = readAll(tbsChildren[0].value)[0]
    version = Number(decodeInt(inner)) + 1
    idx = 1
  }
  const serial = tbsChildren[idx++] ?? { tag: 0x02, value: new Uint8Array(0) }
  const sigAlgChildren = readAll((tbsChildren[idx++] as DerNode).value)
  const sigAlgOid = decodeOid(sigAlgChildren[0].value)
  const issuer = parseName(tbsChildren[idx++] as DerNode)
  const validitySeq = readAll((tbsChildren[idx++] as DerNode).value)
  const notBefore = decodeTime(validitySeq[0])
  const notAfter = decodeTime(validitySeq[1])
  const subject = parseName(tbsChildren[idx++] as DerNode)
  const spki = parseSpki(tbsChildren[idx++] as DerNode)

  // 可选字段：[1] issuerUniqueID、[2] subjectUniqueID、[3] extensions
  let san: SanEntry[] = []
  let basicConstraints: { isCa: boolean; pathLen: number | null } | null = null
  let keyUsage: string[] = []
  const extensions: ExtEntry[] = []
  while (idx < tbsChildren.length) {
    const opt = tbsChildren[idx]
    if (opt.cls === 2 && opt.tag === 3) {
      // [3] EXPLICIT 包着 SEQUENCE OF Extension，要解包两层
      const extsList = readAll(opt.value)
      for (const extNode of readAll(extsList[0].value)) {
        const parts = readAll(extNode.value)
        const extOid = decodeOid(parts[0].value)
        let critical = false
        let valueIdx = 1
        if (parts[1] && parts[1].tag === 0x01) {
          critical = parts[1].value[0] !== 0
          valueIdx = 2
        }
        const extName = OID_EXT[extOid] ?? extOid
        extensions.push({ name: extName, oid: extOid, critical })
        const octets = parts[valueIdx]
        if (!octets || octets.tag !== 0x04) continue
        try {
          if (extOid === '2.5.29.17') san = parseSan(octets.value)
          else if (extOid === '2.5.29.19') basicConstraints = parseBasicConstraints(octets.value)
          else if (extOid === '2.5.29.15') keyUsage = parseKeyUsage(octets.value)
        } catch {
          /* 单个扩展解析失败不阻塞其余字段 */
        }
      }
    }
    idx++
  }

  const nb = new Date(notBefore)
  const na = new Date(notAfter)
  const expired = now >= na
  const notYetValid = now < nb

  return {
    version,
    serialNumber:
      '0x' +
      decodeInt(serial)
        .toString(16)
        .toUpperCase()
        .replace(/^0+(?=.)/, ''),
    signatureAlgorithm: OID_SIG[sigAlgOid] ?? sigAlgOid,
    issuer,
    subject,
    notBefore,
    notAfter,
    validity: { valid: !expired && !notYetValid, expired, notYetValid },
    publicKey: spki,
    san,
    isCa: basicConstraints?.isCa ?? null,
    pathLen: basicConstraints?.pathLen ?? null,
    keyUsage,
    extensions,
    fingerprints: shaFingerprints(der),
    derSize: der.length,
  }
}

/** 从 PEM 文本解析（取第一个证书块） */
export function parseCertificatePem(pem: string, now = new Date()): CertInfo {
  const blocks = pemToDerBlocks(pem)
  return parseCertificateDer(blocks[0], now)
}

/** 常见名称（subject CN，缺失时回退 issuer CN，再回退空串） */
export function certCommonName(cert: CertInfo): string {
  return (
    cert.subject.find((a) => a.type === 'CN')?.value ??
    cert.issuer.find((a) => a.type === 'CN')?.value ??
    ''
  )
}

/** 主题 DN 的可读形式：CN=xxx, O=yyy（保属性顺序） */
export function certDnString(attrs: Attr[]): string {
  return attrs.map((a) => `${a.type}=${a.value}`).join(', ')
}
