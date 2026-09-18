/**
 * 构建产物自检：渲染层不能依赖任何外部资源。
 *
 * 为什么需要它：生产构建注入了严格的 CSP（`script-src 'self'` 等），
 * 一旦哪天有人往 `index.html` 或 CSS 里加了外链（字体、CDN、图标、统计脚本），
 * **页面不会直接报错，而是那个资源被静默挡掉** —— 表现成「字体变了」「图标没了」，
 * 很难联想到 CSP。这个脚本把它变成构建期的一行红字。
 *
 * 只扫 HTML 与 CSS：JS 里出现 http 字符串是正常的（预设接口地址、错误信息、文档链接），
 * 那些不是资源加载。
 *
 * 运行：npm run smoke:assets（需先 npm run build）
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const RENDERER = path.join(ROOT, 'out', 'renderer')

let failures = 0
function fail(msg) {
  failures++
  console.error(`  ✗ ${msg}`)
}

if (!fs.existsSync(RENDERER)) {
  console.error(`✗ 找不到构建产物目录 ${RENDERER}，请先跑 npm run build`)
  process.exit(1)
}

/* ---------- 1. index.html 必须带 CSP ---------- */
const indexPath = path.join(RENDERER, 'index.html')
if (!fs.existsSync(indexPath)) {
  fail('缺少 out/renderer/index.html')
} else {
  const html = fs.readFileSync(indexPath, 'utf8')
  if (!html.includes('Content-Security-Policy')) fail('index.html 缺少 Content-Security-Policy（生产构建应当注入）')
  if (/frame-ancestors/i.test(html)) {
    // 该指令只能通过 HTTP 头传递；写进 meta 会被忽略并产生控制台告警
    fail('CSP 里含 frame-ancestors —— 它只能走 HTTP 头，写在 meta 里会被忽略并告警')
  }
}

/* ---------- 2. HTML / CSS 里不能有外链资源 ---------- */
const EXTERNAL = [
  [/<script[^>]+src=["']https?:/i, 'HTML 里有外部 script'],
  [/<link[^>]+href=["']https?:/i, "HTML 里有外部 link（样式/字体/图标）"],
  [/<img[^>]+src=["']https?:/i, 'HTML 里有外部 img'],
  [/@import\s+(?:url\()?["']?https?:/i, 'CSS 里有外部 @import'],
  [/url\(\s*["']?https?:/i, 'CSS 里有外部 url()'],
]

const targets = []
if (fs.existsSync(indexPath)) targets.push(indexPath)
const assetsDir = path.join(RENDERER, 'assets')
if (fs.existsSync(assetsDir)) {
  for (const name of fs.readdirSync(assetsDir)) {
    if (name.endsWith('.css') || name.endsWith('.html')) targets.push(path.join(assetsDir, name))
  }
}

for (const file of targets) {
  const body = fs.readFileSync(file, 'utf8')
  for (const [re, label] of EXTERNAL) {
    const m = body.match(re)
    if (m) fail(`${label}：${path.relative(ROOT, file)} → ${m[0].slice(0, 100)}`)
  }
}

/* ---------- 3. 字体必须来自本地产物 ---------- */
const cssFiles = targets.filter((f) => f.endsWith('.css'))
const cssAll = cssFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
const hasFontFace = /@font-face/.test(cssAll)
if (hasFontFace) {
  const localFont = /url\([^)]*\.woff2?/.test(cssAll)
  if (!localFont) fail('声明了 @font-face，但没有指向本地 woff/woff2 文件')
}

const fontCount = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((n) => /\.woff2?$/.test(n)).length
  : 0

if (failures === 0) {
  console.log(`✔ 产物自检通过（${targets.length} 个文件，无外链资源；字体文件 ${fontCount} 个，CSP 已注入）`)
} else {
  console.error(`\n${failures} 项问题`)
  process.exit(1)
}
