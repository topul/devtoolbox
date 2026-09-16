import React, { useState, useMemo, useRef } from 'react'
import { Btn, TA, Input, ErrorNote, CopyBtn, Select } from '../components/ui'

/* ================= 颜色转换 ================= */

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, '').match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)]
}

export function ColorTool() {
  const [input, setInput] = useState('#00F48E')

  const parsed = useMemo(() => {
    let rgb: [number, number, number] | null = null
    const t = input.trim()
    if (t.startsWith('#') || /^[0-9a-f]{3,6}$/i.test(t)) {
      rgb = hexToRgb(t.startsWith('#') ? t : '#' + t)
    } else {
      const m = t.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
      if (m) rgb = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
    }
    if (!rgb) return null
    const [r, g, b] = rgb
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
    const [h, s, l] = rgbToHsl(r, g, b)
    // 互补色 / 明暗梯度
    const palette = [-40, -20, 0, 20, 40].map(dl => {
      const nl = Math.min(95, Math.max(5, l + dl))
      return `hsl(${h}, ${s}%, ${nl}%)`
    })
    return { r, g, b, hex, hsl: `hsl(${h}, ${s}%, ${l}%)`, rgbStr: `rgb(${r}, ${g}, ${b})`, palette }
  }, [input])

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <Input value={input} onChange={setInput} label="输入颜色（HEX 或 RGB）" placeholder="#00F48E 或 rgb(0, 244, 142)" />
        </div>
        {parsed && (
          <input
            type="color"
            value={parsed.hex}
            onChange={e => setInput(e.target.value)}
            className="w-14 h-10 bg-transparent border border-line cursor-pointer"
            title="取色器"
          />
        )}
      </div>
      {!parsed && input.trim() && <ErrorNote msg="无法识别颜色格式，支持 #RRGGBB / #RGB / rgb(r,g,b)" />}
      {parsed && (
        <>
          <div className="border border-line h-24" style={{ background: parsed.hex }} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {([['HEX', parsed.hex], ['RGB', parsed.rgbStr], ['HSL', parsed.hsl]] as [string, string][]).map(([k, v]) => (
              <div key={k} className="border border-line-soft bg-panel-2 px-3 py-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted">{k}</div>
                  <div className="text-phosphor text-[13px]">{v}</div>
                </div>
                <CopyBtn text={v} />
              </div>
            ))}
          </div>
          <div>
            <div className="text-[11px] text-muted uppercase tracking-wider mb-2">明度梯度</div>
            <div className="flex h-14 border border-line-soft">
              {parsed.palette.map((c, i) => (
                <button key={i} className="flex-1 !min-h-0" style={{ background: c }} title={c}
                  onClick={() => setInput(c)} />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted mt-1">
              <span>-40</span><span>-20</span><span>当前</span><span>+20</span><span>+40</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ================= 图片 ↔ Base64 ================= */

export function ImgBase64Tool() {
  const [dataUrl, setDataUrl] = useState('')
  const [meta, setMeta] = useState<{ name: string; size: number; w: number; h: number } | null>(null)
  const [decodeInput, setDecodeInput] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = (f: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      setDataUrl(url)
      const img = new Image()
      img.onload = () => setMeta({ name: f.name, size: f.size, w: img.width, h: img.height })
      img.src = url
    }
    reader.readAsDataURL(f)
  }

  const decodePreview = useMemo(() => {
    const t = decodeInput.trim()
    if (!t) return null
    if (/^data:image\/[a-z+]+;base64,/i.test(t)) return t
    if (/^[A-Za-z0-9+/=\s]+$/.test(t) && t.length > 100) return 'data:image/png;base64,' + t.replace(/\s/g, '')
    return null
  }, [decodeInput])

  const download = () => {
    const a = document.createElement('a')
    a.href = decodePreview!
    a.download = 'decoded.png'
    a.click()
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] text-muted uppercase tracking-wider mb-2">① 图片 → Base64</div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <Btn onClick={() => fileRef.current?.click()}>选择图片文件</Btn>
        {meta && (
          <div className="mt-2 text-[12px] text-muted">
            {meta.name} · {meta.w}×{meta.h} · {(meta.size / 1024).toFixed(1)} KB · Base64 长度 {dataUrl.length.toLocaleString()}
          </div>
        )}
        {dataUrl && (
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            <img src={dataUrl} alt="preview" className="max-h-40 border border-line-soft" />
            <TA value={dataUrl} readOnly label="DataURL" rows={5} />
          </div>
        )}
      </div>
      <div className="border-t border-line-soft pt-4">
        <div className="text-[11px] text-muted uppercase tracking-wider mb-2">② Base64 → 图片</div>
        <TA value={decodeInput} onChange={setDecodeInput} label="粘贴 Base64 / DataURL" rows={4} placeholder="data:image/png;base64,iVBORw0KGgo..." />
        {decodePreview && (
          <div className="mt-2 flex items-start gap-3">
            <img src={decodePreview} alt="decoded" className="max-h-40 border border-line-soft" />
            <Btn onClick={download}>下载图片</Btn>
          </div>
        )}
        {decodeInput.trim() && !decodePreview && <ErrorNote msg="无法识别的 Base64 图片数据" />}
      </div>
    </div>
  )
}

/* ================= 多重编码链 ================= */

const ENCODERS: Record<string, { name: string; enc: (s: string) => string; dec: (s: string) => string }> = {
  url: { name: 'URL 编码', enc: s => encodeURIComponent(s), dec: s => decodeURIComponent(s) },
  doubleUrl: { name: '双重 URL', enc: s => encodeURIComponent(encodeURIComponent(s)), dec: s => decodeURIComponent(decodeURIComponent(s)) },
  html: {
    name: 'HTML 实体',
    enc: s => s.split('').map(c => '&#' + c.charCodeAt(0) + ';').join(''),
    dec: s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d))),
  },
  unicode: {
    name: 'Unicode 转义',
    enc: s => s.split('').map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''),
    dec: s => s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))),
  },
  hex: {
    name: 'Hex (0x)',
    enc: s => s.split('').map(c => '0x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(','),
    dec: s => s.split(',').map(h => String.fromCharCode(parseInt(h.trim(), 16))).join(''),
  },
  base64: {
    name: 'Base64',
    enc: s => btoa(unescape(encodeURIComponent(s))),
    dec: s => decodeURIComponent(escape(atob(s.replace(/\s/g, '')))),
  },
}

export function StringEscapeTool() {
  const [input, setInput] = useState(`<script>alert(1)</script>`)
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const run = (key: string, mode: 'enc' | 'dec') => {
    setErr(null)
    try {
      setOutput(ENCODERS[key][mode](input))
    } catch {
      setErr('处理失败：输入格式与所选编码不匹配。')
    }
  }

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="输入" rows={4} />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Object.entries(ENCODERS).map(([key, e]) => (
          <div key={key} className="border border-line-soft bg-panel-2 px-2.5 py-2 flex flex-col gap-1.5">
            <span className="text-[11px] text-muted">{e.name}</span>
            <div className="flex gap-1.5">
              <Btn className="flex-1 !px-1.5 text-[11px]" onClick={() => run(key, 'enc')}>编码</Btn>
              <Btn className="flex-1 !px-1.5 text-[11px]" variant="ghost" onClick={() => run(key, 'dec')}>解码</Btn>
            </div>
          </div>
        ))}
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label="输出" rows={4} />
      <p className="text-[11px] text-muted">* 多重编码常用于 WAF 绕过与 payload 混淆测试；HTML 实体支持 &#x41; / &amp;#65; 两种格式解码。</p>
    </div>
  )
}
