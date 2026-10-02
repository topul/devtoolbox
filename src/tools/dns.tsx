import React, { useState } from 'react'
import { Btn, CopyBtn, ErrorNote, Input, KV, Panel, Select, Stat } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { dnsL } from '../lib/locales/dns'
import { base64ToUtf8 } from '../lib/toolkit'
import {
  DNS_RECORD_TYPES,
  DOH_ENDPOINTS,
  dohQueryUrl,
  isValidDomain,
  parseDohResponse,
  type DnsRecordType,
  type DnsResult,
} from '../lib/toolkit'
import { SecNote } from './secnote'

/* DoH 查询：请求走 window.electronAPI.http.send（桌面端主进程内核，Web 端 fetch 兜底），
   响应解析走 src/lib/toolkit。smoke 环境没有 electronAPI，仅点击查询时才触碰。 */

const STATUS_CLS = {
  ok: 'text-phosphor',
  warn: 'text-amber',
  bad: 'text-danger',
} as const

export function DnsLookupTool() {
  const l = useLocalized(dnsL)
  const [domain, setDomain] = useState('')
  const [type, setType] = useState<DnsRecordType>('A')
  const [endpoint, setEndpoint] = useState(DOH_ENDPOINTS[0].id)
  const [result, setResult] = useState<DnsResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const query = async () => {
    setErr(null)
    setResult(null)
    const name = domain.trim()
    if (!isValidDomain(name)) {
      setErr(l.errBadDomain)
      return
    }
    const api = window.electronAPI?.http
    if (!api) {
      setErr(l.errNoApi)
      return
    }
    setBusy(true)
    try {
      const res = await api.send({
        method: 'GET',
        url: dohQueryUrl(endpoint, name, type),
        // RFC 8484 JSON 媒体类型：DoH 端点据此返回 application/dns-json
        headers: [['Accept', 'application/dns-json']],
      })
      if (!res.ok) {
        setErr(l.errFailed + (res.error ?? res.errorCode ?? ''))
        return
      }
      setResult(parseDohResponse(base64ToUtf8(res.bodyBase64)))
    } catch (e) {
      const msg = (e as Error).message
      setErr(msg === 'BAD_DOH_JSON' ? l.errBadResponse : l.errFailed + msg)
    } finally {
      setBusy(false)
    }
  }

  const statusCls = result ? (result.status === 0 ? STATUS_CLS.ok : result.status === 3 ? STATUS_CLS.warn : STATUS_CLS.bad) : STATUS_CLS.ok

  return (
    <div className="space-y-3">
      <SecNote scene="dns" />
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <Input value={domain} onChange={setDomain} label={l.domainLabel} placeholder={l.domainPh} />
        </div>
        <div className="w-32">
          <Select value={type} onChange={(v) => setType(v as DnsRecordType)} label={l.typeLabel}
            options={DNS_RECORD_TYPES.map((t) => ({ value: t, label: t }))} />
        </div>
        <div className="w-40">
          <Select value={endpoint} onChange={setEndpoint} label={l.endpointLabel}
            options={DOH_ENDPOINTS.map((e) => ({ value: e.id, label: e.id }))} />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={() => void query()} disabled={busy}>{l.query}</Btn>
        <Btn variant="ghost" onClick={() => { setDomain(''); setResult(null); setErr(null) }}>{l.clear}</Btn>
      </div>
      <ErrorNote msg={err} />

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label={l.statusTitle} value={<span className={`text-sm ${statusCls}`}>{result.statusText}</span>} />
            <Stat label={l.recordsTitle} value={<span className="text-sm">{result.records.length}</span>} />
            {result.question && <Stat label={l.colName} value={<span className="text-sm break-all">{result.question.name}</span>} />}
            {result.question && <Stat label={l.colType} value={<span className="text-sm">{result.question.type}</span>} />}
          </div>

          {result.truncated && (
            <div className="rounded-lg border border-amber/35 bg-amber/10 px-3 py-2 text-[12.5px] text-amber">{l.truncated}</div>
          )}

          <Panel title={l.recordsTitle}>
            {result.records.length === 0 ? (
              <p className="text-[12.5px] text-muted">{l.noRecords}</p>
            ) : (
              <div className="space-y-1">
                {result.records.map((r, i) => (
                  <div key={`${i}-${r.name}-${r.type}`} className="flex items-center justify-between gap-2 py-1 border-b border-line-soft last:border-0">
                    <div className="min-w-0 text-[12.5px]">
                      <span className="text-muted mr-2">{r.type}</span>
                      <span className="text-phosphor break-all">{r.data}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-muted">{r.ttl}{l.seconds}</span>
                      <CopyBtn text={r.data} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {result.authority.length > 0 && (
            <Panel title={l.authorityTitle}>
              <div className="space-y-1">
                {result.authority.map((r, i) => (
                  <div key={`${i}-${r.name}-${r.type}`} className="flex items-center justify-between gap-2 py-1 border-b border-line-soft last:border-0">
                    <div className="min-w-0 text-[12.5px]">
                      <span className="text-muted mr-2">{r.type}</span>
                      <span className="text-bright break-all">{r.data}</span>
                    </div>
                    <span className="text-[11px] text-muted shrink-0">{r.ttl}{l.seconds}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {result.comment && <KV k={l.comment} v={result.comment} />}
          <p className="text-[11px] text-muted">{l.note}</p>
        </>
      )}
    </div>
  )
}
