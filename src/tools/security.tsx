import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, KV, CopyBtn, Stat } from '../components/ui'
import { securityL } from '../lib/locales/security'
import { useLocalized } from '../lib/i18n'

/* ================= Reverse Shell Generator ================= */

export function ReverseShellTool() {
  const l = useLocalized(securityL).revshell
  const [ip, setIp] = useState('10.10.10.10')
  const [port, setPort] = useState('4444')
  const [selected, setSelected] = useState('Bash TCP')

  const tpl = l.templates.find(t => t.name === selected)!
  const cmd = tpl.tpl(ip, port)
  const listener = `nc -lvnp ${port}`

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input value={ip} onChange={setIp} label={l.lhost} />
        <Input value={port} onChange={setPort} label={l.lport} />
        <Select value={selected} onChange={setSelected} label={l.payloadType} options={l.templates.map(t => ({ value: t.name, label: t.name }))} />
      </div>
      <Panel title={l.panelTitle(tpl.name)} right={<CopyBtn text={cmd} />}>
        <pre className="codeblock text-[12.5px] text-phosphor">{cmd}</pre>
      </Panel>
      <Panel title={l.listenerTitle} right={<CopyBtn text={listener} />}>
        <pre className="codeblock text-[12.5px] text-amber">{listener}</pre>
      </Panel>
      <Panel title={l.ttyTitle}>
        <ul className="text-[12px] text-muted space-y-1">
          {l.ttyItems.map((it, i) => (
            <li key={i}><span className="text-phosphor">{it.cmd}</span> — {it.note}</li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

/* ================= Payload Cheat Sheet ================= */

export function PayloadCheatSheetTool() {
  const l = useLocalized(securityL).payloads
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    if (!filter.trim()) return l.groups
    const q = filter.toLowerCase()
    return l.groups.map(g => ({
      ...g,
      items: g.items.filter(i => i.label.toLowerCase().includes(q) || i.payload.toLowerCase().includes(q)),
    })).filter(g => g.items.length > 0)
  }, [filter, l.groups])

  return (
    <div className="space-y-3">
      <Input value={filter} onChange={setFilter} label={l.filterLabel} placeholder={l.filterPlaceholder} />
      {filtered.map(g => (
        <Panel key={g.name} title={g.name}>
          <div className="space-y-1.5">
            {g.items.map((it, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3 border border-line-soft bg-panel-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-muted">{it.label}{it.note ? ` · ${it.note}` : ''}</div>
                  <code className="text-[12.5px] text-phosphor break-all">{it.payload}</code>
                </div>
                <CopyBtn text={it.payload} className="shrink-0 mt-0.5 self-start" />
              </div>
            ))}
          </div>
        </Panel>
      ))}
      {filtered.length === 0 && <ErrorNote msg={l.noMatch} />}
    </div>
  )
}

/* ================= Port Cheat Sheet ================= */

export function PortRefTool() {
  const l = useLocalized(securityL).ports
  const [q, setQ] = useState('')
  const filtered = l.data.filter(p =>
    !q || String(p.port).includes(q) || p.service.toLowerCase().includes(q.toLowerCase()) || p.note.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-3">
      <Input value={q} onChange={setQ} label={l.searchLabel} placeholder={l.searchPlaceholder} />
      <div className="border border-line-soft overflow-auto max-h-[520px]">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-panel-2">
            <tr className="text-muted text-left">
              <th className="px-3 py-2 font-normal w-20">{l.portHeader}</th>
              <th className="px-3 py-2 font-normal w-36">{l.serviceHeader}</th>
              <th className="px-3 py-2 font-normal">{l.noteHeader}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.port + p.service} className="border-t border-line-soft hover:bg-phosphor-faint">
                <td className="px-3 py-1.5 text-phosphor">{p.port}</td>
                <td className="px-3 py-1.5">{p.service}</td>
                <td className={`px-3 py-1.5 ${p.risky ? 'text-amber' : 'text-muted'}`}>{p.risky ? l.riskyPrefix : ''}{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ================= HTTP Status Codes ================= */

export function HttpStatusTool() {
  const l = useLocalized(securityL).httpStatus
  const [q, setQ] = useState('')
  const filtered = l.codes.filter(([c, n, d]) =>
    !q || String(c).includes(q) || n.toLowerCase().includes(q.toLowerCase()) || d.includes(q))
  const groups = l.groups
  return (
    <div className="space-y-3">
      <Input value={q} onChange={setQ} label={l.searchLabel} placeholder={l.searchPlaceholder} />
      {groups.map(([gname, pred]) => {
        const items = filtered.filter(([c]) => pred(c))
        if (!items.length) return null
        return (
          <Panel key={gname} title={gname}>
            <div className="space-y-1">
              {items.map(([c, n, d]) => (
                <div key={c} className="flex flex-wrap gap-x-4 items-baseline px-1 py-1.5 border-b border-line-soft last:border-0">
                  <span className={`w-10 shrink-0 ${c >= 500 ? 'text-danger' : c >= 400 ? 'text-amber' : c >= 300 ? 'text-[#7ec8ff]' : 'text-phosphor'}`}>{c}</span>
                  <span className="sm:w-56 shrink-0 text-[12.5px]">{n}</span>
                  <span className="text-muted text-[12px] basis-full sm:basis-auto sm:flex-1 pl-14 sm:pl-0">{d}</span>
                </div>
              ))}
            </div>
          </Panel>
        )
      })}
    </div>
  )
}

/* ================= Subnet Calculator ================= */

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = parseInt(p)
    if (isNaN(v) || v < 0 || v > 255 || String(v) !== p.trim()) return null
    n = (n << 8) | v
  }
  return n >>> 0
}
function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export function SubnetTool() {
  const l = useLocalized(securityL).subnet
  const [input, setInput] = useState('192.168.1.10/24')

  const r = useMemo(() => {
    const m = input.trim().match(/^([\d.]+)\s*\/\s*(\d{1,2})$/)
    if (!m) return null
    const ip = ipToInt(m[1])
    const cidr = parseInt(m[2])
    if (ip === null || cidr < 0 || cidr > 32) return { error: l.formatError }
    const mask = cidr === 0 ? 0 : (0xFFFFFFFF << (32 - cidr)) >>> 0
    const network = (ip & mask) >>> 0
    const broadcast = (network | (~mask >>> 0)) >>> 0
    const hostCount = cidr >= 31 ? (cidr === 31 ? 2 : 1) : Math.max(broadcast - network - 1, 0)
    return {
      ip: intToIp(ip), cidr, mask: intToIp(mask),
      wildcard: intToIp(~mask >>> 0),
      network: intToIp(network),
      broadcast: intToIp(broadcast),
      firstHost: cidr >= 31 ? intToIp(network) : intToIp(network + 1),
      lastHost: cidr >= 31 ? intToIp(broadcast) : intToIp(broadcast - 1),
      hosts: hostCount,
      ipClass: (ip >>> 24) < 128 ? 'A' : (ip >>> 24) < 192 ? 'B' : (ip >>> 24) < 224 ? 'C' : ((ip >>> 24) < 240 ? 'D' : 'E'),
      isPrivate: (ip >>> 24) === 10 || ((ip >>> 20) & 0xFFF) === 0xAC1 || (ip >>> 16) === 0xC0A8,
      binMask: intToIp(mask).split('.').map(o => parseInt(o).toString(2).padStart(8, '0')).join('.'),
    }
  }, [input, l])

  return (
    <div className="space-y-3">
      <Input value={input} onChange={setInput} label={l.cidrLabel} placeholder={l.cidrPlaceholder} />
      {r && 'error' in r && <ErrorNote msg={r.error!} />}
      {r && !('error' in r) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel title={l.networkInfoTitle}>
            <KV k={l.ipAddr} v={r.ip} />
            <KV k={l.networkAddr} v={<span className="text-phosphor">{r.network}/{r.cidr}</span>} />
            <KV k={l.broadcastAddr} v={r.broadcast} />
            <KV k={l.subnetMask} v={r.mask} />
            <KV k={l.wildcardMask} v={r.wildcard} />
            <KV k={l.binMask} v={<span className="text-[10px] sm:text-[11px]">{r.binMask}</span>} />
          </Panel>
          <Panel title={l.hostRangeTitle}>
            <KV k={l.firstHost} v={<span className="text-phosphor">{r.firstHost}</span>} />
            <KV k={l.lastHost} v={<span className="text-phosphor">{r.lastHost}</span>} />
            <KV k={l.usableHosts} v={<span className="text-amber">{r.hosts.toLocaleString()}</span>} />
            <KV k={l.classLabel} v={l.classLabels[r.ipClass as keyof typeof l.classLabels]} />
            <KV k={l.privateAddr} v={r.isPrivate ? l.privateYes : l.privateNo} />
          </Panel>
        </div>
      )}
    </div>
  )
}

/* ================= chmod Calculator ================= */

export function ChmodTool() {
  const l = useLocalized(securityL).chmod
  const [perm, setPerm] = useState({ ur: true, uw: true, ux: true, gr: true, gw: false, gx: true, or: true, ow: false, ox: true })
  const [octalInput, setOctalInput] = useState('')

  const calc = (p: typeof perm) => {
    const digit = (r: boolean, w: boolean, x: boolean) => (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0)
    const oct = `${digit(p.ur, p.uw, p.ux)}${digit(p.gr, p.gw, p.gx)}${digit(p.or, p.ow, p.ox)}`
    const sym = ['u', 'g', 'o'].map((who, i) => {
      const r = i === 0 ? p.ur : i === 1 ? p.gr : p.or
      const w = i === 0 ? p.uw : i === 1 ? p.gw : p.ow
      const x = i === 0 ? p.ux : i === 1 ? p.gx : p.ox
      return `${r ? 'r' : '-'}${w ? 'w' : '-'}${x ? 'x' : '-'}`
    }).join('')
    return { oct, sym }
  }

  const { oct, sym } = calc(perm)

  const applyOctal = (v: string) => {
    setOctalInput(v)
    if (/^[0-7]{3}$/.test(v)) {
      const d = v.split('').map(Number)
      setPerm({
        ur: !!(d[0] & 4), uw: !!(d[0] & 2), ux: !!(d[0] & 1),
        gr: !!(d[1] & 4), gw: !!(d[1] & 2), gx: !!(d[1] & 1),
        or: !!(d[2] & 4), ow: !!(d[2] & 2), ox: !!(d[2] & 1),
      })
    }
  }

  const toggle = (k: keyof typeof perm) => {
    const np = { ...perm, [k]: !perm[k] }
    setPerm(np)
    setOctalInput(calc(np).oct)
  }

  const rows = l.rows

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.map(([label, keys]) => (
          <div key={label} className="flex items-center gap-4">
            <span className="w-28 text-muted text-[12px]">{label}</span>
            {l.permLabels.map((name, i) => (
              <label key={name} className="flex items-center gap-1.5 cursor-pointer text-[12px]">
                <input type="checkbox" checked={perm[keys[i]]} onChange={() => toggle(keys[i])} className="accent-phosphor" />
                <span className={perm[keys[i]] ? 'text-phosphor' : 'text-muted'}>{name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="border border-line-soft bg-panel-2 px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">{l.octalLabel}</div>
          <div className="flex items-center gap-2">
            <span className="text-xl text-phosphor glow">{oct}</span>
            <CopyBtn text={`chmod ${oct} file`} />
          </div>
        </div>
        <div className="border border-line-soft bg-panel-2 px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">{l.symLabel}</div>
          <div className="flex items-center gap-2">
            <span className="text-xl text-phosphor glow">{sym}</span>
            <CopyBtn text={sym} />
          </div>
        </div>
        <div className="border border-line-soft bg-panel-2 px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">{l.reverseLabel}</div>
          <input value={octalInput} onChange={e => applyOctal(e.target.value)} placeholder={l.reversePlaceholder}
            className="bg-transparent text-xl text-amber w-24 focus:outline-none" />
        </div>
      </div>
    </div>
  )
}
