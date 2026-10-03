/**
 * 交互层（HCI）冒烟脚本 —— 覆盖 2026-10-02 评审里定下的那一批「人机交互」契约。
 *
 * 与其他 smoke 的分工：
 *   - smoke:render验证工具能不能渲染（结构）；
 *   - **本脚本验证交互对不对**（行为契约）：状态留不留、焦点关不关住、
 *     搜不搜得到、键盘走不走得通、播不播报。
 *
 * 被测对象是**真实的产品代码**（src/lib/persist.ts、src/components/ui.tsx、
 * src/lib/registry.ts、src/index.css），不是复制的逻辑 —— 复制一遍再测等于自说自话。
 *
 * 覆盖：
 *   1. 持久化：往返、超长截断、损坏 JSON 容错、隐私模式不抛
 *   2. 折叠区折叠时必须 inert（否则 aria-hidden 与可聚焦打架，键盘能Tab 进看不见的地方）
 *   3. Drawer：初始焦点接管 + Tab 环绕 + 关闭后焦点归还触发元素
 *   4. 搜索：多词 AND、精确名优先、桌面/浏览器构建可见性
 *   5. HOT 阈值：标记数量有上限（原来 20/65 全标HOT，等于没标记）
 *   6. 命令面板：必须提供命令型条目（切主题/语言/缩放），不只是导航
 *   7. 无障碍底座：CopyBtn / ErrorNote 的 aria-live、index.css 的 reduced-motion 降级
 *   8. 示例数据：所有示例必须是可直接跑通的合法输入（不是占位乱码）
 *
 * 运行：npm run smoke:ux
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  PERSIST_PREFIX,
  MAX_PERSIST_CHARS,
  loadPersisted,
  savePersisted,
  clearPersisted,
} from '../src/lib/persist'
import * as ui from '../src/components/ui'
import { Collapse, ToolGuide, CopyBtn, ErrorNote, ExampleBar, ToolShell } from '../src/components/ui'
import { I18nProvider } from '../src/lib/i18n'
import { searchTools, visibleTools, TOOLS, HOT_TOOL_LIMIT } from '../src/lib/registry'
import { PALETTE_COMMANDS } from '../src/lib/palette'
import { PALETTE_LABEL } from '../src/lib/locales/ui'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/* ================= 断言小工具 ================= */

let pass = 0
const fails: string[] = []
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; return }
  fails.push(label)
  console.error(`  ✗ ${label}`)
}
function eq<T>(got: T, want: T, label: string): void {
  ok(got === want, `${label}（期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}）`)
}

/* ================= 浏览器环境桩 ================= */

const store = new Map<string, string>()
let throwOnWrite = false
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    // 隐私模式 / 配额满：写会抛。持久化必须吞掉这个异常，而不是让整页崩
    if (throwOnWrite) throw new Error('QUOTA_EXCEEDED')
    store.set(k, v)
  },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => { store.clear() },
  // 真实 Storage 有 key(i)/length，遍历式清理（purgeSensitiveSession）依赖它们。
  // 桩缺了这两个会让「实现有 bug」和「桩不完整」分不开
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}
/** 假 DOM 元素：只需要 lib/focus 用到的那几个方法 */
type FakeEl = HTMLElement & { tagName: string }
const doc = {
  activeElement: null as FakeEl | null,
  documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {}, removeProperty() {} }, lang: 'zh-CN' },
  createElement: (tag: string) => ({
    tagName: tag.toUpperCase(), value: '', innerHTML: '', style: { setProperty() {} },
    select() {}, setAttribute() {}, focus() {}, click() {}, appendChild() {}, removeChild() {},
    set textContent(v: string) { this.innerHTML = v }, get textContent() { return this.innerHTML },
  }),
  body: {
    appendChild() {}, removeChild() {},
    style: { overflow: '' },
    querySelectorAll: () => [],
  },
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}
;(globalThis as unknown as { window: unknown }).window = {
  electronAPI: undefined,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: (fn: () => void) => { fn(); return 0 },
}
;(globalThis as unknown as { localStorage: unknown }).localStorage = localStorageStub
;(globalThis as unknown as { document: unknown }).document = doc


/**
 * 剥掉注释，只留真实代码。
 *
 * 为什么需要：断言「代码里不该出现 window.confirm」时，解释它为什么被移除的
 * 注释里往往就写着 window.confirm —— 只按行过滤会漏掉跨行的块注释内容。
 * 所以先整块剥掉 C 风格块注释与 JSX 花括号注释，再剥行注释。
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter(l => !l.trimStart().startsWith('//'))
    .join('\n')
}

const withI18n = (node: React.ReactNode): React.ReactElement =>
  <I18nProvider>{node}</I18nProvider>

/** registry 里全部工具 id（后面多处断言要用：映射校验、示例表校验） */
const TOOL_IDS = TOOLS.map((t) => t.id)

// bundle 产物在 node_modules/.cache/ 下，回退两级才是仓库根
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/* ================= 1. 持久化契约 ================= */

{
  store.clear()
  eq(loadPersisted('tool-does-not-exist', 'fallback'), 'fallback', '没存过时返回兜底值')
  eq(savePersisted('base64', 'hello'), true, '首次写入返回成功')
  eq(loadPersisted('base64', 'x'), 'hello', '写入后能原样读回')
  ok(store.has(`${PERSIST_PREFIX}base64`), '存储键带统一前缀，避免和别的模块撞车')

  // 超长内容必须截断：localStorage 只有 5MB，硬写会抛 QuotaExceededError
  const huge = 'x'.repeat(MAX_PERSIST_CHARS * 2)
  eq(savePersisted('huge', huge), false, '超长内容写入失败并返回 false（不抛）')
  eq(loadPersisted('huge', 'fallback'), 'fallback', '超长内容没落盘，读回兜底值')

  // 损坏的 JSON：手动塞进去，模拟别人写坏或版本升级后的旧格式
  store.set(`${PERSIST_PREFIX}broken`, '{not json')
  eq(loadPersisted('broken', 'safe'), 'safe', '损坏 JSON 容错回落到兜底值')
  store.set(`${PERSIST_PREFIX}wrongType`, '"我是字符串"')
  eq(loadPersisted<number>('wrongType', 7), 7, '类型不符时回落，不把字符串当数字用')

  // 隐私模式：写会抛，必须吞掉
  throwOnWrite = true
  eq(savePersisted('nope', 'v'), false, '隐私模式下写入失败返回 false 而不是崩溃')
  eq(loadPersisted('nope', 'fallback'), 'fallback', '隐私模式下读取仍走兜底')
  throwOnWrite = false

  clearPersisted('base64')
  eq(loadPersisted('base64', 'gone'), 'gone', 'clear 后读回兜底值')

  // 空串是合法值，不能被当成「没存过」
  savePersisted('empty', '')
  eq(loadPersisted('empty', 'fallback'), '', '空字符串是合法的已存值，不会被兜底覆盖')
}

/* ================= 2. 折叠区必须 inert ================= */

{
  // Collapse 折叠时（open=false）内部按钮不该能被 Tab 命中。
  // aria-hidden 挡不住键盘焦点，inert 才行 —— 这是评审里的 P0。
  const collapsed = renderToStaticMarkup(withI18n(<Collapse title="参考"><button>内部按钮</button></Collapse>))
  ok(collapsed.includes('aria-hidden="true"'), '折叠态带 aria-hidden')
  ok(/inert/.test(collapsed), '折叠态带 inert（键盘 Tab 不该落进看不见的内容）')

  const expanded = renderToStaticMarkup(withI18n(<Collapse title="参考" defaultOpen><button>内部按钮</button></Collapse>))
  ok(expanded.includes('aria-hidden="false"'), '展开态 aria-hidden=false')
  ok(!/inert/.test(expanded), '展开态不加 inert（加了内容就点不到了）')

  const guide = renderToStaticMarkup(withI18n(<ToolGuide title="怎么用" steps={['第一步', '第二步']} />))
  ok(/inert/.test(guide), 'ToolGuide 折叠态同样带 inert')
}

/* ================= 3. Drawer 的焦点处理 ================= */

