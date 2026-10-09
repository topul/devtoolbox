/**
 * GraphQL 的纯逻辑：introspection 解析、响应整形、错误提取。
 *
 * 为什么把这部分抽出来：网络请求要走主进程（渲染层有 CSP 与 CORS 限制），
 * 但「拿到JSON 之后怎么整理成给人看的东西」是纯计算，渲染层与 MCP 端都用得上。
 *
 * 两条硬约束（与项目其他 toolkit 一致）：
 *   1. 不import DOM / React / electron / Node 内置；
 *   2. 只抛稳定错误码，中英文提示语归界面词条。
 */

/* ================= 类型与字段 ================= */

/** schema 里的一个字段 */
export interface GqlField {
  name: string
  /** GraphQL 类型名，如 `String` / `Int!` / `[User]` */
  type: string
  /** 字段说明（description） */
  desc: string
  /** 枚举值的可选值（仅 enum 类型有） */
  enumValues: string[]
  /** 字段的入参（仅 object 类型的字段有） */
  args: GqlArg[]
}

/** 字段的入参 */
export interface GqlArg {
  name: string
  type: string
  desc: string
  defaultValue: string
}

/** 一个类型（Query / Mutation / 自定义对象 / 枚举） */
export interface GqlType {
  name: string
  kind: string
  desc: string
  fields: GqlField[]
  enumValues: string[]
}

/** 解析后的 schema 摘要 */
export interface GqlSchema {
  types: GqlType[]
  queryFields: GqlField[]
  mutationFields: GqlField[]
  /** 类型总数（原始 introspection 的 `__schema.types` 长度，含内置标量） */
  typeCount: number
}

/* ================= introspection 解析 ================= */

/** 把 introspection 的 type 引用树拍平成可读的类型名 */
function renderTypeRef(t: unknown): string {
  if (t === null || t === undefined) return ''
  const o = t as { kind?: string; name?: string; ofType?: unknown }
  if (o.kind === 'NON_NULL') return `${renderTypeRef(o.ofType)}!`
  if (o.kind === 'LIST') return `[${renderTypeRef(o.ofType)}]`
  return o.name ?? ''
}

function argsOf(f: Record<string, unknown>): GqlArg[] {
  const args = f.args
  if (!Array.isArray(args)) return []
  return (args as Array<Record<string, unknown>>).map((a) => ({
    name: String(a.name ?? ''),
    type: renderTypeRef(a.type),
    desc: String(a.description ?? ''),
    defaultValue:
      a.defaultValue === null || a.defaultValue === undefined ? '' : String(a.defaultValue),
  }))
}

function fieldsOf(t: Record<string, unknown>): GqlField[] {
  const fields = t.fields
  if (!Array.isArray(fields)) return []
  return (fields as Array<Record<string, unknown>>).map((f) => {
    const ev = f.enumValues
    return {
      name: String(f.name ?? ''),
      type: renderTypeRef(f.type),
      desc: String(f.description ?? ''),
      enumValues: Array.isArray(ev)
        ? (ev as Array<Record<string, unknown>>).map((x) => String(x.name ?? '')).filter(Boolean)
        : [],
      args: argsOf(f),
    }
  })
}

/**
 * 解析 introspection 响应，产出 schema 摘要。
 *
 * 容错点（真实服务端差异都踩过）：
 *   - 有些服务端在 `data` 里返回，也有些直接返回 `__schema`；
 *   - `types` 可能是 null（服务端禁用了 introspection）；
 *   - 内置标量（String/Int/…）没有 fields，要过滤掉否则列表全是噪声。
 *
 * @throws {Error} `BAD_INTROSPECTION` —— 响应里找不到 schema
 */
