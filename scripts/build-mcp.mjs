/**
 * 构建 MCP 服务端单文件产物：out/mcp/devtoolbox-mcp.cjs
 *
 * 为什么打成单文件而不是走 electron-vite：
 *   MCP 服务端是被**外部客户端**（Claude Desktop / Cursor / WorkBuddy）spawn 的独立进程，
 *   不经过 Electron 主进程，因此不能依赖 out/main 那套 externalize 后的 node_modules。
 *   把 crypto-js 之类的依赖直接内联进来，客户端拿到的就是一个能独立跑的文件。
 *
 * 产物必须是 CJS：spawn 时用 Electron 的 ELECTRON_RUN_AS_NODE 模式运行，
 * 经典脚本加载最稳，也避开「ESM 里具名导入 CJS 包」那类只在运行时才炸的坑。
 */
import { build } from 'esbuild'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const outfile = path.join(root, 'out', 'mcp', 'devtoolbox-mcp.cjs')

await build({
  entryPoints: [path.join(root, 'electron', 'mcp', 'cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // 只压空白与语法，保留标识符 —— 出问题时堆栈还能看得懂
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'none',
  logLevel: 'warning',
  define: {
    'process.env.DTB_VERSION': JSON.stringify(pkg.version),
  },
  banner: {
    js: `/* DevOps Toolbox MCP server v${pkg.version} — 自动生成，请勿直接编辑；改 electron/mcp/ 后重新构建 */`,
  },
})

const size = statSync(outfile).size
console.log(`[build:mcp] ${path.relative(root, outfile)}  ${(size / 1024).toFixed(1)} KB`)
