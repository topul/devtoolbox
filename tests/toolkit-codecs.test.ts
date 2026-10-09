import { describe, expect, it } from 'vitest'
import {
  utf8Bytes,
  bytesToUtf8,
  bytesToHex,
  hexToBytes,
  base58Encode,
  base58Decode,
  base32Encode,
  base32Decode,
  idnToAscii,
  asciiToIdn,
} from '../src/lib/toolkit/codecs'

describe('bytes ↔ hex / utf8', () => {
  it('roundtrip', () => {
    const b = utf8Bytes('中文abc')
    expect(bytesToUtf8(b)).toBe('中文abc')
    expect(hexToBytes(bytesToHex(b))).toEqual(b)
    expect(bytesToHex(new Uint8Array([0, 0x0f, 0xff]))).toBe('000fff')
  })
})

describe('base58（比特币字母表）', () => {
  it('已知向量', () => {
    // 'hello world' 的 base58 编码
    expect(base58Encode(utf8Bytes('hello world'))).toBe('StV1DL6CwTryKyV')
    expect(bytesToUtf8(base58Decode('StV1DL6CwTryKyV'))).toBe('hello world')
  })
  it('前导零字节编码为 1', () => {
    expect(base58Encode(new Uint8Array([0, 0, 1]))).toBe('112')
    expect(base58Decode('112')).toEqual(new Uint8Array([0, 0, 1]))
  })
  it('roundtrip 随机字节', () => {
    const b = crypto.getRandomValues(new Uint8Array(64))
    expect(base58Decode(base58Encode(b))).toEqual(b)
  })
})

describe('base32', () => {
  it('RFC 4648 已知向量', () => {
    expect(base32Encode(utf8Bytes('foo'))).toBe('MZXW6===')
    expect(base32Encode(utf8Bytes('foob'))).toBe('MZXW6YQ=')
    expect(base32Encode(utf8Bytes('fooba'))).toBe('MZXW6YTB')
    expect(base32Encode(utf8Bytes('foobar'))).toBe('MZXW6YTBOI======')
  })
  it('roundtrip + 宽松解码（小写/无填充）', () => {
    const b = crypto.getRandomValues(new Uint8Array(20))
    const enc = base32Encode(b)
    expect(base32Decode(enc.toLowerCase().replace(/=+$/, ''))).toEqual(b)
  })
})

describe('punycode / IDN', () => {
  it('中文域名 → xn--', () => {
    expect(idnToAscii('例子.测试')).toMatch(/^xn--/)
    expect(asciiToIdn(idnToAscii('例子.测试'))).toBe('例子.测试')
  })
})
