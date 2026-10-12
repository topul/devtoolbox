/**
 * Raw HTTP 请求分析器：粘贴原始请求 → 结构化拆解 + 攻击面观察。
 * 纯本地解析（toolkit/httpraw），不发起任何网络请求。
 */
import React, { useMemo, useState } from 'react'
import { CopyBtn, ErrorNote, Panel, TA, ToolShell, usePersistedState } from '../components/ui'
import { SendToMenu, HandoffBadge, useDrainHandoff } from '../components/SendTo'
import { useLocalized } from '../lib/i18n'
import { cn } from '../lib/cn'
import {
  parseRawRequest,
  type Observation,
  type ObservationLevel,
  type ParamTag,
} from '../lib/toolkit/httpraw'
import { handoffToRaw, type HandoffPayload } from '../lib/handoff'
import { SecNote } from './secnote'

const L = {
  zh: {
    input: '原始 HTTP 请求',
    ph: 'POST /api/order?id=123 HTTP/1.1\nHost: example.com\nCookie: session=abc\nContent-Type: application/x-www-form-urlencoded\n\nredirect_url=/home&q=test',
    requestLine: '请求行',
    headers: '请求头',
    cookies: 'Cookie',
    params: '参数',
    observations: '安全观察',
    locQuery: 'Query',
    locBody: 'Body',
    locCookie: 'Cookie',
    noParam: '（无可解析参数）',
    noObs: '没有发现需要特别留意的特征。',
    tag: {
      ssrf: 'SSRF 候选',
      redirect: '开放重定向候选',
      lfi: '文件/路径候选',
      sqli: '注入候选',
      xss: 'XSS 候选',
      ssti: '模板注入候选',
      idor: '越权候选',
      xxe: 'XXE 候选',
    } as Record<ParamTag, string>,
    errLine: '无法识别为 HTTP 请求：首行应形如「GET /path HTTP/1.1」',
  },
  en: {
    input: 'Raw HTTP request',
    ph: 'POST /api/order?id=123 HTTP/1.1\nHost: example.com\nCookie: session=abc\nContent-Type: application/x-www-form-urlencoded\n\nredirect_url=/home&q=test',
    requestLine: 'Request line',
    headers: 'Headers',
    cookies: 'Cookies',
    params: 'Parameters',
    observations: 'Security observations',
    locQuery: 'Query',
    locBody: 'Body',
    locCookie: 'Cookie',
    noParam: '(no parsable parameters)',
    noObs: 'Nothing notable detected.',
    tag: {
      ssrf: 'SSRF candidate',
      redirect: 'Open redirect candidate',
      lfi: 'File/path candidate',
      sqli: 'Injection candidate',
      xss: 'XSS candidate',
      ssti: 'SSTI candidate',
      idor: 'IDOR candidate',
      xxe: 'XXE candidate',
    } as Record<ParamTag, string>,
    errLine: 'Not an HTTP request: the first line should look like "GET /path HTTP/1.1"',
  },
}

