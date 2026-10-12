import { describe, it, expect } from 'vitest'
import { parseRawRequest, diffRequests } from '../src/lib/toolkit/httpraw'

describe('parseRawRequest', () => {
  it('parses request line, headers and body', () => {
    const raw = [
      'POST /api/x?id=1 HTTP/1.1',
      'Host: a.com',
      'Content-Type: application/json',
      '',
      '{"a":1}',
    ].join('\r\n')
    const r = parseRawRequest(raw)
    expect(r.ok).toBe(true)
    expect(r.request!.method).toBe('POST')
    expect(r.request!.path).toBe('/api/x')
    expect(r.request!.query).toBe('id=1')
    expect(r.request!.headers).toHaveLength(2)
    expect(r.request!.body).toBe('{"a":1}')
  })

  it('parses query params and tags id as idor/sqli', () => {
    const r = parseRawRequest('GET /p?user_id=42 HTTP/1.1\r\nHost: a\r\n\r\n')
    const p = r.request!.params.find((x) => x.name === 'user_id')
    expect(p).toBeTruthy()
    expect(p!.tags).toContain('idor')
  })

  it('parses urlencoded body params', () => {
    const raw = [
      'POST /login HTTP/1.1',
      'Host: a',
      'Content-Type: application/x-www-form-urlencoded',
      '',
      'username=u&password=p',
    ].join('\r\n')
    const r = parseRawRequest(raw)
    expect(r.request!.params.map((p) => p.name)).toEqual(['username', 'password'])
    expect(r.observations!.some((o) => o.id === 'secret.in.param')).toBe(true)
  })

  it('parses JSON body with nested keys', () => {
    const raw = [
      'POST / HTTP/1.1',
      'Host: a',
      'Content-Type: application/json',
      '',
      '{"url":"http://127.0.0.1","meta":{"q":"x"}}',
    ].join('\r\n')
    const r = parseRawRequest(raw)
    const names = r.request!.params.map((p) => p.name)
    expect(names).toContain('url')
    expect(names).toContain('meta.q')
    const urlP = r.request!.params.find((p) => p.name === 'url')
    expect(urlP!.tags).toContain('ssrf')
  })

  it('parses cookies', () => {
    const r = parseRawRequest(
      'GET / HTTP/1.1\r\nHost: a\r\nCookie: session=abc; theme=dark\r\n\r\n',
    )
    expect(r.request!.cookies.map((c) => c.name)).toEqual(['session', 'theme'])
    expect(r.observations!.some((o) => o.id === 'auth.cookie')).toBe(true)
  })

  it('detects Authorization scheme', () => {
    const r = parseRawRequest('GET / HTTP/1.1\r\nHost: a\r\nAuthorization: Bearer xyz\r\n\r\n')
    const o = r.observations!.find((x) => x.id === 'auth.header')
    expect(o?.evidence).toBe('bearer')
  })

  it('flags spoofable IP/Host headers', () => {
    const raw = [
      'GET / HTTP/1.1',
      'Host: a',
      'X-Forwarded-For: 1.2.3.4',
      'X-Forwarded-Host: evil',
    ].join('\r\n')
    const r = parseRawRequest(raw + '\r\n\r\n')
    expect(r.observations!.some((o) => o.id === 'spoof.ip')).toBe(true)
    expect(r.observations!.some((o) => o.id === 'spoof.host')).toBe(true)
  })

  it('tags redirect parameters', () => {
    const r = parseRawRequest('GET /go?redirect_url=https://x HTTP/1.1\r\nHost: a\r\n\r\n')
    const p = r.request!.params.find((x) => x.name === 'redirect_url')
    expect(p!.tags).toContain('redirect')
  })

  it('rejects garbage', () => {
    expect(parseRawRequest('not a request').ok).toBe(false)
    expect(parseRawRequest('').ok).toBe(false)
  })

  it('parses multipart form fields', () => {
    const body =
      '--B\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\nhello\r\n--B\r\nContent-Disposition: form-data; name="id"\r\n\r\n7\r\n--B--\r\n'
    const raw = [
      'POST /upload HTTP/1.1',
      'Host: a',
      'Content-Type: multipart/form-data; boundary=B',
      '',
      body,
    ].join('\r\n')
    const r = parseRawRequest(raw)
    const names = r.request!.params.map((p) => p.name)
    expect(names).toContain('file')
    expect(names).toContain('id')
  })
})

describe('diffRequests', () => {
  it('detects changed path, header and body', () => {
    const a = parseRawRequest('GET /a HTTP/1.1\r\nHost: x\r\nX-A: 1\r\n\r\n').request!
    const b = parseRawRequest('GET /b HTTP/1.1\r\nHost: x\r\nX-A: 2\r\nX-B: 3\r\n\r\n').request!
    const d = diffRequests(a, b)
    const kinds = d.map((x) => `${x.kind}:${x.name ?? ''}:${x.change}`)
    expect(kinds).toContain('path::changed')
    expect(kinds).toContain('header:X-A:changed')
    expect(kinds).toContain('header:X-B:added')
  })
})
