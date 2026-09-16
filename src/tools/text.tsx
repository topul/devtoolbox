import React, { useState, useMemo } from 'react'
import { Btn, TA, Input, ErrorNote, Panel, Stat, Select, CopyBtn } from '../components/ui'

/* ================= 文本 Diff ================= */

type DiffLine = { type: 'same' | 'add' | 'del'; text: string }

function lineDiff(a: string, b: string): DiffLine[] {
  const al = a.split('\n'), bl = b.split('\n')
  const m = al.length, n = bl.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (al[i] === bl[j]) { out.push({ type: 'same', text: al[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: al[i] }); i++ }
    else { out.push({ type: 'add', text: bl[j] }); j++ }
  }
  while (i < m) out.push({ type: 'del', text: al[i++] })
  while (j < n) out.push({ type: 'add', text: bl[j++] })
  return out
}

export function DiffTool() {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [result, setResult] = useState<DiffLine[] | null>(null)

  const compare = () => setResult(lineDiff(a, b))
  const stats = useMemo(() => {
    if (!result) return null
    return {
      add: result.filter(r => r.type === 'add').length,
      del: result.filter(r => r.type === 'del').length,
      same: result.filter(r => r.type === 'same').length,
    }
  }, [result])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TA value={a} onChange={setA} label="原始文本 (A)" rows={8} />
        <TA value={b} onChange={setB} label="对比文本 (B)" rows={8} />
      </div>
      <Btn variant="primary" onClick={compare}>开始对比</Btn>
      {result && stats && (
        <div className="space-y-3">
          <div className="flex gap-4 text-[12px]">
            <span className="text-phosphor">+ {stats.add} 新增</span>
            <span className="text-danger">− {stats.del} 删除</span>
            <span className="text-muted">= {stats.same} 未变</span>
          </div>
          <div className="border border-line-soft bg-panel-2 max-h-[480px] overflow-auto">
            {result.map((r, i) => (
              <div key={i} className={`flex px-2 text-[12px] leading-6 ${
                r.type === 'add' ? 'bg-phosphor-faint text-phosphor' :
                r.type === 'del' ? 'bg-danger/10 text-danger line-through decoration-danger/50' : 'text-dim'
              }`}>
                <span className="w-6 shrink-0 select-none text-muted/60">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
                <span className="whitespace-pre-wrap break-all">{r.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= 正则测试 ================= */

const REGEX_PRESETS = [
  { name: '邮箱', pattern: '^[\\w.-]+@[\\w-]+(\\.[\\w-]+)+$' },
  { name: '手机号(中)', pattern: '^1[3-9]\\d{9}$' },
  { name: 'IPv4', pattern: '^((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)$' },
  { name: 'URL', pattern: '^https?://[\\w.-]+(:\\d+)?(/\\S*)?$' },
  { name: '身份证(中)', pattern: '^\\d{17}[\\dXx]$' },
  { name: 'MAC 地址', pattern: '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$' },
  { name: '日期 YYYY-MM-DD', pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$' },
]

export function RegexTool() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const matches = useMemo(() => {
    setErr(null)
    if (!pattern) return null
    try {
      const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
      const out: { match: string; index: number; groups: string[] }[] = []
      let m: RegExpExecArray | null
      let guard = 0
      while ((m = re.exec(text)) && guard++ < 1000) {
        out.push({ match: m[0], index: m.index, groups: m.slice(1) })
        if (m[0] === '') re.lastIndex++
      }
      return out
    } catch (e) {
      setErr('正则表达式错误：' + (e as Error).message)
      return null
    }
  }, [pattern, flags, text])

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <Input value={pattern} onChange={setPattern} label="正则表达式" placeholder="(\d{3})-(\d{4})" />
        </div>
        <Select value={flags} onChange={setFlags} label="标志" options={[
          { value: 'g', label: 'g 全局' }, { value: 'gi', label: 'gi 全局+忽略大小写' },
          { value: 'gm', label: 'gm 全局+多行' }, { value: 'gims', label: 'gims 全部' },
        ]} />
      </div>
      <div className="flex gap-2 flex-wrap">
        {REGEX_PRESETS.map(p => (
          <button key={p.name} onClick={() => setPattern(p.pattern)}
            className="px-2 py-0.5 text-[11px] border border-line-soft text-muted hover:text-phosphor hover:border-phosphor/40 transition-colors">
            {p.name}
          </button>
        ))}
      </div>
      <TA value={text} onChange={setText} label="测试文本" rows={6} />
      <ErrorNote msg={err} />
      {matches && (
        <div className="space-y-2">
          <div className="text-[12px] text-muted">匹配 <span className="text-phosphor">{matches.length}</span> 处</div>
          <div className="border border-line-soft bg-panel-2 max-h-[320px] overflow-auto">
            {matches.map((m, i) => (
              <div key={i} className="flex gap-3 px-3 py-1.5 border-b border-line-soft last:border-0 text-[12px]">
                <span className="text-muted/60 w-8 shrink-0">#{i + 1}</span>
                <span className="text-phosphor break-all">{m.match}</span>
                <span className="text-muted shrink-0">@{m.index}</span>
                {m.groups.length > 0 && (
                  <span className="text-amber break-all">组: {m.groups.map(g => JSON.stringify(g)).join(', ')}</span>
                )}
              </div>
            ))}
            {matches.length === 0 && <div className="px-3 py-2 text-muted text-[12px]">无匹配结果</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= 字数统计 ================= */

export function WordCountTool() {
  const [text, setText] = useState('')
  const s = useMemo(() => {
    const chars = text.length
    const noSpace = text.replace(/\s/g, '').length
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
    const words = (text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[a-zA-Z0-9_'-]+/g) || []).length
    const lines = text ? text.split('\n').length : 0
    const bytes = new TextEncoder().encode(text).length
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length
    return { chars, noSpace, cjk, words, lines, bytes, paragraphs }
  }, [text])
  return (
    <div className="space-y-3">
      <TA value={text} onChange={setText} label="文本" rows={9} placeholder="粘贴文本后实时统计..." />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <Stat label="总字符" value={s.chars} />
        <Stat label="非空白字符" value={s.noSpace} />
        <Stat label="汉字" value={s.cjk} />
        <Stat label="英文单词" value={s.words} />
        <Stat label="行数" value={s.lines} />
        <Stat label="段落" value={s.paragraphs} />
        <Stat label="字节(UTF-8)" value={s.bytes} />
      </div>
    </div>
  )
}

/* ================= 命名风格转换 ================= */

function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .trim().toLowerCase().split(' ').filter(Boolean)
}

export function CaseTool() {
  const [input, setInput] = useState('')
  const out = useMemo(() => {
    const w = words(input)
    if (!w.length) return null
    const camel = w[0] + w.slice(1).map(x => x[0].toUpperCase() + x.slice(1)).join('')
    const pascal = w.map(x => x[0].toUpperCase() + x.slice(1)).join('')
    const snake = w.join('_')
    const screaming = w.join('_').toUpperCase()
    const kebab = w.join('-')
    const upper = input.toUpperCase()
    const lower = input.toLowerCase()
    return { camelCase: camel, PascalCase: pascal, snake_case: snake, SCREAMING: screaming, 'kebab-case': kebab, UPPERCASE: upper, lowercase: lower }
  }, [input])
  return (
    <div className="space-y-3">
      <Input value={input} onChange={setInput} label="输入标识符" placeholder="user_name 或 userName 或 user-name" />
      {out && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(out).map(([k, v]) => (
            <div key={k} className="border border-line-soft bg-panel-2 px-3 py-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted">{k}</div>
                <div className="text-phosphor text-[13px] break-all">{v}</div>
              </div>
              <CopyBtn text={v} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= 行处理 ================= */

export function LineOpsTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')

  const ops: [string, (lines: string[]) => string[]][] = [
    ['去重', l => [...new Set(l)]],
    ['去空行', l => l.filter(x => x.trim())],
    ['去除首尾空白', l => l.map(x => x.trim())],
    ['升序排序', l => [...l].sort()],
    ['降序排序', l => [...l].sort().reverse()],
    ['数字排序', l => [...l].sort((a, b) => parseFloat(a) - parseFloat(b))],
    ['随机打乱', l => [...l].sort(() => Math.random() - 0.5)],
    ['反转顺序', l => [...l].reverse()],
    ['添加行号', l => l.map((x, i) => `${i + 1}. ${x}`)],
    ['每行加引号', l => l.map(x => `"${x}"`)],
    ['逗号拼接', l => [l.join(',')]],
  ]

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="输入（每行一条）" rows={7} />
      <div className="flex gap-2 flex-wrap">
        {ops.map(([name, fn]) => (
          <Btn key={name} onClick={() => setOutput(fn(input.split('\n')).join('\n'))}>{name}</Btn>
        ))}
      </div>
      <TA value={output} readOnly label="输出" rows={7} />
    </div>
  )
}