/** 观察点 id → 双语标题 + 说明（{e} 会被 evidence 替换） */
const OBS: Record<string, { zh: [string, string]; en: [string, string] }> = {
  'auth.header': {
    zh: ['携带 Authorization 头', '认证方案：{e}。重放/转发时注意它会随请求一起走。'],
    en: [
      'Authorization header present',
      'Scheme: {e}. It travels with the request on replay or forwarding.',
    ],
  },
  'auth.cookie': {
    zh: ['携带会话 Cookie', '会话相关 Cookie：{e}。'],
    en: ['Session cookies present', 'Session-related cookies: {e}.'],
  },
  'auth.custom': {
    zh: ['自定义凭据头', '头 {e} 里通常放着 API Key / 代理凭据。'],
    en: ['Custom credential header', '{e} commonly carries an API key / proxy credential.'],
  },
  'secret.in.param': {
    zh: [
      '疑似凭据出现在参数里',
      '{e} —— 密码 / token 出现在 URL 或表单里，会被代理、日志、浏览器历史记录留存。',
    ],
    en: [
      'Possible credential in a parameter',
      '{e} — passwords / tokens in URLs or forms get persisted by proxies, logs and browser history.',
    ],
  },
  'param.ssrf': {
    zh: ['SSRF 候选参数', '{e}：若其值被服务端拿去发起请求，测内网 / 元数据地址。'],
    en: [
      'SSRF candidate',
      '{e}: if the server fetches its value, test internal / metadata addresses.',
    ],
  },
  'param.redirect': {
    zh: ['开放重定向候选参数', '{e}：检查是否严格同源校验。'],
    en: ['Open redirect candidate', '{e}: check for strict same-origin validation.'],
  },
  'param.lfi': {
    zh: ['文件 / 路径候选参数', '{e}：关注路径穿越、绝对路径、封装协议。'],
    en: ['File / path candidate', '{e}: check traversal, absolute paths, wrapper schemes.'],
  },
  'param.sqli': {
    zh: ['SQL 注入候选参数', '{e}：按注入点优先级测试（报错 / 布尔 / 时间）。'],
    en: ['SQL injection candidate', '{e}: prioritize it for error / boolean / time-based tests.'],
  },
  'param.xss': {
    zh: ['XSS 候选参数', '{e}：观察值是否回显到 HTML / 属性 / JS 上下文。'],
    en: [
      'XSS candidate',
      '{e}: see whether the value reflects into HTML / attribute / JS contexts.',
    ],
  },
  'param.ssti': {
    zh: ['模板注入候选参数', '{e}：尝试数学表达式探针，确认服务端模板引擎。'],
    en: ['SSTI candidate', '{e}: probe with math expressions to fingerprint the template engine.'],
  },
  'param.idor': {
    zh: ['越权 (IDOR) 候选参数', '{e}：换两个账号的标识重放，比对对象级鉴权。'],
    en: [
      'IDOR candidate',
      '{e}: replay with identifiers from two accounts and compare object-level checks.',
    ],
  },
  'param.xxe': {
    zh: ['XML / XXE 面', '{e}：若解析 XML，测试外部实体注入。'],
    en: ['XML / XXE surface', '{e}: when XML is parsed, test external entity injection.'],
  },
  'spoof.ip': {
    zh: ['可伪造的来源 IP 头', '{e}：服务端若信任它做鉴权 / 限流，可直接伪造。'],
    en: [
      'Spoofable source-IP header',
      '{e}: if trusted for auth / rate limiting, it can be forged directly.',
    ],
  },
  'spoof.host': {
    zh: ['可伪造的 Host 类头', '{e}：关联缓存投毒、密码重置链接投毒、路由绕过。'],
    en: [
      'Spoofable Host header',
      '{e}: relevant to cache poisoning, reset-link poisoning and routing bypass.',
    ],
  },
  'body.noContentType': {
    zh: ['Body 缺少 Content-Type', '服务端如何解析 body 取决于实现，可能造成解析分歧。'],
    en: [
      'Body without Content-Type',
      'How the server parses the body is implementation-defined and may diverge.',
    ],
  },
  'body.xml': {
    zh: ['XML 请求体', 'Content-Type: {e}，关注 XXE / 十亿笑声等解析攻击。'],
    en: ['XML body', 'Content-Type: {e}; consider XXE and parser-exhaustion attacks.'],
  },
}

const LEVEL_STYLE: Record<ObservationLevel, string> = {
  info: 'border-phosphor/25 bg-phosphor/5',
  warn: 'border-amber/30 bg-amber/5',
  bad: 'border-danger/40 bg-danger/5',
}

function ObservationRow({ o, lang }: { o: Observation; lang: 'zh' | 'en' }): React.ReactElement {
  const meta = OBS[o.id]
  if (!meta) return <></>
  const [title, desc] = meta[lang]
  return (
    <div className={cn('rounded-md border px-3 py-2', LEVEL_STYLE[o.level])}>
      <div className="text-[12.5px] font-medium text-bright">{title}</div>
      <div
        className="text-[12px] text-muted leading-relaxed"
        dangerouslySetInnerHTML={{
          __html: desc.replace(
            /\{e\}/g,
            `<code class="text-phosphor">${escapeHtml(o.evidence)}</code>`,
          ),
        }}
      />
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  )
}

