/**
 * HTTP 客户端的响应视图：body / headers / cookies / timing / sent / snippets 六个页签。
 *
 * 从 src/tools/httpclient.tsx 拆出的展示组件——解码、JSON 路径过滤等派生
 * 都是响应数据的纯函数，状态（正文视图模式、JSON 路径输入）留在组件内。
 */
import { useMemo, useState } from 'react'
import { Btn, CopyBtn } from '../ui'
import { CodeSnippets } from './CodeSnippets'
import { buildWireRequest, docFromRequestSpec, generateCode } from '../../lib/http-codegen'
import { evalJsonPath } from '../../lib/toolkit'
import * as U from '../../lib/http-utils'
import type { HttpRequestResult, HttpRequestSpec } from '../../lib/http-types'
import type { L, RespTab, ViewMode } from '../../lib/httpclient-model'

export function ResponseTabs({
  respTab,
  setRespTab,
  view,
  setView,
  response,
  spec,
  onAddCookie,
  l,
}: {
  respTab: RespTab
  setRespTab: (t: RespTab) => void
  view: ViewMode
  setView: (v: ViewMode) => void
  response: HttpRequestResult
  spec: HttpRequestSpec | null
  onAddCookie: (value: string) => void
  l: L
}) {
  /** 代码片段按「实际发出去的请求」生成，便于与当前表单对照 */
  const sentDoc = useMemo(
    () => docFromRequestSpec(spec ?? { method: response.method, url: response.url }, response.url),
    [spec, response],
  )

  /** 实际发出的 wire 报文（请求行 + 头 + 正文） */
  const wire = useMemo(() => buildWireRequest(sentDoc), [sentDoc])

  const decoded = useMemo(() => U.decodeResponseBody(response), [response])

  /** JSON 路径过滤（$.a.b[0] 语法，复用 toolkit 的 evalJsonPath）；仅 JSON 响应可用 */
  const [jsonPath, setJsonPath] = useState('')
  const pathHits = useMemo<{ text: string; error: string | null }>(() => {
    if (!jsonPath.trim() || !decoded.pretty) return { text: '', error: null }
    try {
      const hits = evalJsonPath(JSON.parse(decoded.text), jsonPath)
      return { text: hits.map((h) => JSON.stringify(h, null, 2)).join('\n---\n'), error: null }
    } catch (err) {
      return { text: '', error: (err as Error).message }
    }
  }, [jsonPath, decoded])

  const tabs: { id: RespTab; label: string }[] = [
    { id: 'body', label: l.response.body },
    { id: 'headers', label: l.response.headers },
    { id: 'cookies', label: l.tabs.cookies },
    { id: 'timing', label: l.response.timing },
    { id: 'sent', label: l.response.requestSent },
    { id: 'snippets', label: l.code.responseTab },
  ]

  const bodyText =
    view === 'pretty' && decoded.pretty
      ? decoded.pretty
      : view === 'hex'
        ? U.hexDump(decoded.bytes)
        : decoded.text

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setRespTab(t.id)}
            className={`px-2 py-0.5 text-[11px] border transition-colors ${respTab === t.id ? 'border-phosphor/60 text-phosphor bg-phosphor-faint' : 'border-line-soft text-muted hover:text-phosphor'}`}
          >
            {t.label}
          </button>
        ))}
        {respTab === 'body' && (
          <span className="ml-auto flex gap-1">
            {(['pretty', 'raw', 'hex'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-0.5 text-[11px] border ${view === v ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted hover:text-phosphor'}`}
              >
                {l.response[v]}
              </button>
            ))}
          </span>
        )}
      </div>

      {respTab === 'body' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted">
            <span>{decoded.ct ?? l.response.noBody}</span>
            <span>{U.formatBytes(response.bodyBytes)}</span>
            <span>
              {l.response.encoding}: {decoded.charset}
            </span>
            {response.decompressed && (
              <span className="text-amber">
                {l.response.decompressed(response.contentEncoding)}
              </span>
            )}
            {response.truncated && <span className="text-danger">{l.response.truncated}</span>}
            <CopyBtn text={decoded.text} className="ml-auto" />
          </div>
          {decoded.pretty && (
            <div className="space-y-1">
              <input
                value={jsonPath}
                onChange={(e) => setJsonPath(e.target.value)}
                placeholder={l.response.jsonPathHint}
                spellCheck={false}
                className="w-full bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
              />
              {pathHits.error && (
                <div className="text-[11px] text-amber">
                  {l.response.jsonPathBad}: {pathHits.error}
                </div>
              )}
              {pathHits.text && (
                <pre className="codeblock max-h-[300px] overflow-auto bg-panel-2 border border-phosphor/30 px-3 py-2 text-[12px] text-bright">
                  {pathHits.text}
                </pre>
              )}
            </div>
          )}
          {decoded.bytes.length === 0 ? (
            <div className="text-[12px] text-muted">{l.response.noBody}</div>
          ) : (
            <pre className="codeblock max-h-[420px] overflow-auto bg-panel-2 border border-line-soft px-3 py-2 text-[12px] text-bright">
              {bodyText}
            </pre>
          )}
        </div>
      )}

      {respTab === 'headers' && (
        <div className="space-y-1">
          {response.headers.map(([k, v], i) => (
            <div
              key={`${k}-${i}`}
              className="flex gap-2 py-0.5 border-b border-line-soft last:border-0 text-[12px]"
            >
              <span className="shrink-0 w-48 text-phosphor break-all">{k}</span>
              <span className="text-bright break-all">{v}</span>
            </div>
          ))}
          {response.headers.length === 0 && <div className="text-[12px] text-muted">—</div>}
        </div>
      )}

      {respTab === 'cookies' && (
        <div className="space-y-2">
          {decoded.cookies.length === 0 && (
            <div className="text-[12px] text-muted">{l.response.cookieNone}</div>
          )}
          {decoded.cookies.length > 0 && (
            <Btn
              variant="ghost"
              onClick={() =>
                onAddCookie(decoded.cookies.map((c) => `${c.name}=${c.value}`).join('; '))
              }
            >
              {l.response.cookieToHeader(decoded.cookies.length)}
            </Btn>
          )}
          {decoded.cookies.map((c, i) => (
            <div key={i} className="border border-line-soft bg-panel-2 px-3 py-2 space-y-0.5">
              <div className="text-[12px]">
                <span className="text-phosphor">{c.name}</span>
                <span className="text-muted"> = </span>
                <span className="text-bright break-all">{c.value}</span>
              </div>
              {c.attrs.length > 0 && (
                <div className="text-[11px] text-muted">{c.attrs.join(' · ')}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {respTab === 'timing' && (
        <div className="space-y-2">
          <TimingBar
            label={l.response.connect}
            value={response.timings.connectMs}
            total={response.timings.totalMs}
          />
          {response.timings.tlsMs > 0 && (
            <TimingBar
              label={l.response.tls}
              value={response.timings.tlsMs}
              total={response.timings.totalMs}
            />
          )}
          <TimingBar
            label={l.response.ttfb}
            value={response.timings.ttfbMs}
            total={response.timings.totalMs}
          />
          <TimingBar
            label={l.response.total}
            value={response.timings.totalMs}
            total={response.timings.totalMs}
          />
          <div className="pt-1 space-y-0.5">
            {response.remoteAddress && (
              <InfoLine k={l.response.remote} v={response.remoteAddress} />
            )}
            {response.redirects.length > 0 && (
              <div className="text-[12px]">
                <span className="text-muted">{l.response.redirects}:</span>
                {response.redirects.map((r, i) => (
                  <div key={i} className="text-bright break-all pl-3">
                    {r.status} → {r.location}
                  </div>
                ))}
              </div>
            )}
          </div>
          {response.tls && (
            <div className="border border-line-soft bg-panel-2 px-3 py-2 space-y-1">
              <div
                className={`text-[12px] ${response.tls.authorized ? 'text-phosphor' : 'text-danger'}`}
              >
                {response.tls.authorized ? `✓ ${l.response.tlsOk}` : `✗ ${l.response.tlsBad}`}
              </div>
              <InfoLine k={l.response.protocol} v={response.tls.protocol} />
              <InfoLine k={l.response.cipher} v={response.tls.cipher} />
              <InfoLine k={l.response.issuer} v={response.tls.issuer} />
              <InfoLine k={l.response.validTo} v={response.tls.validTo} />
              {response.tls.authorizationError && (
                <InfoLine k={l.response.tlsBad} v={response.tls.authorizationError} />
              )}
            </div>
          )}
        </div>
      )}

      {respTab === 'sent' && (
        <div className="space-y-2">
          <div className="text-[12px] text-phosphor break-all">
            {spec?.method} {spec?.url ?? response.url}
          </div>
          <div className="space-y-0.5">
            {(spec?.headers ?? response.headers).map(([k, v], i) => (
              <div key={i} className="text-[12px] break-all">
                <span className="text-phosphor">{k}</span>
                <span className="text-muted">: </span>
                <span className="text-bright">{v}</span>
              </div>
            ))}
          </div>
          {spec?.bodyText && (
            <pre className="codeblock max-h-[240px] overflow-auto bg-panel-2 border border-line-soft px-3 py-2 text-[12px] text-bright">
              {spec.bodyText}
            </pre>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <CopyBtn text={generateCode('curl', sentDoc)} />
            <CopyBtn text={wire} label={l.response.copyWire} />
          </div>
          <div>
            <div className="text-[11px] text-muted mb-1">{l.response.wire}</div>
            <pre className="codeblock max-h-[240px] overflow-auto bg-panel-2 border border-line-soft px-3 py-2 text-[12px] text-bright">
              {wire}
            </pre>
          </div>
        </div>
      )}

      {respTab === 'snippets' && <CodeSnippets doc={sentDoc} l={l} />}
    </div>
  )
}

function TimingBar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.max(2, Math.round((value / total) * 100)) : 0
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11.5px]">
        <span className="text-muted">{label}</span>
        <span className="text-bright">
          {U.formatDuration(value)} <span className="text-muted">({pct}%)</span>
        </span>
      </div>
      <div className="h-1.5 bg-panel-2 border border-line-soft">
        <div className="h-full bg-phosphor/60" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function InfoLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-[12px]">
      <span className="shrink-0 text-muted">{k}:</span>
      <span className="text-bright break-all">{v}</span>
    </div>
  )
}
