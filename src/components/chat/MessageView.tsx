/**
 * 一条消息的渲染（按 AI SDK 的 parts 顺序铺开）。
 *
 * 三个都来自实际使用中的痛点：
 *   - 正文走 Markdown 渲染（模型基本只用 Markdown 回答），用户自己敲的那句仍按纯文本显示 ——
 *     用户输入的 `a*b*c` 不该被当成强调语法。
 *   - 思考内容**就地**渲染成可折叠块：思考与正文会交替出现，全挤到顶部会丢失「哪段思考对应哪句回答」。
 *     流式时有内容就展开，这一轮结束后自动折叠（用户手动点过就以用户的操作为准）。
 *   - 工具调用与结果按发生顺序插在正文之间，参数与输出默认折叠。
 */
import React, { useEffect, useRef, useState } from 'react'
import { CopyBtn, ErrorNote, KV, Stat } from '../ui'
import { Markdown } from '../Markdown'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import { costOf, estimateTokens, formatMoney, type ModelPrice } from '../../lib/toolkit'
import {
  messageMeta,
  messageText,
  messageToolParts,
  type ChatUIMessage,
  type ToolPartView,
} from '../../lib/chat-ui'
import type { ChatMeta } from '../../lib/chat-types'

type L = (typeof chatL)['zh']

export function MessageView({ msg, price, live }: {
  msg: ChatUIMessage
  price: ModelPrice | null
  /** 这条消息正处在流式输出中（决定思考块是否自动展开） */
  live: boolean
}): React.ReactElement {
  const l = useLocalized(chatL)
  const isUser = msg.role === 'user'
  const meta = messageMeta(msg)
  const text = messageText(msg)
  const tools = messageToolParts(msg)
  const toolById = new Map(tools.map((t) => [t.toolCallId, t]))

  const badge = live ? l.streaming : meta.error ? l.failed : meta.aborted ? l.stopped : l.done
  const badgeCls = meta.error ? 'text-danger border-danger/40'
    : live ? 'text-amber border-amber/40'
      : meta.aborted ? 'text-muted border-line-soft'
        : 'text-muted border-line-soft'

  return (
    <div className={`border-l-2 pl-3 ${isUser ? 'border-phosphor/50' : 'border-line-soft'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] uppercase tracking-wider ${isUser ? 'text-phosphor' : 'text-muted'}`}>
          {isUser ? l.roleUser : l.roleAssistant}
        </span>
        {!isUser && <span className={`text-[10px] px-1.5 border ${badgeCls}`}>{badge}</span>}
        {!isUser && meta.rounds !== undefined && meta.rounds > 1 && (
          <span className="text-[10px] text-muted">{l.roundsLabel.replace('{n}', String(meta.rounds))}</span>
        )}
        {!!text && <CopyBtn text={text} />}
      </div>

      <div className="mt-1.5 space-y-2">
        {msg.parts.map((part, i) => {
          if (part.type === 'text') {
            if (isUser) {
              return (
                <pre key={i} className="text-[12.5px] whitespace-pre-wrap break-words text-bright">{part.text}</pre>
              )
            }
            return part.text ? <Markdown key={i} text={part.text} /> : null
          }
          if (part.type === 'reasoning') {
            return <ReasoningBlock key={i} text={part.text} l={l} autoOpen={live && part.state === 'streaming'} />
          }
          if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
            const view = toolById.get((part as { toolCallId?: string }).toolCallId ?? '')
            return view ? <ToolBlock key={i} part={view} l={l} /> : null
          }
          return null
        })}

        {live && !text && !tools.length && !msg.parts.some((p) => p.type === 'reasoning' && p.text) && (
          <div className="text-[12px] text-muted">{l.streaming}…</div>
        )}
        {!live && !text && tools.length > 0 && (
          <div className="text-[11.5px] text-muted">{l.onlyToolNoAnswer}</div>
        )}
      </div>

      {meta.error && <div className="mt-1.5"><ErrorNote msg={meta.error} /></div>}
      {!isUser && !!meta.meta && <InlineMetrics meta={meta.meta} text={text} tools={tools.length} rounds={meta.rounds} l={l} price={price} />}
    </div>
  )
}

