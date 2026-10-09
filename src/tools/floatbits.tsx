/**
 * IEEE 754 浮点位查看器 —— 输入一个数看它在内存里的真实样子（sign /
 * exponent / mantissa 三段位型），或把一段 hex/bin 位型粘回来还原成数值。
 *
 * 双向实时联动：两个输入框都能编辑，以最后编辑的方向为准（src state 记录
 * 来源），非活动侧显示派生值 —— 这比「单向转换 + 按钮」更符合位查看器的
 * 使用节奏（float.exposed 同款交互）。half 的编码手写在 toolkit/floatbits.ts。
 */
import React, { useMemo, useState } from 'react'
import {
  CopyBtn,
  ErrorNote,
  Input,
  KV,
  Panel,
  Select,
  Stat,
  ToolShell,
  usePersistedState,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { bitsToFloat, floatToBits, type FloatWidth } from '../lib/toolkit/floatbits'

const L = {
  zh: {
    value: '数值',
    valuePh: '0.1 / -3.14 / 1e308 / NaN',
    width: '精度',
    hexIn: '位型（hex 或 bin，粘回来反向还原）',
    hexInPh: '3dcccccd 或 0011110111001100…',
    bits: '位型',
    asNumber: '还原数值',
    sign: '符号位',
    exp: '指数（位 → 实际值）',
    mantissa: '尾数',
    special: '类别',
    hexLabel: 'hex',
    binLabel: 'bin',
    negative: '负',
    positive: '正',
    specialNormal: '常规数',
    specialZero: '零',
    specialSubnormal: '次正规数（denormal）',
    specialInf: '无穷',
    specialNan: 'NaN',
    invalid: '无法解析输入',
    note: '浮点不精确的根源：0.1 在二进制里是无限循环小数，存进 64 位只能截断近似 —— 所以 0.1 + 0.2 !== 0.3。',
  },
  en: {
    value: 'Value',
    valuePh: '0.1 / -3.14 / 1e308 / NaN',
    width: 'Precision',
    hexIn: 'Bits (hex or bin, paste back to decode)',
    hexInPh: '3dcccccd or 0011110111001100…',
    bits: 'Bit layout',
    asNumber: 'Decoded value',
    sign: 'Sign bit',
    exp: 'Exponent (bits → actual)',
    mantissa: 'Mantissa',
    special: 'Class',
    hexLabel: 'hex',
    binLabel: 'bin',
    negative: 'negative',
    positive: 'positive',
    specialNormal: 'normal',
    specialZero: 'zero',
    specialSubnormal: 'subnormal (denormal)',
    specialInf: 'infinity',
    specialNan: 'NaN',
    invalid: 'Cannot parse input',
    note: 'Why floats are imprecise: 0.1 is a repeating fraction in binary, so 64 bits can only hold an approximation — that is why 0.1 + 0.2 !== 0.3.',
  },
}

const WIDTH_OPTIONS = [
  { value: '16', label: 'half (16-bit)' },
  { value: '32', label: 'single (32-bit)' },
  { value: '64', label: 'double (64-bit)' },
]

export function FloatBitsTool() {
  const l = useLocalized(L)
  const [src, setSrc] = useState<'value' | 'hex'>('value')
  const [valueStr, setValueStr] = usePersistedState('float-bits', 'value', '0.1')
  const [hexStr, setHexStr] = usePersistedState('float-bits', 'hex', '')
  const [widthStr, setWidthStr] = usePersistedState('float-bits', 'width', '32')
  const width = Number(widthStr) as FloatWidth

  // 归一成「一个数」：数值方向直接解析；hex 方向先解码成数 —— 两条路最终
  // 都用 floatToBits 展示位型，两个面板看到的数据永远一致
  const value: number | null = useMemo(() => {
    if (src === 'value') {
      const s = valueStr.trim()
      if (s === '') return 0 // 空输入按 0 展示位型，页面不留空白
      const n = Number(s)
      return Number.isNaN(n) ? null : n
    }
    return bitsToFloat(hexStr, width)
  }, [src, valueStr, hexStr, width])

  const bits = useMemo(() => (value === null ? null : floatToBits(value, width)), [value, width])
  const invalid = value === null

  const specialText = bits
    ? (
        {
          normal: l.specialNormal,
          zero: l.specialZero,
          subnormal: l.specialSubnormal,
          inf: l.specialInf,
          nan: l.specialNan,
        } as const
      )[bits.isSpecial]
    : ''

  return (
    <ToolShell toolId="float-bits">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <Input
          toolInput
          value={src === 'value' ? valueStr : value !== null ? String(value) : ''}
          onChange={(v) => {
            setSrc('value')
            setValueStr(v)
          }}
          label={l.value}
          placeholder={l.valuePh}
        />
        <Select value={widthStr} onChange={setWidthStr} options={WIDTH_OPTIONS} label={l.width} />
      </div>

      <Input
        value={src === 'hex' ? hexStr : (bits?.hex ?? '')}
        onChange={(v) => {
          setSrc('hex')
          setHexStr(v)
        }}
        label={l.hexIn}
        placeholder={l.hexInPh}
      />

      <ErrorNote msg={invalid ? l.invalid : null} />

      {bits && !invalid && (
        <>
          <Panel title={l.bits}>
            <div className="mb-2 flex items-baseline gap-3">
              <span className="text-[11px] uppercase tracking-wider text-muted shrink-0">
                {l.hexLabel}
              </span>
              <span className="font-mono text-[14px] text-bright break-all flex-1 min-w-0">
                {bits.hex}
              </span>
              <CopyBtn text={bits.hex} className="shrink-0" />
            </div>
            <div className="mb-3 flex items-baseline gap-3">
              <span className="text-[11px] uppercase tracking-wider text-muted shrink-0">
                {l.binLabel}
              </span>
              {/* 三段分色：sign 红 / exp 荧光绿 / mantissa 灰，一眼看清位段边界 */}
              <span className="font-mono text-[13px] leading-relaxed break-all flex-1 min-w-0">
                <span className="text-danger">{bits.sign}</span>{' '}
                <span className="text-phosphor">{bits.expBits}</span>{' '}
                <span className="text-muted">{bits.mantissaBits}</span>
              </span>
              <CopyBtn text={bits.bin} className="shrink-0" />
            </div>
            <KV k={l.sign} v={`${bits.sign} · ${bits.sign === '1' ? l.negative : l.positive}`} />
            <KV k={l.exp} v={`${bits.expBits} → ${bits.expValue}`} />
            <KV k={l.mantissa} v={bits.mantissaBits} />
            <KV k={l.special} v={specialText} mono={false} />
          </Panel>

          <Stat label={l.asNumber} value={String(value)} />
        </>
      )}

      <p className="text-[12px] text-muted leading-relaxed">{l.note}</p>
    </ToolShell>
  )
}
