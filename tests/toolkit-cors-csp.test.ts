import { describe, it, expect } from 'vitest'
import { analyzeCors } from '../src/lib/toolkit/cors'
import { analyzeCsp } from '../src/lib/toolkit/csp'

describe('analyzeCors', () => {
  it('flags reflected origin + credentials as critical', () => {
    const r = analyzeCors({
      origin: 'https://evil.example',
      headers: [
        'Access-Control-Allow-Origin: https://evil.example',
        'Access-Control-Allow-Credentials: true',
      ].join('\n'),
    })
    expect(
      r.findings.some((f) => f.id === 'reflect.credentials' && f.severity === 'critical'),
    ).toBe(true)
    expect(r.poc).toContain('credentials:')
    expect(r.poc).toContain("'include'")
  })

  it('reflected origin without credentials is high', () => {
    const r = analyzeCors({
      origin: 'https://evil.example',
      headers: 'Access-Control-Allow-Origin: https://evil.example',
    })
    expect(r.findings.some((f) => f.severity === 'high')).toBe(true)
  })

  it('wildcard + credentials is browser-blocked, not critical', () => {
    const r = analyzeCors({
      origin: 'https://evil.example',
      headers: ['Access-Control-Allow-Origin: *', 'Access-Control-Allow-Credentials: true'].join(
        '\n',
      ),
    })
    expect(r.findings.some((f) => f.severity === 'critical')).toBe(false)
    expect(r.findings.some((f) => f.id === 'wildcard.credentials.browserBlocked')).toBe(true)
  })

  it('plain wildcard is low', () => {
    const r = analyzeCors({
      origin: 'https://evil.example',
      headers: 'Access-Control-Allow-Origin: *',
    })
    expect(r.findings.some((f) => f.id === 'wildcard.readonly')).toBe(true)
  })

  it('null origin with credentials is high', () => {
    const r = analyzeCors({
      origin: 'null',
      headers: ['Access-Control-Allow-Origin: null', 'Access-Control-Allow-Credentials: true'].join(
        '\n',
      ),
    })
    expect(r.findings.some((f) => f.id === 'null.credentials' && f.severity === 'high')).toBe(true)
  })

  it('static origin is informational', () => {
    const r = analyzeCors({
      origin: 'https://evil.example',
      headers: 'Access-Control-Allow-Origin: https://app.example',
    })
    expect(r.findings.some((f) => f.id === 'static.origin')).toBe(true)
    expect(r.poc).toBeNull()
  })

  it('no CORS header at all', () => {
    const r = analyzeCors({ origin: 'https://evil.example', headers: 'Content-Type: text/html' })
    expect(r.findings.some((f) => f.id === 'acao.absent')).toBe(true)
  })
})

describe('analyzeCsp', () => {
  it('parses directives', () => {
    const r = analyzeCsp("default-src 'self'; img-src *")
    expect(r.ok).toBe(true)
    expect(r.directives.map((d) => d.name)).toEqual(['default-src', 'img-src'])
  })

  it('flags unsafe-inline in script-src as bad', () => {
    const r = analyzeCsp("script-src 'self' 'unsafe-inline'")
    expect(r.findings.some((f) => f.id === 'script.unsafeInline' && f.severity === 'bad')).toBe(
      true,
    )
  })

  it('flags wildcard script-src and data:', () => {
    const r = analyzeCsp('script-src * data:')
    expect(r.findings.some((f) => f.id === 'script.wildcard')).toBe(true)
    expect(r.findings.some((f) => f.id === 'script.dataUri')).toBe(true)
  })

  it('falls back to default-src for script', () => {
    const r = analyzeCsp("default-src 'none'")
    // object-src inherits 'none' so no object finding; script fallback is 'none' (safe)
    expect(r.findings.some((f) => f.id === 'script.fallbackNone')).toBe(false)
    expect(r.findings.some((f) => f.id === 'frameAncestors.missing')).toBe(true)
    expect(r.findings.some((f) => f.id === 'baseUri.missing')).toBe(true)
  })

  it('flags JSONP-capable host in script-src', () => {
    const r = analyzeCsp("script-src 'self' https://ajax.googleapis.com")
    expect(r.findings.some((f) => f.id === 'jsonp.googleapis')).toBe(true)
  })

  it('recognizes nonce/hash and strict-dynamic as ok', () => {
    const r = analyzeCsp("script-src 'nonce-abc' 'strict-dynamic'")
    expect(r.findings.some((f) => f.id === 'script.nonceOrHash' && f.severity === 'ok')).toBe(true)
    expect(r.findings.some((f) => f.id === 'script.strictDynamic')).toBe(true)
  })

  it('rejects empty / directive-less input', () => {
    expect(analyzeCsp('').ok).toBe(false)
    expect(analyzeCsp('   ').ok).toBe(false)
  })
})
