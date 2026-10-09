/**
 * GraphQL 纯逻辑冒烟。
 *
 * 重点不在「正常路径能不能跑」（那靠肉眼），而在**容错**：
 * GraphQL 的响应形态在不同服务端差异很大（data 包一层还是裸 __schema、
 * errors 的 extensions 有没有 code、网关返回 HTML 而非 JSON……），
 * 这些差异导致的失败都很安静 —— 页面显示空白，用户不知道是服务端的问题还是工具坏了。
 */
import {
  parseIntrospection,
  parseGqlResponse,
  buildGqlBody,
  guessOperationName,
  INTROSPECTION_QUERY,
  type GqlSchema,
} from '../src/lib/toolkit/graphql'

let pass = 0
const fails: string[] = []
function ok(cond: boolean, label: string): void {
  if (cond) {
    pass++
    return
  }
  fails.push(label)
  console.error(`  ✗ ${label}`)
}
function eq<T>(got: T, want: T, label: string): void {
  ok(got === want, `${label}（期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}）`)
}
function throws(code: string, fn: () => unknown, label: string): void {
  try {
    fn()
    fails.push(label)
    console.error(`  ✗ ${label}（应当抛 ${code}，实际没抛）`)
  } catch (e) {
    eq((e as Error).message, code, label)
  }
}

/* ================= 造一份 introspection 响应 ================= */

/** 最小可用的 introspection 响应，字段顺序贴近真实服务端 */
const SAMPLE = {
  data: {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      types: [
        {
          kind: 'OBJECT',
          name: 'Query',
          description: '根查询',
          fields: [
            {
              name: 'user',
              description: '按 id 取用户',
              type: {
                kind: 'NON_NULL',
                name: null,
                ofType: { kind: 'OBJECT', name: 'User', ofType: null },
              },
              args: [
                {
                  name: 'id',
                  description: '用户 id',
                  type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'ID' } },
                  defaultValue: null,
                },
                {
                  name: 'withPosts',
                  description: '是否带文章',
                  type: { kind: 'SCALAR', name: 'Boolean' },
                  defaultValue: 'false',
                },
              ],
              enumValues: null,
            },
            {
              name: 'users',
              description: '用户列表',
              type: {
                kind: 'LIST',
                name: null,
                ofType: { kind: 'OBJECT', name: 'User', ofType: null },
              },
              args: [
                {
                  name: 'limit',
                  description: '条数',
                  type: { kind: 'SCALAR', name: 'Int' },
                  defaultValue: '20',
                },
                {
                  name: 'role',
                  description: '角色',
                  type: { kind: 'ENUM', name: 'Role', ofType: null },
                  defaultValue: null,
                },
              ],
              enumValues: null,
            },
          ],
          enumValues: null,
        },
        {
          kind: 'OBJECT',
          name: 'Mutation',
          description: null,
          fields: [
            {
              name: 'createUser',
              description: '建用户',
              type: { kind: 'OBJECT', name: 'User', ofType: null },
              args: [
                {
                  name: 'name',
                  description: '姓名',
                  type: {
                    kind: 'NON_NULL',
                    name: null,
                    ofType: { kind: 'SCALAR', name: 'String' },
                  },
                  defaultValue: null,
                },
              ],
              enumValues: null,
            },
          ],
          enumValues: null,
        },
        {
          kind: 'OBJECT',
          name: 'User',
          description: '用户',
          fields: [
            {
              name: 'id',
              description: null,
              type: { kind: 'NON_NULL', name: null, ofType: { kind: 'SCALAR', name: 'ID' } },
              args: [],
              enumValues: null,
            },
            {
              name: 'email',
              description: '邮箱',
              type: { kind: 'SCALAR', name: 'String' },
              args: [],
              enumValues: null,
            },
            {
              name: 'role',
              description: '角色',
              type: { kind: 'ENUM', name: 'Role' },
              args: [],
              enumValues: null,
            },
          ],
          enumValues: null,
        },
        {
          kind: 'ENUM',
          name: 'Role',
          description: '角色',
          fields: null,
          enumValues: [
            { name: 'ADMIN', description: '管理员' },
            { name: 'USER', description: '普通用户' },
          ],
        },
        // 内置标量：没有 fields 也没有 enumValues，应该被过滤
        { kind: 'SCALAR', name: 'String', description: null, fields: null, enumValues: null },
        { kind: 'SCALAR', name: 'Int', description: null, fields: null, enumValues: null },
        // introspection 自类型：应该被过滤
        {
          kind: 'OBJECT',
          name: '__Schema',
          description: null,
          fields: [{ name: 'types', description: null, type: null, args: [], enumValues: null }],
          enumValues: null,
        },
      ],
    },
  },
}