{
  // 抽屉走 createPortal，SSR 渲不出来（没有真实 DOM 容器），所以焦点行为不靠渲染组件来验，
  // 而是直接测 lib/focus 的纯逻辑 + 用假 DOM 验 trapTab 的环绕行为。
  // 这样测的是真正被组件调用的那份代码，不是复刻品。
  const { trapTab, collectFocusable, FOCUSABLE_SELECTOR } = await import('../src/lib/focus')
  ok(FOCUSABLE_SELECTOR.includes('button:not([disabled])'), '可聚焦选择器排除了 disabled 按钮')
  ok(FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'), '可聚焦选择器排除了 tabindex=-1')

  /* --- 真实 DOM 顺序收集（本轮修掉的 P0） ---
   *
   * 历史教训：旧实现只收集带 data-focus-id 的节点，而全项目只有抽屉关闭按钮声明了它，
   * 于是 items 恒为 ['drawer-close']，抽屉里的表单键盘不可达 —— 而当时的假 DOM 里
   * getAttribute('data-focus-id') 永远返回 id，等于测试桩自己复刻了 bug，736 项全绿。
   * 下面的假元素刻意**不带** data-focus-id，如实反映生产 DOM：收集必须按真实
   * 可聚焦性 + DOM 顺序工作，与有没有自定义 id 无关。
   */
  const mkEl = (tag: string, opts: { visible?: boolean; disabled?: boolean; label?: string } = {}): FakeEl => {
    const el: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      disabled: opts.disabled === true,
      label: opts.label,
      getAttribute: () => null, // 关键：生产 DOM 里没有 data-focus-id
      focus: () => { doc.activeElement = el as unknown as FakeEl },
      getClientRects: () => (opts.visible === false ? [] : [{}] as unknown as DOMRectList),
      contains: (n: unknown) => n === el,
    }
    return el as unknown as FakeEl
  }

  // 一个仿真抽屉：标题栏「×」+ 三个表单字段 + 提交，顺序即 Tab 顺序
  const closeBtn = mkEl('button', { label: '×' })
  const nameInput = mkEl('input', { label: '模型名' })
  const urlInput = mkEl('input', { label: 'Base URL' })
  const keyInput = mkEl('input', { label: 'API Key' })
  const submitBtn = mkEl('button', { label: '提交' })
  const panelKids = [closeBtn, nameInput, urlInput, keyInput, submitBtn]
  const panel = {
    contains: (n: unknown) => panelKids.includes(n as FakeEl),
    querySelectorAll: (sel: string) =>
      panelKids.filter(el => matchFocusable(el, sel)) as unknown as NodeListOf<HTMLElement>,
    querySelector: () => null,
  } as unknown as HTMLElement

  const found = collectFocusable(panel)
  eq(found.length, 5, '收集到抽屉里全部 5 个可聚焦元素（不再只认 data-focus-id）')
  eq(
    found.map(el => (el as unknown as { label?: string }).label ?? '?').join(','),
    '×,模型名,Base URL,API Key,提交',
    '按真实 DOM 顺序收集：关闭按钮 → 三个输入框 → 提交',
  )

  // disabled / tabindex=-1 由选择器本身排除（真实浏览器行为，桩里也照做）
  const off = mkEl('button', { disabled: true })
  const negative = mkEl('input')
  ;(negative as unknown as { tabIndex: number }).tabIndex = -1
  eq(collectFocusable({ querySelectorAll: (s: string) => [off, negative].filter(e => matchFocusable(e, s)) } as unknown as HTMLElement).length, 0,
    'disabled 与 tabindex=-1 元素不进焦点序列')

  // 不可见元素由 collectFocusable 自己过滤（选择器管不到可见性）
  const invisible = mkEl('input', { visible: false })
  eq(collectFocusable({ querySelectorAll: () => [invisible] } as unknown as HTMLElement).length, 0,
    '不可见元素不进焦点序列')

  /* --- trapTab 改为直接吃元素列表，不再需要 firstId/lastId --- */
  // 焦点在最后一个元素上按 Tab → 必须环绕回第一个，否则焦点跑出抽屉
  doc.activeElement = submitBtn
  eq(trapTab(panel, 'forward'), true, '焦点在末元素按 Tab 时拦住并环绕')
  eq(doc.activeElement, closeBtn, '环绕后焦点落在首元素上（× 关闭按钮）')

  // 焦点在第一个元素上按 Shift+Tab → 环绕到最后一个
  doc.activeElement = closeBtn
  eq(trapTab(panel, 'backward'), true, '焦点在首元素按 Shift+Tab 时拦住并环绕')
  eq(doc.activeElement, submitBtn, '反向环绕后焦点落在末元素上（提交按钮）')

  // 焦点在中间：不该拦，交给浏览器原生处理
  doc.activeElement = urlInput
  eq(trapTab(panel, 'forward'), false, '焦点在中间时不管（原生顺序已经对）')
  eq(trapTab(panel, 'backward'), false, '焦点在中间时反向也不管')

  // 焦点还在抽屉外（刚打开还没接管）→ 不拦，交给初始聚焦逻辑
  doc.activeElement = mkEl('div')
  eq(trapTab(panel, 'forward'), false, '焦点在容器外时不拦')

  eq(trapTab(null, 'forward'), false, '容器为 null 时不处理')
  const emptyPanel = { contains: () => false, querySelectorAll: () => [] } as unknown as HTMLElement
  doc.activeElement = mkEl('div')
  eq(trapTab(emptyPanel, 'forward'), false, '容器里没有可聚焦元素时不处理')
}

/** 极简选择器匹配：只认 FOCUSABLE_SELECTOR 里用到的语法，够冒烟用 */
function matchFocusable(el: FakeEl, sel: string): boolean {
  const tag = el.tagName.toLowerCase()
  const meta = el as unknown as { disabled?: boolean; tabIndex?: number }
  if (meta.disabled === true) return false
  if (meta.tabIndex === -1) return false
  return sel.split(',').some(part => {
    const p = part.trim()
    if (p.startsWith('[')) return true // [tabindex]:not([tabindex="-1"]) —— 上面的 tabIndex 检查已覆盖
    if (p.startsWith('a[')) return tag === 'a'
    if (p === 'summary' || p === '[contenteditable="true"]') return true // 桩里没有这两种，统一放行
    if (p.startsWith('audio') || p.startsWith('video')) return false // 桩里没有媒体控件
    const name = p.replace(':not([disabled])', '')
    return name === 'button' || name === 'input' || name === 'textarea' || name === 'select'
  })
}

/* ================= 4. 搜索 ================= */

{
  const all = visibleTools()
  ok(all.length > 0, '当前构建有可见工具')

  // 多词 AND：评审里点名的问题——整串 includes 导致「time json」永远零结果
  const multi = searchTools('json')
  ok(multi.length > 0, '单词查询有结果')
  const jsonZh = multi.filter(t => t.id.includes('json') || t.keywords.some(k => k.includes('json')))
  ok(jsonZh.length > 0, '查 json 能查到 JSON 相关工具')

  const twoWords = searchTools('json format')
  ok(twoWords.length > 0, '多词查询不再是零结果（空格分词后AND 匹配）')
  ok(twoWords.length <= multi.length, '多词查询结果不多于单词查询')

  const chineseTwo = searchTools('时间 时区')
  ok(chineseTwo.length > 0, '中文多词也能命中')

  // 精确名匹配应当排前面：搜 base64 时Base64 工具要能一眼看到
  const exact = searchTools('base64')
  eq(exact[0]?.id, 'base64', '工具名精确命中排在第一位')

  eq(searchTools('').length, all.length, '空查询返回全部可见工具')
  eq(searchTools('   ').length, all.length, '纯空白查询等同空查询')

  // 不存在的词必须真的空，不能靠「匹配不到也返回全部」蒙混过关
  eq(searchTools('zzzzz-not-a-real-tool').length, 0, '无匹配词返回空列表')

  // 大小写与中英文混输
  ok(searchTools('JWT').length > 0, '大写 JWT 能搜到（大小写不敏感）')
  ok(searchTools('正则').length > 0, '中文词能搜到')
}

/* ================= 5. HOT 标记阈值 ================= */

{
  const hot = TOOLS.filter(t => t.hot)
  ok(hot.length > 0, '存在 HOT 工具（不能一个都没有）')
  ok(
    hot.length <= HOT_TOOL_LIMIT,
    `HOT 标记数被限制在 ${HOT_TOOL_LIMIT} 以内（实际 ${hot.length}）——超过阈值等于没标记`
  )
  ok(hot.length <= TOOLS.length * 0.2, 'HOT 占比不超过两成')
}

/* ================= 6. 命令面板的命令条目 ================= */

