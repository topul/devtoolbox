import { describe, expect, it } from 'vitest'
import {
  parseUrl,
  parseCookie,
  parseUserAgent,
  intToIpv4,
  parseIpv4,
  cidrInfo,
  isPrivateIp,
} from '../src/lib/toolkit/net'

describe('parseUrl', () => {
  it('拆解各段 + 参数列表', () => {
    const u = parseUrl('https://user:pw@example.com:8443/p/a?b=1&c=2#frag')
    expect(u.protocol).toBe('https')
    expect(u.username).toBe('user')
    expect(u.hostname).toBe('example.com')
    expect(u.port).toBe('8443')
    expect(u.pathname).toBe('/p/a')
    expect(u.params).toEqual([
      { k: 'b', v: '1' },
      { k: 'c', v: '2' },
    ])
    expect(u.hash).toBe('frag')
  })
})

describe('parseCookie', () => {
  it('Set-Cookie 属性', () => {
    const c = parseCookie('sessionId=abc123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600')
    expect(c.cookie?.name).toBe('sessionId')
    expect(c.cookie?.value).toBe('abc123')
    expect(c.attrs.map((a) => a.k.toUpperCase())).toContain('PATH')
  })
})

describe('parseUserAgent', () => {
  it('Chrome 桌面 / bot 识别', () => {
    const d = parseUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    )
    expect(d.browser).toMatch(/chrome/i)
    expect(d.device).toBe('desktop')
    const b = parseUserAgent(
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    )
    expect(b.bot).not.toBeNull()
  })
})

describe('ip ↔ int', () => {
  it('已知向量 + SSRF 绕过形态', () => {
    expect(parseIpv4('127.0.0.1')).toBe(0x7f000001)
    expect(intToIpv4(0x7f000001)).toBe('127.0.0.1')
    expect(intToIpv4(2130706433)).toBe('127.0.0.1')
  })
  it('非法输入返回 null', () => {
    expect(parseIpv4('999.1.1.1')).toBe(null)
    expect(parseIpv4('abc')).toBe(null)
  })
  it('isPrivateIp', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('192.168.1.1')).toBe(true)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
  })
})

describe('cidrInfo', () => {
  it('/24 网络', () => {
    const c = cidrInfo('192.168.1.130/24')
    expect(c.network).toBe('192.168.1.0')
    expect(c.broadcast).toBe('192.168.1.255')
    expect(c.firstHost).toBe('192.168.1.1')
    expect(c.lastHost).toBe('192.168.1.254')
  })
})
