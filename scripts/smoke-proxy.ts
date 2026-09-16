/**
 * 抓包代理端到端验证
 *
 * 起两个真实上游服务（明文 + 自签 TLS），让真实请求穿过抓包代理，逐项断言：
 *   CA 签发链 / HTTP 抓包 / gzip 解压 / HTTPS 解密可见正文 / 请求头改写 / 请求体替换 /
 *   响应体替换 / 伪造响应 / 阻断 / 断点放行与丢弃 / 关闭 MITM 的盲隧道 / 重发请求 / 停止后端口释放
 *
 *   npm run smoke:proxy
 *
 * 之所以能在纯 Node 下跑：抓包内核不依赖 electron，宿主能力全部通过回调注入。
 */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { X509Certificate } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { CaptureProxy } from '../electron/main/proxy/server'
import { performRequest } from '../electron/main/http'
import { createRule } from '../electron/main/proxy/rules'
import type { InterceptDecision, InterceptRequest, ProxyRule, ProxySession } from '../src/lib/proxy-types'

let passed = 0
const failures: string[] = []

function check(name: string, ok: boolean, extra = ''): void {
  if (ok) {
    passed++
    console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    failures.push(name)
    console.log(`  ✖ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

function decode(b64: string): string {
  return Buffer.from(b64 || '', 'base64').toString('utf8')
}

async function freePort(): Promise<number> {
  const srv = net.createServer()
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const addr = srv.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  await new Promise<void>((r) => srv.close(() => r()))
  return port
}

interface Received {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: string
}

const main = async (): Promise<void> => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devtoolbox-proxy-'))
  const caDir = path.join(tmp, 'ca')
  const rulesFile = path.join(tmp, 'rules.json')

  /* ---------- 上游：明文服务 ---------- */
  const received: Received[] = []
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body })
      if ((req.url ?? '').startsWith('/gzip')) {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
        res.end(gzipSync(Buffer.from('compressed-payload-and-more')))
        return
      }
      if ((req.url ?? '').startsWith('/redirect')) {
        res.writeHead(302, { location: '/echo?followed=1' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-upstream': 'plain' })
      res.end(`echo:${req.method}:${req.url}:${body}`)
    })
  })
  const upstreamPort = await freePort()
  await new Promise<void>((r) => upstream.listen(upstreamPort, '127.0.0.1', () => r()))

  /* ---------- 代理实例 ---------- */
  const sessions: ProxySession[] = []
  const intercepts: InterceptRequest[] = []
  let interceptHandler: (req: InterceptRequest) => InterceptDecision = () => ({ action: 'forward' })

  const proxy = new CaptureProxy({
    port: await freePort(),
    mitm: true,
    caDir,
    rulesFile,
    onSession: (s) => {
      const idx = sessions.findIndex((x) => x.id === s.id)
      if (idx >= 0) sessions[idx] = s
      else sessions.push(s)
    },
    onIntercept: (req) => {
      intercepts.push(req)
      return Promise.resolve(interceptHandler(req))
    },
    onError: (m) => console.log(`  (代理提示) ${m}`),
  })

  const caInfo = await proxy.authority.init()
  const proxyPort = await proxy.start()
  const proxyUrl = `http://127.0.0.1:${proxyPort}`
  const lastSession = (): ProxySession => sessions[sessions.length - 1]

  console.log('\n[1] 根证书')
  check('根证书已生成并落盘', fs.existsSync(caInfo.certPath) && fs.existsSync(caInfo.keyPath), caInfo.certPath)
  const keyMode = fs.statSync(caInfo.keyPath).mode & 0o777
  check('私钥权限为 600', keyMode === 0o600, `mode=${keyMode.toString(8)}`)
  check('根证书自签且 CN 正确', caInfo.subject.includes('DevOps Toolbox Root CA'), caInfo.subject)
  check('指纹可读', /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(caInfo.fingerprintSha256), caInfo.fingerprintSha256.slice(0, 23) + '…')

  console.log('\n[2] 叶证书签发链')
  const leaf = proxy.authority.leafPems('localhost')
  const leafX509 = new X509Certificate(leaf.cert)
  const caX509 = new X509Certificate(caInfo.certPem)
  check('叶证书由本地 CA 签发（验签通过）', leafX509.verify(caX509.publicKey), `issuer=${leafX509.issuer.split('\n')[0]}`)
  check('叶证书含 SAN=localhost', leafX509.subjectAltName?.includes('DNS:localhost') === true, leafX509.subjectAltName ?? '')
  const ipLeaf = new X509Certificate(proxy.authority.leafPems('127.0.0.1').cert)
  check('IP 主机签发 IP SAN', ipLeaf.subjectAltName?.includes('IP Address:127.0.0.1') === true, ipLeaf.subjectAltName ?? '')

  console.log('\n[3] 明文 HTTP 抓包')
  const plainUrl = `http://127.0.0.1:${upstreamPort}/echo?a=1`
  const r1 = await performRequest({ method: 'POST', url: plainUrl, headers: [['Content-Type', 'text/plain']], bodyText: 'ping', proxy: proxyUrl, rejectUnauthorized: false })
  check('请求成功返回 200', r1.ok && r1.status === 200, `status=${r1.status} err=${r1.error ?? ''}`)
  check('会话已记录', sessions.length === 1 && lastSession().url === plainUrl, `count=${sessions.length}`)
  check('记录了请求方法/路径', lastSession().method === 'POST' && lastSession().path === '/echo?a=1')
  check('记录了响应体明文', decode(lastSession().resBodyBase64).includes('echo:POST:/echo?a=1:ping'), decode(lastSession().resBodyBase64))
  check('响应头被记录（x-upstream）', lastSession().resHeaders.some(([k, v]) => k.toLowerCase() === 'x-upstream' && v === 'plain'))
  check('耗时已统计', lastSession().durationMs >= 0)
  check('未篡改的请求标记 modified=false', lastSession().modified === false)

  console.log('\n[4] gzip 响应自动解压')
  await performRequest({ method: 'GET', url: `http://127.0.0.1:${upstreamPort}/gzip`, proxy: proxyUrl, rejectUnauthorized: false })
  check('客户端拿到解压后正文', decode(lastSession().resBodyBase64) === 'compressed-payload-and-more', decode(lastSession().resBodyBase64))
  check('会话保留 content-encoding 事实', lastSession().resContentEncoding.includes('gzip'))

  /* ---------- 上游：自签 TLS 服务 ---------- */
  const tlsUpstreamReceived: Received[] = []
  const tlsUpstream = https.createServer({ key: leaf.key, cert: leaf.cert }, (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      tlsUpstreamReceived.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ secure: true, path: req.url }))
    })
  })
  const tlsPort = await freePort()
  await new Promise<void>((r) => tlsUpstream.listen(tlsPort, '127.0.0.1', () => r()))

  console.log('\n[5] HTTPS 中间人解密')
  const beforeHttps = sessions.length
  const r2 = await performRequest({
    method: 'POST',
    url: `https://localhost:${tlsPort}/login`,
    headers: [['Content-Type', 'application/json']],
    bodyText: JSON.stringify({ user: 'alice', password: 'secret' }),
    proxy: proxyUrl,
    rejectUnauthorized: false,
  })
  const httpsSession = sessions[beforeHttps]
  check('HTTPS 请求成功', r2.ok && r2.status === 200, `status=${r2.status} body=${decode(r2.bodyBase64).slice(0, 120)} note=${httpsSession?.note ?? ''} err=${httpsSession?.error ?? ''}`)
  check('会话标记为 https', httpsSession?.scheme === 'https', `scheme=${httpsSession?.scheme}`)
  check('请求体明文可见（密码也能看到）', decode(httpsSession?.reqBodyBase64 ?? '').includes('"password":"secret"'), decode(httpsSession?.reqBodyBase64 ?? ''))
  check('响应体明文可见', decode(httpsSession?.resBodyBase64 ?? '').includes('"secure":true'), decode(httpsSession?.resBodyBase64 ?? ''))
  check('上游确实收到请求', tlsUpstreamReceived.length === 1 && tlsUpstreamReceived[0].url === '/login')
  check('未开启系统信任也不影响转发（上游自签证书降级放行）', r2.status === 200)
  check('降级放行在会话里有明确提示', (httpsSession?.note ?? '').includes('降级放行'), httpsSession?.note ?? '')

  console.log('\n[6] 请求头改写 / 请求体替换')
  proxy.ruleSet.replaceAll([
    createRule({
      name: '注入头与替换体',
      host: '127.0.0.1',
      path: '/echo*',
      reqHeaderOps: [
        { action: 'set', name: 'X-Injected', value: 'by-devtoolbox' },
        { action: 'remove', name: 'x-remove-me' },
      ],
      reqBodyFind: 'ping',
      reqBodyReplace: 'pong',
      resBodyFind: 'echo:',
      resBodyReplace: 'ECHO:',
    }),
  ])
  const r3 = await performRequest({
    method: 'POST',
    url: plainUrl,
    headers: [['x-remove-me', 'yes'], ['X-Keep', '1']],
    bodyText: 'ping',
    proxy: proxyUrl,
    rejectUnauthorized: false,
  })
  const ruleSession = lastSession()
  check('上游收到注入的请求头', received[received.length - 1].headers['x-injected'] === 'by-devtoolbox', String(received[received.length - 1].headers['x-injected']))
  check('上游未收到被删除的头', received[received.length - 1].headers['x-remove-me'] === undefined)
  check('上游收到替换后的请求体', received[received.length - 1].body === 'pong', received[received.length - 1].body)
  check('客户端收到替换后的响应体', decode(r3.bodyBase64).startsWith('ECHO:'), decode(r3.bodyBase64))
  check('会话标记被规则命中', ruleSession.matchedRules.includes('注入头与替换体'))
  check('会话标记 modified=true', ruleSession.modified === true)

  console.log('\n[7] 伪造响应与阻断')
  proxy.ruleSet.replaceAll([
    createRule({ name: 'mock 接口', host: '127.0.0.1', path: '/mock*', mock: { status: 201, headers: [['content-type', 'application/json']], bodyText: '{"mocked":true}' } }),
    createRule({ name: '拉黑路径', host: '127.0.0.1', path: '/blocked*', block: true }),
  ])
  const beforeMock = received.length
  const r4 = await performRequest({ method: 'GET', url: `http://127.0.0.1:${upstreamPort}/mock/thing`, proxy: proxyUrl, rejectUnauthorized: false })
  check('客户端拿到伪造响应', r4.status === 201 && decode(r4.bodyBase64) === '{"mocked":true}', `status=${r4.status}`)
  check('伪造请求没有下发上游', received.length === beforeMock)
  check('会话标记 mocked', lastSession().mocked === true)
  const r5 = await performRequest({ method: 'GET', url: `http://127.0.0.1:${upstreamPort}/blocked/secret`, proxy: proxyUrl, rejectUnauthorized: false })
  check('被阻断请求返回 403', r5.status === 403, `status=${r5.status}`)
  check('阻断请求没有下发上游', received.length === beforeMock)
  check('会话标记 blocked', lastSession().blocked === true)

  console.log('\n[8] 断点：暂停 / 改写 / 丢弃')
  proxy.ruleSet.replaceAll([
    createRule({ name: '断点', host: '127.0.0.1', path: '/break*', breakpoint: true }),
  ])
  interceptHandler = (req) => ({
    action: 'forward',
    method: 'PUT',
    headers: [...req.headers.filter(([k]) => k.toLowerCase() !== 'x-break'), ['X-Break', 'edited-in-flight']],
    bodyBase64: Buffer.from('replaced-by-breakpoint', 'utf8').toString('base64'),
  })
  const beforeBreak = received.length
  const r6 = await performRequest({ method: 'POST', url: `http://127.0.0.1:${upstreamPort}/break/1`, headers: [['x-break', 'original']], bodyText: 'original-body', proxy: proxyUrl, rejectUnauthorized: false })
  const broke = received[beforeBreak]
  check('断点事件已推送到宿主', intercepts.length >= 1, `intercepts=${intercepts.length}`)
  check('断点改了方法与头', broke?.method === 'PUT' && broke?.headers['x-break'] === 'edited-in-flight', `${broke?.method} x-break=${broke?.headers['x-break']}`)
  check('断点改了请求体', broke?.body === 'replaced-by-breakpoint', broke?.body ?? '')
  check('客户端仍正常拿到响应', r6.status === 200)
  check('会话标记 intercepted', lastSession().intercepted === true)
  interceptHandler = () => ({ action: 'drop' })
  const beforeDrop = received.length
  const r7 = await performRequest({ method: 'GET', url: `http://127.0.0.1:${upstreamPort}/break/2`, proxy: proxyUrl, rejectUnauthorized: false })
  check('断点丢弃返回 502', r7.status === 502, `status=${r7.status}`)
  check('丢弃的请求没有下发上游', received.length === beforeDrop)

  proxy.ruleSet.clear()

  console.log('\n[9] 关闭 MITM 的盲隧道')
  await proxy.setMitm(false)
  const beforeTunnel = sessions.length
  const target = `https://localhost:${tlsPort}/tunnel`
  const socketBased = await performRequest({ method: 'GET', url: target, proxy: proxyUrl, rejectUnauthorized: false })
  const tunnelSession = sessions[beforeTunnel]
  check('CONNECT 请求被记录为隧道', tunnelSession?.tunneled === true && tunnelSession?.scheme === 'tunnel', `scheme=${tunnelSession?.scheme}`)
  check('隧道模式下仍能拿到上游响应', socketBased.status === 200, `status=${socketBased.status}`)
  check('隧道会话明确提示正文不可见', (tunnelSession?.note ?? '').length > 0, tunnelSession?.note ?? '')
  await proxy.setMitm(true)

  console.log('\n[10] 重发能力（直连 / 经代理）')
  const replayDirect = await performRequest({ method: 'GET', url: `http://127.0.0.1:${upstreamPort}/echo?replay=1` })
  check('直连重发成功', replayDirect.ok && decode(replayDirect.bodyBase64).includes('replay=1'))
  const replayViaProxy = await performRequest({ method: 'GET', url: `http://127.0.0.1:${upstreamPort}/echo?replay=2`, proxy: proxyUrl })
  check('经代理重发成功', replayViaProxy.ok && replayViaProxy.viaProxy && replayViaProxy.status === 200)

  console.log('\n[11] 引擎细节')
  const r8 = await performRequest({ method: 'GET', url: `http://127.0.0.1:${upstreamPort}/redirect`, followRedirects: true })
  check('重定向自动跟随并记录链路', r8.ok && r8.status === 200 && r8.redirects.length === 1 && decode(r8.bodyBase64).includes('followed=1'), `status=${r8.status} chain=${r8.redirects.length}`)
  const r9 = await performRequest({ method: 'GET', url: `http://127.0.0.1:${upstreamPort}/redirect`, followRedirects: false })
  check('关闭跟随时原样返回 302', r9.status === 302 && r9.redirects.length === 0, `status=${r9.status}`)
  const tlsInfo = await performRequest({ method: 'GET', url: `https://localhost:${tlsPort}/tls-info` })
  check('TLS 校验失败被如实报告', !tlsInfo.ok && /self.signed|unable to verify|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(tlsInfo.error ?? ''), tlsInfo.error ?? '')
  check('TLS 失败时 errorCode 可读', !!tlsInfo.errorCode, tlsInfo.errorCode ?? '')
  const badUrl = await performRequest({ method: 'GET', url: 'ftp://example.com/x' })
  check('非 http(s) 协议被拒绝', !badUrl.ok && badUrl.errorCode === 'EBADPROTOCOL', badUrl.error ?? '')

  console.log('\n[12] 停止后释放端口')
  const usedPort = proxy.port
  await proxy.stop()
  const stillOpen = await new Promise<boolean>((resolve) => {
    const s = net.connect(usedPort, '127.0.0.1')
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
    setTimeout(() => { s.destroy(); resolve(false) }, 1000)
  })
  check('代理端口已关闭', stillOpen === false, `port=${usedPort}`)

  // 收尾
  await new Promise<void>((r) => upstream.close(() => r()))
  await new Promise<void>((r) => tlsUpstream.close(() => r()))
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n${failures.length === 0 ? `OK: ${passed} 项断言全部通过` : `${failures.length} 项失败：\n  - ${failures.join('\n  - ')}`}`)
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('验证脚本异常终止：', err)
  process.exit(1)
})
