import { describe, expect, it } from 'vitest'
import {
  buildRawRequest,
  createHandoffBus,
  filterReplayHeaders,
  handoffToCorsBlock,
  handoffToCsp,
  handoffToDoc,
  handoffToHostPath,
  handoffToRaw,
  sessionToHandoff,
} from '../src/lib/handoff'
import type { ProxySession } from '../src/lib/proxy-types'

/** 最小合法会话：只填交接关心的字段，其余给空值占位 */
function fakeSession(over: Partial<ProxySession>): ProxySession {
  return {
    id: 's1',
    seq: 7,
    startedAt: 0,
    scheme: 'http',
    method: 'GET',
    url: 'http://a.com/',
    host: 'a.com',
    path: '/',
    reqHeaders: [],
    reqBodyBase64: '',
    reqBodyBytes: 0,
    status: 200,
    statusText: 'OK',
    resHeaders: [],
    resBodyBase64: '',
    resBodyBytes: 0,
    resContentEncoding: '',
    resTruncated: false,
    durationMs: 1,
    clientIp: '',
    matchedRules: [],
    modified: false,
    intercepted: false,
    mocked: false,
    blocked: false,
    tunneled: false,
    ...over,
  }
}

describe('sessionToHandoff', () => {
  it('文本请求：整条会话带出，raw 用 origin-form，正文完整', () => {
    const s = fakeSession({
      method: 'POST',
      url: 'http://a.com/login?x=1',
      path: '/login?x=1',
      reqHeaders: [
        ['Host', 'a.com'],
        ['Cookie', 's=1'],
      ],
      reqBodyBase64: btoa('a=1&b=2'),
      reqBodyBytes: 7,
      status: 302,
      resHeaders: [['Location', '/home']],
    })
    const p = sessionToHandoff(s)
    expect(p.sourceLabel).toBe('#7 POST /login?x=1')
    expect(p.method).toBe('POST')
    expect(p.reqBodyText).toBe('a=1&b=2')
    expect(p.reqBodyBinary).toBe(false)
    expect(p.rawRequest).toBe(
      'POST /login?x=1 HTTP/1.1\r\nHost: a.com\r\nCookie: s=1\r\n\r\na=1&b=2',
    )
    expect(p.resStatus).toBe(302)
    expect(p.resHeaders).toEqual([['Location', '/home']])
    expect(p.proxy).toBeNull()
  })

  it('二进制请求体：置标志、正文以 null 交接、raw 中留空', () => {
    const bin = Uint8Array.from([0, 1, 2, 255])
    const s = fakeSession({
      reqBodyBase64: btoa(String.fromCharCode(...bin)),
      reqBodyBytes: bin.length,
    })
    const p = sessionToHandoff(s)
    expect(p.reqBodyBinary).toBe(true)
    expect(p.reqBodyText).toBeNull()
    expect(p.rawRequest?.endsWith('\r\n\r\n')).toBe(true)
  })

  it('path 缺失时由绝对 URL 还原 target，URL 非法兜底 /', () => {
    expect(sessionToHandoff(fakeSession({ path: '', url: 'https://a.com/x?y=1' })).rawRequest).toBe(
      'GET /x?y=1 HTTP/1.1\r\n\r\n',
    )
    expect(sessionToHandoff(fakeSession({ path: '', url: 'bad' })).rawRequest).toBe(
      'GET / HTTP/1.1\r\n\r\n',
    )
  })

  it('opts.proxy 透传，未给时为 null', () => {
    expect(sessionToHandoff(fakeSession({}), { proxy: 'http://127.0.0.1:8899' }).proxy).toBe(
      'http://127.0.0.1:8899',
    )
  })
})

describe('handoff bus', () => {
  it('push/take 按目标分槽、FIFO、取走即移除', () => {
    const bus = createHandoffBus()
    bus.push('httpreq', { sourceLabel: 'a' })
    bus.push('httpreq', { sourceLabel: 'b' })
    bus.push('smuggling', { sourceLabel: 'c' })
    expect(bus.take('httpreq')?.sourceLabel).toBe('a')
    expect(bus.take('httpreq')?.sourceLabel).toBe('b')
    expect(bus.take('httpreq')).toBeNull()
    // 别的槽不受影响
    expect(bus.take('smuggling')?.sourceLabel).toBe('c')
  })

  it('pending 反映槽内是否有待取', () => {
    const bus = createHandoffBus()
    expect(bus.pending('cspaudit')).toBe(false)
    bus.push('cspaudit', { sourceLabel: 'x' })
    expect(bus.pending('cspaudit')).toBe(true)
    bus.take('cspaudit')
    expect(bus.pending('cspaudit')).toBe(false)
  })

  it('超过容量丢最旧的', () => {
    const bus = createHandoffBus({ capPerTarget: 2 })
    bus.push('reqdiff-a', { sourceLabel: '1' })
    bus.push('reqdiff-a', { sourceLabel: '2' })
    bus.push('reqdiff-a', { sourceLabel: '3' })
    expect(bus.take('reqdiff-a')?.sourceLabel).toBe('2')
    expect(bus.take('reqdiff-a')?.sourceLabel).toBe('3')
  })

  it('TTL 过期的条目取不到', () => {
    let t = 1000
    const bus = createHandoffBus({ ttlMs: 100, now: () => t })
    bus.push('httpreq', { sourceLabel: 'old' })
    t = 1200
    expect(bus.take('httpreq')).toBeNull()
  })

  it('subscribe 在 push 时通知，退订后不再收到', () => {
    const bus = createHandoffBus()
    let n = 0
    const off = bus.subscribe(() => n++)
    bus.push('httpreq', { sourceLabel: 'a' })
    off()
    bus.push('httpreq', { sourceLabel: 'b' })
    expect(n).toBe(1)
  })

  it('clear 可清单槽或清空全部', () => {
    const bus = createHandoffBus()
    bus.push('httpreq', { sourceLabel: 'a' })
    bus.push('smuggling', { sourceLabel: 'b' })
    bus.clear('httpreq')
    expect(bus.pending('httpreq')).toBe(false)
    expect(bus.pending('smuggling')).toBe(true)
    bus.clear()
    expect(bus.pending('smuggling')).toBe(false)
  })
})

