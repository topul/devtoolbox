/**
 * HTTP 客户端的历史 / 收藏面板。
 *
 * 从 src/tools/httpclient.tsx 拆出的展示组件——过滤、页签切换是面板局部状态，
 * 数据与增删回调全部由主组件传入。
 */
import { useState } from 'react'
import { Btn } from '../ui'
import * as U from '../../lib/http-utils'
import type { Draft, L } from '../../lib/httpclient-model'

export function HistoryPanel({
  history,
  saved,
  saveName,
  setSaveName,
  onLoad,
  onSave,
  onRemoveSaved,
  onClearHistory,
  onDone,
  l,
}: {
  history: Draft[]
  saved: Draft[]
  saveName: string
  setSaveName: (v: string) => void
  onLoad: (d: Draft) => void
  onSave: () => void
  onRemoveSaved: (id: string) => void
  onClearHistory: () => void
  /** 选中某条后回调：调用方据此关掉抽屉，让用户直接看到填好的表单 */
  onDone?: () => void
  l: L
}) {
  const [which, setWhich] = useState<'history' | 'saved'>('history')
  const [filter, setFilter] = useState('')
  const list = (which === 'history' ? history : saved).filter(
    (d) =>
      !filter.trim() || `${d.method} ${d.url}`.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  return (
    <div className="space-y-2">
      {/* 内容在抽屉里，标题由 Drawer 给 —— 这里的页签负责在「历史」与「收藏」之间切 */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setWhich('history')}
          className={`px-2 py-0.5 text-[11px] border ${which === 'history' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}
        >
          {l.history.title} <span className="text-phosphor/60">{history.length}</span>
        </button>
        <button
          onClick={() => setWhich('saved')}
          className={`px-2 py-0.5 text-[11px] border ${which === 'saved' ? 'border-phosphor/60 text-phosphor' : 'border-line-soft text-muted'}`}
        >
          {l.history.saved} <span className="text-phosphor/60">{saved.length}</span>
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={l.history.filter}
          className="flex-1 min-w-[140px] bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
        />
        <input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder={l.history.savePrompt}
          className="w-40 bg-panel-2 border border-line-soft px-2 py-1 text-[12px] text-bright placeholder:text-muted/50 focus:border-phosphor/40"
        />
        <Btn onClick={onSave}>{l.history.save}</Btn>
        {which === 'history' && history.length > 0 && (
          <Btn variant="ghost" onClick={onClearHistory}>
            {l.history.clear}
          </Btn>
        )}
      </div>

      {list.length === 0 && (
        <div className="text-[12px] text-muted">
          {which === 'history' ? l.history.empty : l.history.noSaved}
        </div>
      )}
      {/* 抽屉里高度够，列表跟着放宽，别让人在小窗口里翻 */}
      <div className="max-h-[60vh] overflow-auto divide-y divide-[color:var(--c-line-soft)]">
        {list.map((d) => (
          <div key={d.id} className="flex items-center gap-2 py-1.5 group">
            <button
              onClick={() => {
                onLoad(d)
                onDone?.()
              }}
              className="flex-1 min-w-0 text-left"
            >
              <div className="flex items-center gap-2 text-[11.5px]">
                <span className="shrink-0 text-phosphor w-14">{d.method}</span>
                {d.status != null && (
                  <span className={`shrink-0 ${U.statusColorClass(d.status)}`}>{d.status}</span>
                )}
                {d.durationMs != null && (
                  <span className="shrink-0 text-muted">{U.formatDuration(d.durationMs)}</span>
                )}
                <span className="text-muted shrink-0">{U.formatTime(d.at)}</span>
              </div>
              <div className="text-[11.5px] text-dim truncate">
                {d.name ? `${d.name} — ` : ''}
                {d.url}
              </div>
            </button>
            {which === 'saved' && (
              <button
                onClick={() => onRemoveSaved(d.id)}
                className="shrink-0 text-muted hover:text-danger px-1"
                title={l.history.remove}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
