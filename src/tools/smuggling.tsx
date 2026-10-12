/**
 * HTTP 请求走私实验台：生成字节精确的 CL.TE / TE.CL / TE.TE 模板与时间探测。
 * 纯教学用途：只生成文本，不发送；SecNote 明确仅限本地隔离靶场。
 */
import React, { useMemo, useState } from 'react'
import { Btn, CopyBtn, Input, Panel, ToolShell, usePersistedState } from '../components/ui'
import { HandoffBadge, useDrainHandoff } from '../components/SendTo'
import { useLocalized } from '../lib/i18n'
import { TE_VARIANTS, buildSmugglingTemplates, buildTimingProbe } from '../lib/toolkit/smuggling'
import { handoffToHostPath } from '../lib/handoff'
import { SecNote } from './secnote'

const L = {
  zh: {
    host: '靶场 Host',
    path: '入口路径',
    smuggled: '走私路径（拼到下一请求前）',
    tplTitle: {
      clte: 'CL.TE（前端信 CL，后端信 TE）',
      tecl: 'TE.CL（前端信 TE，后端信 CL）',
      tete: 'TE.TE（一端混淆 TE 后回退 CL）',
    },
    tplDesc: {
      clte: '前端按 Content-Length 整段转发；后端读到 0 块即结束，剩余的 GET 被拼进下一个连接请求前面。',
      tecl: '前端按 chunked 读完所有块；后端只按 CL 取走首块长度行，剩余部分成为下一请求前缀。',
      tete: '两端都声称支持 TE，但其中一端被下面的混淆写法骗过、回退按 CL 解析。',
    },
    probe: '无危害时间探测',
    probeDesc:
      '先确认两端是否存在分歧：若该请求让后端挂起到超时（而前端正常），说明存在 CL/TE 分歧。它不夹带走私请求，不影响他人。',
    copyAll: '复制全部',
    teList: 'Transfer-Encoding 混淆写法（用于 TE.TE 逐个试）',
    prereqTitle: '前置条件与原理',
    prereq: [
      '链路里必须有「前端（代理/CDN/负载均衡）+ 后端」两台对 HTTP 解析不一致的服务器',
      '前端与后端复用同一个到后端的 TCP 连接（连接池），走私前缀才会落到「下一个请求」上',
      '现代栈大多已修复，能否复现取决于具体产品与版本，请以自己靶场的实测为准',
    ],
    safeTitle: '安全的学习路径',
    safe: [
      '本地起两个解析行为不同的容器，或用官方公开的教学靶场，不要碰生产环境',
      '第一步只做时间探测，确认分歧存在，不发送任何会污染队列的请求',
      '确认后再在隔离连接上验证模板；每轮验证后重开连接，避免残留',
    ],
    fixTitle: '修复方向',
    fix: [
      '在边界统一 HTTP 解析：前端把收到的请求规范化（拒绝同时带 CL 与 TE、拒绝畸形 TE），再转发给后端',
      '后端升级到不接受歧义解析的版本；对带 chunked 的请求只信 TE',
      '到后端的连接不复用、或前后端使用同一套解析库，并开启严格模式（如 H2/H3 到后端）',
    ],
  },
  en: {
    host: 'Lab host',
    path: 'Entry path',
    smuggled: 'Smuggled path (prefixed to next request)',
    tplTitle: {
      clte: 'CL.TE (front trusts CL, back-end trusts TE)',
      tecl: 'TE.CL (front trusts TE, back-end trusts CL)',
      tete: 'TE.TE (one side falls back to CL on obfuscated TE)',
    },
    tplDesc: {
      clte: 'The front end forwards the whole body per Content-Length; the back-end stops at the zero chunk and prepends the leftover GET to the next pooled request.',
      tecl: 'The front end reads all chunks; the back-end takes only the first chunk-length line per CL, leaving the rest as the next request prefix.',
      tete: 'Both sides claim TE support, but an obfuscated header below tricks one side into falling back to CL.',
    },
    probe: 'Harmless timing probe',
    probeDesc:
      'First confirm disagreement: if the back-end hangs to timeout while the front end responds normally, a CL/TE desync exists. It carries no smuggled request and affects nobody else.',
    copyAll: 'Copy all',
    teList: 'TE obfuscations (try one by one for TE.TE)',
    prereqTitle: 'Prerequisites & mechanics',
    prereq: [
      'A chain of front-end (proxy/CDN/LB) plus back-end that parse HTTP inconsistently',
      'Both reuse the same TCP connection to the back-end (pooling), so the prefix lands on the next request',
      'Most modern stacks are fixed; behavior depends on product and version — verify in your own lab',
    ],
    safeTitle: 'Safe learning path',
    safe: [
      'Run two containers with differing parsing locally, or use an official training lab — never production',
      'Start with the timing probe only; confirm the desync without queue-poisoning requests',
      'Then validate templates on an isolated connection; reopen the connection after each round',
    ],
    fixTitle: 'Remediation',
    fix: [
      'Normalize HTTP at the boundary: reject both CL and TE together and reject malformed TE before forwarding',
      'Upgrade the back-end to unambiguous parsing; trust only TE on chunked requests',
      'Do not pool back-end connections, or share one strict parser end to end (e.g. HTTP/2 or HTTP/3 upstream)',
    ],
  },
}