describe('filterReplayHeaders', () => {
  it('剔除逐跳/连接绑定头，保留业务头（大小写不敏感）', () => {
    const out = filterReplayHeaders([
      ['Host', 'example.com'],
      ['content-length', '12'],
      ['Proxy-Connection', 'keep-alive'],
      ['Accept-Encoding', 'gzip'],
      ['Authorization', 'Bearer x'],
      ['X-Custom', '1'],
    ])
    expect(out.map(([k]) => k)).toEqual(['Authorization', 'X-Custom'])
  })
})

describe('buildRawRequest / handoffToRaw', () => {
  it('按 CRLF 拼请求行/头/空行/body', () => {
    const raw = buildRawRequest({
      method: 'POST',
      target: '/api?x=1',
      headers: [
        ['Host', 'a.com'],
        ['Content-Type', 'application/json'],
      ],
      bodyText: '{"k":1}',
    })
    expect(raw).toBe(
      'POST /api?x=1 HTTP/1.1\r\nHost: a.com\r\nContent-Type: application/json\r\n\r\n{"k":1}',
    )
  })

  it('有现成 rawRequest 时原样使用', () => {
    expect(handoffToRaw({ sourceLabel: '', rawRequest: 'GET / HTTP/1.1\r\n\r\n' })).toBe(
      'GET / HTTP/1.1\r\n\r\n',
    )
  })

  it('缺 raw 时由绝对 URL 还原 origin-form', () => {
    const raw = handoffToRaw({
      sourceLabel: '',
      method: 'get',
      url: 'https://a.com/x?y=1',
      reqHeaders: [['Host', 'a.com']],
    })
    expect(raw.startsWith('GET /x?y=1 HTTP/1.1\r\n')).toBe(true)
  })
})

describe('handoffToDoc', () => {
  it('方法大写、过滤逐跳头、文本正文、不跟随跳转/不校验 TLS', () => {
    const doc = handoffToDoc({
      sourceLabel: '',
      method: 'post',
      url: 'https://a.com/',
      reqHeaders: [
        ['Host', 'a.com'],
        ['Content-Type', 'text/plain'],
        ['Cookie', 's=1'],
      ],
      reqBodyText: 'hi',
    })
    expect(doc.method).toBe('POST')
    expect(doc.headers.map(([k]) => k)).toEqual(['Content-Type', 'Cookie'])
    expect(doc.body).toEqual({ kind: 'text', text: 'hi' })
    expect(doc.followRedirects).toBe(false)
    expect(doc.verifyTls).toBe(false)
  })

  it('二进制/空正文归一为 none', () => {
    expect(handoffToDoc({ sourceLabel: '', reqBodyText: null }).body).toEqual({ kind: 'none' })
    expect(handoffToDoc({ sourceLabel: '' }).body).toEqual({ kind: 'none' })
  })
})

describe('handoffToCorsBlock', () => {
  it('用请求 Origin 与响应头块拼 CORS 分析输入', () => {
    const r = handoffToCorsBlock({
      sourceLabel: '',
      reqHeaders: [['Origin', 'https://evil.example']],
      resStatus: 200,
      resHeaders: [
        ['Access-Control-Allow-Origin', 'https://evil.example'],
        ['Access-Control-Allow-Credentials', 'true'],
      ],
    })
    expect(r.origin).toBe('https://evil.example')
    expect(r.block).toBe(
      'HTTP/1.1 200\r\nAccess-Control-Allow-Origin: https://evil.example\r\nAccess-Control-Allow-Credentials: true',
    )
  })
})

describe('handoffToCsp', () => {
  it('提取 CSP 头值，多条（含 Report-Only）逗号合并', () => {
    expect(
      handoffToCsp({
        sourceLabel: '',
        resHeaders: [
          ['Content-Type', 'text/html'],
          ['Content-Security-Policy', "default-src 'self'"],
          ['Content-Security-Policy-Report-Only', 'script-src https://cdn.example'],
        ],
      }),
    ).toBe("default-src 'self', script-src https://cdn.example")
  })
  it('没有 CSP 头返回 null', () => {
    expect(handoffToCsp({ sourceLabel: '', resHeaders: [['X-Foo', '1']] })).toBeNull()
  })
})

describe('handoffToHostPath', () => {
  it('非默认端口保留，默认端口省略', () => {
    expect(handoffToHostPath({ sourceLabel: '', url: 'https://a.com:8443/x/y?z=1' })).toEqual({
      host: 'a.com:8443',
      path: '/x/y',
    })
    expect(handoffToHostPath({ sourceLabel: '', url: 'http://a.com/' })).toEqual({
      host: 'a.com',
      path: '/',
    })
  })
  it('无 URL 或非法 URL 返回 null', () => {
    expect(handoffToHostPath({ sourceLabel: '' })).toBeNull()
    expect(handoffToHostPath({ sourceLabel: '', url: 'not a url' })).toBeNull()
  })
})
