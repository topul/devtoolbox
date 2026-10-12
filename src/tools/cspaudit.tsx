/**
 * CSP 策略分析器：粘贴 Content-Security-Policy → 指令解释 + 风险清单。
 * 纯本地分析（toolkit/csp）。
 */
import React, { useMemo, useState } from 'react'
import { CopyBtn, ErrorNote, Panel, TA, ToolShell, usePersistedState } from '../components/ui'
import { HandoffBadge, useDrainHandoff } from '../components/SendTo'
import { useLocalized } from '../lib/i18n'
import { cn } from '../lib/cn'
import { analyzeCsp, type CspFinding, type CspSeverity } from '../lib/toolkit/csp'
import { handoffToCsp } from '../lib/handoff'
import { SecNote } from './secnote'

const L = {
  zh: {
    input: 'Content-Security-Policy 头值',
    ph: "default-src 'self'; script-src 'self' 'unsafe-inline' https://ajax.googleapis.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    directives: '指令拆解',
    findings: '风险与建议',
    clean: '未发现明显危险配置。',
    errNoDirective: '没有解析出任何指令，请粘贴 CSP 头值（形如 default-src ...; script-src ...）',
    bad: '危险',
    warn: '警告',
    info: '提示',
    ok: '良好',
  },
  en: {
    input: 'Content-Security-Policy value',
    ph: "default-src 'self'; script-src 'self' 'unsafe-inline' https://ajax.googleapis.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    directives: 'Directives',
    findings: 'Findings & recommendations',
    clean: 'No risky configuration detected.',
    errNoDirective:
      'No directives parsed — paste a CSP value (e.g. default-src ...; script-src ...)',
    bad: 'Risk',
    warn: 'Warn',
    info: 'Info',
    ok: 'OK',
  },
}

const F: Record<string, { zh: string; en: string }> = {
  'script.unsafeInline': {
    zh: '脚本允许内联（unsafe-inline）：XSS 注入的脚本可直接执行，CSP 对 XSS 基本失效。改用 nonce 或 hash。',
    en: 'Scripts allow unsafe-inline: injected scripts run and CSP no longer mitigates XSS. Use a nonce or hash.',
  },
  'script.unsafeEval': {
    zh: '脚本允许 unsafe-eval：字符串可被当代码执行，扩大了 XSS 利用面。',
    en: 'Scripts allow unsafe-eval: strings can execute as code, widening XSS exploitation.',
  },
  'script.wildcard': {
    zh: '脚本来源是通配符 *：等于允许任意主机的脚本，几乎等于没有 CSP。',
    en: 'Script sources use *: any host can run scripts — close to having no CSP.',
  },
  'script.dataUri': {
    zh: '脚本允许 data:  URI：攻击者可直接用 data: 地址投递脚本。',
    en: 'Scripts allow data: URIs — an attacker can deliver scripts via data: directly.',
  },
  'script.schemeHttp': {
    zh: '脚本允许 http: 源：中间人可向任意 HTTP 主机注入脚本。',
    en: 'Scripts allow http: sources — a MITM can inject scripts from any HTTP host.',
  },
  'script.schemeHttps': {
    zh: '脚本来源放宽到整个 https:：任意 HTTPS 站点都可作为脚本源。',
    en: 'Script sources allow the whole https: scheme — every HTTPS site is a script source.',
  },
  'script.wildcardSubdomain': {
    zh: '通配子域 {e}：任何子域可控（或可被接管）时即可绕过。',
    en: 'Wildcard subdomain {e}: a controllable or dangling subdomain bypasses the policy.',
  },
  'script.fallbackNone': {
    zh: '没有 script-src 且没有 default-src：脚本加载不受任何限制。',
    en: 'No script-src and no default-src: script loading is unrestricted.',
  },
  'script.strictDynamic': {
    zh: '使用 strict-dynamic：由已信任脚本动态插入的脚本自动放行，是现代推荐写法。',
    en: 'strict-dynamic: scripts loaded by trusted scripts propagate trust — the modern recommended approach.',
  },
  'script.nonceOrHash': {
    zh: '使用 nonce/hash 授权脚本：配合移除 unsafe-inline，是 CSP 的正确形态。',
    en: 'Scripts authorized via nonce/hash with unsafe-inline removed — the correct CSP shape.',
  },
  'jsonp.googleapis': {
    zh: '{e} 提供 JSONP / jsapi 端点，可被用来执行任意 JS（Google CDN 常见 JSONP 绕过）。',
    en: '{e} exposes JSONP / jsapi endpoints that execute arbitrary JS (a classic Google CDN JSONP bypass).',
  },
  'jsonp.google': {
    zh: '{e} 的 /jsapi 等端点可执行任意 JS。',
    en: 'Endpoints like /jsapi on {e} can execute arbitrary JS.',
  },
  'jsonp.googleanalytics': {
    zh: '{e} 历史上有 JSONP 端点，放进 script-src 等于放行任意 JS。',
    en: '{e} historically serves JSONP endpoints; in script-src it allows arbitrary JS.',
  },
  'jsonp.gtm': {
    zh: '{e} 可加载自定义容器脚本，等于任意 JS。',
    en: '{e} loads custom container scripts — effectively arbitrary JS.',
  },
  'usercontent.jsdelivr': {
    zh: '{e} 可托管任意 GitHub 仓库内容，等于任意人可发布可执行脚本。',
    en: '{e} serves arbitrary GitHub repository content — anyone can publish executable scripts.',
  },
  'style.wildcard': {
    zh: '样式来源通配符：影响较小，但仍允许 CSS 注入（数据外带 / UI 伪造）。',
    en: 'Wildcard style sources: lower impact, but still permits CSS injection (data exfil / UI spoofing).',
  },
  'object.missing': {
    zh: "缺少 object-src（且 default-src 未覆盖）：建议显式 object-src 'none' 禁用插件。",
    en: "object-src missing (and not covered by default-src): set object-src 'none' to disable plugins.",
  },
  'object.notNone': {
    zh: 'object-src 未设为 none：插件内容仍可嵌入，建议直接禁用。',
    en: 'object-src is not none: plugin content can still be embedded; disable it outright.',
  },
  'baseUri.missing': {
    zh: '缺少 base-uri：攻击者可用 <base> 重写相对路径脚本地址。',
    en: 'base-uri missing: an injected <base> can rewrite relative script URLs.',
  },
  'frameAncestors.missing': {
    zh: '缺少 frame-ancestors：页面可能被任意站点 iframe 嵌套（点击劫持）。',
    en: 'frame-ancestors missing: the page can be framed by any site (clickjacking).',
  },
  'formAction.missing': {
    zh: '缺少 form-action：表单可被提交到攻击者站点外提数据。',
    en: 'form-action missing: forms can post data to attacker sites.',
  },
  'defaultSrc.missing': {
    zh: '缺少 default-src 兜底：未逐项声明的资源类型不受约束。',
    en: 'No default-src fallback: resource types without their own directive are unconstrained.',
  },
  'deploy.noUpgrade': {
    zh: '可加 upgrade-insecure-requests，自动把页面内 http 资源升级为 https。',
    en: 'Consider upgrade-insecure-requests to auto-upgrade http subresources.',
  },
  'deploy.reporting': {
    zh: '已配置 report-to / report-uri：可以收集违规报告，值得保持。',
    en: 'report-to / report-uri configured: violation reports are available — keep it.',
  },
  'directive.unknown': {
    zh: '未识别的指令 {e}：可能是拼写错误或实验性指令，请确认。',
    en: 'Unrecognized directive {e}: likely a typo or experimental directive — verify.',
  },
}

