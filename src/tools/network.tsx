import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, ErrorNote, KV, CopyBtn } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { networkL } from '../lib/locales/network'
import { ipConvert, parseCookie, parseUrl, parseUserAgent } from '../lib/toolkit'

/* 实现全部来自 src/lib/toolkit —— 与 MCP 服务端共用同一份代码。 */

/* ================= URL Parser ================= */

export function UrlParserTool() {
  const l = useLocalized(networkL).urlParser
  const [input, setInput] = useState('https://user:pass@api.example.com:8443/v1/users?id=42&token=abc%20def&tag=a&tag=b#section')

  const parsed = useMemo(() => {
    if (!input.trim()) return null
    try {
      const r = parseUrl(input)
      return { ...r, port: r.port || l.default }
    } catch {
      return { error: l.error }
    }
  }, [input, l])

  return (
    <div className="space-y-3">
      <Input value={input} onChange={setInput} label="URL" placeholder="https://example.com/path?a=1&b=2#frag" />
      {parsed && 'error' in parsed && <ErrorNote msg={parsed.error!} />}
      {parsed && !('error' in parsed) && (
        <div className="space-y-3">
          <Panel title={l.componentsTitle}>
            <KV k={l.protocol} v={parsed.protocol} />
            {parsed.username && <KV k={l.username} v={<span className="text-amber">{parsed.username}</span>} />}
            {parsed.password && <KV k={l.password} v={<span className="text-danger">{parsed.password}</span>} />}
            <KV k={l.hostname} v={<span className="text-phosphor">{parsed.hostname}</span>} />
            <KV k={l.port} v={parsed.port} />
            <KV k={l.path} v={parsed.pathname} />
            {parsed.hash && <KV k={l.hash} v={parsed.hash} />}
          </Panel>
          <Panel title={l.paramsTitle(parsed.params.length)}>
            {parsed.params.length === 0 && <span className="text-muted text-[12px]">{l.noParams}</span>}
            {parsed.params.map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-line-soft last:border-0">
                <div className="min-w-0 text-[12.5px]">
                  <span className="text-phosphor">{p.k}</span>
                  <span className="text-muted"> = </span>
                  <span className="text-bright break-all">{p.v}</span>
                </div>
                <CopyBtn text={`${p.k}=${p.v}`} className="shrink-0" />
              </div>
            ))}
          </Panel>
          <div className="flex gap-2 flex-wrap">
            <Btn onClick={() => setInput(encodeURI(input.trim()))}>{l.encodeAll}</Btn>
            <Btn variant="ghost" onClick={() => setInput(decodeURI(input.trim()))}>{l.decodeAll}</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= User-Agent Parser ================= */

const UA_EXAMPLES: [string, string][] = [
  ['Chrome / Win', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'],
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
  ['sqlmap', 'sqlmap/1.7.2#stable (https://sqlmap.org)'],
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
]

export function UserAgentTool() {
  const l = useLocalized(networkL).uaParser
  const [input, setInput] = useState('')
  const info = useMemo(() => {
    const t = input.trim()
    if (!t) return null
    const r = parseUserAgent(t)
    return {
      browser: r.browser ? (r.browser === 'WeChat' ? l.wechatBrowser : r.browser) : l.unknown,
      version: r.version,
      os: r.os || l.unknown,
      device: r.device === 'mobile' ? l.phone : r.device === 'tablet' ? l.tablet : l.desktop,
      bot: r.bot,
    }
  }, [input, l])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.label} rows={4} placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) ..." />
      <div className="flex gap-2 flex-wrap">
        {UA_EXAMPLES.map(([name, ua]) => (
          <button key={name} onClick={() => setInput(ua)}
            className="px-2 py-1 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
            {name}
          </button>
        ))}
      </div>
      {info && (
        <Panel title={l.resultTitle}>
          <KV k={l.browser} v={<span className="text-phosphor">{info.browser} {info.version}</span>} />
          <KV k={l.os} v={info.os} />
          <KV k={l.device} v={info.device} />
          <KV k={l.botKey} v={info.bot ? <span className="text-danger">{info.bot} ({l.botSuffix})</span> : <span className="text-muted">{l.botNone}</span>} />
        </Panel>
      )}
    </div>
  )
}

