import React, { useState, useMemo, useDeferredValue } from 'react'
import { Btn, TA, Select, ErrorNote, Panel, ResultPanel, ConfirmButton, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { formatL } from '../lib/locales/format'

/* ================= JSON ================= */

export function JsonTool() {
  const l = useLocalized(formatL).json
  const [input, setInput, { clear }] = usePersistedState('json', 'input', '')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [indent, setIndent] = usePersistedState('json', 'indent', '2')

  const run = (mode: 'format' | 'minify' | 'escape' | 'unescape') => {
    setErr(null)
    try {
      if (mode === 'escape') { setOutput(JSON.stringify(input)); return }
      if (mode === 'unescape') {
        const v = JSON.parse(input)
        setOutput(typeof v === 'string' ? v : JSON.stringify(v))
        return
      }
      const obj = JSON.parse(input)
      setOutput(mode === 'format' ? JSON.stringify(obj, null, parseInt(indent)) : JSON.stringify(obj))
    } catch (e) {
      setErr(l.err + (e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      {/* 清空走二次确认；按钮放label 行右侧（与 label 同行），不靠 items-end 硬对齐 */}
      <TA
        value={input}
        onChange={setInput}
        label={l.input}
        placeholder='{"key": "value", "arr": [1,2,3]}'
        rows={8}
        toolInput
        labelRight={<ConfirmButton label={l.clear} onConfirm={clear} />}
      />
      <div className="flex items-end gap-2 flex-wrap">
        <Select value={indent} onChange={setIndent} label={l.indentLabel} options={l.indentOptions} />
        <Btn variant="primary" onClick={() => run('format')}>{l.format}</Btn>
        <Btn onClick={() => run('minify')}>{l.minify}</Btn>
        <Btn onClick={() => run('escape')}>{l.escape}</Btn>
        <Btn onClick={() => run('unescape')}>{l.unescape}</Btn>
      </div>
      <ErrorNote msg={err} />
      {/* 原来 `{!err && <TA/>}`：一出错输出区整个消失，页面少一块、布局跳动。
          改成常驻的 ResultPanel，出错时保留上一次的输出并显示空状态提示 */}
      <ResultPanel
        title={l.output}
        text={err ? '' : output}
        emptyHint={l.nothingYet}
        maxHeight={360}
      />
    </div>
  )
}

/* ================= SQL ================= */

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'JOIN', 'LEFT JOIN',
  'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON', 'UNION', 'UNION ALL', 'AS',
  'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IN', 'NOT', 'NULL', 'LIKE', 'BETWEEN',
]

export function SqlTool() {
  const l = useLocalized(formatL).sql
  const [input, setInput] = usePersistedState('sql-format', 'input', '')
  // 每按一个键都要跑 53 次全文正则（34 个关键词大写 + 19 个换行）。
  // 直接同步算会卡住主线程 —— 项目是 React 18 却等于退化成同步渲染。
  // useDeferredValue 让 React 先把输入框响应做完，再在后台算格式化结果。
  const deferred = useDeferredValue(input)
  const output = useMemo(() => {
    if (!deferred.trim()) return ''
    let sql = deferred.trim().replace(/\s+/g, ' ')
    // uppercase keywords
    SQL_KEYWORDS.forEach(kw => {
      const re = new RegExp('\\b' + kw.replace(/\s+/g, '\\s+') + '\\b', 'gi')
      sql = sql.replace(re, kw)
    })
    const breaks = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT',
      'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'JOIN', 'UNION ALL', 'UNION',
      'VALUES', 'SET', 'INSERT INTO', 'UPDATE', 'DELETE FROM']
    breaks.sort((a, b) => b.length - a.length).forEach(kw => {
      sql = sql.replace(new RegExp('\\s*\\b' + kw.replace(' ', '\\s+') + '\\b', 'g'), '\n' + kw + ' ')
    })
    sql = sql.replace(/\s+(AND|OR)\s+/g, '\n  $1 ')
    sql = sql.replace(/,\s*/g, ',\n  ')
    return sql.trim()
  }, [deferred])
  // 输入已经变了但结果还没算出来 —— 不标一下用户会以为没生效
  const stale = deferred !== input

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder="select id,name from users where age>18 and city='BJ' order by id desc limit 10" rows={6} toolInput />
      {stale && <p className="text-[11px] text-muted" role="status">{l.calculating}</p>}
      <ResultPanel title={l.output} text={output} emptyHint={l.nothingYet} maxHeight={360} />
    </div>
  )
}

/* ================= XML / HTML ================= */

function formatXml(xml: string, indent: string): string {
  const P = indent
  let formatted = ''
  let pad = 0
  xml = xml.replace(/>\s+</g, '><').trim()
  xml.split(/(?=<)|(?<=>)/g).filter(Boolean).reduce((acc, node) => acc + node, '')
  const nodes = xml.replace(/>\s*</g, '>\r\n<').split('\r\n')
  nodes.forEach(node => {
    let indentLevel = 0
    if (/^<\/\w/.test(node)) {
      pad = Math.max(0, pad - 1)
    } else if (/^<\w[^>]*[^/]>$/.test(node) || /^<\w[^>]*>$/.test(node)) {
      indentLevel = 1
    }
    if (/^<\?/.test(node) || /^<!/.test(node)) indentLevel = 0
    formatted += P.repeat(pad) + node + '\n'
    pad += indentLevel
  })
  return formatted.trim()
}

export function XmlTool() {
  const l = useLocalized(formatL).xml
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const format = () => {
    setErr(null)
    try {
      const doc = new DOMParser().parseFromString(input, 'text/xml')
      const errNode = doc.querySelector('parsererror')
      if (errNode) throw new Error(l.xmlErr)
      setOutput(formatXml(input, '  '))
    } catch (e) {
      setErr(l.err + (e as Error).message)
    }
  }
  const minify = () => {
    setErr(null)
    setOutput(input.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim())
  }
  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label={l.input} placeholder={'<root><item id="1">text</item></root>'} rows={7} />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={format}>{l.format}</Btn>
        <Btn onClick={minify}>{l.minify}</Btn>
      </div>
      <ErrorNote msg={err} />
      <TA value={output} readOnly label={l.output} rows={10} />
    </div>
  )
}

