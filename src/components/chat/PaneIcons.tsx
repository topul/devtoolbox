/**
 * 对话窗格工具条的图标（VSCode 编辑器组标题栏同款交互）。
 *
 * 项目里没有图标库，统一用内联 SVG：尺寸固定 14px、描边走 currentColor，
 * 颜色与悬停完全交给外层按钮的 text-* 类，不引入额外依赖。
 * 语义：左右拆分、上下拆分、全屏显示、还原、关闭。
 */
import React from 'react'

/** 所有图标共用的画笔：14px 见方、1.3 描边、圆头圆角 */
const ICON = {
  viewBox: '0 0 16 16',
  width: 14,
  height: 14,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** 左右拆分：外框 + 中竖线，示意新窗格开在右侧 */
export function SplitRightIcon(): React.ReactElement {
  return (
    <svg {...ICON} aria-hidden>
      <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6" />
      <path d="M8 2.6v10.8" />
    </svg>
  )
}

/** 上下拆分：外框 + 中横线，示意新窗格开在下方 */
export function SplitDownIcon(): React.ReactElement {
  return (
    <svg {...ICON} aria-hidden>
      <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6" />
      <path d="M1.6 8h12.8" />
    </svg>
  )
}

/** 全屏显示：四角向外展开 */
export function MaximizeIcon(): React.ReactElement {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M6 2H2v4" />
      <path d="M10 2h4v4" />
      <path d="M2 10v4h4" />
      <path d="M14 10v4h-4" />
    </svg>
  )
}

/** 还原窗格：四角向内收拢 */
export function RestoreIcon(): React.ReactElement {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M2 6h4V2" />
      <path d="M14 6h-4V2" />
      <path d="M2 10h4v4" />
      <path d="M14 10h-4v4" />
    </svg>
  )
}

/** 关闭窗格：交叉线 */
export function CloseIcon(): React.ReactElement {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M4.5 4.5l7 7" />
      <path d="M11.5 4.5l-7 7" />
    </svg>
  )
}

/**
 * 窗格工具条上的图标按钮：6×6 命中区、悬停变色。
 * 禁用时保留可见性但不可点（拆分已到上限时用它表达，而不是把按钮藏起来）。
 */
export function PaneIconButton({
  title,
  onClick,
  disabled = false,
  className = '',
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`shrink-0 grid h-6 w-6 place-items-center rounded-md text-muted/70 transition-colors hover:bg-phosphor-faint hover:text-phosphor disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted/70 ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * 单窗对话顶栏的拆分入口：两个图标按钮，与 VSCode 编辑器组标题栏一致。
 * 点击即进入分窗模式，并把新窗格开在对应方向；之后每个窗格头部各自带拆分键。
 */
export function SplitEntryButtons({
  onSplitRight,
  onSplitDown,
  titleRight,
  titleDown,
}: {
  onSplitRight: () => void
  onSplitDown: () => void
  titleRight: string
  titleDown: string
}): React.ReactElement {
  return (
    <div className="flex items-center gap-0.5">
      <PaneIconButton title={titleRight} onClick={onSplitRight}>
        <SplitRightIcon />
      </PaneIconButton>
      <PaneIconButton title={titleDown} onClick={onSplitDown}>
        <SplitDownIcon />
      </PaneIconButton>
    </div>
  )
}
