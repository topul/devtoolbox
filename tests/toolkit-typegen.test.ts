import { describe, expect, it } from 'vitest'
import { generateTypes } from '../src/lib/toolkit/typegen'

describe('JSON 类型生成器', () => {
  it('TypeScript：基础字段与嵌套 interface', () => {
    const r = generateTypes(
      JSON.stringify({ name: 'alice', age: 30, active: true, address: { city: 'SH' } }),
      'typescript',
    )
    expect(r.ok).toBe(true)
    const code = r.code!
    expect(code).toContain('export interface Root')
    expect(code).toMatch(/name: string/)
    expect(code).toMatch(/age: number/)
    expect(code).toMatch(/active: boolean/)
    expect(code).toContain('export interface Address')
    expect(code).toMatch(/city: string/)
    // 被依赖的 Address 先声明
    expect(code.indexOf('interface Address')).toBeLessThan(code.indexOf('address: Address'))
  })

  it('TypeScript：数组元素字段缺失 → optional，数组本身类型正确', () => {
    const r = generateTypes(
      JSON.stringify({ users: [{ name: 'a' }, { name: 'b', age: 1 }] }),
      'typescript',
    )
    const code = r.code!
    expect(code).toContain('users: User[]')
    expect(code).toMatch(/name: string/)
    expect(code).toMatch(/age\?: number/)
  })

  it('TypeScript：异构数组元素产生联合类型', () => {
    const r = generateTypes(JSON.stringify({ list: [1, 'x', true] }), 'typescript')
    expect(r.code).toContain('list: (number | string | boolean)[]')
  })

  it('Go：package、struct tag 与 omitempty', () => {
    const r = generateTypes(
      JSON.stringify({ user_name: 'a', age: 1, items: [{ v: 1 }, { v: 2, w: 3 }] }),
      'go',
    )
    const code = r.code!
    expect(code).toContain('package main')
    expect(code).toContain('type Root struct')
    expect(code).toContain('UserName string `json:"user_name"`')
    expect(code).toContain('Age int64 `json:"age"`')
    // 元素对象字段缺失 → omitempty
    expect(code).toContain('omitempty')
    // 嵌套对象取名单数化：items → Item
    expect(code).toContain('type Item struct')
  })

  it('Go：null + 对象 → 指针字段', () => {
    const r = generateTypes(JSON.stringify({ maybe: { x: 1 } }), 'go')
    // 单根对象无 null 样本；用异构联合构造 null
    const r2 = generateTypes(JSON.stringify({ list: [{ x: 1 }, null] }), 'go')
    expect(r2.code).toContain('[]*List')
    expect(r.ok).toBe(true)
  })

  it('Rust：derive Serialize，可选字段包 Option 并加 serde 属性', () => {
    const r = generateTypes(
      JSON.stringify({ users: [{ name: 'a' }, { name: 'b', age: 1 }] }),
      'rust',
    )
    const code = r.code!
    expect(code).toContain('use serde::Serialize')
    expect(code).toContain('#[derive(Debug, Clone, Serialize)]')
    expect(code).toContain('pub users: Vec<User>')
    expect(code).toContain('#[serde(skip_serializing_if = "Option::is_none")]')
    expect(code).toMatch(/pub age: Option<i64>/)
  })

  it('Python：dataclass、Optional 导入与字段重排（必填在前）', () => {
    const r = generateTypes(
      JSON.stringify({ users: [{ name: 'a' }, { name: 'b', age: 1 }] }),
      'python',
    )
    const code = r.code!
    expect(code).toContain('from typing import Optional')
    expect(code).toContain('@dataclass')
    expect(code).toMatch(/users: list\[User\]/)
    expect(code).toMatch(/age: Optional\[int\] = None/)
    // 必填 name 行在可选 age 行之前
    expect(code.indexOf('name: str')).toBeLessThan(code.indexOf('age: Optional'))
  })

  it('Python：字符串数组与根对象', () => {
    const r = generateTypes(JSON.stringify({ tags: ['a', 'b'] }), 'python')
    expect(r.code).toContain('tags: list[str]')
  })

  it('标量根输出类型别名而非对象', () => {
    expect(generateTypes('"hello"', 'typescript').code).toBe('type Root = string')
    expect(generateTypes('42', 'go').code).toContain('int64')
    expect(generateTypes('true', 'python').code).toContain('Root: bool')
  })

  it('非法 JSON 返回错误', () => {
    const r = generateTypes('{bad', 'typescript')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('自定义根类型名生效，非法名回退 Root', () => {
    expect(generateTypes('{"a":1}', 'go', 'MyModel').code).toContain('type MyModel struct')
    expect(generateTypes('{"a":1}', 'typescript', '1bad').code).toContain('interface Root')
  })

  it('同名不同构的嵌套对象自动改名', () => {
    const r = generateTypes(
      JSON.stringify({ a: { item: { x: 1 } }, b: { item: { y: 's' } } }),
      'typescript',
    )
    const code = r.code!
    // Item 与 Item2 两个名字都应存在
    expect(code).toContain('interface Item')
    expect(code).toContain('interface Item2')
  })
})
