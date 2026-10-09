/**
 * SRI 哈希生成器 —— 给 CDN / 自托管资源算 integrity 属性值。
 *
 * 两种输入共用一条数据管道：拖文件吃字节（大文件、构建产物），粘贴文本按
 * UTF-8 编码后吃字节（内联脚本、小段配置）。两者互斥 —— 后选的替换先前的，
 * 避免「结果到底算的是哪个」的歧义。三行结果里 sha384 高亮：sha256 仍兼容
 * 旧浏览器，但 sha384 是当前浏览器厂商推荐的默认档位。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  Btn,
  CopyBtn,
  ErrorNote,
  KV,
  Panel,
  TA,
  ToolShell,
  usePersistedState,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { sriFromBytes, type SriResult } from '../lib/toolkit/sri'

const L = {
  zh: {
    pick: '选择文件',
    dropHint: '拖一个文件到这里，或点击选择 —— 哈希在本地内存中计算，不会上传',
    text: '或粘贴文本内容',
    textPh: '要托管/内联的脚本或文本，按 UTF-8 字节计算',
    sourceFile: 'SRI integrity · 来源：文件',
    sourceText: 'SRI integrity · 来源：文本',
    recommended: '推荐',
    reset: '清除',
    err: '读取文件失败',
    usage: '使用方式',
    noteTitle: '安全说明',
    note: '**安全说明**：SRI（子资源完整性）让浏览器在执行第三方脚本/样式前先比对哈希 —— CDN 被入侵、资源被篡改时直接拒绝加载，是引用外部资源时的标准防线。哈希完全在本地计算，文件与文本不出本机。注意：integrity 绑定的是字节级内容，资源升级后必须同步更新哈希，否则页面会加载失败。',
  },
  en: {
    pick: 'Choose file',
    dropHint: 'Drop a file here, or click to choose — hashing happens locally, nothing is uploaded',
    text: 'Or paste text content',
    textPh: 'Script or text to host/inline, hashed as UTF-8 bytes',
    sourceFile: 'SRI integrity · source: file',
    sourceText: 'SRI integrity · source: text',
    recommended: 'recommended',
    reset: 'Clear',
    err: 'Failed to read file',
    usage: 'Usage',
    noteTitle: 'Security notes',
    note: '**Security notes**: SRI (Subresource Integrity) makes the browser verify a hash before executing third-party scripts/styles — if a CDN is compromised and the bytes change, the resource is refused. It is the standard defense when referencing external assets. Hashing is entirely local: files and text never leave this machine. Note that integrity is byte-exact — you must regenerate it whenever the asset changes, or the page will fail to load.',
  },
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function SriHashTool() {
  const l = useLocalized(L)
  const [text, setText] = usePersistedState('sri-hash', 'text', '')
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null)
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const onFile = useCallback(
    async (file: File) => {
      setErr(null)
      try {
        const buf = await file.arrayBuffer()
        setFileBytes(new Uint8Array(buf))
        setFileInfo({ name: file.name, size: file.size })
        setText('') // 文件优先：清掉文本，保证结果来源唯一
      } catch {
        setErr(l.err)
      }
    },
    [l.err, setText],
  )

  const results = useMemo<SriResult[] | null>(() => {
    // 文件优先；否则文本按 UTF-8 编码后计算
    const data = fileBytes ?? (text ? new TextEncoder().encode(text) : null)
    return data && data.length > 0 ? sriFromBytes(data) : null
  }, [fileBytes, text])

  const sha384 = results?.find((r) => r.algo === 'sha384')?.integrity

  const reset = useCallback(() => {
    setFileBytes(null)
    setFileInfo(null)
    setText('')
    setErr(null)
  }, [setText])

  return (
    <ToolShell toolId="sri-hash">
      {/* 拖放区：与 filehash 同一套交互（role=button + 键盘可达） */}
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
        className={`rounded-lg border border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
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
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
          }}
        />
      </div>

      <TA
        value={text}
        onChange={(v) => {
          setText(v)
          setFileBytes(null)
          setFileInfo(null)
        }}
        label={l.text}
        placeholder={l.textPh}
        rows={4}
        spellCheck
      />

      <ErrorNote msg={err} />

      {results && (
        <Panel
          title={fileInfo ? l.sourceFile : l.sourceText}
          right={
            <Btn variant="ghost" onClick={reset}>
              {l.reset}
            </Btn>
          }
        >
          {fileInfo && (
            <div className="mb-2">
              <KV k={fileInfo.name} v={fmtSize(fileInfo.size)} />
            </div>
          )}
          <div className="space-y-1.5 mt-2">
            {results.map((r) => {
              const isRecommended = r.algo === 'sha384'
              return (
                <div
                  key={r.algo}
                  className={`flex items-center gap-2 py-1.5 px-1.5 rounded border-b border-line-soft last:border-0 ${
                    isRecommended ? 'bg-phosphor-faint/30' : ''
                  }`}
                >
                  <span
                    className={`shrink-0 font-mono text-[11px] px-1.5 py-0.5 rounded ${
                      isRecommended ? 'text-phosphor bg-phosphor-faint/60' : 'text-muted/80'
                    }`}
                  >
                    {r.algo}
                  </span>
                  <span className="flex-1 min-w-0 font-mono text-[12px] text-bright break-all">
                    {r.integrity}
                  </span>
                  {isRecommended && (
                    <span className="shrink-0 text-[11px] text-phosphor/80 select-none">
                      {l.recommended}
                    </span>
                  )}
                  <CopyBtn text={r.integrity} className="shrink-0" />
                </div>
              )
            })}
          </div>
        </Panel>
      )}

      {sha384 && (
        <Panel title={l.usage}>
          <KV
            k="<script>"
            v={`<script src="https://cdn.example.com/lib.js" integrity="${sha384}" crossorigin="anonymous"></script>`}
          />
        </Panel>
      )}

      <Panel title={l.noteTitle}>{l.note}</Panel>
    </ToolShell>
  )
}
