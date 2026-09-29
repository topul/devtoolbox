import React, { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useI18n, COMMON } from '../lib/i18n'

/* ---------- shared primitives ---------- */

/*
 * 基础组件的统一观感：
 * - 圆角 rounded-lg、1px 边框、克制的 hover 底色（不再硬边框直角风）
 * - 交互反馈：hover 变色 + active 轻微下压（scale 0.98），时长走 motion tokens
 * - 焦点可见：focus ring 用 --c-focus（对键盘用户是必需品，不是装饰）
 */

export function Panel({ title, children, right, className = '' }: {
  title?: string
  children: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-lg border border-line bg-panel ${className}`}>
      {title !== undefined && (
        <div className="flex items-center justify-between border-b border-line-soft px-3 py-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted select-none">
            {title}
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
 *
 * 默认收起成一行（标题 + 首步预览），点开才展开完整步骤：
 * 工作区本来就窄，引导是参考信息，不该常驻占一屏。动画复用 collapse-grid
 * （grid-template-rows 0fr→1fr，内容高度未知也能平滑展开）。
 */
export function ToolGuide({ title, steps, note }: {
  title: string
  steps: string[]
  note?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-phosphor/25 bg-phosphor-faint/40 mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-2 text-left"
      >
        <span className={`text-phosphor/70 text-[10px] w-2 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-phosphor/80 select-none shrink-0">{title}</span>
        {!open && <span className="text-[11px] text-muted/60 truncate min-w-0">{steps[0]}</span>}
      </button>
      <div className="collapse-grid" style={{ gridTemplateRows: open ? '1fr' : '0fr' }} aria-hidden={!open}>
        <div>
          <div className="px-4 pb-3">
            <ol className="space-y-1.5">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-bright leading-relaxed">
                  <span className="shrink-0 font-mono text-phosphor/70">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            {note && (
              <p className="mt-2.5 pt-2 border-t border-phosphor/15 text-[12.5px] text-amber leading-relaxed">
                <span aria-hidden>⚠ </span>{note}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 可折叠区块：把「参考性内容」收起来，需要时再展开。
 * 默认收起 —— 一屏里能看见的东西越少，越知道重点在哪。
 *
 * 高度过渡用 grid-template-rows 0fr→1fr：内容高度未知也能做平滑展开，
 * 这是纯 CSS 里唯一不依赖 max-height 魔法数字的方案。
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
    <div className="rounded-lg border border-line bg-panel">
      <div className={`flex items-center gap-2 px-3 py-2 ${open ? 'border-b border-line-soft' : ''}`}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className={`text-muted/70 text-[10px] w-2 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
          <span className="text-[12px] font-medium text-muted select-none truncate hover:text-bright transition-colors">
            {title}
          </span>
          {hint && <span className="text-[11px] text-muted/60 shrink-0">{hint}</span>}
        </button>
        {right}
      </div>
      <div className="collapse-grid" style={{ gridTemplateRows: open ? '1fr' : '0fr' }} aria-hidden={!open}>
        <div>
          <div className="p-3">{children}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * 右侧抽屉。
 *
 * 给「次要功能」用：导入导出、代码生成这类不参与主流程的东西收进抽屉，主界面才有地方
 * 留给主线（发请求 → 看响应）。调用方按需挂载即可，卸载时内部状态自然重置。
 *
 * 动画：进场 overlay 淡入 + 面板右滑入；关闭先播退出动画（Esc/遮罩/×都走 requestClose），
 * 动画结束后才回调 onClose 真正卸载 —— 调用方的条件渲染写法完全不用改。
 *
 * 用 portal 挂到 document.body：工具页在带 `zoom` 的 <main> 里，fixed 定位如果留在
 * 缩放容器内，尺寸会被一起放大（同一个坑曾让对话视图的 100vh 超出视口），挂到 body
 * 才拿得到真实视口。
 */
export function Drawer({ title, onClose, width = 720, children }: {
  title: string
  onClose: () => void
  /** 内容最大宽度（CSS px） */
  width?: number
  children: React.ReactNode
}) {
  const { locale } = useI18n()
  const closeLabel = COMMON[locale].close
  const [closing, setClosing] = useState(false)
  const requestClose = useCallback(() => setClosing(true), [])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(onClose, 170) // 略长于退出动画（150ms），动画播完再卸载
    return () => clearTimeout(t)
  }, [closing, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-40 ${closing ? 'anim-overlay-out' : 'anim-overlay-in'}`}
        style={{ background: 'var(--c-overlay)' }}
        onClick={requestClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
        className={`fixed right-0 top-0 z-50 h-[100dvh] w-full border-l border-line bg-panel flex flex-col shadow-2xl ${
          closing ? 'anim-drawer-out' : 'anim-drawer-in'
        }`}
      >
        <div className="shrink-0 flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <span className="text-[14px] font-semibold text-bright">{title}</span>
          <button
            onClick={requestClose}
            aria-label={closeLabel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-bright transition-colors"
          >×</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
      </aside>
    </>,
    document.body,
  )
}

/**
 * 一串提示行：首行记 ✓，其余记 ·。
 *
 * 抽出来是因为同一个结果要在两处显示 —— 抽屉里（刚操作完）和主界面（抽屉关掉之后）。
 */
export function NoteList({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <div className="rounded-lg border border-phosphor/25 bg-phosphor-faint/40 px-3 py-2 space-y-0.5">
      {lines.map((n, i) => (
        <div key={`${i}-${n}`} className="text-[12.5px] text-bright leading-relaxed">
          <span className="text-phosphor/80">{i === 0 ? '✓ ' : '· '}</span>{n}
        </div>
      ))}
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
  const base = 'px-3 py-1.5 text-[12.5px] rounded-md border transition-all duration-150 select-none disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] '
  const styles = {
    default: 'border-line text-phosphor/90 hover:bg-phosphor-faint hover:border-phosphor/40',
    primary: 'border-phosphor bg-phosphor text-on-phosphor font-semibold hover:bg-phosphor-hover shadow-sm',
    danger: 'border-danger/50 text-danger hover:bg-danger/10',
    ghost: 'border-transparent text-muted hover:text-bright hover:bg-panel-2',
  }
  return (
    <button className={base + styles[variant] + ' ' + className} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

export function CopyBtn({ text, className = '', label }: { text: string; className?: string; label?: string }) {
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
      className={`px-2 py-0.5 text-[11.5px] rounded-md border border-line text-muted hover:text-bright hover:border-line transition-colors ${className}`}
    >
      {ok ? c.copied : (label ?? c.copy)}
    </button>
  )
}

const FIELD_CLS =
  'w-full bg-panel-2 border border-line-soft rounded-md px-2.5 py-2 text-[13px] text-bright placeholder:text-muted/60 focus:border-phosphor/50 transition-colors'

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
          <span className="text-[11.5px] font-medium text-muted uppercase tracking-wider">{label}</span>
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
        className={FIELD_CLS + ' leading-relaxed'}
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
      {label && <span className="text-[11.5px] font-medium text-muted uppercase tracking-wider">{label}</span>}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={FIELD_CLS + ' py-1.5 ' + className}
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
      {label && <span className="text-[11.5px] font-medium text-muted uppercase tracking-wider">{label}</span>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={FIELD_CLS + ' py-1.5 pr-6'}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function KV({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-3 py-1 border-b border-line-soft last:border-0">
      <span className="shrink-0 w-40 text-muted text-[12.5px]">{k}</span>
      <span className={`${mono ? 'font-mono break-all' : ''} text-[13px] text-bright`}>{v}</span>
    </div>
  )
}

export function ErrorNote({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
      {msg}
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line-soft bg-panel-2 px-3 py-2">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="text-lg font-semibold text-phosphor leading-tight">{value}</div>
    </div>
  )
}
