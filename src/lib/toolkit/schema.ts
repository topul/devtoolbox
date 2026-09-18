/**
 * 工具 / 函数 schema 的互转与体检。
 *
 * 背景：给模型定义工具的那份 schema 有三套常见写法，互相之间没有官方转换器：
 *   - OpenAI `tools` JSON：`[{ type: 'function', function: { name, description, parameters } }]`
 *   - MCP `inputSchema`：`{ name, description, inputSchema }`（就是本仓库 MCP 服务端吐的形态）
 *   - 裸 JSON Schema：`{ type: 'object', properties: {...} }`
 *
 * 模型在这件事上出错率很高（required 写了却没定义、字段没有 description、name 带空格），
 * 而这些错在运行时表现为「模型乱给参数」，很难定位。所以这里除了互转，还带一份体检。
 *
 * 本模块是纯函数：不带界面、不依赖 node，渲染层与 MCP 端共用。
 */

export type JsonSchema = Record<string, unknown>

/** 归一化后的一个工具定义 */
export interface NormalizedTool {
  name: string
  description: string
  parameters: JsonSchema
}

export type SchemaIssueLevel = 'error' | 'warn'

export interface SchemaIssue {
  /** 定位路径，如 `parameters.properties.city.type`；工具级问题为 `tools[0]` */
  path: string
  level: SchemaIssueLevel
  /** 稳定错误码，文案由界面负责映射 */
  code: string
  /** 补充信息（原始值、实际位置等），不含提示语 */
  detail?: string
}

export interface ParseResult {
  tools: NormalizedTool[]
  issues: SchemaIssue[]
}

/** 只带稳定错误码的异常；文案归界面 */
export class ToolSchemaError extends Error {
  constructor(public readonly code: string, public readonly detail?: string) {
    super(code)
    this.name = 'ToolSchemaError'
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 合法的 JSON Schema 顶层类型 */
const JSON_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] as const

/* ================= 解析 ================= */

/**
 * 吃三种输入形态，产出统一结构。
 * 抛 `EMPTY_INPUT` / `INVALID_JSON` / `NO_TOOL`。
 */
export function parseToolSchema(text: string): ParseResult {
  const raw = text.trim()
  if (!raw) throw new ToolSchemaError('EMPTY_INPUT')

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    throw new ToolSchemaError('INVALID_JSON', (e as Error).message)
  }

  const issues: SchemaIssue[] = []
  const tools = collectTools(data, issues, 'tools')
  if (!tools.length) throw new ToolSchemaError('NO_TOOL')
  for (const t of tools) lintTool(t, issues)
  return { tools, issues }
}

/** 从一个任意 JSON 值里收集工具定义（递归处理 tools / functions 包装） */
function collectTools(data: unknown, issues: SchemaIssue[], path: string): NormalizedTool[] {
  if (Array.isArray(data)) {
    return data.flatMap((item, i) => collectTools(item, issues, `${path}[${i}]`))
  }
  if (!isObj(data)) {
    throw new ToolSchemaError('NO_TOOL', path)
  }

  // OpenAI 新版：{ tools: [...] }；旧版 / 部分网关：{ functions: [...] }
  for (const key of ['tools', 'functions'] as const) {
    if (Array.isArray(data[key])) {
      const list = collectTools(data[key], issues, `${path}.${key}`)
      // 保留 tools 数组本身可能携带的其它字段（如 tool_choice）由界面另行处理
      return list
    }
  }

  // OpenAI 单项：{ type: 'function', function: {...} }
  if (isObj(data.function)) {
    return [normalizeTool(data.function, issues, `${path}.function`)]
  }
  // MCP 单项：{ name, inputSchema } 或 { name, parameters } / { name, schema }
  if (typeof data.name === 'string' || typeof data.name === 'undefined') {
    const params = (data.parameters ?? data.inputSchema ?? data.schema) as unknown
    if (isObj(params) || typeof data.name === 'string') {
      return [normalizeTool({ ...data, parameters: isObj(params) ? params : data }, issues, path)]
    }
  }

  // 裸 JSON Schema：整份就是参数定义
  if (isObj(data.properties) || data.type === 'object') {
    return [
      normalizeTool(
        {
          name: typeof data.title === 'string' && data.title ? data.title : 'params',
          description: typeof data.description === 'string' ? data.description : '',
          parameters: data,
        },
        issues,
        path,
      ),
    ]
  }

  throw new ToolSchemaError('NO_TOOL', path)
}

