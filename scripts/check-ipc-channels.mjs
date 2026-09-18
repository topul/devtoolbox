/**
 * IPC 通道契约自检。
 *
 * 为什么需要它：`ipcRenderer.invoke('foo:bar')` 和 `ipcMain.handle('foo:bar')` 之间
 * 唯一的联系是一个**字符串**。写错一个字母，typecheck 不会报，build 不会报，
 * 只有在用户点那个功能的瞬间才炸成「No handler registered for 'foo:bar'」。
 *
 * 所以这里把两侧的通道名抓出来对齐：
 *   - preload 调用的通道，主进程必须注册（否则失败）
 *   - preload 监听的通道，主进程必须发过（否则失败）
 *   - 主进程注册了但没人调用（只提醒，可能是预留）
 *
 * 运行：npm run smoke:ipc
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const PRELOAD = path.join(ROOT, 'electron', 'preload', 'index.ts')
const MAIN_DIR = path.join(ROOT, 'electron', 'main')

let failures = 0
const notes = []
const fail = (m) => { failures++; console.error(`  ✗ ${m}`) }

/** 递归收集主进程下所有 .ts（含子目录），preload 只解析自身 */
function walk(dir) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}

const collect = (re, text) => [...text.matchAll(re)].map((m) => m[1])

const preloadSrc = fs.readFileSync(PRELOAD, 'utf8')
const mainSrc = walk(MAIN_DIR).map((f) => fs.readFileSync(f, 'utf8')).join('\n')

// --- preload 侧：调用了哪些、监听了哪些 ---
const invoked = new Set(collect(/ipcRenderer\.(?:invoke|send|sendSync)\(\s*'([^']+)'/g, preloadSrc))
const listened = new Set(collect(/ipcRenderer\.on\(\s*'([^']+)'/g, preloadSrc))

// --- 主进程侧：注册了哪些、发出了哪些 ---
const handled = new Set(collect(/ipcMain\.handle\(\s*'([^']+)'/g, mainSrc))
const onChannel = new Set(collect(/ipcMain\.on\(\s*'([^']+)'/g, mainSrc))
const emitted = new Set(collect(/\.send\(\s*'([^']+)'/g, mainSrc))

/* ---------- preload 调用的必须在主进程注册 ---------- */
for (const ch of invoked) {
  if (!handled.has(ch) && !onChannel.has(ch)) {
    fail(`preload 调用了 '${ch}'，但主进程没有 ipcMain.handle/on 注册它`)
  }
}

/* ---------- preload 监听的必须有人发 ---------- */
for (const ch of listened) {
  if (!emitted.has(ch)) {
    fail(`preload 监听了 '${ch}'，但主进程从不 send 这个通道（事件永远收不到）`)
  }
}

/* ---------- 反向：注册了却没人调用（提醒，不算失败） ---------- */
for (const ch of handled) {
  if (!invoked.has(ch)) notes.push(`主进程注册了 '${ch}'，但 preload 没有调用`)
}

/* ---------- 反向：主进程发的事件没人监听（真问题） ---------- */
for (const ch of emitted) {
  if (!listened.has(ch)) {
    fail(`主进程向 '${ch}' 发事件，但 preload 没有监听（渲染层收不到）`)
  }
}

console.log(`\nIPC 通道：preload 调用 ${invoked.size} 个 / 监听 ${listened.size} 个；主进程注册 ${handled.size + onChannel.size} 个 / 发出 ${emitted.size} 个`)
for (const n of notes) console.log(`  · ${n}`)

if (failures) {
  console.error(`\n${failures} 项不一致`)
  process.exit(1)
}
console.log('\n✔ IPC 通道两侧一致')
