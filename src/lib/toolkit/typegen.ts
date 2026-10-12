/**
 * JSON → 静态类型生成器：TypeScript interface / Go struct / Rust serde struct / Python dataclass。
 *
 * 两段式：
 *   1. infer：JSON 值递归推断成类型树；数组元素做类型合并（字段缺失 → optional），
 *      对象按字段名分配 PascalCase 类型名并登记到上下文。
 *   2. render：从根对象出发收集依赖，按「被依赖者在前」的顺序渲染各目标语言。
 *
 * 刻意的简化（输出可用 > 理论完备）：
 *   - Rust/Python 遇到不含 null 的异构联合，退化为 serde_json::Value / Any 而不是生成枚举；
 *   - 整数一律按 i64/int，不处理 i64 溢出；
 *   - 不做循环引用（JSON 本身就是树）。
 */

export type TargetLang = 'typescript' | 'go' | 'rust' | 'python'

export interface TypeGenResult {
  ok: boolean
  code?: string
  error?: string
}

/* ================= 类型树 ================= */

interface ObjectType {
  kind: 'object'
  name: string
  fields: Field[]
}

interface Field {
  name: string
  type: InferredType
  optional: boolean
}

type InferredType =
  | { kind: 'any' }
  | { kind: 'null' }
  | { kind: 'boolean' }
  | { kind: 'integer' }
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'array'; items: InferredType }
  | ({ kind: 'union'; members: InferredType[] } & {})
  | ObjectType

/* ================= 推断 ================= */

interface InferCtx {
  objects: ObjectType[]
  /** name → 结构签名，同名不同构时改名为 父名+字段名 */
  used: Map<string, string>
}

function inferValue(value: unknown, proposedName: string | null, ctx: InferCtx): InferredType {
  if (value === null) return { kind: 'null' }
  const t = typeof value
  if (t === 'string') return { kind: 'string' }
  if (t === 'boolean') return { kind: 'boolean' }
  if (t === 'number') return Number.isInteger(value) ? { kind: 'integer' } : { kind: 'number' }
  if (Array.isArray(value)) {
    let items: InferredType = { kind: 'any' }
    for (const item of value) items = mergeTypes(items, inferValue(item, proposedName, ctx))
    return { kind: 'array', items }
  }
  if (t === 'object') return inferObject(value as Record<string, unknown>, proposedName, ctx)
  return { kind: 'any' }
}

function inferObject(
  value: Record<string, unknown>,
  proposedName: string | null,
  ctx: InferCtx,
): ObjectType {
  // 先把字段全部推完，再 claimName：签名要基于真实字段形状，
  // 否则空对象签名都是 ''，同名不同构会被误判成复用
  const fields: Field[] = Object.entries(value).map(([key, v]) => ({
    name: key,
    type: inferValue(v, nameFromField(key), ctx),
    optional: false,
  }))
  const obj: ObjectType = { kind: 'object', name: '', fields }
  obj.name = claimName(proposedName ?? 'Root', obj, ctx)
  ctx.objects.push(obj)
  return obj
}

/**
 * 合并两个类型（数组元素、数组成员为对象时产生）。
 * 对象合并：同名字段取并集，只在一侧出现的字段变 optional。
 */
function mergeTypes(a: InferredType, b: InferredType): InferredType {
  if (a.kind === 'any') return b
  if (b.kind === 'any') return a
  if (a.kind === 'integer' && b.kind === 'number') return { kind: 'number' }
  if (a.kind === 'number' && b.kind === 'integer') return { kind: 'number' }
  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', items: mergeTypes(a.items, b.items) }
  }
  if (a.kind === 'object' && b.kind === 'object') return mergeObjects(a, b)
  if (a.kind === 'union') return mergeIntoUnion(a, b)
  if (b.kind === 'union') return mergeIntoUnion(b, a)
  if (sameScalar(a, b)) return a
  return makeUnion([a, b])
}

