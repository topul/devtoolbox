import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, CopyBtn } from '../components/ui'

/* ================= Base64 ================= */

function utf8ToB64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}
function b64ToUtf8(s: string): string {
  return decodeURIComponent(escape(atob(s.replace(/\s/g, ''))))
}

export function Base64Tool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const run = (mode: 'enc' | 'dec') => {
    try {
      setErr(null)
      setOutput(mode === 'enc' ? utf8ToB64(input) : b64ToUtf8(input))
    } catch {
      setErr('输入内容无法被正确解析，请检查是否为合法的 Base64 / 文本。')
    }
  }
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="输入" placeholder="输入文本或 Base64 字符串..." rows={6} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => run('enc')}>编码 → Base64</Btn>
        <Btn onClick={() => run('dec')}>解码 → 文本</Btn>
        <Btn variant="ghost" onClick={() => { setInput(output); setOutput('') }}>⇅ 交换</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label="输出" rows={6} />
    </div>
  )
}

/* ================= URL ================= */

export function UrlTool() {
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
      setErr('解码失败：输入包含非法的 % 转义序列。')
    }
  }
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="输入" placeholder="输入 URL 或文本..." rows={5} />
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={() => run('enc')}>encodeURIComponent</Btn>
        <Btn onClick={() => run('encAll')}>encodeURI</Btn>
        <Btn onClick={() => run('dec')}>解码</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label="输出" rows={5} />
    </div>
  )
}

/* ================= Unicode ================= */

export function UnicodeTool() {
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
      <TA value={input} onChange={setInput} label="输入" placeholder="中文 → \u4e2d\u6587，或反向转换..." rows={5} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={toUnicode}>转 Unicode 转义</Btn>
        <Btn onClick={fromUnicode}>Unicode 转文本</Btn>
      </div>
      <TA value={output} readOnly label="输出" rows={5} />
    </div>
  )
}

/* ================= 进制转换 ================= */

export function RadixTool() {
  const [input, setInput] = useState('')
  const [from, setFrom] = useState('10')
  const result = useMemo(() => {
    if (!input.trim()) return null
    const n = parseInt(input.trim().replace(/^0x/i, ''), parseInt(from))
    if (isNaN(n)) return { error: '无法解析为数字，请检查输入与源进制是否匹配。' }
    return {
      bin: n.toString(2),
      oct: n.toString(8),
      dec: n.toString(10),
      hex: n.toString(16).toUpperCase(),
    }
  }, [input, from])
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={input} onChange={setInput} label="数值" placeholder="例如 255 或 0xFF" />
        <Select value={from} onChange={setFrom} label="源进制" options={[
          { value: '2', label: '二进制 (0b)' },
          { value: '8', label: '八进制 (0o)' },
          { value: '10', label: '十进制' },
          { value: '16', label: '十六进制 (0x)' },
        ]} />
      </div>
      {result && 'error' in result && <ErrorNote msg={result.error!} />}
      {result && !('error' in result) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {([['二进制', result.bin], ['八进制', result.oct], ['十进制', result.dec], ['十六进制', result.hex]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="border border-line-soft bg-panel-2 px-3 py-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted">{k}</div>
                <div className="text-phosphor break-all text-[13px]">{v}</div>
              </div>
              <CopyBtn text={v} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= HTML 实体 ================= */

export function HtmlEntityTool() {
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
      <TA value={input} onChange={setInput} label="输入" placeholder={'<script>alert(1)</script> → &lt;script&gt;...'} rows={5} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={encode}>编码为实体</Btn>
        <Btn onClick={decode}>实体解码</Btn>
      </div>
      <TA value={output} readOnly label="输出" rows={5} />
    </div>
  )
}

/* ================= 摩尔斯电码 ================= */

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
      <TA value={input} onChange={setInput} label="输入" placeholder="SOS 或 ... --- ..." rows={4} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={encode}>文本 → 摩尔斯</Btn>
        <Btn onClick={decode}>摩尔斯 → 文本</Btn>
      </div>
      <TA value={output} readOnly label="输出" rows={4} />
    </div>
  )
}
