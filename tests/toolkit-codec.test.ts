import { describe, expect, it } from 'vitest'
import {
  utf8ToBase64,
  base64ToUtf8,
  encodeUrlComponent,
  decodeUrlComponent,
  encodeUrlFull,
  decodeUrlFull,
  escapeUnicode,
  unescapeUnicode,
  htmlEntityEncode,
  htmlEntityDecode,
  htmlEntityEncodeNumeric,
  encodeHex,
  decodeHex,
  encodeMorse,
  decodeMorse,
  radixConvert,
  chainEncode,
  chainDecode,
} from '../src/lib/toolkit/codec'

describe('base64', () => {
  it('UTF-8 中文 roundtrip', () => {
    for (const s of ['hello', '你好，世界', 'café ☕', '']) {
      expect(base64ToUtf8(utf8ToBase64(s))).toBe(s)
    }
  })
  it('已知向量 RFC 4648', () => {
    expect(utf8ToBase64('foobar')).toBe('Zm9vYmFy')
    expect(utf8ToBase64('foob')).toBe('Zm9vYg==')
  })
  it('urlSafe 变体不含 + /', () => {
    // '+' -> '-', '/' -> '_'
    const s = utf8ToBase64('???>', true)
    expect(s).not.toMatch(/[+/]/)
  })
})

describe('url codec', () => {
  it('component 与 full 语义不同', () => {
    expect(encodeUrlComponent('a b&c=d')).toBe('a%20b%26c%3Dd')
    expect(encodeUrlFull('a b&c=d')).toBe('a%20b&c=d')
  })
  it('roundtrip', () => {
    for (const s of ['hello world', '中文 test/路径?q=1']) {
      expect(decodeUrlComponent(encodeUrlComponent(s))).toBe(s)
      expect(decodeUrlFull(encodeUrlFull(s))).toBe(s)
    }
  })
})

describe('unicode escape', () => {
  it('roundtrip（含增补平面代理对）', () => {
    for (const s of ['你好', 'emoji 🎉 here', 'plain']) {
      expect(unescapeUnicode(escapeUnicode(s))).toBe(s)
    }
  })
})

describe('html entity', () => {
  it('XSS 防御向量', () => {
    expect(htmlEntityEncode('<script>')).toBe('&lt;script&gt;')
    expect(htmlEntityDecode('&lt;script&gt;')).toBe('<script>')
  })
  it('数字实体', () => {
    expect(htmlEntityEncodeNumeric('<')).toBe('&#60;')
  })
})

describe('hex / morse / radix', () => {
  it('hex roundtrip 中文', () => {
    expect(decodeHex(encodeHex('中文'))).toBe('中文')
  })
  it('morse 已知向量', () => {
    expect(encodeMorse('SOS')).toBe('... --- ...')
    expect(decodeMorse('... --- ...')).toBe('SOS')
  })
  it('radix 已知向量', () => {
    expect(radixConvert('255', 10).hex).toBe('FF')
    expect(radixConvert('1010', 2).dec).toBe('10')
    expect(radixConvert('ff', 16).dec).toBe('255')
  })
})

describe('编码链', () => {
  it('每层 encode 后 decode 可还原', () => {
    for (const codec of ['url', 'doubleUrl', 'html', 'unicode', 'hex', 'base64'] as const) {
      expect(chainDecode(codec, chainEncode(codec, '目标 <target> & 🎉'))).toBe(
        '目标 <target> & 🎉',
      )
    }
  })
})
