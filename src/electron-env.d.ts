// Electron bridge types, as seen from the renderer process
import type { HttpRequestResult, HttpRequestSpec } from './lib/http-types'
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
  onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => void
  checkForUpdates: () => Promise<void>
  quitAndInstall: () => Promise<void>
  onUpdaterEvent: (callback: (evt: UpdaterEvent) => void) => () => void
  http: HttpAPI
  proxy: ProxyAPI
}

export type { ProxyEvent, ProxySession, ProxyRule, ProxyState, CaInfo, SystemProxyState, InterceptDecision }

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
