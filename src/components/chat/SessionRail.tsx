/**
 * 会话侧栏（桌面常驻 rail）与移动端会话列表（顶栏抽屉式展开）。
 * 行结构「主按钮 + 行内操作」双端一致：窄屏没有 hover，管理操作必须点得到。
 */
import React from 'react'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import type { ChatSessionMeta } from '../../lib/chatstore-types'

export interface SessionRailProps {
  sessions: ChatSessionMeta[]
  currentId: string
  currentTitle: string
  busy: boolean
  storePath: string
  confirmDel: boolean
  onConfirmDel: (v: boolean) => void
  onNew: () => void
  onSwitch: (id: string) => void
  onStartRename: (title: string) => void
  onRemove: (id: string) => void
}

export function SessionRail(p: SessionRailProps): React.ReactElement {
  const l = useLocalized(chatL)
  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 lg:h-screen px-3 py-3">
      <button
        onClick={p.onNew}
        disabled={p.busy}
        className="btn-grad rounded-full px-3 py-2.5 text-[12.5px] font-semibold"
      >
        ＋ {l.newSession}
      </button>
      <div className="mt-3 flex-1 overflow-y-auto space-y-1 pb-2">
        {p.sessions.length === 0 && (
          <div className="px-2 py-4 text-[11px] text-muted leading-relaxed">{l.emptySessions}</div>
        )}
        {p.sessions.map((sess) => (
          <div
            key={sess.id}
            className={`group flex items-center gap-1 rounded-xl ${sess.id === p.currentId ? 'bg-panel shadow-soft-sm' : 'hover:bg-panel/60'}`}
          >
            <button
              onClick={() => p.onSwitch(sess.id)}
              disabled={p.busy}
              className={`flex-1 min-w-0 text-left px-3 py-2 text-[12.5px] truncate ${sess.id === p.currentId ? 'text-bright font-medium' : 'text-muted hover:text-bright'}`}
              title={sess.title || l.untitledSession}
            >
              {sess.title || l.untitledSession}
              <span className="ml-1.5 text-[9.5px] text-muted/50">{sess.turnCount}</span>
            </button>
            {/* 管理操作常驻可见（不再 hover 才出现）：触屏点得到，删错也有二次确认兜底 */}
            {sess.id === p.currentId && (
              <button
                onClick={() => p.onStartRename(sess.title)}
                title={l.rename}
                aria-label={l.rename}
                className="shrink-0 text-muted/50 hover:text-phosphor text-[11px] px-0.5"
              >
                ✎
              </button>
            )}
            <button
              onClick={() => {
                if (sess.id === p.currentId) {
                  if (p.confirmDel) p.onRemove(sess.id)
                  else p.onConfirmDel(true)
                } else p.onRemove(sess.id)
              }}
              title={p.confirmDel && sess.id === p.currentId ? l.confirmDelete : l.deleteSession}
              aria-label={l.deleteSession}
              className={`shrink-0 text-[12px] px-1.5 ${p.confirmDel && sess.id === p.currentId ? 'text-danger' : 'text-muted/50 hover:text-danger'}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {/* 存储位置从常驻文字降级为 ⓘ 悬浮提示：这一行信息价值低，不该常驻占位 */}
      <div className="px-2.5 py-1.5">
        <span
          className="cursor-help text-[10px] text-muted/40 hover:text-muted"
          title={`${l.savedHint}${p.storePath ? ` · ${p.storePath}` : ''}`}
        >
          ⓘ
        </span>
      </div>
    </aside>
  )
}

/** 移动端会话列表：顶栏按钮展开，结构与 rail 行保持一致 */
export function MobileSessionList(p: SessionRailProps): React.ReactElement {
  const l = useLocalized(chatL)
  return (
    <div className="lg:hidden border-b border-line-soft max-h-[40vh] overflow-auto">
      <button
        onClick={p.onNew}
        className="w-full text-left px-3 py-2 text-[12px] text-phosphor border-b border-line-soft"
      >
        + {l.newSession}
      </button>
      {p.sessions.length === 0 && (
        <div className="px-3 py-3 text-[11.5px] text-muted">{l.emptySessions}</div>
      )}
      {p.sessions.map((sess) => (
        <div
          key={sess.id}
          className={`flex items-stretch border-b border-line-soft last:border-0 ${sess.id === p.currentId ? 'bg-phosphor-faint' : ''}`}
        >
          <button
            onClick={() => p.onSwitch(sess.id)}
            className="flex-1 min-w-0 text-left px-3 py-2 text-[12px]"
          >
            <div
              className={`truncate ${sess.id === p.currentId ? 'text-phosphor' : 'text-bright'}`}
            >
              {sess.title || l.untitledSession}
            </div>
            <div className="text-[10px] text-muted">
              {l.msgCount(sess.turnCount)} · {new Date(sess.updatedAt).toLocaleString()}
            </div>
          </button>
          {sess.id === p.currentId && (
            <button
              onClick={() => p.onStartRename(sess.title)}
              aria-label={l.rename}
              title={l.rename}
              className="shrink-0 px-2.5 flex items-center text-muted/70 hover:text-phosphor text-[13px]"
            >
              ✎
            </button>
          )}
          <button
            onClick={() => {
              if (sess.id === p.currentId) {
                if (p.confirmDel) p.onRemove(sess.id)
                else p.onConfirmDel(true)
              } else p.onRemove(sess.id)
            }}
            aria-label={l.deleteSession}
            title={p.confirmDel && sess.id === p.currentId ? l.confirmDelete : l.deleteSession}
            className={`shrink-0 px-3 flex items-center text-[14px] ${p.confirmDel && sess.id === p.currentId ? 'text-danger' : 'text-muted/70 hover:text-danger'}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
