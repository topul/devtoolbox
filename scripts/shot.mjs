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
 *   DTB_SHOT_LS='{"key":"1"}'              # 预置 localStorage（设好后自动 reload 再截；同名键覆盖默认值）
 *
 * 默认会预置一份「演示模型」档案（对话是默认视图，不预置就只能截到配置引导卡），
 * 并通过 chatstore 桩喂入两类历史会话：新格式（parts，含思考与工具调用）与旧格式（blocks）。
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
import { homedir, tmpdir } from 'node:os'
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
// 对话工具：桩里放一段确定性的合成流，用来体检「流式渲染 + 指标 + 费用」这整块界面的布局。
// 主进程↔上游的真实链路由 npm run smoke:chat 断言，这里只负责把渲染层喂饱。
let chatTimer = null
ipcMain.handle('chat:send', (_e, spec) => {
  if (chatTimer) clearInterval(chatTimer)
  const requestId = spec?.requestId || 'shot-chat'
  const win = BrowserWindow.getAllWindows()[0]
  const push = (evt) => win?.webContents.send('chat:event', evt)
  const reasoning = '先想清楚要不要调用工具：这次只是布局体检，直接给一段带 Markdown 的回复即可。'
  const reply = '这是用于布局体检的桩数据，重点是让**各种部件**都出现一次：\n\n- 思考块（流式时展开，结束后自动收起）\n- Markdown 正文：列表、`行内代码`、[链接](https://example.com)\n\n```ts\nconst ok = true\n```\n\n| 列 | 值 |\n| --- | --- |\n| token | 148 |'
  const chars = [...reply]
  const rChars = [...reasoning]
  const started = Date.now()
  let i = 0
  let ri = 0
  push({ type: 'start', requestId })

  // 开了工具调用就顺带走一遍工具事件，否则工具块那块的布局体检不到
  const withTools = !!spec?.tools
  if (withTools) {
    push({ type: 'toolsReady', requestId, tools: SHOT_MCP_TOOLS.map(([name, description]) => ({ name, description })) })
    push({ type: 'round', requestId, round: 1, maxRounds: 8 })
    push({ type: 'toolCall', requestId, round: 1, call: { id: 'call_cidr', name: 'cidr_info', args: '{"cidr":"10.0.0.1/22"}' } })
    push({
      type: 'toolResult',
      requestId,
      round: 1,
      result: {
        id: 'call_cidr',
        name: 'cidr_info',
        ok: true,
        isError: false,
        text: 'IP: 10.0.0.1\n网络地址: 10.0.0.0/22\n广播地址: 10.0.3.255\n子网掩码: 255.255.252.0\n可用主机数: 1022',
        durationMs: 3,
      },
    })
    push({ type: 'round', requestId, round: 2, maxRounds: 8 })
  }

  chatTimer = setInterval(() => {
    // 先流思考，再流正文：正好走一遍「思考块自动展开 → 切正文 → 结束后自动折叠」
    if (ri < rChars.length) {
      push({ type: 'delta', requestId, text: rChars[ri], kind: 'reasoning', atMs: Date.now() })
      ri++
      return
    }
    if (i < chars.length) {
      push({ type: 'delta', requestId, text: chars[i], kind: 'content', atMs: Date.now() })
      i++
      return
    }
    clearInterval(chatTimer)
    chatTimer = null
    push({
      type: 'done',
      requestId,
      rounds: withTools ? 2 : 1,
      meta: {
        ttfbMs: 18,
        firstTokenMs: 42,
        totalMs: Date.now() - started,
        chunks: chars.length,
        chars: reply.length,
        reasoningChars: reasoning.length,
        usage: { promptTokens: 96, completionTokens: 52, totalTokens: 148 },
        finishReason: 'stop',
        model: 'deepseek-chat',
        toolCalls: [],
      },
    })
  }, 20)
  return { ok: true, requestId }
})
ipcMain.handle('chat:abort', () => {
  if (chatTimer) {
    clearInterval(chatTimer)
    chatTimer = null
  }
  return true
})
// MCP Inspector：桩里给一份确定性的服务端信息与能力清单，用来体检「表单 + 清单 + 调用结果 + 帧日志」的布局。
// 真实协议行为由 npm run smoke:mcpclient 覆盖（73 条断言，被测目标就是本仓库自己的 MCP 服务端）。
const SHOT_MCP_TOOLS = [
  ['base64_encode', 'UTF-8 文本 → Base64。urlSafe=true 时用 -_ 替代 +/ 并去掉补位 =，适合放进 URL 或 JWT。', { text: 'string', urlSafe: 'boolean' }],
  ['hash', '文本摘要，支持 MD5 / SHA1 / SHA256 / SHA512 / SHA3 / RIPEMD160。', { text: 'string', algorithm: 'string' }],
  ['timestamp_convert', '时间戳与日期互转，同时给出本地时间、UTC、ISO 与秒/毫秒双表示。', { timestamp: 'string' }],
  ['cidr_info', '算出网络地址、广播地址、掩码、可用主机范围与主机数。', { cidr: 'string' }],
  ['json_query', '按 JSONPath 取值，支持递归下降。', { json: 'string', path: 'string' }],
  ['http_request', '发任意 HTTP 请求，支持上游代理、关闭 TLS 校验、自动解压。', { url: 'string', method: 'string' }],
  ['regex_test', '在文本上跑正则，返回位置、内容与捕获组。', { pattern: 'string', text: 'string' }],
  ['uuid_generate', '生成真随机的 UUID v4。', { count: 'number' }],
]
ipcMain.handle('mcpclient:connect', (_e, spec) => {
  const win = BrowserWindow.getAllWindows()[0]
  // 必须回显调用方的 id：渲染层按 id 过滤事件，桩里写死 id 会导致事件全被丢掉
  const id = spec?.id ?? 'shot-mcp'
  const push = (evt) => win?.webContents.send('mcpclient:event', evt)
  push({ type: 'status', id, status: 'connecting' })
  const frames = [
    { dir: 'send', payload: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"devtoolbox-inspector"}}}' },
    { dir: 'recv', payload: '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"devtoolbox","version":"1.2.2"}}}' },
    { dir: 'send', payload: '{"jsonrpc":"2.0","method":"notifications/initialized"}' },
    { dir: 'send', payload: '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' },
    { dir: 'recv', payload: `{"jsonrpc":"2.0","id":2,"result":{"tools":[${SHOT_MCP_TOOLS.length} 项]}}` },
    { dir: 'send', payload: '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"base64_encode","arguments":{"text":"你好"}}}' },
    { dir: 'recv', payload: '{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"5L2g5aW9"}]}}' },
  ]
  for (const f of frames) push({ type: 'frame', id, dir: f.dir, payload: f.payload, ok: true })
  push({ type: 'log', id, source: 'stderr', text: 'devtoolbox-mcp 1.2.2 已就绪，工具 34 个，协议 2025-06-18\n' })
  const info = { name: 'devtoolbox', version: '1.2.2', protocolVersion: '2025-06-18', capabilities: { tools: {} } }
  push({ type: 'serverInfo', id, info })
  push({ type: 'status', id, status: 'connected' })
  return {
    ok: true,
    info,
    catalog: {
      tools: SHOT_MCP_TOOLS.map(([name, description, props]) => ({
        name,
        description,
        inputSchema: { type: 'object', properties: props, required: [Object.keys(props)[0]] },
      })),
      resources: [],
      prompts: [],
      declared: { tools: true, resources: false, prompts: false },
    },
  }
})
ipcMain.handle('mcpclient:call', (_e, arg) => ({
  ok: true,
  isError: false,
  text: arg?.name === 'cidr_info'
    ? 'IP: 10.0.0.1\n网络地址: 10.0.0.0/22\n广播地址: 10.0.3.255\n子网掩码: 255.255.252.0\n可用主机范围: 10.0.0.1 - 10.0.3.254\n可用主机数: 1022\n私有地址: 是'
    : '5L2g5aW9',
  raw: { content: [{ type: 'text', text: '5L2g5aW9' }] },
  durationMs: 3,
}))
ipcMain.handle('mcpclient:read-resource', () => ({ ok: false, isError: false, text: '', raw: null, durationMs: 0, error: 'mock' }))
ipcMain.handle('mcpclient:get-prompt', () => ({ ok: false, isError: false, text: '', raw: null, durationMs: 0, error: 'mock' }))
ipcMain.handle('mcpclient:ping', () => ({ ok: true, ms: 1 }))
ipcMain.handle('mcpclient:disconnect', () => true)

