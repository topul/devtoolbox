/**
 * 浏览器 / 插件版的宿主 API 总装。
 *
 * 桌面版由 preload 注入 window.electronAPI；浏览器版没有 preload ——
 * main.tsx 检测到缺失时调用 installWebApi() 装上同形态的浏览器实现，
 * 工具层所有 `window.electronAPI?.xxx` 调用一行不改。
 *
 * 能力差异（诚实降级，不装假能力）：
 *   - http / sse / ws / chat / chatStore / agentRules：真实浏览器实现（见各文件）；
 *   - proxy / mcp-server / mcp-inspector：没有本地进程，对应工具在插件构建中隐藏，
 *     剩余入口（如 chat 的内置 stdio 工具源）返回明确的失败原因；
 *   - 上游代理 / TLS 校验开关：浏览器安全模型不允许，返回稳定错误码；
 *   - 自动更新：浏览器由商店分发，更新通道为空实现。
 */
import type { ElectronAPI, UpdaterEvent } from '../../electron-env'
import type { McpInfo } from '../mcp-types'
import type { ProxyState, SystemProxyState } from '../proxy-types'
import { buildWebHttp } from './web-http'
import { buildWebSse } from './web-sse'
import { buildWebWs } from './web-ws'
import { buildWebChat } from './web-chat'
import { buildWebChatStore } from './web-chatstore'
import { buildWebAgentRules } from './web-agentrules'

const ALLOWED_EXTERNAL = /^https?:\/\//i

function getVersionString(): string {
  try {
    const cr = (
      globalThis as { chrome?: { runtime?: { getManifest?: () => { version: string } } } }
    ).chrome
    return cr?.runtime?.getManifest?.().version ?? '1.7.0'
  } catch {
    return '1.7.0'
  }
}

function buildThemeApi(): Pick<ElectronAPI, 'getTheme' | 'setTheme' | 'onThemeChanged'> {
  const KEY = 'devtoolbox-theme'
  const listeners = new Set<(t: 'dark' | 'light') => void>()
  const current = (): 'dark' | 'light' => {
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  // 跟随系统：用户没手动选过（无存储值）时才联动
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem(KEY)) return
    const t = current()
    for (const l of listeners) {
      try {
        l(t)
      } catch {
        /* 忽略 */
      }
    }
  })
  return {
    getTheme: async () => current(),
    setTheme: async (theme: 'dark' | 'light' | 'system') => {
      if (theme === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, theme)
      return current()
    },
    onThemeChanged: (cb: (t: 'dark' | 'light') => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

/** 浏览器版没有本地监听端口：给一个诚实的「未运行」状态，供 http-client 探测 proxy 状态时不报错 */
const PROXY_STATE: ProxyState = {
  running: false,
  port: 0,
  mitm: false,
  sessionCount: 0,
  caReady: false,
  caInfo: null,
  systemProxy: {
    enabled: false,
    server: '',
    supported: false,
    managed: false,
    detail: '',
  } satisfies SystemProxyState,
}

export function buildWebApi(): ElectronAPI {
  const theme = buildThemeApi()
  return {
    getVersion: async () => getVersionString(),
    openExternal: async (url: string) => {
      if (!ALLOWED_EXTERNAL.test(url)) return false
      // 扩展页面里 window.open 会被弹窗拦截器盯上：用户手势链路里基本没事
      window.open(url, '_blank', 'noopener,noreferrer')
      return true
    },
    getTheme: theme.getTheme,
    setTheme: theme.setTheme,
    onThemeChanged: theme.onThemeChanged,
    checkForUpdates: async () => {
      /* 浏览器/插件版更新由商店分发 */
    },
    quitAndInstall: async () => {
      /* 同上 */
    },
    onUpdaterEvent: (_cb: (evt: UpdaterEvent) => void) => () => {
      /* 永远不会有事件 */
    },
    http: buildWebHttp(),
    sse: buildWebSse(),
    ws: buildWebWs(),
    chat: buildWebChat(),
    chatStore: buildWebChatStore(),
    agentRules: buildWebAgentRules(),
    proxy: {
      start: async () => {
        throw new Error('浏览器版不支持抓包代理（需要本地端口监听），请使用桌面版')
      },
      stop: async () => PROXY_STATE,
      setMitm: async () => PROXY_STATE,
      state: async () => PROXY_STATE,
      clear: async () => PROXY_STATE,
      sessions: async () => [],
      session: async () => null,
      resolveIntercept: async () => false,
      rules: async () => [],
      rulesSave: async () => [],
      rulesUpsert: async () => {
        throw new Error('浏览器版不支持抓包代理，请使用桌面版')
      },
      rulesRemove: async () => [],
      rulesClear: async () => [],
      caInfo: async () => null,
      caExport: async () => ({ ok: false, path: '', error: '浏览器版不支持抓包代理' }),
      caOpen: async () => '',
      caReset: async () => null,
      systemGet: async () => PROXY_STATE.systemProxy,
      systemSet: async () => {
        throw new Error('浏览器版无法修改系统代理设置')
      },
      systemRestore: async () => PROXY_STATE.systemProxy,
      exportSessions: async () => ({
        ok: false,
        path: '',
        count: 0,
        error: '浏览器版不支持抓包代理',
      }),
      onEvent: () => () => undefined,
    },
    mcp: {
      info: async (): Promise<McpInfo> => ({
        launch: {
          serverPath: '',
          command: '',
          args: [],
          env: {},
          serverPathExists: false,
          configJson: '',
          packaged: false,
          version: getVersionString(),
        },
        hints: [],
      }),
    },
    tls: {
      probe: async () => ({
        ok: false,
        errorCode: 'DESKTOP_ONLY',
        errorDetail: 'TLS probing is not available in the browser build',
        host: '',
        port: 443,
        protocol: '',
        cipher: '',
        cipherName: '',
        cipherSuiteName: '',
        alpn: '',
        sni: '',
        certs: [],
        elapsedMs: 0,
        authorized: false,
        authorizationError: '',
        isIpHost: false,
      }),
    },
    port: {
      lookup: async () => ({
        ok: false,
        port: 0,
        entries: [],
        command: '',
        error: 'Port lookup needs the desktop app (it shells out to lsof/netstat)',
      }),
    },
    mcpClient: {
      connect: async () => {
        throw new Error('浏览器版不支持 stdio MCP 连接，请使用桌面版或 Streamable HTTP 服务端')
      },
      call: async () => {
        throw new Error('未连接')
      },
      readResource: async () => {
        throw new Error('未连接')
      },
      getPrompt: async () => {
        throw new Error('未连接')
      },
      ping: async () => {
        throw new Error('未连接')
      },
      disconnect: async () => false,
      onEvent: () => () => undefined,
    },
  }
}

/** 入口处调用：桌面版（已有 electronAPI）不装；重复调用幂等 */
export function installWebApi(): void {
  if (typeof window === 'undefined') return
  if (window.electronAPI) return
  window.electronAPI = buildWebApi()
}
