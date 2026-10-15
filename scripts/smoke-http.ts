/**
 * HTTP 引擎（electron/main/http.ts）端到端验证
 *
 * 起一个真实上游服务，逐项断言引擎能力：
 *   TTFB 计时 / gzip·br·deflate 解压矩阵 / 响应体截断 / 重定向链与方法降级 /
 *   Content-Length 大小写不敏感（不重复补头）/ URL 容错与协议拦截
 *
 *   npm run smoke:http
 *
 * 引擎不依赖 electron，可在纯 Node 下跑。
 */
import http from 'node:http'
import net from 'node:net'
import { Buffer } from 'node:buffer'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { MAX_BODY_BYTES, performRequest } from '../electron/main/http'

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

/** 记录最后一次请求的回声（方法 / 原始头 / 正文） */
let lastEcho = { method: '', rawHeaders: [] as string[], body: '' }

function startUpstream(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      lastEcho = {
        method: req.method ?? '',
        rawHeaders: req.rawHeaders,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      const url = req.url ?? '/'
      const json = (obj: unknown): void => {
        const b = Buffer.from(JSON.stringify(obj))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(b)
      }
      if (url === '/delay') {
        // 延迟 150ms 再回：TTFB 必须显著大于 0
        setTimeout(() => json({ ok: true }), 150)
        return
      }
      if (url === '/gzip') {
        res.writeHead(200, { 'content-encoding': 'gzip' })
        res.end(gzipSync(Buffer.from('{"zip":true}')))
        return
      }
      if (url === '/br') {
        res.writeHead(200, { 'content-encoding': 'br' })
        res.end(brotliCompressSync(Buffer.from('{"br":true}')))
        return
      }
      if (url === '/deflate') {
        res.writeHead(200, { 'content-encoding': 'deflate' })
        res.end(deflateSync(Buffer.from('{"deflate":true}')))
        return
      }
      if (url === '/big') {
        // 超过 MAX_BODY_BYTES 的大正文：必须被截断
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(Buffer.alloc(MAX_BODY_BYTES + 1024, 'a'))
        return
      }
      if (url === '/echo-headers') {
        json({ method: lastEcho.method, rawHeaders: lastEcho.rawHeaders, body: lastEcho.body })
        return
      }
      if (url === '/r302') {
        res.writeHead(302, { location: '/final' })
        res.end()
        return
      }
      if (url === '/r303') {
        res.writeHead(303, { location: '/final' })
        res.end()
        return
      }
      if (url === '/r307') {
        res.writeHead(307, { location: '/final' })
        res.end()
        return
      }
      if (url === '/chain1') {
        res.writeHead(302, { location: '/chain2' })
        res.end()
        return
      }
      if (url === '/chain2') {
        res.writeHead(302, { location: '/chain3' })
        res.end()
        return
      }
      if (url === '/chain3') {
        res.writeHead(302, { location: '/final' })
        res.end()
        return
      }
      if (url === '/final') {
        json({ method: lastEcho.method, body: lastEcho.body, reached: true })
        return
      }
      res.writeHead(404)
      res.end('not found')
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

async function main(): Promise<void> {
  const port = await freePort()
  const server = await startUpstream(port)
  const base = `http://127.0.0.1:${port}`

  try {
    /* ---- TTFB ---- */
    {
      const r = await performRequest({ url: `${base}/delay`, method: 'GET' })
      check('TTFB 反映首字节耗时（非恒 0）', r.ok && r.timings.ttfbMs >= 100, `ttfb=${r.timings.ttfbMs}ms`)
      check('TTFB 不超过总耗时', r.timings.ttfbMs <= r.timings.totalMs)
      check('耗时分解字段齐全', typeof r.timings.connectMs === 'number' && typeof r.timings.tlsMs === 'number')
    }

    /* ---- 解压矩阵 ---- */
    {
      const g = await performRequest({ url: `${base}/gzip`, method: 'GET' })
      check('gzip 自动解压', g.ok && g.decompressed && decode(g.bodyBase64) === '{"zip":true}')
      const b = await performRequest({ url: `${base}/br`, method: 'GET' })
      check('brotli 自动解压', b.ok && b.decompressed && decode(b.bodyBase64) === '{"br":true}')
      const d = await performRequest({ url: `${base}/deflate`, method: 'GET' })
      check('deflate 自动解压', d.ok && d.decompressed && decode(d.bodyBase64) === '{"deflate":true}')
    }

    /* ---- 截断 ---- */
    {
      const r = await performRequest({ url: `${base}/big`, method: 'GET' })
      const shown = Buffer.from(r.bodyBase64, 'base64').length
      check(
        '超大响应体被截断到上限',
        r.ok && r.truncated && shown === MAX_BODY_BYTES && r.bodyBytes > MAX_BODY_BYTES,
        `shown=${shown} full=${r.bodyBytes}`,
      )
    }

    /* ---- 重定向 ---- */
    {
      const r = await performRequest({ url: `${base}/r302`, method: 'GET' })
      check('302 跟随重定向', r.ok && r.status === 200 && r.redirects.length === 1, decode(r.bodyBase64))

      const noFollow = await performRequest({
        url: `${base}/r302`,
        method: 'GET',
        followRedirects: false,
      })
      check('关闭跟随则返回 302 本体', noFollow.ok && noFollow.status === 302 && noFollow.redirects.length === 0)

      const post303 = await performRequest({
        url: `${base}/r303`,
        method: 'POST',
        bodyText: 'payload',
      })
      check('303 后 POST 降级为 GET 且丢弃正文', post303.ok && post303.status === 200, decode(post303.bodyBase64))
      check('303 降级结果内容正确', decode(post303.bodyBase64).includes('"method":"GET"') && decode(post303.bodyBase64).includes('"body":""'))

      const post307 = await performRequest({
        url: `${base}/r307`,
        method: 'POST',
        bodyText: 'payload',
      })
      check('307 保留方法与正文', post307.ok && decode(post307.bodyBase64).includes('"method":"POST"') && decode(post307.bodyBase64).includes('"body":"payload"'))

      const chain = await performRequest({ url: `${base}/chain1`, method: 'GET', maxRedirects: 2 })
      check('重定向次数超上限时返回最后一跳的响应', chain.ok && chain.status === 302 && chain.redirects.length === 2)
    }

    /* ---- Content-Length 大小写不敏感 ---- */
    {
      const r = await performRequest({
        url: `${base}/echo-headers`,
        method: 'POST',
        headers: [['content-length', '5']],
        bodyText: 'hello',
      })
      const raw = r.ok ? JSON.parse(decode(r.bodyBase64)) : { rawHeaders: [] }
      const clCount = (raw.rawHeaders as string[]).filter(
        (_v, i) => i % 2 === 0 && String(raw.rawHeaders[i]).toLowerCase() === 'content-length',
      ).length
      check('手填小写 content-length 不再被重复补头', r.ok && clCount === 1, `出现 ${clCount} 次`)

      const auto = await performRequest({
        url: `${base}/echo-headers`,
        method: 'POST',
        bodyText: 'hello',
      })
      const raw2 = auto.ok ? JSON.parse(decode(auto.bodyBase64)) : { rawHeaders: [] }
      const cl2 = (raw2.rawHeaders as string[]).filter(
        (_v, i) => i % 2 === 0 && String(raw2.rawHeaders[i]).toLowerCase() === 'content-length',
      )
      check('未填 content-length 时自动补正确值', auto.ok && cl2.length === 1 && raw2.rawHeaders[raw2.rawHeaders.indexOf(cl2[0]) + 1] === '5')
    }

    /* ---- URL 容错 ---- */
    {
      const noScheme = await performRequest({ url: `127.0.0.1:${port}/final`, method: 'GET' })
      check('无协议自动补 http://', noScheme.ok && noScheme.status === 200)
      const badProto = await performRequest({ url: 'ftp://example.com/x', method: 'GET' })
      check('非 http/https 协议被拦截', !badProto.ok && badProto.errorCode === 'EBADPROTOCOL')
      const badUrl = await performRequest({ url: 'http://', method: 'GET' })
      check('坏 URL 返回稳定错误码', !badUrl.ok && badUrl.errorCode === 'EBADURL')
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }

  console.log(`\n${passed} 通过，${failures.length} 失败`)
  if (failures.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