// 会话存储：桩里给两条历史会话，截图才能看到「重启后还在」的效果
const SHOT_SESSIONS = [
  { id: 'sA1b2c3d4e5f67890', title: '10.0.0.0/22 的可用主机范围', createdAt: 1758000000000, updatedAt: 1758170000000, turnCount: 4 },
  { id: 'sB2c3d4e5f6789012', title: 'MCP 工具调用排查', createdAt: 1757900000000, updatedAt: 1758080000000, turnCount: 6 },
  { id: 'sC3d4e5f678901234', title: '写一个匹配日志行的正则', createdAt: 1757800000000, updatedAt: 1757990000000, turnCount: 2 },
]
/**
 * 历史会话两种形态都要能截到：
 *   - 新格式（parts）：现在写盘的样子，含思考块与工具调用；
 *   - 旧格式（blocks）：老版本留下的会话文件，靠 chat-ui 的迁移把它读出来。
 * 只要有一边渲染不出来，截图里立刻能看出来。
 */
const SHOT_TURNS_PARTS = [
  {
    id: 'u-shot-1',
    role: 'user',
    parts: [{ type: 'text', text: '帮我看看 10.0.0.0/22 的可用主机范围，顺便给个能直接粘贴的检查命令' }],
  },
  {
    id: 'a-shot-1',
    role: 'assistant',
    metadata: {
      rounds: 2,
      meta: {
        ttfbMs: 24, firstTokenMs: 61, totalMs: 1840, chunks: 44, chars: 138, reasoningChars: 96,
        usage: { promptTokens: 412, completionTokens: 76, totalTokens: 488 },
        finishReason: 'stop', model: 'deepseek-chat', toolCalls: [],
      },
    },
    parts: [
      { type: 'reasoning', id: 'r-shot-1', text: '先确认掩码：/22 是 255.255.252.0，每个子网 1024 个地址。可用主机要减掉网络地址与广播地址，边界要写清楚，别让用户自己再算一遍。', state: 'done' },
      { type: 'text', text: '我调用一下本机的 CIDR 工具，别自己算：' },
      {
        type: 'dynamic-tool',
        toolCallId: 'call_cidr',
        toolName: 'cidr_info',
        state: 'output-available',
        input: { cidr: '10.0.0.0/22' },
        output: 'IP: 10.0.0.1\n网络地址: 10.0.0.0/22\n广播地址: 10.0.3.255\n子网掩码: 255.255.252.0\n可用主机范围: 10.0.0.1 - 10.0.3.254\n可用主机数: 1022\n私有地址: 是',
      },
      { type: 'text', text: '## 结论\n\n| 项 | 值 |\n| --- | --- |\n| 网络地址 | `10.0.0.0/22` |\n| 广播地址 | `10.0.3.255` |\n| 可用主机数 | **1022** |\n\n可用范围是 10.0.0.1 – 10.0.3.254。要快速确认可以用：\n\n```bash\nnmap -sn 10.0.0.0/22 | head\n```\n\n注意 `/22` 这类**跨网段**写法在有些网关里会被拒绝。' },
    ],
  },
]

