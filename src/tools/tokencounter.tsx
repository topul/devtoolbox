/**
 * Token 估算器 —— 发送前掂量 prompt 有多重、一轮对话大概烧多少钱。
 * 估算规则在 toolkit/tokens.ts（±20% 量级，真实用量以服务端 usage 为准）。
 */
import React, { useMemo } from 'react'
import { ErrorNote, Panel, Stat, TA, ToolShell, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { estimateMessages, estimateTokens, type ChatMessageLike } from '../lib/toolkit/tokens'

const L = {
  zh: {
    text: '文本',
    textPh: '把要发的 prompt / 文档粘进来…',
    chars: '字符',
    cjk: 'CJK 汉字',
    latin: '字母数字',
    words: '英文单词',
    messages: '对话估算（可选）',
    messagesPh:
      '[\n  {"role": "system", "content": "You are a helpful assistant."},\n  {"role": "user", "content": "你好"}\n]',
    messagesHint: '粘贴 OpenAI 风格的 messages JSON，估算整轮对话（含每条约 4 token 协议开销）',
    tokens: '估算 token',
    overhead: '协议开销',
    total: '合计',
    perMsg: '每条正文',
    badJson: '不是合法 JSON 或不是 {role, content} 数组',
    note: '**这是估算，不是分词。** 不加载各家词表（tiktoken/deepseek 各不相同），按字符类别折算，误差约 ±20%。计费、限流等精确场景一律以服务端返回的 usage 为准。',
  },
  en: {
    text: 'Text',
    textPh: 'Paste the prompt / document you are about to send…',
    chars: 'Characters',
    cjk: 'CJK chars',
    latin: 'Alphanumeric',
    words: 'English words',
    messages: 'Conversation estimate (optional)',
    messagesPh:
      '[\n  {"role": "system", "content": "You are a helpful assistant."},\n  {"role": "user", "content": "Hello"}\n]',
    messagesHint:
      'Paste an OpenAI-style messages JSON to estimate a whole conversation (~4 tokens of protocol overhead per message)',
    tokens: 'Estimated tokens',
    overhead: 'Overhead',
    total: 'Total',
    perMsg: 'Per-message body',
    badJson: 'Not valid JSON, or not a [{role, content}] array',
    note: '**This is an estimate, not tokenization.** No vendor vocabulary is loaded (tiktoken / deepseek differ); characters are folded by class with roughly ±20% error. For billing or rate-limit decisions always use the usage returned by the server.',
  },
}

export function TokenCounterTool() {
  const l = useLocalized(L)
  const [text, setText] = usePersistedState('token-counter', 'text', '')
  const [messagesJson, setMessagesJson] = usePersistedState('token-counter', 'messagesJson', '')

  const est = useMemo(() => (text ? estimateTokens(text) : null), [text])

  const msgResult = useMemo<{
    ok: boolean
    data: ReturnType<typeof estimateMessages> | null
  }>(() => {
    if (!messagesJson.trim()) return { ok: true, data: null }
    try {
      const parsed: unknown = JSON.parse(messagesJson)
      if (
        !Array.isArray(parsed) ||
        parsed.some((m) => typeof m?.role !== 'string' || typeof m?.content !== 'string')
      ) {
        return { ok: false, data: null }
      }
      return { ok: true, data: estimateMessages(parsed as ChatMessageLike[]) }
    } catch {
      return { ok: false, data: null }
    }
  }, [messagesJson])

  return (
    <ToolShell toolId="token-counter">
      <TA
        toolInput
        value={text}
        onChange={setText}
        label={l.text}
        placeholder={l.textPh}
        rows={7}
        spellCheck
      />

      {est && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label={l.tokens} value={est.tokens.toLocaleString()} />
          <Stat
            label={l.chars}
            value={(est.latinChars + est.cjkChars + est.otherChars).toLocaleString()}
          />
          <Stat label={l.cjk} value={est.cjkChars.toLocaleString()} />
          <Stat label={l.words} value={est.words.toLocaleString()} />
        </div>
      )}

      <TA
        value={messagesJson}
        onChange={setMessagesJson}
        label={l.messages}
        labelRight={<span className="text-[11px] text-muted">{l.messagesHint}</span>}
        placeholder={l.messagesPh}
        rows={5}
        spellCheck
      />
      <ErrorNote msg={msgResult.ok ? null : l.badJson} />

      {msgResult.data && (
        <Panel title={l.total}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label={l.tokens} value={msgResult.data.tokens.toLocaleString()} />
            <Stat label={l.overhead} value={msgResult.data.overhead.toLocaleString()} />
            <Stat label={l.total} value={msgResult.data.total.toLocaleString()} />
            <Stat label={l.perMsg} value={msgResult.data.perMessage.length.toLocaleString()} />
          </div>
          {msgResult.data.perMessage.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {msgResult.data.perMessage.map((n, i) => (
                <span
                  key={i}
                  className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-panel-2 text-muted"
                >
                  #{i + 1}: {n.toLocaleString()}
                </span>
              ))}
            </div>
          )}
        </Panel>
      )}
    </ToolShell>
  )
}
