/**
 * 预加载桥接可用性校验（真机 Electron 渲染进程）
 *
 * 背景：preload 一旦加载失败，渲染进程里 `window.electronAPI` 会是 undefined，
 * 而 typecheck / build / SSR 冒烟都不会报错——只有需要主进程能力的工具会表现为「功能不可用」。
 * 所以这里起一个真实的 BrowserWindow（与 App 相同的 webPreferences），
 * 抓 preload-error / console 错误，并直接询问渲染进程 window.electronAPI 的真实形态。
 *
 *   node_modules/.bin/electron scripts/check-preload.mjs
 *   DTB_NO_SANDBOX=1 ...   # 受限环境（CI 容器 / 受限 shell）下需要关掉 Chromium 沙箱才能起窗口
 *   DTB_SANDBOX=0 ...      # 对照实验：sandbox:false
 */
import { app, BrowserWindow } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const preloadPath = join(root, 'out/preload/index.cjs')
const rendererHtml = join(root, 'out/renderer/index.html')
const sandbox = process.env.DTB_SANDBOX !== '0'

if (process.env.DTB_NO_SANDBOX) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.disableHardwareAcceleration()
}

const logs = []

async function main() {
  if (!existsSync(preloadPath)) {
    console.error(`preload 产物不存在：${preloadPath}\n请先执行 npm run build（sandbox 下 preload 必须是 CJS，见 electron.vite.config.ts）`)
    app.exit(2)
    return
  }
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { preload: preloadPath, sandbox, contextIsolation: true, nodeIntegration: false },
  })

  win.webContents.on('console-message', (event) => {
    logs.push(`[console:${event.level}] ${event.message} (${event.sourceId ?? ''}:${event.lineNumber ?? ''})`)
  })
  win.webContents.on('preload-error', (_event, path, error) => {
    logs.push(`[preload-error] ${path}\n  ${error?.stack ?? error}`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    logs.push(`[render-process-gone] ${JSON.stringify(details)}`)
  })

  await win.loadFile(rendererHtml)

  const probe = await win.webContents.executeJavaScript(`JSON.stringify({
    electronAPI: typeof window.electronAPI,
    keys: window.electronAPI ? Object.keys(window.electronAPI).sort() : [],
    getVersion: typeof (window.electronAPI && window.electronAPI.getVersion),
    httpSend: typeof (window.electronAPI && window.electronAPI.http && window.electronAPI.http.send),
    proxyStart: typeof (window.electronAPI && window.electronAPI.proxy && window.electronAPI.proxy.start),
  })`)

  console.log(`electron: ${process.versions.electron} · sandbox: ${sandbox}`)
  console.log(`probe: ${probe}`)
  if (logs.length) {
    console.log('--- 渲染进程日志 ---')
    for (const line of logs) console.log(line)
  }

  const ok = JSON.parse(probe)
  const pass = ok.electronAPI === 'object' && ok.httpSend === 'function' && ok.proxyStart === 'function'
  console.log(pass ? '\nOK: 预加载桥接可用，window.electronAPI 暴露 http/proxy' : '\n失败：window.electronAPI 未正确暴露')
  app.exit(pass ? 0 : 1)
}

app.whenReady().then(main).catch((err) => {
  console.error('探针异常：', err)
  app.exit(2)
})