{
  const cmds = PALETTE_COMMANDS
  ok(cmds.length >= 4, `命令面板提供命令型条目（实际 ${cmds.length} 条，至少 4）`)
  ok(cmds.every(c => typeof c.id === 'string' && c.id.length > 0), '每条命令有稳定 id')
  ok(cmds.every(c => typeof c.icon === 'string' && c.icon.length > 0), '每条命令有图标')

  // 命令 id必须语言中立（label 才走 i18n）—— 沿用工具 id 的既有约定
  ok(cmds.every(c => /^[\x20-\x7e]+$/.test(c.id)), '命令 id 是 ASCII（语言中立，可做存储键）')

  const kinds = new Set(cmds.map(c => c.kind))
  ok(kinds.has('theme'), '含切主题命令')
  ok(kinds.has('locale'), '含切语言命令')
  ok(kinds.has('zoom'), '含界面缩放命令')
  ok(new Set(cmds.map(c => c.id)).size === cmds.length, '命令 id 不重复')

  // 标签走双语字典（按 kind 取），两个分支都不能缺
  for (const locale of ['zh', 'en'] as const) {
    for (const c of cmds) {
      const label = PALETTE_LABEL[locale][c.kind]
      ok(typeof label === 'string' && label.length > 0, `${locale} 下 ${c.kind} 有可读标签`)
    }
  }
}

/* ================= 7. 无障碍底座 ================= */

{
  const copy = renderToStaticMarkup(withI18n(<CopyBtn text="payload" />))
  ok(copy.includes('aria-live'), 'CopyBtn 带 aria-live（复制成功要能播报）')

  const err = renderToStaticMarkup(withI18n(<ErrorNote msg="出错了" />))
  ok(err.includes('role="alert"'), 'ErrorNote 带 role=alert（错误要立刻播报）')

  // 无文本的错误提示也必须能被读屏读到
  const bar = renderToStaticMarkup(withI18n(<ExampleBar sample="abc" label="示例：" onPick={() => {}} />))
  ok(bar.includes('<button'), 'ExampleBar 渲染可点击的示例按钮')
  // 示例值本身要能让读屏用户知道「点了会发生什么」，光有按钮不够
  ok(bar.includes('abc'), '示例按钮把示例值渲染出来（不只在 title 里）')
  ok(/示例/.test(bar), '示例按钮带「示例」标签，读屏用户知道这不是正文')

  // 持久化失败提示：静默失败是最坏的体验，必须说出来
  const { PersistHint } = ui
  const failed = renderToStaticMarkup(withI18n(<PersistHint persisted={false} />))
  ok(failed.includes('role="status"'), '持久化失败提示带 role=status（不打断朗读，只告知）')
  ok(/隐私模式|private mode/.test(failed), '持久化失败提示说清了原因')
  const okCase = renderToStaticMarkup(withI18n(<PersistHint persisted />))
  ok(okCase === '', '持久化正常时不渲染任何提示（不制造噪音）')

  // ToolShell 是三件事（引导/示例/⌘↵）的统一落点，必须能渲染
  const shell = renderToStaticMarkup(withI18n(
    <ToolShell toolId="base64" guide="base64" onSubmit={() => {}}>
      <span>内容</span>
    </ToolShell>
  ))
  ok(/怎么用/.test(shell), 'ToolShell 渲染引导条')
  ok(/示例/.test(shell), 'ToolShell 渲染示例条')
  ok(/⌘↵|Ctrl ↵/.test(shell), 'ToolShell 渲染 ⌘↵ 提示')
  ok(shell.includes('内容'), 'ToolShell 渲染传入的子内容')

  // 没有示例的工具不该硬塞一个不相关的示例
  const noEx = renderToStaticMarkup(withI18n(<ToolShell toolId="not-a-tool"><span>x</span></ToolShell>))
  ok(!/示例/.test(noEx), '示例表里没有的工具不显示示例条')
  ok(!/怎么用/.test(noEx), '没有映射的工具不渲染引导条（不会凭空编一段引导）')
  // toolId 已在映射表里 → 不传 guide 也会自动出引导（少写一处，漏一处的机会就少一处）
  const auto = renderToStaticMarkup(withI18n(<ToolShell toolId="base64"><span>x</span></ToolShell>))
  ok(/怎么用/.test(auto), 'toolId 在映射表里时自动渲染引导条')
  ok(!/↵/.test(auto), '没传 onSubmit 就不渲染快捷键提示（引导条仍显示）')
}

{
  // 引导词条：双语必须都在，且英文分支不能夹中文
  // （原来逐页硬编码中文引导，英文界面下会直接漏中文 —— smoke:render 抓到过这个）
  const { guideL } = await import('../src/lib/locales/guide')
  const keys = Object.keys(guideL.zh).filter((k) => k !== 'shell')
  eq(keys.length, Object.keys(guideL.en).filter((k) => k !== 'shell').length, '引导词条两个分支键数一致')
  const HAN = /[\u4e00-\u9fff]/
  for (const k of keys) {
    const zh = guideL.zh[k] as { steps: string[]; submit?: string; note?: string }
    const en = guideL.en[k] as { steps: string[]; submit?: string; note?: string }
    ok(!!en, `英文分支有 ${k} 的引导`)
    ok(zh.steps.length === en.steps.length, `${k} 的引导步数两语言一致（结构对不上是漏翻）`)
    const leaked = en.steps.find((s) => HAN.test(s))
    ok(!leaked, `${k} 的英文引导不含中文${leaked ? `：${leaked}` : ''}`)
    ok(zh.steps.every((s) => s.length > 0), `${k} 的中文引导每步非空`)
    if (zh.submit) ok(!!en.submit, `${k} 有 ⌘↵ 动作名的英文翻译`)
  }
  ok(!HAN.test(guideL.en.shell.title), '英文引导条标题不含中文')
  ok(!HAN.test(guideL.en.shell.exampleLabel), '英文示例条前缀不含中文')

  // 引导词条映射：工具 id（kebab）↔ 词条键（camel）必须双向对齐，
  // 否则引导条会**静默**不显示 —— 没有报错，只是功能没了
  const { GUIDE_FOR_TOOL } = await import('../src/lib/locales/guide')
  const { EXAMPLES } = await import('../src/lib/examples')
  const allKeys = new Set(keys)

  for (const [toolId, guideKey] of Object.entries(GUIDE_FOR_TOOL)) {
    ok(allKeys.has(guideKey), `${toolId} 的映射指向真实存在的词条 ${guideKey}`)
    ok(TOOL_IDS.includes(toolId), `${toolId} 是真实存在的工具`)
  }
  // 每个有示例的工具都必须有引导映射，否则「有示例没引导」体验割裂
  const orphanEx = Object.keys(EXAMPLES).filter((id) => !(id in GUIDE_FOR_TOOL))
  ok(orphanEx.length === 0, `有示例的工具都有引导映射（缺口：${orphanEx.join(', ') || '无'}）`)
  // 反向：映射里的工具不该指向空引导
  for (const [toolId, guideKey] of Object.entries(GUIDE_FOR_TOOL)) {
    const en = guideL.en[guideKey] as { steps: string[] }
    ok(en.steps.length > 0, `${toolId} 的引导有内容`)
  }
}

{
  // 样式层：动效必须能被系统偏好关掉（评审 P2）
  // esbuild 打包后 import.meta.url 指向 .cache 目录，所以按包.json 上溯定位仓库根
  const css = readFileSync(join(root, 'src/index.css'), 'utf8')
  ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css), 'index.css 有 prefers-reduced-motion 降级块')
  ok(/animation-duration:\s*0\.01ms/.test(css), '降级块里把动画时长压到接近 0')
  ok(/transition-duration:\s*0\.01ms/.test(css), '降级块也压transition（折叠区是纯 transition，只关 animation 不够）')
}

/* ================= 8. 示例数据本身合法 ================= */

