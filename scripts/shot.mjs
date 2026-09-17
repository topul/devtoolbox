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
 *
 *   例：DTB_SHOT_PREP="[...document.querySelectorAll('button')].find((b)=>b.textContent==='设置').click()" \
 *       npm run shot -- "#traffic-proxy"
 *
 * 若 shell 里继承了 ELECTRON_RUN_AS_NODE=1（某些受限环境会），Electron 会退化成纯 Node，
 * 报 `does not provide an export named 'BrowserWindow'` —— 用 env -u ELECTRON_RUN_AS_NODE 去掉它。
 *
 * 体检项：main 的实际宽度与缩放系数、内容容器宽度、横向溢出像素、字号区间 —— 溢出必须是 0。
 */
import { app, BrowserWindow } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? '#http-client'

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
    return JSON.stringify({
      zoom: getComputedStyle(main).zoom,
      main: Math.round(main.getBoundingClientRect().width),
      content: view ? Math.round(view.getBoundingClientRect().width) : 0,
      hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      minFont: Math.min(...fonts),
      maxFont: Math.max(...fonts),
      nodes: document.querySelectorAll('main *').length,
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
  for (let i = 0; i < sizes.length; i++) await shoot(win, sizes[i][0], sizes[i][1], i)
  win.destroy()
  app.exit(0)
}).catch((err) => {
  console.error('截图失败：', err)
  app.exit(1)
})
