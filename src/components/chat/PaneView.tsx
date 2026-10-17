/**
 * 分窗对比布局：递归渲染窗格树（row=左右、col=上下），叶 = 一个模型窗格。
 * 每窗格：头部（模型切换 + 拆分/全屏/关闭/停止 + 状态指标）+ 消息体（多轮历史 +
 * 当前流式回复）。用户消息纯文本右对齐，助手回复走 Markdown。
 *
 * 工具条图标排布参照 VSCode 编辑器组标题栏：右上角依次是
 * [左右拆分][上下拆分][全屏/还原][关闭]，可以一直拆下去（上限见 MAX_PANES）。
 * 全屏时只渲染被放大的那一叶，其余窗格让位 —— 便于细看单个模型的完整回复。
 * 相邻窗格之间是可拖拽的分隔条，比例随拖随调（视图态，不写进窗格会话）。
 */
import React, { lazy, Suspense, useRef } from 'react'
import { ErrorNote } from '../ui'
import { ModelMenu } from './Composer'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import { chatpanesL } from '../../lib/locales/chatpanes'
import { profileName } from '../../lib/chat-config'
import type { ModelProfile } from '../../lib/chat-config'
import { leafIds, type PaneNode, type PaneRuntime, type SplitDir } from '../../lib/chat-panes'
import {
  CloseIcon,
  MaximizeIcon,
  PaneIconButton,
  RestoreIcon,
  SplitDownIcon,
  SplitRightIcon,
} from './PaneIcons'
import type { PaneModeCtl } from './usePaneMode'

/** Markdown 渲染器按需加载（与 MessageView 同一策略），拉取期间纯文本占位 */
const Markdown = lazy(() => import('../Markdown').then((m) => ({ default: m.Markdown })))

type PaneL = (typeof chatpanesL)['zh']

/** 递归渲染时逐层传递的一组共享参数 */
interface LeafCtx {
  panes: Record<string, PaneRuntime>
  profiles: ModelProfile[]
  ctl: PaneModeCtl
  /** 当前被全屏的叶 id；非空时只有它能出现在界面上 */
  maximizedId: string | null
  onManageModels: () => void
  onAddProfile: () => void
}

/** 按 id 找叶节点（全屏时只渲染这一片） */
function findLeaf(node: PaneNode, id: string): Extract<PaneNode, { kind: 'leaf' }> | null {
  if (node.kind === 'leaf') return node.id === id ? node : null
  return findLeaf(node.children[0], id) ?? findLeaf(node.children[1], id)
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
  // 被全屏的那一片可能已被关闭：失效就回落到整棵树
  const maxId = ctl.maximized && leafIds(sess.tree).includes(ctl.maximized) ? ctl.maximized : null
  const ctx: LeafCtx = {
    panes: sess.panes,
    profiles,
    ctl,
    maximizedId: maxId,
    onManageModels,
    onAddProfile,
  }
  const leaf = maxId ? findLeaf(sess.tree, maxId) : null
  return <div className="flex-1 min-h-0 min-w-0 flex">{renderNode(leaf ?? sess.tree, ctx)}</div>
}

/** 拖动分隔条时两端的比例下限/上限：任一侧都不会被拖到看不见 */
const RATIO_MIN = 0.1
const RATIO_MAX = 0.9

function renderNode(node: PaneNode, ctx: LeafCtx): React.ReactElement {
  if (node.kind === 'split') return <SplitView key={node.id} node={node} ctx={ctx} />
  return (
    <PaneLeaf
      key={node.id}
      paneId={node.id}
      profileId={node.profileId}
      rt={ctx.panes[node.id]}
      profiles={ctx.profiles}
      ctl={ctx.ctl}
      maximized={ctx.maximizedId === node.id}
      onManageModels={ctx.onManageModels}
      onAddProfile={ctx.onAddProfile}
    />
  )
}

/**
 * 一个 split 节点：两片子节点按比例分宽/分高，中间夹一条可拖拽的分隔条。
 * 拖动只改比例（usePaneMode 的视图态），不动窗格树 —— 拆/关窗逻辑保持纯净。
 * 比例用 flexBasis 百分比表达，拖动时按容器实测尺寸换算指针位置。
 */