export function parseIntrospection(payload: unknown): GqlSchema {
  const root = payload as {
    data?: { __schema?: unknown }
    __schema?: unknown
    errors?: unknown
  } | null

  // GraphQL 规范要求错误走 errors 数组；这里先看有没有明确报错
  if (root && Array.isArray(root.errors) && root.errors.length > 0) {
    throw new Error('BAD_INTROSPECTION')
  }

  const schema =
    (root?.data?.__schema as Record<string, unknown> | undefined) ??
    (root?.__schema as Record<string, unknown> | undefined)

  if (!schema || typeof schema !== 'object') throw new Error('BAD_INTROSPECTION')

  const rawTypes = schema.types
  if (!Array.isArray(rawTypes)) throw new Error('BAD_INTROSPECTION')

  const types: GqlType[] = []
  for (const t of rawTypes as Array<Record<string, unknown>>) {
    const name = String(t.name ?? '')
    if (!name) continue
    // 跳过 introspection 自身的类型（__Schema / __Type / …）与内置标量：
    // 它们对使用者没有信息量，却占了列表大半
    if (name.startsWith('__')) continue
    const ev = t.enumValues
    const fields = fieldsOf(t)
    const enumValues = Array.isArray(ev)
      ? (ev as Array<Record<string, unknown>>).map((x) => String(x.name ?? '')).filter(Boolean)
      : []
    // 既没有字段又不是枚举的类型（内置标量）不必展示
    if (fields.length === 0 && enumValues.length === 0) continue
    types.push({
      name,
      kind: String(t.kind ?? ''),
      desc: String(t.description ?? ''),
      fields,
      enumValues,
    })
  }

  const query = types.find((t) => t.name === 'Query')
  const mutation = types.find((t) => t.name === 'Mutation')

  return {
    types,
    queryFields: query?.fields ?? [],
    mutationFields: mutation?.fields ?? [],
    typeCount: rawTypes.length,
  }
}

/** 拉 schema 用的 introspection 查询（只取必要字段，服务端负担更小） */
export const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        type { ...TypeRef }
        args { name description type { ...TypeRef } defaultValue }
      }
      enumValues(includeDeprecated: true) { name description }
    }
  }
}
fragment TypeRef on __Type {
  kind
  name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
}`

/* ================= 响应整形 ================= */

/** 从GraphQL 响应里抽出的错误 */
export interface GqlError {
  message: string
  /** 字段路径，如 `user.email` */
  path: string
  /** 错误码（extensions.code，GraphQL 标准里可选） */
  code: string
  locations: string
}

/** 一次查询的结果 */
export interface GqlResult {
  data: string
  errors: GqlError[]
  /** HTTP 状态码 */
  status: number
  /** 原始响应体（用户要能自己看，服务端报错时 JSON 往往不在 data 里） */
  raw: string
  /** 耗时（毫秒） */
  elapsedMs: number
}

/**
 * 整形一次 GraphQL 响应。
 *
 * 不抛异常：HTTP 4xx/5xx 携带的 JSON 里往往**才是**最有价值的错误信息
 * （比如字段不存在时服务端返回 400 + errors），直接抛掉等于把线索扔了。
 */
export function parseGqlResponse(bodyText: string, status: number, elapsedMs: number): GqlResult {
  const raw = bodyText ?? ''
  let obj: unknown = null
  try {
    obj = JSON.parse(raw)
  } catch {
    // 不是 JSON（比如网关返回了 HTML 错误页）—— 原样带回，界面会显示它
    return { data: '', errors: [], status, raw, elapsedMs }
  }

  const o = obj as { data?: unknown; errors?: unknown }
  const errors: GqlError[] = []
  if (Array.isArray(o.errors)) {
    for (const e of o.errors as Array<Record<string, unknown>>) {
      errors.push({
        message: String(e.message ?? ''),
        path: Array.isArray(e.path) ? (e.path as unknown[]).join('.') : '',
        code: String((e.extensions as Record<string, unknown> | undefined)?.code ?? ''),
        locations: Array.isArray(e.locations)
          ? (e.locations as Array<Record<string, unknown>>)
              .map((l) => `${l.line}:${l.column}`)
              .join(', ')
          : '',
      })
    }
  }

  const data = o.data === undefined || o.data === null ? '' : JSON.stringify(o.data, null, 2)

  return { data, errors, status, raw, elapsedMs }
}

/* ================= 请求体构造 ================= */

/**
 * 构造 GraphQL 请求体。
 *
 * operationName 为空时**省略该字段**而不是传空串：有些服务端会因此报
 *「必须提供 operation name」，宁可不给。
 */
export function buildGqlBody(query: string, variables: string, operationName: string): string {
  const body: { query: string; variables?: unknown; operationName?: string } = { query }
  const vs = variables.trim()
  if (vs) {
    let parsed: unknown
    try {
      parsed = JSON.parse(vs)
    } catch (e) {
      throw new Error(`BAD_VARIABLES:${(e as Error).message}`)
    }
    body.variables = parsed
  }
  const op = operationName.trim()
  if (op) body.operationName = op
  return JSON.stringify(body)
}

/** 从 query 文本里猜 operation 名（多operation 时用户不填operationName 会报错） */
export function guessOperationName(query: string): string {
  const m = /\b(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query)
  return m ? m[1] : ''
}
