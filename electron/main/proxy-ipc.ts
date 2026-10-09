/**
 * 抓包代理域：代理实例与状态、IPC 注册、启动同步与退出清理。
 *
 * 拆出来是因为这一域的状态（代理实例、系统代理快照、待决拦截）自成一体，
 * 且退出前的「还原系统代理」弹窗流程与 ready 时的状态同步都属于同一生命周期，
 * 放在入口文件里只会让 index.ts 变成大杂烩。
 */
import { app, dialog, ipcMain, session, shell } from 'electron'
import { join } from 'path'
import fs from 'node:fs'
import { CaptureProxy } from './proxy/server'
import { SystemProxyManager } from './systemproxy'
import { askSavePath, getMainWindow } from './window'
import type {
  CaInfo,
  InterceptDecision,
  InterceptRequest,
  ProxyRule,
  ProxySession,
  ProxyState,
} from '../../src/lib/proxy-types'

let proxy: CaptureProxy | null = null
/** 系统代理管理器（惰性创建：app.getPath('userData') 在 app ready 前后都可用，但快照路径晚点算更稳） */
let systemProxyManager: SystemProxyManager | null = null
function systemProxy(): SystemProxyManager {
  if (!systemProxyManager) {
    systemProxyManager = new SystemProxyManager(
      join(app.getPath('userData'), 'system-proxy-snapshot.json'),
    )
  }
  return systemProxyManager
}
const pendingIntercepts = new Map<string, (d: InterceptDecision) => void>()

function sendProxyEvent(evt: Record<string, unknown>): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send('proxy:event', evt)
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
  enabled: false,
  server: '',
  supported: true,
  managed: false,
  detail: '',
}
let lastProxyError: string | undefined

function pushState(): void {
  sendProxyEvent({ type: 'state', state: proxyState() })
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
      onIntercept: (req: InterceptRequest, timeoutMs: number) =>
        new Promise<InterceptDecision>((resolve) => {
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

export function setupProxyIpc(): void {
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
    if (proxy)
      lastSystemProxy = await systemProxy()
        .getState()
        .catch(() => lastSystemProxy)
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
  ipcMain.handle('proxy:rules-save', async (_e, rules: Partial<ProxyRule>[]) =>
    ensureProxy().ruleSet.replaceAll(rules ?? []),
  )
  ipcMain.handle('proxy:rules-upsert', async (_e, rule: Partial<ProxyRule>) =>
    ensureProxy().ruleSet.upsert(rule),
  )
  ipcMain.handle('proxy:rules-remove', async (_e, id: string) =>
    ensureProxy().ruleSet.remove(String(id)),
  )
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
    try {
      await session.defaultSession.setProxy({ mode: 'direct' })
    } catch {
      /* ignore */
    }
    pushState()
    return lastSystemProxy
  })

  ipcMain.handle('proxy:system-restore', async () => {
    lastSystemProxy = await systemProxy().restore()
    try {
      await session.defaultSession.setProxy({ mode: 'system' })
    } catch {
      /* ignore */
    }
    pushState()
    return lastSystemProxy
  })

  /* ---- 导出会话 ---- */
  ipcMain.handle('proxy:export-sessions', async (_e, format: 'json' | 'har' = 'json') => {
    const sessions = proxy?.listSessions() ?? []
    const filePath = await askSavePath({
      title: '导出抓包会话',
      defaultPath: join(
        app.getPath('downloads'),
        `devtoolbox-traffic.${format === 'har' ? 'har' : 'json'}`,
      ),
      filters: [
        {
          name: format === 'har' ? 'HAR' : 'JSON',
          extensions: [format === 'har' ? 'har' : 'json'],
        },
      ],
    })
    if (!filePath) return { ok: false, canceled: true, path: '', count: 0 }
    try {
      const payload =
        format === 'har'
          ? toHar(sessions)
          : JSON.stringify(
              { exportedAt: new Date().toISOString(), count: sessions.length, sessions },
              null,
              2,
            )
      fs.writeFileSync(filePath, payload)
      return { ok: true, path: filePath, count: sessions.length }
    } catch (err) {
      return { ok: false, path: '', count: 0, error: (err as Error).message }
    }
  })
}

function toHar(sessions: ProxySession[]): string {
  const entries = sessions.map((s) => {
    const reqBody = s.reqBodyBase64 ? Buffer.from(s.reqBodyBase64, 'base64') : Buffer.alloc(0)
    const resBody = s.resBodyBase64 ? Buffer.from(s.resBodyBase64, 'base64') : Buffer.alloc(0)
    const mime = (list: [string, string][]): string =>
      list.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
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
        postData: reqBody.length
          ? { mimeType: mime(s.reqHeaders), text: reqBody.toString('utf8') }
          : undefined,
      },
      response: {
        status: s.status ?? 0,
        statusText: s.statusText,
        httpVersion: 'HTTP/1.1',
        headers: s.resHeaders.map(([name, value]) => ({ name, value })),
        cookies: [],
        content: {
          size: s.resBodyBytes,
          mimeType: mime(s.resHeaders),
          text: resBody.toString('utf8'),
        },
        redirectURL: s.resHeaders.find(([k]) => k.toLowerCase() === 'location')?.[1] ?? '',
        headersSize: -1,
        bodySize: resBody.length,
      },
      cache: {},
      timings: { send: 0, wait: s.durationMs, receive: 0 },
    }
  })
  return JSON.stringify(
    {
      log: {
        version: '1.2',
        creator: { name: 'DevOps Toolbox', version: app.getVersion() },
        entries,
      },
    },
    null,
    2,
  )
}

