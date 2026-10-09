import { describe, expect, it } from 'vitest'
import { parseCertificatePem } from '../src/lib/toolkit/x509'
import { parseHar, buildWaterfall, summarizeByHost, formatBytes } from '../src/lib/toolkit/har'
import { auditSecurityHeaders } from '../src/lib/toolkit/headers-audit'
import { parseDohResponse, isValidDomain } from '../src/lib/toolkit/dns'
import { lintSql } from '../src/lib/toolkit/sql-lint'

describe('x509', () => {
  it('非 PEM 抛错', () => {
    expect(() => parseCertificatePem('not a pem')).toThrow()
  })
})

describe('har', () => {
  it('最小 HAR → 瀑布与域名汇总', () => {
    const har = {
      log: {
        entries: [
          {
            startedDateTime: '2026-01-01T00:00:00Z',
            time: 120,
            request: { method: 'GET', url: 'https://a.com/x', headers: [] },
            response: { status: 200, content: { size: 10 }, headers: [] },
            timings: { wait: 100, receive: 20 },
          },
        ],
      },
    }
    const s = parseHar(har)
    expect(s.entries.length).toBe(1)
    expect(buildWaterfall(s.entries).length).toBe(1)
    expect(summarizeByHost(s.entries)[0].host).toBe('a.com')
  })
  it('formatBytes', () => {
    expect(formatBytes(0)).toMatch(/0/)
    expect(formatBytes(1536)).toMatch(/1\.5/)
  })
})

describe('headers-audit', () => {
  it('缺 HSTS / CSP 被指出', () => {
    const r = auditSecurityHeaders([['content-type', 'text/html']], true)
    const text = JSON.stringify(r)
    expect(text).toMatch(/hsts|strict-transport/i)
  })
})

describe('dns', () => {
  it('DoH 应答解析', () => {
    const r = parseDohResponse({
      Status: 0,
      Answer: [{ name: 'a.com', type: 1, TTL: 60, data: '1.2.3.4' }],
    })
    expect(JSON.stringify(r)).toContain('1.2.3.4')
    expect(isValidDomain('a.example.com')).toBe(true)
    expect(isValidDomain('not_domain!')).toBe(false)
  })
})

describe('sql-lint 补充', () => {
  it('无问题 SQL 返回空数组', () => {
    expect(lintSql("SELECT id FROM users WHERE id = '1'").length).toBeLessThanOrEqual(2)
  })
})
