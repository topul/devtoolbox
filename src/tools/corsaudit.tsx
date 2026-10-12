/**
 * CORS 配置分析器：请求 Origin + 响应头 → 跨域读取风险判定 + PoC。
 * 纯本地分析（toolkit/cors），不发起请求。
 */
import React, { useMemo, useState } from 'react'
import { CopyBtn, Input, Panel, TA, ToolShell, usePersistedState } from '../components/ui'
import { HandoffBadge, useDrainHandoff } from '../components/SendTo'
import { useLocalized } from '../lib/i18n'
import { cn } from '../lib/cn'
import { analyzeCors, type CorsFinding, type CorsSeverity } from '../lib/toolkit/cors'
import { handoffToCorsBlock } from '../lib/handoff'
import { SecNote } from './secnote'

const L = {
  zh: {
    origin: '请求 Origin',
    originPh: 'https://attacker.example',
    trusted: '被信站 Origin（可选，用于后缀绕过提示）',
    trustedPh: 'https://app.example',
    headers: '响应头（粘贴完整响应头或 CORS 三行）',
    headersPh:
      'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: https://attacker.example\r\nAccess-Control-Allow-Credentials: true',
    result: '判定结果',
    poc: 'PoC 页面（在你的靶场上验证）',
    creds: '允许凭据',
    yes: '是',
    no: '否',
    acao: 'ACAO',
    nothing: '粘贴响应头后自动分析',
  },
  en: {
    origin: 'Request Origin',
    originPh: 'https://attacker.example',
    trusted: 'Trusted origin (optional, for suffix-bypass hint)',
    trustedPh: 'https://app.example',
    headers: 'Response headers (full block or the three CORS lines)',
    headersPh:
      'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: https://attacker.example\r\nAccess-Control-Allow-Credentials: true',
    result: 'Verdict',
    poc: 'PoC page (verify in your own lab)',
    creds: 'Credentials allowed',
    yes: 'yes',
    no: 'no',
    acao: 'ACAO',
    nothing: 'Paste response headers to analyze',
  },
}

const F: Record<string, { zh: [string, string, string]; en: [string, string, string] }> = {
  'acao.absent': {
    zh: [
      '信息',
      '没有 CORS 头',
      '响应不含 Access-Control-Allow-Origin，浏览器同源策略照常生效，不允许跨域读取。',
    ],
    en: [
      'Info',
      'No CORS header',
      'The response has no Access-Control-Allow-Origin; normal same-origin policy applies.',
    ],
  },
  'reflect.credentials': {
    zh: [
      '严重',
      '反射任意 Origin 且允许凭据',
      '响应把请求里的 Origin 原样回填，且 Allow-Credentials: true。任意站点都能带受害者 Cookie 发起请求并读取响应体。',
    ],
    en: [
      'Critical',
      'Reflects Origin with credentials',
      'The response echoes the request Origin and sets Allow-Credentials: true. Any site can send credentialed requests and read the response.',
    ],
  },
  'reflect.anon': {
    zh: [
      '高',
      '反射任意 Origin（不带凭据）',
      '任意站点可跨域读取响应；在 IP 白名单、内网地址或 Bearer 场景仍可能读到敏感数据。',
    ],
    en: [
      'High',
      'Reflects Origin (no credentials)',
      'Any site can read responses cross-origin; still dangerous with IP allowlists, intranet hosts or Bearer tokens.',
    ],
  },
  'wildcard.credentials.browserBlocked': {
    zh: [
      '中',
      '通配符 + 凭据（浏览器会拦截）',
      '规范禁止 ACAO:* 与凭据组合，浏览器会拒绝。但这通常说明配置意图混乱，应改为精确白名单。',
    ],
    en: [
      'Medium',
      'Wildcard + credentials (browser blocks)',
      'The spec forbids ACAO:* with credentials and browsers reject it. It signals confused config — use an exact allowlist.',
    ],
  },
  'wildcard.readonly': {
    zh: ['低', '通配符（无凭据）', '任意站点可读公开响应；确认该接口确实不返回任何用户相关数据。'],
    en: [
      'Low',
      'Wildcard (no credentials)',
      'Any site can read public responses; confirm the endpoint never returns user-specific data.',
    ],
  },
  'null.credentials': {
    zh: [
      '高',
      '信任 null 源且允许凭据',
      '攻击者页面放在 sandbox iframe / 重定向链里即可获得 null Origin，带 Cookie 读取响应。',
    ],
    en: [
      'High',
      'Trusts null with credentials',
      'A sandboxed iframe or redirect chain yields a null Origin that can read credentialed responses.',
    ],
  },
  'null.anon': {
    zh: [
      '中',
      '信任 null 源（不带凭据）',
      'null 可由 sandbox iframe 构造，仍可读取无凭据的敏感响应。',
    ],
    en: [
      'Medium',
      'Trusts null (no credentials)',
      'null is forgeable via sandboxed iframes and can still read sensitive credential-free responses.',
    ],
  },
  'vary.origin.missing': {
    zh: [
      '低',
      '缺少 Vary: Origin',
      '响应因 Origin 不同而不同却没声明 Vary，可能在 CDN / 浏览器缓存中被串用。',
    ],
    en: [
      'Low',
      'Missing Vary: Origin',
      'Responses vary by Origin without a Vary header; CDN / browser caches may mix them up.',
    ],
  },
  'suffix.hint': {
    zh: [
      '信息',
      '后缀匹配风险提示',
      '若服务端用 endsWith / startsWith 校验，可尝试注册 {d}（证据：{e}）。需要按实际校验逻辑验证。',
    ],
    en: [
      'Info',
      'Suffix-match hint',
      'If the server uses endsWith / startsWith, registering {d} (evidence: {e}) may bypass it — verify against the real logic.',
    ],
  },
  'static.origin': {
    zh: ['信息', '固定白名单源', 'ACAO 是固定源：{e}。确认它不是可被注册的宽泛后缀即可。'],
    en: [
      'Info',
      'Static allowlisted origin',
      'ACAO is a fixed origin: {e}. Confirm it is not a registrable loose suffix.',
    ],
  },
  'credentials.static': {
    zh: [
      '信息',
      '允许凭据但未反射 Origin',
      'Allow-Credentials: true 配合固定 ACAO，风险取决于该固定源是否完全可信。',
    ],
    en: [
      'Info',
      'Credentials without reflection',
      'Allow-Credentials: true with a fixed ACAO is only as safe as that fixed origin.',
    ],
  },
}