const SEV: Record<CspSeverity, { cls: string; key: 'bad' | 'warn' | 'info' | 'ok' }> = {
  bad: { cls: 'border-danger/40 bg-danger/5', key: 'bad' },
  warn: { cls: 'border-amber/30 bg-amber/5', key: 'warn' },
  info: { cls: 'border-line-soft bg-panel-2', key: 'info' },
  ok: { cls: 'border-phosphor/25 bg-phosphor/5', key: 'ok' },
}

function FindingRow({
  f,
  lang,
  l,
}: {
  f: CspFinding
  lang: 'zh' | 'en'
  l: (typeof L)['zh']
}): React.ReactElement {
  const meta = F[f.id]
  if (!meta) return <></>
  const desc = meta[lang].replace(/\{e\}/g, f.evidence)
  const sev = SEV[f.severity]
  return (
    <div className={cn('rounded-md border px-3 py-2', sev.cls)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-current px-1.5 text-[10px]">{l[sev.key]}</span>
        <code className="text-[11px] text-phosphor">{f.directive}</code>
        {f.evidence && <code className="text-[11px] text-muted break-all">{f.evidence}</code>}
      </div>
      <p className="mt-1 text-[12px] text-muted leading-relaxed">{desc}</p>
    </div>
  )
}

export function CspAuditTool() {
  const l = useLocalized(L)
  const lang = useLocalized({ zh: 'zh' as const, en: 'en' as const })
  const [raw, setRaw] = usePersistedState('cspaudit', 'raw', '')
  const [from, setFrom] = useState<string | null>(null)
  useDrainHandoff('cspaudit', (env) => {
    const csp = handoffToCsp(env)
    if (csp) {
      setRaw(csp)
      setFrom(env.sourceLabel)
    }
  })
  const result = useMemo(() => (raw.trim() ? analyzeCsp(raw) : null), [raw])

  return (
    <ToolShell toolId="cspaudit">
      <SecNote scene="csp" />
      {from && <HandoffBadge label={from} onClear={() => setFrom(null)} />}
      <TA
        toolInput
        spellCheck
        value={raw}
        onChange={(v) => {
          setRaw(v)
          setFrom(null)
        }}
        label={l.input}
        placeholder={l.ph}
        rows={5}
      />
      {result && !result.ok && result.error === 'NO_DIRECTIVE' && (
        <ErrorNote msg={l.errNoDirective} />
      )}
      {result?.ok && (
        <>
          <Panel
            title={`${l.directives} · ${result.directives.length}`}
            right={<CopyBtn text={raw} />}
          >
            <div className="space-y-1.5">
              {result.directives.map((d, i) => (
                <div key={i} className="text-[12px]">
                  <span className="text-phosphor font-medium">{d.name}</span>
                  {d.sources.length > 0 && (
                    <span className="text-bright break-all">
                      {' '}
                      {d.sources.map((s) => (
                        <code key={s} className="mr-1.5 rounded bg-panel-2 px-1 py-0.5 text-[11px]">
                          {s}
                        </code>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title={l.findings}>
            <div className="space-y-2">
              {result.findings.filter((f) => f.severity !== 'ok').length === 0 && (
                <p className="text-[12px] text-phosphor">{l.clean}</p>
              )}
              {result.findings.map((f, i) => (
                <FindingRow key={i} f={f} lang={lang} l={l} />
              ))}
            </div>
          </Panel>
        </>
      )}
    </ToolShell>
  )
}
