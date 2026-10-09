import { describe, expect, it } from 'vitest'
import {
  applyEnvToRequest,
  authHeaderPairs,
  bodyFromParts,
  buildFinalHeaders,
  DEFAULT_AUTH,
  inferBodyMode,
  row,
  type AuthState,
} from '../src/lib/httpclient-model'

const auth = (patch: Partial<AuthState>): AuthState => ({ ...DEFAULT_AUTH, ...patch })

describe('authHeaderPairs', () => {
  it('basic 认证生成 base64 的 Authorization 头', () => {
    expect(authHeaderPairs(auth({ type: 'basic', username: 'u', password: 'p' }))).toEqual([
      ['Authorization', `Basic ${btoa('u:p')}`],
    ])
  })
  it('bearer 空 token 不产出请求头', () => {
    expect(authHeaderPairs(auth({ type: 'bearer', token: '' }))).toEqual([])
    expect(authHeaderPairs(auth({ type: 'bearer', token: 't' }))).toEqual([
      ['Authorization', 'Bearer t'],
    ])
  })
  it('apikey 头名为空时回落 X-API-Key，前缀原样拼接', () => {
    expect(authHeaderPairs(auth({ type: 'apikey', headerName: '  ', token: 'k' }))).toEqual([
      ['X-API-Key', 'k'],
    ])
    expect(
      authHeaderPairs(
        auth({ type: 'apikey', headerName: 'X-Key', headerPrefix: 'Bearer ', token: 'k' }),
      ),
    ).toEqual([['X-Key', 'Bearer k']])
  })
})

describe('buildFinalHeaders', () => {
  it('过滤禁用行与空名行，手工行 trim 头名', () => {
    expect(
      buildFinalHeaders({
        headers: [row('A', '1'), row('B', '2', false), row('  ', '3'), row(' C ', '4')],
        authHeaders: [],
        bodyContentType: null,
      }),
    ).toEqual([
      ['A', '1'],
      ['C', '4'],
    ])
  })
  it('认证头按名字覆盖同名手工头（大小写不敏感），没有则追加', () => {
    const headers = buildFinalHeaders({
      headers: [row('authorization', 'Basic old'), row('X-A', '1')],
      authHeaders: [['Authorization', 'Bearer new']],
      bodyContentType: null,
    })
    expect(headers).toContainEqual(['authorization', 'Bearer new'])
    expect(headers).toContainEqual(['X-A', '1'])
  })
  it('没有 Content-Type 时补上正文类型，已有则不覆盖', () => {
    const added = buildFinalHeaders({
      headers: [],
      authHeaders: [],
      bodyContentType: 'application/json',
    })
    expect(added).toContainEqual(['Content-Type', 'application/json'])
    const kept = buildFinalHeaders({
      headers: [row('content-type', 'text/plain')],
      authHeaders: [],
      bodyContentType: 'application/json',
    })
    expect(kept).toEqual([['content-type', 'text/plain']])
  })
})

describe('inferBodyMode', () => {
  it('Content-Type 优先于内容嗅探', () => {
    expect(inferBodyMode('application/json', 'not json')).toBe('json')
    expect(inferBodyMode('text/xml', '')).toBe('xml')
    expect(inferBodyMode('text/html; charset=utf-8', '')).toBe('html')
    expect(inferBodyMode('application/javascript', '')).toBe('javascript')
  })
  it('认不出类型时按内容嗅探：合法 JSON 当 json，否则 text', () => {
    expect(inferBodyMode('application/octet-stream', '{"a":1}')).toBe('json')
    expect(inferBodyMode('', 'plain text')).toBe('text')
  })
})

describe('bodyFromParts', () => {
  it('form / multipart 走字段且只保留启用且有名字的行', () => {
    expect(bodyFromParts('form', [row('a', '1'), row('', '2'), row('b', '3', false)], '')).toEqual({
      kind: 'fields',
      fields: [['a', '1']],
      multipart: false,
    })
    expect(bodyFromParts('multipart', [row('a', '1')], '')).toEqual({
      kind: 'fields',
      fields: [['a', '1']],
      multipart: true,
    })
  })
  it('none 或空正文按 none，其余按 text 原文', () => {
    expect(bodyFromParts('none', [], 'x')).toEqual({ kind: 'none' })
    expect(bodyFromParts('json', [], '   ')).toEqual({ kind: 'none' })
    expect(bodyFromParts('json', [], ' {"a":1} ')).toEqual({ kind: 'text', text: ' {"a":1} ' })
  })
})

describe('applyEnvToRequest', () => {
  it('URL / 头 / 正文一次性插值', () => {
    const r = applyEnvToRequest({
      url: 'https://api.example.com/{{ver}}/x',
      headers: [['Authorization', 'Bearer {{token}}']],
      bodyText: '{"k":"{{token}}"}',
      envMap: { ver: 'v1', token: 't' },
      formFields: null,
    })
    expect(r).toEqual({
      ok: true,
      url: 'https://api.example.com/v1/x',
      headers: [['Authorization', 'Bearer t']],
      bodyText: '{"k":"t"}',
    })
  })
  it('有缺失变量时阻断发送并汇总 missing（去重、按出现顺序）', () => {
    const r = applyEnvToRequest({
      url: '/{{a}}',
      headers: [['H', '{{b}}']],
      bodyText: '{{a}}',
      envMap: {},
      formFields: null,
    })
    expect(r).toEqual({ ok: false, missing: ['a', 'b'] })
  })
  it('form 正文按字段插值后再整体 urlencoded，值里的 & = 不会破坏结构', () => {
    const r = applyEnvToRequest({
      url: '/post',
      headers: [],
      bodyText: null,
      envMap: { v: '1&2' },
      formFields: [row('q', '{{v}}'), row('x', 'ok')],
    })
    expect(r).toEqual({ ok: true, url: '/post', headers: [], bodyText: 'q=1%262&x=ok' })
  })
  it('form 的正文一律由字段重建（即使原文是 null）；formFields 为 null 时正文原样透传', () => {
    const rebuilt = applyEnvToRequest({
      url: '/post',
      headers: [],
      bodyText: null,
      envMap: { v: '1' },
      formFields: [row('q', '{{v}}')],
    })
    expect(rebuilt).toEqual({ ok: true, url: '/post', headers: [], bodyText: 'q=1' })
    const passthrough = applyEnvToRequest({
      url: '/post',
      headers: [],
      bodyText: null,
      envMap: { v: '1' },
      formFields: null,
    })
    expect(passthrough).toEqual({ ok: true, url: '/post', headers: [], bodyText: null })
  })
})