function normalizeTool(src: Record<string, unknown>, issues: SchemaIssue[], path: string): NormalizedTool {
  const name = typeof src.name === 'string' ? src.name : ''
  if (!name) issues.push({ path, level: 'error', code: 'NAME_MISSING' })

  const description = typeof src.description === 'string' ? src.description : ''

  const rawParams = src.parameters ?? src.inputSchema ?? src.schema
  const parameters: JsonSchema = isObj(rawParams) ? rawParams : { type: 'object', properties: {} }
  if (!isObj(rawParams)) {
    issues.push({ path: `${path}.parameters`, level: 'warn', code: 'PARAMS_ASSUMED_OBJECT' })
  }

  return { name, description, parameters }
}

/* ================= 体检 ================= */

/** 工具名允许的字符（OpenAI 限制）；MCP 并未强制，但越界会让部分客户端拒绝加载 */
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

function lintTool(tool: NormalizedTool, issues: SchemaIssue[]): void {
  const at = `tools[${tool.name || '?'}]`
  if (tool.name && !NAME_RE.test(tool.name)) {
    issues.push({
      path: `${at}.name`,
      level: 'error',
      code: 'NAME_INVALID',
      detail: tool.name,
    })
  }
  if (!tool.description.trim()) {
    issues.push({ path: `${at}.description`, level: 'warn', code: 'TOOL_DESC_MISSING' })
  }
  if (tool.parameters.type !== 'object') {
    // OpenAI 与多数客户端只接受对象型参数
    issues.push({
      path: `${at}.parameters.type`,
      level: 'warn',
      code: 'PARAMS_NOT_OBJECT',
      detail: String(tool.parameters.type),
    })
  }
  lintNode(tool.parameters, `${at}.parameters`, issues, new Set(), 0, true)
}

function lintNode(
  node: JsonSchema,
  path: string,
  issues: SchemaIssue[],
  defined: Set<string>,
  depth: number,
  requiredHere: boolean,
): void {
  if (!isObj(node)) return
  if (depth > 12) {
    issues.push({ path, level: 'warn', code: 'DEPTH_TOO_DEEP' })
    return
  }

  const { type } = node
  if (typeof type === 'string' && !(JSON_TYPES as readonly string[]).includes(type)) {
    issues.push({ path: `${path}.type`, level: 'error', code: 'TYPE_INVALID', detail: type })
  } else if (Array.isArray(type)) {
    for (const t of type) {
      if (typeof t !== 'string' || !(JSON_TYPES as readonly string[]).includes(t)) {
        issues.push({ path: `${path}.type`, level: 'error', code: 'TYPE_INVALID', detail: String(t) })
      }
    }
  }

  const props = isObj(node.properties) ? node.properties : null
  const required = Array.isArray(node.required) ? node.required.map(String) : []

  if (required.length) {
    if (!props) {
      issues.push({ path: `${path}.required`, level: 'error', code: 'REQUIRED_WITHOUT_PROPERTIES' })
    } else {
      for (const key of required) {
        if (!(key in props)) {
          issues.push({
            path: `${path}.required`,
            level: 'error',
            code: 'REQUIRED_NOT_DEFINED',
            detail: key,
          })
        }
      }
    }
  }

  if (Array.isArray(node.enum) && node.enum.length === 0) {
    issues.push({ path: `${path}.enum`, level: 'warn', code: 'ENUM_EMPTY' })
  }

  if (node.enum !== undefined && type === undefined && !node.anyOf && !node.oneOf) {
    issues.push({ path, level: 'warn', code: 'ENUM_WITHOUT_TYPE' })
  }

  // 字段级 description 缺失：这是让模型正确填参最廉价也最有效的手段
  if (props) {
    const childDefined = new Set<string>()
    for (const [key, child] of Object.entries(props)) {
      const childPath = `${path}.properties.${key}`
      if (!isObj(child)) {
        issues.push({ path: childPath, level: 'error', code: 'PROPERTY_NOT_SCHEMA' })
        continue
      }
      if (!String(child.description ?? '').trim() && child.type !== 'object') {
        issues.push({ path: childPath, level: 'warn', code: 'PROP_MISSING_DESC', detail: key })
      }
      lintNode(child, childPath, issues, childDefined, depth + 1, required.includes(key))
    }
  }

  if (type === 'array' || Array.isArray(type) && type.includes('array')) {
    if (node.items === undefined) {
      issues.push({ path: `${path}.items`, level: 'warn', code: 'ARRAY_WITHOUT_ITEMS' })
    } else if (isObj(node.items)) {
      lintNode(node.items, `${path}.items`, issues, defined, depth + 1, true)
    }
  }

  for (const comb of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = node[comb]
    if (Array.isArray(branches)) {
      branches.forEach((b, i) => {
        if (isObj(b)) lintNode(b, `${path}.${comb}[${i}]`, issues, defined, depth + 1, requiredHere)
      })
    }
  }

  if (isObj(node.additionalProperties)) {
    lintNode(node.additionalProperties, `${path}.additionalProperties`, issues, defined, depth + 1, true)
  }

  if (typeof node.default !== 'undefined' && Array.isArray(node.enum) && node.enum.length) {
    if (!node.enum.some((e) => deepEqual(e, node.default))) {
      issues.push({
        path: `${path}.default`,
        level: 'warn',
        code: 'DEFAULT_NOT_IN_ENUM',
        detail: JSON.stringify(node.default),
      })
    }
  }

  void defined
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}

