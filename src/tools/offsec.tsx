import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, CopyBtn } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { offsecL } from '../lib/locales/offsec'

/* ================= XOR ================= */

function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (!key.length) return data
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length]
  return out
}
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const fromHex = (s: string): Uint8Array => {
  const clean = s.replace(/[^0-9a-f]/gi, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function XorTool() {
  const l = useLocalized(offsecL).xor
  const [input, setInput] = useState('flag{xor_1s_fun}')
  const [key, setKey] = useState('key')
  const [keyIsHex, setKeyIsHex] = useState(false)
  const [inputIsHex, setInputIsHex] = useState(false)

  const result = useMemo(() => {
    if (!input || !key) return null
    try {
      const data = inputIsHex ? fromHex(input) : new TextEncoder().encode(input)
      const k = keyIsHex ? fromHex(key) : new TextEncoder().encode(key)
      const out = xorBytes(data, k)
      let printable = ''
      try {
        printable = new TextDecoder('utf-8', { fatal: true }).decode(out)
      } catch { printable = l.nonPrintable }
      return { hex: toHex(out), text: printable }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [input, key, keyIsHex, inputIsHex, l])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} rows={4} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label={l.key} placeholder="key or 6b6579" />
        <div className="flex items-end gap-4 pb-1.5">
          <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
            <input type="checkbox" checked={inputIsHex} onChange={e => setInputIsHex(e.target.checked)} className="accent-phosphor" /> {l.inputHex}
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
            <input type="checkbox" checked={keyIsHex} onChange={e => setKeyIsHex(e.target.checked)} className="accent-phosphor" /> {l.keyHex}
          </label>
        </div>
      </div>
      {result && 'error' in result && <ErrorNote msg={result.error!} />}
      {result && !('error' in result) && (
        <div className="space-y-2">
          <TA value={result.text} readOnly label={l.textResult} rows={3} />
          <TA value={result.hex} readOnly label={l.hexResult} rows={2} />
        </div>
      )}
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}

/* ================= ROT / Caesar ================= */

function caesar(s: string, shift: number): string {
  return s.split('').map(c => {
    const code = c.charCodeAt(0)
    if (code >= 65 && code <= 90) return String.fromCharCode((code - 65 + shift + 26) % 26 + 65)
    if (code >= 97 && code <= 122) return String.fromCharCode((code - 97 + shift + 26) % 26 + 97)
    return c
  }).join('')
}
function rot47(s: string): string {
  return s.split('').map(c => {
    const code = c.charCodeAt(0)
    return code >= 33 && code <= 126 ? String.fromCharCode(33 + ((code - 33 + 47) % 94)) : c
  }).join('')
}

export function RotTool() {
  const l = useLocalized(offsecL).rot
  const [input, setInput] = useState('Uryyb Jbeyq')
  const [shift, setShift] = useState('13')
  const [brute, setBrute] = useState(false)

  const output = useMemo(() => caesar(input, parseInt(shift) || 0), [input, shift])
  const r47 = useMemo(() => rot47(input), [input])
  const bruteList = useMemo(() => {
    if (!brute || !input) return null
    return Array.from({ length: 25 }, (_, i) => ({ n: i + 1, text: caesar(input, i + 1) }))
  }, [brute, input])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} rows={4} />
      <div className="flex gap-3 items-end flex-wrap">
        <Input value={shift} onChange={setShift} label={l.shift} type="number" className="w-36" />
        <Btn variant="primary" onClick={() => {}} disabled className="invisible">{l.placeholder}</Btn>
        <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer pb-1.5">
          <input type="checkbox" checked={brute} onChange={e => setBrute(e.target.checked)} className="accent-phosphor" /> {l.brute}
        </label>
      </div>
      {!brute && (
        <div className="space-y-2">
          <TA value={output} readOnly label={l.caesar(shift)} rows={3} />
          <TA value={r47} readOnly label={l.rot47} rows={2} />
        </div>
      )}
      {brute && bruteList && (
        <div className="border border-line-soft bg-panel-2 max-h-[420px] overflow-auto">
          {bruteList.map(b => (
            <div key={b.n} className="flex gap-3 px-3 py-1.5 border-b border-line-soft last:border-0 text-[12px] hover:bg-phosphor-faint">
              <span className="text-muted w-14 shrink-0">ROT-{b.n}</span>
              <span className="text-bright break-all">{b.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= Vigenere ================= */

function vigenere(text: string, key: string, decrypt = false): string {
  const k = key.toLowerCase().replace(/[^a-z]/g, '')
  if (!k) return text
  let ki = 0
  return text.split('').map(c => {
    const code = c.charCodeAt(0)
    const isUpper = code >= 65 && code <= 90
    const isLower = code >= 97 && code <= 122
    if (!isUpper && !isLower) return c
    const shift = k.charCodeAt(ki % k.length) - 97
    ki++
    const base = isUpper ? 65 : 97
    const offset = decrypt ? 26 - shift : shift
    return String.fromCharCode((code - base + offset) % 26 + base)
  }).join('')
}

export function VigenereTool() {
  const l = useLocalized(offsecL).vigenere
  const [input, setInput] = useState('ATTACKATDAWN')
  const [key, setKey] = useState('LEMON')
  const [output, setOutput] = useState('')
  const [mode, setMode] = useState<'enc' | 'dec'>('enc')

  const run = (m: 'enc' | 'dec') => {
    setMode(m)
    setOutput(vigenere(input, key, m === 'dec'))
  }

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} rows={4} />
      <Input value={key} onChange={setKey} label={l.key} placeholder="LEMON" />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => run('enc')}>{l.enc}</Btn>
        <Btn onClick={() => run('dec')}>{l.dec}</Btn>
      </div>
      {output && <TA value={output} readOnly label={mode === 'enc' ? l.cipher : l.plain} rows={3} />}
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}

/* ================= Privesc Cheat Sheet ================= */

export function PrivescTool() {
  const l = useLocalized(offsecL).privesc
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    if (!filter.trim()) return l.groups
    const q = filter.toLowerCase()
    return l.groups.map(g => ({
      ...g,
      items: g.items.filter(i =>
        i.label.toLowerCase().includes(q) || i.cmd.toLowerCase().includes(q) || (i.note || '').toLowerCase().includes(q)),
    })).filter(g => g.items.length > 0)
  }, [filter, l])

  return (
    <div className="space-y-3">
      <Input value={filter} onChange={setFilter} label={l.filter} placeholder="sudo / potato / suid / cron..." />
      {filtered.map(g => (
        <Panel key={g.name} title={g.name}>
          <div className="space-y-1.5">
            {g.items.map((it, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3 border border-line-soft bg-panel-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-muted">{it.label}{it.note ? ` · ${it.note}` : ''}</div>
                  <code className="text-[12.5px] text-phosphor break-all">{it.cmd}</code>
                </div>
                <CopyBtn text={it.cmd} className="shrink-0 mt-0.5 self-start" />
              </div>
            ))}
          </div>
        </Panel>
      ))}
      {filtered.length === 0 && <ErrorNote msg={l.noMatch} />}
    </div>
  )
}
