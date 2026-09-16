import { contextBridge, ipcRenderer } from 'electron'
import type { HttpRequestResult, HttpRequestSpec } from '../../src/lib/http-types'
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

const api: ElectronAPI = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme:changed', (_event, theme) => callback(theme))
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
