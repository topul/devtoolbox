/**
 * Agent 规则文件生成器（纯字符串拼装，无 IO）。
 *
 * 输入是扫描出来的**事实**（目录树、命令、技术栈），输出是 `AGENTS.md` /
 * `.cursorrules` / `CLAUDE.md` 的草稿。文案由调用方以 `RulesStrings` 传入 ——
 * 这样同一份逻辑能出中英双语，也便于被脚本直接断言。
 *
 * 三类文件的形态差别：
 *   - AGENTS.md  ：Markdown，结构完整，事实为主；
 *   - CLAUDE.md  ：Markdown，偏精简，重点在命令与边界；
 *   - .cursorrules：纯文本指令，短句、祈使句，不用表格。
 */
import type { AgentScanFacts, RulesTarget } from '../agentrules-types'

export interface RulesStrings {
  /** 文档标题，参数是项目名 */
  title: (name: string) => string
  intro: string
  overview: string
  commandsTitle: string
  structureTitle: string
  conventionsTitle: string
  filesTitle: string
  treeNote: string
  noneLabel: string
  /** 表格表头：用途 / 命令 / 出处 */
  thKind: string
  thCommand: string
  thSource: string
  /** 命令分类展示名 */
  commandKinds: Record<string, string>
  /** 项目特征对应的约定条目 */
  signals: Record<string, string>
  /** 扫描提示 */
  notes: Record<string, string>
  langLabel: string
  frameworkLabel: string
  pkgLabel: string
  cursorIntro: string
  claudeIntro: string
  /** 结尾提醒，提示这份文件是草稿、需要人过一遍 */
  footer: string
}

/** 命令分类的展示顺序：越靠前越是「一进来就要用」的 */
const KIND_ORDER = ['install', 'dev', 'start', 'build', 'test', 'typecheck', 'lint', 'format', 'other']

function sortCommands(facts: AgentScanFacts): AgentScanFacts['commands'] {
  return [...facts.commands].sort((a, b) => {
    const ia = KIND_ORDER.indexOf(a.kind)
    const ib = KIND_ORDER.indexOf(b.kind)
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    return a.name.localeCompare(b.name)
  })
}

function kindLabel(s: RulesStrings, kind: string): string {
  return s.commandKinds[kind] ?? s.commandKinds.other ?? kind
}

/** 概览一行：只在有内容时输出 */
function overviewLines(facts: AgentScanFacts, s: RulesStrings): string[] {
  const lines: string[] = []
  if (facts.languages.length) lines.push(`- **${s.langLabel}**: ${facts.languages.join(', ')}`)
  if (facts.frameworks.length) lines.push(`- **${s.frameworkLabel}**: ${facts.frameworks.join(', ')}`)
  if (facts.packageManager) lines.push(`- **${s.pkgLabel}**: ${facts.packageManager}`)
  return lines
}

/** 事实 → 结构化片段（三种目标共用同一份内容） */
export interface RulesSections {
  overview: string[]
  commands: AgentScanFacts['commands']
  tree: string
  conventions: string[]
  files: string[]
  notes: string[]
}

export function buildSections(facts: AgentScanFacts, s: RulesStrings): RulesSections {
  return {
    overview: overviewLines(facts, s),
    commands: sortCommands(facts),
    tree: facts.tree,
    conventions: facts.signals.map((sig) => s.signals[sig]).filter((x): x is string => !!x),
    files: facts.keyFiles,
    notes: facts.notes.map((n) => s.notes[n]).filter((x): x is string => !!x),
  }
}

export function generateRules(facts: AgentScanFacts, target: RulesTarget, s: RulesStrings): string {
  const sec = buildSections(facts, s)
  if (target === 'cursor') return renderCursor(facts, sec, s)
  if (target === 'claude') return renderClaude(facts, sec, s)
  return renderAgents(facts, sec, s)
}

/* ================= AGENTS.md ================= */

