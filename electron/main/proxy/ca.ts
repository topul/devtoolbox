/**
 * 本地 CA 与按域名签发的叶证书
 *
 * 抓包要看到 HTTPS 明文，必须在客户端与上游之间做中间人：给每个访问的域名即时签一张
 * 由本地根证书签发的叶证书。根证书只在首次启动时生成一次，私钥落盘在 userData 下，
 * 用户手动把根证书加入系统信任后，浏览器/终端才会接受我们的叶证书。
 *
 *   userData/proxy-ca/ca.pem        根证书（可导出发给用户安装）
 *   userData/proxy-ca/ca-key.pem    根证书私钥（只在本机，不会外传）
 *
 * node-forge 是 CJS 包且只暴露 default 导出，必须默认导入后解构，不能具名导入。
 */
import fs from 'node:fs'
import path from 'node:path'
import tls from 'node:tls'
import forge from 'node-forge'

type ForgeCert = ReturnType<typeof forge.pki.createCertificate>
type ForgeKeyPair = ReturnType<typeof forge.pki.rsa.generateKeyPair>

export type { CaInfo } from '../../../src/lib/proxy-types'
import type { CaInfo } from '../../../src/lib/proxy-types'

const CA_CN = 'DevOps Toolbox Root CA'
const CA_ORG = 'DevOps Toolbox'
const CA_DAYS = 3650
const LEAF_DAYS = 825

function sha256Hex(input: Buffer): string {
  const md = forge.md.sha256.create()
  md.update(input.toString('binary'))
  return md.digest().toHex().toUpperCase()
}

function formatFingerprint(hex: string): string {
  return (hex.match(/.{2}/g) ?? []).join(':')
}

