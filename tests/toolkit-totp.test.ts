import { describe, expect, it } from 'vitest'
import {
  totp,
  totpVerify,
  totpRemaining,
  parseOtpauth,
  decodeSecret,
  encodeSecret,
} from '../src/lib/toolkit/totp'

// RFC 6238 官方向量（SHA1, 8 位，secret = ASCII '12345678901234567890' 的 base32）
const RFC_SECRET = encodeSecret(new TextEncoder().encode('12345678901234567890'))

describe('totp（RFC 6238 向量）', () => {
  it('T=59 / T=1111111109', async () => {
    expect(await totp(RFC_SECRET, 59, { digits: 8 })).toBe('94287082')
    expect(await totp(RFC_SECRET, 1111111109, { digits: 8 })).toBe('07081804')
  })
  it('verify 接受当前码，拒绝错码', async () => {
    const code = await totp(RFC_SECRET, 59)
    expect((await totpVerify(RFC_SECRET, code, 59)).valid).toBe(true)
    expect((await totpVerify(RFC_SECRET, '000000', 59)).valid).toBe(false)
  })
})

describe('totpRemaining', () => {
  it('30s 周期内的剩余秒数', () => {
    expect(totpRemaining(45, 30)).toBe(15)
    expect(totpRemaining(60, 30)).toBe(30)
  })
})

describe('otpauth 解析', () => {
  it('issuer / account / 参数', () => {
    const m = parseOtpauth(
      'otpauth://totp/GitHub:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=8&period=60&algorithm=SHA256',
    )
    expect(m.secret).toBe('JBSWY3DPEHPK3PXP')
    expect(m.issuer).toBe('GitHub')
    expect(m.digits).toBe(8)
    expect(m.period).toBe(60)
    expect(m.algo).toBe('SHA256')
  })
  it('非法输入抛错', () => {
    expect(() => parseOtpauth('not a url')).toThrow()
  })
})

describe('secret 编解码', () => {
  it('base32 roundtrip', () => {
    const b = crypto.getRandomValues(new Uint8Array(16))
    expect(decodeSecret(encodeSecret(b))).toEqual(b)
  })
  it('空密钥抛错', async () => {
    await expect(totp('')).rejects.toThrow()
  })
})
