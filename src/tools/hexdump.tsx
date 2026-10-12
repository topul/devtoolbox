/**
 * Hex Dump 工具 —— 文本 ↔ 十六进制转储（偏移 + Hex + ASCII）。
 * 编码模式：输入文本，按每行字节数/大小写输出标准 dump；
 * 解码模式：粘贴纯 hex 或带偏移的 dump，自动识别并还原文本。
 * 全部转换逻辑在 toolkit/hexdump.ts。
 */
import React, { useMemo } from 'react'
import { CopyBtn, ErrorNote, Panel, TA, ToolShell, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { cn } from '../lib/cn'
import { bytesToText, decodeHex, encodeHexDump, textToBytes } from '../lib/toolkit/hexdump'

type Mode = 'encode' | 'decode'

const L = {
  zh: {
    encode: '文本 → Hex',
    decode: 'Hex → 文本',
    inputEnc: '文本输入',
    inputEncPh: 'Hello World\n你好，世界',
    inputDec: 'Hex 输入（纯 hex 或带偏移 dump 均可）',
    inputDecPh: '00000000  48 65 6c 6c 6f 20 57 6f  72 6c 64                Hello Wo rld',
    width: '每行字节',
    upper: '大写',
    dump: 'Hex Dump',
    text: '还原文本',
    byteCount: '字节数',
  },
  en: {
    encode: 'Text → Hex',
    decode: 'Hex → Text',
    inputEnc: 'Text input',
    inputEncPh: 'Hello World\nThe quick brown fox',
    inputDec: 'Hex input (plain hex or offset dump)',
    inputDecPh: '00000000  48 65 6c 6c 6f 20 57 6f  72 6c 64                Hello Wo rld',
    width: 'Bytes/line',
    upper: 'Uppercase',
    dump: 'Hex Dump',
    text: 'Decoded text',
    byteCount: 'bytes',
  },
}

const WIDTHS = [8, 16, 32]

export function HexDumpTool() {
  const l = useLocalized(L)
  const [mode, setMode] = usePersistedState<Mode>('hexdump', 'mode', 'encode')
  const [width, setWidth] = usePersistedState('hexdump', 'width', '16')
  const [upper, setUpper] = usePersistedState('hexdump', 'upper', 'false')
  const [encIn, setEncIn] = usePersistedState('hexdump', 'encIn', '')
  const [decIn, setDecIn] = usePersistedState('hexdump', 'decIn', '')

  const bytesPerLine = WIDTHS.includes(Number(width)) ? Number(width) : 16
  const isUpper = upper === 'true'

  const dump = useMemo(
    () =>
      mode === 'encode' && encIn
        ? encodeHexDump(textToBytes(encIn), { bytesPerLine, uppercase: isUpper })
        : null,
    [mode, encIn, bytesPerLine, isUpper],
  )

  const decoded = useMemo(
    () => (mode === 'decode' && decIn.trim() ? decodeHex(decIn) : null),
    [mode, decIn],
  )

  return (
    <ToolShell toolId="hexdump">
      {/* 模式 + 选项行 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-line-soft bg-panel-2 p-0.5">
          <ModeTab active={mode === 'encode'} onClick={() => setMode('encode')}>
            {l.encode}
          </ModeTab>
          <ModeTab active={mode === 'decode'} onClick={() => setMode('decode')}>
            {l.decode}
          </ModeTab>
        </div>

        {mode === 'encode' && (
          <>
            <div className="flex rounded-lg border border-line-soft bg-panel-2 p-0.5">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWidth(String(w))}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[12px] transition-colors',
                    bytesPerLine === w
                      ? 'bg-phosphor-faint text-phosphor font-medium'
                      : 'text-muted hover:text-bright',
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isUpper}
                onChange={(e) => setUpper(String(e.target.checked))}
                className="accent-emerald-400"
              />
              {l.upper}
            </label>
          </>
        )}
      </div>

      {mode === 'encode' ? (
        <>
          <TA
            toolInput
            spellCheck
            value={encIn}
            onChange={setEncIn}
            label={l.inputEnc}
            placeholder={l.inputEncPh}
            rows={8}
          />
          {dump !== null && (
            <Panel title={l.dump} right={<CopyBtn text={dump} />}>
              <pre
                className="codeblock overflow-auto text-[12px] leading-relaxed"
                style={{ maxHeight: 480 }}
              >
                {dump}
              </pre>
            </Panel>
          )}
        </>
      ) : (
        <>
          <TA
            toolInput
            spellCheck
            value={decIn}
            onChange={setDecIn}
            label={l.inputDec}
            placeholder={l.inputDecPh}
            rows={8}
          />
          {decoded && !decoded.ok && <ErrorNote msg={decoded.error ?? ''} />}
          {decoded?.ok && decoded.bytes && (
            <Panel
              title={`${l.text} · ${decoded.bytes.length} ${l.byteCount}`}
              right={<CopyBtn text={bytesToText(decoded.bytes)} />}
            >
              <pre className="codeblock whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">
                {bytesToText(decoded.bytes)}
              </pre>
            </Panel>
          )}
        </>
      )}
    </ToolShell>
  )
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1 text-[12px] transition-colors',
        active ? 'bg-phosphor-faint text-phosphor font-medium' : 'text-muted hover:text-bright',
      )}
    >
      {children}
    </button>
  )
}
