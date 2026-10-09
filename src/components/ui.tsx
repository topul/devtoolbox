import React, { useState, useCallback, useEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { useI18n, COMMON, useLocalized } from '../lib/i18n'
import { collectFocusable, trapTab, focusFirst } from '../lib/focus'
import { truncationNotice, makeAsyncGuard } from '../lib/interaction'
import {
  loadPersisted,
  savePersisted,
  clearPersisted,
  hasPersisted,
  toolStateKey,
  isSensitiveField,
} from '../lib/persist'
import { exampleFor } from '../lib/examples'
import { guideL, GUIDE_FOR_TOOL, type GuideEntry, type GuideKey } from '../lib/locales/guide'

/* ---------- shared primitives ---------- */

/*
 * 基础组件的统一观感：
 * - 圆角 rounded-lg、1px 边框、克制的 hover 底色（不再硬边框直角风）
 * - 交互反馈：hover 变色 + active 轻微下压（scale 0.98），时长走 motion tokens
 * - 焦点可见：focus ring 用 --c-focus（对键盘用户是必需品，不是装饰）
 */

export function Panel({
  title,
  children,
  right,
  className = '',
}: {
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
 * 折叠态属性：`aria-hidden` + `inert` 一起给。
 *
 * 只给 aria-hidden 是不够的 —— 它只影响读屏，**挡不住键盘焦点**，
 * 于是折叠起来的参考内容里那些按钮仍能被 Tab 到：用户按着 Tab 焦点「消失」了，
 * 屏幕上看不到焦点在哪。这是评审里的 P0 项。
 *
 * `inert` 是浏览器原生属性（Chromium 102+/Safari 15.5+），一个属性同时解决
 * 焦点、点击与读屏三件事。React 19 起 inert 是一等 boolean 属性（true 渲染为
 * `inert=""`），旧浏览器不支持时会被当成未知属性忽略，此时退化回
 * 「只有 aria-hidden」—— 不比原来差。
 */
const COLLAPSED_PROPS = { 'aria-hidden': true, inert: true } as const
const EXPANDED_PROPS = { 'aria-hidden': false } as const

/**
 * 带本地持久化的 state —— 工具页的输入态不该因为切页而丢。
 *
 * 用法：`const [input, setInput] = usePersistedState('base64', 'input', '')`
 *
 * 语义与useState 一致，额外多一个 `persisted` 标记：
 * 写失败（隐私模式 / 内容超长）时它是 false，页面可以据此提示
 * 「本次输入不会被保留」—— 静默失败才是最坏的体验。
 *
 * **敏感字段自动走 sessionStorage**：field 命中 `SENSITIVE_FIELDS`（token/key/secret/
 * password…）时不进 localStorage，改用会话级存储 —— 切页仍保留，关闭应用即清空。
 * 不想让某个字段落盘时传 `sensitive: true` 强制开启。
 */
export function usePersistedState<T>(
  toolId: string,
  field: string,
  initial: T,
  opts: { sensitive?: boolean } = {},
): [
  T,
  (v: T | ((prev: T) => T)) => void,
  { persisted: boolean; clear: () => void; restorable: boolean },
] {
  const key = toolStateKey(toolId, field)
  const sensitive = opts.sensitive ?? isSensitiveField(toolId, field)
  const [value, setValue] = useState<T>(() => loadPersisted(key, initial, { sensitive }))
  const [persisted, setPersisted] = useState(true)
  // 首次挂载时 key 对应的存储里没有内容 → 提示「可以恢复上次输入」是假的
  const [restorable] = useState(() => hasPersisted(key, { sensitive }))

  const update = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        setPersisted(savePersisted(key, next, { sensitive }))
        return next
      })
    },
    [key, sensitive],
  )

  const clear = useCallback(() => {
    clearPersisted(key, { sensitive })
    setValue(initial)
    setPersisted(true)
    // initial 进了闭包：这行只依赖 key 的变化，工具页里 key 是常量
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sensitive])

  return [value, update, { persisted, clear, restorable }]
}

