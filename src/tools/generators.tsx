import React, { useState, useMemo, useRef, useEffect } from 'react'
import QRCode from 'qrcode'
import { Panel, Btn, TA, Input, Select, Stat, ErrorNote, CopyBtn } from '../components/ui'
import { useLocalized, useI18n } from '../lib/i18n'
import { genL } from '../lib/locales/generators'
import { fakeRowsToCsv, generateFakeRows, generatePassword, generateUuids } from '../lib/toolkit'

/* URI 生成、密码、假数据的实现来自 src/lib/toolkit —— 与 MCP 服务端共用同一份代码。 */

/* ================= UUID ================= */

export function UuidTool() {
  const l = useLocalized(genL).uuid
  const [count, setCount] = useState('5')
  const [upper, setUpper] = useState(false)
  const [noDash, setNoDash] = useState(false)
  const [list, setList] = useState<string[]>(() => generateUuids({ count: 5 }))

  const gen = () => {
    setList(generateUuids({ count: parseInt(count) || 1, upper, noDash }))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        <Input value={count} onChange={setCount} label={l.count} type="number" className="w-32" />
        <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer pb-1.5">
          <input type="checkbox" checked={upper} onChange={e => setUpper(e.target.checked)} className="accent-phosphor" /> {l.upper}
        </label>
        <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer pb-1.5">
          <input type="checkbox" checked={noDash} onChange={e => setNoDash(e.target.checked)} className="accent-phosphor" /> {l.noDash}
        </label>
        <Btn variant="primary" onClick={gen}>{l.gen}</Btn>
      </div>
      <TA value={list.join('\n')} readOnly label={l.generated(list.length)} rows={Math.min(list.length + 1, 14)} />
    </div>
  )
}

/* ================= Password ================= */

type StrengthKey = 'weak' | 'medium' | 'strong' | 'veryStrong'

function strength(bits: number): { key: StrengthKey; color: string } {
  if (bits < 40) return { key: 'weak', color: '#ff5555' }
  if (bits < 70) return { key: 'medium', color: '#ffb000' }
  if (bits < 100) return { key: 'strong', color: '#00F48E' }
  return { key: 'veryStrong', color: '#00F48E' }
}

export function PasswordTool() {
  const l = useLocalized(genL).password
  const [len, setLen] = useState('16')
  const [use, setUse] = useState({ lower: true, upper: true, digit: true, symbol: true })
  const [noAmb, setNoAmb] = useState(false)
  const [pw, setPw] = useState('')
  const [bits, setBits] = useState(0)

  const gen = () => {
    try {
      const r = generatePassword({ length: parseInt(len) || 16, ...use, excludeAmbiguous: noAmb })
      setPw(r.password)
      setBits(r.bits)
    } catch {
      setPw('')
      setBits(0)
    }
  }

  useEffect(gen, [])
  const s = strength(bits)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input value={len} onChange={setLen} label={l.len} type="number" />
        <div className="md:col-span-2 flex flex-col gap-1">
          <span className="text-[11px] text-muted uppercase tracking-wider">{l.charset}</span>
          <div className="flex gap-4 flex-wrap pt-1">
            {l.sets.map(s => (
              <label key={s.key} className="flex items-center gap-2 text-[12px] text-muted cursor-pointer">
                <input type="checkbox" checked={use[s.key]} onChange={e => setUse({ ...use, [s.key]: e.target.checked })} className="accent-phosphor" /> {s.label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer">
              <input type="checkbox" checked={noAmb} onChange={e => setNoAmb(e.target.checked)} className="accent-phosphor" /> {l.noAmb}
            </label>
          </div>
        </div>
      </div>
      <Btn variant="primary" onClick={gen}>{l.gen}</Btn>
      {pw && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 border border-line bg-panel-2 px-4 py-3">
            <span className="text-lg md:text-xl text-phosphor glow break-all flex-1 select-all">{pw}</span>
            <CopyBtn text={pw} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Stat label={l.entropy} value={`${bits} bit`} />
            <Stat label={l.length} value={pw.length} />
            <div className="border border-line-soft bg-panel-2 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.15em] text-muted">{l.strength}</div>
              <div className="text-lg leading-tight" style={{ color: s.color }}>{l.strengthLabels[s.key]}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= QR Code ================= */

export function QrTool() {
  const l = useLocalized(genL).qr
  const [text, setText] = useState('')
  const [size, setSize] = useState('256')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    if (!text.trim()) {
      const ctx = canvasRef.current.getContext('2d')
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      return
    }
    QRCode.toCanvas(canvasRef.current, text, {
      width: parseInt(size),
      margin: 2,
      color: { dark: '#00F48E', light: '#000000' },
    }, e => setErr(e ? l.genFail : null))
  }, [text, size, l])

  const download = () => {
    const a = document.createElement('a')
    a.href = canvasRef.current!.toDataURL('image/png')
    a.download = 'qrcode.png'
    a.click()
  }

  return (
    <div className="space-y-3">
      <TA value={text} onChange={setText} label={l.content} placeholder={l.contentPh} rows={4} />
      <div className="flex items-end gap-3">
        <Select value={size} onChange={setSize} label={l.size} options={[
          { value: '128', label: '128 px' }, { value: '256', label: '256 px' },
          { value: '512', label: '512 px' }, { value: '1024', label: '1024 px' },
        ]} />
        {text.trim() && <Btn onClick={download}>{l.download}</Btn>}
      </div>
      <ErrorNote msg={err} />
      <div className="border border-line-soft bg-panel-2 inline-block max-w-full overflow-hidden p-3">
        <canvas ref={canvasRef} className="max-w-full h-auto" />
      </div>
    </div>
  )
}

/* ================= Mock Data Generator ================= */

export function FakeDataTool() {
  const { locale } = useI18n()
  const l = useLocalized(genL).fakeData
  const [count, setCount] = useState('10')
  const [rows, setRows] = useState<ReturnType<typeof generateFakeRows>>([])

  const gen = () => {
    setRows(generateFakeRows(locale, {
      surnames: l.surnames,
      givens: l.givens,
      phonePrefixes: l.phonePrefixes,
      domains: l.domains,
      areas: l.areas,
      firstNames: l.firstNames,
      lastNames: l.lastNames,
      enDomains: l.enDomains,
    }, parseInt(count) || 10))
  }
  useEffect(gen, [])

  const asJson = JSON.stringify(rows, null, 2)
  const asCsv = fakeRowsToCsv(rows)

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 flex-wrap">
        <Input value={count} onChange={setCount} label={l.count} type="number" className="w-32" />
        <Btn variant="primary" onClick={gen}>{l.gen}</Btn>
        <CopyBtn text={asJson} /> <span className="text-[11px] text-muted">{l.json}</span>
        <CopyBtn text={asCsv} /> <span className="text-[11px] text-muted">{l.csv}</span>
      </div>
      <div className="overflow-auto border border-line-soft">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-panel-2 text-muted text-left">
              {l.headers.map(h => (
                <th key={h} className="px-3 py-2 font-normal uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-line-soft hover:bg-phosphor-faint">
                <td className="px-3 py-1.5 text-muted">{r.id}</td>
                <td className="px-3 py-1.5 text-bright">{r.name}</td>
                <td className="px-3 py-1.5 text-phosphor/90">{r.phone}</td>
                <td className="px-3 py-1.5">{r.email}</td>
                <td className="px-3 py-1.5">{r.idcard}</td>
                <td className="px-3 py-1.5">{r.ip}</td>
                <td className="px-3 py-1.5">{r.mac}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">{l.footer}</p>
    </div>
  )
}
