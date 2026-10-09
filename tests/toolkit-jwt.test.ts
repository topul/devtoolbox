import { describe, expect, it } from 'vitest'
import { jwtDecode, jwtIsExpired } from '../src/lib/toolkit/jwt'
import { jwtSign, jwtVerify, jwtExpIn } from '../src/lib/toolkit/jwt-sign'
import { jwtAnalyze, jwtForge } from '../src/lib/toolkit/jwtcrack'

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSJ9.x'

describe('jwtDecode', () => {
  it('拆出 header / payload / signature', () => {
    const d = jwtDecode(TOKEN)
    expect(d.headerObj).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(d.payloadObj).toEqual({ sub: '1234567890', name: 'Ada' })
    expect(d.signed).toBe(true)
  })
})

describe('jwtIsExpired', () => {
  it('exp 过去 / 未来 / 缺失（exp 秒，now 毫秒）', () => {
    expect(jwtIsExpired({ exp: 1000 }, 1_500_000)).toBe(true)
    expect(jwtIsExpired({ exp: 2000 }, 1_500_000)).toBe(false)
    expect(jwtIsExpired({})).toBe(null)
  })
})

describe('jwtSign / jwtVerify', () => {
  it('HS256 签发后验签通过；密钥不对验签失败', async () => {
    const { token } = await jwtSign('HS256', { sub: 'a' }, 'secret')
    expect(await jwtVerify(token, 'secret', 'HS256')).toMatchObject({ valid: true })
    expect(await jwtVerify(token, 'wrong', 'HS256')).toMatchObject({ valid: false })
  })
  it('auto exp 填充', () => {
    const t0 = 1_700_000_000_000
    expect(jwtExpIn(3600, t0)).toBe(1_700_003_600)
  })
})

describe('jwtcrack', () => {
  it('alg=none 被识别为风险', () => {
    const r = jwtAnalyze(jwtForge('{"sub":"a"}', '', 'none'))
    expect(r.noneAlg).toBe(true)
  })
  it('弱密钥能被爆破出来', () => {
    const r = jwtAnalyze(jwtForge('{"sub":"a"}', 'secret', 'HS256'))
    expect(r.crackedKey).toBe('secret')
  })
})
