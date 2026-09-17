/**
 * 真机截图 + 布局体检（UI 改动专用）
 *
 * typecheck / SSR 冒烟 / 构建都看不出「宽屏挤在左边」「字号偏小」「横向溢出」这类问题，
 * 这个脚本用真实 Electron 打开构建产物，按多档窗口宽度截图并输出可判读的布局数字。
 *
 *   npm run build
 *   npm run shot -- "#http-client"          # 截图到 /tmp/shot-<n>-<WxH>.png
 *   DTB_NO_SANDBOX=1 npm run shot          # 受限环境（CI 容器 / 受限 shell）起窗口要加
 *   DTB_SHOT_SIZES=1600x1000,2560x1440     # 自定义窗口尺寸
 *   DTB_SHOT_PREP="<js>"                   # 截图前先执行的 JS（例如点开某个页签）
 *   DTB_SHOT_LS='{"key":"1"}'              # 预置 localStorage（设好后自动 reload 再截）
 *   DTB_SHOT_USERDATA=/tmp/xxx             # 覆盖隔离 profile 目录
 *
 *   例：DTB_SHOT_PREP="[...document.querySelectorAll('button')].find((b)=>b.textContent==='设置').click()" \
 *       npm run shot -- "#traffic-proxy"
 *   例：DTB_SHOT_LS='{"devtoolbox-sidebar-collapsed":"1"}' npm run shot   # 截收起态
 *
 * 若 shell 里继承了 ELECTRON_RUN_AS_NODE=1（某些受限环境会），Electron 会退化成纯 Node，
 * 报 `does not provide an export named 'BrowserWindow'` —— 用 env -u ELECTRON_RUN_AS_NODE 去掉它。
 *
 * 隔离：默认使用临时 profile（`<tmp>/devtoolbox-shot-profile`），不会改动真实应用的
 * localStorage / 主题 / 缩放，截图也因此在默认档位上可复现；退出时删除该目录。
 *
 * 体检项：main 的实际宽度与缩放系数、内容容器宽度、横向溢出像素、字号区间、侧栏宽度与
 * 底栏被裁切的元素数 —— 溢出与裁切都必须是 0。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import fs from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? '#http-client'

/** 隔离 profile：截图不该污染（也不该被污染）真实应用的 UI 状态 */
const shotProfile = process.env.DTB_SHOT_USERDATA ?? join(tmpdir(), 'devtoolbox-shot-profile')
fs.rmSync(shotProfile, { recursive: true, force: true })
app.setPath('userData', shotProfile)

/**
 * 最小 IPC 桩：渲染层启动就会问版本号 / 主题 / 抓包状态，本体没有这些 handler，
 * 不打桩会刷一堆 `No handler registered` 噪声（会掩盖真正的报错），版本号也会回落成硬编码值。
 */
ipcMain.handle('app:get-version', () => JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).version)
ipcMain.handle('theme:get', () => 'dark')
ipcMain.handle('theme:set', () => 'dark')
ipcMain.handle('updater:check', () => undefined)
ipcMain.handle('proxy:state', () => ({
  running: false,
  port: 8899,
  mitm: true,
  sessionCount: 0,
  caReady: false,
  caInfo: null,
  systemProxy: { enabled: false, server: '', supported: true, managed: false, detail: '' },
}))

const lsSeed = process.env.DTB_SHOT_LS ? JSON.parse(process.env.DTB_SHOT_LS) : null

if (process.env.DTB_NO_SANDBOX) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.disableHardwareAcceleration()
}

const sizes = (process.env.DTB_SHOT_SIZES ?? '1440x900,1920x1100,2560x1440')
  .split(',')
  .map((s) => s.split('x').map(Number))
  .filter(([w, h]) => w > 0 && h > 0)