export function SmugglingTool() {
  const l = useLocalized(L)
  const [host, setHost] = usePersistedState('smuggling', 'host', 'lab.local')
  const [path, setPath] = usePersistedState('smuggling', 'path', '/')
  const [smuggled, setSmuggled] = usePersistedState('smuggling', 'smuggled', '/admin')
  const [from, setFrom] = useState<string | null>(null)
  useDrainHandoff('smuggling', (env) => {
    const hp = handoffToHostPath(env)
    if (hp) {
      setHost(hp.host)
      setPath(hp.path)
      setFrom(env.sourceLabel)
    }
  })

  const templates = useMemo(
    () => buildSmugglingTemplates({ host, path, smuggledPath: smuggled }),
    [host, path, smuggled],
  )
  const probe = useMemo(() => buildTimingProbe(host, path), [host, path])

  return (
    <ToolShell toolId="smuggling">
      <SecNote scene="smuggling" />
      {from && <HandoffBadge label={from} onClear={() => setFrom(null)} />}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          value={host}
          onChange={(v) => {
            setHost(v)
            setFrom(null)
          }}
          label={l.host}
        />
        <Input
          value={path}
          onChange={(v) => {
            setPath(v)
            setFrom(null)
          }}
          label={l.path}
        />
        <Input value={smuggled} onChange={setSmuggled} label={l.smuggled} />
      </div>

      {templates.map((t) => (
        <Panel key={t.id} title={l.tplTitle[t.id]} right={<CopyBtn text={t.raw} />}>
          <p className="mb-2 text-[12px] text-muted leading-relaxed">{l.tplDesc[t.id]}</p>
          <pre
            className="codeblock overflow-auto whitespace-pre text-[11px] leading-relaxed"
            style={{ maxHeight: 280 }}
          >
            {t.raw}
          </pre>
        </Panel>
      ))}

      <Panel title={l.probe} right={<CopyBtn text={probe} />}>
        <p className="mb-2 text-[12px] text-muted leading-relaxed">{l.probeDesc}</p>
        <pre className="codeblock overflow-auto whitespace-pre text-[11px] leading-relaxed">
          {probe}
        </pre>
      </Panel>

      <Panel title={l.teList}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {TE_VARIANTS.map((v) => (
            <div key={v.id} className="group flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-panel-2 px-2 py-1 text-[11px] text-bright">
                {v.value.replace(/\r?\n/g, ' ⏎ ')}
              </code>
              <CopyBtn
                text={v.value.includes('\n') ? v.value : v.value}
                className="opacity-0 group-hover:opacity-100"
              />
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <InfoPanel title={l.prereqTitle} items={l.prereq} />
        <InfoPanel title={l.safeTitle} items={l.safe} />
        <InfoPanel title={l.fixTitle} items={l.fix} />
      </div>

      <Btn
        onClick={() =>
          void navigator.clipboard?.writeText(templates.map((t) => t.raw).join('\n\n=====\n\n'))
        }
        className="self-start"
      >
        {l.copyAll}
      </Btn>
    </ToolShell>
  )
}

function InfoPanel({ title, items }: { title: string; items: string[] }): React.ReactElement {
  return (
    <Panel title={title}>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-[12px] text-bright leading-relaxed">
            <span className="shrink-0 text-phosphor/70">·</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