/** app ready 时调用：启动代理实例并同步一次系统代理与 CA 状态，便于界面显示真实情况 */
export function startProxyServices(): void {
  proxy = ensureProxy()
  systemProxy()
    .getState()
    .then((s) => {
      lastSystemProxy = s
      pushState()
    })
    .catch(() => {})
  ensureProxy()
    .authority.init()
    .then(() => pushState())
    .catch((err) => {
      lastProxyError = `根证书初始化失败：${(err as Error).message}`
      pushState()
    })
}

let cleanupDone = false

/** will-quit 时调用：还原系统代理、关闭代理端口，避免把用户网络留在代理状态 */
export function cleanupProxyBeforeQuit(event: Electron.Event): void {
  if (cleanupDone) return
  const manager = systemProxy()
  const needRestore = manager.isManaging || (proxy?.isRunning ?? false)
  if (!needRestore) return
  event.preventDefault()
  cleanupDone = true

  void (async () => {
    try {
      await proxy?.stop()
    } catch {
      /* ignore */
    }

    if (manager.isManaging) {
      // macOS 还原同样需要管理员授权，会在退出前弹一次密码框 —— 先问清楚再弹
      const answer = await dialog
        .showMessageBox({
          type: 'warning',
          buttons: ['还原并退出', '仍然退出'],
          defaultId: 0,
          cancelId: 1,
          title: '系统代理尚未还原',
          message: '退出前需要把系统代理还原回原设置',
          detail:
            process.platform === 'darwin'
              ? '接下来会弹出系统管理员授权框（仅一次）。若选择「仍然退出」，系统和浏览器的流量会继续指向已关闭的抓包端口，可下次启动本工具后在「流量分析」里点「取消系统代理」清理。'
              : '若选择「仍然退出」，系统和浏览器的流量会继续指向已关闭的抓包端口，可下次启动本工具后清理。',
        })
        .catch(() => ({ response: 1 }))

      if (answer.response === 0) {
        try {
          const state = await manager.restore()
          lastSystemProxy = state
        } catch {
          /* 还原失败也要让用户退出，快照保留供下次清理 */
        }
      }
    }

    try {
      await session.defaultSession.setProxy({ mode: 'system' })
    } catch {
      /* ignore */
    }
    setTimeout(() => app.quit(), 120)
  })()
}