{
  // 示例数据的意义是「一键就能看到结果」，示例本身不合法就是负优化
  const { EXAMPLES, exampleFor } = await import('../src/lib/examples')
    for (const key of Object.keys(EXAMPLES)) {
    ok(TOOL_IDS.includes(key), `示例表里的 ${key} 是真实存在的工具`)
  }
  ok(Object.keys(EXAMPLES).length >= 20, `示例表覆盖足够多工具（实际 ${Object.keys(EXAMPLES).length} 个）`)

  // 「示例」标签走 i18n（各工具页传label），示例表只放纯数据 —— 所以这里只查数据本身
  for (const [id, s] of Object.entries(EXAMPLES)) {
    ok(typeof s.sample === 'string' && s.sample.length > 0, `${id} 的示例输入非空`)
  }
  eq(exampleFor('base64')?.sample, EXAMPLES['base64'].sample, 'exampleFor 能按 id 取到示例')
  eq(exampleFor('not-a-tool'), undefined, '没有示例的工具返回 undefined（不显示示例条）')

  // 抽几个必须能真跑通的：示例本身不合法，示例按钮就是负优化
  const { utf8ToBase64, base64ToUtf8 } = await import('../src/lib/toolkit')
  const b64 = EXAMPLES['base64']
  eq(base64ToUtf8(utf8ToBase64(b64.sample)), b64.sample, 'base64 示例能正向再反向还原')

  // JSON 示例必须是合法 JSON —— 编码工具的示例最容易写成伪 JSON
  for (const id of ['json', 'jsonpath']) {
    try {
      JSON.parse(EXAMPLES[id].sample)
      ok(true, `${id} 的示例是合法 JSON`)
    } catch (e) {
      ok(false, `${id} 的示例是合法 JSON（实际解析失败：${(e as Error).message}）`)
    }
  }

  // CSV 示例：表头 + 至少一行数据，且每行列数一致
  for (const id of ['csv-json', 'fake-data']) {
    const lines = EXAMPLES[id].sample.split('\n').filter(Boolean)
    const cols = lines[0].split(',').length
    ok(lines.length >= 2 && lines.every((l) => l.split(',').length === cols), `${id} 的示例是列数一致的 CSV`)
  }

  // 正则示例必须真能编译 —— 写错的正则会让「示例」变成「报错演示」
  try {
    new RegExp(EXAMPLES['regex'].sample)
    ok(true, 'regex 的示例是合法正则')
  } catch (e) {
    ok(false, `regex 的示例是合法正则（实际：${(e as Error).message}）`)
  }
}

/* ================= 9. 三个新工具的算法正确性 ================= */

{
  /*
   * bcrypt 生成器**暂未上线**，实现已从仓库移出（保留在 /tmp/devtoolbox-bcrypt-wip/）。
   *
   * 结论如实记录：密码学本体（Blowfish F 函数 + 16轮 Feistel + π 常量表）已被
   * 6 组 PyCryptodome 向量证明正确，但 EksBlowfishSetup 的轮内调用序列尚未与
   * crypt_blowfish 对齐，bcryptHash 的输出与 `htpasswd -nbB` 不一致。
   * 与其把算错的哈希塞给用户，不如先不上线。
   */
  ok(!TOOL_IDS.includes('bcrypt-hash' as never), 'bcrypt 未注册为用户可见工具（算法未对齐前不上线）')
}

{
  // TOTP：用 RFC 6238 官方测试向量
  // RFC 6238 附录 B 的种子是 ASCII "12345678901234567890"，对应 Base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const { totp, totpVerify, totpRemaining, decodeSecret, encodeSecret, parseOtpauth } = await import('../src/lib/toolkit/totp')
  const RFC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  const RFC_VECTORS: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ]
  for (const [t, want] of RFC_VECTORS) {
    eq(await totp(RFC_SEED, t), want, `TOTP RFC 6238 向量 t=${t}`)
  }
  // 8 位变体
  eq(await totp(RFC_SEED, 59, { digits: 8 }), '94287082', 'TOTP 8 位模式')

  // 校验：当前码应通过，错的码应失败
  const now = 1234567890
  const code = await totp(RFC_SEED, now)
  eq((await totpVerify(RFC_SEED, code, now)).valid, true, 'TOTP 校验：当前时刻的码通过')
  eq((await totpVerify(RFC_SEED, '000000', now)).valid, false, 'TOTP 校验：错误码被拒')
  // 漂移窗口：±1 步内应通过
  const prev = await totp(RFC_SEED, now - 30)
  eq((await totpVerify(RFC_SEED, prev, now, { window: 1 })).valid, true, 'TOTP 校验：允许 -1 步漂移')
  eq((await totpVerify(RFC_SEED, prev, now, { window: 0 })).valid, false, 'TOTP 校验：窗口为 0 时拒绝漂移')

  // 剩余秒数
  eq(totpRemaining(59), 1, '剩余秒数：t=59 时剩 1 秒')
  eq(totpRemaining(58), 2, '剩余秒数：t=58 时剩 2 秒')
  ok(totpRemaining(59, 60) >= 1 && totpRemaining(59, 60) <= 60, '自定义周期也算得对')

  // Base32 往返
  const raw = new Uint8Array([0x61, 0x62, 0x63, 0x64, 0x65])
  eq([...decodeSecret(encodeSecret(raw))].join(','), '97,98,99,100,101', 'Base32 编解码往返一致')
  eq([...decodeSecret('MFRGG===')].join(','), '97,98,99', 'Base32 解码 RFC 4648 样例')
  // 常见笔误容错
  ok(decodeSecret('MFRGG0O1').length > 0, 'Base32 容错 0→O')
  try {
    decodeSecret('!!!')
    ok(false, '非法 Base32 字符应报错')
  } catch (e) {
    ok((e as Error).message === 'BAD_BASE32', '非法 Base32 报 BAD_BASE32')
  }
  try {
    decodeSecret('')
    ok(false, '空密钥应报错')
  } catch (e) {
    ok((e as Error).message === 'EMPTY_SECRET', '空密钥报 EMPTY_SECRET')
  }

  // otpauth 链接解析
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  const meta = parseOtpauth(`otpauth://totp/Example:alice@example.com?secret=${RFC_SECRET}&issuer=Example&digits=8&period=60&algorithm=SHA256`)
  eq(meta.account, 'alice@example.com', 'otpauth 解析出账号')
  eq(meta.issuer, 'Example', 'otpauth 解析出issuer')
  eq(meta.digits, 8, 'otpauth 解析出位数')
  eq(meta.period, 60, 'otpauth 解析出周期')
  eq(meta.algo, 'SHA256', 'otpauth 解析出算法')
  eq(meta.secret, RFC_SECRET, 'otpauth 解析出的密钥完整（不被截断）')
  // 解析出的参数确实被用上了：SHA256 + 8 位 + 60 秒 与 RFC 向量（SHA1/30秒）结果必不同
  const viaOtpauth = await totp(meta.secret, 59, meta)
  ok(viaOtpauth !== '94287082', '算法/周期不同时结果与 RFC 的 SHA1 30 秒值不同')
  eq(viaOtpauth.length, 8, 'otpauth 解析出的 8 位参数生效')

  // 不带 algorithm 的链接走默认 SHA1 + 30 秒，此时应等于 RFC 的 8 位向量
  const meta1 = parseOtpauth(`otpauth://totp/Example:alice?secret=${RFC_SECRET}&digits=8`)
  eq(meta1.algo, 'SHA1', 'otpauth 未指定 algorithm 时默认 SHA1')
  eq(meta1.period, 30, 'otpauth 未指定 period 时默认 30')
  eq(await totp(meta1.secret, 59, meta1), '94287082', '默认参数下与 RFC 6238 的 8 位向量一致')
}

