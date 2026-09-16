import React, { useState, useMemo, useRef, useEffect } from 'react'
import QRCode from 'qrcode'
import { Panel, Btn, TA, Input, Select, Stat, ErrorNote, CopyBtn } from '../components/ui'

/* ================= UUID ================= */

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function UuidTool() {
  const [count, setCount] = useState('5')
  const [upper, setUpper] = useState(false)
  const [noDash, setNoDash] = useState(false)
  const [list, setList] = useState<string[]>(() => Array.from({ length: 5 }, uuidv4))

  const gen = () => {
    const n = Math.min(Math.max(parseInt(count) || 1, 1), 500)
    let arr = Array.from({ length: n }, uuidv4)
    if (noDash) arr = arr.map(u => u.replace(/-/g, ''))
    if (upper) arr = arr.map(u => u.toUpperCase())
    setList(arr)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        <Input value={count} onChange={setCount} label="数量 (1-500)" type="number" className="w-32" />
        <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer pb-1.5">
          <input type="checkbox" checked={upper} onChange={e => setUpper(e.target.checked)} className="accent-phosphor" /> 大写
        </label>
        <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer pb-1.5">
          <input type="checkbox" checked={noDash} onChange={e => setNoDash(e.target.checked)} className="accent-phosphor" /> 去掉连字符
        </label>
        <Btn variant="primary" onClick={gen}>生成 UUID v4</Btn>
      </div>
      <TA value={list.join('\n')} readOnly label={`已生成 ${list.length} 个`} rows={Math.min(list.length + 1, 14)} />
    </div>
  )
}

/* ================= 随机密码 ================= */

const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digit: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>?/',
  ambiguous: 'Il1O0',
}

function strength(bits: number): { label: string; color: string } {
  if (bits < 40) return { label: '弱', color: '#ff5555' }
  if (bits < 70) return { label: '中等', color: '#ffb000' }
  if (bits < 100) return { label: '强', color: '#00F48E' }
  return { label: '极强', color: '#00F48E' }
}

