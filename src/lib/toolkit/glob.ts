/**
 * Glob 模式匹配 —— .gitignore / shell 通配 / CI path filter 的统一测试器。
 *
 * 实现直接用 minimatch（bash 风格 glob 的社区标准），这里只做三件事：
 * 把「多行模式 × 多行路径」展开成结果矩阵、可选按文件名匹配（basename）、
 * 以及给 MCP/界面共用的一份纯数据结果。
 */
import { minimatch } from 'minimatch'

export interface GlobOptions {
  /** 匹配以 . 开头的文件（.gitignore 语义默认要开） */
  dot?: boolean
  /** 只用路径的最后一段去匹配模式（深度前缀与裸文件名等价） */
  basename?: boolean
}

export interface GlobPathResult {
  path: string
  /** 任一模式命中即为 true */
  matched: boolean
  /** 命中它的模式原文（可能多个） */
  matchedBy: string[]
}

export function globMatch(
  patterns: string[],
  paths: string[],
  opts: GlobOptions = {},
): GlobPathResult[] {
  const pats = patterns.map((p) => p.trim()).filter(Boolean)
  return paths.map((path) => {
    const matchedBy = pats.filter((p) => {
      try {
        return minimatch(path, p, { dot: opts.dot ?? true, matchBase: opts.basename ?? false })
      } catch {
        return false // 坏模式（如未闭合的 [）按「不命中」处理，别让整个矩阵崩掉
      }
    })
    return { path, matched: matchedBy.length > 0, matchedBy }
  })
}

/** 单个模式对单条路径的匹配（MCP 场景够用） */
export function globTest(pattern: string, path: string, opts: GlobOptions = {}): boolean {
  return globMatch([pattern], [path], opts)[0].matched
}
