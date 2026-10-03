import React, { useState, useMemo } from 'react'
import { Btn, ErrorNote, Input, KV, Panel, Select, Stat, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { timezoneL } from '../lib/locales/timezone'
import {
  COMMON_TIMEZONES,
  availableTimezones,
  formatInTimezone,
  formatOffset,
  localTimezoneId,
} from '../lib/toolkit'

/* 时区实现来自 src/lib/toolkit（Intl 纯函数），与 MCP 服务端共用。 */

const ALL_TZS = availableTimezones()

function tzOptions(extra: string): { value: string; label: string }[] {
  const common = COMMON_TIMEZONES.map((t) => ({ value: t.id, label: `${t.city} (${t.id})` }))
  const rest = ALL_TZS.filter((id) => !COMMON_TIMEZONES.some((t) => t.id === id)).map((id) => ({ value: id, label: id }))
  const opts = [...common, ...rest]
  if (!opts.some((o) => o.value === extra)) opts.unshift({ value: extra, label: extra })
  return opts
}

export function TimezoneTool() {
  const l = useLocalized(timezoneL)
  const local = localTimezoneId()
  const [instant, setInstant] = usePersistedState('timezone', 'instant', '')
  // 本机时区可能正好是 Asia/Shanghai，去重避免 React 重复 key 警告
  const [zones, setZones] = useState(() => [...new Set(['UTC', local, 'Asia/Shanghai', 'America/New_York'])])

  /** 输入为空时用当前时间；否则按本机时区解析墙上时间 */
  const parsed = useMemo(() => {
    if (!instant.trim()) return { date: new Date(), error: null as string | null }
    const d = new Date(instant.trim().replace(/-/g, '/').replace('T', ' '))
    if (Number.isNaN(d.getTime())) return { date: new Date(), error: l.errBadDate }
    return { date: d, error: null as string | null }
  }, [instant, l])
  const moment = parsed.date
  const err = parsed.error

  const remove = (tz: string) => setZones((zs) => zs.filter((z) => z !== tz))
  const add = (tz: string) => {
    if (!tz || zones.includes(tz)) return
    setZones((zs) => [...zs, tz])
  }

  const utcStr = formatInTimezone(moment, 'UTC').datetime

  return (
    <div className="space-y-4">
      <Panel title={l.nowTitle} right={<span className="text-[11px] text-muted">{moment.toISOString()}</span>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Input value={instant} onChange={setInstant} label={l.instantLabel} placeholder="2026-10-02 14:30:00" />
            <div className="flex gap-2">
              <Btn onClick={() => setInstant('')}>{l.useNow}</Btn>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label={l.localTz} value={<span className="text-sm">{local}</span>} />
            <Stat label={l.utcResult} value={<span className="text-sm">{utcStr}</span>} />
          </div>
        </div>
      </Panel>

      <ErrorNote msg={err} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {zones.map((tz) => {
          let z
          try {
            z = formatInTimezone(moment, tz)
          } catch {
            return (
              <Panel key={tz} title={tz} right={<Btn variant="ghost" onClick={() => remove(tz)}>{l.removeTz}</Btn>}>
                <ErrorNote msg={l.errBadTz + tz} />
              </Panel>
            )
          }
          return (
            <Panel
              key={tz}
              title={tz}
              right={<span className="text-[11px] text-phosphor/80">{z.abbr}</span>}
            >
              <div className="space-y-0.5">
                <KV k={l.offset} v={`${formatOffset(z.offsetMinutes)}（${l.weekday}${l.weekdays[z.weekday]}）`} />
                <KV k={tz === local ? l.localTz : l.wallLabel} v={<span className="text-phosphor">{z.datetime}</span>} />
                <div className="pt-1">
                  <Btn variant="ghost" onClick={() => remove(tz)}>{l.removeTz}</Btn>
                </div>
              </div>
            </Panel>
          )
        })}
      </div>

      <div className="flex gap-2 items-end flex-wrap">
        <div className="w-72">
          <Select value="" onChange={add} label={l.addTz} options={tzOptions(local)} />
        </div>
      </div>
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}
