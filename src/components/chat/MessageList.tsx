/**
 * 对话消息流：贴底跟随滚动 + 逐条 MessageView + 发送失败重试条。
 * 渲染细节归这里，chat.tsx 只负责状态编排。
 */
import React, { useEffect, useRef } from 'react'
import { Btn, ErrorNote } from '../ui'
import { MessageView } from './MessageView'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import { messageMeta, type ChatUIMessage } from '../../lib/chat-ui'
import { findPrice, type ModelPrice } from '../../lib/toolkit'

export function MessageList({
  messages,
  busy,
  prices,
  model,
  emptyText,
  sendError,
  onRetry,
  onTrace,
}: {
  messages: ChatUIMessage[]
  busy: boolean
  prices: ModelPrice[]
  model: string
  emptyText: string
  sendError: string
  onRetry: () => Promise<void>
  onTrace: (requestId: string) => void
}): React.ReactElement {
  const l = useLocalized(chatL)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 贴底跟随：只有当前已经在底部附近才自动滚，避免打断向上翻阅
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
      <div className="max-w-[860px] mx-auto space-y-4">
        {messages.length === 0 && (
          <div className="py-16 text-center">
            <div className="text-phosphor/40 text-2xl mb-2">✦</div>
            <p className="text-[12px] text-muted leading-relaxed">{emptyText}</p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView
            key={m.id}
            msg={m}
            live={busy && i === messages.length - 1}
            price={findPrice(messageMeta(m).meta?.model ?? model, prices)}
            onTrace={m.role === 'assistant' ? onTrace : undefined}
          />
        ))}
        {sendError && (
          <div className="space-y-2">
            <ErrorNote msg={sendError} />
            <Btn onClick={() => void onRetry()}>{l.retry}</Btn>
          </div>
        )}
      </div>
    </div>
  )
}
