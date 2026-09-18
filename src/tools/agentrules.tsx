import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, Btn, TA, Input, ErrorNote, Stat, CopyBtn, KV, ToolGuide, Collapse } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { agentRulesL } from '../lib/locales/agentrules'
import { generateRules } from '../lib/toolkit/agentrules'
import { RULES_TARGETS, type AgentScanFacts, type RulesTarget } from '../lib/agentrules-types'

/**
 * Agent 规则文件生成器。
 *
 * 价值不在于「生成一份 Markdown」——模板谁都能写。价值在于**内容是扫出来的**：
 * 命令读自 package.json / Makefile，技术栈读自依赖，结构读自真实目录。
 * 于是这份规则文件能当「这个仓库现在长什么样」的对照物；对不上，就是项目里该澄清的地方。
 *
 * 事实由主进程扫（只读、带回结构化数据），拼装由共享层做（可被脚本断言），
 * 本组件只负责状态与渲染。
 */

const DEPTH_OPTIONS = [1, 2, 3, 4, 5]

export function AgentRulesTool(): React.ReactElement {
  const l = useLocalized(agentRulesL)
  const [root, setRoot] = useState('')
  const [depth, setDepth] = useState(3)
  const [target, setTarget] = useState<RulesTarget>('agents')
  const [facts, setFacts] = useState<AgentScanFacts | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const api = typeof window !== 'undefined' ? window.electronAPI?.agentRules : undefined

  // 默认落在主目录：多数人是「从家目录挑一个子项目」，省一次点击
  useEffect(() => {
    if (!api) return
    let alive = true
    api
      .defaultRoot()
      .then((home) => {
        if (alive && home) setRoot((cur) => cur || home)
      })
      .catch(() => {
        /* 取不到就留空，用户手填 */
      })
    return () => {
      alive = false
    }
  }, [api])

  const runScan = useCallback(
    async (dir: string, d: number): Promise<void> => {
      if (!api) return
      const trimmed = dir.trim()
      if (!trimmed) {
        setErr(l.needRoot)
        return
      }
      setBusy(true)
      setErr(null)
      setSaveMsg('')
      try {
        const res = await api.scan({ root: trimmed, maxDepth: d })
        if (res.ok) {
          setFacts(res.facts)
        } else {
          setFacts(null)
          setErr(l.errors[res.code] ?? res.code)
        }
      } catch (e) {
        setFacts(null)
        setErr((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [api, l],
  )

  const pick = async (): Promise<void> => {
    if (!api) return
    const dir = await api.pick(l.pickTitle)
    if (!dir) return
    setRoot(dir)
    void runScan(dir, depth)
  }

  const output = useMemo(() => (facts ? generateRules(facts, target, l.rules) : ''), [facts, target, l])

  const save = async (): Promise<void> => {
    if (!api || !facts || !output) return
    setBusy(true)
    setErr(null)
    const res = await api.save(facts.root, target, output)
    setBusy(false)
    if (res.ok) setSaveMsg(l.savedTo(res.path ?? ''))
    else setErr(l.errors[res.code ?? ''] ?? res.code ?? '')
  }

  const noDesktop = typeof window !== 'undefined' && !api

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted leading-relaxed max-w-[1100px]">{l.intro}</p>

      <ToolGuide title={l.guideTitle} steps={l.guideSteps} />

      {noDesktop && <ErrorNote msg={l.errors.ROOT_EMPTY} />}

      <Panel title={l.rootLabel}>
        <div className="grid grid-cols-1 min-[1500px]:grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 items-end">
          <Input value={root} onChange={setRoot} placeholder={l.rootPlaceholder} />
          <Btn variant="ghost" onClick={pick} disabled={!api || busy}>{l.pick}</Btn>
          <div>
            <div className="text-[11px] text-muted mb-1">{l.depthLabel}</div>
            <div className="flex gap-1">
              {DEPTH_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  className={`px-2.5 py-1 text-[12px] border ${depth === d ? 'border-phosphor/50 text-phosphor bg-phosphor/5' : 'border-line-soft text-muted hover:text-bright'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <Btn onClick={() => void runScan(root, depth)} disabled={!api || busy}>
            {busy ? l.scanning : facts ? l.rescan : l.scan}
          </Btn>
        </div>
        <ErrorNote msg={err} />
        {!facts && !err && <p className="text-[12px] text-muted mt-2">{l.noFacts}</p>}
      </Panel>

      {facts && (
        <div className="grid grid-cols-1 min-[1700px]:grid-cols-2 gap-3">
          {/* 产物放左上：进来是为了拿这份文件，事实是支撑材料 */}
          <div className="space-y-3">
            <Panel
              title={l.targetLabel}
              right={
                <div className="flex items-center gap-1.5">
                  <CopyBtn text={output} />
                  <Btn variant="ghost" onClick={() => void save()} disabled={!api || busy}>{l.save}</Btn>
                </div>
              }
            >
              <div className="flex flex-wrap gap-1.5 mb-2">
                {RULES_TARGETS.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTarget(t); setSaveMsg('') }}
                    className={`px-2.5 py-1 text-[11.5px] border font-mono ${target === t ? 'border-phosphor/50 text-phosphor bg-phosphor/5' : 'border-line-soft text-muted hover:text-bright'}`}
                  >
                    {l.targets[t]}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted mb-2">{l.targetNotes[target]}</p>
              <TA value={output} readOnly rows={26} label={l.outputTitle} />
              <p className="text-[11px] text-muted mt-2 leading-relaxed">{l.saveHint}</p>
              {saveMsg && <p className="text-[11px] text-phosphor mt-1 break-all">{saveMsg}</p>}
            </Panel>
          </div>

          <div className="space-y-3">
            <Panel title={l.factsTitle}>
              <KV k={l.languagesLabel} v={facts.languages.length ? facts.languages.join('、') : l.noneLabel} />
              <KV k={l.frameworksLabel} v={facts.frameworks.length ? facts.frameworks.join('、') : l.noneLabel} />
              <KV k={l.pkgLabel} v={facts.packageManager ?? l.noneLabel} />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Stat label={l.filesLabel} value={String(facts.stats.files)} />
                <Stat label={l.dirsLabel} value={String(facts.stats.dirs)} />
              </div>
              <div className="text-[11px] text-muted/80 break-all mt-2">{facts.root}</div>
            </Panel>

            <Panel title={l.commandsTitle}>
              {facts.commands.length === 0 && <p className="text-[12px] text-muted">{l.commandsEmpty}</p>}
              {facts.commands.length > 0 && (
                <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-muted">
                        <th className="text-left font-normal pb-1.5 pr-3">{l.tableKind}</th>
                        <th className="text-left font-normal pb-1.5 pr-3">{l.tableCommand}</th>
                        <th className="text-left font-normal pb-1.5">{l.tableSource}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facts.commands.map((c) => (
                        <tr key={`${c.command}-${c.source}`} className="border-t border-line-soft">
                          <td className="py-1 pr-3 text-muted whitespace-nowrap">{l.commandKinds[c.kind] ?? c.kind}</td>
                          <td className="py-1 pr-3 text-phosphor font-mono whitespace-nowrap">{c.command}</td>
                          <td className="py-1 text-muted/80 font-mono whitespace-nowrap">{c.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Collapse title={l.treeTitle} hint={l.treeHint}>
              <pre className="codeblock text-[11.5px] text-bright overflow-auto max-h-[420px] leading-relaxed">{facts.tree}</pre>
              {facts.stats.truncated && <p className="text-[11px] text-amber mt-2">{l.truncatedNote}</p>}
            </Collapse>

            {facts.signals.length > 0 && (
              <Collapse title={l.signalsTitle} hint={String(facts.signals.length)}>
                <div className="space-y-1">
                  {facts.signals.map((s) => (
                    <div key={s} className="flex flex-wrap gap-x-2 text-[12px]">
                      <span className="text-muted/80 font-mono text-[11px] shrink-0">{s}</span>
                      <span className="text-bright">{l.signals[s] ?? s}</span>
                    </div>
                  ))}
                </div>
              </Collapse>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