/* ================= 1. introspection 解析 ================= */
{
  const s: GqlSchema = parseIntrospection(SAMPLE)
  eq(s.typeCount, 7, 'typeCount 是原始类型总数 7（含标量与 __ 类型）')
  eq(s.types.length, 4, '展示用 types 有4 个（Query/Mutation/User/Role，标量与 __ 已过滤）')
  ok(!s.types.some((t) => t.name === 'String'), '内置标量 String 不进展示列表')
  ok(!s.types.some((t) => t.name === '__Schema'), '__Schema 不进展示列表')
  ok(
    s.types.some((t) => t.name === 'User'),
    'User 在展示列表里',
  )
}

{
  const s = parseIntrospection(SAMPLE)
  eq(s.queryFields.length, 2, 'Query 有 2 个字段')
  eq(s.queryFields[0].name, 'user', '第一个字段是 user')
  eq(s.queryFields[0].type, 'User!', 'NON_NULL 渲染成 User!')
  eq(s.queryFields[1].type, '[User]', 'LIST 渲染成 [User]')
  eq(s.mutationFields.length, 1, 'Mutation 有 1 个字段')
  eq(s.mutationFields[0].name, 'createUser', 'Mutation 字段名正确')
}

{
  const s = parseIntrospection(SAMPLE)
  const user = s.queryFields[0]
  eq(user.args.length, 2, 'user 有 2 个入参')
  eq(user.args[0].name, 'id', '入参名id')
  eq(user.args[0].type, 'ID!', '入参类型 NON_NULL → ID!')
  eq(user.args[0].defaultValue, '', '无默认值时是空串（不是 "null"）')
  eq(user.args[1].defaultValue, 'false', '有默认值时保留字符串形态')
}

{
  const s = parseIntrospection(SAMPLE)
  const role = s.types.find((t) => t.name === 'Role')
  ok(!!role, 'Role 类型存在')
  eq(role!.kind, 'ENUM', 'Role 是 ENUM')
  eq(role!.enumValues.length, 2, 'Role 有 2 个枚举值')
  eq(role!.enumValues[0], 'ADMIN', '第一个枚举值 ADMIN')
}

/* --- 容错：真实服务端的差异 --- */
{
  // 有些不带 data 包装，直接返回 __schema
  const bare = { __schema: (SAMPLE as any).data.__schema }
  const s = parseIntrospection(bare)
  eq(s.queryFields.length, 2, '兼容不带 data 包装的响应')
}

{
  // 服务端禁用 introspection 时 types 为 null
  throws(
    'BAD_INTROSPECTION',
    () => parseIntrospection({ data: { __schema: { types: null } } }),
    'types 为 null 时抛 BAD_INTROSPECTION',
  )
}

{
  // 权限不足时走 errors
  throws(
    'BAD_INTROSPECTION',
    () => parseIntrospection({ errors: [{ message: 'introspection disabled' }] }),
    '服务端返回 errors 时抛 BAD_INTROSPECTION',
  )
}

