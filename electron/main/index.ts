import { app, BrowserWindow, nativeTheme, ipcMain, shell, dialog, session } from 'electron'
import { join } from 'path'
import { homedir } from 'node:os'
import fs from 'node:fs'
// electron-updater 是 tsc 编译的 CJS 包，导出用 Object.defineProperty(getter) 定义，
// Node 的 ESM named-export 探测（cjs-module-lexer）识别不到 → 必须走 default 再解构
import electronUpdater from 'electron-updater'
import { performRequest } from './http'
import { createChatController } from './chat-ipc'
import { createMcpClientController } from './mcpclient-ipc'
import { createAgentRulesController } from './agentrules-ipc'
import { createChatStore, type ChatStore } from './chat-store'
import { buildClientConfig, configHints, resolveMcpLaunch } from '../mcp/paths'
import { CaptureProxy } from './proxy/server'
import { SystemProxyManager } from './systemproxy'
import type { HttpRequestSpec, HttpRequestResult } from '../../src/lib/http-types'
import type { ChatEvent, ChatSendResult, ChatSendSpec } from '../../src/lib/chat-types'
import type { AgentScanSpec, RulesTarget } from '../../src/lib/agentrules-types'
import type { McpClientEvent, McpConnectSpec } from '../../src/lib/mcpclient-types'
import type { McpInfo } from '../../src/lib/mcp-types'
import type {
  CaInfo,
  InterceptDecision,
  InterceptRequest,
  ProxyRule,
  ProxySession,
  ProxyState,
} from '../../src/lib/proxy-types'

const { autoUpdater } = electronUpdater

// 主进程产物为 ESM（package.json type: module），electron-vite 会把 __dirname 编译成 import.meta.dirname

let mainWindow: BrowserWindow | null = null

/* ================= 自动更新 ================= */

function sendUpdaterEvent(evt: Record<string, unknown>): void {
  mainWindow?.webContents.send('updater:event', evt)
}

function setupAutoUpdater(): void {
  // 开发环境跳过自动更新
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendUpdaterEvent({ type: 'checking' }))
  autoUpdater.on('update-available', (info) => sendUpdaterEvent({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => sendUpdaterEvent({ type: 'none' }))
  autoUpdater.on('download-progress', (p) => sendUpdaterEvent({ type: 'progress', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => sendUpdaterEvent({ type: 'downloaded', version: info.version }))
  autoUpdater.on('error', () => sendUpdaterEvent({ type: 'error' }))

  // 启动 3 秒后检查，之后每 4 小时检查一次
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 3000)
  setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 4 * 60 * 60 * 1000)
}

/* ================= 抓包代理 ================= */

let proxy: CaptureProxy | null = null
/** 系统代理管理器（惰性创建：app.getPath('userData') 在 app ready 前后都可用，但快照路径晚点算更稳） */
let systemProxyManager: SystemProxyManager | null = null
function systemProxy(): SystemProxyManager {
  if (!systemProxyManager) {
    systemProxyManager = new SystemProxyManager(join(app.getPath('userData'), 'system-proxy-snapshot.json'))
  }
  return systemProxyManager
}
const pendingIntercepts = new Map<string, (d: InterceptDecision) => void>()

function sendProxyEvent(evt: Record<string, unknown>): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('proxy:event', evt)
}

function proxyState(): ProxyState {
  const caInfo = proxy?.authority.getInfo() ?? null
  return {
    running: proxy?.isRunning ?? false,
    port: proxy?.port ?? 0,
    mitm: proxy?.mitm ?? true,
    sessionCount: proxy?.listSessions().length ?? 0,
    caReady: !!caInfo,
    caInfo,
    systemProxy: lastSystemProxy,
    lastError: lastProxyError,
  }
}

let lastSystemProxy: ProxyState['systemProxy'] = {
  enabled: false, server: '', supported: true, managed: false, detail: '',
}
let lastProxyError: string | undefined

function pushState(): void {
  sendProxyEvent({ type: 'state', state: proxyState() })
}

