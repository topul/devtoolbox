/**
 * 自签证书 / CSR 生成器 —— 用 node-forge（纯 JS 实现，浏览器渲染进程可直接跑）。
 *
 * 设计取舍：只产出「叶子证书」（basicConstraints CA:false），签名算法固定
 * SHA-256。RSA 密钥对生成是计算密集操作，node-forge 的回调式 API 内部用
 * setTimeout 分片推进，这里包成 Promise —— UI 在生成期间能保持呼吸，
 * 调用方也才能挂上 loading 态。解析复用 x509.ts 的 parseCertificatePem，
 * 不重复造 DER 解析的轮子。
 */
import * as forge from 'node-forge'
import { certDnString, parseCertificatePem } from './x509'

export interface CertGenOptions {
  commonName: string
  /** SAN 列表；看起来是 IP 的值（IPv4 点分 / IPv6 冒号形式）按 IP 类型写入，其余按 DNS */
  altNames?: string[]
  /** 有效天数，默认 825（iOS/macOS 对长期自签证书的限制线附近） */
  days?: number
  keyBits?: 2048 | 4096
  subject?: { O?: string; OU?: string; C?: string; ST?: string; L?: string }
}

export interface SelfSignedResult {
  keyPem: string
  certPem: string
}

export interface CsrResult {
  keyPem: string
  csrPem: string
}

/** RSA 密钥对生成包成 Promise：node-forge 分片回调，UI 期间可渲染 */
function generateKeyPairAsync(bits: number): Promise<forge.pki.rsa.KeyPair> {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair(bits, 0x10001, (err, kp) => {
      if (err) reject(err)
      else resolve(kp)
    })
  })
}

function normalizeBits(bits: 2048 | 4096 | undefined): number {
  return bits === 4096 ? 4096 : 2048
}

function normalizeDays(days: number | undefined): number {
  const n = Math.round(days ?? 825)
  return Number.isFinite(n) && n > 0 ? n : 825
}

/** 随机序列号：16 字节，首字节最高位清零（DER INTEGER 保证正数） */
function randomSerial(): string {
  const bytes = forge.random.getBytesSync(16)
  const first = String.fromCharCode(bytes.charCodeAt(0) & 0x7f)
  return forge.util.bytesToHex(first + bytes.slice(1))
}

/** IPv4 点分十进制 / IPv6 冒号十六进制 */
function looksLikeIp(value: string): boolean {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || (/^[0-9a-fA-F:]+$/.test(value) && value.includes(':'))
  )
}

/** 主题 DN：CN 必填，其余可选字段有值才写入（空的 RDN 不进证书） */
function subjectAttrs(opts: CertGenOptions): forge.pki.CertificateField[] {
  const attrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: opts.commonName, shortName: 'CN' },
  ]
  const s = opts.subject
  if (s?.O) attrs.push({ name: 'organizationName', value: s.O, shortName: 'O' })
  if (s?.OU) attrs.push({ name: 'organizationalUnitName', value: s.OU, shortName: 'OU' })
  if (s?.C) attrs.push({ name: 'countryName', value: s.C, shortName: 'C' })
  if (s?.ST) attrs.push({ name: 'stateOrProvinceName', value: s.ST, shortName: 'ST' })
  if (s?.L) attrs.push({ name: 'localityName', value: s.L, shortName: 'L' })
  return attrs
}

/** 叶子证书的标准扩展集：TLS 双用途 + SAN（DNS 与 IP 都支持） */
function buildExtensions(altNames: string[]): unknown[] {
  const exts: unknown[] = [
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
  ]
  if (altNames.length > 0) {
    exts.push({
      name: 'subjectAltName',
      altNames: altNames.map((a) => (looksLikeIp(a) ? { type: 7, ip: a } : { type: 2, value: a })),
    })
  }
  return exts
}

/** 生成自签证书（颁发者 = 主题，CA:false 叶子证书） */
export async function generateSelfSigned(opts: CertGenOptions): Promise<SelfSignedResult> {
  const keys = await generateKeyPairAsync(normalizeBits(opts.keyBits))
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  // notBefore 往前挪 1 小时：容掉本机与校验方之间的小幅时钟偏移
  cert.validity.notBefore = new Date(Date.now() - 3_600_000)
  cert.validity.notAfter = new Date(
    cert.validity.notBefore.getTime() + normalizeDays(opts.days) * 86_400_000,
  )
  const attrs = subjectAttrs(opts)
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions(buildExtensions(opts.altNames ?? []))
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return {
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  }
}

/** 生成 CSR（私钥自留，把 csrPem 交给 CA 签发；扩展通过 extensionRequest 属性携带） */
export async function generateCsr(opts: CertGenOptions): Promise<CsrResult> {
  const keys = await generateKeyPairAsync(normalizeBits(opts.keyBits))
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = keys.publicKey
  csr.setSubject(subjectAttrs(opts))
  csr.setAttributes([
    { name: 'extensionRequest', extensions: buildExtensions(opts.altNames ?? []) },
  ])
  csr.sign(keys.privateKey, forge.md.sha256.create())
  return {
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    csrPem: forge.pki.certificationRequestToPem(csr),
  }
}

/** 从 PEM 证书提取一行摘要（主题 DN + 到期时间）；解析失败返回 null（比如粘进来的是 CSR） */
export function parsePemSummary(pem: string): { subject: string; notAfter: string } | null {
  try {
    const info = parseCertificatePem(pem)
    return { subject: certDnString(info.subject), notAfter: info.notAfter }
  } catch {
    return null
  }
}
