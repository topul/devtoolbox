/**
 * 二维码解码器 —— 只解码不生成（生成二维码项目里另有工具）：拖入一张图片，
 * 读出里面二维码的内容。识别走 toolkit/qrdecode.ts（jsqr 纯 JS 实现），
 * 组件负责「图片 → 像素」的采样：离屏 canvas 按最长边 1024 缩放后
 * getImageData，全程本地处理不上传。
 */
import React, { useCallback, useRef, useState } from 'react'
import { ErrorNote, KV, Panel, ResultPanel, ToolShell } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { decodeQr } from '../lib/toolkit/qrdecode'

const L = {
  zh: {
    pick: '选择图片',
    dropHint: '拖一张含二维码的图片到这里，或点击选择 —— 本地解码，不会上传',
    name: '文件名',
    size: '尺寸',
    result: '解码结果',
    noQr: '未检测到二维码 —— 试试裁剪到只留码、或换一张更清晰的图',
    errLoad: '图片加载失败',
    err: '处理图片失败',
    note: '只解码不生成（生成二维码请用项目里的二维码生成工具）；截图直接拖进来就能用，图片不会上传到任何地方。',
  },
  en: {
    pick: 'Choose image',
    dropHint:
      'Drop an image containing a QR code here, or click to choose — decoded locally, nothing is uploaded',
    name: 'File',
    size: 'Dimensions',
    result: 'Decoded content',
    noQr: 'No QR code detected — try cropping to just the code, or use a sharper image',
    errLoad: 'Failed to load image',
    err: 'Failed to process image',
    note: 'Decode only — QR generation lives in its own tool. Screenshots work as-is; images never leave this machine.',
  },
}

/** 离屏采样：加载图片 → 最长边缩到 1024 → 画到离屏 canvas 取像素 */
async function loadImagePixels(
  file: File,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('image load failed'))
      im.src = url
    })
    // 超大图缩到 1024：识别精度足够，getImageData 的内存开销可控
    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight))
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('canvas unavailable')
    ctx.drawImage(img, 0, 0, width, height)
    return { data: ctx.getImageData(0, 0, width, height).data, width, height }
  } finally {
    URL.revokeObjectURL(url) // 无论成败都释放，防内存泄漏
  }
}

export function QrDecodeTool() {
  const l = useLocalized(L)
  const [fileName, setFileName] = useState('')
  const [dims, setDims] = useState('')
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const onFile = useCallback(
    async (file: File) => {
      setErr(null)
      setText(null)
      try {
        const { data, width, height } = await loadImagePixels(file)
        setFileName(file.name)
        setDims(`${width} × ${height}`)
        const r = decodeQr(data, width, height)
        if (r.ok) setText(r.text)
        else setErr(l.noQr)
      } catch {
        setErr(l.err)
      }
    },
    [l.noQr, l.err],
  )

  return (
    <ToolShell toolId="qr-decode">
      <div
        role="button"
        tabIndex={0}
        aria-label={l.pick}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void onFile(f)
        }}
        className={`rounded-lg border border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-phosphor bg-phosphor-faint/40'
            : 'border-line hover:border-phosphor/40 hover:bg-phosphor-faint/20'
        }`}
      >
        <div className="text-[13px] text-bright">{l.pick}</div>
        <div className="mt-1 text-[12px] text-muted">{l.dropHint}</div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
          }}
        />
      </div>

      <ErrorNote msg={err} />

      {text !== null && (
        <>
          <ResultPanel title={l.result} text={text} />
          <Panel>
            <KV k={l.name} v={fileName} />
            <KV k={l.size} v={dims} />
          </Panel>
        </>
      )}

      <p className="text-[12px] text-muted leading-relaxed">{l.note}</p>
    </ToolShell>
  )
}