/* ================= 输出：JSON Schema / OpenAI ================= */

export function toJsonSchema(tools: NormalizedTool[]): string {
  if (tools.length === 1) return JSON.stringify(tools[0].parameters, null, 2)
  return JSON.stringify(tools.map((t) => t.parameters), null, 2)
}

export function toOpenAiSpec(tools: NormalizedTool[], opts: { strict?: boolean } = {}): string {
  const list = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.parameters,
      ...(opts.strict ? { strict: true } : {}),
    },
  }))
  return JSON.stringify({ tools: list }, null, 2)
}

/** MCP `tools/list` 的形态，便于把 OpenAI 风格的声明搬回 MCP 服务端 */
export function toMcpSpec(tools: NormalizedTool[]): string {
  return JSON.stringify(
    {
      tools: tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        inputSchema: t.parameters,
      })),
    },
    null,
    2,
  )
}

/* ================= 输出：TypeScript ================= */

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function pascal(s: string): string {
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const joined = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join('')
  return joined || 'Params'
}

function camel(s: string): string {
  const p = pascal(s)
  return p[0].toLowerCase() + p.slice(1)
}

/** 标识符清洗：非法字符换下划线，数字开头补下划线 */
function safeIdent(s: string): string {
  const cleaned = s.replace(/[^A-Za-z0-9_$]/g, '_')
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || '_'
}

function tsKey(k: string): string {
  return IDENT_RE.test(k) ? k : tsLiteral(k)
}

