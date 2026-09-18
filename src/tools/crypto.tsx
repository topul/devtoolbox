import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, KV, CopyBtn } from '../components/ui'
import { useLocalized, useI18n } from '../lib/i18n'
import { cryptoL } from '../lib/locales/crypto'
import {
  aesDecrypt,
  aesEncrypt,
  digestAll,
  hmacDigest,
  jwtDecode,
  jwtIsExpired,
  type AesMode,
  type HmacAlgo,
} from '../lib/toolkit'

/* 实现全部来自 src/lib/toolkit —— 与 MCP 服务端共用同一份代码。 */

/* ================= Hash ================= */

export function HashTool() {
  const l = useLocalized(cryptoL).hash
  const [input, setInput] = useState('')
  const out = useMemo(() => (input ? digestAll(input) : null), [input])
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder={l.inputPh} rows={4} />
      {out && (
        <div className="space-y-1.5">
          {out.map(({ label, value }) => (
            <div key={label} className="border border-line-soft bg-panel-2 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
                <div className="text-phosphor text-[12px] break-all">{value}</div>
              </div>
              <CopyBtn text={value} className="shrink-0 self-start" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= HMAC ================= */

export function HmacTool() {
  const l = useLocalized(cryptoL).hmac
  const [input, setInput] = useState('')
  const [key, setKey] = useState('')
  const [algo, setAlgo] = useState<HmacAlgo>('SHA256')
  const out = useMemo(() => {
    if (!input || !key) return ''
    try {
      return hmacDigest(algo, input, key)
    } catch {
      return ''
    }
  }, [input, key, algo])
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label={l.key} placeholder="secret" />
        <Select value={algo} onChange={v => setAlgo(v as HmacAlgo)} label={l.algo} options={[
          { value: 'MD5', label: 'HMAC-MD5' }, { value: 'SHA1', label: 'HMAC-SHA1' },
          { value: 'SHA256', label: 'HMAC-SHA256' }, { value: 'SHA512', label: 'HMAC-SHA512' },
        ]} />
      </div>
      <TA value={input} onChange={setInput} label={l.msg} rows={4} />
      {out && <TA value={out} readOnly label={l.out} rows={3} />}
    </div>
  )
}

/* ================= AES ================= */

export function AesTool() {
  const l = useLocalized(cryptoL).aes
  const [input, setInput] = useState('')
  const [key, setKey] = useState('')
  const [mode, setMode] = useState<AesMode>('ECB')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const run = (op: 'enc' | 'dec') => {
    setErr(null)
    if (!key) { setErr(l.needKey); return }
    try {
      setOutput(op === 'enc' ? aesEncrypt(input, key, mode) : aesDecrypt(input, key, mode))
    } catch {
      setErr(op === 'enc' ? l.encErr : l.decErr)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label={l.key} placeholder="my-secret-key" />
        <Select value={mode} onChange={v => setMode(v as AesMode)} label={l.mode} options={[
          { value: 'ECB', label: 'ECB' }, { value: 'CBC', label: l.cbc },
        ]} />
      </div>
      <TA value={input} onChange={setInput} label={l.io} rows={5} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => run('enc')}>{l.enc}</Btn>
        <Btn onClick={() => run('dec')}>{l.dec}</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label={l.out} rows={5} />
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}

/* ================= JWT ================= */

export function JwtTool() {
  const { locale } = useI18n()
  const l = useLocalized(cryptoL).jwt
  const [token, setToken] = useState('')
  const decoded = useMemo(() => {
    if (!token.trim()) return null
    try {
      const d = jwtDecode(token)
      const p = d.payloadObj
      const loc = locale === 'en' ? 'en-US' : 'zh-CN'
      const extra: [string, string][] = []
      const at = (v: unknown): string => new Date((v as number) * 1000).toLocaleString(loc, { hour12: false })
      if (p.exp) extra.push([l.exp, at(p.exp) + (jwtIsExpired(p) ? l.expired : l.valid)])
      if (p.iat) extra.push([l.iat, at(p.iat)])
      if (p.nbf) extra.push([l.nbf, at(p.nbf)])
      if (p.iss) extra.push([l.iss, String(p.iss)])
      if (p.sub) extra.push([l.sub, String(p.sub)])
      return { header: d.header, payload: d.payload, signature: d.signed ? d.signature : l.noSig, extra }
    } catch (e) {
      const msg = (e as Error).message
      return { error: msg === 'BAD_FORMAT' ? l.errFormat : l.parseErr + msg }
    }
  }, [token, l, locale])

  return (
    <div className="space-y-3">
      <TA value={token} onChange={setToken} label="JWT Token" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.xxxx" rows={4} />
      {decoded && 'error' in decoded && <ErrorNote msg={decoded.error!} />}
      {decoded && 'header' in decoded && (
        <div className="space-y-3">
          {decoded.extra!.length > 0 && (
            <Panel title={l.claims}>
              {decoded.extra!.map(([k, v]) => <KV key={k} k={k} v={v} />)}
            </Panel>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Panel title="Header"><pre className="codeblock text-[12px] text-amber">{decoded.header}</pre></Panel>
            <Panel title="Payload"><pre className="codeblock text-[12px] text-phosphor">{decoded.payload}</pre></Panel>
          </div>
          <Panel title="Signature">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-danger break-all">{decoded.signature}</span>
              <CopyBtn text={decoded.signature!} className="shrink-0" />
            </div>
          </Panel>
          <p className="text-[11px] text-muted">{l.note}</p>
        </div>
      )}
    </div>
  )
}

/* ================= Hash Type Identifier ================= */

export function HashIdentifyTool() {
  const l = useLocalized(cryptoL).hashId
  const [input, setInput] = useState('')
  const results = useMemo(() => {
    const h = input.trim()
    if (!h) return null
    return l.types.filter(t => {
      if (t.len > 0 && h.length !== t.len) return false
      return t.pattern.test(h)
    })
  }, [input, l])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder="5f4dcc3b5aa765d61d8327deb882cf99" rows={3} />
      {results && (
        <div className="space-y-2">
          <div className="text-[12px] text-muted">{l.lenPrefix}{input.trim().length}{l.matchMid}<span className="text-phosphor">{results.length}</span>{l.matchSuffix}</div>
          {results.length === 0 && <ErrorNote msg={l.noMatch} />}
          {results.map(r => (
            <div key={r.name} className="border border-line-soft bg-panel-2 px-3 py-2">
              <div className="text-phosphor text-[13px]">{r.name}</div>
              <div className="text-muted text-[12px]">{r.note}</div>
            </div>
          ))}
        </div>
      )}
      <Panel title={l.crackTitle}>
        <ul className="text-[12px] text-muted space-y-1 list-none">
          {l.crackList.map(x => (
            <li key={x.prefix}><span className={x.danger ? 'text-danger' : 'text-phosphor'}>{x.prefix}</span> {x.text}</li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
