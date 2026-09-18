import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, CopyBtn } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { encodingL } from '../lib/locales/encoding'
import {
  base64ToUtf8,
  decodeMorse,
  decodeUrlComponent,
  encodeMorse,
  encodeUrlComponent,
  encodeUrlFull,
  escapeUnicode,
  htmlEntityDecode,
  htmlEntityEncode,
  radixConvert,
  unescapeUnicode,
  utf8ToBase64,
} from '../lib/toolkit'

/* 实现全部来自 src/lib/toolkit —— 与 MCP 服务端共用同一份代码，别在这里就地重写算法。 */

/* ================= Base64 ================= */

export function Base64Tool() {
  const l = useLocalized(encodingL).base64
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const run = (mode: 'enc' | 'dec') => {
    try {
      setErr(null)
      setOutput(mode === 'enc' ? utf8ToBase64(input) : base64ToUtf8(input))
    } catch {
      setErr(l.err)
    }
  }
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder={l.inputPh} rows={6} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => run('enc')}>{l.enc}</Btn>
        <Btn onClick={() => run('dec')}>{l.dec}</Btn>
        <Btn variant="ghost" onClick={() => { setInput(output); setOutput('') }}>{l.swap}</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label={l.output} rows={6} />
    </div>
  )
}

/* ================= URL ================= */

export function UrlTool() {
  const l = useLocalized(encodingL).url
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const run = (mode: 'enc' | 'encAll' | 'dec') => {
    try {
      setErr(null)
      if (mode === 'enc') setOutput(encodeUrlComponent(input))
      else if (mode === 'encAll') setOutput(encodeUrlFull(input))
      else setOutput(decodeUrlComponent(input))
    } catch {
      setErr(l.err)
    }
  }
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder={l.inputPh} rows={5} />
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={() => run('enc')}>encodeURIComponent</Btn>
        <Btn onClick={() => run('encAll')}>encodeURI</Btn>
        <Btn onClick={() => run('dec')}>{l.dec}</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label={l.output} rows={5} />
    </div>
  )
}

/* ================= Unicode ================= */

export function UnicodeTool() {
  const l = useLocalized(encodingL).unicode
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const toUnicode = () => setOutput(escapeUnicode(input))
  const fromUnicode = () => setOutput(unescapeUnicode(input))
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder={l.inputPh} rows={5} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={toUnicode}>{l.toUni}</Btn>
        <Btn onClick={fromUnicode}>{l.fromUni}</Btn>
      </div>
      <TA value={output} readOnly label={l.output} rows={5} />
    </div>
  )
}

/* ================= Radix ================= */

export function RadixTool() {
  const l = useLocalized(encodingL).radix
  const [input, setInput] = useState('')
  const [from, setFrom] = useState('10')
  const result = useMemo(() => {
    if (!input.trim()) return null
    try {
      return radixConvert(input, parseInt(from))
    } catch {
      return { error: l.err }
    }
  }, [input, from, l])
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={input} onChange={setInput} label={l.input} placeholder={l.inputPh} />
        <Select value={from} onChange={setFrom} label={l.fromLabel} options={l.fromOptions} />
      </div>
      {result && 'error' in result && <ErrorNote msg={result.error!} />}
      {result && !('error' in result) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {l.bases.map(([k, key]) => (
            <div key={k} className="border border-line-soft bg-panel-2 px-3 py-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted">{k}</div>
                <div className="text-phosphor break-all text-[13px]">{(result as unknown as Record<string, string>)[key]}</div>
              </div>
              <CopyBtn text={(result as unknown as Record<string, string>)[key]} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= HTML Entities ================= */

export function HtmlEntityTool() {
  const l = useLocalized(encodingL).htmlEntity
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const encode = () => setOutput(htmlEntityEncode(input))
  const decode = () => setOutput(htmlEntityDecode(input))
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder={'<script>alert(1)</script> → &lt;script&gt;...'} rows={5} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={encode}>{l.enc}</Btn>
        <Btn onClick={decode}>{l.dec}</Btn>
      </div>
      <TA value={output} readOnly label={l.output} rows={5} />
    </div>
  )
}

/* ================= Morse Code ================= */

export function MorseTool() {
  const l = useLocalized(encodingL).morse
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const encode = () => setOutput(encodeMorse(input))
  const decode = () => setOutput(decodeMorse(input))
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder={l.ph} rows={4} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={encode}>{l.toMorse}</Btn>
        <Btn onClick={decode}>{l.fromMorse}</Btn>
      </div>
      <TA value={output} readOnly label={l.output} rows={4} />
    </div>
  )
}
