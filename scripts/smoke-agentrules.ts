/**
 * Agent 规则文件生成器的断言。
 *
 * 用一个临时构造的真实小项目当输入（含 package.json / Makefile / CI / Dockerfile /
 * 该被忽略的 node_modules），把「扫到了什么」和「生成成什么样」逐条钉住。
 *
 * 运行：npm run smoke:agentrules
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanProject } from '../electron/main/agentrules'
import { createAgentRulesController } from '../electron/main/agentrules-ipc'
import { generateRules, type RulesStrings } from '../src/lib/toolkit/agentrules'
import type { AgentScanFacts } from '../src/lib/agentrules-types'

let passed = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}
function includes(name: string, hay: string, needle: string): void {
  ok(name, hay.includes(needle), `输出里没有 ${JSON.stringify(needle)}`)
}
function notIncludes(name: string, hay: string, needle: string): void {
  ok(name, !hay.includes(needle), `输出里不该有 ${JSON.stringify(needle)}`)
}

/* ================= 词条桩（真实文案在界面词条里，这里只要结构一致） ================= */

const S: RulesStrings = {
  title: (n) => `# 项目 ${n} 的协作约定`,
  intro: '这是一份草稿。',
  overview: '概览',
  commandsTitle: '常用命令',
  structureTitle: '目录结构',
  conventionsTitle: '项目约定',
  filesTitle: '关键文件',
  treeNote: '目录树已省略依赖与构建产物。',
  noneLabel: '未识别',
  thKind: '用途',
  thCommand: '命令',
  thSource: '出处',
  commandKinds: {
    install: '安装', dev: '开发', start: '启动', build: '构建', test: '测试',
    lint: '静态检查', typecheck: '类型检查', format: '格式化', other: '其它',
  },
  signals: {
    hasCi: '提交前先看 CI 的结论，别让流水线红着过夜。',
    hasGithubActions: 'CI 跑在 GitHub Actions 上。',
    hasGitlabCi: 'CI 跑在 GitLab CI 上。',
    hasDocker: '有容器化配置，改依赖时留意镜像。',
    hasLockfile: '锁文件已提交，加依赖请用包管理器而不是手改。',
    hasEditorconfig: '有 .editorconfig，缩进与换行按它来。',
    hasLinter: '有静态检查配置，提交前跑一次。',
    hasFormatter: '有格式化配置，别手动调格式。',
    hasTests: '有测试，改完先跑测试再改别的。',
    hasTsconfig: '有 tsconfig，类型报错按配置处理，别用 any 绕过。',
    hasMonorepo: '这是多包仓库，改动前确认影响到了哪个包。',
    hasEnvExample: '环境变量参考 .env.example，不要提交真实值。',
    hasReadme: 'README 里有上手说明。',
    hasLicense: '有许可证文件。',
    hasChangelog: '有变更日志，重要改动记得补一条。',
  },
  notes: { truncated: '目录过大，已截断。' },
  langLabel: '语言',
  frameworkLabel: '框架',
  pkgLabel: '包管理',
  cursorIntro: '下面这个项目的事实，请照它来。',
  claudeIntro: '回答项目相关问题时，先看这份事实。',
  footer: '（本文件由扫描生成，请人工过一遍再提交。）',
}

/* ================= 构造临时项目 ================= */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtb-agentrules-'))
const project = path.join(tmpRoot, 'demo-app')

