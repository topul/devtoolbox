import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, CopyBtn } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { encodingL } from '../lib/locales/encoding'

/* ================= Base64 ================= */

function utf8ToB64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}
function b64ToUtf8(s: string): string {
  return decodeURIComponent(escape(atob(s.replace(/\s/g, ''))))
}

export function Base64Tool() {
  const l = useLocalized(encodingL).base64
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const run = (mode: 'enc' | 'dec') => {
    try {
      setErr(null)
      setOutput(mode === 'enc' ? utf8ToB64(input) : b64ToUtf8(input))
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
      if (mode === 'enc') setOutput(encodeURIComponent(input))
      else if (mode === 'encAll') setOutput(encodeURI(input))
      else setOutput(decodeURIComponent(input))
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
  const toUnicode = () =>
    setOutput(input.split('').map(c => {
      const code = c.codePointAt(0)!
      return code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : c
    }).join(''))
  const fromUnicode = () =>
    setOutput(input.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))))
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
    const n = parseInt(input.trim().replace(/^0x/i, ''), parseInt(from))
    if (isNaN(n)) return { error: l.err }
    return {
      bin: n.toString(2),
      oct: n.toString(8),
      dec: n.toString(10),
      hex: n.toString(16).toUpperCase(),
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
  const encode = () => setOutput(input.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!)))
  const decode = () => {
    const el = document.createElement('textarea')
    el.innerHTML = input
    setOutput(el.value)
  }
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

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '@': '.--.-.',
}
const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]))

export function MorseTool() {
  const l = useLocalized(encodingL).morse
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const encode = () => setOutput(
    input.toUpperCase().split('').map(c => c === ' ' ? '/' : (MORSE[c] ?? c)).join(' ')
  )
  const decode = () => setOutput(
    input.trim().split(/\s+/).map(t => t === '/' ? ' ' : (MORSE_REV[t] ?? t)).join('')
  )
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