export function PasswordTool() {
  const [len, setLen] = useState('16')
  const [use, setUse] = useState({ lower: true, upper: true, digit: true, symbol: true })
  const [noAmb, setNoAmb] = useState(false)
  const [pw, setPw] = useState('')
  const [bits, setBits] = useState(0)

  const gen = () => {
    let pool = ''
    if (use.lower) pool += CHARSETS.lower
    if (use.upper) pool += CHARSETS.upper
    if (use.digit) pool += CHARSETS.digit
    if (use.symbol) pool += CHARSETS.symbol
    if (noAmb) pool = pool.split('').filter(c => !CHARSETS.ambiguous.includes(c)).join('')
    if (!pool) { setPw(''); setBits(0); return }
    const n = Math.min(Math.max(parseInt(len) || 16, 4), 128)
    const rnd = crypto.getRandomValues(new Uint32Array(n))
    const out = Array.from(rnd, r => pool[r % pool.length]).join('')
    setPw(out)
    setBits(Math.round(n * Math.log2(pool.length)))
  }

  useEffect(gen, [])
  const s = strength(bits)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input value={len} onChange={setLen} label="长度 (4-128)" type="number" />
        <div className="md:col-span-2 flex flex-col gap-1">
          <span className="text-[11px] text-muted uppercase tracking-wider">字符集</span>
          <div className="flex gap-4 flex-wrap pt-1">
            {([['lower', '小写 a-z'], ['upper', '大写 A-Z'], ['digit', '数字 0-9'], ['symbol', '符号 !@#']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-[12px] text-muted cursor-pointer">
                <input type="checkbox" checked={use[k]} onChange={e => setUse({ ...use, [k]: e.target.checked })} className="accent-phosphor" /> {label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer">
              <input type="checkbox" checked={noAmb} onChange={e => setNoAmb(e.target.checked)} className="accent-phosphor" /> 排除易混淆 (Il1O0)
            </label>
          </div>
        </div>
      </div>
      <Btn variant="primary" onClick={gen}>⚡ 生成密码</Btn>
      {pw && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 border border-line bg-panel-2 px-4 py-3">
            <span className="text-lg md:text-xl text-phosphor glow break-all flex-1 select-all">{pw}</span>
            <CopyBtn text={pw} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Stat label="熵值" value={`${bits} bit`} />
            <Stat label="长度" value={pw.length} />
            <div className="border border-line-soft bg-panel-2 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.15em] text-muted">强度</div>
              <div className="text-lg leading-tight" style={{ color: s.color }}>{s.label}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= 二维码 ================= */

export function QrTool() {
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
    }, e => setErr(e ? '生成失败：内容过长' : null))
  }, [text, size])

  const download = () => {
    const a = document.createElement('a')
    a.href = canvasRef.current!.toDataURL('image/png')
    a.download = 'qrcode.png'
    a.click()
  }

  return (
    <div className="space-y-3">
      <TA value={text} onChange={setText} label="内容" placeholder="输入链接、文本、WiFi 配置 (WIFI:T:WPA;S:名称;P:密码;;)..." rows={4} />
      <div className="flex items-end gap-3">
        <Select value={size} onChange={setSize} label="尺寸" options={[
          { value: '128', label: '128 px' }, { value: '256', label: '256 px' },
          { value: '512', label: '512 px' }, { value: '1024', label: '1024 px' },
        ]} />
        {text.trim() && <Btn onClick={download}>下载 PNG</Btn>}
      </div>
      <ErrorNote msg={err} />
      <div className="border border-line-soft bg-panel-2 inline-block max-w-full overflow-hidden p-3">
        <canvas ref={canvasRef} className="max-w-full h-auto" />
      </div>
    </div>
  )
}

/* ================= 测试数据生成 ================= */

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何罗高林郑梁谢宋唐许韩冯邓曹彭'.split('')
const GIVEN = '伟芳娜敏静丽强磊军洋勇艳杰娟涛明超霞平刚桂英华玉梅浩宇欣怡子轩雨泽思远若曦'.split('')
const DOMAINS = ['example.com', 'test.org', 'demo.net', 'mail.cn', 'dev.io']

function rndInt(min: number, max: number) {
  return min + crypto.getRandomValues(new Uint32Array(1))[0] % (max - min + 1)
}
function rndName() {
  return SURNAMES[rndInt(0, SURNAMES.length - 1)] + GIVEN[rndInt(0, GIVEN.length - 1)] + (Math.random() > 0.5 ? GIVEN[rndInt(0, GIVEN.length - 1)] : '')
}
function rndPhone() {
  const pre = ['130', '131', '135', '138', '150', '155', '176', '186', '188', '199']
  return pre[rndInt(0, pre.length - 1)] + String(rndInt(10000000, 99999999))
}
function rndEmail() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const n = rndInt(5, 10)
  let u = ''
  for (let i = 0; i < n; i++) u += chars[rndInt(0, chars.length - 1)]
  return u + '@' + DOMAINS[rndInt(0, DOMAINS.length - 1)]
}
function rndIdCard() {
  const area = ['110101', '310104', '440305', '330106', '510107']
  const y = rndInt(1970, 2002), m = rndInt(1, 12), d = rndInt(1, 28)
  const body = area[rndInt(0, area.length - 1)] + y + String(m).padStart(2, '0') + String(d).padStart(2, '0') + String(rndInt(100, 999))
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const C = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = body.split('').reduce((acc, ch, i) => acc + parseInt(ch) * W[i], 0)
  return body + C[sum % 11]
}
function rndIPv4() { return Array.from({ length: 4 }, () => rndInt(1, 254)).join('.') }
function rndMac() { return Array.from({ length: 6 }, () => rndInt(0, 255).toString(16).padStart(2, '0')).join(':') }

export function FakeDataTool() {
  const [count, setCount] = useState('10')
  const [rows, setRows] = useState<any[]>([])

  const gen = () => {
    const n = Math.min(Math.max(parseInt(count) || 10, 1), 100)
    setRows(Array.from({ length: n }, (_, i) => ({
      id: i + 1, name: rndName(), phone: rndPhone(), email: rndEmail(),
      idcard: rndIdCard(), ip: rndIPv4(), mac: rndMac().toUpperCase(),
    })))
  }
  useEffect(gen, [])

  const asJson = JSON.stringify(rows, null, 2)
  const asCsv = 'id,name,phone,email,idcard,ip,mac\n' + rows.map(r => Object.values(r).join(',')).join('\n')

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 flex-wrap">
        <Input value={count} onChange={setCount} label="条数 (1-100)" type="number" className="w-32" />
        <Btn variant="primary" onClick={gen}>生成测试数据</Btn>
        <CopyBtn text={asJson} /> <span className="text-[11px] text-muted">JSON</span>
        <CopyBtn text={asCsv} /> <span className="text-[11px] text-muted">CSV</span>
      </div>
      <div className="overflow-auto border border-line-soft">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-panel-2 text-muted text-left">
              {['#', '姓名', '手机号', '邮箱', '身份证', 'IPv4', 'MAC'].map(h => (
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
      <p className="text-[11px] text-muted">* 所有数据均为本地随机生成的虚拟数据，身份证校验位已按 GB 11643 算法计算，仅可用于开发测试。</p>
    </div>
  )
}
