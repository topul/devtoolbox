// Electron bridge types, as seen from the renderer process
import type { HttpRequestResult, HttpRequestSpec } from './lib/http-types'
import type { ChatEvent, ChatSendResult, ChatSendSpec } from './lib/chat-types'
import type { McpInfo } from './lib/mcp-types'
import type {
  ChatStoreListResult,
  ChatStoreLoadResult,
  ChatStoreWriteResult,
} from './lib/chatstore-types'
import type {
  AgentRulesSaveResult,
  AgentScanResult,
  AgentScanSpec,
  RulesTarget,
} from './lib/agentrules-types'
import type {
  McpCallOutcome,
  McpClientEvent,
  McpConnectResult,
  McpConnectSpec,
  McpPingResult,
} from './lib/mcpclient-types'
import type {
  CaInfo,
  InterceptDecision,
  ProxyEvent,
  ProxyRule,
  ProxySession,
  ProxyState,
  SystemProxyState,
} from './lib/proxy-types'

export interface UpdaterEvent {
  type: 'checking' | 'available' | 'progress' | 'downloaded' | 'none' | 'error'
  version?: string
  percent?: number
}

export interface HttpAPI {
  send: (spec: HttpRequestSpec) => Promise<HttpRequestResult>
}

export interface McpAPI {
  info: () => Promise<McpInfo>
}

export interface ChatAPI {
  send: (spec: ChatSendSpec) => Promise<ChatSendResult>
  abort: () => Promise<boolean>
  onEvent: (callback: (evt: ChatEvent) => void) => () => void
}

export interface ChatStoreAPI {
  list: () => Promise<ChatStoreListResult>
  load: (id: string) => Promise<ChatStoreLoadResult>
  save: (input: { id: string; title: string; turns: unknown[] }) => Promise<ChatStoreWriteResult>
  remove: (id: string) => Promise<ChatStoreWriteResult>
  setActive: (id: string | null) => Promise<ChatStoreWriteResult>
  /** 数据文件路径（界面提示用户它在哪，便于自己备份） */
  file: () => Promise<string>
}

export interface McpClientAPI {
  connect: (spec: McpConnectSpec) => Promise<McpConnectResult>
  call: (name: string, args: Record<string, unknown>) => Promise<McpCallOutcome>
  readResource: (uri: string) => Promise<McpCallOutcome>
  getPrompt: (name: string, args: Record<string, unknown>) => Promise<McpCallOutcome>
  ping: () => Promise<McpPingResult>
  disconnect: () => Promise<boolean>
  onEvent: (callback: (evt: McpClientEvent) => void) => () => void
}

export interface AgentRulesAPI {
  defaultRoot: () => Promise<string>
  pick: (title?: string) => Promise<string | null>
  scan: (spec: AgentScanSpec) => Promise<AgentScanResult>
  save: (root: string, target: RulesTarget, content: string) => Promise<AgentRulesSaveResult>
}

export interface ProxyAPI {
  start: (port: number, mitm: boolean) => Promise<ProxyState>
  stop: () => Promise<ProxyState>
  setMitm: (mitm: boolean) => Promise<ProxyState>
  state: () => Promise<ProxyState>
  clear: () => Promise<ProxyState>
  sessions: () => Promise<ProxySession[]>
  session: (id: string) => Promise<ProxySession | null>
  resolveIntercept: (decision: InterceptDecision & { id: string }) => Promise<boolean>
  rules: () => Promise<ProxyRule[]>
  rulesSave: (rules: Partial<ProxyRule>[]) => Promise<ProxyRule[]>
  rulesUpsert: (rule: Partial<ProxyRule>) => Promise<ProxyRule[]>
  rulesRemove: (id: string) => Promise<ProxyRule[]>
  rulesClear: () => Promise<ProxyRule[]>
  caInfo: () => Promise<CaInfo | null>
  caExport: (format: 'pem' | 'crt') => Promise<{ ok: boolean; path: string; canceled?: boolean; error?: string }>
  caOpen: () => Promise<string>
  caReset: () => Promise<CaInfo | null>
  systemGet: () => Promise<SystemProxyState>
  systemSet: () => Promise<SystemProxyState>
  systemRestore: () => Promise<SystemProxyState>
  exportSessions: (format: 'json' | 'har') => Promise<{ ok: boolean; path: string; count: number; canceled?: boolean; error?: string }>
  onEvent: (callback: (evt: ProxyEvent) => void) => () => void
}

export interface ElectronAPI {
  getVersion: () => Promise<string>
  getTheme: () => Promise<'dark' | 'light'>
  setTheme: (theme: 'dark' | 'light' | 'system') => Promise<'dark' | 'light'>
  onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => () => void
  checkForUpdates: () => Promise<void>
  quitAndInstall: () => Promise<void>
  onUpdaterEvent: (callback: (evt: UpdaterEvent) => void) => () => void
  http: HttpAPI
  proxy: ProxyAPI
  mcp: McpAPI
  chat: ChatAPI
  mcpClient: McpClientAPI
  agentRules: AgentRulesAPI
  chatStore: ChatStoreAPI
}

export type { ProxyEvent, ProxySession, ProxyRule, ProxyState, CaInfo, SystemProxyState, InterceptDecision }

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