function mergeObjects(a: ObjectType, b: ObjectType): ObjectType {
  const out: ObjectType = { kind: 'object', name: a.name, fields: [] }
  const bByName = new Map(b.fields.map((f) => [f.name, f]))
  const aNames = new Set(a.fields.map((f) => f.name))
  for (const fa of a.fields) {
    const fb = bByName.get(fa.name)
    out.fields.push(
      fb
        ? {
            name: fa.name,
            type: mergeTypes(fa.type, fb.type),
            optional: fa.optional || fb.optional,
          }
        : { name: fa.name, type: fa.type, optional: true },
    )
  }
  for (const fb of b.fields) {
    if (!aNames.has(fb.name)) out.fields.push({ name: fb.name, type: fb.type, optional: true })
  }
  return out
}

function mergeIntoUnion(u: { members: InferredType[] }, other: InferredType): InferredType {
  const members = [...u.members]
  for (let i = 0; i < members.length; i++) {
    const m = members[i]
    // 同标量/对象则吸收，避免联合里堆满重复项
    if (
      (m.kind !== 'object' && other.kind !== 'object' && sameScalar(m, other)) ||
      (m.kind === 'integer' && other.kind === 'number') ||
      (m.kind === 'number' && other.kind === 'integer')
    ) {
      members[i] = mergeTypes(m, other)
      return makeUnion(members)
    }
  }
  members.push(other)
  return makeUnion(members)
}

function makeUnion(members: InferredType[]): InferredType {
  if (members.length === 1) return members[0]
  return { kind: 'union', members }
}

function sameScalar(a: InferredType, b: InferredType): boolean {
  return a.kind === b.kind && a.kind !== 'array' && a.kind !== 'object' && a.kind !== 'union'
}

/* ================= 命名 ================= */

/** 字段名 → PascalCase 类型名提议（user_name → UserName；items → Item） */
function nameFromField(field: string): string {
  let parts = field.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (parts.length === 0) parts = [field]
  let name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  if (!/^[A-Za-z]/.test(name)) name = `T${name}`
  // 常见复数容器：字段名是 items/tags/users，元素类型名单数化
  if (/s$/.test(name) && !/ss$/.test(name)) name = name.slice(0, -1)
  return name || 'T'
}

function claimName(want: string, obj: ObjectType, ctx: InferCtx): string {
  const sig = signature(obj)
  const existing = ctx.used.get(want)
  if (existing === undefined) {
    ctx.used.set(want, sig)
    return want
  }
  if (existing === sig) return want
  let i = 2
  while (ctx.used.has(`${want}${i}`)) i++
  const name = `${want}${i}`
  ctx.used.set(name, sig)
  return name
}

/** 对象结构签名（字段名 + 类型形状），同名同构即复用 */
function signature(t: InferredType): string {
  switch (t.kind) {
    case 'object':
      return `{${t.fields.map((f) => `${f.name}:${signature(f.type)}`).join(',')}}`
    case 'array':
      return `[${signature(t.items)}]`
    case 'union':
      return `<${t.members.map(signature).join('|')}>`
    default:
      return t.kind
  }
}

/* ================= 依赖收集 ================= */

function collectObjects(root: InferredType): ObjectType[] {
  const ordered: ObjectType[] = []
  const seen = new Set<string>()
  const visit = (t: InferredType): void => {
    if (t.kind === 'array') return visit(t.items)
    if (t.kind === 'union') {
      t.members.forEach(visit)
      return
    }
    if (t.kind !== 'object') return
    if (seen.has(t.name)) return
    seen.add(t.name)
    t.fields.forEach((f) => visit(f.type))
    ordered.push(t)
  }
  visit(root)
  return ordered
}

/* ================= 入口 ================= */

