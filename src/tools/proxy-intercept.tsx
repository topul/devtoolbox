/**
 * 抓包工具的断点拦截卡片 —— 命中断点规则时请求被挂起，等用户改完放行。
 * 从 src/tools/proxy.tsx 拆出：编辑状态（method/url/headers/body/mock）留在本组件，
 * 放行/丢弃的决策通过 onResolve 交回主文件，再转发给主进程。
 */
import { useState } from 'react'
import { Panel, Btn, TA } from '../components/ui'
import { proxyL } from '../lib/locales/proxy'
import type { InterceptRequest } from '../lib/proxy-types'
import * as U from '../lib/http-utils'
import { headersToText, textToHeaders, type InterceptDecisionInput } from '../lib/proxy-view'

type L = (typeof proxyL)['zh']

export function InterceptCard({
  request,
  l,
  onResolve,
}: {
  request: InterceptRequest
  l: L
  onResolve: (decision: InterceptDecisionInput) => void
}) {
  const [method, setMethod] = useState(request.method)
  const [url, setUrl] = useState(request.url)
  const [headers, setHeaders] = useState(headersToText(request.headers))
  const [body, setBody] = useState(() => {
    const bytes = U.b64ToBytes(request.bodyBase64)
    return U.isProbablyBinary(bytes) ? '' : U.bytesToText(bytes)
  })
  const [mockOn, setMockOn] = useState(false)
  const [mockStatus, setMockStatus] = useState('200')
  const [mockBody, setMockBody] = useState('{"mocked":true}')

  return (
    <Panel
      title={`⚠ ${l.intercept.title} · ${request.ruleName}`}
      right={<span className="text-[11px] text-amber">{l.intercept.badge}</span>}
    >
      <div className="space-y-2">
        <div className="text-[11.5px] text-amber">{l.intercept.notice}</div>
        <div className="flex gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-phosphor"
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright"
          />
        </div>
        <div className="grid lg:grid-cols-2 gap-3">
          <TA label={l.intercept.headers} rows={8} value={headers} onChange={setHeaders} />
          <TA label={l.intercept.body} rows={8} value={body} onChange={setBody} />
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-bright cursor-pointer">
          <input
            type="checkbox"
            checked={mockOn}
            onChange={(e) => setMockOn(e.target.checked)}
            className="accent-[color:var(--c-phosphor)]"
          />
          {l.intercept.mock}
        </label>
        {mockOn && (
          <div className="flex gap-2">
            <input
              value={mockStatus}
              onChange={(e) => setMockStatus(e.target.value)}
              className="w-20 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright"
            />
            <input
              value={mockBody}
              onChange={(e) => setMockBody(e.target.value)}
              className="flex-1 min-w-0 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright"
            />
          </div>
        )}
        <div className="flex gap-2">
          <Btn
            variant="primary"
            onClick={() =>
              onResolve({
                id: request.id,
                action: 'forward',
                method,
                url,
                headers: textToHeaders(headers),
                bodyBase64: U.textToB64(body),
                mock: mockOn
                  ? {
                      status: Number(mockStatus) || 200,
                      headers: [['content-type', 'application/json']],
                      bodyText: mockBody,
                    }
                  : null,
              })
            }
          >
            {l.intercept.forward}
          </Btn>
          <Btn variant="danger" onClick={() => onResolve({ id: request.id, action: 'drop' })}>
            {l.intercept.drop}
          </Btn>
        </div>
      </div>
    </Panel>
  )
}