export function HttpRawTool() {
  const l = useLocalized(L)
  const lang = useLocalized({ zh: 'zh' as const, en: 'en' as const })
  const [raw, setRaw] = usePersistedState('httpreq', 'raw', '')
  const [from, setFrom] = useState<string | null>(null)
  useDrainHandoff('httpreq', (env) => {
    setRaw(handoffToRaw(env))
    setFrom(env.sourceLabel)
  })
  const result = useMemo(() => (raw.trim() ? parseRawRequest(raw) : null), [raw])
  const req = result?.ok ? result.request! : null
  const obs = result?.ok ? result.observations! : []

  /** 从已解析请求反推交接载荷：origin-form 借 Host 头还原绝对 URL */
  const handoff = useMemo<HandoffPayload | null>(() => {
    if (!req) return null
    let url = req.target
    if (!/^https?:\/\//i.test(req.target)) {
      const host = req.headers.find((h) => h.name.toLowerCase() === 'host')?.value
      url = host ? `http://${host}${req.target}` : req.target
    }
    return {
      sourceLabel: `${req.method} ${req.target}`,
      method: req.method,
      url,
      reqHeaders: req.headers.map((h) => [h.name, h.value] as [string, string]),
      reqBodyText: req.body || null,
    }
  }, [req])

  return (
    <ToolShell toolId="httpreq">
      <SecNote scene="httpreq" />
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
        rows={10}
      />
      {handoff && (
        <div className="flex justify-end">
          <SendToMenu payload={handoff} />
        </div>
      )}
      {result && !result.ok && result.error === 'BAD_REQUEST_LINE' && <ErrorNote msg={l.errLine} />}
      {req && (
        <>
          <Panel title={l.requestLine}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
              <span>
                <span className="text-muted">Method </span>
                <code className="text-phosphor">{req.method}</code>
              </span>
              <span className="min-w-0">
                <span className="text-muted">Path </span>
                <code className="text-bright break-all">{req.target}</code>
              </span>
              <span>
                <span className="text-muted">Version </span>
                <code className="text-bright">{req.version}</code>
              </span>
            </div>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Panel title={`${l.headers} · ${req.headers.length}`}>
              <div className="space-y-1">
                {req.headers.map((h, i) => (
                  <div key={i} className="text-[12px] break-all">
                    <span className="text-phosphor">{h.name}</span>
                    <span className="text-muted">: </span>
                    <span className="text-bright">{h.value}</span>
                  </div>
                ))}
              </div>
            </Panel>

            {req.cookies.length > 0 && (
              <Panel title={`${l.cookies} · ${req.cookies.length}`}>
                <div className="space-y-1">
                  {req.cookies.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px]">
                      <span className="text-phosphor shrink-0">{c.name}</span>
                      <span className="text-muted">=</span>
                      <span className="text-bright break-all">{c.value}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>

          <Panel
            title={`${l.params} · ${req.params.length}`}
            right={
              <CopyBtn
                text={req.params.map((p) => `${p.location}:${p.name}=${p.value}`).join('\n')}
              />
            }
          >
            {req.params.length === 0 ? (
              <p className="text-[12px] text-muted">{l.noParam}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-muted border-b border-line-soft">
                      <th className="py-1 pr-2 font-normal">#</th>
                      <th className="py-1 pr-2 font-normal">{lang === 'zh' ? '位置' : 'Where'}</th>
                      <th className="py-1 pr-2 font-normal">Name</th>
                      <th className="py-1 pr-2 font-normal">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {req.params.map((p, i) => (
                      <tr key={i} className="border-b border-line-soft/50">
                        <td className="py-1 pr-2 text-muted">{i + 1}</td>
                        <td className="py-1 pr-2">
                          {p.location === 'query'
                            ? l.locQuery
                            : p.location === 'body'
                              ? l.locBody
                              : l.locCookie}
                        </td>
                        <td className="py-1 pr-2 text-bright break-all">{p.name}</td>
                        <td className="py-1 pr-2 text-muted break-all max-w-[260px]">
                          <span className="line-clamp-2">{p.value}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {req.params.some((p) => p.tags.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {req.params
                      .filter((p) => p.tags.length)
                      .map((p, i) => (
                        <span key={i} className="text-[11px] text-amber">
                          {p.location}:{p.name} →{' '}
                          {p.tags.map((t) => l.tag[t]).join(lang === 'zh' ? '、' : ', ')}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title={l.observations}>
            <div className="space-y-2">
              {obs.length === 0 ? (
                <p className="text-[12px] text-muted">{l.noObs}</p>
              ) : (
                obs.map((o, i) => <ObservationRow key={i} o={o} lang={lang} />)
              )}
            </div>
          </Panel>
        </>
      )}
    </ToolShell>
  )
}