/** 旧格式（blocks）—— 老版本会话文件的样子，用来验证迁移路径的渲染 */
const SHOT_TURNS_LEGACY = [
  { id: 'u-legacy-1', role: 'user', blocks: [{ kind: 'text', text: '这条会话是老版本留下的' }], status: 'done' },
  {
    id: 'a-legacy-1',
    role: 'assistant',
    status: 'stopped',
    blocks: [
      { kind: 'reasoning', text: '历史会话里的思考内容。' },
      { kind: 'text', text: '旧格式的正文照样要能渲染出来。' },
    ],
  },
]

ipcMain.handle('chatstore:list', () => ({ ok: true, activeId: SHOT_SESSIONS[0].id, sessions: SHOT_SESSIONS }))
ipcMain.handle('chatstore:load', (_e, id) => ({
  ok: true,
  turns: id === SHOT_SESSIONS[0].id ? SHOT_TURNS_PARTS : SHOT_TURNS_LEGACY,
}))
ipcMain.handle('chatstore:save', () => ({ ok: true }))
ipcMain.handle('chatstore:remove', () => ({ ok: true }))
ipcMain.handle('chatstore:set-active', () => ({ ok: true }))
ipcMain.handle('chatstore:file', () => join(shotProfile, 'chat-sessions.json'))

// 规则文件生成器：桩里按本仓库的真实 package.json 造一份扫描结果，
// 这样截图中的命令清单是真的（布局体检才有意义）
ipcMain.handle('agentrules:default-root', () => root)
ipcMain.handle('agentrules:pick', () => root)
ipcMain.handle('agentrules:save', (_e, _root, target) =>
  ({ ok: true, path: join(root, target === 'cursor' ? '.cursorrules' : target === 'claude' ? 'CLAUDE.md' : 'AGENTS.md') }))
