/**
 * 分窗对比布局：递归渲染窗格树（row=左右、col=上下），叶 = 一个模型窗格。
 * 每窗格：头部（模型切换 + 拆分/关闭/停止 + 状态指标）+ 消息体（多轮历史 +
 * 当前流式回复）。用户消息纯文本右对齐，助手回复走 Markdown。
 */
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ErrorNote } from '../ui'
import { ModelMenu } from './Composer'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import { chatpanesL } from '../../lib/locales/chatpanes'
import { profileName } from '../../lib/chat-config'
import type { ModelProfile } from '../../lib/chat-config'
import type { PaneNode, PaneRuntime } from '../../lib/chat-panes'
import type { PaneModeCtl } from './usePaneMode'

/** Markdown 渲染器按需加载（与 MessageView 同一策略），拉取期间纯文本占位 */
const Markdown = lazy(() => import('../Markdown').then((m) => ({ default: m.Markdown })))

type PaneL = (typeof chatpanesL)['zh']

/**
 * 拆分的容量门控：宁可禁用入口也不让窗格溢出成滚动条——
 * 「对比」的前提是同时可见，需要滚动才能看到的窗格没有对比价值。
 * 拆完低于该尺寸就禁用对应方向的拆分按钮，tooltip 引导换方向，
 * 自然把布局导向 2×2 / 3×2 网格；宽屏自动放行更多列。
 */
const MIN_ROW_W = 220
const MIN_COL_H = 190

/**
 * 每片叶子的实际尺寸：树是二叉的且每层 flex-1 等分，
 * 横拆一次宽减半、竖拆一次高减半，从容器尺寸精确递推（gap 忽略）。
 */
function leafDims(
  node: PaneNode,
  w: number,
  h: number,
  out: Map<string, { w: number; h: number }>,
): void {
  if (node.kind === 'leaf') {
    out.set(node.id, { w, h })
    return
  }
  if (node.dir === 'row') {
    leafDims(node.children[0], w / 2, h, out)
    leafDims(node.children[1], w / 2, h, out)
  } else {
    leafDims(node.children[0], w, h / 2, out)
    leafDims(node.children[1], w, h / 2, out)
  }
}

export function PaneView({
  sess,
  profiles,
  ctl,
  onManageModels,
  onAddProfile,
}: {
  sess: { tree: PaneNode; panes: Record<string, PaneRuntime> }
  profiles: ModelProfile[]
  ctl: PaneModeCtl
  onManageModels: () => void
  onAddProfile: () => void
}): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dims = new Map<string, { w: number; h: number }>()
  leafDims(sess.tree, box.w, box.h, dims)

  return (
    <div ref={hostRef} className="flex-1 min-h-0 min-w-0 flex">
      {renderNode(sess.tree, sess.panes, profiles, ctl, dims, onManageModels, onAddProfile)}
    </div>
  )
}

function renderNode(
  node: PaneNode,
  panes: Record<string, PaneRuntime>,
  profiles: ModelProfile[],
  ctl: PaneModeCtl,
  dims: Map<string, { w: number; h: number }>,
  onManageModels: () => void,
  onAddProfile: () => void,
): React.ReactElement {
  if (node.kind === 'split') {
    const dirCls = node.dir === 'row' ? 'flex-row' : 'flex-col'
    return (
      <div className={`flex ${dirCls} flex-1 min-w-0 min-h-0 gap-1`}>
        {renderNode(node.children[0], panes, profiles, ctl, dims, onManageModels, onAddProfile)}
        {renderNode(node.children[1], panes, profiles, ctl, dims, onManageModels, onAddProfile)}
      </div>
    )
  }
  return (
    <PaneLeaf
      paneId={node.id}
      profileId={node.profileId}
      rt={panes[node.id]}
      dim={dims.get(node.id) ?? { w: 0, h: 0 }}
      profiles={profiles}
      ctl={ctl}
      onManageModels={onManageModels}
      onAddProfile={onAddProfile}
    />
  )
}