function renderAgents(facts: AgentScanFacts, sec: RulesSections, s: RulesStrings): string {
  const out: string[] = []
  out.push(`# ${s.title(facts.rootName)}`)
  out.push('')
  out.push(s.intro)
  out.push('')

  if (sec.overview.length) {
    out.push(`## ${s.overview}`)
    out.push(...sec.overview)
    out.push('')
  }

  if (sec.commands.length) {
    out.push(`## ${s.commandsTitle}`)
    out.push('')
    out.push(`| ${s.thKind} | ${s.thCommand} | ${s.thSource} |`)
    out.push('| --- | --- | --- |')
    for (const c of sec.commands) {
      out.push(`| ${kindLabel(s, c.kind)} | \`${c.command}\` | ${c.source} |`)
    }
    out.push('')
  }

  if (sec.tree) {
    out.push(`## ${s.structureTitle}`)
    out.push('')
    out.push('```')
    out.push(sec.tree)
    out.push('```')
    out.push('')
    out.push(s.treeNote)
    out.push('')
  }

  if (sec.conventions.length) {
    out.push(`## ${s.conventionsTitle}`)
    out.push(...sec.conventions.map((c) => `- ${c}`))
    out.push('')
  }

  if (sec.files.length) {
    out.push(`## ${s.filesTitle}`)
    out.push(...sec.files.map((f) => `- \`${f}\``))
    out.push('')
  }

  if (sec.notes.length) {
    out.push(...sec.notes.map((n) => `> ${n}`))
    out.push('')
  }

  out.push('---')
  out.push('')
  out.push(s.footer)
  return `${out.join('\n').trimEnd()}\n`
}

/* ================= CLAUDE.md ================= */

function renderClaude(facts: AgentScanFacts, sec: RulesSections, s: RulesStrings): string {
  const out: string[] = []
  out.push(`# ${s.title(facts.rootName)}`)
  out.push('')
  out.push(s.claudeIntro)
  out.push('')

  if (sec.commands.length) {
    out.push(`## ${s.commandsTitle}`)
    out.push('')
    out.push('```')
    for (const c of sec.commands) out.push(`${kindLabel(s, c.kind)}: ${c.command}`)
    out.push('```')
    out.push('')
  }

  if (sec.overview.length) {
    out.push(`## ${s.overview}`)
    out.push(...sec.overview)
    out.push('')
  }

  if (sec.conventions.length) {
    out.push(`## ${s.conventionsTitle}`)
    out.push(...sec.conventions.map((c) => `- ${c}`))
    out.push('')
  }

  if (sec.tree) {
    out.push(`## ${s.structureTitle}`)
    out.push('')
    out.push('```')
    out.push(sec.tree)
    out.push('```')
    out.push('')
  }

  if (sec.files.length) {
    out.push(`## ${s.filesTitle}`)
    out.push(...sec.files.map((f) => `- \`${f}\``))
    out.push('')
  }

  if (sec.notes.length) {
    out.push(...sec.notes.map((n) => `> ${n}`))
    out.push('')
  }

  out.push(s.footer)
  return `${out.join('\n').trimEnd()}\n`
}

/* ================= .cursorrules ================= */

function renderCursor(facts: AgentScanFacts, sec: RulesSections, s: RulesStrings): string {
  const out: string[] = []
  out.push(s.title(facts.rootName))
  out.push('')
  out.push(s.cursorIntro)
  out.push('')

  if (sec.overview.length) {
    out.push(`${s.overview}:`)
    for (const line of sec.overview) out.push(line.replace(/^- /, '  - ').replace(/\*\*/g, ''))
    out.push('')
  }

  if (sec.commands.length) {
    out.push(`${s.commandsTitle}:`)
    for (const c of sec.commands) out.push(`  - ${kindLabel(s, c.kind)}: ${c.command}`)
    out.push('')
  }

  if (sec.conventions.length) {
    out.push(`${s.conventionsTitle}:`)
    for (const c of sec.conventions) out.push(`  - ${c}`)
    out.push('')
  }

  if (sec.tree) {
    out.push(`${s.structureTitle}:`)
    for (const line of sec.tree.split('\n')) out.push(`  ${line}`)
    out.push('')
  }

  if (sec.files.length) {
    out.push(`${s.filesTitle}:`)
    for (const f of sec.files) out.push(`  - ${f}`)
    out.push('')
  }

  if (sec.notes.length) {
    for (const n of sec.notes) out.push(`Note: ${n}`)
    out.push('')
  }

  out.push(s.footer)
  return `${out.join('\n').trimEnd()}\n`
}
