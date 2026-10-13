/**
 * 对话顶栏：会话标题（点击改名，编辑期间标题区变成输入框）、当前模型提示、
 * 通知条、移动端会话入口、设置按钮。
 */
import React from 'react'
import { Btn } from '../ui'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'

export function ChatHeader({
  sessionTitle,
  activeLabel,
  notice,
  hasStore,
  renaming,
  titleDraft,
  onTitleDraft,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onToggleSessions,
  onOpenSettings,
  extra,
}: {
  sessionTitle: string
  /** 「档案名 · 模型名」；无模型时为空串 */
  activeLabel: string
  notice: string
  hasStore: boolean
  renaming: boolean
  titleDraft: string
  onTitleDraft: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  onToggleSessions: () => void
  onOpenSettings: () => void
  /** 顶栏右侧附加按钮（如「分窗对比」入口），插在会话按钮之前 */
  extra?: React.ReactNode
}): React.ReactElement {
  const l = useLocalized(chatL)
  return (
    <header className="flex items-center gap-2 px-4 py-2.5 shrink-0 pt-safe">
      {/* 改名只替换标题本身：模型名、提示、设置键在改名期间保持可见，
          顶栏职责不随编辑状态漂移 */}
      {renaming ? (
        <input
          value={titleDraft}
          onChange={(e) => onTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename()
            if (e.key === 'Escape') onCancelRename()
          }}
          autoFocus
          spellCheck={false}
          className="flex-1 min-w-0 bg-panel rounded-xl shadow-soft-sm px-3 py-1.5 text-[12px] text-bright focus-visible:outline focus-visible:outline-2 focus-visible:outline-phosphor focus-visible:outline-offset-2"
        />
      ) : (
        <button
          onClick={onStartRename}
          className="min-w-0 max-w-[50%] truncate text-left text-[13px] font-semibold text-bright hover:text-phosphor transition-colors !min-h-0"
          title={l.rename}
        >
          {sessionTitle || l.untitledSession}
        </button>
      )}
      {renaming ? (
        <>
          <Btn variant="ghost" onClick={onCommitRename}>
            {l.renameSave}
          </Btn>
          <Btn variant="ghost" onClick={onCancelRename}>
            {l.renameCancel}
          </Btn>
        </>
      ) : (
        <span className="text-[10px] text-muted/60 truncate hidden md:inline">{activeLabel}</span>
      )}
      <span className="flex-1" />
      {extra}
      {notice && (
        <span
          className="hidden md:inline text-[10.5px] text-amber truncate max-w-[40%]"
          title={notice}
        >
          {notice}
        </span>
      )}
      <button
        onClick={onToggleSessions}
        disabled={!hasStore}
        className="lg:hidden rounded-full bg-panel shadow-soft-sm px-3 py-1.5 text-[11px] text-muted hover:text-phosphor transition-colors"
      >
        {l.sessionsTitle}
      </button>
      <button
        onClick={onOpenSettings}
        className="w-8 h-8 rounded-full bg-panel shadow-soft-sm grid place-items-center text-[13px] text-muted hover:text-phosphor transition-colors"
        title={l.settingsTitle}
        aria-label={l.settingsTitle}
      >
        ⚙
      </button>
    </header>
  )
}
