/**
 * 插件构建收尾：把 manifest / SW / 图标拷进 dist-extension/，并打一个可上传的 zip。
 *
 * 前置：`vite build --config vite.config.extension.ts` 已产出 dist-extension/app/。
 * 图标用 sips 缩放（macOS 自带）；sips 不可用时原样复制，Chrome 会自行缩放但商店审核可能挑刺。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const ROOT = join(root, '..')
const DIST = join(ROOT, 'dist-extension')
const APP = join(DIST, 'app')

function fail(msg) {
  console.error(`build-extension: ${msg}`)
  process.exit(1)
}

if (!existsSync(join(APP, 'index.html'))) {
  fail('dist-extension/app/index.html 不存在，先跑 vite build --config vite.config.extension.ts')
}

/* ---- manifest（版本号从 package.json 注入，两处永不漂移） ---- */
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(ROOT, 'extension', 'manifest.json'), 'utf8'))
manifest.version = pkg.version
writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

/* ---- Service Worker ---- */
copyFileSync(join(ROOT, 'extension', 'sw.js'), join(DIST, 'sw.js'))

/* ---- 图标 ---- */
const ICON_SIZES = [16, 32, 48, 128]
const iconsDir = join(DIST, 'icons')
mkdirSync(iconsDir, { recursive: true })
const srcIcon = join(ROOT, 'build', 'icon.png')
if (!existsSync(srcIcon)) fail('build/icon.png 不存在')
const hasSips = (() => {
  try {
    execFileSync('sips', ['--help'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
for (const size of ICON_SIZES) {
  const dest = join(iconsDir, `icon-${size}.png`)
  if (hasSips) {
    execFileSync('sips', ['-z', String(size), String(size), srcIcon, '--out', dest], {
      stdio: 'ignore',
    })
  } else {
    copyFileSync(srcIcon, dest)
  }
}

/* ---- zip（best-effort：没有 zip 命令就只留目录） ---- */
const zipName = `devtoolbox-extension-${pkg.version}.zip`
try {
  execFileSync('zip', ['-r', '-q', join(ROOT, zipName), '.', '-x', zipName], { cwd: DIST })
  console.log(`build-extension: OK → ${zipName}`)
} catch {
  console.log('build-extension: OK（zip 不可用，产物在 dist-extension/ 目录）')
}
