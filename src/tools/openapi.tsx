/**
 * OpenAPI/Swagger 预览器 —— 从聊天里收到的契约、网关导出的 spec，粘进来一眼看清
 * 有哪些端点、参数多少、哪些已废弃，不必专门起一个 Swagger UI。只支持 JSON
 * （解析器的取舍，错误信息里会说明）；3.x 与 2.0 的差异全部由 toolkit/openapi.ts
 * 在解析期吸收，本文件只做展示：总览统计 + 端点表，方法按 GET/POST/DELETE 着色。
 */
import React, { useMemo } from 'react'
import { Btn, ErrorNote, KV, Panel, Stat, TA, ToolShell, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { listEndpoints, openApiOverview, parseOpenApiSpec } from '../lib/toolkit/openapi'

const L = {
  zh: {
    spec: 'Spec JSON',
    specPh: '粘贴 openapi.json / swagger.json 的内容（仅 JSON，不支持 YAML）…',
    example: '示例',
    overview: '总览',
    apiTitle: '标题',
    apiVersion: 'API 版本',
    specVersion: '规格版本',
    baseUrl: 'Base URL',
    servers: 'Servers',
    paths: '路径',
    ops: '操作',
    deprecated: '已废弃',
    endpoints: '端点',
    noEndpoints: 'paths 里没有定义任何端点',
    params: '参数',
  },
  en: {
    spec: 'Spec JSON',
    specPh: 'Paste openapi.json / swagger.json content (JSON only, no YAML)…',
    example: 'Example',
    overview: 'Overview',
    apiTitle: 'Title',
    apiVersion: 'API version',
    specVersion: 'Spec version',
    baseUrl: 'Base URL',
    servers: 'Servers',
    paths: 'Paths',
    ops: 'Operations',
    deprecated: 'Deprecated',
    endpoints: 'Endpoints',
    noEndpoints: 'No endpoints defined in paths',
    params: 'params',
  },
}

/** 最小 OpenAPI 3.0 示例：点一次就能看到总览 + 端点表长什么样 */
const EXAMPLE_SPEC = JSON.stringify(
  {
    openapi: '3.0.3',
    info: { title: 'User Service API', version: '1.2.0' },
    servers: [{ url: 'https://api.example.com/v1' }],
    paths: {
      '/users': {
        get: {
          summary: 'List users',
          operationId: 'listUsers',
          tags: ['users'],
          parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
        },
        post: { summary: 'Create user', operationId: 'createUser', tags: ['users'] },
      },
      '/users/{id}': {
        get: {
          summary: 'Get user detail',
          operationId: 'getUser',
          tags: ['users'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
        delete: {
          summary: 'Delete user',
          operationId: 'deleteUser',
          tags: ['users'],
          deprecated: true,
        },
      },
    },
  },
  null,
  2,
)

/** 方法着色：一眼扫出危险动词；未知方法退回 muted */
const METHOD_CLS: Record<string, string> = {
  GET: 'text-phosphor',
  POST: 'text-bright',
  PUT: 'text-bright',
  PATCH: 'text-bright',
  DELETE: 'text-danger',
}

export function OpenApiTool() {
  const l = useLocalized(L)
  const [text, setText] = usePersistedState('openapi', 'spec', '')

  const parsed = useMemo(() => (text.trim() ? parseOpenApiSpec(text) : null), [text])
  const spec = parsed && 'spec' in parsed ? parsed.spec : null
  const error = parsed && 'error' in parsed ? parsed.error : null
  const overview = useMemo(() => (spec ? openApiOverview(spec) : null), [spec])
  const endpoints = useMemo(() => (spec ? listEndpoints(spec) : []), [spec])
  const specVersion = spec ? spec.version : ''

  return (
    <ToolShell toolId="openapi">
      <TA
        toolInput
        spellCheck
        value={text}
        onChange={setText}
        label={l.spec}
        placeholder={l.specPh}
        rows={10}
        labelRight={
          <Btn variant="ghost" onClick={() => setText(EXAMPLE_SPEC)}>
            {l.example}
          </Btn>
        }
      />

      {error && <ErrorNote msg={error} />}

      {overview && (
        <Panel title={l.overview}>
          <div className="mb-2 grid grid-cols-3 gap-2">
            <Stat label={l.paths} value={overview.pathCount} />
            <Stat label={l.ops} value={overview.opCount} />
            <Stat label={l.deprecated} value={overview.deprecatedCount} />
          </div>
          <KV k={l.apiTitle} v={overview.title || '—'} mono={false} />
          <KV k={l.apiVersion} v={overview.version || '—'} />
          <KV k={l.specVersion} v={specVersion} />
          <KV k={l.baseUrl} v={overview.baseUrl || '—'} />
          {overview.servers.length > 1 && <KV k={l.servers} v={overview.servers.join('  ·  ')} />}
        </Panel>
      )}

      {overview && (
        <Panel title={`${l.endpoints} · ${endpoints.length}`}>
          {endpoints.length === 0 ? (
            <p className="py-1 text-[12px] text-muted">{l.noEndpoints}</p>
          ) : (
            <div className="overflow-auto" style={{ maxHeight: 420 }}>
              <div className="space-y-0.5">
                {endpoints.map((e) => (
                  <div
                    key={`${e.method} ${e.path}`}
                    className="flex items-baseline gap-2 py-0.5 text-[12.5px]"
                  >
                    <span
                      className={`w-14 shrink-0 font-mono text-[11px] ${METHOD_CLS[e.method] ?? 'text-muted'}`}
                    >
                      {e.method}
                    </span>
                    <span
                      className={`shrink-0 break-all font-mono ${e.deprecated ? 'text-danger' : 'text-bright'}`}
                      title={e.operationId}
                    >
                      {e.deprecated ? '✗ ' : ''}
                      {e.path}
                    </span>
                    {e.summary && (
                      <span className="min-w-0 truncate text-[11.5px] text-muted">{e.summary}</span>
                    )}
                    {e.tags.length > 0 && (
                      <span className="shrink-0 text-[11px] text-muted/70">
                        {e.tags.join(', ')}
                      </span>
                    )}
                    {e.paramsCount > 0 && (
                      <span className="shrink-0 font-mono text-[11px] text-muted/70">
                        · {e.paramsCount} {l.params}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}
    </ToolShell>
  )
}
