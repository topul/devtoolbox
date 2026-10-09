/**
 * TLS 握手探测冒烟。
 *
 * 起一个**真实的本地 TLS 服务器**（自签证书）来验证——这个模块的全部价值就是
 * 「连上一次拿到真实协商结果」，用假对象测等于什么都没验。
 * 证书现场生成（node-forge 已在依赖里）。
 *
 * 覆盖：
 *   1. 对真实 TLS 服务器的探测成功路径
 *   2. 自签证书的 authorized=false 但仍要拿到完整证书链
 *   3. 证书字段（CN/有效期/指纹）解析正确
 *   4. 连不上的目标要报错而不是挂住
 *   5. 超时要能收场
 *   6. IP 直连不因SNI 报错
 *   7. 端口缺省用 443
 */
import https from 'node:https'
import forge from 'node-forge'
import { probeTls } from '../electron/main/tls-probe'
import type { TlsProbe } from '../src/lib/tls-types'

let pass = 0
const fails: string[] = []
function ok(cond: boolean, label: string): void {
  if (cond) {
    pass++
    return
  }
  fails.push(label)
  console.error(`  ✗ ${label}`)
}
function eq<T>(got: T, want: T, label: string): void {
  ok(got === want, `${label}（期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}）`)
}

/* ================= 现场生成自签证书 ================= */

function makeSelfSigned(): { key: string; cert: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86400000)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000)
  const attrs = [{ name: 'commonName', value: 'localhost' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  // SAN 里放多个域名，验证解析时能全部取到
  cert.setExtensions([
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
      ],
    },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) }
}

const { key, cert } = makeSelfSigned()

/** 起本地 TLS 服务器 */
function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = https.createServer({ key, cert }, (_req, res) => {
      res.end('ok')
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        close: () =>
          new Promise<void>((r) => {
            // 主动 destroy 活跃连接，否则 server.close() 会等连接释放而挂住
            server.closeAllConnections?.()
            server.close(() => r())
          }),
      })
    })
  })
}

/* ================= 测试 ================= */

const srv = await startServer()
ok(srv.port > 0, `本地 TLS 服务器已启动（端口 ${srv.port}）`)

try {
  /* --- 1. 成功路径 --- */
  const r: TlsProbe = await probeTls('127.0.0.1', srv.port, 8000)
  ok(r.ok, '探测成功')
  eq(r.errorCode, undefined, '成功时没有 errorCode')
  eq(r.host, '127.0.0.1', 'host 正确')
  eq(r.port, srv.port, 'port 正确')
  ok(r.elapsedMs >= 0, `耗时 ${r.elapsedMs}ms 非负`)
  ok(r.elapsedMs < 8000, '耗时不超超时值')

  /* --- 2. 协议与加密套件 --- */
  ok(/^TLSv1\.[23]$/.test(r.protocol), `协商出 TLS 版本（实际 ${r.protocol}）`)
  ok(r.cipher.length > 0, `拿到加密套件（实际 ${r.cipher}）`)

  /* --- 3. 自签证书：authorized=false 但证书链要拿得到 --- */
  eq(r.authorized, false, '自签证书 authorized=false')
  ok(r.authorizationError.length > 0, `授权错误有说明（${r.authorizationError}）`)
  ok(r.certs.length >= 1, `拿到至少 1 张证书（实际 ${r.certs.length}）`)

  /* --- 4. 证书字段 --- */
  const c = r.certs[0]
  eq(c.subject, 'localhost', '证书 CN 正确')
  eq(c.issuer, 'localhost', '签发者 CN 正确（自签）')
  ok(c.serial.length > 0, '有序列号')
  ok(c.fingerprint256.length >= 32, `SHA-256 指纹存在（${c.fingerprint256.slice(0, 20)}…）`)
  ok(c.fingerprint1.length > 0, 'SHA-1 指纹存在')
  ok(c.domains.includes('localhost'), `SAN 含 localhost（实际 ${c.domains.join(',')}）`)
  ok(c.daysLeft > 300 && c.daysLeft <= 365, `剩余天数合理（${c.daysLeft}）`)
  ok(c.keyBits === 2048, `密钥位数 2048（实际 ${c.keyBits}）`)
  ok(c.pubkeyAlg === 'RSA', `公钥算法 RSA（实际 ${c.pubkeyAlg}）`)
  ok(c.sigAlg.includes('sha256'), `签名算法含 sha256（实际 ${c.sigAlg}）`)

  /* --- 5. IP 直连标记 --- */
  eq(r.isIpHost, true, 'IP 主机被标记')

  /* --- 6. localhost 走SNI 路径 --- */
  const r2 = await probeTls('localhost', srv.port, 8000)
  ok(r2.ok, '用 localhost 也能连上')
  eq(r2.isIpHost, false, 'localhost 不算 IP')
  eq(r2.sni, 'localhost', 'SNI 填了主机名')

  /* --- 7. 端口缺省用 443 --- */
  const r3 = await probeTls('example.invalid', 0, 300)
  eq(r3.port, 443, '端口 0 归一为 443')

  /* --- 8. 连不上要报错（DNS 失败） --- */
  const r4 = await probeTls('this-host-does-not-exist.invalid', 443, 3000)
  eq(r4.ok, false, '不存在的域名探测失败')
  ok(!!r4.errorCode, `有错误码（${r4.errorCode}）`)
  ok(r4.elapsedMs >= 0, '失败时也有耗时')

  /* --- 9. 连上但立刻断开（对未监听端口） --- */
  const r5 = await probeTls('127.0.0.1', 1, 2000)
  eq(r5.ok, false, '未监听端口探测失败')
  ok(
    ['ECONNREFUSED', 'CONN_FAILED', 'ETIMEDOUT'].includes(r5.errorCode ?? ''),
    `错误码合理（${r5.errorCode}）`,
  )

  /* --- 10. 超时要能收场（连一个丢弃包的地址） --- */
  // 203.0.113.x 是 TEST-NET-3，RFC 5737 保留，不会真的连上
  const t0 = Date.now()
  const r6 = await probeTls('203.0.113.1', 443, 1200)
  const took = Date.now() - t0
  eq(r6.ok, false, '超时目标探测失败')
  ok(took < 6000, `超时后能收场（实际 ${took}ms，未挂住）`)

  /* --- 11. 超时值真的生效 --- */
  const t1 = Date.now()
  await probeTls('203.0.113.1', 443, 800)
  const took2 = Date.now() - t1
  ok(took2 >= 700 && took2 < 5000, `800ms 超时在合理时间收场（实际 ${took2}ms）`)

  /* --- 12. 证书链自引用不会死循环 --- */
  // 自签证书的 issuerCertificate 指回自己；collectChain 有 visited 保护
  const r7 = await probeTls('127.0.0.1', srv.port, 5000)
  ok(r7.ok && r7.certs.length <= 5, `自引用证书链被截断（${r7.certs.length} 张，上限 5）`)
} finally {
  await srv.close()
}

ok(true, '本地服务器已关闭')

/* ================= 结果 ================= */

if (fails.length) {
  console.error(`\n✗ smoke:tls 失败：${pass} 通过 / ${fails.length} 失败`)
  process.exit(1)
}
console.log(`✓ smoke:tls ${pass} 项全部通过`)