ipcMain.handle('agentrules:scan', () => {
  const pkg = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8'))
  // 与 electron/main/agentrules.ts 的 SCRIPT_KINDS 保持一致；桩只用于布局体检
  const kindOf = (n) =>
    /^(dev|develop|serve|watch|preview|start:dev)/i.test(n) ? 'dev'
    : /^(build|compile|dist|bundle|package|release)/i.test(n) ? 'build'
    : /^(test|spec|e2e|smoke)/i.test(n) ? 'test'
    : /^(lint|eslint|check:lint|i18n)/i.test(n) ? 'lint'
    : /^(typecheck|type-check|tsc|check:types)/i.test(n) ? 'typecheck'
    : /^(format|fmt|prettier|fix)/i.test(n) ? 'format'
    : 'other'
  const commands = [
    { kind: 'install', name: 'npm', command: 'npm install', source: 'npm' },
    ...Object.keys(pkg.scripts).slice(0, 11).map((n) => ({
      kind: kindOf(n), name: n, command: `npm run ${n}`, source: 'package.json',
    })),
  ]
  return {
    ok: true,
    facts: {
      root,
      rootName: 'pr-tools',
      tree: [
        '├── electron/',
        '│   ├── main/',
        '│   │   ├── http.ts',
        '│   │   ├── chat.ts',
        '│   │   ├── mcpclient.ts',
        '│   │   └── agentrules.ts',
        '│   └── preload/',
        '│       └── index.ts',
        '├── scripts/',
        '│   ├── smoke-mcp.mjs',
        '│   └── smoke-chat.ts',
        '├── src/',
        '│   ├── lib/',
        '│   ├── tools/',
        '│   └── App.tsx',
        '├── index.html',
        '├── package.json',
        '├── tsconfig.json',
        '└── vite.config.ts',
      ].join('\n'),
      stats: { files: 138, dirs: 24, truncated: false },
      languages: ['TypeScript'],
      frameworks: ['React', 'Electron', 'Vite', 'Tailwind CSS', 'TypeScript'],
      packageManager: 'npm',
      commands,
      keyFiles: ['package.json', 'tsconfig.json', 'electron.vite.config.ts', 'README.md'],
      signals: ['hasCi', 'hasDocker', 'hasLockfile', 'hasLinter', 'hasTests', 'hasTsconfig', 'hasReadme'],
      notes: [],
    },
  }
})

// MCP 面板要展示本机启动路径，桩里按开发态还原一份，否则截图看不到配置区块（也就体检不到它的布局）
ipcMain.handle('mcp:info', () => {
  const serverPath = join(root, 'out/mcp/devtoolbox-mcp.cjs')
  const version = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')).version
  const launch = {
    serverPath,
    command: process.execPath,
    args: [serverPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    serverPathExists: fs.existsSync(serverPath),
    configJson: JSON.stringify(
      { mcpServers: { devtoolbox: { command: process.execPath, args: [serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } } } },
      null,
      2,
    ),
    packaged: false,
    version,
  }
  return {
    launch,
    hints: [
      { client: 'Claude Desktop', path: join(homedir(), 'Library/Application Support/Claude/claude_desktop_config.json') },
      { client: 'Cursor', path: join(homedir(), '.cursor/mcp.json') },
      { client: 'WorkBuddy', path: join(homedir(), '.workbuddy/mcp.json') },
    ],
  }
})

/**
 * 默认预置一份模型档案。对话是默认视图，而模型清单现在只从 localStorage 读 ——
 * 不预置的话截到的永远只是「先连一个模型」的引导卡，新界面等于没体检到。
 * 传 DTB_SHOT_LS 时以传入的为准（同名键会覆盖）。
 */
const SHOT_MODEL = { id: 'mshot0001', label: '演示模型', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-demo', model: 'deepseek-chat' }
const DEFAULT_LS_SEED = {
  'devtoolbox-chat-profiles': JSON.stringify([SHOT_MODEL]),
  'devtoolbox-chat-active-profile': SHOT_MODEL.id,
}
const lsSeed = { ...DEFAULT_LS_SEED, ...(process.env.DTB_SHOT_LS ? JSON.parse(process.env.DTB_SHOT_LS) : {}) }

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
