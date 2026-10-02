import React, { useState } from 'react'
import { Btn, ErrorNote, Input, KV, Panel, Stat } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { auditL } from '../lib/locales/audit'
import { auditSecurityHeaders, type AuditResult, type FindingLevel } from '../lib/toolkit'
import { SecNote } from './secnote'

/* 抓取走 window.electronAPI.http.send（桌面端主进程内核，Web 端 fetch 兜底）；
   审计规则在 src/lib/toolkit。smoke 环境没有 electronAPI，仅点击抓取时才触碰。 */

const LEVEL_CLS: Record<FindingLevel, string> = {
  ok: 'text-phosphor border-phosphor/30',
  warn: 'text-amber border-amber/30',
  missing: 'text-amber border-amber/30',
  bad: 'text-danger border-danger/30',
}

const LEVEL_KEY: Record<FindingLevel, 'levelOk' | 'levelWarn' | 'levelMissing' | 'levelBad'> = {
  ok: 'levelOk',
  warn: 'levelWarn',
  missing: 'levelMissing',
  bad: 'levelBad',
}

export function HeaderAuditTool() {
  const l = useLocalized(auditL)
  const [url, setUrl] = useState('')
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [rawHeaders, setRawHeaders] = useState<[string, string][]>([])
  const [status, setStatus] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setErr(null)
    setAudit(null)
    setRawHeaders([])
    const target = url.trim()
    if (!/^https?:\/\/\S+$/i.test(target)) {
      setErr(l.errBadUrl)
      return
    }
    const api = window.electronAPI?.http
    if (!api) {
      setErr(l.errNoApi)
      return
    }
    setBusy(true)
    try {
      const res = await api.send({ method: 'GET', url: target })
      if (!res.ok) {
        setErr(l.errFailed + (res.error ?? res.errorCode ?? ''))
        return
      }
      setStatus(String(res.status))
      setRawHeaders(res.headers)
      setAudit(auditSecurityHeaders(res.headers, /^https:/i.test(target)))
    } catch (e) {
      setErr(l.errFailed + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <SecNote scene="audit" />
      <Input value={url} onChange={setUrl} label={l.urlLabel} placeholder={l.urlPh} />
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={() => void run()} disabled={busy}>{l.fetch}</Btn>
        <Btn variant="ghost" onClick={() => { setUrl(''); setAudit(null); setRawHeaders([]); setStatus(''); setErr(null) }}>{l.clear}</Btn>
      </div>
      <ErrorNote msg={err} />

      {audit && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <Stat label={l.statIssues} value={<span className={`text-sm ${audit.issues > 0 ? 'text-amber' : 'text-phosphor'}`}>{audit.issues}</span>} />
            <Stat label={l.statOk} value={<span className="text-sm">{audit.findings.filter((f) => f.level === 'ok').length}</span>} />
            <Stat label={l.statStatus} value={<span className="text-sm">{status}</span>} />
          </div>

          <Panel title={l.findingsTitle}>
            <div className="space-y-1.5">
              {audit.findings.map((f, i) => {
                const text: { title: string; desc: string } | undefined = l.findings[f.id as keyof typeof l.findings]
                return (
                  <div key={`${f.id}-${i}`} className="flex items-start gap-3 py-1.5 border-b border-line-soft last:border-0">
                    <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 text-[10.5px] border rounded ${LEVEL_CLS[f.level]}`}>
                      {l[LEVEL_KEY[f.level]]}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-bright">{text?.title ?? f.id}</div>
                      <div className="text-[11.5px] text-muted leading-relaxed">{text?.desc ?? ''}</div>
                      {f.value && <div className="text-[11.5px] font-mono text-phosphor break-all mt-0.5">{f.value}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          {rawHeaders.length > 0 && (
            <Panel title={l.rawHeadersTitle}>
              <div className="space-y-0.5">
                {rawHeaders.map(([k, v], i) => (
                  <KV key={`${i}-${k}`} k={k} v={v} />
                ))}
              </div>
            </Panel>
          )}

          <p className="text-[11px] text-muted">{l.note}</p>
        </>
      )}
    </div>
  )
}
