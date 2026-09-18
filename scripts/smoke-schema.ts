/**
 * Tool Schema 互转的断言。
 *
 * 为什么单独写脚本：TS / Pydantic 代码生成是「看起来对、用起来错」的重灾区
 * （可选性丢了、嵌套类型没声明、enum 变 any）。这里用真实样例把输出逐条钉住。
 *
 * 运行：npm run smoke:schema
 */
import {
  parseToolSchema,
  renderSchema,
  summarizeIssues,
  schemaToPydantic,
  schemaToTypeScript,
  toMcpSpec,
  toOpenAiSpec,
  ToolSchemaError,
  type NormalizedTool,
} from '../src/lib/toolkit'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}
function includes(name: string, hay: string, needle: string): void {
  ok(name, hay.includes(needle), `输出里没有 ${JSON.stringify(needle)}\n--- 实际 ---\n${hay}`)
}
function notIncludes(name: string, hay: string, needle: string): void {
  ok(name, !hay.includes(needle), `输出里不该有 ${JSON.stringify(needle)}`)
}
function codes(issues: { code: string }[]): string {
  return issues.map((i) => i.code).sort().join(',')
}

/* ================= 样例 ================= */

const OPENAI_TOOLS = JSON.stringify([
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询指定城市的天气',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名' },
          days: { type: 'integer', description: '预报天数', default: 3 },
          unit: { type: 'string', enum: ['c', 'f'], description: '温度单位' },
          tags: { type: 'array', items: { type: 'string' }, description: '附加标签' },
          alert: { type: 'boolean', description: '是否包含预警' },
        },
        required: ['city', 'unit'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_docs',
      description: '',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词' },
          filter: {
            type: 'object',
            description: '过滤条件',
            properties: {
              lang: { type: 'string', description: '语言' },
              minScore: { type: 'number', description: '最低分' },
            },
            required: ['lang'],
          },
          ids: { type: 'array', description: '文档 id', items: { type: 'integer' } },
        },
        required: ['query'],
      },
    },
  },
])

/* ================= 解析：三种输入形态 ================= */

{
  const r = parseToolSchema(OPENAI_TOOLS)
  eq('OpenAI tools 数组解析出 2 个工具', r.tools.length, 2)
  eq('第一个工具名正确', r.tools[0].name, 'get_weather')
  eq('描述被带出来', r.tools[0].description, '查询指定城市的天气')
  eq('工具描述为空时记 warn', codes(r.issues.filter((i) => i.code === 'TOOL_DESC_MISSING')), 'TOOL_DESC_MISSING')
  eq('没有 error 级问题', summarizeIssues(r.issues).errors, 0)
}

{
  // MCP 服务端 tools/list 的形态（本仓库 MCP 就吐这个）
  const mcp = JSON.stringify({
    tools: [
      {
        name: 'cidr_info',
        description: '解析 CIDR',
        inputSchema: {
          type: 'object',
          properties: { cidr: { type: 'string', description: '如 10.0.0.1/22' } },
          required: ['cidr'],
        },
      },
    ],
  })
  const r = parseToolSchema(mcp)
  eq('MCP 形态解析出 1 个工具', r.tools.length, 1)
  eq('MCP 的 inputSchema 被识别为参数', r.tools[0].parameters.type, 'object')
  includes('MCP 形态可转 TS', schemaToTypeScript(r.tools), 'cidr: string')
}

{
  const bare = JSON.stringify({
    type: 'object',
    title: 'QueryArgs',
    properties: { q: { type: 'string', description: '问题' } },
    required: ['q'],
  })
  const r = parseToolSchema(bare)
  eq('裸 JSON Schema 用 title 当名字', r.tools[0].name, 'QueryArgs')
  eq('裸 JSON Schema 参数就是它自己', r.tools[0].parameters.type, 'object')
}

{
  const single = JSON.stringify({
    type: 'function',
    function: { name: 'ping', description: 'ping', parameters: { type: 'object', properties: {} } },
  })
  eq('单个 function 对象也能解析', parseToolSchema(single).tools[0].name, 'ping')
}

/* ================= 解析：错误分支 ================= */

function expectCode(name: string, fn: () => unknown, want: string): void {
  try {
    fn()
    ok(name, false, '没有抛错')
  } catch (e) {
    ok(name, e instanceof ToolSchemaError && e.code === want, `拿到 ${(e as ToolSchemaError).code}`)
  }
}

