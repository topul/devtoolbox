/**
 * OpenAPI / Swagger 规格解析与总览 —— 渲染进程与 MCP 服务端共用。
 *
 * 只收 JSON：YAML 需要额外依赖（js-yaml），而手工粘贴场景下 JSON 导出是主流，
 * 因此在错误信息里明确说明，而不是静默猜格式。3.x（servers/components）与
 * 2.0（host/basePath/schemes）形态差异大，这里在解析时把两边归一化成同一结构，
 * 之后的总览与端点列举就不用再分支。字段一律宽松取值：坏掉的 tag、缺 summary
 * 都不至于让整份 spec 解析失败。
 */

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

/** 归一化后的操作（2.0/3.x 的 operation 对象宽松取值后都归到这个形状） */
export interface OpenApiOperation {
  summary?: string
  operationId?: string
  tags: string[]
  /** path 级 + 操作级参数计数（2.0 的 body 参数也算在 parameters 里，一并计入） */
  paramsCount: number
  deprecated: boolean
}

/** 归一化后的 spec：2.0 与 3.x 都解析成这个形状 */
export interface OpenApiSpec {
  /** 规格版本号（openapi / swagger 字段原文，如 3.0.3 / 2.0） */
  version: string
  title: string
  /** info.version 声明的 API 版本，与上面的规格版本是两回事 */
  apiVersion: string
  baseUrl: string
  servers: string[]
  /** path → 小写 method → 操作 */
  paths: Record<string, Record<string, OpenApiOperation>>
}

export interface EndpointRow {
  method: string
  path: string
  summary?: string
  operationId?: string
  tags: string[]
  paramsCount: number
  deprecated: boolean
}

export interface OpenApiOverview {
  title: string
  version: string
  baseUrl: string
  servers: string[]
  pathCount: number
  opCount: number
  deprecatedCount: number
}

/** 只认「对象」：数组与 null 都不算 spec 的合法容器节点 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

export function parseOpenApiSpec(text: string): { spec: OpenApiSpec } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { error: `JSON 解析失败：${(e as Error).message}。不支持 YAML，请先把 spec 转成 JSON。` }
  }
  const root = asRecord(raw)
  if (!root) return { error: 'spec 根节点必须是 JSON 对象。' }

  const isV3 = typeof root.openapi === 'string'
  const isV2 = typeof root.swagger === 'string'
  if (!isV3 && !isV2) {
    return {
      error: '未找到 openapi（3.x）或 swagger（2.0）字段：不是有效的 OpenAPI/Swagger 规格。',
    }
  }
  const pathsRaw = asRecord(root.paths)
  if (!pathsRaw) return { error: 'spec 缺少 paths 定义。' }

  const paths: OpenApiSpec['paths'] = {}
  for (const [p, itemRaw] of Object.entries(pathsRaw)) {
    const item = asRecord(itemRaw)
    if (!item) continue
    // 3.x 允许 path 级 parameters 被该路径下所有操作共享；2.0 没有这一层
    const pathParams = Array.isArray(item.parameters) ? item.parameters.length : 0
    const ops: Record<string, OpenApiOperation> = {}
    for (const m of HTTP_METHODS) {
      const opRaw = asRecord(item[m])
      if (!opRaw) continue
      const opParams = Array.isArray(opRaw.parameters) ? opRaw.parameters.length : 0
      const tags = Array.isArray(opRaw.tags)
        ? opRaw.tags.filter((t): t is string => typeof t === 'string')
        : []
      ops[m] = {
        // 宽松取值：summary 缺失时退回 description，端点表不至于整行空白
        summary:
          typeof opRaw.summary === 'string'
            ? opRaw.summary
            : typeof opRaw.description === 'string'
              ? opRaw.description
              : undefined,
        operationId: typeof opRaw.operationId === 'string' ? opRaw.operationId : undefined,
        tags,
        paramsCount: pathParams + opParams,
        deprecated: opRaw.deprecated === true,
      }
    }
    if (Object.keys(ops).length > 0) paths[p] = ops
  }

  // 基地址：3.x 用 servers 列表；2.0 拼 schemes[0] + host + basePath
  const servers: string[] = []
  if (isV3) {
    for (const s of Array.isArray(root.servers) ? root.servers : []) {
      const rec = asRecord(s)
      if (rec && typeof rec.url === 'string' && rec.url) servers.push(rec.url)
    }
  } else {
    const host = typeof root.host === 'string' ? root.host : ''
    const basePath = typeof root.basePath === 'string' ? root.basePath : ''
    const schemes = Array.isArray(root.schemes) ? root.schemes : []
    const scheme = typeof schemes[0] === 'string' ? schemes[0] : 'https'
    if (host || basePath) servers.push(host ? `${scheme}://${host}${basePath}` : basePath)
  }

  const info = asRecord(root.info)
  return {
    spec: {
      version: isV3 ? (root.openapi as string) : (root.swagger as string),
      title: info && typeof info.title === 'string' ? info.title : '',
      apiVersion: info && typeof info.version === 'string' ? info.version : '',
      baseUrl: servers[0] ?? '',
      servers,
      paths,
    },
  }
}

/** 端点平铺：按 paths 原始顺序、每个 path 内按方法规范顺序展开 */
export function listEndpoints(spec: OpenApiSpec): EndpointRow[] {
  const rows: EndpointRow[] = []
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const m of HTTP_METHODS) {
      const op = ops[m]
      if (!op) continue
      rows.push({
        method: m.toUpperCase(),
        path,
        summary: op.summary,
        operationId: op.operationId,
        tags: op.tags,
        paramsCount: op.paramsCount,
        deprecated: op.deprecated,
      })
    }
  }
  return rows
}

export function openApiOverview(spec: OpenApiSpec): OpenApiOverview {
  let opCount = 0
  let deprecatedCount = 0
  for (const ops of Object.values(spec.paths)) {
    for (const op of Object.values(ops)) {
      opCount += 1
      if (op.deprecated) deprecatedCount += 1
    }
  }
  return {
    title: spec.title,
    version: spec.apiVersion,
    baseUrl: spec.baseUrl,
    servers: spec.servers,
    pathCount: Object.keys(spec.paths).length,
    opCount,
    deprecatedCount,
  }
}
