import React, { useState } from 'react'
import { Btn, TA, ErrorNote, Input, KV, Select } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { codecsL } from '../lib/locales/codecs'
import {
  asciiToIdn,
  base32Decode,
  base32Encode,
  base58Decode,
  base58Encode,
  bytesToUtf8,
  idnToAscii,
  utf8Bytes,
} from '../lib/toolkit'

/* Base58 / Base32 / Punycode 的实现来自 src/lib/toolkit，与 MCP 服务端共用同一份代码。 */

type B32Mode = 'b32' | 'b32hex'

/* ================= Base58 / Base32 ================= */

export function Base58Tool() {
  const l = useLocalized(codecsL).base58
  const [mode, setMode] = useState<'b58' | B32Mode>('b58')
  const [text, setText] = useState('DevOps Toolbox')
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [padding, setPadding] = useState(true)

  const variant = mode === 'b32hex' ? 'hex' : 'rfc4648'

  const encode = () => {
    setErr(null)
    try {
      const bytes = utf8Bytes(text)
      setCode(mode === 'b58' ? base58Encode(bytes) : base32Encode(bytes, variant, padding))
    } catch (e) {
      setErr(l.errEncode + (e as Error).message)
    }
  }

  const decode = () => {
    setErr(null)
    try {
      const bytes = mode === 'b58' ? base58Decode(code.trim()) : base32Decode(code.trim(), variant)
      setText(bytesToUtf8(bytes))
    } catch (e) {
      setErr(l.errDecode + (e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-end flex-wrap">
        <div className="w-52">
          <Select
            value={mode}
            onChange={(v) => setMode(v as 'b58' | B32Mode)}
            label={l.mode}
            options={l.modes.map(([label, value]) => ({ value, label }))}
          />
        </div>
        {mode !== 'b58' && (
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted pb-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={padding} onChange={(e) => setPadding(e.target.checked)} className="accent-[var(--c-phosphor)]" />
            {l.padding}
          </label>
        )}
      </div>
      <TA value={text} onChange={setText} label={l.textLabel} rows={6} />
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={encode}>{l.encode}</Btn>
        <Btn onClick={decode}>{l.decode}</Btn>
        <Btn variant="ghost" onClick={() => { const t = text; setText(code); setCode(t) }}>{l.swap}</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={code} onChange={setCode} label={l.codeLabel} rows={6} />
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}

/* ================= Punycode / IDN ================= */

export function PunycodeTool() {
  const l = useLocalized(codecsL).punycode
  // 初始示例按当前语言给：中文界面看中文域名，英文界面看 münchen.de
  const [domain, setDomain] = useState(() => l.sampleDomain)
  const [err, setErr] = useState<string | null>(null)
  const [ascii, setAscii] = useState('')
  const [unicode, setUnicode] = useState('')

  const toAscii = () => {
    setErr(null)
    try {
      setAscii(idnToAscii(domain.trim()))
      setUnicode('')
    } catch (e) {
      setErr(l.toAscii + (e as Error).message)
    }
  }

  const toIdn = () => {
    setErr(null)
    try {
      setUnicode(asciiToIdn(domain.trim()))
      setAscii('')
    } catch (e) {
      setErr(l.toIdn + (e as Error).message)
    }
  }

  const labels = domain.trim().split('.')

  return (
    <div className="space-y-3">
      <Input value={domain} onChange={setDomain} label={l.domainLabel} placeholder="münchen.de / xn--mnchen-3ya.de" />
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={toAscii}>{l.toAscii}</Btn>
        <Btn onClick={toIdn}>{l.toIdn}</Btn>
        <Btn variant="ghost" onClick={() => setDomain('münchen.de')}>{l.sampleBtn}</Btn>
      </div>
      <ErrorNote msg={err} />
      {ascii && <KV k={l.toAscii} v={<span className="font-mono break-all">{ascii}</span>} />}
      {unicode && <KV k={l.toIdn} v={<span className="font-mono break-all">{unicode}</span>} />}
      <div className="rounded-lg border border-line bg-panel px-3 py-2 space-y-0.5">
        <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted mb-1">{l.perLabel}</div>
        {labels.map((label, i) => {
          const converted = /^xn--/i.test(label)
            ? asciiToIdn(label)
            : idnToAscii(label)
          return (
            <KV key={`${i}-${label}`} k={`${l.labelOriginal}: ${label || '—'}`} v={converted || '—'} />
          )
        })}
      </div>
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}