/* ================= 思考块 ================= */

function ReasoningBlock({ text, l, autoOpen }: { text: string; l: L; autoOpen: boolean }): React.ReactElement {
  const [open, setOpen] = useState(autoOpen)
  // 用户手动点过之后，自动折叠就不再抢方向盘；否则流式结束会把他刚展开的内容又收起来
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) setOpen(autoOpen)
  }, [autoOpen])

  return (
    <div className="border border-line-soft bg-panel-2/40">
      <button
        onClick={() => { touched.current = true; setOpen((v) => !v) }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left"
      >
        <span className="text-muted/70 text-[9px] w-2 shrink-0">{open ? '▾' : '▸'}</span>
        <span className="text-[11px] text-muted select-none">
          {open ? l.hideReasoning : l.showReasoning}
        </span>
        <span className="text-[10px] text-muted/50">{text.length}</span>
        {autoOpen && <span className="text-[10px] text-amber/80">{l.reasoningLive}</span>}
      </button>
      {open && (
        <pre className="codeblock text-[11.5px] text-muted/90 whitespace-pre-wrap break-words px-2.5 pb-2 max-h-[42vh] overflow-y-auto">
          {text}
        </pre>
      )}
    </div>
  )
}

/* ================= 工具调用 ================= */

function ToolBlock({ part, l }: { part: ToolPartView; l: L }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const running = part.state === 'input-available'
  const failed = part.state === 'output-error'
  const cls = running ? 'text-amber border-amber/40'
    : failed ? 'text-danger border-danger/40'
      : 'text-phosphor border-phosphor/40'
  const label = running ? l.toolRunning : failed ? l.toolReported : l.toolOk
  const body = failed ? (part.errorText ?? '') : (typeof part.output === 'string' ? part.output : part.output === undefined ? '' : JSON.stringify(part.output, null, 2))

  return (
    <div className="border border-line-soft bg-panel-2/60 px-2.5 py-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted">→</span>
        <span className="text-[12px] text-[#7ec8ff] break-all">{part.toolName}</span>
        <span className={`text-[10px] px-1.5 border ${cls}`}>{label}</span>
        {!!body && (
          <button onClick={() => setOpen((v) => !v)} className="text-[11px] text-muted hover:text-phosphor transition-colors">
            {open ? l.hideToolOutput : l.showToolOutput}
          </button>
        )}
      </div>
      <div className="text-[11px] text-muted/80 break-all mt-0.5">
        {l.toolArgsLabel} {formatArgs(part.input)}
      </div>
      {open && !!body && (
        <pre className="codeblock text-[11.5px] text-phosphor whitespace-pre-wrap break-words max-h-[30vh] overflow-auto mt-1">{body}</pre>
      )}
    </div>
  )
}

