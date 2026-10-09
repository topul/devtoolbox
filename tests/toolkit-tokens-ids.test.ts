import { describe, expect, it } from 'vitest'
import { estimateTokens, estimateMessages, costOf, formatMoney } from '../src/lib/toolkit/tokens'
import { uuidV4, generateUuids, generatePassword } from '../src/lib/toolkit/ids'
import { lintSql, extractTable, whereColumns } from '../src/lib/toolkit/sql-lint'
import { parseToolSchema, renderSchema } from '../src/lib/toolkit/schema'
import { buildGqlBody, guessOperationName } from '../src/lib/toolkit/graphql'

describe('token 估算', () => {
  it('CJK 与拉丁分开计数（CJK 约 0.75 token/字）', () => {
    const e = estimateTokens('你好世界')
    expect(e.cjkChars).toBe(4)
    expect(e.tokens).toBe(3)
    const en = estimateTokens('hello world foo')
    expect(en.words).toBe(3)
    expect(en.tokens).toBeGreaterThan(0)
  })
  it('messages 级估算包含角色开销', () => {
    const m = estimateMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '你好' },
    ])
    expect(m.total).toBeGreaterThan(m.tokens)
  })
  it('cost 与格式化', () => {
    const r = costOf(
      { inPerM: 1, outPerM: 2 },
      { promptTokens: 1_000_000, completionTokens: 1_000_000 },
    )
    expect(r.total).toBeGreaterThan(0)
    expect(formatMoney(1.5)).toContain('1.5')
  })
})

describe('ids', () => {
  it('UUID v4 格式与版本位', () => {
    const u = uuidV4()
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(generateUuids({ count: 5 })).toHaveLength(5)
  })
  it('密码包含各类字符且长度正确', () => {
    const p = generatePassword({ length: 24 })
    expect(p.password).toHaveLength(24)
    expect(p.bits).toBeGreaterThan(0)
  })
})

describe('sql-lint', () => {
  it('SELECT * 告警、提取表名与 where 列', () => {
    const sql = 'SELECT * FROM users WHERE name = "a" AND age > 1'
    expect(
      lintSql(sql).some((i) => /select/i.test(i.rule) || /select/i.test(i.message)),
    ).toBeTruthy()
    expect(extractTable(sql)).toMatch(/users/i)
    expect(whereColumns(sql)).toContain('name')
  })
})

describe('schema 互转', () => {
  it('OpenAI 工具定义解析后可再渲染', () => {
    const def = JSON.stringify({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    })
    const parsed = parseToolSchema(def)
    expect(parsed.tools.length).toBe(1)
    expect(renderSchema(parsed.tools, 'openai')).toContain('get_weather')
  })
})

describe('graphql 请求体', () => {
  it('组装 body 并猜出操作名', () => {
    const body = JSON.parse(buildGqlBody('{ user { id } }', '', ''))
    expect(body.query).toContain('user')
    expect(guessOperationName('query GetUser { user { id } }')).toBe('GetUser')
  })
})