{
  throws('BAD_INTROSPECTION', () => parseIntrospection({}), '空对象抛 BAD_INTROSPECTION')
  throws('BAD_INTROSPECTION', () => parseIntrospection(null), 'null 抛 BAD_INTROSPECTION')
  throws('BAD_INTROSPECTION', () => parseIntrospection('not json'), '字符串抛 BAD_INTROSPECTION')
}

{
  // 字段里 type 为 null（部分服务端裁剪过）不该崩
  const weird = {
    data: {
      __schema: {
        types: [
          {
            kind: 'OBJECT',
            name: 'Query',
            fields: [{ name: 'x', type: null, args: null, enumValues: null }],
          },
        ],
      },
    },
  }
  const s = parseIntrospection(weird)
  eq(s.queryFields[0].type, '', 'type 为 null 时渲染成空串而不是崩')
  eq(s.queryFields[0].args.length, 0, 'args 为 null 时空数组')
}

{
  // 深层嵌套的 ofType（4 层以上）
  const deep = {
    data: {
      __schema: {
        types: [
          {
            kind: 'OBJECT',
            name: 'Query',
            fields: [
              {
                name: 'deep',
                type: {
                  kind: 'NON_NULL',
                  ofType: {
                    kind: 'LIST',
                    ofType: {
                      kind: 'NON_NULL',
                      ofType: { kind: 'OBJECT', name: 'A', ofType: null },
                    },
                  },
                },
                args: [],
              },
            ],
          },
        ],
      },
    },
  }
  // NON_NULL → LIST → NON_NULL → A：每层各一个 '!'，所以是 [A!]!
  eq(parseIntrospection(deep).queryFields[0].type, '[A!]!', '多层 ofType 正确还原')
}

{
  ok(INTROSPECTION_QUERY.includes('__schema'), 'introspection 查询非空')
  ok(INTROSPECTION_QUERY.includes('fragment TypeRef'), 'introspection 查询带 TypeRef 片段')
}

/* ================= 2. 响应整形 ================= */
{
  const r = parseGqlResponse(
    JSON.stringify({ data: { user: { id: '1', email: 'a@b.c' } } }),
    200,
    42,
  )
  eq(r.status, 200, '状态码透传')
  eq(r.errors.length, 0, '无错误')
  eq(r.elapsedMs, 42, '耗时透传')
  ok(r.data.includes('"email"'), 'data 被格式化成缩进 JSON')
  ok(r.data.includes('a@b.c'), 'data 内容正确')
}

{
  // GraphQL 的典型错误：HTTP 200 但 errors 数组有值
  const r = parseGqlResponse(
    JSON.stringify({
      data: null,
      errors: [
        {
          message: 'Cannot query field "nmae"',
          path: ['user', 'nmae'],
          extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
          locations: [{ line: 2, column: 5 }],
        },
      ],
    }),
    200,
    10,
  )
  eq(r.errors.length, 1, '提取到 1 个错误')
  eq(r.errors[0].message, 'Cannot query field "nmae"', '错误 message 正确')
  eq(r.errors[0].path, 'user.nmae', 'path 数组拼成点号路径')
  eq(r.errors[0].code, 'GRAPHQL_VALIDATION_FAILED', 'extensions.code 提取成功')
  eq(r.errors[0].locations, '2:5', 'locations 格式化为 line:column')
}

{
  // 服务端禁用了 introspection：400 + errors
  const r = parseGqlResponse(
    JSON.stringify({ errors: [{ message: 'GraphQL introspection is not allowed' }] }),
    400,
    8,
  )
  eq(r.status, 400, '400 状态码透传')
  eq(r.errors.length, 1, '400 也照样提取 errors（这才是有用的信息）')
  eq(r.errors[0].code, '', 'extensions 缺失时 code 为空串')
  eq(r.errors[0].path, '', 'path 缺失时为空串')
}

