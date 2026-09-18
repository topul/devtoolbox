/**
 * 文本处理 —— 渲染进程与 MCP 服务端共用。
 * 覆盖：行级 diff、命名风格转换、行操作、字数统计、正则调试。
 */

export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

/** 最长公共子序列的行级 diff（与界面高亮一致） */
export function lineDiff(a: string, b: string): DiffLine[] {
  const al = a.split('\n')
  const bl = b.split('\n')
  const m = al.length
  const n = bl.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (al[i] === bl[j]) { out.push({ type: 'same', text: al[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: al[i] }); i++ }
    else { out.push({ type: 'add', text: bl[j] }); j++ }
  }
  while (i < m) out.push({ type: 'del', text: al[i++] })
  while (j < n) out.push({ type: 'add', text: bl[j++] })
  return out
}

/** 统一 diff 风格的文本输出，方便 Agent 直接读 */
export function diffAsText(a: string, b: string): string {
  return lineDiff(a, b)
    .map((l) => (l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  ') + l.text)
    .join('\n')
}

export function diffStats(a: string, b: string): { add: number; del: number; same: number } {
  const r = lineDiff(a, b)
  return {
    add: r.filter((x) => x.type === 'add').length,
    del: r.filter((x) => x.type === 'del').length,
    same: r.filter((x) => x.type === 'same').length,
  }
}

function splitWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
}

export const CASE_STYLES = [
  'camelCase', 'PascalCase', 'snake_case', 'SCREAMING_SNAKE', 'kebab-case', 'UPPERCASE', 'lowercase',
] as const
export type CaseStyle = (typeof CASE_STYLES)[number]

export function convertCase(input: string, style: CaseStyle): string {
  const w = splitWords(input)
  switch (style) {
    case 'camelCase':
      return w.length ? w[0] + w.slice(1).map((x) => x[0].toUpperCase() + x.slice(1)).join('') : ''
    case 'PascalCase':
      return w.map((x) => x[0].toUpperCase() + x.slice(1)).join('')
    case 'snake_case':
      return w.join('_')
    case 'SCREAMING_SNAKE':
      return w.join('_').toUpperCase()
    case 'kebab-case':
      return w.join('-')
    case 'UPPERCASE':
      return input.toUpperCase()
    case 'lowercase':
      return input.toLowerCase()
  }
}

export function convertCaseAll(input: string): { style: CaseStyle; value: string }[] {
  return CASE_STYLES.map((s) => ({ style: s, value: convertCase(input, s) }))
}

export const LINE_OPS = [
  'dedupe', 'removeEmpty', 'trim', 'sortAsc', 'sortDesc', 'sortNumeric', 'shuffle', 'reverse', 'number', 'quote', 'join',
] as const
export type LineOp = (typeof LINE_OPS)[number]

export function applyLineOp(text: string, op: LineOp, options: { separator?: string } = {}): string {
  const lines = text.split('\n')
  switch (op) {
    case 'dedupe': return [...new Set(lines)].join('\n')
    case 'removeEmpty': return lines.filter((v) => v.trim()).join('\n')
    case 'trim': return lines.map((v) => v.trim()).join('\n')
    case 'sortAsc': return [...lines].sort().join('\n')
    case 'sortDesc': return [...lines].sort().reverse().join('\n')
    case 'sortNumeric': return [...lines].sort((a, b) => parseFloat(a) - parseFloat(b)).join('\n')
    case 'shuffle': return [...lines].sort(() => Math.random() - 0.5).join('\n')
    case 'reverse': return [...lines].reverse().join('\n')
    case 'number': return lines.map((v, i) => `${i + 1}. ${v}`).join('\n')
    case 'quote': return lines.map((v) => `"${v}"`).join('\n')
    case 'join': return lines.join(options.separator ?? ',')
  }
}

export interface TextStats {
  chars: number
  charsNoSpace: number
  cjk: number
  words: number
  lines: number
  paragraphs: number
  bytes: number
}

export function textStats(text: string): TextStats {
  const cjkRe = /[\u4e00-\u9fff\u3400-\u4dbf]/g
  return {
    chars: text.length,
    charsNoSpace: text.replace(/\s/g, '').length,
    cjk: (text.match(cjkRe) || []).length,
    words: (text.replace(cjkRe, ' ').match(/[a-zA-Z0-9_'-]+/g) || []).length,
    lines: text ? text.split('\n').length : 0,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    bytes: new TextEncoder().encode(text).length,
  }
}

export interface RegexMatch {
  match: string
  index: number
  groups: (string | undefined)[]
  named: Record<string, string | undefined>
}

/** 正则调试：最多返回 1000 个匹配，避免零宽断言导致死循环 */
export function regexTest(pattern: string, flags: string, text: string): RegexMatch[] {
  const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
  const out: RegexMatch[] = []
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = re.exec(text)) && guard++ < 1000) {
    out.push({ match: m[0], index: m.index, groups: m.slice(1), named: { ...m.groups } })
    if (m[0] === '') re.lastIndex++
  }
  return out
}
