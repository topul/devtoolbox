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
