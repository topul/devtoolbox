/**
 * Nmap 输出解析器：粘贴普通 / -oG / -oX 输出 → 主机端口表。
 * 纯本地解析（toolkit/nmap），不发起任何扫描。
 */
import React, { useMemo } from 'react'
import { CopyBtn, ErrorNote, Panel, Stat, TA, ToolShell, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { cn } from '../lib/cn'
import { parseNmap } from '../lib/toolkit/nmap'
import { SecNote } from './secnote'

const L = {
  zh: {
    input: 'Nmap 输出（普通文本 / -oG / -oX 自动识别）',
    ph: 'Nmap scan report for db.internal (10.0.0.5)\nPORT     STATE SERVICE\n22/tcp   open  ssh\n5432/tcp open  postgresql',
    hosts: '主机',
    openPorts: '开放端口',
    format: { grepable: 'grepable (-oG)', xml: 'XML (-oX)', normal: '普通文本' },
    empty: '（该主机未扫出端口）',
    errUnrecognized: '无法识别：请粘贴 nmap 的普通输出、-oG（grepable）或 -oX（XML）',
    stateOpen: '开放',
    colPort: '端口',
    colProto: '协议',
    colState: '状态',
    colService: '服务',
    colVersion: '版本',
    copyCsv: '复制 CSV',
  },
  en: {
    input: 'Nmap output (normal / -oG / -oX auto-detected)',
    ph: 'Nmap scan report for db.internal (10.0.0.5)\nPORT     STATE SERVICE\n22/tcp   open  ssh\n5432/tcp open  postgresql',
    hosts: 'hosts',
    openPorts: 'open ports',
    format: { grepable: 'grepable (-oG)', xml: 'XML (-oX)', normal: 'normal text' },
    empty: '(no ports for this host)',
    errUnrecognized: 'Unrecognized: paste nmap normal output, -oG (grepable) or -oX (XML)',
    stateOpen: 'open',
    colPort: 'Port',
    colProto: 'Proto',
    colState: 'State',
    colService: 'Service',
    colVersion: 'Version',
    copyCsv: 'Copy CSV',
  },
}

function toCsv(hosts: ReturnType<typeof parseNmap>['hosts']): string {
  const rows = [['ip', 'hostname', 'port', 'protocol', 'state', 'service', 'version']]
  for (const h of hosts)
    for (const p of h.ports)
      rows.push([h.ip, h.hostname, String(p.port), p.protocol, p.state, p.service, p.version ?? ''])
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
}

export function NmapTool() {
  const l = useLocalized(L)
  const [raw, setRaw] = usePersistedState('nmap-parse', 'raw', '')
  const result = useMemo(() => (raw.trim() ? parseNmap(raw) : null), [raw])

  return (
    <ToolShell toolId="nmap-parse">
      <SecNote scene="nmap" />
      <TA
        toolInput
        spellCheck
        value={raw}
        onChange={setRaw}
        label={l.input}
        placeholder={l.ph}
        rows={9}
      />
      {result && !result.ok && result.error === 'UNRECOGNIZED' && (
        <ErrorNote msg={l.errUnrecognized} />
      )}
      {result?.ok && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Stat
              label={l.format[result.format]}
              value={String(result.hosts.length) + ' ' + l.hosts}
            />
            <Stat label={l.openPorts} value={String(result.openCount)} />
            <CopyBtn text={toCsv(result.hosts)} label={l.copyCsv} />
          </div>
          {result.hosts.map((h, i) => (
            <Panel
              key={i}
              title={h.hostname ? `${h.hostname} (${h.ip})` : h.ip}
              right={<span className="text-[11px] text-muted">{h.ports.length} ports</span>}
            >
              {h.ports.length === 0 ? (
                <p className="text-[12px] text-muted">{l.empty}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-muted border-b border-line-soft">
                        <th className="py-1 pr-3 font-normal">{l.colPort}</th>
                        <th className="py-1 pr-3 font-normal">{l.colProto}</th>
                        <th className="py-1 pr-3 font-normal">{l.colState}</th>
                        <th className="py-1 pr-3 font-normal">{l.colService}</th>
                        <th className="py-1 font-normal">{l.colVersion}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.ports.map((p, j) => (
                        <tr key={j} className="border-b border-line-soft/50">
                          <td className="py-1 pr-3 text-bright">{p.port}</td>
                          <td className="py-1 pr-3 text-muted">{p.protocol}</td>
                          <td className="py-1 pr-3">
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 text-[10.5px]',
                                p.state === 'open'
                                  ? 'bg-phosphor-faint text-phosphor'
                                  : p.state === 'filtered'
                                    ? 'bg-amber/10 text-amber'
                                    : 'bg-panel-2 text-muted',
                              )}
                            >
                              {p.state}
                            </span>
                          </td>
                          <td className="py-1 pr-3 text-bright">{p.service}</td>
                          <td className="py-1 text-muted break-all">{p.version ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ))}
        </>
      )}
    </ToolShell>
  )
}
