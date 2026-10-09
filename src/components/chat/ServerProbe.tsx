/**
 * 工具源连通性测试按钮 + 结果展示 —— 嵌在每个自定义工具源条目尾部。
 *
 * 一次性探测（连上→拉目录→立刻断开），结果就地显示：
 * 成功给工具数量与服务端自报名，失败给原因。完整目录归 MCP Inspector。
 */
import React, { useState } from 'react'
import { useLocalized } from '../../lib/i18n'
import { chatL } from '../../lib/locales/chat'
import { toChatToolServers, type CustomServer } from '../../lib/chat-config'
import type { McpProbeResult } from '../../lib/chat-types'

export function ServerProbe({ sv }: { sv: CustomServer }): React.ReactElement {
  const l = useLocalized(chatL)
  const [state, setState] = useState<'idle' | 'testing' | 'done'>('idle')
  const [result, setResult] = useState<McpProbeResult | null>(null)

  // 草稿 → agent 形态；转不出来（填了一半）就不允许测
  const src = toChatToolServers([sv])[0] ?? null
  const desktop = typeof window !== 'undefined' && !!window.electronAPI?.chat?.probeServer

  const run = async (): Promise<void> => {
    if (!src || state === 'testing') return
    setState('testing')
    setResult(null)
    try {
      const r = await window.electronAPI!.chat.probeServer(src)
      setResult(r)
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message })
    } finally {
      setState('done')
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={!desktop || !src || state === 'testing'}
          title={!desktop ? '' : !src ? l.probeIncomplete : l.probeBtn}
          className="shrink-0 text-[10.5px] border border-line-soft rounded-md px-1.5 py-0.5 text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors disabled:opacity-40 disabled:hover:text-muted disabled:hover:border-line-soft"
        >
          {state === 'testing' ? l.probeTesting : l.probeBtn}
        </button>
        {!desktop && <span className="text-[10.5px] text-muted/60">{l.probeIncomplete}</span>}
        {!src && desktop && (
          <span className="text-[10.5px] text-muted/60">{l.probeIncomplete}</span>
        )}
      </div>
      {result && state === 'done' && (
        <p
          className={`text-[10.5px] leading-snug break-all ${result.ok ? 'text-phosphor' : 'text-amber'}`}
        >
          {result.ok ? (
            <>
              {l.probeOkCount(result.tools?.length ?? 0)}
              {(result.serverName || result.serverVersion) && (
                <span className="text-muted/70">
                  {' '}
                  · {result.serverName ?? ''}
                  {result.serverVersion ? ` ${result.serverVersion}` : ''}
                </span>
              )}
              {(result.resources ?? 0) > 0 || (result.prompts ?? 0) > 0
                ? l.probeExtra(result.resources ?? 0, result.prompts ?? 0)
                : null}
            </>
          ) : (
            <>
              {l.probeFail}：{result.error ?? '—'}
            </>
          )}
        </p>
      )}
    </div>
  )
}