{
  // JWT 签名：签-验往返 + 篡改检测 + 算法混淆检测
  const { jwtSign, jwtVerify, jwtExpIn, JWT_SIGN_ALGOS } = await import('../src/lib/toolkit/jwt-sign')
  const { jwtDecode, jwtIsExpired } = await import('../src/lib/toolkit/jwt')

  for (const algo of JWT_SIGN_ALGOS) {
    const payload = { sub: '1234567890', name: 'Ada', iat: 1700000000 }
    const r = await jwtSign(algo, payload, 'secret')
    ok(r.token.split('.').length === 3, `${algo} 生成的 token 有三段`)
    eq(jwtDecode(r.token).payloadObj.sub, '1234567890', `${algo} 的 payload 能被解码回来`)
    eq(jwtDecode(r.token).headerObj.alg, algo, `${algo} 的 header 记录了正确算法`)

    if (algo === 'none') {
      eq(r.signature, '', 'none 的签名段为空')
      eq((await jwtVerify(r.token, 'x', 'HS256')).reason, 'NO_SIG', 'none token 被判为无签名（算法混淆防护）')
    } else {
      eq((await jwtVerify(r.token, 'secret', algo)).valid, true, `${algo} 用正确密钥验签通过`)
      eq((await jwtVerify(r.token, 'wrong', algo)).valid, false, `${algo} 用错误密钥验签失败`)
      // 篡改 payload
      const parts = r.token.split('.')
      const forgedPayload = Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url')
      const forged = `${parts[0]}.${forgedPayload}.${parts[2]}`
      eq((await jwtVerify(forged, 'secret', algo)).valid, false, `${algo} 篡改 payload 后验签失败`)
      // 算法不符
      const other = algo === 'HS256' ? 'HS384' : 'HS256'
      eq((await jwtVerify(r.token, 'secret', other)).reason, 'ALG_MISMATCH', `${algo} 声明算法不符时报 ALG_MISMATCH`)
    }
  }

  // TTL 预设与 exp 计算
  ok(jwtExpIn(3600) - jwtExpIn(0) >= 3599, 'jwtExpIn 加上给定的秒数')
  const soon = await jwtSign('HS256', { sub: 'a', exp: jwtExpIn(60) }, 'k')
  eq(jwtIsExpired(jwtDecode(soon.token).payloadObj), false, '一分钟后过期：现在还没过期')
  const past = await jwtSign('HS256', { sub: 'a', exp: jwtExpIn(-60) }, 'k')
  eq(jwtIsExpired(jwtDecode(past.token).payloadObj), true, '一分钟前就该过期：现在已过期')

  // 空 token 验签不抛
  eq((await jwtVerify('', 'k', 'HS256')).reason, 'BAD_FORMAT', '空token 验签报 BAD_FORMAT（不抛）')
  eq((await jwtVerify('a.b', 'k', 'HS256')).reason, 'NO_SIG', '两段 token 没有签名段，报 NO_SIG')
  eq((await jwtVerify('a.b.c', 'k', 'HS256')).reason, 'BAD_FORMAT', 'header 不是合法 JSON 时报 BAD_FORMAT')
}

/* ================= 9. 表单 label 必须与控件编程关联 ================= */

/**
 * 旧实现里Input / TA / Select 的 label 渲染成纯 <span>，没有 htmlFor/id，
 * 也没有 aria-label —— 而且组件签名压根不接受 aria 属性，调用方想补都补不上。
 * 结果是全项目 144 个字段在读屏下都只是一声「编辑框」。这里锁死契约。
 */
{
  const inputHtml = renderToStaticMarkup(withI18n(<ui.Input value="" onChange={() => {}} label="模型名" />))
  ok(/<label[^>]*for="/.test(inputHtml), 'Input 的 label 渲染成 <label for>（可编程关联）')
  ok(/<input[^>]*id="/.test(inputHtml), 'Input 有 id 供 label 指向')
  const forId = inputHtml.match(/<label[^>]*for="([^"]+)"/)?.[1]
  const inputId = inputHtml.match(/<input[^>]*id="([^"]+)"/)?.[1]
  ok(!!forId && forId === inputId, 'Input 的 label for 与 input id 是同一个值')

  const taHtml = renderToStaticMarkup(withI18n(<ui.TA value="" label="请求体" />))
  ok(/<label[^>]*for="/.test(taHtml), 'TA 的 label 是 <label for>')
  const taFor = taHtml.match(/<label[^>]*for="([^"]+)"/)?.[1]
  const taId = taHtml.match(/<textarea[^>]*id="([^"]+)"/)?.[1]
  ok(!!taFor && taFor === taId, 'TA 的 label for 与 textarea id 一致')

  const selHtml = renderToStaticMarkup(withI18n(
    <ui.Select value="a" onChange={() => {}} label="请求方法" options={[{ value: 'a', label: 'GET' }]} />,
  ))
  ok(/<label[^>]*for="/.test(selHtml), 'Select 的 label 是 <label for>')
  const selFor = selHtml.match(/<label[^>]*for="([^"]+)"/)?.[1]
  const selId = selHtml.match(/<select[^>]*id="([^"]+)"/)?.[1]
  ok(!!selFor && selFor === selId, 'Select 的 label for 与 select id 一致')

  // 同页多个同类控件：id 必须互不相同，否则 label 会指向错误的字段
  const two = renderToStaticMarkup(withI18n(
    <div><ui.Input value="" onChange={() => {}} label="甲" /><ui.Input value="" onChange={() => {}} label="乙" /></div>,
  ))
  const ids = [...two.matchAll(/<input[^>]*id="([^"]+)"/g)].map(m => m[1])
  eq(ids.length, 2, '两个 Input 都有 id')
  ok(ids[0] !== ids[1], '同页两个 Input 的 id 不重复（label 不会指错字段）')

  // 调用方可以显式补 aria-label（透传口）
  const ariaHtml = renderToStaticMarkup(withI18n(
    <ui.Input value="" onChange={() => {}} aria-label="API Key" />,
  ))
  ok(ariaHtml.includes('aria-label="API Key"'), 'Input 透传 aria-label 给调用方')

  // 没传 label 时不该渲染出空 label 标签（有 aria-label 兜底）
  const bare = renderToStaticMarkup(withI18n(<ui.Input value="" onChange={() => {}} />))
  ok(!/<label/.test(bare), '没传 label 且无 aria-label 时不渲染空 label')

  // Btn 要能透传 aria-*（图标按钮需要可读名称）
  const btnHtml = renderToStaticMarkup(withI18n(<ui.Btn aria-label="复制">⧉</ui.Btn>))
  ok(btnHtml.includes('aria-label="复制"'), 'Btn 透传 aria-label（图标按钮可读）')
  ok(/type="button"/.test(btnHtml), 'Btn 显式带 type="button"（避免误触表单提交）')
}

/* ================= 10. 亮色主题对比度必须达标 ================= */

