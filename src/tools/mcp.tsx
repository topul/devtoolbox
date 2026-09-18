import React, { useEffect, useMemo, useState } from 'react'
import { Panel, CopyBtn, KV, ToolGuide, Collapse } from '../components/ui'
import { useI18n, useLocalized } from '../lib/i18n'
import { mcpL } from '../lib/locales/mcp'
import { MCP_GROUPS, MCP_TOOLS, toProtocolTools, toolDesc, type McpGroup } from '../lib/mcp-catalog'
import type { McpInfo } from '../lib/mcp-types'

/**
 * MCP 能力面板。
 *
 * 这一页本身不做计算，只做两件事：
 *   1. 把主进程算好的本机启动配置展示出来（路径、命令、可粘贴的 JSON 片段）；
 *   2. 列出服务端当前暴露的全部能力，让用户知道接上之后 AI 能做什么。
 *
 * 能力清单直接读 `src/lib/mcp-catalog.ts` —— 与服务端是同一份声明，不会对不上。
 */

function quote(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s
}

export function McpTool() {
  const { locale } = useI18n()
  const l = useLocalized(mcpL)
  const [info, setInfo] = useState<McpInfo | null>(null)

  useEffect(() => {
    let alive = true
    // 渲染冒烟会在没有 electronAPI 的环境里 SSR 这一页，必须可选链 + 兜底
    const api = typeof window !== 'undefined' ? window.electronAPI?.mcp : undefined
    if (!api) return
    api.info().then((v) => {
      if (alive) setInfo(v)
    }).catch(() => { /* 取不到就只显示能力清单 */ })
    return () => { alive = false }
  }, [])

  const launch = info?.launch
  const runPrefix = launch ? [launch.command, ...launch.args].map(quote).join(' ') : ''
  // 开发态下启动命令是整条 Electron 二进制路径，重复三遍很难读；用一个变量替代，复制出去照样能跑
  const cliScript = launch
    ? [
        `DTB=${quote(runPrefix)}`,
        '$DTB --list',
        `$DTB --call base64_encode '{"text":"你好"}'`,
        `$DTB --call http_request '{"url":"https://example.com","method":"GET"}'`,
      ].join('\n')
    : ''

  const toolsJson = useMemo(() => JSON.stringify({ tools: toProtocolTools() }, null, 2), [])

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-bright leading-relaxed max-w-[1100px]">{l.intro}</p>

      <ToolGuide title={l.guideTitle} steps={l.guideSteps} note={l.guideNote} />

      <Panel title={l.statusTitle}>
        {!launch && <p className="text-[12px] text-muted">{l.noDesktop}</p>}
        {launch && (
          <>
            <KV
              k={l.serverFile}
              v={
                <span className="flex flex-wrap items-center gap-2">
                  <span className={launch.serverPathExists ? 'text-phosphor break-all' : 'text-danger break-all'}>{launch.serverPath}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 border ${launch.serverPathExists ? 'border-phosphor/40 text-phosphor' : 'border-danger/40 text-danger'}`}>
                    {launch.serverPathExists ? l.ready : l.notBuilt}
                  </span>
                </span>
              }
            />
            <KV k={l.commandLabel} v={<span className="break-all">{launch.command} {launch.args.join(' ')}</span>} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px] text-muted">
              <span>{l.runModeLabel}: <span className="text-bright">{launch.packaged ? l.packagedMode : l.devMode}</span></span>
              <span>{l.versionLabel}: <span className="text-bright">{launch.version}</span></span>
            </div>
            {!launch.serverPathExists && (
              <p className="text-[12px] text-danger mt-2">{l.notBuiltHint}</p>
            )}
          </>
        )}
      </Panel>

      {launch && (
        <Panel title={l.configTitle} right={<CopyBtn text={launch.configJson} />}>
          <p className="text-[12px] text-muted mb-2">{l.configHint}</p>
          <pre className="codeblock text-[12px] text-phosphor overflow-auto max-h-[320px]">{launch.configJson}</pre>
        </Panel>
      )}

      {info && info.hints.length > 0 && (
        <Panel title={l.hintTitle}>
          {info.hints.map((h) => (
            <div key={h.client} className="py-1.5 border-b border-line-soft last:border-0 text-[12.5px]">
              <span className="text-phosphor">{h.client}</span>
              {l.hintNotes[h.client] && <span className="text-muted"> · {l.hintNotes[h.client]}</span>}
              <div className="text-muted/80 text-[11px] break-all">{h.path}</div>
            </div>
          ))}
        </Panel>
      )}

      {/* 参考性内容收进折叠区：进来的人需要的是「怎么接上」，不是先读一遍能力清单 */}
      <Collapse
        title={l.toolsTitle}
        hint={l.toolCount(MCP_TOOLS.length)}
        right={<CopyBtn text={toolsJson} />}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {MCP_GROUPS.map((g) => {
            const items = MCP_TOOLS.filter((t) => t.group === g)
            if (!items.length) return null
            return (
              <div key={g}>
                <div className="text-[11px] uppercase tracking-wider text-muted mb-1.5">{l.groups[g as McpGroup]}</div>
                <div className="space-y-1">
                  {items.map((t) => {
                    const req = t.inputSchema.required ?? []
                    const params = Object.keys(t.inputSchema.properties)
                    return (
                      <div key={t.name} className="border border-line-soft bg-panel-2 px-2.5 py-1.5">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-phosphor text-[12.5px]">{t.name}</span>
                          <span className="text-bright text-[11.5px]">{locale === 'en' ? t.titleEn : t.title}</span>
                          <span className="text-muted text-[11px]">
                            {params.length > 0 && `${req.length ? l.requiredLabel : l.optionalLabel}: ${params.join(', ')}`}
                          </span>
                        </div>
                        <div className="text-muted text-[11.5px] leading-snug mt-0.5">{toolDesc(t, locale)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[11.5px] text-muted mt-3">{l.httpNote}</p>
      </Collapse>

      {launch && (
        <Collapse title={l.cliTitle} right={<CopyBtn text={cliScript} />}>
          <p className="text-[12px] text-muted mb-2">{l.cliHint}</p>
          <pre className="codeblock text-[12px] text-amber overflow-x-auto whitespace-pre">{cliScript}</pre>
        </Collapse>
      )}

      <Collapse title={l.usageTitle}>
        <ol className="text-[12.5px] text-bright space-y-1 list-none">
          {l.usage.map((s, i) => (
            <li key={i}><span className="text-phosphor mr-1.5">{i + 1}.</span>{s}</li>
          ))}
        </ol>
      </Collapse>
    </div>
  )
}
