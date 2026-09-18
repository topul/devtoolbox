import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, KV, CopyBtn, Stat } from '../components/ui'
import { securityL } from '../lib/locales/security'
import { useLocalized } from '../lib/i18n'
import { chmodFromBits, chmodFromOctal, cidrInfo, type ChmodPerm } from '../lib/toolkit'

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

export function SubnetTool() {
  const l = useLocalized(securityL).subnet
  const [input, setInput] = useState('192.168.1.10/24')

  const r = useMemo(() => {
    if (!input.trim()) return null
    try {
      return cidrInfo(input)
    } catch {
      return { error: l.formatError }
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
  const [perm, setPerm] = useState<ChmodPerm>({ ur: true, uw: true, ux: true, gr: true, gw: false, gx: true, or: true, ow: false, ox: true })
  const [octalInput, setOctalInput] = useState('')

  const { octal: oct, symbolic: sym } = chmodFromBits(perm)

  const applyOctal = (v: string) => {
    setOctalInput(v)
    try {
      setPerm(chmodFromOctal(v))
    } catch {
      // 尚未凑满三位时保持当前勾选状态
    }
  }

  const toggle = (k: keyof ChmodPerm) => {
    const np = { ...perm, [k]: !perm[k] }
    setPerm(np)
    setOctalInput(chmodFromBits(np).octal)
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