function formatArgs(input: unknown): string {
  if (input === undefined || input === null) return '{}'
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

/* ================= 指标 ================= */

/** 消息尾部的一行指标摘要：点开才是完整指标面板，不再常驻右栏 */
function InlineMetrics({ meta, text, tools, rounds, l, price }: {
  meta: ChatMeta
  text: string
  tools: number
  rounds?: number
  l: L
  price: ModelPrice | null
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const tokensOut = meta.usage?.completionTokens ?? Math.ceil(meta.chars / 3.2)
  const tokensTotal = meta.usage?.totalTokens ?? (meta.usage?.promptTokens ?? 0) + tokensOut
  const cost = price
    ? costOf(price, { promptTokens: meta.usage?.promptTokens ?? 0, completionTokens: tokensOut, cachedTokens: meta.usage?.cachedTokens ?? 0 }).total
    : null
  const exact = !!meta.usage

  return (
    <div className="mt-1.5 text-[10px] text-muted/60">
      <button onClick={() => setOpen((o) => !o)} className="hover:text-phosphor transition-colors">
        {meta.firstTokenMs ? `${l.firstToken} ${meta.firstTokenMs}ms` : ''}
        {` · ${(meta.totalMs / 1000).toFixed(1)}s · ${tokensTotal} token`}
        {exact ? '' : `（${l.estimated}）`}
        {cost !== null ? ` · ${formatMoney(cost)}` : ''}
        {rounds !== undefined && rounds > 1 ? ` · ${rounds} ${l.roundsKey}` : ''}
        <span className="text-muted/40">{open ? ' ▾' : ' ▸'}</span>
      </button>
      {open && (
        <div className="mt-1.5 border border-line-soft bg-panel-2 p-2.5">
          <MetricsView meta={meta} text={text} tools={tools} rounds={rounds} l={l} price={price} />
        </div>
      )}
    </div>
  )
}

function MetricsView({ meta, text, tools, rounds, l, price }: {
  meta: ChatMeta
  text: string
  tools: number
  rounds?: number
  l: L
  price: ModelPrice | null
}): React.ReactElement {
  const genMs = Math.max(meta.totalMs - meta.firstTokenMs, 1)
  const speed = meta.chars > 0 ? Math.round((meta.chars / genMs) * 1000) : 0
  // 服务端没给 usage 时，用与共享层同一套估算规则兜底，避免两处口径不一样
  const est = meta.usage ? 0 : estimateTokens(text).tokens
  const tokensOut = meta.usage?.completionTokens ?? est
  const exact = !!meta.usage
  const cost = price && (exact || est)
    ? costOf(price, {
        promptTokens: meta.usage?.promptTokens ?? 0,
        completionTokens: tokensOut,
        cachedTokens: meta.usage?.cachedTokens ?? 0,
      })
    : null

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Stat label={l.firstToken} value={meta.firstTokenMs ? `${meta.firstTokenMs} ms` : '—'} />
        <Stat label={l.ttfb} value={`${meta.ttfbMs} ms`} />
        <Stat label={l.totalTime} value={`${meta.totalMs} ms`} />
        <Stat label={l.speed} value={speed ? `${speed} ${l.speedUnit}` : '—'} />
        <Stat label={l.tokensIn} value={exact ? meta.usage!.promptTokens : '—'} />
        <Stat label={l.tokensOut} value={`${tokensOut}${exact ? '' : ' *'}`} />
      </div>
      {rounds !== undefined && rounds > 1 && <KV k={l.roundsKey} v={String(rounds)} />}
      {tools > 0 && <KV k={l.toolCallsLabel} v={String(tools)} />}
      <KV k={l.chunks} v={String(meta.chunks)} />
      <KV k={l.chars} v={String(meta.chars)} />
      {meta.reasoningChars > 0 && <KV k={l.reasoningChars} v={String(meta.reasoningChars)} />}
      <KV k={l.tokensTotal} v={`${meta.usage ? meta.usage.totalTokens : tokensOut}${exact ? '' : ' *'}`} />
      {meta.model && <KV k={l.servedModel} v={meta.model} />}
      {meta.finishReason && <KV k={l.finishReason} v={meta.finishReason === 'max_rounds' ? l.finishMaxRounds : meta.finishReason} />}
      <KV
        k={l.costLabel}
        v={
          <span className="text-amber">
            {cost ? formatMoney(cost.total) : '—'}
            <span className="text-muted text-[10px] ml-1">{exact ? l.exact : l.estimated}</span>
          </span>
        }
      />
      {cost && (
        <p className="text-[11px] text-muted">
          {l.costDetail.replace('{in}', formatMoney(cost.input)).replace('{out}', formatMoney(cost.output))}
        </p>
      )}
      {!exact && <p className="text-[11px] text-muted">{l.noUsageNote}</p>}
      {exact && !price && <p className="text-[11px] text-muted">{l.noPriceNote}</p>}
    </div>
  )
}