expectCode('空输入报 EMPTY_INPUT', () => parseToolSchema('   '), 'EMPTY_INPUT')
expectCode('非法 JSON 报 INVALID_JSON', () => parseToolSchema('{oops}'), 'INVALID_JSON')
expectCode('空数组报 NO_TOOL', () => parseToolSchema('[]'), 'NO_TOOL')
expectCode('不是工具的 JSON 报 NO_TOOL', () => parseToolSchema('42'), 'NO_TOOL')

/* ================= 体检 ================= */

{
  const bad = JSON.stringify({
    type: 'function',
    function: {
      name: 'bad name!',
      description: '有问题',
      parameters: {
        type: 'object',
        properties: {
          a: { type: 'strng' },
          list: { type: 'array' },
          nodef: { type: 'string' },
        },
        required: ['a', 'missing'],
      },
    },
  })
  const r = parseToolSchema(bad)
  const c = codes(r.issues)
  includes('工具名非法被抓出', c, 'NAME_INVALID')
  includes('required 指向未定义字段被抓出', c, 'REQUIRED_NOT_DEFINED')
  includes('非法 type 被抓出', c, 'TYPE_INVALID')
  includes('array 缺 items 被抓出', c, 'ARRAY_WITHOUT_ITEMS')
  includes('字段缺 description 被抓出', c, 'PROP_MISSING_DESC')
  eq('确实记到了 error 级', summarizeIssues(r.issues).errors >= 3, true)
}

{
  const enumDefault = JSON.stringify({
    type: 'function',
    function: {
      name: 'pick',
      description: '选一个',
      parameters: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['a', 'b'], default: 'z', description: '模式' } },
        required: [],
      },
    },
  })
  const r = parseToolSchema(enumDefault)
  includes('default 不在 enum 内被抓出', codes(r.issues), 'DEFAULT_NOT_IN_ENUM')
}

/* ================= 输出：TypeScript ================= */

{
  const { tools } = parseToolSchema(OPENAI_TOOLS)
  const ts = schemaToTypeScript(tools)
  includes('导出接口名正确', ts, 'export interface GetWeatherArgs {')
  includes('必填字段不带问号', ts, 'city: string')
  includes('可选字段带问号', ts, 'days?: number')
  includes('integer 落成 number', ts, 'days?: number')
  includes('enum 落成字面量联合', ts, "unit: 'c' | 'f'")
  includes('数组落成 T[]', ts, 'tags?: string[]')
  includes('boolean 正确', ts, 'alert?: boolean')
  includes('字段描述落成 JSDoc', ts, '城市名')
  includes('嵌套对象独立成 interface', ts, 'export interface SearchDocsArgsFilter {')
  includes('嵌套字段被父级引用', ts, 'filter?: SearchDocsArgsFilter')
  includes('嵌套里的必填不带问号', ts, 'lang: string')
  includes('整型数组正确', ts, 'ids?: number[]')
  notIncludes('可选字段不该被写成 required 形态', ts, 'days: number\n')
}

{
  // nullable / 多类型 / 无类型
  const t: NormalizedTool[] = [
    {
      name: 'edge',
      description: '边界',
      parameters: {
        type: 'object',
        properties: {
          a: { type: ['string', 'null'], description: '可空' },
          b: { description: '没写类型' },
          c: { type: 'object', description: '空对象' },
        },
        required: ['a', 'b', 'c'],
      },
    },
  ]
  const ts = schemaToTypeScript(t)
  includes('类型数组落成可空联合', ts, 'a: string | null')
  includes('没写类型落成 unknown', ts, 'b: unknown')
  includes('空对象落成 Record', ts, 'c: Record<string, unknown>')
}

{
  // 非标识符属性名要加引号
  const t: NormalizedTool[] = [
    {
      name: 'weird',
      description: '怪名字',
      parameters: {
        type: 'object',
        properties: { 'x-token': { type: 'string', description: '带横线' }, '2fa': { type: 'boolean', description: '数字开头' } },
        required: ['x-token', '2fa'],
      },
    },
  ]
  const ts = schemaToTypeScript(t)
  includes('带横线的键加引号', ts, "'x-token': string")
  includes('数字开头的键也加引号', ts, "'2fa': boolean")
}

/* ================= 输出：Pydantic ================= */