function PaneLeaf({
  paneId,
  profileId,
  rt,
  dim,
  profiles,
  ctl,
  onManageModels,
  onAddProfile,
}: {
  paneId: string
  profileId: string | null
  rt: PaneRuntime | undefined
  dim: { w: number; h: number }
  profiles: ModelProfile[]
  ctl: PaneModeCtl
  onManageModels: () => void
  onAddProfile: () => void
}): React.ReactElement {
  const l = useLocalized(chatpanesL)
  const menuL = useLocalized(chatL)
  const runtime = rt ?? {
    history: [],
    text: '',
    reasoningChars: 0,
    status: 'idle' as const,
    error: '',
    startedAt: null,
    firstTokenMs: null,
    totalMs: null,
    usage: null,
    activeRequestId: null,
  }
  const profile = profileId ? (profiles.find((p) => p.id === profileId) ?? null) : null
  const inFlight = runtime.status === 'pending' || runtime.status === 'streaming'
  const iconBtn =
    'shrink-0 px-1 text-[12px] text-muted/60 hover:text-phosphor transition-colors disabled:opacity-30 disabled:hover:text-muted/60'
  /*
   * dim 为 0 = 尚未测量（首帧），放行；测得尺寸后拆完会低于阈值就禁用，
   * 避免出现需要滚动才能看到的窗格。窗口事后缩小则弹性挤压，不裁剪。
   */
  const noRoomRow = dim.w > 0 && dim.w / 2 < MIN_ROW_W
  const noRoomCol = dim.h > 0 && dim.h / 2 < MIN_COL_H

  return (
    <section
      aria-label={profile ? profileName(profile) : l.noModel}
      className="flex-1 min-w-0 min-h-0 flex flex-col border border-line-soft bg-panel/40"
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-line-soft bg-panel/70 shrink-0">
        <ModelMenu
          profiles={profiles}
          activeId={profileId ?? ''}
          onPick={(id) => ctl.assign(paneId, id)}
          onManage={onManageModels}
          onAdd={onAddProfile}
          l={menuL}
        />
        <span className="flex-1" />
        {inFlight && (
          <button onClick={() => ctl.stopPane(paneId)} className={iconBtn} title={menuL.stop}>
            ■
          </button>
        )}
        <button
          onClick={() => ctl.split(paneId, 'row')}
          disabled={!ctl.canSplit || noRoomRow}
          className={iconBtn}
          title={noRoomRow ? l.splitNoRoomRow : l.splitRow}
        >
          ⬌
        </button>
        <button
          onClick={() => ctl.split(paneId, 'col')}
          disabled={!ctl.canSplit || noRoomCol}
          className={iconBtn}
          title={noRoomCol ? l.splitNoRoomCol : l.splitCol}
        >
          ⬍
        </button>
        <button onClick={() => ctl.close(paneId)} className={iconBtn} title={l.closePane}>
          ×
        </button>
      </div>

      <div className="px-2 py-0.5 border-b border-line-soft text-[10px] text-muted/70 truncate shrink-0">
        {statusLine(runtime, l)}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {runtime.history.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[88%] rounded-lg px-3 py-2 border border-phosphor/25 bg-phosphor-faint/40">
                <div className="text-[11px] uppercase tracking-wider text-phosphor text-right">
                  {menuL.roleUser}
                </div>
                <div className="text-[12.5px] text-bright whitespace-pre-wrap break-words">
                  {m.content}
                </div>
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-lg px-3 py-2 border border-line-soft bg-panel-2/25">
              <div className="text-[11px] uppercase tracking-wider text-muted">
                {menuL.roleAssistant}
              </div>
              <Suspense
                fallback={
                  <div className="text-[12.5px] text-bright whitespace-pre-wrap break-words">
                    {m.content}
                  </div>
                }
              >
                <Markdown text={m.content} />
              </Suspense>
            </div>
          ),
        )}

        {/* 当前回复：流式中或刚完成；与历史里的 assistant 条不重复（done 才落历史） */}
        {runtime.text !== '' && (
          <div className="rounded-lg px-3 py-2 border border-line-soft bg-panel-2/25">
            <div className="text-[11px] uppercase tracking-wider text-muted">
              {menuL.roleAssistant}
            </div>
            <Suspense
              fallback={
                <div className="text-[12.5px] text-bright whitespace-pre-wrap break-words">
                  {runtime.text}
                </div>
              }
            >
              <Markdown text={runtime.text} />
            </Suspense>
            {inFlight && (
              <span className="inline-block w-1.5 h-3.5 bg-phosphor align-[-2px] ml-0.5 animate-pulse" />
            )}
          </div>
        )}

        {runtime.history.length === 0 && runtime.text === '' && (
          <div className="py-10 text-center">
            <div className="text-phosphor/40 text-xl mb-2">✦</div>
            <p className="text-[11.5px] text-muted leading-relaxed max-w-[320px] mx-auto">
              {profile ? l.hint : l.noModel}
            </p>
          </div>
        )}

        {runtime.status === 'error' && <ErrorNote msg={runtime.error} />}
      </div>
    </section>
  )
}

/** 顶栏「分窗对比」入口按钮（分窗模式激活时由调用方隐藏） */
export function PaneEnterButton({
  onClick,
  label,
}: {
  onClick: () => void
  label: string
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="border border-line-soft px-2 py-1 text-[11.5px] text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors"
      title={label}
    >
      ⬌ {label}
    </button>
  )
}

/** 状态行：在途显示进度词，完成后显示首字/总耗时/tokens */
function statusLine(rt: PaneRuntime, l: PaneL): string {
  switch (rt.status) {
    case 'pending':
      return l.waiting
    case 'streaming':
      return l.streaming
    case 'aborted':
      return rt.totalMs !== null ? `${l.stopped} · ${(rt.totalMs / 1000).toFixed(1)}s` : l.stopped
    case 'error':
      return l.failed
    case 'done': {
      const parts: string[] = []
      if (rt.firstTokenMs !== null) parts.push(`${l.firstLabel} ${(rt.firstTokenMs / 1000).toFixed(1)}s`)
      if (rt.totalMs !== null) parts.push(`${l.totalLabel} ${(rt.totalMs / 1000).toFixed(1)}s`)
      if (rt.usage) parts.push(`${rt.usage.totalTokens.toLocaleString()} ${l.toksLabel}`)
      return parts.join(' · ')
    }
    default:
      return ''
  }
}