async function report(win) {
  return JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const main = document.querySelector('main')
    const view = [...main.children].find((el) => getComputedStyle(el).display !== 'none')
    const fonts = [...main.querySelectorAll('span, div, button, td, th')]
      .map((el) => parseFloat(getComputedStyle(el).fontSize))
      .filter((n) => n > 0)
    const aside = document.querySelector('aside')
    const rail = document.querySelector('[data-sb-rail]')
    const foot = document.querySelector('[data-sb-foot]')
    const visible = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0
    // 底栏里被裁切的元素（scrollWidth 超出 clientWidth 即文字挤掉/截断）
    const clipped = foot && visible(foot)
      ? [...foot.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 1).length
      : -1
    return JSON.stringify({
      zoom: getComputedStyle(main).zoom,
      main: Math.round(main.getBoundingClientRect().width),
      content: view ? Math.round(view.getBoundingClientRect().width) : 0,
      hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      minFont: Math.min(...fonts),
      maxFont: Math.max(...fonts),
      nodes: document.querySelectorAll('main *').length,
      sidebar: visible(rail) ? Math.round(rail.getBoundingClientRect().width) : Math.round(aside.getBoundingClientRect().width),
      sidebarMode: visible(rail) ? 'rail' : 'expanded',
      footH: foot && visible(foot) ? Math.round(foot.getBoundingClientRect().height) : 0,
      footClipped: clipped,
    })
  })()`))
}

async function shoot(win, width, height, index) {
  win.setSize(width, height)
  await win.webContents.executeJavaScript("location.hash = ''")
  await new Promise((r) => setTimeout(r, 250))
  await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(target)}`)
  await new Promise((r) => setTimeout(r, 400))
  if (process.env.DTB_SHOT_PREP) {
    await win.webContents.executeJavaScript(process.env.DTB_SHOT_PREP).catch((err) => console.log(`   prep 失败：${err.message}`))
  }
  await new Promise((r) => setTimeout(r, 1100))

  const info = await report(win)
  const img = await win.webContents.capturePage()
  const buf = img.toPNG()
  const out = `/tmp/shot-${index}-${width}x${height}.png`
  fs.writeFileSync(out, buf)
  const size = img.getSize()
  console.log(`${width}x${height} → ${out} (${size.width}x${size.height}, ${(buf.length / 1024).toFixed(0)}KB)`)
  console.log(`   体检 zoom=${info.zoom} main=${info.main} 内容容器=${info.content} 横向溢出=${info.hOverflow}px 字号=${info.minFont}~${info.maxFont}px DOM=${info.nodes}`)
  console.log(`   侧栏 ${info.sidebarMode} 宽=${info.sidebar}px 底栏高=${info.footH}px 底栏被裁切元素=${info.footClipped}`)
}

app.whenReady().then(async () => {
  if (!fs.existsSync(join(root, 'out/renderer/index.html'))) {
    console.error('缺少构建产物，请先 npm run build')
    app.exit(2)
    return
  }
  console.log(`目标 ${target}（窗口 ${sizes.map(([w, h]) => `${w}x${h}`).join(' / ')}）`)
  const win = new BrowserWindow({
    width: sizes[0][0],
    height: sizes[0][1],
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(root, 'out/preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.log(`   [renderer error] ${event.message}`)
  })
  await win.loadFile(join(root, 'out/renderer/index.html'))
  await new Promise((r) => setTimeout(r, 800))

  // 预置 localStorage：写入后 reload，让组件的 useState 初始化读到新值
  if (lsSeed) {
    const sets = Object.entries(lsSeed)
      .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(String(v))})`)
      .join(';')
    await win.webContents.executeJavaScript(`(() => { ${sets} })()`)
    const loaded = new Promise((r) => win.webContents.once('did-finish-load', r))
    win.webContents.reload()
    await loaded
    await new Promise((r) => setTimeout(r, 600))
  }

  for (let i = 0; i < sizes.length; i++) await shoot(win, sizes[i][0], sizes[i][1], i)
  win.destroy()
  fs.rmSync(shotProfile, { recursive: true, force: true })
  app.exit(0)
}).catch((err) => {
  console.error('截图失败：', err)
  fs.rmSync(shotProfile, { recursive: true, force: true })
  app.exit(1)
})