{
  // 网关返回 HTML 错误页：不能崩，原样带回
  const r = parseGqlResponse('<html><body>502 Bad Gateway</body></html>', 502, 5)
  eq(r.status, 502, 'HTML 响应状态码透传')
  eq(r.raw.includes('502 Bad Gateway'), true, 'HTML 原样带回让用户看到真实原因')
  eq(r.data, '', '非 JSON 时 data 为空')
  eq(r.errors.length, 0, '非 JSON 时不伪造错误')
}

{
  // partial data + errors 同时存在（GraphQL 允许）
  const r = parseGqlResponse(
    JSON.stringify({ data: { a: 1 }, errors: [{ message: 'field b failed' }] }),
    200,
    3,
  )
  ok(r.data.includes('"a"'), '部分成功时 data 仍有内容')
  eq(r.errors.length, 1, '部分成功时错误也要报出来（不能因为有 data 就吞掉）')
}

{
  const r = parseGqlResponse('', 204, 1)
  eq(r.raw, '', '空响应体不崩')
  eq(r.data, '', '空响应 data 为空')
}

{
  const r = parseGqlResponse(JSON.stringify({ data: null }), 200, 1)
  eq(r.data, '', 'data 为 null 时空串（不是 "null" 字符串）')
}

/* ================= 3. 请求体构造 ================= */
{
  const b = JSON.parse(buildGqlBody('{ user { id } }', '', ''))
  eq(Object.keys(b).length, 1, '只有 query 时只发一个字段')
  eq(b.query, '{ user { id } }', 'query 内容正确')
}

{
  // operationName 为空必须省略而不是传空串
  const b = JSON.parse(buildGqlBody('{ user { id } }', '', '  '))
  ok(!('operationName' in b), 'operationName 为空白时省略该字段（传空串会被服务端拒）')
}

{
  const b = JSON.parse(buildGqlBody('query GetUser { user { id } }', '{"id":"1"}', 'GetUser'))
  eq(b.operationName, 'GetUser', 'operationName 正确')
  eq(b.variables.id, '1', 'variables 正确')
}

{
  const b = JSON.parse(buildGqlBody('q', '{}', ''))
  eq(JSON.stringify(b.variables), '{}', '空对象 variables 也要发（用户显式给了）')
}

{
  // 非法 JSON variables 必须报明确错误
  let msg = ''
  try {
    buildGqlBody('q', '{bad json', '')
  } catch (e) {
    msg = (e as Error).message
  }
  ok(msg.startsWith('BAD_VARIABLES:'), `variables 非法时抛 BAD_VARIABLES（实际 ${msg}）`)
}

{
  // variables 里的引号要正确转义，不能破坏 JSON 结构
  const b = JSON.parse(buildGqlBody('q', '{"name":"a\\"b"}', ''))
  eq(b.variables.name, 'a"b', 'variables 内含引号时正确转义')
}

/* ================= 4. operation 名猜测 ================= */
{
  eq(guessOperationName('query GetUser { user { id } }'), 'GetUser', '猜出 query 名')
  eq(
    guessOperationName('mutation CreateUser($n:String!){ createUser(name:$n){ id } }'),
    'CreateUser',
    '猜出 mutation 名',
  )
  eq(
    guessOperationName('subscription OnEvent { events { id } }'),
    'OnEvent',
    '猜出 subscription 名',
  )
  eq(guessOperationName('{ user { id } }'), '', '匿名 query 返回空串')
  eq(guessOperationName(''), '', '空查询返回空串')
  // 字段里出现 query 这个词不该被误判
  eq(guessOperationName('{ search(query: "x") { id } }'), '', '字段参数里的 query 不被误判')
}

/* ================= 结果 ================= */

if (fails.length) {
  console.error(`\n✗ smoke:graphql 失败：${pass} 通过 / ${fails.length} 失败`)
  process.exit(1)
}
console.log(`✓ smoke:graphql ${pass} 项全部通过`)
