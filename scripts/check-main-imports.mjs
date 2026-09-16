#!/usr/bin/env node
/**
 * 主进程/预加载产物「具名导入可解析性」校验（发版前置）
 *
 * 背景：本项目 package.json 是 `type: module`，electron-vite 把 main/preload 编译成 ESM；
 * 而被 externalizeDepsPlugin 外置（不打包）的依赖依旧是 CJS。Node 用 cjs-module-lexer
 * 静态探测 CJS 的具名导出，只能识别 `exports.foo = ...` 这类写法；若依赖用
 * `Object.defineProperty(exports, 'foo', { get() {...} })`（tsc 编译 ES 模块的产物就是
 * 这样，electron-updater 即如此），探测不到 → 应用启动直接
 * `SyntaxError: Named export 'foo' not found`，打包体完全无法启动。
 *
 * 这个脚本在构建后扫描产物里的 `import { X } from "pkg"`，逐个用真实 Node ESM 加载
 * 对应包，确认 X 确实存在于命名空间上。跑在发版前置，能在打 tag 之前拦住这类崩溃。
 *
 * 用法：node scripts/check-main-imports.mjs out/main/index.js out/preload/index.mjs
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { builtinModules } from 'node:module'

const SKIP = new Set([
  'electron', // Electron 运行时内置模块，普通 Node 下解析成字符串路径，无法在这里校验
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`)
])

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('用法: node scripts/check-main-imports.mjs <built-file> [...more]')
  process.exit(2)
}

const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g

const problems = []
let checked = 0

for (const file of files) {
  if (!existsSync(file)) {
    problems.push(`${file}: 产物不存在，请先执行 npm run build`)
    continue
  }
  const code = await readFile(file, 'utf8')

  for (const match of code.matchAll(NAMED_IMPORT)) {
    const specifiers = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim()) // `autoUpdater as t` → autoUpdater
    const pkg = match[2]

    if (SKIP.has(pkg)) continue

    checked += specifiers.length
    let ns
    try {
      ns = await import(pkg)
    } catch (err) {
      console.warn(`⚠️  ${file}: 无法加载 ${pkg} 进行校验（${err.message}），跳过`)
      continue
    }

    const missing = specifiers.filter((name) => ns[name] === undefined)
    if (missing.length > 0) {
      problems.push(
        `${file}: \`import { ${missing.join(', ')} } from '${pkg}'\` —— Node ESM 探测不到这些具名导出\n` +
          `    该包是 CJS，请改成默认导入再解构：\n` +
          `      import ${pkg.replace(/[^a-zA-Z0-9]/g, '')} from '${pkg}'\n` +
          `      const { ${missing.join(', ')} } = ${pkg.replace(/[^a-zA-Z0-9]/g, '')}`
      )
    }
  }
}

if (problems.length > 0) {
  console.error(`\n✖ 主进程具名导入校验失败（${problems.length} 处）：\n`)
  for (const p of problems) console.error(`  - ${p}\n`)
  console.error('这类问题只在运行时暴露，打包产物会直接启动崩溃。务必先修再发版。\n')
  process.exit(1)
}

console.log(`✔ 主进程具名导入校验通过（${files.length} 个产物，${checked} 个具名导入）`)
