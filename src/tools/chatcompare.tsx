/**
 * 多模型对比 —— 同一问题 fan-out 给 N 个模型档案，回复并排平铺。
 *
 * 与主对话页（chat.tsx）的关系：完全独立的一条链路 —— 不用 useChat、不读写会话存储，
 * 事件按 requestId 归组（chat-compare.ts），依赖主进程的多路复用（chat-ipc 按并发流管理）。
 * 对比走纯文本路径：不带工具与系统提示，保证列间唯一变量是模型本身。
 *
 * 即用即走：对比结果不持久化 —— 评测场景下旧对比没有回看价值，链路存档仍会接住它（ requestId 可查）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Btn, CopyBtn, ErrorNote, Panel, TA, ToolGuide } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { chatcompareL } from '../lib/locales/chatcompare'
import {
  applyCompareEvent,
  buildCompareSpec,
  columnLabel,
  newColumn,
  type CompareColumn,
} from '../lib/chat-compare'
import { loadPrices, loadProfiles, profileReady } from '../lib/chat-config'
import { costOf, findPrice, uuidV4 } from '../lib/toolkit'

export function ChatCompareTool(): React.ReactElement {
  const l = useLocalized(chatcompareL)
  // 页面加载时的档案快照：对比页不编辑档案，改档案请回对话页设置
  const profiles = useMemo(() => loadProfiles().filter(profileReady), [])
  const prices = useMemo(() => loadPrices(), [])
  const [question, setQuestion] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [cols, setCols] = useState<CompareColumn[]>([])
  const [warn, setWarn] = useState('')
  const busy = cols.some((c) => c.status === 'streaming' || c.status === 'pending')
  const questionRef = useRef(question)
  questionRef.current = question

  // 全局事件流按 requestId 归组；退订必须返回（window.electronAPI 的 on* 约定）
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.chat : undefined
    if (!api?.onEvent) return
    const off = api.onEvent((evt) => {
      setCols((prev) => (prev.length ? applyCompareEvent(prev, evt) : prev))
    })
    return off
  }, [])

  const toggle = (id: string): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 全选/清空：逐个点 chip 选模型太慢，而「对比」场景的默认意图就是手里几个档案全上一遍
  const selectAll = (): void => setPicked(new Set(profiles.map((p) => p.id)))
  const clearAll = (): void => setPicked(new Set())

  const start = (): void => {
    const q = question.trim()
    const api = typeof window !== 'undefined' ? window.electronAPI?.chat : undefined
    if (!api?.send) { setWarn('—'); return }
    const chosen = profiles.filter((p) => picked.has(p.id))
    if (!q) { setWarn(l.pickOne); return }
    if (!chosen.length) { setWarn(l.pickOne); return }
    setWarn('')
    const stamp = uuidV4().replace(/-/g, '').slice(0, 8)
    const next = chosen.map((p, i) => newColumn(`cmp-${stamp}-${i}`, columnLabel(p), p.model.trim()))
    setCols(next)
    // 逐条发出即可：主进程已按 requestId 多路复用，事件回来各自归组
    chosen.forEach((p, i) => { void api.send!(buildCompareSpec(p, q, next[i].requestId)) })
  }

  const stopAll = (): void => {
    void window.electronAPI?.chat?.abort?.().catch(() => undefined)
  }

  return (
    <div className="max-w-[1720px] mx-auto space-y-4 fade-in">
      {/* 输入区桌面 sticky：结果列可能滚很长，对比途中要随时改问题、换模型重发，
          不能每次滚回顶部半天。移动端顶部已有 sticky topbar，不再叠罗汉。 */}
      <Panel title={l.questionLabel} className="lg:sticky lg:top-0 z-10">
        <ToolGuide title={l.guideTitle} steps={l.guideSteps} />
        <p className="text-[12px] text-muted leading-relaxed mb-3">{l.intro}</p>
        <TA value={question} onChange={setQuestion} rows={3} placeholder={l.questionPh} />
        {profiles.length === 0 && <div className="mt-3"><ErrorNote msg={l.emptyModels} /></div>}
        {profiles.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-bright">{l.modelsLabel}</span>
              <span className="text-[11px] text-muted/60">{l.pickedCount.replace('{n}', String(picked.size))}</span>
              <span className="ml-auto flex items-center gap-1">
                <button onClick={selectAll} className="px-1.5 py-0.5 rounded text-[11px] text-muted hover:text-phosphor hover:bg-phosphor-faint transition-colors">{l.selectAll}</button>
                <button onClick={clearAll} className="px-1.5 py-0.5 rounded text-[11px] text-muted hover:text-bright hover:bg-panel-2 transition-colors">{l.clearAll}</button>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profiles.map((p) => {
                const on = picked.has(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={`px-2.5 py-1 text-[12px] border transition-colors ${on ? 'border-phosphor/50 bg-phosphor-faint text-phosphor' : 'border-line-soft text-muted hover:text-bright'}`}
                  >
                    {on ? '✓ ' : ''}{columnLabel(p)} <span className="opacity-50">{p.model}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2 pt-1">
              {busy
                ? <Btn onClick={stopAll}>{l.stopBtn}</Btn>
                : <Btn onClick={start}>{l.startBtn}</Btn>}
              {warn && <span className="text-[11.5px] text-amber">{warn}</span>}
            </div>
            <p className="text-[11px] text-muted/70">{l.pureNote}</p>
          </div>
        )}
      </Panel>

      {cols.length > 0 && (
        <div className="grid gap-3 min-[900px]:grid-cols-2 min-[1500px]:grid-cols-3 items-start">
          {cols.map((c) => <Column key={c.requestId} col={c} l={l} prices={prices} />)}
        </div>
      )}
    </div>
  )
}

