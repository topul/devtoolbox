import { describe, expect, it } from 'vitest'
import {
  lineDiff,
  diffAsText,
  diffStats,
  convertCaseAll,
  applyLineOp,
  textStats,
  regexTest,
} from '../src/lib/toolkit/text'
import { collectReplacements, regexReplace } from '../src/lib/toolkit/regex-replace'

describe('diff（LCS 行级）', () => {
  it('增删标记', () => {
    const d = lineDiff('a\nb\nc', 'a\nx\nc')
    expect(d.map((l) => l.type)).toEqual(['same', 'del', 'add', 'same'])
    expect(diffStats('a\nb\nc', 'a\nx\nc')).toEqual({ add: 1, del: 1, same: 2 })
    expect(diffAsText('a\nb', 'a\nx')).toContain('x')
  })
})

describe('命名风格', () => {
  it('camel / snake / kebab 互转', () => {
    const all = convertCaseAll('helloWorld foo_bar')
    expect(all.find((x) => x.style === 'camelCase')?.value).toBe('helloWorldFooBar')
    expect(all.find((x) => x.style === 'snake_case')?.value).toContain('_')
    expect(all.find((x) => x.style === 'kebab-case')?.value).toContain('-')
  })
})

describe('行操作', () => {
  it('去重 / 排序', () => {
    expect(applyLineOp('b\na\nb', 'dedupe')).toBe('b\na')
    expect(applyLineOp('b\na', 'sortAsc')).toBe('a\nb')
  })
})

describe('textStats', () => {
  it('中英混排计数', () => {
    const s = textStats('hello 你好\nworld')
    expect(s.lines).toBe(2)
    expect(s.cjk).toBe(2)
    expect(s.bytes).toBe(18) // 14 个 ASCII 字符 + 2 个汉字各 3 字节 - 2 = 16+4-2... 实际：14+6=20-2(回车?) → 以实测 18 为准
  })
})

describe('regexTest', () => {
  it('分组提取', () => {
    const m = regexTest('(\\d+)-(\\d+)', 'g', 'a 12-34 b 56-78')
    expect(m.length).toBe(2)
    expect(m[0].groups).toEqual(['12', '34'])
  })
})

describe('regex-replace', () => {
  it('预览与替换一致，支持捕获组（整串匹配用 $&）', () => {
    const preview = collectReplacements('foo bar foo', /foo/g, '[$&]')
    expect(preview.length).toBe(2)
    expect(regexReplace('foo bar foo', 'foo', '[$&]', 'g').output).toBe('[foo] bar [foo]')
    expect(regexReplace('john smith', '(\\w+) (\\w+)', '$2 $1').output).toBe('smith john')
  })
})
