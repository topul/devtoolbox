import { contextBridge, ipcRenderer } from 'electron'
import type { HttpRequestResult, HttpRequestSpec } from '../../src/lib/http-types'
import type { ChatEvent, ChatSendResult, ChatSendSpec } from '../../src/lib/chat-types'
import type { McpInfo } from '../../src/lib/mcp-types'
import type {
  ChatStoreListResult,
  ChatStoreLoadResult,
  ChatStoreWriteResult,
} from '../../src/lib/chatstore-types'
import type {
  AgentRulesSaveResult,
  AgentScanResult,
  AgentScanSpec,
  RulesTarget,
} from '../../src/lib/agentrules-types'
import type {
  McpCallOutcome,
  McpClientEvent,
  McpConnectResult,
  McpConnectSpec,
  McpPingResult,
} from '../../src/lib/mcpclient-types'
import type {
  CaInfo,
  InterceptDecision,
  ProxyEvent,
  ProxyRule,
  ProxySession,
  ProxyState,
  SystemProxyState,
} from '../../src/lib/proxy-types'

export interface UpdaterEvent {
  type: 'checking' | 'available' | 'progress' | 'downloaded' | 'none' | 'error'
  version?: string
  percent?: number
}

export interface HttpAPI {
  send: (spec: HttpRequestSpec) => Promise<HttpRequestResult>
}

export interface McpAPI {
  /** 取本机 MCP 启动配置（路径、启动命令、可粘贴的配置片段与各客户端位置提示） */
  info: () => Promise<McpInfo>
}

export interface ChatAPI {
  /** 发起一次流式对话；增量内容通过 onEvent 推送 */
  send: (spec: ChatSendSpec) => Promise<ChatSendResult>
  /** 取消当前这条流 */
  abort: () => Promise<boolean>
  onEvent: (callback: (evt: ChatEvent) => void) => () => void
}

export interface AgentRulesAPI {
  /** 默认根目录（用户主目录） */
  defaultRoot: () => Promise<string>
  /** 弹目录选择框；取消返回 null。title 由调用方给，避免主进程留界面文案 */
  pick: (title?: string) => Promise<string | null>
  /** 扫描目录，只回事实不回文案 */
  scan: (spec: AgentScanSpec) => Promise<AgentScanResult>
  /** 把生成好的规则文件写到项目根目录 */
  save: (root: string, target: RulesTarget, content: string) => Promise<AgentRulesSaveResult>
}

