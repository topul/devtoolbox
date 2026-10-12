import { describe, it, expect } from 'vitest'
import { generateSsrfVariants } from '../src/lib/toolkit/ssrf'
import { generateRedirectPayloads } from '../src/lib/toolkit/redirect'

describe('generateSsrfVariants', () => {
  it('produces decimal/hex/octal equivalents for 127.0.0.1', () => {
    const r = generateSsrfVariants('127.0.0.1')
    expect(r.ok).toBe(true)
    expect(r.isIpv4).toBe(true)
    const values = r.variants.map((v) => v.value)
    expect(values).toContain('2130706433')
    expect(values).toContain('0x7f000001')
    expect(values.some((v) => v.startsWith('0177'))).toBe(true)
  })

  it('produces IPv6 mapped forms', () => {
    const r = generateSsrfVariants('127.0.0.1')
    const values = r.variants.map((v) => v.value)
    expect(values.some((v) => v.includes('::ffff:127.0.0.1'))).toBe(true)
    expect(values.some((v) => v.includes('::ffff:7f00:1'))).toBe(true)
  })

  it('produces short form 127.1 and trailing dot', () => {
    const r = generateSsrfVariants('127.0.0.1')
    const values = r.variants.map((v) => v.value)
    expect(values).toContain('127.1')
    expect(values).toContain('127.0.0.1.')
  })

  it('preserves URL path and scheme when input is a URL', () => {
    const r = generateSsrfVariants('http://192.168.0.1/internal/health')
    const decimal = r.variants.find((v) => v.value.includes('3232235521'))
    expect(decimal?.value).toBe('http://3232235521/internal/health')
  })

  it('wraps IPv6 forms in brackets inside URL', () => {
    const r = generateSsrfVariants('http://127.0.0.1/x')
    const v6 = r.variants.find((v) => v.value.includes('::ffff:127.0.0.1'))
    expect(v6?.value).toContain('http://[::ffff:127.0.0.1]/x')
  })

  it('generates userinfo confusion for URL input', () => {
    const r = generateSsrfVariants('http://127.0.0.1/')
    expect(r.variants.some((v) => v.value.includes('allowed.example@127.0.0.1'))).toBe(true)
  })

  it('falls back to domain-oriented variants for hostnames', () => {
    const r = generateSsrfVariants('internal.corp')
    expect(r.isIpv4).toBe(false)
    const values = r.variants.map((v) => v.value)
    expect(values).toContain('internal.corp.')
    expect(values.some((v) => v.includes('%2e'))).toBe(true)
  })

  it('rejects empty input', () => {
    expect(generateSsrfVariants('').ok).toBe(false)
  })
})

describe('generateRedirectPayloads', () => {
  it('generates protocol-relative and userinfo variants', () => {
    const r = generateRedirectPayloads('evil.com')
    expect(r.ok).toBe(true)
    const values = r.payloads.map((p) => p.value)
    expect(values).toContain('//evil.com')
    expect(values).toContain('///evil.com')
    expect(values.some((v) => v.includes('@evil.com'))).toBe(true)
  })

  it('covers suffix-trust bypasses', () => {
    const r = generateRedirectPayloads('evil.com', 'trusted.local')
    const values = r.payloads.map((p) => p.value)
    expect(values).toContain('//evil.com.trusted.local')
    expect(values).toContain('//trusted.local.evil.com')
    expect(values).toContain('//evil.com/trusted.local')
  })

  it('strips scheme and trailing slash from target', () => {
    const r = generateRedirectPayloads('https://evil.com/')
    expect(r.target).toBe('evil.com')
    expect(r.payloads.every((p) => !p.value.startsWith('https://evil.com/'))).toBe(true)
  })

  it('includes encoded and javascript sinks', () => {
    const r = generateRedirectPayloads('evil.com')
    const values = r.payloads.map((p) => p.value)
    expect(values.some((v) => v.startsWith('%2F%2F'))).toBe(true)
    expect(values.some((v) => v.startsWith('javascript:'))).toBe(true)
  })

  it('rejects empty target', () => {
    expect(generateRedirectPayloads('').ok).toBe(false)
  })
})