const SEV: Record<CorsSeverity, string> = {
  critical: 'text-danger border-danger/40 bg-danger/5',
  high: 'text-amber border-amber/35 bg-amber/5',
  medium: 'text-amber border-amber/25 bg-amber/5',
  low: 'text-phosphor border-phosphor/25 bg-phosphor/5',
  info: 'text-muted border-line-soft bg-panel-2',
  safe: 'text-phosphor border-phosphor/25 bg-phosphor/5',
}

function FindingRow({ f, lang }: { f: CorsFinding; lang: 'zh' | 'en' }): React.ReactElement {
  const meta = F[f.id]
  if (!meta) return <></>
  const [badge, title, desc] = meta[lang]
  const text = desc.replace(/\{e\}/g, f.evidence).replace(/\{d\}/g, f.detail ?? '')
  return (
    <div className={cn('rounded-md border px-3 py-2', SEV[f.severity])}>
      <div className="flex items-center gap-2">
        <span className="rounded border border-current px-1.5 text-[10px]">{badge}</span>
        <span className="text-[12.5px] font-medium text-bright">{title}</span>
        {f.evidence && <code className="text-[11px] text-muted break-all">{f.evidence}</code>}
      </div>
      <p className="mt-1 text-[12px] text-muted leading-relaxed">{text}</p>
    </div>
  )
}

export function CorsAuditTool() {
  const l = useLocalized(L)
  const lang = useLocalized({ zh: 'zh' as const, en: 'en' as const })
  const [origin, setOrigin] = usePersistedState('corsaudit', 'origin', '')
  const [trusted, setTrusted] = usePersistedState('corsaudit', 'trusted', '')
  const [headers, setHeaders] = usePersistedState('corsaudit', 'headers', '')
  const [from, setFrom] = useState<string | null>(null)
  useDrainHandoff('corsaudit', (env) => {
    const { origin: o, block } = handoffToCorsBlock(env)
    if (o) setOrigin(o)
    setHeaders(block)
    setFrom(env.sourceLabel)
  })

  const result = useMemo(
    () =>
      headers.trim() ? analyzeCors({ origin, headers, trustedOrigin: trusted || undefined }) : null,
    [origin, headers, trusted],
  )

  return (
    <ToolShell toolId="corsaudit">
      <SecNote scene="cors" />
      {from && <HandoffBadge label={from} onClear={() => setFrom(null)} />}
      <Input
        value={origin}
        onChange={(v) => {
          setOrigin(v)
          setFrom(null)
        }}
        label={l.origin}
        placeholder={l.originPh}
      />
      <Input value={trusted} onChange={setTrusted} label={l.trusted} placeholder={l.trustedPh} />
      <TA
        toolInput
        spellCheck
        value={headers}
        onChange={(v) => {
          setHeaders(v)
          setFrom(null)
        }}
        label={l.headers}
        placeholder={l.headersPh}
        rows={7}
      />
      {result && (
        <>
          <Panel title={l.result}>
            <div className="mb-2 flex gap-4 text-[12px] text-muted">
              <span>
                {l.acao}: <code className="text-bright break-all">{result.acao || '—'}</code>
              </span>
              <span>
                {l.creds}:{' '}
                <code className={result.credentials ? 'text-danger' : 'text-bright'}>
                  {result.credentials ? l.yes : l.no}
                </code>
              </span>
            </div>
            <div className="space-y-2">
              {result.findings.map((f, i) => (
                <FindingRow key={i} f={f} lang={lang} />
              ))}
            </div>
          </Panel>
          {result.poc && (
            <Panel title={l.poc} right={<CopyBtn text={result.poc} />}>
              <pre
                className="codeblock overflow-auto text-[11.5px] leading-relaxed"
                style={{ maxHeight: 360 }}
              >
                {result.poc}
              </pre>
            </Panel>
          )}
          {!result.findings.length && <p className="text-[12px] text-muted">{l.nothing}</p>}
        </>
      )}
    </ToolShell>
  )
}