export interface ChatStoreAPI {
  /** 会话列表（按最近更新排序）+ 上次打开的会话 */
  list: () => Promise<ChatStoreListResult>
  /** 按需读取某个会话的消息 */
  load: (id: string) => Promise<ChatStoreLoadResult>
  /** 写入/更新一个会话 */
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
  /** 用系统默认程序打开外链（对话里的 Markdown 链接）；协议白名单在主进程 */
  openExternal: (url: string) => Promise<boolean>
  getTheme: () => Promise<'dark' | 'light'>
  setTheme: (theme: 'dark' | 'light' | 'system') => Promise<'dark' | 'light'>
  /** 订阅主题变化；返回退订函数（组件卸载时务必调用，否则会累积监听器） */
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

const api: ElectronAPI = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onThemeChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, theme: 'dark' | 'light'): void => callback(theme)
    ipcRenderer.on('theme:changed', listener)
    return () => ipcRenderer.removeListener('theme:changed', listener)
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  onUpdaterEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, evt: UpdaterEvent): void => callback(evt)
    ipcRenderer.on('updater:event', listener)
    return () => ipcRenderer.removeListener('updater:event', listener)
  },
  http: {
    send: (spec) => ipcRenderer.invoke('http:send', spec),
  },
  mcp: {
    info: () => ipcRenderer.invoke('mcp:info'),
  },
  chat: {
    send: (spec) => ipcRenderer.invoke('chat:send', spec),
    abort: () => ipcRenderer.invoke('chat:abort'),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, evt: ChatEvent): void => callback(evt)
      ipcRenderer.on('chat:event', listener)
      return () => ipcRenderer.removeListener('chat:event', listener)
    },
  },
  mcpClient: {
    connect: (spec) => ipcRenderer.invoke('mcpclient:connect', spec),
    call: (name, args) => ipcRenderer.invoke('mcpclient:call', { name, args }),
    readResource: (uri) => ipcRenderer.invoke('mcpclient:read-resource', uri),
    getPrompt: (name, args) => ipcRenderer.invoke('mcpclient:get-prompt', { name, args }),
    ping: () => ipcRenderer.invoke('mcpclient:ping'),
    disconnect: () => ipcRenderer.invoke('mcpclient:disconnect'),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, evt: McpClientEvent): void => callback(evt)
      ipcRenderer.on('mcpclient:event', listener)
      return () => ipcRenderer.removeListener('mcpclient:event', listener)
    },
  },
  chatStore: {
    list: () => ipcRenderer.invoke('chatstore:list'),
    load: (id) => ipcRenderer.invoke('chatstore:load', id),
    save: (input) => ipcRenderer.invoke('chatstore:save', input),
    remove: (id) => ipcRenderer.invoke('chatstore:remove', id),
    setActive: (id) => ipcRenderer.invoke('chatstore:set-active', id),
    file: () => ipcRenderer.invoke('chatstore:file'),
  },
  agentRules: {
    defaultRoot: () => ipcRenderer.invoke('agentrules:default-root'),
    pick: (title) => ipcRenderer.invoke('agentrules:pick', title),
    scan: (spec) => ipcRenderer.invoke('agentrules:scan', spec),
    save: (root, target, content) => ipcRenderer.invoke('agentrules:save', root, target, content),
  },
  proxy: {
    start: (port, mitm) => ipcRenderer.invoke('proxy:start', { port, mitm }),
    stop: () => ipcRenderer.invoke('proxy:stop'),
    setMitm: (mitm) => ipcRenderer.invoke('proxy:set-mitm', mitm),
    state: () => ipcRenderer.invoke('proxy:state'),
    clear: () => ipcRenderer.invoke('proxy:clear'),
    sessions: () => ipcRenderer.invoke('proxy:sessions'),
    session: (id) => ipcRenderer.invoke('proxy:session', id),
    resolveIntercept: (decision) => ipcRenderer.invoke('proxy:resolve-intercept', decision),
    rules: () => ipcRenderer.invoke('proxy:rules'),
    rulesSave: (rules) => ipcRenderer.invoke('proxy:rules-save', rules),
    rulesUpsert: (rule) => ipcRenderer.invoke('proxy:rules-upsert', rule),
    rulesRemove: (id) => ipcRenderer.invoke('proxy:rules-remove', id),
    rulesClear: () => ipcRenderer.invoke('proxy:rules-clear'),
    caInfo: () => ipcRenderer.invoke('proxy:ca'),
    caExport: (format) => ipcRenderer.invoke('proxy:ca-export', format),
    caOpen: () => ipcRenderer.invoke('proxy:ca-open'),
    caReset: () => ipcRenderer.invoke('proxy:ca-reset'),
    systemGet: () => ipcRenderer.invoke('proxy:system-get'),
    systemSet: () => ipcRenderer.invoke('proxy:system-set'),
    systemRestore: () => ipcRenderer.invoke('proxy:system-restore'),
    exportSessions: (format) => ipcRenderer.invoke('proxy:export-sessions', format),
    onEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, evt: ProxyEvent): void => callback(evt)
      ipcRenderer.on('proxy:event', listener)
      return () => ipcRenderer.removeListener('proxy:event', listener)
    },
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', api)
} else {
  // @ts-expect-error fallback for non-isolated context
  window.electronAPI = api
}
