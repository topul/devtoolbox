import { describe, expect, it } from 'vitest'
import {
  bytesToText,
  decodeHex,
  decodeHexDump,
  decodePlainHex,
  encodeHexDump,
  textToBytes,
} from '../src/lib/toolkit/hexdump'

describe('Hex Dump 编码', () => {
  it('单行：偏移 + 字节 + ASCII，不足一行补空格', () => {
    const out = encodeHexDump(new Uint8Array([0x48, 0x69]))
    expect(out.startsWith('00000000  48 69')).toBe(true)
    expect(out.trimEnd().endsWith('Hi')).toBe(true)
    expect(out).toContain('Hi')
  })

  it('16 字节满行：第 8 字节处有分组双空格', () => {
    const bytes = new Uint8Array(Array.from({ length: 16 }, (_, i) => i + 1))
    const out = encodeHexDump(bytes)
    expect(out).toContain('07 08  09 0a')
    expect(out).toMatch(/00000000  01 02/)
  })

  it('多行偏移递增，非打印字符显示为点', () => {
    const bytes = new Uint8Array(17)
    bytes[0] = 0x41 // A
    bytes[16] = 0x0a
    const out = encodeHexDump(bytes)
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1].startsWith('00000010  0a')).toBe(true)
    expect(lines[0]).toContain('A')
    // 0x00 显示为 .
    expect(lines[0].endsWith('.')).toBe(true)
  })

  it('支持大写输出', () => {
    const out = encodeHexDump(new Uint8Array([0xab, 0xcd]), { uppercase: true })
    expect(out).toContain('AB CD')
    expect(out).toMatch(/^00000000/)
  })

  it('每行 8 字节选项', () => {
    const out = encodeHexDump(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), { bytesPerLine: 8 })
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('01 02 03 04  05 06 07 08')
    expect(lines[1].startsWith('00000008  09')).toBe(true)
  })

  it('空字节输出空字符串', () => {
    expect(encodeHexDump(new Uint8Array(0))).toBe('')
  })
})

describe('纯 hex 解码', () => {
  it('大小写混合 + 空白容忍', () => {
    const r = decodePlainHex('48 69\n0A FF')
    expect(r.ok).toBe(true)
    expect([...r.bytes!]).toEqual([0x48, 0x69, 0x0a, 0xff])
  })

  it('非法字符与奇数长度报错', () => {
    expect(decodePlainHex('4g').ok).toBe(false)
    expect(decodePlainHex('abc').error).toMatch(/奇数/)
    expect(decodePlainHex('   ').bytes).toHaveLength(0)
  })
})

describe('dump 解码', () => {
  it('roundtrip：自己的输出能解回相同字节（含分组双空格与 ASCII 列）', () => {
    const original = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x00, 0x0a, 0xff])
    const dump = encodeHexDump(original)
    const r = decodeHexDump(dump)
    expect(r.ok).toBe(true)
    expect([...r.bytes!]).toEqual([...original])
  })

  it('多行 dump roundtrip（32 字节）', () => {
    const original = new Uint8Array(Array.from({ length: 32 }, (_, i) => i))
    const r = decodeHexDump(encodeHexDump(original))
    expect([...r.bytes!]).toEqual([...original])
  })

  it('偏移未递增报错', () => {
    const dump = encodeHexDump(new Uint8Array([1, 2]))
    const r = decodeHexDump(`${dump}\n${dump}`)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/递增/)
  })

  it('ASCII 列紧贴 hex 区也不被误吞', () => {
    // 构造 ASCII 以 hex 双字符开头的边界情况：字节 [0x61,0x62] 即 "ab"
    const bytes = new Uint8Array([0x61, 0x62])
    const dump = encodeHexDump(bytes, { bytesPerLine: 8 })
    const r = decodeHexDump(dump)
    expect([...r.bytes!]).toEqual([0x61, 0x62])
  })
})

describe('智能入口与文本转换', () => {
  it('decode 自动区分 dump 与纯 hex', () => {
    const dump = encodeHexDump(new Uint8Array([1, 2, 3]))
    expect([...decodeHex(dump).bytes!]).toEqual([1, 2, 3])
    expect([...decodeHex('01 02 03').bytes!]).toEqual([1, 2, 3])
  })

  it('文本往返：text → bytes → dump → decode → text（含中文）', () => {
    const text = 'Hello 世界！\n第二行'
    const dump = encodeHexDump(textToBytes(text))
    const back = bytesToText(decodeHex(dump).bytes!)
    expect(back).toBe(text)
  })
})
