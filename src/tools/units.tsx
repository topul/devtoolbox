/**
 * 数据单位换算器 —— KB(1000) 与 KiB(1024) 两套前缀、bit 与 Byte 差 8 倍，
 * 这些口径问题「换算一下」比背表可靠。主结果大字展示，下面给全单位对照表；
 * 换算与人类可读格式化都是纯函数，在 toolkit/units.ts。
 */
import React, { useMemo } from 'react'
import {
  ErrorNote,
  Input,
  Panel,
  Select,
  Stat,
  ToolShell,
  usePersistedState,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { DATA_UNITS, convertDataUnit, unitConvertAll } from '../lib/toolkit/units'

const L = {
  zh: {
    value: '数值',
    valuePh: '如 1.5、1024',
    from: '从',
    to: '到',
    result: '换算结果',
    table: '全单位对照',
    invalid: '请输入有效数字',
    note: '最容易踩的两个坑：bit 与 Byte 差 8 倍（网速 Mb/s ÷ 8 才是下载 MB/s）；KB/MB/GB 是 1000 进制、KiB/MiB/GiB 是 1024 进制 —— 硬盘「缩水」就是这么来的。',
  },
  en: {
    value: 'Value',
    valuePh: 'e.g. 1.5, 1024',
    from: 'From',
    to: 'To',
    result: 'Result',
    table: 'All units',
    invalid: 'Enter a valid number',
    note: 'Two classic traps: bits vs bytes differ by 8 (network Mb/s ÷ 8 = download MB/s); KB/MB/GB are decimal (×1000) while KiB/MiB/GiB are binary (×1024) — that is why drives "shrink".',
  },
}

const UNIT_OPTIONS = DATA_UNITS.map((u) => ({ value: u.id, label: `${u.name} (${u.id})` }))

/** 整数带千分位；小数取 8 位有效数字并去掉尾零（953.674316… 读得清就行） */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return n.toLocaleString('en-US')
  return String(parseFloat(n.toPrecision(8)))
}

export function UnitsTool() {
  const l = useLocalized(L)
  const [numStr, setNumStr] = usePersistedState('units', 'value', '1')
  const [from, setFrom] = usePersistedState('units', 'from', 'MiB')
  const [to, setTo] = usePersistedState('units', 'to', 'B')

  const value = Number(numStr.trim())
  const valid = numStr.trim() !== '' && Number.isFinite(value)

  const result = useMemo(
    () => (valid ? convertDataUnit(value, from, to) : null),
    [valid, value, from, to],
  )
  const all = useMemo(() => (valid ? unitConvertAll(value, from) : []), [valid, value, from])

  return (
    <ToolShell toolId="units">
      <div className="grid gap-3 sm:grid-cols-[1fr_150px_150px]">
        <Input
          toolInput
          value={numStr}
          onChange={setNumStr}
          label={l.value}
          placeholder={l.valuePh}
        />
        <Select value={from} onChange={setFrom} options={UNIT_OPTIONS} label={l.from} />
        <Select value={to} onChange={setTo} options={UNIT_OPTIONS} label={l.to} />
      </div>

      <ErrorNote msg={valid ? null : l.invalid} />

      {valid && result !== null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label={`${l.result} (${to})`} value={`${fmtNum(result)} ${to}`} />
          <Stat label={l.from} value={`${fmtNum(value)} ${from}`} />
        </div>
      )}

      {valid && all.length > 0 && (
        <Panel title={l.table}>
          <div className="space-y-0.5">
            {all.map((row) => (
              <div
                key={row.unit}
                className="flex items-baseline gap-2 py-0.5 text-[12.5px] border-b border-line-soft last:border-0"
              >
                <span className="font-mono text-muted shrink-0 w-24">{row.unit}</span>
                <span className="font-mono text-bright break-all">{fmtNum(row.value)}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <p className="text-[12px] text-muted leading-relaxed">{l.note}</p>
    </ToolShell>
  )
}
