/**
 * 本机信息 —— IP / 系统 / CPU / 内存 / 网卡 / 磁盘的只读快照。
 * 取数在主进程（node:os + df/route 只读命令），IPC 契约在 lib/sysinfo-types.ts。
 * 纯展示与格式化逻辑来自 toolkit/sysinfo（单测覆盖解析部分）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Btn, CopyBtn, ErrorNote, KV, Panel, Stat, ToolShell } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { cn } from '../lib/cn'
import { uptimeParts } from '../lib/toolkit/sysinfo'
import { formatDataSize } from '../lib/toolkit/units'
import type { SysInfoResult } from '../lib/sysinfo-types'
import { SecNote } from './secnote'

const L = {
  zh: {
    refresh: '刷新',
    refreshing: '采集中…',
    auto: '实时刷新（每 4 秒）',
    autoOn: '停止实时',
    desktopOnly: '此工具需要桌面版（要读取本机系统信息与执行 df / route），网页版不可用。',
    overview: '概览',
    resources: '资源占用',
    network: '网络',
    disks: '磁盘',
    system: '系统与环境',
    hostname: '主机名',
    os: '操作系统',
    arch: '架构',
    uptime: '已运行',
    cpu: 'CPU',
    cores: '逻辑核心',
    memory: '内存',
    load: '平均负载（1/5/15 分钟）',
    loadNa: 'Windows 不提供',
    primaryIp: '本机主 IP',
    ipv4: 'IPv4',
    ipv6: 'IPv6',
    gateway: '默认网关',
    iface: '出口网卡',
    ifaces: '全部网卡',
    colIface: '网卡',
    colAddr: '地址',
    colMac: 'MAC',
    colCidr: '网段',
    loopback: '回环/内部',
    noDisk: '未取到磁盘信息（可能是 df 不可用，见下方告警）',
    avail: '可用',
    used: '已用',
    release: '内核版本',
    version: '系统版本',
    machine: '机器类型',
    endian: '字节序',
    user: '当前用户',
    shell: 'Shell',
    homedir: '用户目录',
    tmpdir: '临时目录',
    commands: '采集所用命令（全部只读）',
    warnings: '部分信息采集失败',
    collectedAt: '采集时间',
    day: '天',
    hour: '小时',
    minute: '分',
    second: '秒',
    copy: '复制',
    speed: '主频',
  },
  en: {
    refresh: 'Refresh',
    refreshing: 'Collecting…',
    auto: 'Live refresh (every 4s)',
    autoOn: 'Stop live',
    desktopOnly:
      'This tool needs the desktop app (it reads local OS info and shells out to df / route); unavailable on the web.',
    overview: 'Overview',
    resources: 'Resources',
    network: 'Network',
    disks: 'Disks',
    system: 'System & environment',
    hostname: 'Hostname',
    os: 'Operating system',
    arch: 'Architecture',
    uptime: 'Uptime',
    cpu: 'CPU',
    cores: 'Logical cores',
    memory: 'Memory',
    load: 'Load average (1/5/15 min)',
    loadNa: 'not available on Windows',
    primaryIp: 'Primary IP',
    ipv4: 'IPv4',
    ipv6: 'IPv6',
    gateway: 'Default gateway',
    iface: 'Egress interface',
    ifaces: 'All interfaces',
    colIface: 'Interface',
    colAddr: 'Address',
    colMac: 'MAC',
    colCidr: 'CIDR',
    loopback: 'loopback/internal',
    noDisk: 'No disk info (df may be unavailable — see warnings below)',
    avail: 'free',
    used: 'used',
    release: 'Kernel release',
    version: 'OS version',
    machine: 'Machine',
    endian: 'Endianness',
    user: 'Current user',
    shell: 'Shell',
    homedir: 'Home',
    tmpdir: 'Temp dir',
    commands: 'Commands used (all read-only)',
    warnings: 'Some data could not be collected',
    collectedAt: 'Collected at',
    day: 'd ',
    hour: 'h ',
    minute: 'm ',
    second: 's',
    copy: 'Copy',
    speed: 'Clock',
  },
}

function pctColor(p: number): string {
  return p >= 90 ? 'bg-danger' : p >= 70 ? 'bg-amber' : 'bg-phosphor'
}

function Bar({ percent, className }: { percent: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded bg-panel-2', className)}>
      <div
        className={cn('h-full rounded transition-[width] duration-500', pctColor(percent))}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  )
}

function fmtUptime(seconds: number, l: (typeof L)['zh']): string {
  const p = uptimeParts(seconds)
  const parts: string[] = []
  if (p.days) parts.push(`${p.days}${l.day}`)
  if (p.hours || p.days) parts.push(`${p.hours}${l.hour}`)
  if (p.minutes || p.hours || p.days) parts.push(`${p.minutes}${l.minute}`)
  parts.push(`${p.seconds}${l.second}`)
  return parts.join(' ').trim()
}

function familyTag(f: 'IPv4' | 'IPv6'): React.ReactNode {
  return (
    <span
      className={cn(
        'px-1 rounded text-[10px]',
        f === 'IPv4' ? 'bg-phosphor/15 text-phosphor' : 'bg-panel-2 text-muted',
      )}
    >
      {f}
    </span>
  )
}

export function SysInfoTool() {
  const l = useLocalized(L)
  const lang = useLocalized({ zh: 'zh' as const, en: 'en' as const })
  const [info, setInfo] = useState<SysInfoResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [auto, setAuto] = useState(false)
  const busyRef = useRef(false)
  const desktop = typeof window !== 'undefined' && !!window.electronAPI?.system

  const load = useCallback(async () => {
    if (!window.electronAPI || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const r = await window.electronAPI.system.info()
      setInfo(r)
      setErr(r.ok ? null : (r.error ?? 'UNKNOWN'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (desktop) void load()
  }, [desktop, load])

  useEffect(() => {
    if (!auto) return
    const id = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(id)
  }, [auto, load])

  const primaryV4 = info?.interfaces
    .filter((i) => !i.internal && i.family === 'IPv4')
    .map((i) => i.address)[0]
  const primaryV6 = info?.interfaces
    .filter((i) => !i.internal && i.family === 'IPv6' && !/^fe80:/i.test(i.address))
    .map((i) => i.address)[0]

  return (
    <ToolShell toolId="sysinfo">
      <SecNote scene="sysinfo" />
      {!desktop && <ErrorNote msg={l.desktopOnly} />}
      {desktop && (
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={() => void load()} disabled={busy}>
            {busy ? l.refreshing : l.refresh}
          </Btn>
          <Btn onClick={() => setAuto((v) => !v)}>{auto ? l.autoOn : l.auto}</Btn>
          {info && (
            <span className="text-[11px] text-muted">
              {l.collectedAt}:{' '}
              {new Date(info.collectedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                hour12: false,
              })}
            </span>
          )}
        </div>
      )}
      <ErrorNote msg={err} />
      {info?.ok && (
        <>
          {info.warnings.length > 0 && (
            <Panel title={l.warnings}>
              <ul className="list-disc pl-5 text-[12px] text-amber space-y-0.5">
                {info.warnings.map((w, i) => (
                  <li key={i} className="font-mono break-all">
                    {w}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={l.overview}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label={l.hostname} value={<span className="font-mono">{info.hostname}</span>} />
              <Stat label={l.os} value={`${info.osType} ${info.osRelease}`} />
              <Stat label={l.arch} value={`${info.arch} · ${info.machine}`} />
              <Stat label={l.uptime} value={fmtUptime(info.uptimeSeconds, l)} />
            </div>
          </Panel>

          <Panel title={l.resources}>
            <div className="space-y-4">
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12.5px]">
                    {l.cpu} · <span className="text-muted">{info.cpu.model || '—'}</span>
                  </span>
                  <span className="font-mono text-[12px] text-phosphor">
                    {info.cpu.overallPercent.toFixed(1)}%
                  </span>
                </div>
                <Bar percent={info.cpu.overallPercent} className="mt-1" />
                <div className="mt-1 text-[11px] text-muted">
                  {info.cpu.cores} {l.cores}
                  {info.cpu.speedMhz > 0 && (
                    <>
                      {' '}
                      · {l.speed} {info.cpu.speedMhz} MHz
                    </>
                  )}
                </div>
                {info.cpu.perCorePercent.length > 1 && (
                  <div className="mt-2 grid grid-cols-4 sm:grid-cols-8 gap-1">
                    {info.cpu.perCorePercent.map((p, i) => (
                      <div key={i} className="flex flex-col items-center gap-0.5" title={`#${i}`}>
                        <Bar percent={p} className="h-1" />
                        <span className="font-mono text-[9px] text-muted">{Math.round(p)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12.5px]">
                    {l.memory} ·{' '}
                    <span className="font-mono text-muted">
                      {formatDataSize(info.memory.usedBytes)} /{' '}
                      {formatDataSize(info.memory.totalBytes)}
                    </span>
                  </span>
                  <span className="font-mono text-[12px] text-phosphor">
                    {info.memory.usedPercent.toFixed(1)}%
                  </span>
                </div>
                <Bar percent={info.memory.usedPercent} className="mt-1" />
              </div>

              <div className="text-[12.5px]">
                <span className="text-muted">{l.load}：</span>
                {info.platform === 'win32' ? (
                  <span className="text-muted">({l.loadNa})</span>
                ) : (
                  <span className="font-mono">
                    {info.loadAvg.map((v) => v.toFixed(2)).join('  ')}
                  </span>
                )}
              </div>
            </div>
          </Panel>

          <Panel title={l.network}>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <div className="text-[11px] text-muted">
                    {l.primaryIp} · {l.ipv4}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13.5px] text-phosphor">
                      {primaryV4 ?? '—'}
                    </span>
                    {primaryV4 && <CopyBtn text={primaryV4} label={l.copy} />}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">
                    {l.primaryIp} · {l.ipv6}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13.5px] text-phosphor break-all">
                      {primaryV6 ?? '—'}
                    </span>
                    {primaryV6 && <CopyBtn text={primaryV6} label={l.copy} />}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">{l.gateway}</div>
                  <div className="font-mono text-[13.5px]">
                    {info.gateway.ipv4 ?? '—'}
                    {info.gateway.ipv6 && (
                      <span className="text-muted"> / {info.gateway.ipv6}</span>
                    )}
                    {info.gateway.iface && (
                      <span className="ml-2 text-[11px] text-muted">
                        ({l.iface}: {info.gateway.iface})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1 text-[11px] text-muted">{l.ifaces}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left text-[11px] text-muted border-b border-line-soft">
                        <th className="py-1 pr-3 font-normal">{l.colIface}</th>
                        <th className="py-1 pr-3 font-normal">{l.colAddr}</th>
                        <th className="py-1 pr-3 font-normal">{l.colMac}</th>
                        <th className="py-1 font-normal">{l.colCidr}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {info.interfaces.map((it, i) => (
                        <tr key={i} className="border-b border-line-soft last:border-0">
                          <td className="py-1 pr-3 font-mono whitespace-nowrap">
                            {it.name}
                            {it.internal && (
                              <span className="ml-1 rounded bg-panel-2 px-1 text-[10px] text-muted">
                                {l.loopback}
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-3 font-mono">
                            <span className="mr-1.5 inline-flex align-middle">
                              {familyTag(it.family)}
                            </span>
                            <span className="text-phosphor">{it.address}</span>
                          </td>
                          <td className="py-1 pr-3 font-mono text-muted">
                            {it.internal || it.mac === '00:00:00:00:00:00' ? '—' : it.mac}
                          </td>
                          <td className="py-1 font-mono text-muted">
                            {it.cidr ?? it.netmask ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title={l.disks}>
            {info.disks.length === 0 ? (
              <div className="text-[12.5px] text-muted py-1">{l.noDisk}</div>
            ) : (
              <div className="space-y-3">
                {info.disks.map((d, i) => (
                  <div key={`${d.filesystem}-${i}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-[12.5px]">
                        {d.mount}
                        {d.filesystem !== d.mount && (
                          <span className="ml-2 text-[11px] text-muted">{d.filesystem}</span>
                        )}
                      </span>
                      <span className="font-mono text-[11.5px] text-muted">
                        {l.used} {formatDataSize(d.usedBytes)} · {l.avail}{' '}
                        {formatDataSize(d.availBytes)} / {formatDataSize(d.totalBytes)} ·{' '}
                        <span className={d.usedPercent >= 90 ? 'text-danger' : 'text-phosphor'}>
                          {d.usedPercent.toFixed(0)}%
                        </span>
                      </span>
                    </div>
                    <Bar percent={d.usedPercent} className="mt-1" />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title={l.system}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <KV k={l.hostname} v={info.hostname} />
              <KV k={l.user} v={info.username || '—'} />
              <KV k={l.os} v={`${info.osType} ${info.osRelease}`} />
              <KV k={l.version} v={info.osVersion} />
              <KV k={l.release} v={`${info.arch} / ${info.machine}`} />
              <KV k={l.endian} v={info.endianness} />
              <KV k={l.shell} v={info.shell ?? '—'} />
              <KV k={l.homedir} v={info.homedir} />
              <KV k={l.tmpdir} v={info.tmpdir} />
            </div>
            {info.commands.length > 0 && (
              <div className="mt-2 border-t border-line-soft pt-2">
                <div className="text-[11px] text-muted">{l.commands}</div>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {info.commands.map((c, i) => (
                    <code
                      key={i}
                      className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted"
                    >
                      $ {c}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </ToolShell>
  )
}
