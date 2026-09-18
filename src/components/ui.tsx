import React, { useState, useCallback } from 'react'
import { useI18n, COMMON } from '../lib/i18n'

/* ---------- shared primitives ---------- */

export function Panel({ title, children, right, className = '' }: {
  title?: string
  children: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`border border-line bg-panel ${className}`}>
      {title !== undefined && (
        <div className="flex items-center justify-between border-b border-line-soft px-3 py-1.5">
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted select-none">
            <span className="text-phosphor/70">[</span> {title} <span className="text-phosphor/70">]</span>
          </span>
          {right}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  )
}

/**
 * 工具页顶部的「怎么用」引导条。
 *
 * 起因很具体：功能一多，页面就变成一堆面板往下堆，进来的人不知道先看哪、要干什么。
 * 所以每个 AI 工具的开头放一段固定的三步说明 —— 先说做什么，再谈参数。
 */
export function ToolGuide({ title, steps, note }: {
  title: string
  steps: string[]
  note?: string
}) {
  return (
    <div className="border border-phosphor/25 bg-phosphor-faint/30 px-4 py-3 mb-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-phosphor/70 mb-2 select-none">{title}</div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] text-bright leading-relaxed">
            <span className="shrink-0 font-mono text-phosphor/70">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {note && (
        <p className="mt-2.5 pt-2 border-t border-phosphor/15 text-[11.5px] text-amber leading-relaxed">
          <span aria-hidden>⚠ </span>{note}
        </p>
      )}
    </div>
  )
}

/**
 * 可折叠区块：把「参考性内容」收起来，需要时再展开。
 * 默认收起 —— 一屏里能看见的东西越少，越知道重点在哪。
 */
export function Collapse({ title, hint, right, defaultOpen = false, children }: {
  title: string
  hint?: string
  right?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-line bg-panel">
      <div className={`flex items-center gap-2 px-3 py-2 ${open ? 'border-b border-line-soft' : ''}`}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className="text-muted/70 text-[9px] w-2 shrink-0">{open ? '▾' : '▸'}</span>
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted select-none truncate hover:text-bright">
            {title}
          </span>
          {hint && <span className="text-[10px] text-muted/50 shrink-0">{hint}</span>}
        </button>
        {right}
      </div>
      {open && <div className="p-3">{children}</div>}
    </div>
  )
}

export function Btn({ children, onClick, variant = 'default', disabled, className = '', title }: {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  className?: string
  title?: string
}) {
  const base = 'px-3 py-1.5 text-[12px] border transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed '
  const styles = {
    default: 'border-line text-phosphor/90 hover:bg-phosphor-faint hover:border-phosphor/50',
    primary: 'border-phosphor bg-phosphor text-on-phosphor font-semibold hover:bg-phosphor-hover',
    danger: 'border-danger/60 text-danger hover:bg-danger/10',
    ghost: 'border-transparent text-muted hover:text-phosphor hover:border-line',
  }
  return (
    <button className={base + styles[variant] + ' ' + className} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

export function CopyBtn({ text, className = '' }: { text: string; className?: string }) {
  const { locale } = useI18n()
  const c = COMMON[locale]
  const [ok, setOk] = useState(false)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setOk(true)
    setTimeout(() => setOk(false), 1200)
  }, [text])
  return (
    <button
      onClick={copy}
      className={`px-2 py-0.5 text-[11px] border border-line text-muted hover:text-phosphor hover:border-phosphor/50 transition-colors ${className}`}
    >
      {ok ? c.copied : c.copy}
    </button>
  )
}

export function TA({ value, onChange, placeholder, rows = 8, readOnly = false, label }: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  rows?: number
  readOnly?: boolean
  label?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted uppercase tracking-wider">{label}</span>
          {readOnly && value && <CopyBtn text={value} />}
        </div>
      )}
      <textarea
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        readOnly={readOnly}
        spellCheck={false}
        className="w-full resize-y bg-panel-2 border border-line-soft px-2.5 py-2 text-[12.5px] leading-relaxed text-bright placeholder:text-muted/50 focus:border-phosphor/40"
      />
    </div>
  )
}

export function Input({ value, onChange, placeholder, label, type = 'text', className = '' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label?: string
  type?: string
  className?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-[11px] text-muted uppercase tracking-wider">{label}</span>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`w-full bg-panel-2 border border-line-soft px-2.5 py-1.5 text-[12.5px] text-bright placeholder:text-muted/50 focus:border-phosphor/40 ${className}`}
      />
    </div>
  )
}

export function Select({ value, onChange, options, label }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-[11px] text-muted uppercase tracking-wider">{label}</span>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-panel-2 border border-line-soft px-2 py-1.5 text-[12.5px] text-bright focus:border-phosphor/40"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function KV({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-3 py-1 border-b border-line-soft last:border-0">
      <span className="shrink-0 w-40 text-muted text-[12px]">{k}</span>
      <span className={`${mono ? 'break-all' : ''} text-[12.5px] text-bright`}>{v}</span>
    </div>
  )
}

export function ErrorNote({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
      <span className="text-danger/70">[ERR]</span> {msg}
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-line-soft bg-panel-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted">{label}</div>
      <div className="text-lg text-phosphor glow leading-tight">{value}</div>
    </div>
  )
}
