/**
 * 抓包工具渲染侧的纯视图逻辑 —— 头部文本互转、空规则模板、断点处置载荷。
 * 从 src/tools/proxy.tsx 拆出：这些不依赖 React 与 IPC，供主文件与各拆分组件共用。
 * 注意与 electron/main/proxy/ 的主进程代理引擎无关，别混淆。
 */
import type { ProxyRule } from './proxy-types'

/** 断点处置结果（与主进程 InterceptDecision 对齐，额外带 id） */
export type InterceptDecisionInput = {
  id: string
  action: 'forward' | 'drop'
  method?: string
  url?: string
  headers?: [string, string][]
  bodyBase64?: string
  mock?: { status: number; headers: [string, string][]; bodyText?: string } | null
}

/** 未指定端口时的默认监听端口（启动、顶栏提示、空态引导都用它兜底） */
export const DEFAULT_PORT = 8899

export function headersToText(list: [string, string][]): string {
  return list.map(([k, v]) => `${k}: ${v}`).join('\n')
}

export function textToHeaders(text: string): [string, string][] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':')
      if (i < 0) return [line, ''] as [string, string]
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()] as [string, string]
    })
    .filter(([k]) => k.length > 0)
}

export function emptyRule(): ProxyRule {
  return {
    id: `r_${Math.random().toString(36).slice(2, 10)}`,
    name: '',
    enabled: true,
    method: 'ANY',
    host: '',
    path: '',
    scheme: 'any',
    breakpoint: false,
    delayMs: 0,
    block: false,
    mock: null,
    reqHeaderOps: [],
    resHeaderOps: [],
    reqBodyFind: '',
    reqBodyReplace: '',
    reqBodyRegex: false,
    resBodyFind: '',
    resBodyReplace: '',
    resBodyRegex: false,
  }
}
