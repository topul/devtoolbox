/**
 * 「Agent 规则文件生成器」的宿主编排层。
 *
 * 依赖全部由宿主注入（选目录、写文件、取主目录），所以这一层不 import electron，
 * 可以被 `npm run smoke:agentrules` 直接驱动 —— 尤其是「文件名拼接」这种
 * 出错就会写到意外位置的地方，必须能断言。
 */
import path from 'node:path'
import { scanProject } from './agentrules'
import {
  RULES_FILENAMES,
  RULES_TARGETS,
  type AgentRulesSaveResult,
  type AgentScanResult,
  type AgentScanSpec,
  type RulesTarget,
} from '../../src/lib/agentrules-types'

export interface AgentRulesHost {
  /** 弹目录选择框；取消返回 null。title 由调用方给（主进程不留界面文案） */
  pickDirectory: (title?: string) => Promise<string | null>
  /** 写文本文件；失败返回错误信息 */
  writeFile: (fullPath: string, content: string) => Promise<{ ok: boolean; error?: string }>
  /** 默认根目录（一般是用户主目录） */
  defaultRoot: () => string
}

export interface AgentRulesController {
  defaultRoot: () => string
  pick: (title?: string) => Promise<string | null>
  scan: (spec: AgentScanSpec) => AgentScanResult
  save: (root: string, target: RulesTarget, content: string) => Promise<AgentRulesSaveResult>
}

function isTarget(v: unknown): v is RulesTarget {
  return typeof v === 'string' && (RULES_TARGETS as string[]).includes(v)
}

export function createAgentRulesController(host: AgentRulesHost): AgentRulesController {
  return {
    defaultRoot: () => host.defaultRoot(),

    pick: (title) => host.pickDirectory(title),

    scan: (spec) => {
      if (!spec || typeof spec.root !== 'string') return { ok: false, code: 'ROOT_EMPTY' }
      return scanProject({
        root: spec.root,
        ...(typeof spec.maxDepth === 'number' ? { maxDepth: spec.maxDepth } : {}),
        ...(typeof spec.maxEntries === 'number' ? { maxEntries: spec.maxEntries } : {}),
      })
    },

    save: async (root, target, content) => {
      if (!isTarget(target)) return { ok: false, code: 'TARGET_INVALID' }
      if (typeof root !== 'string' || !root.trim()) return { ok: false, code: 'ROOT_EMPTY' }
      if (typeof content !== 'string' || !content.trim()) return { ok: false, code: 'CONTENT_EMPTY' }
      // 文件名来自白名单常量，杜绝从这里拼出任意路径
      const full = path.join(root, RULES_FILENAMES[target])
      const res = await host.writeFile(full, content)
      if (!res.ok) return { ok: false, code: 'WRITE_FAILED', detail: res.error }
      return { ok: true, path: full }
    },
  }
}
