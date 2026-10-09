import { describe, expect, it } from 'vitest'
import {
  jsonFormat,
  jsonMinify,
  jsonValidate,
  jsonSortKeys,
  evalJsonPath,
} from '../src/lib/toolkit/json'
import { tomlToJson, jsonToToml, csvToJson, jsonToCsv, csvParse } from '../src/lib/toolkit/formats'
import { yamlToJson, jsonToYaml, parseYaml } from '../src/lib/toolkit/yaml'

describe('json', () => {
  it('format / minify / validate', () => {
    expect(jsonFormat('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(jsonMinify('{\n  "a": 1\n}')).toBe('{"a":1}')
    expect(jsonValidate('{"a":1}').ok).toBe(true)
    const bad = jsonValidate('{"a":}')
    expect(bad.ok).toBe(false)
    expect(bad.error).toBeTruthy()
  })
  it('sortKeys 递归排序且不改值', () => {
    const sorted = jsonSortKeys({ b: 2, a: { d: 4, c: [{ z: 1, y: 2 }] } })
    expect(JSON.stringify(sorted)).toBe('{"a":{"c":[{"y":2,"z":1}],"d":4},"b":2}')
  })
  it('JSONPath 提取', () => {
    const obj = {
      store: {
        book: [
          { title: 'Dune', price: 8.99 },
          { title: 'Neuromancer', price: 9.99 },
        ],
      },
    }
    expect(evalJsonPath(obj, '$.store.book[*].title')).toEqual(['Dune', 'Neuromancer'])
    expect(evalJsonPath(obj, '$.store.book[0].price')).toEqual([8.99])
  })
})

describe('toml', () => {
  it('双向转换', () => {
    const src = '[package]\nname = "devtoolbox"\nedition = "2021"\n'
    expect(tomlToJson(src)).toEqual({ package: { name: 'devtoolbox', edition: '2021' } })
    expect(tomlToJson(jsonToToml({ package: { name: 'devtoolbox', edition: '2021' } }))).toEqual({
      package: { name: 'devtoolbox', edition: '2021' },
    })
  })
})

describe('csv（RFC 4180）', () => {
  it('引号内的分隔符与换行', () => {
    const rows = csvParse('a,b\n"1,5",x\n"multi\nline",y')
    expect(rows).toEqual([
      ['a', 'b'],
      ['1,5', 'x'],
      ['multi\nline', 'y'],
    ])
  })
  it('csvToJson / jsonToCsv roundtrip', () => {
    const t = csvToJson('id,name,role\n1,Ada,engineer\n2,Lin,pm\n')
    expect(t.columns).toEqual(['id', 'name', 'role'])
    expect(t.rows[0]).toEqual({ id: '1', name: 'Ada', role: 'engineer' })
    const back = jsonToCsv(t.rows as unknown as Record<string, unknown>[])
    expect(csvToJson(back).rows).toEqual(t.rows)
  })
})

describe('yaml', () => {
  it('双向转换', () => {
    const src = 'name: devtoolbox\nversion: 1.8.0\nports:\n  - 5000\n  - 6000\n'
    expect(parseYaml(src)).toEqual({ name: 'devtoolbox', version: '1.8.0', ports: [5000, 6000] })
    expect(JSON.parse(yamlToJson(src)).ports).toEqual([5000, 6000])
    // jsonToYaml 接收 JSON 字符串
    expect(parseYaml(jsonToYaml(JSON.stringify({ a: 1, b: ['x', 'y'] })))).toEqual({
      a: 1,
      b: ['x', 'y'],
    })
  })
})