/* ================= IP ↔ Integer ================= */

export function IpIntTool() {
  const l = useLocalized(networkL).ipInt
  const [input, setInput] = useState('127.0.0.1')

  const result = useMemo(() => {
    if (!input.trim()) return null
    try {
      return ipConvert(input)
    } catch {
      return { error: l.error }
    }
  }, [input, l])

  return (
    <div className="space-y-3">
      <Input value={input} onChange={setInput} label={l.label} placeholder={l.placeholder} />
      {result && 'error' in result && <ErrorNote msg={result.error!} />}
      {result && !('error' in result) && (
        <Panel title={l.equivTitle}>
          <KV k={l.dottedDecimal} v={<span className="text-phosphor">{result.ip}</span>} />
          <KV k={l.decimalInt} v={<>{result.decimal} <CopyBtn text={String(result.decimal)} /></>} />
          <KV k={l.hex} v={<>{result.hex} <CopyBtn text={result.hex} /></>} />
          <KV k={l.octal} v={<>{result.octal} <CopyBtn text={result.octal} /></>} />
          <KV k={l.dottedHex} v={<>{result.dottedHex} <CopyBtn text={result.dottedHex} /></>} />
          <KV k={l.dottedOctal} v={<>{result.dottedOctal} <CopyBtn text={result.dottedOctal} /></>} />
        </Panel>
      )}
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}

/* ================= Cookie Parser ================= */

export function CookieTool() {
  const l = useLocalized(networkL).cookie
  const [input, setInput] = useState('sessionid=abc123; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/; Domain=.example.com; Secure; HttpOnly; SameSite=Lax')

  const parsed = useMemo(() => {
    if (!input.trim()) return null
    try {
      const r = parseCookie(input)
      return {
        cookie: r.cookie,
        attrs: r.attrs.map(a => ({ k: a.k, v: a.flag ? null : a.v, note: (l.attrNotes as Record<string, string>)[a.k] })),
      }
    } catch {
      return null
    }
  }, [input, l])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.label} rows={3} />
      {parsed && (
        <div className="space-y-3">
          {parsed.cookie ? (
            <Panel title={l.cookieTitle}>
              <KV k={l.name} v={<span className="text-phosphor">{parsed.cookie.name}</span>} />
              <KV k={l.value} v={<span className="break-all">{parsed.cookie.value}</span>} />
            </Panel>
          ) : (
            <ErrorNote msg={l.notNameValue} />
          )}
          {parsed.attrs.length > 0 && (
            <Panel title={l.attrsTitle}>
              {parsed.attrs.map((a, i) => (
                <div key={i} className="py-1 border-b border-line-soft last:border-0 text-[12.5px]">
                  <span className="text-phosphor">{a.k}</span>
                  {a.v !== null && <span className="text-muted"> = {a.v}</span>}
                  {a.note && <div className="text-[11px] text-muted">{a.note}</div>}
                </div>
              ))}
            </Panel>
          )}
          <Panel title={l.securityTitle}>
            {(() => {
              const ks = parsed.attrs.map(a => a.k)
              const checks: [boolean, string, string][] = [
                [ks.includes('httponly'), 'HttpOnly', l.riskHttponly],
                [ks.includes('secure'), 'Secure', l.riskSecure],
                [ks.includes('samesite'), 'SameSite', l.riskSamesite],
              ]
              return checks.map(([ok, name, risk]) => (
                <div key={name} className="py-1 border-b border-line-soft last:border-0 text-[12.5px]">
                  <span className={ok ? 'text-phosphor' : 'text-danger'}>{ok ? '✓' : '✗'} {name}</span>
                  {!ok && <span className="text-muted text-[11px]"> — {risk}</span>}
                </div>
              ))
            })()}
          </Panel>
        </div>
      )}
    </div>
  )
}
