import React, { useState, useMemo } from 'react'
import { Btn, TA, Input, ErrorNote, Select } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { dataformatsL } from '../lib/locales/dataformats'
import { evalJsonPath, jsonToYaml, yamlToJson } from '../lib/toolkit'

/* YAML / JSONPath 的实现来自 src/lib/toolkit，与 MCP 服务端共用同一份代码。 */

/* ================= YAML ↔ JSON ================= */

export function YamlTool() {
  const l = useLocalized(dataformatsL).yaml
  const [input, setInput] = useState('server:\n  host: 0.0.0.0\n  port: 8080\n  tags:\n    - web\n    - prod\n  tls: true')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const run = (mode: 'y2j' | 'j2y') => {
    setErr(null)
    try {
      setOutput(mode === 'y2j' ? yamlToJson(input, 2) : jsonToYaml(input))
    } catch (e) {
      setErr((mode === 'y2j' ? 'YAML' : 'JSON') + l.parseErr + (e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} rows={9} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => run('y2j')}>{l.y2j}</Btn>
        <Btn onClick={() => run('j2y')}>{l.j2y}</Btn>
        <Btn variant="ghost" onClick={() => { setInput(output); setOutput('') }}>{l.swap}</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label={l.output} rows={9} />
      <p className="text-[11px] text-muted">{l.note}</p>
    </div>
  )
}

/* ================= JSONPath ================= */

export function JsonPathTool() {
  const l = useLocalized(dataformatsL).jsonpath
  const [json, setJson] = useState(l.sample)
  const [path, setPath] = useState('$.store.book[*].price')
  const [err, setErr] = useState<string | null>(null)

  const result = useMemo(() => {
    setErr(null)
    if (!json.trim() || !path.trim()) return null
    try {
      return evalJsonPath(JSON.parse(json), path)
    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'NEED_DOLLAR') setErr(l.needDollar)
      else if (msg.startsWith('BAD_SEG:')) setErr(l.badSeg + msg.slice('BAD_SEG:'.length))
      else setErr(msg)
      return null
    }
  }, [json, path, l])

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <Input value={path} onChange={setPath} label={l.exprLabel} placeholder="$.store.book[0].title" />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {l.examples.map(([name, p]) => (
          <button key={name} onClick={() => setPath(p)}
            className="px-2 py-1 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
            {name}
          </button>
        ))}
      </div>
      <TA value={json} onChange={setJson} label={l.dataLabel} rows={8} />
      <ErrorNote msg={err} />
      {result && (
        <TA value={result.length === 1 ? JSON.stringify(result[0], null, 2) : JSON.stringify(result, null, 2)} readOnly label={l.resultLabel(result.length)} rows={7} />
      )}
    </div>
  )
}

/* ================= CSS Formatter ================= */

function formatCss(css: string): string {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  let out = ''
  let depth = 0
  let buf = ''
  const flush = () => {
    const t = buf.trim()
    if (t) out += '  '.repeat(depth) + t
    buf = ''
  }
  for (const ch of css) {
    if (ch === '{') {
      out += buf.trim() + ' {\n'
      buf = ''
      depth++
    } else if (ch === '}') {
      flush()
      depth--
      out += '  '.repeat(depth) + '}\n'
      buf = ''
    } else if (ch === ';') {
      out += '  '.repeat(depth) + buf.trim() + ';\n'
      buf = ''
    } else {
      buf += ch
    }
  }
  flush()
  return out.replace(/\n{2,}/g, '\n').trim()
}

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}

export function CssTool() {
  const l = useLocalized(dataformatsL).css
  const [input, setInput] = useState('body{color:#0f0; margin: 0}a:hover{ text-decoration : underline }')
  const [output, setOutput] = useState('')

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} rows={7} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => setOutput(formatCss(input))}>{l.format}</Btn>
        <Btn onClick={() => setOutput(minifyCss(input))}>{l.minify}</Btn>
      </div>
      {output && (
        <div className="text-[11px] text-muted">
          {input.length} → {output.length} {l.chars}（{output.length < input.length ? l.less : l.more} {Math.abs(100 - Math.round(output.length / Math.max(input.length, 1) * 100))}%）
        </div>
      )}
      <TA value={output} readOnly label={l.output} rows={10} />
    </div>
  )
}
