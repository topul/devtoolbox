import React, { useState } from 'react'
import { Btn, TA, ErrorNote, Panel, Select, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { formatsL } from '../lib/locales/formats'
import { csvToJson, jsonToCsv, jsonToToml, tomlToJson } from '../lib/toolkit'

/* TOML / CSV 的实现来自 src/lib/toolkit，与 MCP 服务端共用同一份代码。 */

const TOML_SAMPLE = `# server config
title = "TOML sample"
enabled = true
ratio = 0.5

[server]
host = "0.0.0.0"
port = 8080
tags = ["web", "prod"]

[[products]]
name = "Hammer"
sku = 738594937

[[products]]
name = "Nail"
`

/* ================= TOML ↔ JSON ================= */

export function TomlTool() {
  const l = useLocalized(formatsL).toml
  const [input, setInput] = usePersistedState('toml-json', 'input', TOML_SAMPLE)
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const run = (mode: 't2j' | 'j2t') => {
    setErr(null)
    try {
      if (mode === 't2j') {
        setOutput(JSON.stringify(tomlToJson(input), null, 2))
      } else {
        setOutput(jsonToToml(JSON.parse(input)))
      }
    } catch (e) {
      setErr((mode === 't2j' ? l.errToml : l.errJson) + (e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.tomlLabel} rows={11} />
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={() => run('t2j')}>{l.to2j}</Btn>
        <Btn onClick={() => run('j2t')}>{l.j2o}</Btn>
        <Btn variant="ghost" onClick={() => { setInput(output); setOutput('') }}>{l.swap}</Btn>
        <Btn variant="ghost" onClick={() => setInput(TOML_SAMPLE)}>{l.sampleBtn}</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label={l.jsonLabel} rows={11} />
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}

/* ================= CSV ↔ JSON ================= */

const CSV_SAMPLE = 'name,note\n"a,b","line1\nline2"\nplain,"say ""hi"""\n'

export function CsvTool() {
  const l = useLocalized(formatsL).csv
  const [input, setInput] = usePersistedState('csv-json', 'input', CSV_SAMPLE)
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [delimiter, setDelimiter] = useState(',')
  const [header, setHeader] = useState(true)
  /** CSV → JSON 时的表格预览 */
  const [table, setTable] = useState<{ columns: string[]; rows: Record<string, string>[] } | null>(null)

  const run = (mode: 'c2j' | 'j2c') => {
    setErr(null)
    setTable(null)
    try {
      if (mode === 'c2j') {
        const t = csvToJson(input, { delimiter, header })
        setTable(t)
        setOutput(JSON.stringify(t.rows, null, 2))
      } else {
        const parsed: unknown = JSON.parse(input)
        if (!Array.isArray(parsed) || parsed.some((r) => typeof r !== 'object' || r === null || Array.isArray(r))) {
          setErr(l.errNotArray)
          return
        }
        setOutput(jsonToCsv(parsed as Record<string, unknown>[], { delimiter }))
      }
    } catch (e) {
      setErr((mode === 'c2j' ? l.errCsv : l.errJson) + (e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.csvLabel} rows={9} />
      <div className="flex gap-3 items-end flex-wrap">
        <div className="w-44">
          <Select
            value={delimiter}
            onChange={setDelimiter}
            label={l.delimiter}
            options={l.delims.map(([label, value]) => ({ value, label }))}
          />
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted pb-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} className="accent-[var(--c-phosphor)]" />
          {l.header}
        </label>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Btn variant="primary" onClick={() => run('c2j')}>{l.c2j}</Btn>
        <Btn onClick={() => run('j2c')}>{l.j2c}</Btn>
        <Btn variant="ghost" onClick={() => { setInput(output); setOutput(''); setTable(null) }}>{l.swap}</Btn>
        <Btn variant="ghost" onClick={() => setInput(CSV_SAMPLE)}>{l.sampleBtn}</Btn>
      </div>
      <ErrorNote msg={err} />
      {table && table.rows.length > 0 && (
        <Panel title={`${l.c2j} · ${table.rows.length} ${l.rows} × ${table.columns.length} ${l.cols}`}>
          <div className="overflow-x-auto">
            <table className="text-[12px] w-full">
              <thead>
                <tr className="border-b border-line-soft">
                  {table.columns.map((c) => (
                    <th key={c} className="px-2 py-1 text-left text-muted font-medium whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-b border-line-soft last:border-0">
                    {table.columns.map((c) => (
                      <td key={c} className="px-2 py-1 font-mono text-bright whitespace-pre max-w-[280px] truncate">{r[c]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <TA value={output} readOnly label={l.jsonLabel} rows={9} />
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}
