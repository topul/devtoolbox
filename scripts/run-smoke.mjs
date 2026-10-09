#!/usr/bin/env node
/**
 * 统一 smoke runner：把 package.json 里 30+ 条长得一样的
 * 「esbuild 打包到 node_modules/.cache → node 运行」命令收进一个文件。
 *
 * 用法：
 *   node scripts/run-smoke.mjs chat          # 跑单个（package.json 的 smoke:chat 就是它）
 *   node scripts/run-smoke.mjs chat proxy    # 跑多个
 *   node scripts/run-smoke.mjs               # 不带参数 = 按下面的默认顺序全跑
 *
 * 新增 smoke：往 scripts/ 放 smoke-<name>.ts（或 .tsx），再把名字登记进
 * SMOKES 表即可 —— 不再需要在 package.json 复制一行 esbuild 命令。
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const CACHE = path.join(ROOT, 'node_modules', '.cache')

/**
 * 登记表：名字 → { file, external }。
 * - file 省略时按 scripts/smoke-<名字>.ts(x) 推导；
 * - external：不打进 bundle 的依赖（保持与历史单行命令完全一致）；
 * - tsx 文件自动带 --loader:.tsx=tsx --jsx=automatic。
 */
const SMOKES = {
  chat: {},
  chatagent: { file: 'smoke-chatagent.ts' },
  chatstore: {},
  chattrace: { file: 'smoke-chat-trace.ts' },
  skills: { file: 'smoke-chat-skills.ts' },
  compare: { file: 'smoke-chat-compare.ts' },
  chatui: { external: ['react', 'react-dom', 'react/jsx-runtime'] },
  schema: {},
  httpcodec: {},
  httpenv: {},
  httpsnap: {},
  httpsave: {},
  sse: {},
  proxy: { external: ['node-forge'] },
  agentrules: {},
  mcpprobe: { file: 'smoke-mcp-probe.ts' },
  tracestore: { file: 'smoke-trace-store.ts' },
  mcpclient: {},
  sqlcheck: {},
  tls: { external: ['node-forge'] },
  har: {},
  graphql: {},
  regexreplace: {},
  systemproxy: { file: 'check-systemproxy.ts' },
  render: {
    external: [
      'qrcode',
      'react',
      'react-dom',
      'react/jsx-runtime',
      'cmdk',
      '@radix-ui/*',
      'react-remove-scroll',
      'aria-hidden',
    ],
  },
  ux: { external: ['qrcode', 'react', 'react-dom', 'react/jsx-runtime'] },
}

/** 不带参数时的默认顺序：按 CI 的分组来，聊天链路最先（平时手跑也最常看它） */
const DEFAULT_ORDER = [
  'chat',
  'chatagent',
  'chatstore',
  'chattrace',
  'skills',
  'compare',
  'chatui',
  'schema',
  'httpcodec',
  'httpenv',
  'httpsnap',
  'httpsave',
  'sse',
  'proxy',
  'agentrules',
  'mcpprobe',
  'tracestore',
  'mcpclient',
  'sqlcheck',
  'tls',
  'har',
  'graphql',
  'regexreplace',
  'systemproxy',
  'render',
  'ux',
]

const args = process.argv.slice(2)
const names = args.length ? args : DEFAULT_ORDER

for (const name of names) {
  if (!SMOKES[name]) {
    console.error(`未知 smoke：${name}（可用：${Object.keys(SMOKES).join(' ')}）`)
    process.exit(2)
  }
}

fs.mkdirSync(CACHE, { recursive: true })

let failed = []
for (const name of names) {
  const spec = SMOKES[name]
  let file = spec.file
  if (!file) {
    // 省略时按存在性推导：smoke-<name>.tsx 优先，其次 .ts
    const tsx = `smoke-${name}.tsx`
    file = fs.existsSync(path.join(ROOT, 'scripts', tsx)) ? tsx : `smoke-${name}.ts`
  }
  const entry = path.join(ROOT, 'scripts', file)
  const isTsx = entry.endsWith('.tsx')
  const outfile = path.join(CACHE, `smoke-${name}.mjs`)

  const t0 = Date.now()
  try {
    await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'error',
      // ESM bundle 里没有 require，而 node-forge 这类包在 Node 环境下会条件 require('crypto') ——
      // 注入 createRequire 让它继续工作（只影响 smoke 运行环境，与构建产物无关）
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      ...(isTsx ? { loader: { '.tsx': 'tsx' }, jsx: 'automatic' } : {}),
      ...(spec.external ? { external: spec.external } : {}),
    })
  } catch (e) {
    failed.push(name)
    console.error(`✗ ${name} — esbuild 失败：${e.message}`)
    continue
  }

  const run = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  if (run.status !== 0) {
    failed.push(name)
    console.error(`✗ ${name}（exit ${run.status ?? 'signal'}）`)
  } else {
    console.log(`✓ ${name} ${Date.now() - t0}ms`)
  }
}

if (failed.length) {
  console.error(`\n${failed.length} 个 smoke 失败：${failed.join(' ')}`)
  process.exit(1)
}
console.log(`\n${names.length} 个 smoke 全部通过`)