function write(rel: string, content: string): void {
  const full = path.join(project, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
}

write(
  'package.json',
  JSON.stringify(
    {
      name: 'demo-app',
      version: '1.0.0',
      packageManager: 'pnpm@9.0.0',
      scripts: {
        dev: 'vite',
        preview: 'vite preview',
        build: 'vite build',
        test: 'vitest run',
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        'smoke:api': 'node scripts/smoke-api.mjs',
        'package:win': 'electron-builder --win',
        deploy: './deploy.sh',
      },
      dependencies: { react: '^18.0.0', express: '^4.19.0' },
      devDependencies: { typescript: '^5.5.0', vite: '^6.0.0', vitest: '^2.0.0', electron: '^33.0.0' },
    },
    null,
    2,
  ),
)
write('tsconfig.json', '{"compilerOptions":{"strict":true}}')
write('pnpm-lock.yaml', 'lockfileVersion: 9\n')
write('README.md', '# demo-app\n')
write('Makefile', 'build:\n\tnpm run build\n\ntest:\n\tnpm run test\n\ndeploy:\n\t./deploy.sh\n\nall: build test\n')
write('Dockerfile', 'FROM node:22\n')
write('.github/workflows/ci.yml', 'name: CI\non: [push]\n')
write('src/index.ts', 'export const a = 1\n')
write('src/tools/a.tsx', 'export const A = () => null\n')
write('tests/a.test.ts', 'test("a", () => {})\n')
write('node_modules/left-pad/index.js', 'module.exports = 1\n')
write('dist/bundle.js', 'console.log(1)\n')
write('.git/HEAD', 'ref: refs/heads/main\n')

/* ================= 扫描 ================= */

const res = scanProject({ root: project })
eq('扫描成功', res.ok, true)
if (!res.ok) {
  console.error(`  → 扫描失败：${res.code} ${res.detail ?? ''}`)
  process.exit(1)
}
const facts: AgentScanFacts = res.facts

eq('项目名取自目录名', facts.rootName, 'demo-app')
ok('识别出 TypeScript', facts.languages.includes('TypeScript'), JSON.stringify(facts.languages))
eq('包管理器识别为 pnpm（lockfile + packageManager 字段）', facts.packageManager, 'pnpm')

for (const fw of ['React', 'Electron', 'Vite', 'Express', 'Vitest']) {
  ok(`框架识别到 ${fw}`, facts.frameworks.includes(fw), JSON.stringify(facts.frameworks))
}

const cmdNames = facts.commands.map((c) => c.name)
ok('带上了包管理器安装命令', facts.commands.some((c) => c.kind === 'install' && c.command === 'pnpm install'), JSON.stringify(facts.commands.slice(0, 3)))
ok('读到了 dev 脚本', facts.commands.some((c) => c.command === 'npm run dev'))
  ok('preview 归入开发', facts.commands.some((c) => c.name === 'preview' && c.kind === 'dev'))
  ok('package:win 归入构建', facts.commands.some((c) => c.name === 'package:win' && c.kind === 'build'))
  ok('compile 类脚本归入构建', facts.commands.some((c) => c.command === 'npm run build' && c.kind === 'build'))
ok('读到了 smoke 脚本并归类为测试', facts.commands.some((c) => c.name === 'smoke:api' && c.kind === 'test'))
ok('typecheck 被单独归类', facts.commands.some((c) => c.name === 'typecheck' && c.kind === 'typecheck'))
ok('Makefile 目标被读出来', facts.commands.some((c) => c.source === 'Makefile' && c.command === 'make deploy'))
ok('Makefile 的 all 目标被跳过', !facts.commands.some((c) => c.command === 'make all'))
ok('命令已去重', new Set(facts.commands.map((c) => c.command)).size === facts.commands.length)

for (const sig of ['hasCi', 'hasGithubActions', 'hasDocker', 'hasLockfile', 'hasTests', 'hasTsconfig', 'hasReadme'] as const) {
  ok(`命中特征 ${sig}`, facts.signals.includes(sig), JSON.stringify(facts.signals))
}
ok('没有 CI 就不该有 hasGitlabCi', !facts.signals.includes('hasGitlabCi'))

ok('目录树不包含 node_modules', !facts.tree.includes('node_modules'))
ok('目录树不包含 .git', !facts.tree.includes('.git'))
ok('目录树不包含 dist', !facts.tree.includes('dist'))
includes('目录树包含源码目录', facts.tree, 'src/')
includes('目录树包含具体文件', facts.tree, 'index.ts')
ok('统计到了文件与目录', facts.stats.files > 3 && facts.stats.dirs >= 3, JSON.stringify(facts.stats))
ok('未被截断', facts.stats.truncated === false)
includes('关键文件列出 README', facts.keyFiles.join(','), 'README.md')

/* ================= 深度与截断 ================= */

{
  const shallow = scanProject({ root: project, maxDepth: 1 })
  ok('浅扫描成功', shallow.ok)
  if (shallow.ok) {
    includes('maxDepth=1 时不展开更深一层', shallow.facts.tree, 'src/')
    notIncludes('maxDepth=1 时看不到 src 下的文件', shallow.facts.tree, 'a.tsx')
  }
}

{
  const capped = scanProject({ root: project, maxEntries: 200 })
  ok('小上限扫描成功', capped.ok)
  if (capped.ok) {
    // 这个项目太小，200 条装得下；用极小上限再试一次
    const tiny = scanProject({ root: project, maxEntries: 5 })
    ok('极小上限会触发截断标记', tiny.ok && tiny.facts.stats.truncated === true, tiny.ok ? JSON.stringify(tiny.facts.stats) : '')
    ok('截断会写进 notes', tiny.ok && tiny.facts.notes.includes('truncated'))
  }
}

/* ================= 错误分支 ================= */

{
  const miss = scanProject({ root: path.join(tmpRoot, 'nope') })
  eq('不存在的目录报 ROOT_NOT_FOUND', miss.ok === false ? miss.code : 'ok', 'ROOT_NOT_FOUND')

  const fileAsRoot = scanProject({ root: path.join(project, 'package.json') })
  eq('把文件当根目录报 ROOT_NOT_DIR', fileAsRoot.ok === false ? fileAsRoot.code : 'ok', 'ROOT_NOT_DIR')

  const empty = scanProject({ root: '   ' })
  eq('空路径报 ROOT_EMPTY', empty.ok === false ? empty.code : 'ok', 'ROOT_EMPTY')
}

/* ================= 生成三种形态 ================= */

const agents = generateRules(facts, 'agents', S)
includes('AGENTS.md 有标题', agents, '# 项目 demo-app 的协作约定')
includes('AGENTS.md 有概览', agents, '## 概览')
includes('AGENTS.md 有命令表格', agents, '| 用途 | 命令 | 出处 |')
includes('AGENTS.md 表格里是真实命令', agents, '`npm run dev`')
includes('AGENTS.md 标出命令出处', agents, '| package.json |')
includes('AGENTS.md 有目录树代码块', agents, '```')
includes('AGENTS.md 有 src/ 结构', agents, 'src/')
includes('AGENTS.md 有约定条目', agents, '提交前先看 CI 的结论')
includes('AGENTS.md 有关键文件', agents, '`README.md`')
includes('AGENTS.md 有草稿提示', agents, '由扫描生成')
notIncludes('AGENTS.md 不含被忽略的目录', agents, 'node_modules')

const claude = generateRules(facts, 'claude', S)
includes('CLAUDE.md 用命令代码块而非表格', claude, '开发: npm run dev')
notIncludes('CLAUDE.md 不用 Markdown 表格', claude, '| --- |')
includes('CLAUDE.md 有引言', claude, '先看这份事实')

const cursor = generateRules(facts, 'cursor', S)
notIncludes('.cursorrules 不含 Markdown 表格', cursor, '| --- |')
notIncludes('.cursorrules 不含分级标题', cursor, '## ')
includes('.cursorrules 用指令式列表', cursor, '  - 开发: npm run dev')
includes('.cursorrules 保留了目录树', cursor, '  ├── ')
includes('.cursorrules 保留约定', cursor, '提交前先看 CI 的结论')

ok('三种形态都非空且以换行结尾', [agents, claude, cursor].every((x) => x.length > 100 && x.endsWith('\n')))

/* ================= 一致性：三种形态都源自同一份事实 ================= */

for (const [label, text] of [['AGENTS.md', agents], ['CLAUDE.md', claude], ['.cursorrules', cursor]] as const) {
  includes(`${label} 含安装命令`, text, 'pnpm install')
  includes(`${label} 含 Makefile 命令`, text, 'make deploy')
}

/* ================= 宿主编排层（选目录 / 写文件 / 文件名拼接） ================= */

const written: { path: string; content: string }[] = []
let writeShouldFail = false

const ctl = createAgentRulesController({
  defaultRoot: () => '/home/tester',
  pickDirectory: async (title) => (title === undefined ? 'NO_TITLE' : project),
  writeFile: async (fullPath, content) => {
    if (writeShouldFail) return { ok: false, error: 'EACCES: permission denied' }
    written.push({ path: fullPath, content })
    return { ok: true }
  },
})

eq('默认根目录来自宿主', ctl.defaultRoot(), '/home/tester')
eq('选目录转交宿主', await ctl.pick(), 'NO_TITLE')
eq('选目录把标题透传下去', await ctl.pick('挑个项目'), project)
eq('scan 参数缺失时报 ROOT_EMPTY', ctl.scan(undefined as never).ok, false)

{
  const saved = await ctl.save(project, 'agents', '# hi\n')
  eq('保存成功', saved.ok, true)
  eq('落盘路径按根目录 + 白名单文件名拼', written[0]?.path, path.join(project, 'AGENTS.md'))
  eq('内容原样写出', written[0]?.content, '# hi\n')

  await ctl.save(project, 'cursor', 'x\n')
  eq('.cursorrules 文件名正确', written[1]?.path, path.join(project, '.cursorrules'))
  await ctl.save(project, 'claude', 'y\n')
  eq('CLAUDE.md 文件名正确', written[2]?.path, path.join(project, 'CLAUDE.md'))

  const badTarget = await ctl.save(project, '../evil' as never, 'boom')
  eq('非法目标被拒绝', badTarget.ok === false ? badTarget.code : 'ok', 'TARGET_INVALID')
  eq('非法目标没有写盘', written.length, 3)

  const emptyRoot = await ctl.save('  ', 'agents', 'x')
  eq('空根目录被拒绝', emptyRoot.ok === false ? emptyRoot.code : 'ok', 'ROOT_EMPTY')

  const emptyContent = await ctl.save(project, 'agents', '   ')
  eq('空内容被拒绝', emptyContent.ok === false ? emptyContent.code : 'ok', 'CONTENT_EMPTY')
  eq('空内容没有写盘', written.length, 3)

  writeShouldFail = true
  const failed = await ctl.save(project, 'agents', 'z')
  eq('写盘失败原样上报', failed.ok === false ? failed.code : 'ok', 'WRITE_FAILED')
  eq('写盘失败带上原因', failed.ok === false ? failed.detail : '', 'EACCES: permission denied')
  writeShouldFail = false
}

/* ================= 收尾 ================= */

fs.rmSync(tmpRoot, { recursive: true, force: true })

console.log('')
if (failures.length) {
  console.error(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`✓ Agent 规则文件生成器：${passed} 项断言全部通过`)
