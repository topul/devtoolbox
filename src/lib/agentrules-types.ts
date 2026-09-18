/**
 * 仓库扫描 → Agent 规则文件的类型契约（main / renderer 共用）。
 *
 * 设计原则：主进程只回**事实**（扫到了什么、有哪些命令、命中哪些信号），
 * 不带任何提示语；怎么组织成 `AGENTS.md` 由渲染层带词条去拼。
 * 这样规则文件天然支持中英双语，也不会把文案写死在主进程里。
 */

export interface AgentScanSpec {
  /** 项目根目录（绝对路径） */
  root: string
  /** 目录树展开深度，默认 3 */
  maxDepth?: number
  /** 扫描条目上限，超过即停止（防大仓库卡死），默认 4000 */
  maxEntries?: number
}

/** 从配置里读出来的可执行命令 */
export interface DetectedCommand {
  /**
   * 稳定分类码：install / dev / start / build / test / lint / typecheck / format / other
   * 界面按当前语言渲染标签，主进程不认识语言。
   */
  kind: string
  /** 脚本原名（如 `smoke:proxy`），是数据不翻译 */
  name: string
  command: string
  /** 出处，如 `package.json` / `Makefile` */
  source: string
}

/** 命中的项目特征，用于「约定」一节 */
export type ProjectSignal =
  | 'hasCi'
  | 'hasGithubActions'
  | 'hasGitlabCi'
  | 'hasDocker'
  | 'hasLockfile'
  | 'hasEditorconfig'
  | 'hasLinter'
  | 'hasFormatter'
  | 'hasTests'
  | 'hasTsconfig'
  | 'hasMonorepo'
  | 'hasEnvExample'
  | 'hasReadme'
  | 'hasLicense'
  | 'hasChangelog'

export interface AgentScanFacts {
  /** 绝对路径 */
  root: string
  /** 目录名，用于标题 */
  rootName: string
  /** 渲染好的目录树文本（已按深度/条目裁剪） */
  tree: string
  stats: {
    files: number
    dirs: number
    /** 因深度或条目上限被截断 */
    truncated: boolean
  }
  /** 编程语言（按检出优先级排序） */
  languages: string[]
  /** 框架 / 运行时 */
  frameworks: string[]
  /** 包管理器；识别不出为 null */
  packageManager: string | null
  commands: DetectedCommand[]
  /** 值得让 Agent 先读的文件（相对路径） */
  keyFiles: string[]
  signals: ProjectSignal[]
  /** 扫描过程中的客观提示码，如 truncated */
  notes: string[]
}

export type AgentScanResult =
  | { ok: true; facts: AgentScanFacts }
  | { ok: false; code: string; detail?: string }

/** 规则文件的三种形态 */
export type RulesTarget = 'agents' | 'cursor' | 'claude'

export const RULES_TARGETS: RulesTarget[] = ['agents', 'cursor', 'claude']

/** 各形态对应的落盘文件名 */
export const RULES_FILENAMES: Record<RulesTarget, string> = {
  agents: 'AGENTS.md',
  cursor: '.cursorrules',
  claude: 'CLAUDE.md',
}

export interface AgentRulesSaveResult {
  ok: boolean
  path?: string
  code?: string
  detail?: string
}