/** 生成的 TS 用手写风格的单引号（也是本仓库的代码风格） */
function tsLiteral(v: unknown): string {
  if (typeof v === 'string') {
    // 借 JSON 的转义做基础，再把单引号转义、把多余的 \" 还原
    const inner = JSON.stringify(v)
      .slice(1, -1)
      .replace(/'/g, "\\'")
      .replace(/\\"/g, '"')
    return `'${inner}'`
  }
  if (v === null) return 'null'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export interface TsOptions {
  /** 把字段的 description 落成 JSDoc（默认开） */
  jsdoc?: boolean
}

export function schemaToTypeScript(tools: NormalizedTool[], opts: TsOptions = {}): string {
  const chunks: string[] = []
  for (const t of tools) {
    const out: string[] = []
    const used = new Set<string>()
    OUT_NAMES.set(out, used)
    const root = uniqueName(`${pascal(t.name)}Args`, used)
    // 先递归生成嵌套 interface（它们会被推进 out），根接口最后落地
    const body = tsInterfaceBody(t.parameters, out, opts.jsdoc !== false, 0, root)
    out.push(`export interface ${root} {`)
    out.push(...body)
    out.push('}')
    chunks.push(out.join('\n'))
  }
  return chunks.join('\n\n')
}

function tsInterfaceBody(
  node: JsonSchema,
  out: string[],
  jsdoc: boolean,
  depth = 0,
  owner?: string,
): string[] {
  const props = isObj(node.properties) ? node.properties : {}
  const required = new Set(Array.isArray(node.required) ? node.required.map(String) : [])
  const lines: string[] = []
  for (const [key, child] of Object.entries(props)) {
    if (!isObj(child)) continue
    const doc = typeof child.description === 'string' ? child.description.trim() : ''
    if (jsdoc && doc) {
      lines.push('  /**')
      for (const line of doc.split('\n')) lines.push(`   * ${line}`)
      lines.push('   */')
    }
    const optional = required.has(key) ? '' : '?'
    const nestedName = owner ? `${owner}${pascal(key)}` : undefined
    const type = tsInline(child, out, jsdoc, depth + 1, nestedName)
    lines.push(`  ${tsKey(key)}${optional}: ${type}`)
  }
  if (!lines.length) lines.push('  [key: string]: unknown')
  return lines
}

/** 单个 schema 节点 → TS 类型表达式；对象会顺带把嵌套 interface 推到 out 里 */
function tsInline(
  node: JsonSchema,
  out: string[],
  jsdoc: boolean,
  depth: number,
  nestedName?: string,
): string {
  if (!isObj(node)) return 'unknown'
  if (depth > 12) return 'unknown'

  if (Array.isArray(node.enum) && node.enum.length) {
    const parts = node.enum.map(tsLiteral)
    return [...new Set(parts)].join(' | ')
  }
  if (node.const !== undefined) return tsLiteral(node.const)

  for (const comb of ['oneOf', 'anyOf'] as const) {
    const branches = node[comb]
    if (Array.isArray(branches) && branches.length) {
      const parts = branches.map((b) => tsInline(isObj(b) ? b : {}, out, jsdoc, depth + 1, nestedName))
      return [...new Set(parts)].join(' | ')
    }
  }
  if (Array.isArray(node.allOf) && node.allOf.length) {
    const parts = node.allOf.map((b) => tsInline(isObj(b) ? b : {}, out, jsdoc, depth + 1, nestedName))
    return [...new Set(parts)].join(' & ')
  }

  const types = Array.isArray(node.type) ? node.type.map(String) : typeof node.type === 'string' ? [node.type] : []
  if (!types.length) {
    if (isObj(node.properties) || isObj(node.additionalProperties)) {
      return tsInlineObject(node, out, jsdoc, depth, nestedName)
    }
    return 'unknown'
  }

  const nonNull = types.filter((t) => t !== 'null')
  const nullable = types.includes('null')
  if (!nonNull.length) return 'null'

  let core: string
  if (nonNull.length > 1) {
    core = nonNull.map((t) => tsInline({ ...node, type: t }, out, jsdoc, depth + 1, nestedName)).join(' | ')
  } else {
    const t = nonNull[0]
    if (t === 'string') core = 'string'
    else if (t === 'number' || t === 'integer') core = 'number'
    else if (t === 'boolean') core = 'boolean'
    else if (t === 'null') core = 'null'
    else if (t === 'array') {
      const items = isObj(node.items)
        ? tsInline(node.items, out, jsdoc, depth + 1, nestedName ? `${nestedName}Item` : undefined)
        : 'unknown'
      core = /[|&\s]/.test(items) ? `Array<${items}>` : `${items}[]`
    } else if (t === 'object') {
      core = tsInlineObject(node, out, jsdoc, depth, nestedName)
    } else core = 'unknown'
  }
  return nullable ? `${core} | null` : core
}

function tsInlineObject(
  node: JsonSchema,
  out: string[],
  jsdoc: boolean,
  depth: number,
  nestedName?: string,
): string {
  const props = isObj(node.properties) ? node.properties : null
  if (!props || !Object.keys(props).length) {
    const add = node.additionalProperties
    if (isObj(add)) {
      return `Record<string, ${tsInline(add, out, jsdoc, depth + 1, nestedName ? `${nestedName}Value` : undefined)}>`
    }
    return 'Record<string, unknown>'
  }
  const name = nestedName ? uniqueName(nestedName, OUT_NAMES.get(out) ?? null) : undefined
  if (name) {
    out.push(`export interface ${name} {`)
    out.push(...tsInterfaceBody(node, out, jsdoc, depth + 1, name))
    out.push('}')
    return name
  }
  // 没有合适名字就内联展开
  const lines = tsInterfaceBody(node, out, false, depth + 1)
  return `{\n${lines.map((l) => `  ${l}`).join('\n')}\n}`
}

/** 每个 out 数组上挂一个已用名字集合，避免同名 interface 冲突 */
const OUT_NAMES = new WeakMap<string[], Set<string>>()

function uniqueName(name: string, used: Set<string> | null): string {
  if (!used) return name
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  let i = 2
  while (used.has(`${name}${i}`)) i++
  used.add(`${name}${i}`)
  return `${name}${i}`
}

/* ================= 输出：Pydantic ================= */

export interface PyOptions {
  /** 字段描述是否落成 Field(description=...)（默认开） */
  fields?: boolean
}

/** 按实际用到的名字生成 import，别塞一堆没用的进来（会被 linter 挑刺） */
function pyHeader(code: string): string {
  const names: string[] = []
  if (/\bAny\b/.test(code)) names.push('Any')
  if (/\bLiteral\[/.test(code)) names.push('Literal')
  if (/\bOptional\[/.test(code)) names.push('Optional')
  if (/\bUnion\[/.test(code)) names.push('Union')
  const typing = names.length ? `from typing import ${names.join(', ')}\n` : ''
  return `${typing}\nfrom pydantic import BaseModel, Field\n`
}

export function schemaToPydantic(tools: NormalizedTool[], opts: PyOptions = {}): string {
  const body: string[] = []
  for (const t of tools) {
    const root = `${pascal(t.name)}Args`
    const defs: string[] = []
    pyModel(t.parameters, root, defs, opts, t.description.trim())
    body.push(defs.join('\n\n'))
  }
  const code = body.join('\n\n\n')
  return `${pyHeader(code)}\n${code}\n`
}

function pyModel(
  node: JsonSchema,
  name: string,
  out: string[],
  opts: PyOptions,
  docstring: string,
): void {
  const props = isObj(node.properties) ? node.properties : {}
  const required = new Set(Array.isArray(node.required) ? node.required.map(String) : [])
  const lines: string[] = []

  for (const [key, child] of Object.entries(props)) {
    if (!isObj(child)) continue
    const field = safeIdent(key)
    // 先递归生成嵌套模型，这样父类能直接引用（不需要 from __future__ import annotations）
    const type = pyType(child, `${name}${pascal(key)}`, out, opts)
    const doc = typeof child.description === 'string' ? child.description.trim() : ''
    if (required.has(key)) {
      const args: string[] = []
      if (doc) args.push(`description=${pyStr(doc)}`)
      lines.push(`    ${field}: ${type}${args.length ? ` = Field(${args.join(', ')})` : ''}`)
    } else {
      const def = child.default
      const args: string[] = []
      if (def === undefined) {
        args.push('default=None')
      } else if (Array.isArray(def) || isObj(def)) {
        args.push(`default_factory=lambda: ${pyLiteral(def)}`)
      } else {
        args.push(`default=${pyLiteral(def)}`)
      }
      if (doc) args.push(`description=${pyStr(doc)}`)
      lines.push(`    ${field}: Optional[${type}] = Field(${args.join(', ')})`)
    }
  }

  if (!lines.length) lines.push('    pass')

  const head = `class ${name}(BaseModel):`
  const doc = docstring ? `    """${docstring.replace(/"""/g, "'''")}"""\n\n` : ''
  const block = doc ? `${head}\n${doc}${lines.join('\n')}` : `${head}\n${lines.join('\n')}`
  out.push(block)
}

function pyType(
  node: JsonSchema,
  nestedName: string,
  out: string[],
  opts: PyOptions,
): string {
  if (!isObj(node)) return 'Any'

  if (Array.isArray(node.enum) && node.enum.length) {
    return `Literal[${[...new Set(node.enum.map(pyLiteral))].join(', ')}]`
  }
  if (node.const !== undefined) return `Literal[${pyLiteral(node.const)}]`

  for (const comb of ['oneOf', 'anyOf'] as const) {
    const branches = node[comb]
    if (Array.isArray(branches) && branches.length) {
      const parts = [...new Set(branches.map((b) => pyType(isObj(b) ? b : {}, nestedName, out, opts)))]
      return parts.length === 1 ? parts[0] : `Union[${parts.join(', ')}]`
    }
  }

  const types = Array.isArray(node.type) ? node.type.map(String) : typeof node.type === 'string' ? [node.type] : []
  const nonNull = types.filter((t) => t !== 'null')

  let core = 'Any'
  if (!types.length) {
    if (isObj(node.properties)) {
      const nm = uniquePyName(nestedName, out)
      pyModel(node, nm, out, opts, '')
      core = nm
    }
  } else if (nonNull.length > 1) {
    const parts = [...new Set(nonNull.map((t) => pyType({ ...node, type: t }, nestedName, out, opts)))]
    core = parts.length === 1 ? parts[0] : `Union[${parts.join(', ')}]`
  } else {
    const t = nonNull[0] ?? 'null'
    if (t === 'string') core = 'str'
    else if (t === 'integer') core = 'int'
    else if (t === 'number') core = 'float'
    else if (t === 'boolean') core = 'bool'
    else if (t === 'null') core = 'None'
    else if (t === 'array') {
      core = isObj(node.items) ? `list[${pyType(node.items, `${nestedName}Item`, out, opts)}]` : 'list[Any]'
    } else if (t === 'object') {
      const props = isObj(node.properties) ? node.properties : null
      if (props && Object.keys(props).length) {
        const nm = uniquePyName(nestedName, out)
        pyModel(node, nm, out, opts, '')
        core = nm
      } else if (isObj(node.additionalProperties)) {
        core = `dict[str, ${pyType(node.additionalProperties, `${nestedName}Value`, out, opts)}]`
      } else {
        core = 'dict[str, Any]'
      }
    }
  }
  return core
}

/** Pydantic 模型名去重（同一文件里不能重名） */
const PY_NAMES = new WeakMap<string[], Set<string>>()

function uniquePyName(name: string, out: string[]): string {
  let used = PY_NAMES.get(out)
  if (!used) {
    used = new Set()
    PY_NAMES.set(out, used)
  }
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  let i = 2
  while (used.has(`${name}${i}`)) i++
  used.add(`${name}${i}`)
  return `${name}${i}`
}

function pyStr(s: string): string {
  return JSON.stringify(s)
}

function pyLiteral(v: unknown): string {
  if (v === null) return 'None'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return `[${v.map(pyLiteral).join(', ')}]`
  if (isObj(v)) {
    const inner = Object.entries(v)
      .map(([k, val]) => `${JSON.stringify(k)}: ${pyLiteral(val)}`)
      .join(', ')
    return `{${inner}}`
  }
  return 'None'
}

/* ================= 汇总 ================= */

export type SchemaTarget = 'json' | 'openai' | 'mcp' | 'typescript' | 'pydantic'

export const SCHEMA_TARGETS: SchemaTarget[] = ['json', 'openai', 'mcp', 'typescript', 'pydantic']

export function renderSchema(tools: NormalizedTool[], target: SchemaTarget, opts: { strict?: boolean } = {}): string {
  switch (target) {
    case 'json':
      return toJsonSchema(tools)
    case 'openai':
      return toOpenAiSpec(tools, opts)
    case 'mcp':
      return toMcpSpec(tools)
    case 'typescript':
      return schemaToTypeScript(tools)
    case 'pydantic':
      return schemaToPydantic(tools)
  }
}

/** 统计体检结果，便于界面显示摘要 */
export function summarizeIssues(issues: SchemaIssue[]): { errors: number; warns: number } {
  let errors = 0
  let warns = 0
  for (const i of issues) {
    if (i.level === 'error') errors++
    else warns++
  }
  return { errors, warns }
}

export { camel as toCamelCase, pascal as toPascalCase, safeIdent as toSafeIdentifier }
