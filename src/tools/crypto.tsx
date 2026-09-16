import React, { useState, useMemo } from 'react'
import CryptoJS from 'crypto-js'
import { Panel, Btn, TA, Input, Select, ErrorNote, KV, CopyBtn } from '../components/ui'
import { useLocalized, useI18n } from '../lib/i18n'
import { cryptoL } from '../lib/locales/crypto'

/* ================= Hash ================= */

export function HashTool() {
  const l = useLocalized(cryptoL).hash
  const [input, setInput] = useState('')
  const out = useMemo(() => {
    if (!input) return null
    return {
      MD5: CryptoJS.MD5(input).toString(),
      'SHA-1': CryptoJS.SHA1(input).toString(),
      'SHA-256': CryptoJS.SHA256(input).toString(),
      'SHA-512': CryptoJS.SHA512(input).toString(),
      'SHA-3': CryptoJS.SHA3(input).toString(),
      RIPEMD160: CryptoJS.RIPEMD160(input).toString(),
    }
  }, [input])
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder={l.inputPh} rows={4} />
      {out && (
        <div className="space-y-1.5">
          {Object.entries(out).map(([k, v]) => (
            <div key={k} className="border border-line-soft bg-panel-2 px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-muted">{k}</div>
                <div className="text-phosphor text-[12px] break-all">{v}</div>
              </div>
              <CopyBtn text={v} className="shrink-0 self-start" />
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
  const [algo, setAlgo] = useState('SHA256')
  const out = useMemo(() => {
    if (!input || !key) return ''
    try {
      const fn = (CryptoJS as any)['Hmac' + algo]
      return fn(input, key).toString()
    } catch { return '' }
  }, [input, key, algo])
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label={l.key} placeholder="secret" />
        <Select value={algo} onChange={setAlgo} label={l.algo} options={[
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
  const [mode, setMode] = useState('ECB')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const getKey = () => CryptoJS.enc.Utf8.parse(key.padEnd(32, '\0').slice(0, 32))
  const getIv = () => CryptoJS.enc.Utf8.parse(key.padEnd(16, '\0').split('').reverse().join('').slice(0, 16))

  const run = (op: 'enc' | 'dec') => {
    setErr(null)
    if (!key) { setErr(l.needKey); return }
    try {
      const cfg: any = { mode: (CryptoJS.mode as any)[mode], padding: CryptoJS.pad.Pkcs7 }
      if (mode !== 'ECB') cfg.iv = getIv()
      if (op === 'enc') {
        const r = CryptoJS.AES.encrypt(input, getKey(), cfg)
        setOutput(r.toString())
      } else {
        const r = CryptoJS.AES.decrypt(input.trim(), getKey(), cfg)
        const s = r.toString(CryptoJS.enc.Utf8)
        if (!s) throw new Error('decrypt result empty')
        setOutput(s)
      }
    } catch {
      setErr(op === 'enc' ? l.encErr : l.decErr)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label={l.key} placeholder="my-secret-key" />
        <Select value={mode} onChange={setMode} label={l.mode} options={[
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

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return decodeURIComponent(escape(atob(s)))
}

export function JwtTool() {
  const { locale } = useI18n()
  const l = useLocalized(cryptoL).jwt
  const [token, setToken] = useState('')
  const decoded = useMemo(() => {
    if (!token.trim()) return null
    try {
      const parts = token.trim().split('.')
      if (parts.length < 2) return { error: l.errFormat }
      const header = JSON.stringify(JSON.parse(b64urlDecode(parts[0])), null, 2)
      const payload = JSON.stringify(JSON.parse(b64urlDecode(parts[1])), null, 2)
      let extra: [string, string][] = []
      try {
        const p = JSON.parse(b64urlDecode(parts[1]))
        const loc = locale === 'en' ? 'en-US' : 'zh-CN'
        if (p.exp) extra.push([l.exp, new Date(p.exp * 1000).toLocaleString(loc, { hour12: false }) + (p.exp * 1000 < Date.now() ? l.expired : l.valid)])
        if (p.iat) extra.push([l.iat, new Date(p.iat * 1000).toLocaleString(loc, { hour12: false })])
        if (p.nbf) extra.push([l.nbf, new Date(p.nbf * 1000).toLocaleString(loc, { hour12: false })])
        if (p.iss) extra.push([l.iss, p.iss])
        if (p.sub) extra.push([l.sub, p.sub])
      } catch { /* ignore */ }
      return { header, payload, signature: parts[2] || l.noSig, extra }
    } catch (e) {
      return { error: l.parseErr + (e as Error).message }
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