function Column({ col, l, prices }: {
  col: CompareColumn
  l: (typeof chatcompareL)['zh']
  prices: ReturnType<typeof loadPrices>
}): React.ReactElement {
  const price = findPrice(col.model, prices)
  const cost = col.usage && price
    ? costOf(price, {
        promptTokens: col.usage.promptTokens,
        completionTokens: col.usage.completionTokens,
        cachedTokens: col.usage.cachedTokens ?? 0,
      }).total
    : null

  const statusText = col.status === 'streaming' ? l.streaming
    : col.status === 'done' ? l.done
    : col.status === 'aborted' ? l.aborted
    : col.status === 'error' ? l.failed
    : l.pending
  const statusCls = col.status === 'done' ? 'text-phosphor border-phosphor/40'
    : col.status === 'error' ? 'text-danger border-danger/40'
    : col.status === 'aborted' ? 'text-amber border-amber/40'
    : 'text-muted border-line-soft'

  return (
    <div className="border border-line rounded-lg bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12.5px] font-medium text-bright truncate">{col.label}</span>
        <span className="text-[10px] text-muted/70 truncate">{col.model}</span>
        <CopyBtn text={col.text} label={l.copyCol} className="ml-auto shrink-0" />
        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 border ${statusCls}`}>{statusText}</span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-muted">
        {col.firstTokenMs !== null && <span>{l.firstTokenLabel} {col.firstTokenMs}ms</span>}
        {col.totalMs !== null && <span>{l.totalLabel} {(col.totalMs / 1000).toFixed(1)}s</span>}
        {col.usage && <span>{col.usage.totalTokens} token</span>}
        {cost !== null && <span>{l.costLabel} ¥{cost.toFixed(4)}</span>}
        {col.status === 'done' && !col.usage && <span className="opacity-60">{l.noPrice}</span>}
      </div>

      {col.status === 'error' && <ErrorNote msg={col.error} />}

      <pre className={`codeblock text-[12px] whitespace-pre-wrap break-words min-h-[80px] max-h-[52vh] overflow-auto ${col.status === 'streaming' ? 'text-bright' : 'text-muted'}`}>
        {col.text || (col.status === 'pending' ? '…' : '')}
      </pre>
    </div>
  )
}