/**
 * 「示例」按钮条 —— 工具页空状态下的第一根救命稻草。
 *
 * 评审发现 65 个工具里**一处示例/试用按钮都没有**，空文本框摆在那儿，
 * 不知道该粘什么、点了会出什么是最大的使用障碍。给一行可点的样例，
 * 让「看一眼会发生什么」的成本降到一次点击。
 *
 * 示例值来自 lib/examples.ts（与界面无关的纯数据），双语标签由调用方传入。
 */
export function ExampleBar({
  sample,
  onPick,
  label,
}: {
  sample: string
  onPick: (v: string) => void
  label: string
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11.5px] text-muted">
      <span className="shrink-0">{label}</span>
      <button
        onClick={() => onPick(sample)}
        title={sample}
        className="max-w-full truncate rounded border border-line-soft bg-panel-2 px-2 py-1 font-mono text-[11.5px] text-phosphor/90 hover:border-phosphor/40 hover:bg-phosphor-faint transition-colors"
      >
        {sample}
      </button>
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
export function ToolGuide({
  title,
  steps,
  note,
}: {
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
        <span
          className={`text-phosphor/70 text-[10px] w-2 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-phosphor/80 select-none shrink-0">
          {title}
        </span>
        {!open && <span className="text-[11px] text-muted/60 truncate min-w-0">{steps[0]}</span>}
      </button>
      <div
        className="collapse-grid"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        {...(open ? EXPANDED_PROPS : COLLAPSED_PROPS)}
      >
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
                <span aria-hidden>⚠ </span>
                {note}
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
export function Collapse({
  title,
  hint,
  right,
  defaultOpen = false,
  children,
}: {
  title: string
  hint?: string
  right?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border border-line bg-panel">
      <div
        className={`flex items-center gap-2 px-3 py-2 ${open ? 'border-b border-line-soft' : ''}`}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span
            className={`text-muted/70 text-[10px] w-2 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          <span className="text-[12px] font-medium text-muted select-none truncate hover:text-bright transition-colors">
            {title}
          </span>
          {hint && <span className="text-[11px] text-muted/60 shrink-0">{hint}</span>}
        </button>
        {right}
      </div>
      <div
        className="collapse-grid"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        {...(open ? EXPANDED_PROPS : COLLAPSED_PROPS)}
      >
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
export function Drawer({
  title,
  onClose,
  width = 720,
  children,
}: {
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
  const panelRef = useRef<HTMLElement | null>(null)
  // 打开抽屉时页面还停在原处，关掉必须把焦点还回去 —— 否则键盘用户被留在
  // 一个已经消失的元素上，只能靠鼠标重新摸路（这是评审里的 P0）
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(onClose, 170) // 略长于退出动画（150ms），动画播完再卸载
    return () => clearTimeout(t)
  }, [closing, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        requestClose()
        return
      }
      if (e.key !== 'Tab') return
      // 焦点环绕：不拦的话 Tab 走出抽屉外，抽屉还开着人却已经不在里面了
      const panel = panelRef.current
      if (!panel) return
      const items = collectFocusable(panel)
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      if (trapTab(panel, e.shiftKey ? 'backward' : 'forward')) {
        e.preventDefault()
      } else if (!panel.contains(document.activeElement)) {
        // 焦点还没进来（刚打开 / 被点到背景）：主动放进第一个可聚焦元素
        e.preventDefault()
        items[0].focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  // 打开时接管焦点 + 锁背景滚动；卸载时把焦点还给触发元素
  useEffect(() => {
    const prevFocus =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    restoreRef.current = prevFocus
    focusFirst(panelRef.current)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      // 触发元素可能已经卸载（比如按钮所在的面板被换掉了）。
      // isConnected 检查：焦点落在已卸载的元素上会静默失败，用户的焦点就掉回 body，
      // 下一次 Tab 从页首重新开始 —— 那样比不还焦点更糟。
      const back = restoreRef.current
      if (back?.isConnected) back.focus()
    }
  }, [])

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-40 ${closing ? 'anim-overlay-out' : 'anim-overlay-in'}`}
        style={{ background: 'var(--c-overlay)' }}
        onClick={requestClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ maxWidth: width }}
        className={`fixed right-0 top-0 z-50 h-[100dvh] w-full border-l border-line bg-panel flex flex-col shadow-2xl focus:outline-none ${
          closing ? 'anim-drawer-out' : 'anim-drawer-in'
        }`}
      >
        <div className="shrink-0 flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <span className="text-[14px] font-semibold text-bright">{title}</span>
          <button
            onClick={requestClose}
            aria-label={closeLabel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-bright transition-colors"
          >
            ×
          </button>
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
          <span className="text-phosphor/80">{i === 0 ? '✓ ' : '· '}</span>
          {n}
        </div>
      ))}
    </div>
  )
}

/* ================= 结果区 / 确认 / 异步：三件套 ================= */

/**
 * 结果区的统一形态：**自带复制入口 + 高度上限 + 空状态引导 + 截断告知**。
 *
 * 为什么不直接用 Panel：Panel 只给了标题和右上角槽位，「有没有复制」「有没有限高」
 * 全靠每个调用方自觉 —— 于是 7 处结果（diff、正则命中、端口表、状态码表、CSV 预览…）
 * 一个复制入口都没有，而 Base64 页的输出框右上角就挂着一个。用户凭什么知道这两个页面不一样。
 *
 * 三种形态：
 *   - `text`：纯文本结果（最常见）
 *   - `rows`：表格类结果，配`total` 时自动显示截断提示
 *   - 都不传：自定义 children（比如哈希那种一行一个卡片）
 */
export function ResultPanel({
  title,
  text,
  rows,
  total,
  emptyHint,
  maxHeight = 320,
  children,
}: {
  title?: string
  /** 纯文本结果；给了就自动挂复制入口 */
  text?: string
  /** 表格类结果 */
  rows?: readonly string[]
  /** 真实总条数；给了且大于 rows.length 就显示截断提示 */
  total?: number
  /** 空状态引导文案（默认「结果会显示在这里」） */
  emptyHint?: string
  /** 内容区最大高度，默认 320px */
  maxHeight?: number
  children?: React.ReactNode
}) {
  const c = COMMON[useI18n().locale]
  const hasText = typeof text === 'string' && text.length > 0
  const hasRows = Array.isArray(rows)
  const isEmpty = !hasText && !hasRows && !children

  // 截断必须告知：静默slice(0,20) 会让用户以为输入只有 20 行
  const shown = hasRows ? rows!.length : 0
  const notice = hasRows && typeof total === 'number' ? truncationNotice(shown, total) : null

  return (
    <Panel title={title} right={hasText ? <CopyBtn text={text!} /> : undefined}>
      {isEmpty ? (
        <p className="text-[12px] text-muted py-2">{emptyHint ?? c.emptyResult}</p>
      ) : (
        <>
          {hasRows && (
            <div className="overflow-auto" style={{ maxHeight }}>
              <table className="w-full text-[12px] border-collapse">
                <tbody>
                  {rows!.map((r, i) => (
                    <tr key={i} className="border-b border-line-soft last:border-0">
                      <td className="py-1 pr-3 align-top font-mono break-all whitespace-pre-wrap">
                        {r}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hasText && (
            <pre
              className="codeblock text-[12px] overflow-auto whitespace-pre-wrap break-all p-0 m-0"
              style={{ maxHeight }}
            >
              {text}
            </pre>
          )}
          {children}
          {notice && <p className="text-[11px] text-muted mt-2">{c.showingOf(shown, total!)}</p>}
        </>
      )}
    </Panel>
  )
}

/**
 * 危险操作的行内二次确认。
 *
 * 不用 window.confirm：它与整套自绘风格割裂，而且项目里已经同时存在
 * 「行内确认」和「原生弹窗」两种做法（proxy.tsx 一个文件内就有），
 * 用户在同一个界面里要建立两套肌肉记忆 —— 每次都要重新判断
 * 「这个操作到底会不会丢数据」。
 *
 * 用法：`<ConfirmButton label="清空" onConfirm={...} />`
 * 第一次点只进入待确认态，第二次才真正执行；点取消或等 3 秒自动退回。
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  cancelLabel,
  variant = 'ghost',
  className = '',
  disabled,
}: {
  label: string
  /** 待确认态下主按钮的文案；不传用 label + COMMON.confirm */
  confirmLabel?: string
  onConfirm: () => void
  cancelLabel?: string
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  className?: string
  /** 外部禁用（如 CA 生成进行中）。已armed 时也要能退回，不能让用户卡在确认态 */
  disabled?: boolean
}) {
  const c = COMMON[useI18n().locale]
  const [armed, setArmed] = useState(false)
  // 3 秒不用就退回：否则用户忘了刚才点了什么，下次进来是个"确认"按钮
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  // 被外部禁用时立刻撤掉待确认态，否则按钮会一直停在「确认删除」上
  useEffect(() => {
    if (disabled && armed) setArmed(false)
  }, [disabled, armed])

  if (!armed) {
    return (
      <Btn
        variant={variant}
        className={className}
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {label}
      </Btn>
    )
  }
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <Btn
        variant="danger"
        aria-label={confirmLabel ?? label}
        // 「再点一次确认」是唯一的反馈来源，必须播报
        aria-live="polite"
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        {confirmLabel ?? `${label} · ${c.confirm}`}
      </Btn>
      <Btn variant="ghost" onClick={() => setArmed(false)}>
        {cancelLabel ?? c.cancel}
      </Btn>
    </div>
  )
}

/**
 * 异步动作的统一 busy 管理：**进入时防重入，结束时保证清 busy**。
 *
 * 两个坑各自都踩过：
 *   - 不防重入：CA 证书面板 4 个按钮都没有 disabled，连点就并发触发 caReset + caExport 竞态
 *   - 忘了清 busy：按钮永久禁用到刷新页面，用户只能重启应用
 *
 * `run` 返回值约定：返回 false 表示被守卫拒绝（busy 中重复触发），调用方不要再改状态。
 */
export function useAsyncAction<A extends unknown[]>(
  fn: (...args: A) => Promise<void> | void,
): {
  busy: boolean
  run: (...args: A) => Promise<boolean>
} {
  const [busy, setBusy] = useState(false)
  const guard = makeAsyncGuard(() => busy)
  const run = useCallback(
    async (...args: A): Promise<boolean> => {
      if (!guard.enter()) return false
      setBusy(true)
      try {
        await fn(...args)
        return true
      } finally {
        setBusy(false) // 必须在 finally：catch 里漏清就会永久禁用
      }
    },
    [fn],
  )
  return { busy, run }
}

/** 按钮的 aria-* / data-* 透传口：图标按钮需要可读名称，纯文字按钮不需要 */
type BtnAria = {
  'aria-label'?: string
  'aria-pressed'?: boolean
  'aria-expanded'?: boolean
  'aria-current'?: boolean | 'page'
  'aria-describedby'?: string
  'data-testid'?: string
}

export function Btn({
  children,
  onClick,
  variant = 'default',
  disabled,
  className = '',
  title,
  ...aria
}: BtnAria & {
  children: React.ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  className?: string
  title?: string
}) {
  const base =
    'px-3 py-1.5 text-[12.5px] rounded-md border transition-all duration-150 select-none disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] '
  const styles = {
    default: 'border-line text-phosphor/90 hover:bg-phosphor-faint hover:border-phosphor/40',
    primary:
      'border-phosphor bg-phosphor text-on-phosphor font-semibold hover:bg-phosphor-hover shadow-sm',
    danger: 'border-danger/50 text-danger hover:bg-danger/10',
    ghost: 'border-transparent text-muted hover:text-bright hover:bg-panel-2',
  }
  return (
    <button
      // 显式 type="button"：默认 type 是 submit，落在 <form> 里会误触提交
      type="button"
      className={base + styles[variant] + ' ' + className}
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...aria}
    >
      {children}
    </button>
  )
}

export function CopyBtn({
  text,
  className = '',
  label,
}: {
  text: string
  className?: string
  label?: string
}) {
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
      type="button"
      onClick={copy}
      // 复制结果只体现在按钮文字上，1.2 秒后消失 —— 不播报的话读屏用户完全不知道成功没有
      aria-live="polite"
      // 文字已经是「复制」，但显式标签让读屏在按钮上下文里也能定位它
      aria-label={label ?? c.copy}
      className={`px-2 py-0.5 text-[11.5px] rounded-md border border-line text-muted hover:text-bright hover:border-line transition-colors ${className}`}
    >
      {ok ? c.copied : (label ?? c.copy)}
    </button>
  )
}

const FIELD_CLS =
  // placeholder 用muted 全色：带透明度叠加后只有 2.2:1，低视力用户几乎看不出占位提示
  'w-full bg-panel-2 border border-line-soft rounded-md px-2.5 py-2 text-[13px] text-bright placeholder:text-muted/90 focus:border-phosphor/50 transition-colors'

/** 表单控件的 aria 透传口：label 之外的补充说明（校验错误、密码管理器提示等） */
type FieldAria = {
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export function TA({
  value,
  onChange,
  placeholder,
  rows = 8,
  readOnly = false,
  label,
  labelRight,
  toolInput,
  spellCheck = false,
  ...aria
}: FieldAria & {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  rows?: number
  readOnly?: boolean
  label?: string
  /** 代码/SQL/GraphQL 这类内容要关掉拼写检查（红波浪线满屏很难看） */
  spellCheck?: boolean
  /** label 行右侧的槽位（「清空」这类动作放这里，与 label 同行、不会因 items-end 对不齐而漂浮） */
  labelRight?: React.ReactNode
  /** 标记为工具的主输入框：示例条会把示例值填到这里（页面上第一个） */
  toolInput?: boolean
}) {
  // label 与控件的编程关联：光有可见文字不够，读屏要能拿到「这个框是干什么的」。
  // useId 保证同页多个同类控件的 id 不重复，label 不会指错字段。
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={id}
            className="text-[11.5px] font-medium text-muted uppercase tracking-wider"
          >
            {label}
          </label>
          <div className="flex items-center gap-1.5">
            {readOnly && value && <CopyBtn text={value} />}
            {labelRight}
          </div>
        </div>
      )}
      {labelRight && !label && <div className="flex justify-end">{labelRight}</div>}
      <textarea
        id={id}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        readOnly={readOnly}
        spellCheck={spellCheck}
        data-tool-input={toolInput ? '' : undefined}
        className={FIELD_CLS + ' leading-relaxed'}
      />
    </div>
  )
}

export function Input({
  value,
  onChange,
  placeholder,
  label,
  type = 'text',
  className = '',
  toolInput,
  ...aria
}: FieldAria & {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label?: string
  type?: string
  className?: string
  /** 标记为工具的主输入框：示例条会把示例值填到这里（页面上第一个） */
  toolInput?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={id}
          className="text-[11.5px] font-medium text-muted uppercase tracking-wider"
        >
          {label}
        </label>
      )}
      <input
        id={id}
        type={type}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        data-tool-input={toolInput ? '' : undefined}
        className={FIELD_CLS + ' py-1.5 ' + className}
      />
    </div>
  )
}

export function Select({
  value,
  onChange,
  options,
  label,
  ...aria
}: FieldAria & {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={id}
          className="text-[11.5px] font-medium text-muted uppercase tracking-wider"
        >
          {label}
        </label>
      )}
      <select
        id={id}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_CLS + ' py-1.5 pr-6'}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
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
    // role=alert：错误是「 assertive」级别，读屏要立刻打断当前朗读
    <div
      role="alert"
      className="rounded-lg border border-danger/35 bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
    >
      {msg}
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line-soft bg-panel-2 px-3 py-2">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      <div className="text-lg font-semibold text-phosphor leading-tight">{value}</div>
    </div>
  )
}

/* ================= 工具页外壳 ================= */

/**
 * 工具页的统一外壳：把「上手三件事」收在一处，逐页不再各写一遍。
 *
 * 背景：评审发现 65 个工具里 ToolGuide只覆盖 5 个、示例按钮 0 处、⌘↵ 只有
 * http-client 有。这三件事对**每一个**工具都是成立的（引导、示例、键盘提交），
 * 所以做成外壳而不是逐页复制 —— 复制 60 遍等于欠60 份技术债。
 *
 * 用法：
 * ```tsx
 * export function Base64Tool() {
 *   const [input, setInput] = usePersistedState('base64', 'input', '')
 *   return (
 *     <ToolShell toolId="base64" title="怎么用" steps={[...]} onSubmit={() => run('enc')}>
 *       ...原内容...
 *     </ToolShell>
 *   )
 * }
 * ```
 *
 * 三件事都是**可选**的：没传 steps 就不渲染引导条，没传 onSubmit 就不监听 ⌘↵，
 * 示例表里没这个工具也不显示示例行。
 */
export function ToolShell({
  toolId,
  guide,
  note,
  onSubmit,
  children,
}: {
  /** 语言中立的工具 id，用于查示例表与引导词条 */
  toolId: string
  /** 覆盖自动推导的引导词条键；一般不用传 */
  guide?: GuideKey
  /** 引导里的注意事项（覆盖词条里的 note） */
  note?: string
  /** ⌘↵ / Ctrl+↵ 的动作；不传则不监听 */
  onSubmit?: () => void
  children: React.ReactNode
}) {
  const dict = useLocalized(guideL)
  // 索引签名让 TS 只能给出联合类型，这里显式收窄成引导条目（shell 不该被当成引导）
  const key = guide ?? GUIDE_FOR_TOOL[toolId]
  const text: GuideEntry | undefined = key ? (dict[key] as GuideEntry) : undefined
  const ex = exampleFor(toolId)

  // ⌘↵ 提交：只在传了 onSubmit 时注册，避免每个工具都被绑一个空快捷键
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
  useEffect(() => {
    if (!onSubmit) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        submitRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSubmit])

  return (
    <div className="space-y-3">
      {text && <ToolGuide title={dict.shell.title} steps={text.steps} note={note ?? text.note} />}
      {ex && (
        <ExampleBar
          sample={ex.sample}
          label={dict.shell.exampleLabel}
          onPick={() => {
            // 示例点了要真的能用：把它填进页面里第一个可编辑的 textarea/input
            const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
              'textarea[data-tool-input], input[data-tool-input]',
            )
            if (!el) return
            // React 受控输入：直接改 value 不会被它知道，得走原生 setter 再派发 input
            const proto =
              el instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
            setter?.call(el, ex.sample)
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.focus()
          }}
        />
      )}
      {children}
      {onSubmit && text && (
        <div className="text-right text-[11px] text-muted/70 select-none">
          <kbd className="rounded border border-line px-1 py-0.5 font-mono">
            {IS_MAC_HINT ? '⌘↵' : 'Ctrl ↵'}
          </kbd>{' '}
          {text.submit}
        </div>
      )}
    </div>
  )
}

/** 平台相关的快捷键文案（Mac 显示 ⌘，其他显示 Ctrl） */
const IS_MAC_HINT =
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)

/**
 * 持久化状态不可用时的统一提示。
 *
 * 静默失败是最坏的体验：用户粘了一大段、切个页面回来没了，只会觉得是工具坏了。
 * 把「写不进去」明确说出来，用户才知道自己的输入不会被保留。
 */
export function PersistHint({ persisted }: { persisted: boolean }) {
  const { locale } = useI18n()
  if (persisted) return null
  return (
    <div
      role="status"
      className="rounded-lg border border-amber/35 bg-amber/10 px-3 py-2 text-[12px] text-amber"
    >
      {locale === 'zh'
        ? '当前环境无法保存输入（隐私模式或内容过大），本次输入在切换页面后会丢失'
        : 'Input cannot be saved here (private mode or content too large); it will be lost when you switch pages'}
    </div>
  )
}