/* ================= Markdown Preview (lightweight) ================= */

function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let html = esc(md)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre style="background:#0a0f0a;border:1px solid rgba(0,244,142,0.18);padding:10px;overflow:auto"><code>${code}</code></pre>`)
  html = html.replace(/`([^`\n]+)`/g, '<code style="background:rgba(0,244,142,0.12);padding:1px 5px;color:#00F48E">$1</code>')
  html = html.replace(/^###### (.*)$/gm, '<h6 style="color:#00F48E;margin:8px 0">$1</h6>')
  html = html.replace(/^##### (.*)$/gm, '<h5 style="color:#00F48E;margin:8px 0">$1</h5>')
  html = html.replace(/^#### (.*)$/gm, '<h4 style="color:#00F48E;margin:8px 0">$1</h4>')
  html = html.replace(/^### (.*)$/gm, '<h3 style="color:#00F48E;margin:10px 0;font-size:16px">$1</h3>')
  html = html.replace(/^## (.*)$/gm, '<h2 style="color:#00F48E;margin:12px 0;font-size:18px">$1</h2>')
  html = html.replace(/^# (.*)$/gm, '<h1 style="color:#00F48E;margin:14px 0;font-size:22px">$1</h1>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#eafff5">$1</strong>')
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#ffb000;text-decoration:underline">$1</a>')
  html = html.replace(/^&gt; (.*)$/gm, '<blockquote style="border-left:3px solid #00F48E;padding-left:10px;color:#5d7a68;margin:6px 0">$1</blockquote>')
  html = html.replace(/^[-*] (.*)$/gm, '<div style="padding-left:14px">· $1</div>')
  html = html.replace(/^---$/gm, '<hr style="border-color:rgba(0,244,142,0.2);margin:10px 0">')
  html = html.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')
  return html
}

export function MarkdownTool() {
  const l = useLocalized(formatL).markdown
  const [input, setInput] = useState(l.sample)
  const html = useMemo(() => mdToHtml(input), [input])
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Panel title={l.sourceTitle}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          spellCheck={false}
          className="w-full h-[420px] resize-y bg-panel-2 border border-line-soft px-2.5 py-2 text-[12.5px] text-bright focus:border-phosphor/40"
        />
      </Panel>
      <Panel title={l.previewTitle}>
        <div
          className="h-[420px] overflow-auto px-2 text-[13px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </Panel>
    </div>
  )
}