/** 统一的保存对话框（有无主窗口两种情况的重载不同，这里包一层） */
async function askSavePath(options: Electron.SaveDialogOptions): Promise<string | null> {
  const win = mainWindow
  const result = win && !win.isDestroyed()
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

function ensureProxy(): CaptureProxy {
  if (!proxy) {
    proxy = new CaptureProxy({
      port: 8899,
      mitm: true,
      caDir: join(app.getPath('userData'), 'proxy-ca'),
      rulesFile: join(app.getPath('userData'), 'proxy-rules.json'),
      onSession: (s: ProxySession, phase: 'request' | 'complete') => {
        sendProxyEvent({ type: 'session', session: s, phase })
      },
      onError: (message: string) => {
        lastProxyError = message
        sendProxyEvent({ type: 'error', message })
      },
      onIntercept: (req: InterceptRequest, timeoutMs: number) => new Promise<InterceptDecision>((resolve) => {
        const done = (d: InterceptDecision): void => resolve(d)
        const timer = setTimeout(() => {
          pendingIntercepts.delete(req.id)
          sendProxyEvent({ type: 'intercept-resolved', id: req.id, auto: true })
          done({ action: 'forward' })
        }, timeoutMs)
        pendingIntercepts.set(req.id, (d: InterceptDecision) => {
          clearTimeout(timer)
          pendingIntercepts.delete(req.id)
          done(d)
        })
        sendProxyEvent({ type: 'intercept', request: req })
      }),
    })
  }
  return proxy
}

function setupProxyIpc(): void {
  ipcMain.handle('http:send', async (_e, spec: HttpRequestSpec): Promise<HttpRequestResult> => {
    return performRequest(spec)
  })

  ipcMain.handle('proxy:start', async (_e, arg: { port?: number; mitm?: boolean } = {}) => {
    lastProxyError = undefined
    const p = ensureProxy()
    try {
      await p.start(arg.port && arg.port > 0 ? arg.port : 8899, arg.mitm ?? true)
    } catch (err) {
      lastProxyError = (err as Error).message
    }
    pushState()
    return proxyState()
  })

  ipcMain.handle('proxy:stop', async () => {
    await proxy?.stop()
    for (const [, resolve] of pendingIntercepts) resolve({ action: 'drop' })
    pendingIntercepts.clear()
    pushState()
    return proxyState()
  })

  ipcMain.handle('proxy:set-mitm', async (_e, mitm: boolean) => {
    await proxy?.setMitm(!!mitm)
    pushState()
    return proxyState()
  })

  ipcMain.handle('proxy:state', async () => {
    if (proxy) lastSystemProxy = await systemProxy().getState().catch(() => lastSystemProxy)
    return proxyState()
  })

  ipcMain.handle('proxy:clear', async () => {
    proxy?.clearSessions()
    pushState()
    return proxyState()
  })

  ipcMain.handle('proxy:sessions', async () => proxy?.listSessions() ?? [])

  ipcMain.handle('proxy:session', async (_e, id: string) => proxy?.getSession(String(id)) ?? null)

  ipcMain.handle('proxy:resolve-intercept', async (_e, decision: InterceptDecision) => {
    const id = (decision as InterceptDecision & { id?: string }).id
    if (!id) return false
    const resolve = pendingIntercepts.get(id)
    if (!resolve) return false
    resolve(decision)
    return true
  })

  /* ---- 规则 ---- */
  ipcMain.handle('proxy:rules', async () => ensureProxy().ruleSet.list())
  ipcMain.handle('proxy:rules-save', async (_e, rules: Partial<ProxyRule>[]) => ensureProxy().ruleSet.replaceAll(rules ?? []))
  ipcMain.handle('proxy:rules-upsert', async (_e, rule: Partial<ProxyRule>) => ensureProxy().ruleSet.upsert(rule))
  ipcMain.handle('proxy:rules-remove', async (_e, id: string) => ensureProxy().ruleSet.remove(String(id)))
  ipcMain.handle('proxy:rules-clear', async () => ensureProxy().ruleSet.clear())

  /* ---- 根证书 ---- */
  ipcMain.handle('proxy:ca', async (): Promise<CaInfo | null> => {
    try {
      const info = await ensureProxy().authority.init()
      pushState()
      return info
    } catch (err) {
      lastProxyError = (err as Error).message
      pushState()
      return null
    }
  })

  ipcMain.handle('proxy:ca-export', async (_e, format: 'pem' | 'crt' = 'pem') => {
    const info = ensureProxy().authority.getInfo() ?? (await ensureProxy().authority.init())
    const ext = format === 'crt' ? 'crt' : 'pem'
    const filePath = await askSavePath({
      title: '导出根证书',
      defaultPath: join(app.getPath('downloads'), `devtoolbox-ca.${ext}`),
      filters: [{ name: '证书', extensions: [ext] }],
    })
    if (!filePath) return { ok: false, canceled: true, path: '' }
    try {
      ensureProxy().authority.exportTo(filePath)
      return { ok: true, path: filePath, certPem: info.certPem }
    } catch (err) {
      return { ok: false, path: '', error: (err as Error).message }
    }
  })

  ipcMain.handle('proxy:ca-open', async () => {
    const info = ensureProxy().authority.getInfo() ?? (await ensureProxy().authority.init())
    shell.showItemInFolder(info.certPath)
    return info.certPath
  })

  ipcMain.handle('proxy:ca-reset', async () => {
    ensureProxy().authority.reset()
    const info = await ensureProxy().authority.init()
    pushState()
    return info
  })

  /* ---- 系统代理 ---- */
  ipcMain.handle('proxy:system-get', async () => {
    lastSystemProxy = await systemProxy().getState()
    pushState()
    return lastSystemProxy
  })

  ipcMain.handle('proxy:system-set', async () => {
    const port = proxy?.port || 8899
    // macOS 上 networksetup 写操作需要管理员权限 → 会弹一次系统密码框
    lastSystemProxy = await systemProxy().set('127.0.0.1', port)
    // 本应用自身的流量直连，避免自己的请求混进抓包列表
    try { await session.defaultSession.setProxy({ mode: 'direct' }) } catch { /* ignore */ }
    pushState()
    return lastSystemProxy
  })

  ipcMain.handle('proxy:system-restore', async () => {
    lastSystemProxy = await systemProxy().restore()
    try { await session.defaultSession.setProxy({ mode: 'system' }) } catch { /* ignore */ }
    pushState()
    return lastSystemProxy
  })

  /* ---- 导出会话 ---- */
  ipcMain.handle('proxy:export-sessions', async (_e, format: 'json' | 'har' = 'json') => {
    const sessions = proxy?.listSessions() ?? []
    const filePath = await askSavePath({
      title: '导出抓包会话',
      defaultPath: join(app.getPath('downloads'), `devtoolbox-traffic.${format === 'har' ? 'har' : 'json'}`),
      filters: [{ name: format === 'har' ? 'HAR' : 'JSON', extensions: [format === 'har' ? 'har' : 'json'] }],
    })
    if (!filePath) return { ok: false, canceled: true, path: '', count: 0 }
    try {
      const payload = format === 'har'
        ? toHar(sessions)
        : JSON.stringify({ exportedAt: new Date().toISOString(), count: sessions.length, sessions }, null, 2)
      fs.writeFileSync(filePath, payload)
      return { ok: true, path: filePath, count: sessions.length }
    } catch (err) {
      return { ok: false, path: '', count: 0, error: (err as Error).message }
    }
  })
}

/** 会话 → HAR 1.2，方便导入 Chrome DevTools / Charles 对照 */
function toHar(sessions: ProxySession[]): string {
  const entries = sessions.map((s) => {
    const reqBody = s.reqBodyBase64 ? Buffer.from(s.reqBodyBase64, 'base64') : Buffer.alloc(0)
    const resBody = s.resBodyBase64 ? Buffer.from(s.resBodyBase64, 'base64') : Buffer.alloc(0)
    const mime = (list: [string, string][]): string => list.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
    return {
      startedDateTime: new Date(s.startedAt).toISOString(),
      time: s.durationMs,
      request: {
        method: s.method,
        url: s.url,
        httpVersion: 'HTTP/1.1',
        headers: s.reqHeaders.map(([name, value]) => ({ name, value })),
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: reqBody.length,
        postData: reqBody.length ? { mimeType: mime(s.reqHeaders), text: reqBody.toString('utf8') } : undefined,
      },
      response: {
        status: s.status ?? 0,
        statusText: s.statusText,
        httpVersion: 'HTTP/1.1',
        headers: s.resHeaders.map(([name, value]) => ({ name, value })),
        cookies: [],
        content: { size: s.resBodyBytes, mimeType: mime(s.resHeaders), text: resBody.toString('utf8') },
        redirectURL: s.resHeaders.find(([k]) => k.toLowerCase() === 'location')?.[1] ?? '',
        headersSize: -1,
        bodySize: resBody.length,
      },
      cache: {},
      timings: { send: 0, wait: s.durationMs, receive: 0 },
    }
  })
  return JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: 'DevOps Toolbox', version: app.getVersion() },
      entries,
    },
  }, null, 2)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'DevOps Toolbox',
    backgroundColor: '#000000',
    webPreferences: {
      // 必须是 .cjs：sandbox: true 时 Electron 以经典脚本加载 preload，ESM 会直接加载失败
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // 默认暗黑主题
  nativeTheme.themeSource = 'dark'

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 外部链接在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 主题变化 → 通知渲染进程
nativeTheme.on('updated', () => {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  mainWindow?.webContents.send('theme:changed', theme)
})

// ---- IPC ----
ipcMain.handle('app:get-version', () => app.getVersion())

ipcMain.handle('updater:check', () => {
  sendUpdaterEvent({ type: 'checking' })
  return autoUpdater.checkForUpdates().catch(() => {
    sendUpdaterEvent({ type: 'error' })
  })
})

ipcMain.handle('updater:quit-and-install', () => {
  autoUpdater.quitAndInstall()
})

ipcMain.handle('theme:get', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

ipcMain.handle('theme:set', (_event, theme: 'dark' | 'light' | 'system') => {
  nativeTheme.themeSource = theme
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

/**
 * MCP 接入信息。
 *
 * 关键点：安装包里没有独立的 node，所以启动命令指向应用自身的可执行文件（process.execPath），
 * 再靠 ELECTRON_RUN_AS_NODE=1 让它以纯 Node 模式跑服务端脚本。
 * 路径由主进程在运行时算出来，界面只负责展示与复制 —— 不让用户自己去猜路径。
 */
ipcMain.handle('mcp:info', (): McpInfo => {
  const launch = resolveMcpLaunch(
    {
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath(),
    },
    (p) => {
      try {
        return fs.existsSync(p)
      } catch {
        return false
      }
    },
  )
  return {
    launch: {
      ...launch,
      configJson: buildClientConfig(launch),
      packaged: app.isPackaged,
      version: app.getVersion(),
    },
    hints: configHints(homedir(), process.platform),
  }
})

setupProxyIpc()

/* ================= 流式对话（AI 调试） ================= */

function sendChatEvent(evt: ChatEvent): void {
  mainWindow?.webContents.send('chat:event', evt)
}

// 编排逻辑在 electron/main/chat-ipc.ts，宿主能力从外面注入 —— 这样它才能被 smoke 脚本直接验证
const chatController = createChatController({ emit: sendChatEvent })

function setupChatIpc(): void {
  ipcMain.handle('chat:send', (_e, spec: ChatSendSpec): ChatSendResult => chatController.send(spec))
  ipcMain.handle('chat:abort', (): boolean => chatController.abort())
}

setupChatIpc()

/* ================= MCP 客户端（Inspector） ================= */

function sendMcpClientEvent(evt: McpClientEvent): void {
  mainWindow?.webContents.send('mcpclient:event', evt)
}

function setupMcpClientIpc(): void {
  const ctl = createMcpClientController({ emit: sendMcpClientEvent }, { version: app.getVersion() })
  ipcMain.handle('mcpclient:connect', (_e, spec: McpConnectSpec) => ctl.connect(spec))
  ipcMain.handle('mcpclient:call', (_e, arg: { name: string; args?: Record<string, unknown> }) =>
    ctl.callTool(String(arg?.name ?? ''), arg?.args ?? {}))
  ipcMain.handle('mcpclient:read-resource', (_e, uri: string) => ctl.readResource(String(uri)))
  ipcMain.handle('mcpclient:get-prompt', (_e, arg: { name: string; args?: Record<string, unknown> }) =>
    ctl.getPrompt(String(arg?.name ?? ''), arg?.args ?? {}))
  ipcMain.handle('mcpclient:ping', () => ctl.ping())
  ipcMain.handle('mcpclient:disconnect', () => ctl.disconnect())
}

setupMcpClientIpc()

/* ================= 对话会话存储 ================= */

// 惰性创建：userData 路径在 app ready 之后才最终确定，别在模块加载时就解析
let chatStoreRef: ChatStore | null = null
function chatStore(): ChatStore {
  return (chatStoreRef ??= createChatStore(app.getPath('userData')))
}

function setupChatStoreIpc(): void {
  ipcMain.handle('chatstore:list', () => chatStore().list())
  ipcMain.handle('chatstore:load', (_e, id: string) => chatStore().load(String(id ?? '')))
  ipcMain.handle('chatstore:save', (_e, input: { id?: string; title?: string; turns?: unknown[] }) =>
    chatStore().save({
      id: String(input?.id ?? ''),
      title: String(input?.title ?? ''),
      turns: Array.isArray(input?.turns) ? input.turns : [],
    }))
  ipcMain.handle('chatstore:remove', (_e, id: string) => chatStore().remove(String(id ?? '')))
  ipcMain.handle('chatstore:file', () => chatStore().filePath())
  ipcMain.handle('chatstore:set-active', (_e, id: string | null) =>
    chatStore().setActive(id === null || id === undefined ? null : String(id)))
}

setupChatStoreIpc()

/* ================= Agent 规则文件生成器 ================= */

const agentRules = createAgentRulesController({
  defaultRoot: () => app.getPath('home'),
  pickDirectory: async (title) => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      // 对话框标题由渲染层给（主进程不留界面文案）
      ...(title ? { title } : {}),
    }
    const res = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  },
  writeFile: async (fullPath, content) => {
    try {
      await fs.promises.writeFile(fullPath, content, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

function setupAgentRulesIpc(): void {
  ipcMain.handle('agentrules:default-root', () => agentRules.defaultRoot())
  ipcMain.handle('agentrules:pick', (_e, title?: string) => agentRules.pick(title))
  ipcMain.handle('agentrules:scan', (_e, spec: AgentScanSpec) => agentRules.scan(spec))
  ipcMain.handle('agentrules:save', (_e, root: string, target: RulesTarget, content: string) =>
    agentRules.save(root, target, content))
}

setupAgentRulesIpc()

// ---- App lifecycle ----
app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()
  // 启动时同步一次系统代理与 CA 状态，便于界面显示真实情况
  proxy = ensureProxy()
  systemProxy().getState().then((s) => { lastSystemProxy = s; pushState() }).catch(() => {})
  ensureProxy().authority.init().then(() => pushState()).catch((err) => {
    lastProxyError = `根证书初始化失败：${(err as Error).message}`
    pushState()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 退出前收尾：还原系统代理、关闭代理端口，避免把用户网络留在代理状态
let cleanupDone = false
app.on('will-quit', (event) => {
  if (cleanupDone) return
  const manager = systemProxy()
  const needRestore = manager.isManaging || (proxy?.isRunning ?? false)
  if (!needRestore) return
  event.preventDefault()
  cleanupDone = true

  void (async () => {
    try { await proxy?.stop() } catch { /* ignore */ }

    if (manager.isManaging) {
      // macOS 还原同样需要管理员授权，会在退出前弹一次密码框 —— 先问清楚再弹
      const answer = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['还原并退出', '仍然退出'],
        defaultId: 0,
        cancelId: 1,
        title: '系统代理尚未还原',
        message: '退出前需要把系统代理还原回原设置',
        detail: process.platform === 'darwin'
          ? '接下来会弹出系统管理员授权框（仅一次）。若选择「仍然退出」，系统和浏览器的流量会继续指向已关闭的抓包端口，可下次启动本工具后在「流量分析」里点「取消系统代理」清理。'
          : '若选择「仍然退出」，系统和浏览器的流量会继续指向已关闭的抓包端口，可下次启动本工具后清理。',
      }).catch(() => ({ response: 1 }))

      if (answer.response === 0) {
        try {
          const state = await manager.restore()
          lastSystemProxy = state
        } catch { /* 还原失败也要让用户退出，快照保留供下次清理 */ }
      }
    }

    try { await session.defaultSession.setProxy({ mode: 'system' }) } catch { /* ignore */ }
    setTimeout(() => app.quit(), 120)
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