function serialNumber(): string {
  return forge.util.bytesToHex(forge.random.getBytesSync(16))
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

export class CertAuthority {
  readonly dir: string
  private caCert: ForgeCert | null = null
  private caKey: ForgeKeyPair['privateKey'] | null = null
  private leafKeys: ForgeKeyPair | null = null
  private leafCache = new Map<string, { cert: string; key: string; context: tls.SecureContext }>()
  private info: CaInfo | null = null

  constructor(dir: string) {
    this.dir = dir
  }

  get ready(): boolean {
    return this.caCert !== null && this.caKey !== null
  }

  /** 读取已有根证书；不存在则生成。返回根证书元信息。 */
  async init(): Promise<CaInfo> {
    if (this.info && this.ready) return this.info
    fs.mkdirSync(this.dir, { recursive: true })
    const certPath = path.join(this.dir, 'ca.pem')
    const keyPath = path.join(this.dir, 'ca-key.pem')

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      try {
        const certPem = fs.readFileSync(certPath, 'utf8')
        this.caCert = forge.pki.certificateFromPem(certPem)
        this.caKey = forge.pki.privateKeyFromPem(fs.readFileSync(keyPath, 'utf8'))
        this.info = this.describe(certPem, certPath, keyPath, fs.statSync(certPath).mtime.toISOString())
        return this.info
      } catch {
        // 文件损坏：备份后重新生成
        const stamp = Date.now()
        try { fs.renameSync(certPath, `${certPath}.broken-${stamp}`) } catch { /* ignore */ }
        try { fs.renameSync(keyPath, `${keyPath}.broken-${stamp}`) } catch { /* ignore */ }
      }
    }

    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = serialNumber()
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
    cert.validity.notAfter = new Date(Date.now() + CA_DAYS * 24 * 3600 * 1000)
    const attrs = [
      { name: 'commonName', value: CA_CN },
      { name: 'organizationName', value: CA_ORG },
      { name: 'organizationalUnitName', value: 'Local Traffic Analysis' },
      { name: 'countryName', value: 'CN' },
    ]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ])
    cert.sign(keys.privateKey, forge.md.sha256.create())

    const certPem = forge.pki.certificateToPem(cert)
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey)
    fs.writeFileSync(certPath, certPem, { mode: 0o644 })
    fs.writeFileSync(keyPath, keyPem, { mode: 0o600 })

    this.caCert = cert
    this.caKey = keys.privateKey
    this.info = this.describe(certPem, certPath, keyPath, new Date().toISOString())
    return this.info
  }

  private describe(certPem: string, certPath: string, keyPath: string, createdAt: string): CaInfo {
    const cert = forge.pki.certificateFromPem(certPem)
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
    return {
      dir: this.dir,
      certPath,
      keyPath,
      certPem,
      subject: `CN=${cert.subject.getField('CN')?.value ?? '?'}, O=${cert.subject.getField('O')?.value ?? '?'}`,
      organization: String(cert.subject.getField('O')?.value ?? CA_ORG),
      validFrom: cert.validity.notBefore.toISOString(),
      validTo: cert.validity.notAfter.toISOString(),
      fingerprintSha256: formatFingerprint(sha256Hex(Buffer.from(der, 'binary'))),
      createdAt,
    }
  }

  getInfo(): CaInfo | null {
    return this.info
  }

  /** 取（或签发）指定主机的服务端证书上下文，供 tls 服务端使用 */
  contextFor(host: string): tls.SecureContext {
    const key = host.toLowerCase()
    const hit = this.leafCache.get(key)
    if (hit) return hit.context
    const { cert, key: keyPem } = this.leafPems(host)
    const context = tls.createSecureContext({
      key: keyPem,
      cert,
      minVersion: 'TLSv1',
    })
    this.leafCache.set(key, { cert, key: keyPem, context })
    return context
  }

  /** 签发（或命中缓存）指定主机的叶证书 PEM，供校验与测试使用 */
  leafPems(host: string): { cert: string; key: string } {
    if (!this.caCert || !this.caKey) throw new Error('CA 尚未初始化')
    const key = host.toLowerCase()
    const hit = this.leafCache.get(key)
    if (hit) return { cert: hit.cert, key: hit.key }
    if (!this.leafKeys) this.leafKeys = forge.pki.rsa.generateKeyPair(2048)

    const cert = forge.pki.createCertificate()
    cert.publicKey = this.leafKeys.publicKey
    cert.serialNumber = serialNumber()
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
    cert.validity.notAfter = new Date(Date.now() + LEAF_DAYS * 24 * 3600 * 1000)
    cert.setSubject([{ name: 'commonName', value: host }])
    cert.setIssuer(this.caCert.subject.attributes)

    const altNames: Record<string, unknown>[] = isIpAddress(host)
      ? [{ type: 7, ip: host }]
      : [{ type: 2, value: host }]
    // 单层通配符兜底，覆盖同域下的其它子域（*.example.com）
    if (!isIpAddress(host) && host.split('.').length === 2) {
      altNames.push({ type: 2, value: `*.${host}` })
    }

    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
      { name: 'subjectAltName', altNames },
      { name: 'subjectKeyIdentifier' },
      {
        name: 'authorityKeyIdentifier',
        keyIdentifier: this.caCert.generateSubjectKeyIdentifier().getBytes(),
      },
    ])
    cert.sign(this.caKey, forge.md.sha256.create())

    const certPem = forge.pki.certificateToPem(cert)
    const keyPem = forge.pki.privateKeyToPem(this.leafKeys.privateKey)
    const context = tls.createSecureContext({
      key: keyPem,
      cert: certPem,
      minVersion: 'TLSv1',
    })
    this.leafCache.set(key, { cert: certPem, key: keyPem, context })
    return { cert: certPem, key: keyPem }
  }

  /** 导出根证书到指定路径，返回实际写入位置 */
  exportTo(targetPath: string): string {
    if (!this.info) throw new Error('CA 尚未初始化')
    const dir = path.dirname(targetPath)
    fs.mkdirSync(dir, { recursive: true })
    const isDer = /\.(cer|der|crt)$/i.test(targetPath)
    if (isDer) {
      const cert = forge.pki.certificateFromPem(this.info.certPem)
      const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
      fs.writeFileSync(targetPath, Buffer.from(der, 'binary'))
    } else {
      fs.writeFileSync(targetPath, this.info.certPem, { mode: 0o644 })
    }
    return targetPath
  }

  /** 重置：删除根证书与缓存（下次访问会重新生成，需重新信任） */
  reset(): void {
    this.leafCache.clear()
    this.caCert = null
    this.caKey = null
    this.leafKeys = null
    this.info = null
    for (const f of ['ca.pem', 'ca-key.pem']) {
      try { fs.rmSync(path.join(this.dir, f), { force: true }) } catch { /* ignore */ }
    }
  }
}