export function generateTypes(input: string, lang: TargetLang, rootName = 'Root'): TypeGenResult {
  let data: unknown
  try {
    data = JSON.parse(input)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const ctx: InferCtx = { objects: [], used: new Map() }
  const root = inferValue(data, /^[A-Za-z]\w*$/.test(rootName) ? rootName : 'Root', ctx)
  const objects = collectObjects(root)
  if (objects.length === 0) {
    // 根不是对象：包一个只有 value 的结构意义不大，直接输出类型别名/定义
    return { ok: true, code: renderScalarRoot(root, lang) }
  }
  const code =
    lang === 'typescript'
      ? renderTypeScript(objects)
      : lang === 'go'
        ? renderGo(objects)
        : lang === 'rust'
          ? renderRust(objects)
          : renderPython(objects)
  return { ok: true, code }
}

/* ================= TypeScript ================= */

function renderTypeScript(objects: ObjectType[]): string {
  return objects
    .map((o) => {
      const body = o.fields
        .map((f) => `  ${safeField(f.name)}${f.optional ? '?' : ''}: ${tsType(f.type)}`)
        .join('\n')
      return `export interface ${o.name} {\n${body}\n}`
    })
    .join('\n\n')
}

function tsType(t: InferredType): string {
  switch (t.kind) {
    case 'any':
      return 'unknown'
    case 'null':
      return 'null'
    case 'boolean':
      return 'boolean'
    case 'integer':
    case 'number':
      return 'number'
    case 'string':
      return 'string'
    case 'array': {
      const inner = tsType(t.items)
      return `${t.items.kind === 'union' ? `(${inner})` : inner}[]`
    }
    case 'union':
      return t.members.map(tsType).join(' | ')
    case 'object':
      return t.name
  }
}

/* ================= Go ================= */

function renderGo(objects: ObjectType[]): string {
  const blocks = objects
    .map((o) => {
      const body = o.fields
        .map((f) => {
          const prefix = f.optional && needsGoPointer(f.type) ? '*' : ''
          const tag = f.optional ? ',omitempty' : ''
          return `\t${goFieldName(f.name)} ${prefix}${goType(f.type)} \`json:"${f.name}${tag}"\``
        })
        .join('\n')
      return `type ${o.name} struct {\n${body}\n}`
    })
    .join('\n\n')
  return `package main\n\n${blocks}`
}

/** optional 的引用类型（slice/map/接口）零值即 nil，不必再上指针 */
function needsGoPointer(t: InferredType): boolean {
  return t.kind !== 'array' && t.kind !== 'any' && !(t.kind === 'union' && goUnionIsInterface(t))
}

function goType(t: InferredType): string {
  switch (t.kind) {
    case 'any':
      return 'interface{}'
    case 'null':
      return 'interface{}'
    case 'boolean':
      return 'bool'
    case 'integer':
      return 'int64'
    case 'number':
      return 'float64'
    case 'string':
      return 'string'
    case 'array':
      return `[]${goType(t.items)}`
    case 'union':
      return goUnion(t)
    case 'object':
      return t.name
  }
}

/** null + 单一类型 → 该类型的指针；null + 对象 → *Name；其余异构联合 → interface{} */
function goUnion(u: { members: InferredType[] }): string {
  const nonNull = u.members.filter((m) => m.kind !== 'null')
  if (nonNull.length === 1) {
    const t = nonNull[0]
    return t.kind === 'object' ? `*${t.name}` : `*${goType(t)}`
  }
  return 'interface{}'
}

function goUnionIsInterface(u: { members: InferredType[] }): boolean {
  return goUnion(u) === 'interface{}'
}

function goFieldName(name: string): string {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  let out = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  if (!/^[A-Za-z]/.test(out)) out = `X${out}`
  return out || 'X'
}

/* ================= Rust ================= */

function renderRust(objects: ObjectType[]): string {
  const blocks = objects
    .map((o) => {
      const body = o.fields
        .map((f) => {
          const attr = f.optional ? '#[serde(skip_serializing_if = "Option::is_none")]\n    ' : ''
          return `    ${attr}pub ${safeField(f.name)}: ${rustType(f.type, f.optional)},`
        })
        .join('\n')
      return `#[derive(Debug, Clone, Serialize)]\npub struct ${o.name} {\n${body}\n}`
    })
    .join('\n\n')
  return `use serde::Serialize;\n\n${blocks}`
}

function rustType(t: InferredType, optional: boolean): string {
  const base = rustBase(t)
  return optional ? `Option<${base}>` : base
}

function rustBase(t: InferredType): string {
  switch (t.kind) {
    case 'any':
      return 'serde_json::Value'
    case 'null':
      return 'serde_json::Value'
    case 'boolean':
      return 'bool'
    case 'integer':
      return 'i64'
    case 'number':
      return 'f64'
    case 'string':
      return 'String'
    case 'array':
      return `Vec<${rustBase(t.items)}>`
    case 'union':
      return rustUnion(t)
    case 'object':
      return t.name
  }
}

/** null + 单一类型 → Option<T>；其余异构联合退化为 serde_json::Value */
function rustUnion(u: { members: InferredType[] }): string {
  const nonNull = u.members.filter((m) => m.kind !== 'null')
  if (u.members.length - nonNull.length === 1) {
    if (nonNull.length === 1) return `Option<${rustBase(nonNull[0])}>`
  }
  return 'serde_json::Value'
}

/* ================= Python ================= */

function renderPython(objects: ObjectType[]): string {
  const needsTyping = new Set<string>()
  for (const o of objects) {
    for (const f of o.fields) collectPyImports(f.type, f.optional, needsTyping)
  }
  const imports = [...needsTyping].sort()
  const head = imports.length ? `from typing import ${imports.join(', ')}\n\n` : ''
  const blocks = objects
    .map((o) => {
      // dataclass 要求无默认值字段在前：稳定地拆成必填/可选两段
      const required = o.fields.filter((f) => !f.optional)
      const optional = o.fields.filter((f) => f.optional)
      const lines = [...required, ...optional].map(
        (f) =>
          `    ${safeField(f.name)}: ${pyType(f.type, f.optional)}${f.optional ? ' = None' : ''}`,
      )
      return `@dataclass\nclass ${o.name}:\n${lines.join('\n') || '    pass'}`
    })
    .join('\n\n\n')
  return `${head}${blocks}`
}

function pyType(t: InferredType, optional: boolean): string {
  const base = pyBase(t)
  return optional ? `Optional[${base}]` : base
}

function pyBase(t: InferredType): string {
  switch (t.kind) {
    case 'any':
      return 'Any'
    case 'null':
      return 'None'
    case 'boolean':
      return 'bool'
    case 'integer':
      return 'int'
    case 'number':
      return 'float'
    case 'string':
      return 'str'
    case 'array':
      return `list[${pyBase(t.items)}]`
    case 'union':
      return pyUnion(t)
    case 'object':
      return t.name
  }
}

/** null + T → Optional[T]；其余 → Union[...]（None 也列入） */
function pyUnion(u: { members: InferredType[] }): string {
  const parts = u.members.map(pyBase)
  const nonNull = parts.filter((p) => p !== 'None')
  if (parts.length - nonNull.length === 1 && nonNull.length === 1) return `Optional[${nonNull[0]}]`
  return `Union[${parts.join(', ')}]`
}

function collectPyImports(t: InferredType, optional: boolean, acc: Set<string>): void {
  if (optional) acc.add('Optional')
  switch (t.kind) {
    case 'any':
      acc.add('Any')
      break
    case 'array':
      collectPyImports(t.items, false, acc)
      break
    case 'union': {
      const nonNull = t.members.filter((m) => m.kind !== 'null')
      const hasNull = nonNull.length < t.members.length
      if (hasNull) acc.add('Optional')
      if (!(hasNull && nonNull.length === 1)) acc.add('Union')
      t.members.forEach((m) => collectPyImports(m, false, acc))
      break
    }
    default:
      break
  }
}

/* ================= 共享小工具 ================= */

/** 字段名不是合法标识符时加引号（TS 容忍度高，主要防 "x-y" 这种） */
function safeField(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
}

function renderScalarRoot(root: InferredType, lang: TargetLang): string {
  if (lang === 'typescript') return `type Root = ${tsType(root)}`
  if (lang === 'go') return `package main\n\n// Root ${goType(root)}`
  if (lang === 'rust') return `use serde::Serialize;\n\n// Root: ${rustBase(root)}`
  const acc = new Set<string>()
  collectPyImports(root, false, acc)
  const head = acc.size ? `from typing import ${[...acc].sort().join(', ')}\n\n` : ''
  return `${head}Root: ${pyBase(root)}`
}
