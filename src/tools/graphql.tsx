import React, { useState, useCallback, useRef } from 'react'
import {
  Btn,
  TA,
  Input,
  ErrorNote,
  Panel,
  Collapse,
  KV,
  ResultPanel,
  usePersistedState,
  useAsyncAction,
  ToolGuide,
  Drawer,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { graphqlL } from '../lib/locales/graphql'
import {
  parseIntrospection,
  parseGqlResponse,
  buildGqlBody,
  guessOperationName,
  base64ToUtf8,
  INTROSPECTION_QUERY,
  type GqlSchema,
  type GqlResult,
  type GqlField,
} from '../lib/toolkit'

/**
 * GraphQL 调试器。
 *
 * 走 `http.send`（主进程请求引擎）而不是渲染层 fetch：渲染层有 CSP 与跨域限制，
 * 直连会被静默挡掉，而且绕过代理能力 —— 与 HTTP 客户端保持一致。
 *
 * 布局按「先拉 schema → 再写查询 → 看响应」这条主线排；
 * Schema 面板收进抽屉，因为它信息量大但不是每次都要看。
 */
export function GraphqlTool() {
  const l = useLocalized(graphqlL)
  const [endpoint, setEndpoint] = usePersistedState('graphql', 'endpoint', '')
  // 认证头按敏感处理：走 sessionStorage，关闭应用即清，不落localStorage
  const [headers, setHeaders] = usePersistedState('graphql', 'headers', '')
  const [query, setQuery] = usePersistedState('graphql', 'query', '')
  const [variables, setVariables] = usePersistedState('graphql', 'variables', '')
  const [opName, setOpName] = usePersistedState('graphql', 'operation', '')

  const [schema, setSchema] = useState<GqlSchema | null>(null)
  const [schemaErr, setSchemaErr] = useState<string | null>(null)
  const [result, setResult] = useState<GqlResult | null>(null)
  const [reqErr, setReqErr] = useState<string | null>(null)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const abortRef = useRef(false)

  const api = typeof window !== 'undefined' ? window.electronAPI?.http : undefined

  /** 把 `名称: 值` 每行一条的文本解析成有序头列表 */
  const parseHeaders = useCallback((): [string, string][] => {
    const out: [string, string][] = []
    for (const line of headers.split('\n')) {
      const t = line.trim()
      if (!t) continue
      const i = t.indexOf(':')
      if (i <= 0) continue
      out.push([t.slice(0, i).trim(), t.slice(i + 1).trim()])
    }
    return out
  }, [headers])

  const { busy: schemaBusy, run: runSchema } = useAsyncAction(async () => {
    setSchemaErr(null)
    if (!api) {
      setSchemaErr(l.desktopOnly)
      return
    }
    let body: string
    try {
      body = JSON.stringify({ query: INTROSPECTION_QUERY })
    } catch (e) {
      setSchemaErr((e as Error).message)
      return
    }
    const res = await api.send({
      method: 'POST',
      url: endpoint.trim(),
      headers: [
        ['Content-Type', 'application/json'],
        ['Accept', 'application/json'],
        ...parseHeaders(),
      ],
      bodyText: body,
    })
    if (!res.ok) {
      setSchemaErr(l.schemaFailed.replace('{msg}', res.error ?? res.errorCode ?? ''))
      return
    }
    try {
      const parsed = parseIntrospection(JSON.parse(base64ToUtf8(res.bodyBase64)))
      setSchema(parsed)
      // 顺带填操作名：多 operation 时不填会被服务端拒，而用户往往不知道
      if (!opName.trim()) setOpName(guessOperationName(query))
    } catch (e) {
      const msg = (e as Error).message
      // BAD_INTROSPECTION 常见于服务端禁用了 introspection，要说清楚而不是干瞪眼
      setSchemaErr(
        msg === 'BAD_INTROSPECTION'
          ? l.schemaFailed.replace('{msg}', 'introspection unavailable')
          : l.schemaFailed.replace('{msg}', msg),
      )
    }
  })

  const { busy: sending, run: runQuery } = useAsyncAction(async () => {
    setReqErr(null)
    setResult(null)
    if (!api) {
      setReqErr(l.desktopOnly)
      return
    }
    abortRef.current = false

    let body: string
    try {
      body = buildGqlBody(query, variables, opName)
    } catch (e) {
      setReqErr((e as Error).message)
      return
    }
    const started = Date.now()
    try {
      const res = await api.send({
        method: 'POST',
        url: endpoint.trim(),
        headers: [
          ['Content-Type', 'application/json'],
          ['Accept', 'application/json'],
          ...parseHeaders(),
        ],
        bodyText: body,
        timeoutMs: 30000,
      })
      if (abortRef.current) return
      if (!res.ok) {
        // 网络层失败：res.error 有值但没有响应体
        setReqErr(l.schemaFailed.replace('{msg}', res.error ?? res.errorCode ?? ''))
        return
      }
      setResult(parseGqlResponse(base64ToUtf8(res.bodyBase64), res.status, Date.now() - started))
    } catch (e) {
      if (abortRef.current) return
      setReqErr((e as Error).message)
    }
  })

  return (
    <div className="space-y-3">
      <ToolGuide title={l.title} steps={[l.sub, l.fetchSchema, l.send]} note={l.desktopNote} />

      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3 items-end">
        <Input
          value={endpoint}
          onChange={setEndpoint}
          label={l.endpoint}
          placeholder={l.endpointPh}
          toolInput
        />
        <div className="flex gap-2">
          <Btn
            variant="primary"
            onClick={() => void runSchema()}
            disabled={schemaBusy || !endpoint.trim()}
            aria-busy={schemaBusy}
          >
            {schemaBusy ? l.fetching : l.fetchSchema}
          </Btn>
          <Btn onClick={() => setSchemaOpen(true)} disabled={!schema}>
            {l.schemaTitle}
          </Btn>
        </div>
      </div>

      <Panel title={l.headers}>
        <TA
          value={headers}
          onChange={setHeaders}
          rows={3}
          placeholder={'Authorization: Bearer <token>'}
        />
        <p className="text-[11px] text-muted mt-1">{l.headersHint}</p>
      </Panel>

      {schemaBusy && (
        <p className="text-[12px] text-muted" role="status">
          {l.fetching}
        </p>
      )}
      {schemaErr && <ErrorNote msg={schemaErr} />}
      {schema && !schemaErr && (
        <p className="text-[12px] text-phosphor">
          {l.schemaReady.replace('{n}', String(schema.types.length))}
        </p>
      )}

      <Panel title={l.query}>
        <div className="space-y-2">
          <TA value={query} onChange={setQuery} rows={8} placeholder={l.queryPh} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TA value={variables} onChange={setVariables} rows={5} placeholder={l.variablesPh} />
            <Input
              value={opName}
              onChange={setOpName}
              label={l.operationName}
              placeholder={guessOperationName(query) || 'GetUser'}
            />
          </div>
          <p className="text-[11px] text-muted">{l.operationHint}</p>
          <div className="flex gap-2">
            <Btn
              variant="primary"
              onClick={() => void runQuery()}
              disabled={sending || !endpoint.trim() || !query.trim()}
              aria-busy={sending}
            >
              {sending ? l.sending : l.send}
            </Btn>
            {sending && (
              <Btn
                onClick={() => {
                  // 取消只能置标志：send 本身没有中止句柄，
                  // 但至少 UI 立刻收场，不会一直停在「发送中」
                  abortRef.current = true
                }}
              >
                {l.cancel}
              </Btn>
            )}
          </div>
        </div>
      </Panel>

      <ErrorNote msg={reqErr} />

      {!result && !reqErr && (
        <Panel title={l.response}>
          <p className="text-[12px] text-muted">{l.noResponseHint}</p>
        </Panel>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-[12px]">
            <span className={result.status === 200 ? 'text-phosphor' : 'text-danger'}>
              {l.httpStatus.replace('{code}', String(result.status))}
            </span>
            <span className="text-muted">
              {l.elapsed.replace('{ms}', String(result.elapsedMs))}
            </span>
          </div>

          {result.errors.length > 0 && (
            <Panel title={`${l.errors} (${result.errors.length})`}>
              <div className="space-y-2">
                {result.errors.map((e, i) => (
                  <div key={i} className="border-l-2 border-danger pl-2">
                    <div className="text-[12.5px] text-danger break-all">{e.message}</div>
                    {(e.path || e.code || e.locations) && (
                      <div className="text-[11px] text-muted mt-0.5">
                        {e.path && (
                          <>
                            {l.errPath}: {e.path}
                          </>
                        )}
                        {e.code && (
                          <>
                            {' '}
                            · {l.errCode}: {e.code}
                          </>
                        )}
                        {e.locations && (
                          <>
                            {' '}
                            · {l.errLocation}: {e.locations}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {result.data && <ResultPanel title={l.data} text={result.data} maxHeight={420} />}

          {/* 原始体收在折叠里：出错时它往往才是关键信息（网关HTML、字段级 detail） */}
          <Collapse title={l.rawResponse}>
            <pre className="codeblock text-[11.5px] whitespace-pre-wrap break-all">
              {result.raw}
            </pre>
          </Collapse>
        </div>
      )}

      {schemaOpen && schema && (
        <Drawer title={l.schemaTitle} onClose={() => setSchemaOpen(false)}>
          <SchemaView
            schema={schema}
            onInsert={(f) => {
              setQuery((q) => (q ? `${q}\n  ${f.name}` : `{ ${f.name} }`))
              setSchemaOpen(false)
            }}
            l={l}
          />
        </Drawer>
      )}
    </div>
  )
}

type L = (typeof graphqlL)['zh']

/** Schema 浏览：Query/Mutation 字段 + 类型列表 */
function SchemaView({
  schema,
  onInsert,
  l,
}: {
  schema: GqlSchema
  onInsert: (f: GqlField) => void
  l: L
}) {
  const [tab, setTab] = useState<'query' | 'mutation' | 'types'>('query')
  const fields =
    tab === 'query' ? schema.queryFields : tab === 'mutation' ? schema.mutationFields : []
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['query', 'mutation', 'types'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-2 py-1 text-[11.5px] border transition-colors ${
              tab === k
                ? 'border-phosphor text-phosphor'
                : 'border-line-soft text-muted hover:text-bright'
            }`}
          >
            {k === 'query'
              ? l.queryFields
              : k === 'mutation'
                ? l.mutationFields
                : `${l.types} (${schema.types.length})`}
          </button>
        ))}
      </div>

      {tab === 'types' ? (
        <div className="space-y-2">
          {schema.types.map((t) => (
            <Panel key={t.name} title={`${t.name}${t.desc ? ` — ${t.desc}` : ''}`}>
              {t.enumValues.length > 0 ? (
                <div className="text-[12px] text-muted">
                  {l.enumValues}: {t.enumValues.join(' · ')}
                </div>
              ) : t.fields.length > 0 ? (
                <FieldList fields={t.fields} l={l} />
              ) : (
                <span className="text-[12px] text-muted">{l.noFields}</span>
              )}
            </Panel>
          ))}
        </div>
      ) : fields.length === 0 ? (
        <p className="text-[12px] text-muted">{l.noFields}</p>
      ) : (
        <div className="space-y-1.5">
          {fields.map((f) => (
            <div key={f.name} className="border border-line-soft bg-panel-2 px-2.5 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] text-phosphor break-all">
                  {f.name}
                  <span className="text-muted">: {f.type}</span>
                </span>
                <button
                  onClick={() => onInsert(f)}
                  className="text-[11px] text-muted hover:text-phosphor shrink-0"
                >
                  {l.insertField}
                </button>
              </div>
              {f.desc && <div className="text-[11.5px] text-muted mt-0.5">{f.desc}</div>}
              {f.args.length > 0 && (
                <div className="text-[11px] text-muted mt-1">
                  {l.args}: {f.args.map((a) => `${a.name}: ${a.type}`).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FieldList({ fields, l }: { fields: GqlField[]; l: L }) {
  return (
    <div className="space-y-0.5">
      {fields.map((f) => (
        <KV key={f.name} k={f.name} v={<span className="text-phosphor">{f.type}</span>} />
      ))}
      {fields.length === 0 && <span className="text-[12px] text-muted">{l.noFields}</span>}
    </div>
  )
}
