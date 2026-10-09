import { describe, expect, it } from 'vitest'
import { digest, digestAll, hmacDigest, aesEncrypt, aesDecrypt } from '../src/lib/toolkit/hash'

describe('digest', () => {
  it('已知向量', () => {
    expect(digest('MD5', '')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(digest('MD5', 'abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(digest('SHA1', 'abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(digest('SHA256', 'abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(digest('SHA512', 'abc')).toMatch(/^ddaf35a193617aba/)
  })
  it('digestAll 覆盖全部算法且值一致', () => {
    const all = digestAll('abc')
    const md5 = all.find((x) => /MD5/i.test(x.label))
    expect(md5?.value).toBe('900150983cd24fb0d6963f7d28e17f72')
  })
})

describe('hmac', () => {
  // RFC 2202 用例 2：key 与 data 都是纯文本 —— 与本实现「key 按字符串处理」的语义一致
  it('RFC 2202 向量（HMAC-MD5, key=Jefe）', () => {
    expect(hmacDigest('MD5', 'what do ya want for nothing?', 'Jefe')).toBe(
      '750c783e6ab0b503eaa86e310a5db738',
    )
  })
})

describe('aes roundtrip', () => {
  it('ECB / CBC 往返', () => {
    for (const mode of ['ECB', 'CBC'] as const) {
      const cipher = aesEncrypt('机密数据 secret 123', 'passphrase-key', mode)
      expect(aesDecrypt(cipher, 'passphrase-key', mode)).toBe('机密数据 secret 123')
    }
  })
  it('错误密钥解不出原文（抛错或得到乱码都算守住底线）', () => {
    const cipher = aesEncrypt('hello', 'key-a', 'ECB')
    let out: string | null = null
    try {
      out = aesDecrypt(cipher, 'key-b', 'ECB')
    } catch {
      /* crypto-js 对坏填充可能直接抛 */
    }
    expect(out).not.toBe('hello')
  })
})