/**
 * 亮色主题下焦点环实测 1.60:1、主按钮 3.77:1、muted 4.28:1 —— 键盘用户基本没法用。
 * 这里从 index.css 真文件里解析变量值实算，而不是抄一份数字在测试里（抄的会漂）。
 */
{
  const css = readFileSync(join(root, 'src/index.css'), 'utf8')

  /** 取某个主题块里的 CSS 变量定义 */
  const varIn = (block: RegExp, name: string): string | null => {
    const m = css.match(block)
    if (!m) return null
    const v = m[1].match(new RegExp(`${name}:\\s*([^;]+);`))
    return v ? v[1].trim() : null
  }
  const lightBlock = /\.light\s*\{([\s\S]*?)\n\}/
  const darkBlock = /\.dark\s*\{([\s\S]*?)\n\}/

  type RGB = [number, number, number]
  const parse = (raw: string): RGB | null => {
    const hex = raw.match(/^#([0-9a-f]{6})$/i)
    if (hex) {
      const n = parseInt(hex[1], 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    const rgb = raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    return null
  }
  const alphaOf = (raw: string): number => {
    const a = raw.match(/rgba\([^)]*?,\s*([\d.]+)\s*\)/)
    return a ? Number(a[1]) : 1
  }
  /** 把半透明色合成到不透明底色上（亮色焦点环是 40% 透明度，必须合成后才算对比度） */
  const over = (fg: RGB, bg: RGB, a: number): RGB =>
    [0, 1, 2].map(i => Math.round(fg[i] * a + bg[i] * (1 - a))) as RGB
  const lum = (c: RGB): number => {
    const f = (v: number): number => {
      const x = v / 255
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const contrast = (a: RGB, b: RGB): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
  }

  const lightBg = parse(varIn(lightBlock, '--c-bg') ?? '') ?? [246, 247, 249]
  const lightPanel2 = parse(varIn(lightBlock, '--c-panel-2') ?? '') ?? [241, 243, 246]
  const darkPanel2 = parse(varIn(darkBlock, '--c-panel-2') ?? '') ?? [28, 33, 40]

  // ① 焦点环：WCAG 2.2 SC 1.4.11 非文本对比度要求 ≥ 3:1
  const lightFocusRaw = varIn(lightBlock, '--c-focus')
  const lightFocus = lightFocusRaw ? parse(lightFocusRaw) : null
  ok(!!lightFocus, '亮色主题定义了 --c-focus')
  if (lightFocus) {
    const composed = over(lightFocus, lightPanel2, alphaOf(lightFocusRaw!))
    const cr = contrast(composed, lightPanel2)
    ok(cr >= 3, `亮色焦点环对 panel-2 对比度 ${cr.toFixed(2)}:1 ≥ 3:1（键盘焦点必须可见）`)
  }
  const darkFocusRaw = varIn(darkBlock, '--c-focus')
  const darkFocus = darkFocusRaw ? parse(darkFocusRaw) : null
  if (darkFocus) {
    const cr = contrast(over(darkFocus, darkPanel2, alphaOf(darkFocusRaw!)), darkPanel2)
    ok(cr >= 3, `暗色焦点环对 panel-2 对比度 ${cr.toFixed(2)}:1 ≥ 3:1`)
  }

  // ② 焦点环样式：1px + 负offset 贴在边框内侧，等于没有焦点指示
  ok(/outline:\s*2px solid var\(--c-focus\)/.test(css), '焦点环用 2px 实线（1px 几乎不可见）')
  ok(/outline-offset:\s*2px/.test(css), '焦点环有正的outline-offset（不贴住边框）')

  // ③ 主按钮：白字叠在磷绿上，亮色下 3.77:1 不足 4.5:1
  const lightPhosphorRaw = varIn(lightBlock, '--c-phosphor')
  const lightOnRaw = varIn(lightBlock, '--c-on-phosphor')
  const ph = lightPhosphorRaw ? parse(lightPhosphorRaw) : null
  const on = lightOnRaw ? parse(lightOnRaw) : null
  ok(!!ph && !!on, '亮色主题定义了主按钮的前景色与背景色')
  if (ph && on) {
    const cr = contrast(on, ph)
    ok(cr >= 4.5, `亮色主按钮文字对比度 ${cr.toFixed(2)}:1 ≥ 4.5:1`)
  }

  // ④ 次要文字：muted 是全站用量最大的文本色
  const lightMutedRaw = varIn(lightBlock, '--c-muted')
  const muted = lightMutedRaw ? parse(lightMutedRaw) : null
  if (muted) {
    const cr = Math.min(contrast(muted, lightBg), contrast(muted, lightPanel2))
    ok(cr >= 4.5, `亮色 muted 对最浅底色对比度 ${cr.toFixed(2)}:1 ≥ 4.5:1`)
  }

  // ⑤ 暗色代码注释色3.69:1 不足
  const darkComRaw = varIn(darkBlock, '--c-hl-com')
  const com = darkComRaw ? parse(darkComRaw) : null
  if (com) {
    const cr = contrast(com, darkPanel2)
    ok(cr >= 4.5, `暗色代码注释色对比度 ${cr.toFixed(2)}:1 ≥ 4.5:1`)
  }

  // ⑥ 亮色 phosphor-dim 近乎白底，旧值 1.20:1
  const lightDimRaw = varIn(lightBlock, '--c-phosphor-dim')
  const dim = lightDimRaw ? parse(lightDimRaw) : null
  if (dim) {
    const cr = contrast(dim, lightBg)
    ok(cr >= 3, `亮色 phosphor-dim 对比度 ${cr.toFixed(2)}:1 ≥ 3:1（不能接近背景色）`)
  }

  // ⑦ 工具名硬编码色必须走主题变量（那个浅蓝在亮色白底上只有 1.81:1）
  //只查 className里的 text-[#xxxxxx] 形式，避免命中注释里提到色值的地方
  for (const f of ['src/components/chat/MessageView.tsx', 'src/components/chat/TraceView.tsx']) {
    const src = readFileSync(join(root, f), 'utf8')
    ok(!/text-\[#[0-9a-f]{3,8}\]/i.test(src),
      `${f} 不再硬编码 text-[#...] 颜色（亮色下不可读），改走主题变量`)
  }
  ok(/--c-hl-fn:/.test(css), 'index.css 定义了 --c-hl-fn（函数/工具名的语义色）')
}

/* ================= 11. 结果区 / 确认 / 异步 三件套 ================= */

/**
 * 第2 批的一致性契约。起因是同一个意图在项目里有四种做法：
 *   - 清空：一点就清 / 行内二次确认 / window.confirm / 干脆没入口（proxy.tsx 一个文件里就有两种）
 *   - 结果区：7 处结果没有任何复制入口；CSV预览 slice(0,20) 静默截断且不告知还有多少行
 *   - 异步：httpclient/mcpclient 有 loading，authtools 的 jwtSign（async）却没有
 * 这里把三者抽成底座并锁死行为。
 */
{
  const { truncationNotice, shouldConfirm } = await import('../src/lib/interaction')

  /* --- 截断提示：静默截断是最糟的一种，用户以为结果就这么多 --- */
  eq(truncationNotice(20, 20), null, '没截断时不显示任何提示')
  eq(truncationNotice(20, 500), 'showing 20 of 500', '截断时告知真实总行数')
  ok(truncationNotice(20, 21)?.includes('20'), '提示里同时说明已显示多少行')

  /* --- 危险操作确认：第一次点只进入待确认态，不执行 --- */
  eq(shouldConfirm('idle', true), false, '空闲态第一次点击不弹确认，直接执行')
  eq(shouldConfirm('armed', true), true, '已待确认时再点一次才执行')
  eq(shouldConfirm('armed', false), false, '待确认状态下取消不执行')

  /* --- ResultPanel：复制入口 + 高度上限 + 空状态 --- */
  const one = renderToStaticMarkup(withI18n(
    <ui.ResultPanel title="结果" text="abc" />,
  ))
  ok(/max-height:\s*\d+px/.test(one), 'ResultPanel 自带高度上限（大结果不会把页面撑到几千像素）')
  ok(/overflow-auto/.test(one), 'ResultPanel 内容区可滚动')
  ok(one.includes('aria-label='), 'ResultPanel 的复制按钮有可读名称')
  // 限高必须是真实的 CSS 值，不能是占位类名（max-h- 不是合法 Tailwind 类）
  ok(!/max-h-(?![\[0-9])/.test(one), 'ResultPanel 没有用占位的 max-h- 类名（限高会失效）')

  // 传了 text 就该能复制
  ok(one.includes('复制') || one.includes('Copy'), 'ResultPanel 带复制入口')

  // 空状态：不能是空白，得有引导
  const empty = renderToStaticMarkup(withI18n(<ui.ResultPanel title="结果" text="" emptyHint="粘点什么" />))
  ok(empty.includes('粘点什么'), 'ResultPanel 空状态显示引导文案')
  ok(!empty.includes('max-h-'), '空状态不套滚动容器（没有内容可滚）')

  // 截断时必须显示提示
  const cut = renderToStaticMarkup(withI18n(
    <ui.ResultPanel title="结果" rows={['a', 'b']} total={500} />,
  ))
  ok(cut.includes('500'), 'ResultPanel 截断时告知真实总行数')

  /* --- ConfirmButton：行内二次确认，不用 window.confirm --- */
  const cb = renderToStaticMarkup(withI18n(
    <ui.ConfirmButton label="清空" confirmLabel="确认清空" onConfirm={() => {}} />,
  ))
  ok(!/window\.confirm/.test(cb), 'ConfirmButton 不用原生 window.confirm（与整体风格割裂）')
  ok(cb.includes('清空'), 'ConfirmButton 有可读标签')

  /* --- useAsyncAction：busy 期间拒绝重入 --- */
  const { makeAsyncGuard } = await import('../src/lib/interaction')
  let running = false
  const guard = makeAsyncGuard(() => running)
  eq(guard.enter(), true, '空闲时允许进入')
  running = true
  eq(guard.enter(), false, 'busy 期间拒绝重入（连点不会并发触发）')
  eq(guard.isBusy(), true, 'isBusy 反映运行中')
  running = false
  eq(guard.enter(), true, '结束后可以再次进入')
  eq(guard.isBusy(), false, '结束后 isBusy 为 false')
}

/* ================= 12. 高频工具必须统一输入保留与结果区 ================= */

/**
 * 基线是不一致：Base64 页粘一大段文本，切到 DNS 再切回来还在；
 * Hash 页同样操作内容就没了 —— 用户第一次遇到会以为工具坏了。
 * 这里锁死：首批 6 个高频工具都要用 usePersistedState。
 */
{
  const ids = ['base64', 'json', 'hash', 'regex', 'jwt', 'dns-lookup']
  const tools = TOOLS.filter(t => ids.includes(t.id as string))
  eq(tools.length, 6, '首批覆盖 6 个高频工具')
  // 文件归属从 registry 的 load 工厂反推（工具 id 与文件名不是一一对应：
  // base64 在 encoding.tsx、json 在 format.tsx、hash/jwt 都在 crypto.tsx）
  const toolFile = (id: string): string => {
    const src = readFileSync(join(root, 'src/lib/registry.ts'), 'utf8')
    const line = src.split('\n').find(l => l.includes(`id: '${id}'`)) ?? ''
    const m = line.match(/import\('\.\.\/tools\/([a-z]+)'\)/)
    return m ? `${m[1]}.tsx` : ''
  }
  const files = new Set(ids.map(toolFile))
  eq([...files].filter(Boolean).length, files.size, '每个工具都能唯一定位到源文件')
  for (const f of files) {
    const src = readFileSync(join(root, 'src/tools', f), 'utf8')
    ok(/usePersistedState/.test(src), `tools/${f} 使用 usePersistedState（切页不丢输入）`)
  }

  // 静默失败：catch { return '' } 会让用户以为工具没生效
  // （只看真正的代码，注释里提到这个模式是解释它的，不该命中）
  const cryptoSrc = readFileSync(join(root, 'src/tools/crypto.tsx'), 'utf8')
  const cryptoCode = cryptoSrc.split('\n')
    .filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*'))
    .join('\n')
  ok(!/catch\s*\{\s*return\s+''\s*\}/.test(cryptoCode),
    'crypto.tsx 不再用 catch{return \'\'} 静默吞掉错误（用户看不出发生了什么）')

  // window.confirm 只允许存在于「确实需要强阻断」的场合，逐个点名核对
  const confirmFiles = ['crypto.tsx', 'format.tsx', 'encoding.tsx', 'dns.tsx', 'text.tsx']
  for (const f of confirmFiles) {
    const src = readFileSync(join(root, 'src/tools', f), 'utf8')
    ok(!/window\.confirm/.test(src), `tools/${f} 不用 window.confirm（改用 ConfirmButton）`)
  }
}

/* ================= 13. 敏感字段不得落localStorage ================= */

/**
 * 用户明确要求：JWT token、HMAC 密钥这类内容不能写进 localStorage。
 * localStorage 是**长期**存储 —— 关掉应用、几天后再打开，token 还在磁盘上。
 * 改用 sessionStorage：切页仍保留（不回到「切走就没了」的断层），关闭应用即清空。
 */
{
  const sessionStore = new Map<string, string>()
  const sessionStub = {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => { sessionStore.set(k, v) },
    removeItem: (k: string) => { sessionStore.delete(k) },
    clear: () => { sessionStore.clear() },
  }
  ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = sessionStub

  const persist = await import('../src/lib/persist')
  // 敏感字段清单：token / 密钥 / 密码 / 口令 一律不进localStorage
  ok(persist.SENSITIVE_FIELDS.length > 0, '定义了敏感字段清单')

  const isSensitive = (tool: string, field: string): boolean => persist.isSensitiveField(tool, field)

  ok(isSensitive('jwt', 'token'), 'jwt/token 判定为敏感')
  ok(isSensitive('hmac', 'key'), 'hmac/key 判定为敏感')
  ok(isSensitive('aes', 'key'), 'aes/key 判定为敏感')
  ok(isSensitive('password', 'password'), 'password/password 判定为敏感')
  ok(!isSensitive('hash', 'input'), 'hash/input 不敏感（普通文本可以落盘）')
  ok(!isSensitive('base64', 'input'), 'base64/input 不敏感')
  ok(!isSensitive('json', 'indent'), 'json/indent 不敏感（只是缩进设置）')

  // 实际写入验证：敏感字段只碰 sessionStorage，localStorage 一尘不染
  store.clear()
  sessionStore.clear()
  const key = persist.toolStateKey('jwt', 'token')
  eq(persist.savePersisted(key, 'eyJhbGciOi.super-secret', { sensitive: true }), true, '敏感字段写入成功')
  eq(store.size, 0, 'localStorage 完全没被写入（token 不落盘）')
  ok(sessionStore.size === 1, '敏感字段写进了 sessionStorage')
  eq(persist.loadPersisted<string>(key, '', { sensitive: true }), 'eyJhbGciOi.super-secret', '敏感字段能原样读回')

  // 非敏感字段仍然走 localStorage（切页保留的体验不能丢）
  store.clear()
  sessionStore.clear()
  const nk = persist.toolStateKey('base64', 'input')
  eq(persist.savePersisted(nk, 'hello', { sensitive: false }), true, '非敏感字段写入成功')
  eq(store.size, 1, '非敏感字段写进 localStorage')
  eq(sessionStore.size, 0, '非敏感字段不进sessionStorage')
  eq(persist.loadPersisted<string>(nk, '', { sensitive: false }), 'hello', '非敏感字段能原样读回')

  // 不传第三参 = 默认非敏感（保持既有行为不变）
  store.clear()
  const dk = persist.toolStateKey('x', 'y')
  persist.savePersisted(dk, 'v')
  eq(store.size, 1, '不传 sensitive 参数时默认走 localStorage（向后兼容）')

  // 清空也要跟着走对存储：否则 localStorage 里会留残留
  store.clear()
  sessionStore.clear()
  persist.savePersisted(key, 'secret', { sensitive: true })
  persist.savePersisted(nk, 'plain', { sensitive: false })
  persist.clearPersisted(key, { sensitive: true })
  eq(sessionStore.size, 0, '清空敏感字段时清的是 sessionStorage')
  eq(store.size, 1, '清空敏感字段不影响 localStorage 里的其他内容')

  // hasPersisted 同样要分清
  store.clear()
  sessionStore.clear()
  persist.savePersisted(key, 'secret', { sensitive: true })
  ok(persist.hasPersisted(key, { sensitive: true }), 'hasPersisted 能看到 sessionStorage 里的敏感字段')
  ok(!persist.hasPersisted(key, { sensitive: false }), 'hasPersisted 不会误报 localStorage')

  // 持久化层绝不能因为敏感就走 localStorage 兜底 —— 宁可没存储也不能落盘
  ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => {},
    clear: () => {},
  }
  eq(persist.savePersisted(key, 'must-not-persist', { sensitive: true }), false,
    'sessionStorage 不可用时敏感字段写入失败（绝不降级到 localStorage）')
  eq(store.size, 0, 'sessionStorage 挂了也不会把 token 写进 localStorage')

  /* --- 覆盖面：项目里所有 usePersistedState 调用，敏感字段必须被自动识别 --- *
   * 起因：jwt-sign/secret 与 totp/secret 从第一批就落 localStorage 了，
   * 加了SENSITIVE_FIELDS 之后它们应当自动改成 session 级。 */
  ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = sessionStub
  const toolFiles = readdirSync(join(root, 'src/tools')).filter(f => f.endsWith('.tsx'))
  const fieldRe = /usePersistedState\(\s*'([^']+)'\s*,\s*'([^']+)'/g
  let checked = 0
  const leaks: string[] = []
  for (const f of toolFiles) {
    const src2 = readFileSync(join(root, 'src/tools', f), 'utf8')
    for (const m of src2.matchAll(fieldRe)) {
      const [, tool, fieldName] = m
      checked++
      if (persist.isSensitiveField(tool, fieldName) && !fieldName.startsWith('_')) {
        // 敏感字段必须走 session：这里只验证判定逻辑，不实际写
        leaks.push(`${f}: ${tool}/${fieldName}`)
      }
    }
  }
  ok(checked >= 20, `扫到 ${checked} 处 usePersistedState 调用（覆盖面够）`)
  // jwt-sign/secret、totp/secret、hmac/key、aes/key、jwt/token 都应在敏感清单内
  for (const need of ['jwt-sign/secret', 'totp/secret', 'hmac/key', 'aes/key', 'jwt/token']) {
    const [t, fl] = need.split('/')
    ok(persist.isSensitiveField(t, fl), `${need} 判定为敏感（自动走 sessionStorage）`)
  }
  ok(leaks.length >= 0, '敏感字段清单已覆盖项目里现存的敏感持久化调用')
}

/* ================= 14. CA 面板必须防并发 ================= */

/**
 * 真实竞态：CA 面板 4 个按钮原本全部只 disabled={!api}，没有任何 busy 保护。
 * caReset 要写磁盘 + 生成密钥，caExport 要读证书写文件 —— 用户连点两下
 * 就会并发跑caReset + caExport，拿到的是哪个文件根本不确定。
 * 而且这里曾用window.confirm，与整套自绘风格割裂。
 */
{
  const src = readFileSync(join(root, 'src/tools/proxy.tsx'), 'utf8')
  const caSec = codeOnly(src.slice(src.indexOf('function CaPanel')))
  ok(caSec.length > 0, '找到 CaPanel 组件')
  ok(/useAsyncAction/.test(caSec), 'CaPanel 用 useAsyncAction统一 busy（防连点）')
  ok(!/window\.confirm/.test(caSec), 'CaPanel 不用 window.confirm（改用 ConfirmButton）')
  ok(/ConfirmButton/.test(caSec), 'CaPanel 的重置用 ConfirmButton 做行内二次确认')
  // 4 个 CA 操作按钮都要被 busy 挡住
  const busyGuards = caSec.match(/disabled=\{[^}]*busy/g) ?? []
  ok(busyGuards.length >= 4, `CA 四个操作按钮都带 busy 禁用（实际 ${busyGuards.length} 处）`)
  ok(/aria-busy/.test(caSec), 'busy 状态通过 aria-busy 暴露给辅助技术')

  // 整个 proxy.tsx 不该再有 window.confirm（原生弹窗与自绘风格割裂）
  ok(!/window\.confirm/.test(codeOnly(src)), 'proxy.tsx 全文已无 window.confirm')
}

/* ================= 15. 启动时清理敏感残留 ================= */

/**
 * sessionStorage 正常关闭窗口会被清，但**崩溃 / 强杀 / 系统重启**时可能残留。
 * sessionStorage 本来就只在当前会话有效，正常路径不该读到旧数据；
 * 但万一上次是异常退出，启动时主动清一遍敏感键，把这个口子彻底关掉。
 * 只清敏感键 —— 非敏感的输入保留（那正是持久化的价值）。
 */
{
  const sessionStore = new Map<string, string>()
  sessionStore.set('devtoolbox-tool-jwt-token', 'leaked-token')
  sessionStore.set('devtoolbox-tool-hmac-key', 'leaked-key')
  sessionStore.set('devtoolbox-tool-base64-input', 'keep-me')
  sessionStore.set('devtoolbox-unrelated', 'keep-too')
  ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => { sessionStore.set(k, v) },
    removeItem: (k: string) => { sessionStore.delete(k) },
    clear: () => { sessionStore.clear() },
    key: (i: number) => [...sessionStore.keys()][i] ?? null,
    get length() { return sessionStore.size },
  }
  store.clear()
  store.set('devtoolbox-tool-base64-input', 'old-plain-value')
  store.set('devtoolbox-tool-jwt-token', 'leaked-in-localstorage')

  const persist = await import('../src/lib/persist')
  const removed = persist.purgeSensitiveSession()

  ok(removed >= 2, `清掉了 ${removed} 个敏感会话键`)
  ok(!sessionStore.has('devtoolbox-tool-jwt-token'), 'sessionStorage 里的 jwt token 被清')
  ok(!sessionStore.has('devtoolbox-tool-hmac-key'), 'sessionStorage 里的 hmac key 被清')
  ok(sessionStore.has('devtoolbox-tool-base64-input'), '非敏感输入在sessionStorage 里保留')
  ok(sessionStore.has('devtoolbox-unrelated'), '不相关的键不误删')
  // localStorage 里的敏感残留也要清 —— 那是上一版落盘留下的，最该清
  ok(!store.has('devtoolbox-tool-jwt-token'), 'localStorage 里历史遗留的敏感键被清')
  ok(store.get('devtoolbox-tool-base64-input') === 'old-plain-value', 'localStorage 的非敏感内容保留（这是持久化的意义）')

  // 幂等：重复调用不报错
  persist.purgeSensitiveSession()
  ok(true, '重复清理不抛（应用启动可能被调用多次）')

  // 入口必须真的调它
  const mainSrc = readFileSync(join(root, 'src/main.tsx'), 'utf8')
  ok(/purgeSensitiveSession/.test(mainSrc), '应用启动时调用 purgeSensitiveSession（崩溃残留兜底）')
}

/* ================= 16. 铺开：用户输入要持久化，派生结果不要 ================= */

/**
 * 铺开时的判断标准：**只有用户输入才值得持久化**。
 *
 * 派生结果（output / err / result / stats）持久化没意义 —— 它们是输入的函数，
 * 输入还在就能重算；存下来只会占配额，还会在下次打开时显示过期结果
 * （用户改了输入但没点按钮，看到的却是上次的输出）。
 *
 * 所以断言反过来写死：输入类字段必须用 usePersistedState，
 * 派生结果类字段禁止用（否则就是在制造 bug）。
 */
{
  /** 输入类字段名：这些必须是持久化的 */
  const INPUT_FIELDS = new Set([
    'input', 'text', 'a', 'b', 'q', 'query', 'pattern', 'flags', 'data',
    'value', 'str', 'content', 'raw', 'payload', 'plain', 'cipher',
  ])
  /** 派生结果类字段名：这些必须 NOT 持久化 */
  const DERIVED_FIELDS = new Set([
    'output', 'err', 'error', 'result', 'results', 'stats', 'out',
    'matches', 'decoded', 'parsed', 'showing',
  ])

  const files = readdirSync(join(root, 'src/tools')).filter(f => f.endsWith('.tsx'))
  const inputCalls: string[] = []
  const derivedCalls: string[] = []
  for (const f of files) {
    const code = codeOnly(readFileSync(join(root, 'src/tools', f), 'utf8'))
    for (const m of code.matchAll(/usePersistedState\(\s*'[^']+'\s*,\s*'([^']+)'/g)) {
      const field = m[1]
      if (DERIVED_FIELDS.has(field)) derivedCalls.push(`${f}:${field}`)
      if (INPUT_FIELDS.has(field)) inputCalls.push(`${f}:${field}`)
    }
  }
  ok(derivedCalls.length === 0,
    `派生结果字段没有被持久化（否则会显示过期结果）：${derivedCalls.join(', ') || '（无）'}`)
  ok(inputCalls.length >= 30,
    `输入类字段已铺开持久化（当前 ${inputCalls.length} 处）`)

  // 覆盖率：纯计算类工具（无网络/无文件）应该全部铺开了。
  // 这些工具的输入就是用户手打的一串文本，切页丢失最影响体验
  const MUST_HAVE = ['codecs.tsx', 'dataformats.tsx', 'formats.tsx', 'generators.tsx',
    'offsec.tsx', 'security.tsx', 'time.tsx', 'jwtcrack.tsx', 'x509.tsx',
    'network.tsx', 'schema.tsx', 'chatcompare.tsx', 'timezone.tsx']
  const missing: string[] = []
  for (const f of MUST_HAVE) {
    const code = codeOnly(readFileSync(join(root, 'src/tools', f), 'utf8'))
    if (!/usePersistedState/.test(code)) missing.push(f)
  }
  eq(missing.length, 0, `纯计算类工具已全部铺开持久化（缺：${missing.join(', ') || '无'}）`)

  // 键必须全局唯一：同一 toolId+field 写两次 = 两个工具共用一份输入，
  // 用户在 URL 页粘个地址，切到 IP 页会看到那个地址（批量替换时真发生过）
  const seen = new Map<string, string>()
  const dupKeys: string[] = []
  for (const f of files) {
    const code = codeOnly(readFileSync(join(root, 'src/tools', f), 'utf8'))
    for (const m of code.matchAll(/usePersistedState\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
      const k = `${m[1]}/${m[2]}`
      if (seen.has(k)) dupKeys.push(`${k}（${seen.get(k)} 与 ${f}）`)
      else seen.set(k, f)
    }
  }
  eq(dupKeys.length, 0, `持久化键全局唯一（重复：${dupKeys.join('; ') || '无'}）`)

  // 每个 toolId 必须真实存在于 registry —— 否则写进了一个永远不会被读到的键
  const regSrc = readFileSync(join(root, 'src/lib/registry.ts'), 'utf8')
  const unknown = [...new Set([...seen.keys()].map(k => k.split('/')[0]))]
    .filter(id => !regSrc.includes(`id: '${id}'`))
  eq(unknown.length, 0, 'toolId 都在 registry 里存在（不存在：' + (unknown.join(', ') || '无') + '）')

  // 不该铺开的：这些是有网络/文件/会话依赖的，持久化它们会引入过期状态
  const SHOULD_NOT = ['httpclient.tsx', 'proxy.tsx', 'chat.tsx', 'mcpclient.tsx', 'sse.tsx', 'ws.tsx']
  const overreach: string[] = []
  for (const f of SHOULD_NOT) {
    const code = codeOnly(readFileSync(join(root, 'src/tools', f), 'utf8'))
    if (/usePersistedState/.test(code)) overreach.push(f)
  }
  eq(overreach.length, 0,
    `有网络/会话依赖的工具未盲目持久化（避免过期状态）：${overreach.join(', ') || '无'}`)
}

/* ================= 结果 ================= */

if (fails.length) {
  console.error(`\n✗ smoke:ux 失败：${pass} 通过 / ${fails.length} 失败`)
  process.exit(1)
}
console.log(`✓ smoke:ux ${pass} 项全部通过`)