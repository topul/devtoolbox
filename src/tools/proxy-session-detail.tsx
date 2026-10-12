/**
 * 抓包工具的会话详情视图 —— 请求/响应两侧、pretty/raw/hex 三种视图、cURL 复制。
 * 重放不再内嵌简陋编辑器：通过「发送到」把会话交给 HTTP 客户端，
 * 在那里享有历史 / 环境变量 / 快照 / 代码生成；分析器同理直达，零复制粘贴。
 */
import { useState, useMemo } from 'react'
import { CopyBtn } from '../components/ui'
import { SendToMenu } from '../components/SendTo'
import { proxyL } from '../lib/locales/proxy'
import type { ProxySession } from '../lib/proxy-types'
import * as U from '../lib/http-utils'
import { sessionToHandoff, type HandoffPayload } from '../lib/handoff'

type L = (typeof proxyL)['zh']

export function SessionDetail({
  session,
  l,
  proxyPort,
  proxyRunning,
}: {
  session: ProxySession
  l: L
  proxyPort: number
  proxyRunning: boolean
}) {
  const [side, setSide] = useState<'req' | 'res'>('res')
  const [view, setView] = useState<'pretty' | 'raw' | 'hex'>('pretty')

  const shown = useMemo(() => {
    const b64 = side === 'req' ? session.reqBodyBase64 : session.resBodyBase64
    const bytes = U.b64ToBytes(b64)
    const headers = side === 'req' ? session.reqHeaders : session.resHeaders
    const ct = U.headerValueOf(headers, 'content-type')
    const text = U.bytesToText(bytes, U.detectCharset(ct))
    return { bytes, text, binary: U.isProbablyBinary(bytes), pretty: U.prettyJson(text), ct }
  }, [session, side])

  /** 交接载荷：整条会话（请求 + 响应）一次带给目标工具，目标各取所需 */
  const handoff = useMemo<HandoffPayload>(
    () =>
      sessionToHandoff(session, {
        // 代理在跑：重放仍经代理端口，新请求会作为新会话出现在列表里
        proxy: proxyRunning ? `http://127.0.0.1:${proxyPort}` : null,
      }),
    [session, proxyRunning, proxyPort],
  )

  const curl = useMemo(() => {
    const reqBytes = U.b64ToBytes(session.reqBodyBase64)
    return U.buildCurl({
      method: session.method,
      url: session.url,
      headers: session.reqHeaders.filter(
        ([k]) => !/^(proxy-|host|content-length|connection|accept-encoding)$/i.test(k),
      ),
      bodyText: U.isProbablyBinary(reqBytes) ? null : U.bytesToText(reqBytes),
      verifyTls: false,
    })
  }, [session])

  const headers = side === 'req' ? session.reqHeaders : session.resHeaders

  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-phosphor font-semibold">{session.method}</span>
        <span className={`${U.statusColorClass(session.status)} font-semibold`}>
          {session.status ?? '—'} {session.statusText}
        </span>
        <span className="text-muted">{U.formatDuration(session.durationMs)}</span>
        <span className="text-muted">{U.formatBytes(session.resBodyBytes)}</span>
        {session.tunneled && (
          <span className="text-muted border border-line-soft px-1">{l.sessions.tunneled}</span>
        )}
        {session.mocked && (
          <span className="text-amber border border-amber/40 px-1">{l.sessions.mocked}</span>
        )}
        {session.blocked && (
          <span className="text-danger border border-danger/40 px-1">{l.sessions.blocked}</span>
        )}
        {session.intercepted && (
          <span className="text-phosphor border border-phosphor/40 px-1">
            {l.sessions.intercepted}
          </span>
        )}
        {session.modified && (
          <span className="text-amber border border-amber/40 px-1">{l.sessions.modified}</span>
        )}
      </div>

      <div className="text-[11.5px] break-all text-bright">{session.url}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        <div>
          <span className="text-muted">{l.detail.host}: </span>
          <span className="text-bright">{session.host}</span>
        </div>
        <div>
          <span className="text-muted">{l.detail.clientIp}: </span>
          <span className="text-bright">{session.clientIp || '—'}</span>
        </div>
        <div>
          <span className="text-muted">{l.detail.startedAt}: </span>
          <span className="text-bright">{new Date(session.startedAt).toLocaleTimeString()}</span>
        </div>
        <div>
          <span className="text-muted">{l.detail.matchedRules}: </span>
          <span className="text-bright">{session.matchedRules.join(', ') || l.detail.none}</span>
        </div>
      </div>
      {session.note && (
        <div className="text-[11px] text-amber">
          {l.detail.note}: {session.note}
        </div>
      )}
      {session.error && (
        <div className="text-[11px] text-danger">
          {l.detail.error}: {session.error}
        </div>
      )}
      {session.tunneled && <div className="text-[11px] text-muted">{l.detail.tunnelNotice}</div>}

      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => setSide('req')}
          className={`px-2 py-0.5 text-[11px] border ${side === 'req' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}
        >
          {l.detail.request}
        </button>
        <button
          onClick={() => setSide('res')}
          className={`px-2 py-0.5 text-[11px] border ${side === 'res' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}
        >
          {l.detail.response}
        </button>
        <span className="flex gap-1 ml-auto">
          {(['pretty', 'raw', 'hex'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 py-0.5 text-[11px] border ${view === v ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}
            >
              {l.detail[v]}
            </button>
          ))}
        </span>
      </div>

      <div className="max-h-[160px] overflow-auto space-y-0.5">
        {headers.map(([k, v], i) => (
          <div key={`${k}-${i}`} className="text-[11px] break-all">
            <span className="text-phosphor">{k}</span>
            <span className="text-muted">: </span>
            <span className="text-bright">{v}</span>
          </div>
        ))}
        {headers.length === 0 && <div className="text-[11px] text-muted">—</div>}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted">{l.detail.body}</span>
        <span className="text-[11px] text-muted">{U.formatBytes(shown.bytes.length)}</span>
        <CopyBtn text={shown.text} className="ml-auto" />
      </div>
      {shown.bytes.length === 0 ? (
        <div className="text-[11px] text-muted">{l.detail.emptyBody}</div>
      ) : (
        <pre className="codeblock max-h-[220px] overflow-auto bg-panel border border-line-soft px-2 py-1.5 text-[11px] text-bright">
          {view === 'hex'
            ? U.hexDump(shown.bytes, 2048)
            : view === 'pretty' && shown.pretty
              ? shown.pretty
              : shown.text}
        </pre>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <SendToMenu payload={handoff} />
        <CopyBtn text={curl} />
        {handoff.reqBodyBinary && (
          <span className="text-[10.5px] text-amber">{l.detail.binarySkip}</span>
        )}
      </div>
    </div>
  )
}
