/**
 * 开放重定向 Payload 生成器：输入回跳目标 → 按绕过手法分类的载荷清单。
 * 纯本地生成（toolkit/redirect），不发起请求。
 */
import React, { useMemo } from 'react'
import { CopyBtn, Input, Panel, ToolShell, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { generateRedirectPayloads, type RedirectCategory } from '../lib/toolkit/redirect'
import { SecNote } from './secnote'

const L = {
  zh: {
    target: '回跳目标（攻击者站点）',
    targetPh: 'evil.com',
    trusted: '被信任站点（用于 @ 混淆演示）',
    trustedPh: 'trusted.local',
    count: '条载荷',
    all: '全部载荷',
    groups: {
      protocolRelative: '协议相对（绕过 scheme / 首字符检查）',
      backslash: '反斜杠（利用解析差异）',
      schemeAbuse: '协议滥用',
      userinfo: '@ 用户信息段',
      suffix: '后缀 / 包含绕过',
      whitespace: '空白字符',
      encoding: '编码',
      javascript: 'DOM sink（伪协议）',
    } as Record<RedirectCategory, string>,
    bypass: {
      'check.startsWithSlash': '检查「以 / 开头」即放行，// 仍跳到外域',
      'check.tripleSlash': '多余斜杠绕过前缀检查',
      'check.quadSlash': '更多斜杠',
      'check.backslash': '/\\ 被浏览器归一化成 //',
      'check.mixedSlash': '正反斜杠混用',
      'check.schemeBackslash': '反斜杠分隔的协议 URL',
      'check.pathTraversalSuffix': '路径穿越后缀',
      'check.colonScheme': '协议名后直接跟主机',
      'check.encodedSlash': '斜杠编码',
      'check.relativeEscape': '多级相对路径跳出',
      'check.userinfo': '@ 前是可信域名，真正主机在 @ 后',
      'check.userinfoScheme': '带协议的 userinfo 形式',
      'check.userinfoSuffix': '反向形态，针对后匹配逻辑',
      'check.suffixDomain': '可信域名被当作后缀',
      'check.subdomainPrefix': '可信域名成为攻击者子域',
      'check.pathContainsTrusted': '路径里包含可信串',
      'check.queryContainsTrusted': '查询串里包含可信串',
      'check.fragmentContainsTrusted': 'fragment 里包含可信串',
      'check.leadingSpace': '前导空格被 strip 后跳转',
      'check.leadingTab': '前导 Tab',
      'check.trailingNewline': '结尾换行',
      'check.embeddedNewline': '内嵌换行',
      'check.encodedSlashes': '两个斜杠整体编码',
      'check.encodedBackslashes': '反斜杠编码',
      'check.encodedHost': '主机名编码',
      'check.unicodeDot': '全角句号归一化',
      'sink.domXss': 'location 类 sink 直接执行 JS',
      'sink.dataUrl': 'data: 文档跳转',
    } as Record<string, string>,
  },
  en: {
    target: 'Redirect target (attacker site)',
    targetPh: 'evil.com',
    trusted: 'Trusted site (for @ confusion demo)',
    trustedPh: 'trusted.local',
    count: 'payloads',
    all: 'All payloads',
    groups: {
      protocolRelative: 'Protocol-relative (scheme / first-char checks)',
      backslash: 'Backslashes (parser differences)',
      schemeAbuse: 'Scheme abuse',
      userinfo: '@ userinfo',
      suffix: 'Suffix / contains bypass',
      whitespace: 'Whitespace',
      encoding: 'Encoding',
      javascript: 'DOM sinks (pseudo schemes)',
    } as Record<RedirectCategory, string>,
    bypass: {
      'check.startsWithSlash': 'A "starts with /" check passes, // still leaves the site',
      'check.tripleSlash': 'Extra slashes beat prefix checks',
      'check.quadSlash': 'Even more slashes',
      'check.backslash': 'Browsers normalize /\\ to //',
      'check.mixedSlash': 'Mixed slash directions',
      'check.schemeBackslash': 'Scheme URL with backslashes',
      'check.pathTraversalSuffix': 'Traversal suffix',
      'check.colonScheme': 'Host directly after the scheme colon',
      'check.encodedSlash': 'Encoded slash',
      'check.relativeEscape': 'Multi-level relative escape',
      'check.userinfo': 'Trusted name before @, real host after it',
      'check.userinfoScheme': 'Userinfo form with scheme',
      'check.userinfoSuffix': 'Reversed form for suffix logic',
      'check.suffixDomain': 'Trusted domain treated as a suffix',
      'check.subdomainPrefix': 'Trusted domain becomes an attacker subdomain',
      'check.pathContainsTrusted': 'Trusted string hidden in the path',
      'check.queryContainsTrusted': 'Trusted string hidden in the query',
      'check.fragmentContainsTrusted': 'Trusted string hidden in the fragment',
      'check.leadingSpace': 'Leading space gets stripped, then redirects',
      'check.leadingTab': 'Leading tab',
      'check.trailingNewline': 'Trailing newline',
      'check.embeddedNewline': 'Embedded newline',
      'check.encodedSlashes': 'Both slashes percent-encoded',
      'check.encodedBackslashes': 'Encoded backslashes',
      'check.encodedHost': 'Encoded host',
      'check.unicodeDot': 'Fullwidth dot normalization',
      'sink.domXss': 'JS executes directly in location sinks',
      'sink.dataUrl': 'Redirect via a data: document',
    } as Record<string, string>,
  },
}

const ORDER: RedirectCategory[] = [
  'protocolRelative',
  'backslash',
  'schemeAbuse',
  'userinfo',
  'suffix',
  'whitespace',
  'encoding',
  'javascript',
]

export function RedirectTool() {
  const l = useLocalized(L)
  const [target, setTarget] = usePersistedState('redirect', 'target', 'evil.com')
  const [trusted, setTrusted] = usePersistedState('redirect', 'trusted', 'trusted.local')
  const result = useMemo(() => generateRedirectPayloads(target, trusted), [target, trusted])
  const allText = result.ok ? result.payloads.map((p) => p.value).join('\n') : ''

  return (
    <ToolShell toolId="redirect">
      <SecNote scene="redirect" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input value={target} onChange={setTarget} label={l.target} placeholder={l.targetPh} />
        <Input value={trusted} onChange={setTrusted} label={l.trusted} placeholder={l.trustedPh} />
      </div>
      {result.ok && (
        <>
          <p className="text-[12px] text-muted">
            {result.payloads.length} {l.count}
          </p>
          <Panel title={l.all} right={<CopyBtn text={allText} />}>
            <div className="space-y-3">
              {ORDER.filter((c) => result.payloads.some((p) => p.category === c)).map((cat) => (
                <div key={cat}>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
                    {l.groups[cat]}
                  </div>
                  <div className="space-y-1">
                    {result.payloads
                      .filter((p) => p.category === cat)
                      .map((p, i) => (
                        <div key={i} className="group flex items-center gap-2">
                          <code className="min-w-0 flex-1 break-all rounded bg-panel-2 px-2 py-1 text-[11.5px] text-bright">
                            {p.value}
                          </code>
                          <span className="hidden shrink-0 text-[11px] text-muted md:inline">
                            {l.bypass[p.bypassId] ?? p.bypassId}
                          </span>
                          <CopyBtn text={p.value} className="opacity-0 group-hover:opacity-100" />
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </ToolShell>
  )
}