function SplitView({
  node,
  ctx,
}: {
  node: Extract<PaneNode, { kind: 'split' }>
  ctx: LeafCtx
}): React.ReactElement {
  const boxRef = useRef<HTMLDivElement>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const isRow = node.dir === 'row'
  const ratio = ctx.ctl.ratioOf(node.id)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const box = boxRef.current
    if (!box) return
    rectRef.current = box.getBoundingClientRect()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const rect = rectRef.current
    if (!rect || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const raw = isRow ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height
    const next = Math.min(RATIO_MAX, Math.max(RATIO_MIN, Math.round(raw * 1000) / 1000))
    ctx.ctl.setSplitRatio(node.id, next)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    rectRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div ref={boxRef} className={`flex ${isRow ? 'flex-row' : 'flex-col'} flex-1 min-w-0 min-h-0`}>
      <div
        className="flex min-w-0 min-h-0 overflow-hidden"
        style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}
      >
        {renderNode(node.children[0], ctx)}
      </div>
      <Splitter
        dir={node.dir}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        className="flex min-w-0 min-h-0 overflow-hidden"
        style={{ flexBasis: `${(1 - ratio) * 100}%`, flexGrow: 0, flexShrink: 0 }}
      >
        {renderNode(node.children[1], ctx)}
      </div>
    </div>
  )
}

/** 分隔条：细命中区 + 悬停高亮，左右拆分时是竖条、上下拆分时是横条 */
function Splitter({
  dir,
  ...handlers
}: { dir: SplitDir } & React.ComponentProps<'div'>): React.ReactElement {
  const isRow = dir === 'row'
  return (
    <div
      role="separator"
      aria-orientation={isRow ? 'vertical' : 'horizontal'}
      className={`group shrink-0 touch-none flex items-center justify-center ${
        isRow ? 'w-[7px] cursor-col-resize' : 'h-[7px] cursor-row-resize'
      }`}
      {...handlers}
    >
      <span
        className={`rounded-full bg-line-soft transition-colors group-hover:bg-phosphor/60 ${
          isRow ? 'h-8 w-[2px]' : 'h-[2px] w-8'
        }`}
      />
    </div>
  )
}

function PaneLeaf({
  paneId,
  profileId,
  rt,
  profiles,
  ctl,
  maximized,
  onManageModels,
  onAddProfile,
}: {
  paneId: string
  profileId: string | null
  rt: PaneRuntime | undefined
  profiles: ModelProfile[]
  ctl: PaneModeCtl
  /** 本叶是否正处于全屏态（图标切换为「还原」） */
  maximized: boolean
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

  return (
    <section
      aria-label={profile ? profileName(profile) : l.noModel}
      className="flex-1 min-w-0 min-h-0 flex flex-col border border-line-soft bg-panel/40"
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-line-soft bg-panel/70 shrink-0 min-w-0">
        {/* 模型下拉占满剩余宽度并允许截断；图标按钮 shrink-0 —— 窄窗格时先挤掉模型名，而不是把按钮顶出可视区 */}
        <div className="min-w-0 flex-1">
          <ModelMenu
            profiles={profiles}
            activeId={profileId ?? ''}
            onPick={(id) => ctl.assign(paneId, id)}
            onManage={onManageModels}
            onAdd={onAddProfile}
            l={menuL}
          />
        </div>
        {inFlight && (
          <PaneIconButton
            title={menuL.stop}
            onClick={() => ctl.stopPane(paneId)}
            className="text-[12px]"
          >
            ■
          </PaneIconButton>
        )}
        <PaneIconButton
          title={l.splitRow}
          disabled={!ctl.canSplit}
          onClick={() => ctl.split(paneId, 'row')}
        >
          <SplitRightIcon />
        </PaneIconButton>
        <PaneIconButton
          title={l.splitCol}
          disabled={!ctl.canSplit}
          onClick={() => ctl.split(paneId, 'col')}
        >
          <SplitDownIcon />
        </PaneIconButton>
        <PaneIconButton
          title={maximized ? l.restore : l.maximize}
          onClick={() => ctl.toggleMaximize(paneId)}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </PaneIconButton>
        <PaneIconButton title={l.closePane} onClick={() => ctl.close(paneId)}>
          <CloseIcon />
        </PaneIconButton>
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
      if (rt.firstTokenMs !== null)
        parts.push(`${l.firstLabel} ${(rt.firstTokenMs / 1000).toFixed(1)}s`)
      if (rt.totalMs !== null) parts.push(`${l.totalLabel} ${(rt.totalMs / 1000).toFixed(1)}s`)
      if (rt.usage) parts.push(`${rt.usage.totalTokens.toLocaleString()} ${l.toksLabel}`)
      return parts.join(' · ')
    }
    default:
      return ''
  }
}
