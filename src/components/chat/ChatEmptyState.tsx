/**
 * 空会话首屏：Kimi 式布局 —— 输入框在视口中央，上方坐着 SVG 小人。
 * 发出第一条消息后 chat.tsx 切换回「消息流 + 底部输入框」的对话布局。
 */
import React from 'react'
import { Greeter } from './Greeter'

export function ChatEmptyState({
  hero,
  children,
}: {
  hero: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-safe">
      <div className="min-h-full flex flex-col items-center justify-center py-8">
        <div className="w-full max-w-[860px] -mt-14 fade-in">
          <Greeter />
          <p className="text-center text-[13.5px] text-dim mb-5">{hero}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
