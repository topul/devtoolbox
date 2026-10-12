/**
 * SSRF URL 变体生成器：输入内部目标 → 分类的等价写法 + 针对的弱校验说明。
 * 纯本地生成（toolkit/ssrf），不发起请求。
 */
import React, { useMemo } from 'react'
import { CopyBtn, Input, Panel, ToolShell, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { generateSsrfVariants, type SsrfCategory } from '../lib/toolkit/ssrf'
import { SecNote } from './secnote'

const L = {
  zh: {
    target: '内部目标 URL 或主机',
    ph: 'http://127.0.0.1/admin  或  192.168.0.1',
    count: '生成变体',
    all: '全部变体',
    host: '目标主机',
    ipv4Note: '识别为 IPv4，已生成进制 / IPv6 等全部变体',
    domainNote: '识别为域名：进制类变体不适用，仅生成混淆 / 编码类',
    groups: {
      notation: '进制与省略写法',
      ipv6: 'IPv6 映射',
      userinfo: '@ 用户信息段',
      dot: '结尾点 / 多余点',
      encoding: '编码',
      wildcard: '0.0.0.0 通配地址',
      dns: '需要 DNS 的形式',
    } as Record<SsrfCategory, string>,
    bypass: {
      'check.blacklistNotation': '黑名单只认点分十进制',
      'check.decimalLong': '把 IP 当十进制整数解析',
      'check.hexLong': '把 IP 当十六进制整数解析',
      'check.octalLong': '把 IP 当八进制整数解析',
      'check.zeroOctet': '省略值为 0 的段',
      'check.ipv6Mapped': '只校验 IPv4 字面量，漏了 IPv6 映射地址',
      'check.wildcardLocal': ':: 在多数系统上代表本机',
      'check.zeroLocalhost': '0.0.0.0 / 0 在客户端常被解析为本机',
      'check.trailingDot': '结尾点改变字符串匹配但不改变解析结果',
      'check.percentDecode': '校验先于百分号解码',
      'check.doubleEncodePath': '二次编码路径段',
      'check.userinfoBeforeHost': '把 @ 前的可信域名当成了 host',
      'check.userinfoSuffixTrust': '@ 后段混淆 userinfo / host 边界',
      'check.dnsResolver': '依赖公共解析服务返回 127.0.0.1',
      'check.dnsLocalDomain': '保留域名直接解析到本机',
      'check.caseSensitive': '主机名大小写不敏感但字符串比较敏感',
    } as Record<string, string>,
  },
  en: {
    target: 'Internal target URL or host',
    ph: 'http://127.0.0.1/admin  or  192.168.0.1',
    count: 'variants generated',
    all: 'All variants',
    host: 'Target host',
    ipv4Note: 'Recognized as IPv4 — all notation / IPv6 variants generated',
    domainNote: 'Recognized as a hostname — base variants do not apply; confusion / encoding only',
    groups: {
      notation: 'Notation & shorthand',
      ipv6: 'IPv6 mappings',
      userinfo: '@ userinfo confusion',
      dot: 'Trailing / extra dots',
      encoding: 'Encoding',
      wildcard: '0.0.0.0 wildcard',
      dns: 'DNS-based forms',
    } as Record<SsrfCategory, string>,
    bypass: {
      'check.blacklistNotation': 'Denylist only knows dotted decimal',
      'check.decimalLong': 'IP parsed as a decimal integer',
      'check.hexLong': 'IP parsed as a hex integer',
      'check.octalLong': 'IP parsed as an octal integer',
      'check.zeroOctet': 'Zero octets omitted',
      'check.ipv6Mapped': 'Only IPv4 literals checked, IPv6-mapped addresses missed',
      'check.wildcardLocal': ':: means localhost on most systems',
      'check.zeroLocalhost': '0.0.0.0 / 0 often resolves to localhost client-side',
      'check.trailingDot': 'The dot changes string matching but not resolution',
      'check.percentDecode': 'Validation happens before percent-decoding',
      'check.doubleEncodePath': 'Double-encoded path segment',
      'check.userinfoBeforeHost': 'Trusted name before @ mistaken for the host',
      'check.userinfoSuffixTrust': 'Post-@ segment blurs userinfo / host boundary',
      'check.dnsResolver': 'Public resolver returns 127.0.0.1',
      'check.dnsLocalDomain': 'Reserved domain resolves to localhost',
      'check.caseSensitive': 'Hostnames are case-insensitive, string compares are not',
    } as Record<string, string>,
  },
}

const CAT_ORDER: SsrfCategory[] = [
  'notation',
  'ipv6',
  'wildcard',
  'dot',
  'encoding',
  'userinfo',
  'dns',
]

export function SsrfTool() {
  const l = useLocalized(L)
  const [target, setTarget] = usePersistedState('ssrf', 'target', '')
  const result = useMemo(() => (target.trim() ? generateSsrfVariants(target) : null), [target])
  const allText = result?.ok ? result.variants.map((v) => v.value).join('\n') : ''

  return (
    <ToolShell toolId="ssrf">
      <SecNote scene="ssrf" />
      <Input value={target} onChange={setTarget} label={l.target} placeholder={l.ph} />
      {result?.ok && (
        <>
          <p className="text-[12px] text-muted">
            {l.host}: <code className="text-phosphor">{result.host}</code> ·{' '}
            {result.variants.length} {l.count}
            {' — '}
            {result.isIpv4 ? l.ipv4Note : l.domainNote}
          </p>
          <Panel right={<CopyBtn text={allText} />} title={l.all}>
            <div className="space-y-3">
              {CAT_ORDER.filter((c) => result.variants.some((v) => v.category === c)).map((cat) => (
                <div key={cat}>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
                    {l.groups[cat]}
                  </div>
                  <div className="space-y-1">
                    {result.variants
                      .filter((v) => v.category === cat)
                      .map((v, i) => (
                        <div key={i} className="group flex items-start gap-2">
                          <code className="min-w-0 flex-1 break-all rounded bg-panel-2 px-2 py-1 text-[11.5px] text-bright">
                            {v.value}
                          </code>
                          <span className="shrink-0 text-[11px] text-muted">
                            {l.bypass[v.bypassId] ?? v.bypassId}
                          </span>
                          <CopyBtn text={v.value} className="opacity-0 group-hover:opacity-100" />
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