{
  const { tools } = parseToolSchema(OPENAI_TOOLS)
  const py = schemaToPydantic(tools)
  includes('模型名正确', py, 'class GetWeatherArgs(BaseModel):')
  includes('工具描述落成 docstring', py, '"""查询指定城市的天气"""')
  includes('必填 str', py, 'city: str = Field(description="城市名")')
  includes('integer → int', py, 'days: Optional[int]')
  includes('enum → Literal', py, 'unit: Literal["c", "f"]')
  includes('数组 → list', py, 'tags: Optional[list[str]]')
  includes('可选字段带 default', py, 'default=None')
  includes('有默认值时用 default=', py, 'default=3')
  includes('嵌套模型独立成 class', py, 'class SearchDocsArgsFilter(BaseModel):')
  includes('按需导入 typing', py, 'from typing import')
  includes('Literal 一定被导入', py, 'Literal')
  notIncludes('没用到 Union 就别导入', py, 'Union')
}

{
  const t: NormalizedTool[] = [
    {
      name: 'union_case',
      description: '',
      parameters: {
        type: 'object',
        properties: {
          v: { anyOf: [{ type: 'string' }, { type: 'integer' }], description: '多种类型' },
        },
        required: ['v'],
      },
    },
  ]
  const py = schemaToPydantic(t)
  includes('anyOf → Union', py, 'Union[str, int]')
  includes('用到 Union 就导入', py, 'Union')
  notIncludes('无描述就不生成 docstring', py, '"""')
}

{
  // 属性名不是合法 Python 标识符要清洗
  const t: NormalizedTool[] = [
    {
      name: 'dash',
      description: 'd',
      parameters: {
        type: 'object',
        properties: { 'user-id': { type: 'string', description: '用户' } },
        required: ['user-id'],
      },
    },
  ]
  const py = schemaToPydantic(t)
  includes('非法标识符被清洗成下划线', py, 'user_id: str')
}

/* ================= 往返 ================= */

{
  const { tools } = parseToolSchema(OPENAI_TOOLS)
  const back = parseToolSchema(toOpenAiSpec(tools))
  eq('OpenAI 往返工具数一致', back.tools.length, tools.length)
  eq('OpenAI 往返名字一致', back.tools.map((t) => t.name).join(','), tools.map((t) => t.name).join(','))
  eq('OpenAI 往返参数一致', JSON.stringify(back.tools[1].parameters), JSON.stringify(tools[1].parameters))

  const mcp = parseToolSchema(toMcpSpec(tools))
  eq('MCP 往返名字一致', mcp.tools.map((t) => t.name).join(','), tools.map((t) => t.name).join(','))

  // strict 模式加 strict 标记，但不污染 original
  includes('strict 选项生效', toOpenAiSpec(tools, { strict: true }), '"strict": true')
  notIncludes('默认不带 strict', toOpenAiSpec(tools), '"strict"')
}

{
  // 用本仓库 MCP 真实目录的形态做一次全量转换（把 --tools-json 的输出喂进来）
  const { tools } = parseToolSchema(
    JSON.stringify({
      tools: [
        { name: 'base64_encode', description: 'Base64 编码', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '文本' } }, required: ['text'] } },
        { name: 'hash', description: '哈希', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '文本' }, algorithm: { type: 'string', description: '算法', enum: ['MD5', 'SHA256'] } }, required: ['text'] } },
      ],
    }),
  )
  const ts = schemaToTypeScript(tools)
  includes('批量转换第一个工具', ts, 'export interface Base64EncodeArgs {')
  includes('批量转换第二个工具', ts, 'export interface HashArgs {')
  includes('枚举落成联合', ts, "algorithm?: 'MD5' | 'SHA256'")
}

/* ================= renderSchema 分派 ================= */

{
  const { tools } = parseToolSchema(OPENAI_TOOLS)
  includes('renderSchema json（多工具时是数组）', renderSchema(tools, 'json').trimStart(), '[')
  includes('renderSchema openai', renderSchema(tools, 'openai'), '"type": "function"')
  includes('renderSchema mcp', renderSchema(tools, 'mcp'), '"inputSchema"')
  includes('renderSchema typescript', renderSchema(tools, 'typescript'), 'export interface')
  includes('renderSchema pydantic', renderSchema(tools, 'pydantic'), 'class ')
}

/* ================= 汇总 ================= */

console.log('')
if (failures.length) {
  console.error(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`✓ Tool Schema 互转：${passed} 项断言全部通过`)
