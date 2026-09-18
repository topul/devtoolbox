/**
 * 仓库扫描器 —— 为「Agent 规则文件生成器」提供事实。
 *
 * 只做两件事：把目录树读出来、从配置文件里读出真实的命令与技术栈。
 * 不生成任何文案、不 import electron —— 因此这个模块既能在应用里跑，
 * 也能被 `npm run smoke:agentrules` 直接调用来验证。
 *
 * 安全边界：只读，不写不删；扫描有深度与条目上限，遇到大仓库会主动截断。
 */
import fs from 'node:fs'
import path from 'node:path'
import type {
  AgentScanFacts,
  AgentScanResult,
  AgentScanSpec,
  DetectedCommand,
  ProjectSignal,
} from '../../src/lib/agentrules-types'

/** 这些目录一律不进树，也不参与探测（内容量大且没有信息增量） */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'build', 'release', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache',
  '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'target', 'vendor', '.idea', '.vscode', '.vs', 'bin', 'obj', 'Pods', 'DerivedData',
  '.gradle', '.mvn', 'tmp', 'logs',
])

const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_ENTRIES = 4000

/** 依赖名 → 框架/运行时展示名（命中即收录，不区分大小写） */
const FRAMEWORK_HINTS: Record<string, string> = {
  react: 'React',
  'react-dom': 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  '@angular/core': 'Angular',
  next: 'Next.js',
  nuxt: 'Nuxt',
  electron: 'Electron',
  'electron-builder': 'Electron',
  vite: 'Vite',
  webpack: 'Webpack',
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  '@nestjs/core': 'NestJS',
  tailwindcss: 'Tailwind CSS',
  typescript: 'TypeScript',
  jest: 'Jest',
  vitest: 'Vitest',
  mocha: 'Mocha',
  playwright: 'Playwright',
  '@playwright/test': 'Playwright',
  cypress: 'Cypress',
  prisma: 'Prisma',
  typeorm: 'TypeORM',
  sequelize: 'Sequelize',
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  pandas: 'pandas',
  numpy: 'NumPy',
  pytest: 'pytest',
  torch: 'PyTorch',
  tensorflow: 'TensorFlow',
  pydantic: 'pydantic',
  'pydantic-ai': 'pydantic-ai',
  ortools: 'OR-Tools',
  scrapy: 'Scrapy',
}

/** 脚本名 → 命令分类（按关键片段匹配，顺序即优先级） */
const SCRIPT_KINDS: [RegExp, string][] = [
  [/^(install|setup|bootstrap)$/i, 'install'],
  [/^(dev|develop|serve|watch|preview|start:dev)/i, 'dev'],
  [/^(start|run)$/i, 'start'],
  [/^(build|compile|dist|bundle|package)/i, 'build'],
  [/^(test|spec|e2e|smoke)/i, 'test'],
  [/^(lint|eslint|check:lint)/i, 'lint'],
  [/^(typecheck|type-check|tsc|check:types|flow)/i, 'typecheck'],
  [/^(format|fmt|prettier|fix)/i, 'format'],
]

function classifyScript(name: string): string {
  for (const [re, kind] of SCRIPT_KINDS) {
    if (re.test(name)) return kind
  }
  return 'other'
}

interface TreeEntry {
  name: string
  dir: boolean
  children?: TreeEntry[]
}

interface Budget {
  entries: number
  truncated: boolean
  files: number
  dirs: number
}

/* ================= 入口 ================= */

export function scanProject(spec: AgentScanSpec): AgentScanResult {
  const root = path.resolve(spec.root || '')
  if (!spec.root || !spec.root.trim()) {
    return { ok: false, code: 'ROOT_EMPTY' }
  }

  let st: fs.Stats
  try {
    st = fs.statSync(root)
  } catch (e) {
    return { ok: false, code: 'ROOT_NOT_FOUND', detail: (e as Error).message }
  }
  if (!st.isDirectory()) return { ok: false, code: 'ROOT_NOT_DIR' }

  const maxDepth = Math.max(1, Math.min(spec.maxDepth ?? DEFAULT_MAX_DEPTH, 8))
  // 下限给 1：调用方显式要「只扫一点点」是合法的，界面会提示截断
  const maxEntries = Math.max(1, Math.min(spec.maxEntries ?? DEFAULT_MAX_ENTRIES, 20000))

  const budget: Budget = { entries: 0, truncated: false, files: 0, dirs: 0 }
  const tree = readTree(root, maxDepth, budget, maxEntries)

  const notes: string[] = []
  if (budget.truncated) notes.push('truncated')

  const probe = probeProject(root, tree)
  const facts: AgentScanFacts = {
    root,
    rootName: path.basename(root) || root,
    tree: renderTree(tree),
    stats: { files: budget.files, dirs: budget.dirs, truncated: budget.truncated },
    languages: probe.languages,
    frameworks: probe.frameworks,
    packageManager: probe.packageManager,
    commands: probe.commands,
    keyFiles: probe.keyFiles,
    signals: probe.signals,
    notes,
  }
  return { ok: true, facts }
}

/* ================= 目录树 ================= */

function readTree(dir: string, depth: number, budget: Budget, maxEntries: number): TreeEntry[] {
  if (depth < 0) return []
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }

  const dirs: TreeEntry[] = []
  const files: TreeEntry[] = []

  for (const name of names) {
    if (name.startsWith('.')) continue
    if (budget.entries >= maxEntries) {
      budget.truncated = true
      break
    }
    const full = path.join(dir, name)
    let isDir = false
    try {
      isDir = fs.statSync(full).isDirectory()
    } catch {
      continue
    }
    budget.entries++
    if (isDir) {
      if (IGNORED_DIRS.has(name)) continue
      budget.dirs++
      const children = depth > 0 ? readTree(full, depth - 1, budget, maxEntries) : undefined
      dirs.push({ name, dir: true, children })
    } else {
      budget.files++
      files.push({ name, dir: false })
    }
  }

  const byName = (a: TreeEntry, b: TreeEntry): number => a.name.localeCompare(b.name)
  return [...dirs.sort(byName), ...files.sort(byName)]
}

function renderTree(entries: TreeEntry[], prefix = ''): string {
  const lines: string[] = []
  entries.forEach((e, i) => {
    const last = i === entries.length - 1
    lines.push(`${prefix}${last ? '└── ' : '├── '}${e.name}${e.dir ? '/' : ''}`)
    if (e.children?.length) {
      lines.push(...renderTree(e.children, `${prefix}${last ? '    ' : '│   '}`).split('\n'))
    } else if (e.dir && e.children === undefined && depthIsCapped(e)) {
      lines.push(`${prefix}${last ? '    ' : '│   '}└── …`)
    }
  })
  return lines.join('\n')
}

/** 目录存在但没展开（被深度截断），补一个省略标记，避免看起来像空目录 */
function depthIsCapped(e: TreeEntry): boolean {
  return e.dir && e.children === undefined
}

/* ================= 项目探测 ================= */

interface ProbeResult {
  languages: string[]
  frameworks: string[]
  packageManager: string | null
  commands: DetectedCommand[]
  keyFiles: string[]
  signals: ProjectSignal[]
}

function probeProject(root: string, tree: TreeEntry[]): ProbeResult {
  const exists = (rel: string): boolean => fs.existsSync(path.join(root, rel))
  const readJson = (rel: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const readText = (rel: string, limit = 200_000): string | null => {
    try {
      return fs.readFileSync(path.join(root, rel), 'utf8').slice(0, limit)
    } catch {
      return null
    }
  }

  const signals = new Set<ProjectSignal>()
  const keyFiles: string[] = []
  const languages: string[] = []
  const frameworks = new Set<string>()
  const commands: DetectedCommand[] = []
  let packageManager: string | null = null

  const mark = (rel: string): void => {
    if (exists(rel) && !keyFiles.includes(rel)) keyFiles.push(rel)
  }

  /* ---- Node / 前端 ---- */
  const pkg = readJson('package.json')
  const pkgObj = pkg as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; packageManager?: string; workspaces?: unknown } | null
  if (pkgObj) {
    mark('package.json')
    const allDeps = { ...(pkgObj.dependencies ?? {}), ...(pkgObj.devDependencies ?? {}) }
    for (const dep of Object.keys(allDeps)) {
      const hit = FRAMEWORK_HINTS[dep.toLowerCase()]
      if (hit) frameworks.add(hit)
    }
    for (const [name, cmd] of Object.entries(pkgObj.scripts ?? {})) {
      if (typeof cmd !== 'string') continue
      commands.push({ kind: classifyScript(name), name, command: `npm run ${name}`, source: 'package.json' })
    }
    if (typeof pkgObj.packageManager === 'string') {
      packageManager = pkgObj.packageManager.split('@')[0]
    }
    if (pkgObj.workspaces) signals.add('hasMonorepo')
  }

  if (exists('tsconfig.json') || exists('tsconfig.node.json')) {
    languages.push('TypeScript')
    signals.add('hasTsconfig')
    frameworks.add('TypeScript')
    mark('tsconfig.json')
  } else if (pkgObj) {
    languages.push('JavaScript')
  }

  if (exists('pnpm-lock.yaml')) {
    packageManager = 'pnpm'
    signals.add('hasLockfile')
    mark('pnpm-lock.yaml')
  } else if (exists('yarn.lock')) {
    packageManager = packageManager ?? 'yarn'
    signals.add('hasLockfile')
    mark('yarn.lock')
  } else if (exists('package-lock.json')) {
    packageManager = packageManager ?? 'npm'
    signals.add('hasLockfile')
    mark('package-lock.json')
  } else if (exists('bun.lockb')) {
    packageManager = 'bun'
    signals.add('hasLockfile')
    mark('bun.lockb')
  }
  if (packageManager === null && pkgObj) packageManager = 'npm'

  if (exists('pnpm-workspace.yaml')) {
    signals.add('hasMonorepo')
    mark('pnpm-workspace.yaml')
  }
  if (exists('lerna.json')) {
    signals.add('hasMonorepo')
    mark('lerna.json')
  }
  if (tree.some((e) => e.dir && (e.name === 'packages' || e.name === 'apps'))) signals.add('hasMonorepo')

  /* ---- Python ---- */
  if (exists('pyproject.toml')) {
    languages.push('Python')
    mark('pyproject.toml')
    const body = readText('pyproject.toml') ?? ''
    if (body.includes('[tool.poetry]')) packageManager = packageManager ?? 'poetry'
    else if (body.includes('[tool.uv]')) packageManager = packageManager ?? 'uv'
    else if (body.includes('[build-system]')) packageManager = packageManager ?? 'pip'
    if (body.includes('[tool.pytest')) {
      frameworks.add('pytest')
      signals.add('hasTests')
    }
    for (const [dep, label] of Object.entries(FRAMEWORK_HINTS)) {
      if (new RegExp(`(^|[^a-z0-9-])${dep}([^a-z0-9-]|$)`, 'i').test(body)) frameworks.add(label)
    }
  }
  if (exists('requirements.txt')) {
    if (!languages.includes('Python')) languages.push('Python')
    packageManager = packageManager ?? 'pip'
    mark('requirements.txt')
    const body = readText('requirements.txt') ?? ''
    for (const [dep, label] of Object.entries(FRAMEWORK_HINTS)) {
      if (new RegExp(`^${dep}([=<>!~\\[]|$)`, 'im').test(body)) frameworks.add(label)
    }
  }
  if (exists('poetry.lock')) {
    packageManager = 'poetry'
    signals.add('hasLockfile')
    mark('poetry.lock')
  }
  if (exists('uv.lock')) {
    packageManager = 'uv'
    signals.add('hasLockfile')
    mark('uv.lock')
  }
  if (exists('Pipfile')) packageManager = packageManager ?? 'pipenv'
  if (exists('setup.py') || exists('setup.cfg')) mark('setup.py')

  /* ---- 其它语言 ---- */
  if (exists('go.mod')) {
    languages.push('Go')
    mark('go.mod')
    packageManager = packageManager ?? 'go modules'
  }
  if (exists('Cargo.toml')) {
    languages.push('Rust')
    mark('Cargo.toml')
    packageManager = packageManager ?? 'cargo'
  }
  if (exists('pom.xml')) {
    languages.push('Java')
    mark('pom.xml')
    packageManager = packageManager ?? 'maven'
  }
  if (exists('build.gradle') || exists('build.gradle.kts')) {
    if (!languages.includes('Java')) languages.push('Java')
    packageManager = packageManager ?? 'gradle'
    mark('build.gradle')
  }
  if (exists('Gemfile')) {
    languages.push('Ruby')
    mark('Gemfile')
  }
  if (exists('composer.json')) {
    languages.push('PHP')
    mark('composer.json')
    packageManager = packageManager ?? 'composer'
  }

  /* ---- Makefile 目标 ---- */
  if (exists('Makefile')) {
    mark('Makefile')
    const body = readText('Makefile') ?? ''
    const seen = new Set<string>()
    for (const line of body.split('\n')) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?!=)/)
      if (!m) continue
      const name = m[1]
      if (seen.has(name) || name === 'all') continue
      seen.add(name)
      commands.push({ kind: classifyScript(name), name, command: `make ${name}`, source: 'Makefile' })
    }
  }

  /* ---- 工程化配置 ---- */
  if (exists('Dockerfile') || exists('docker-compose.yml') || exists('docker-compose.yaml') || exists('compose.yml')) {
    signals.add('hasDocker')
  }
  if (exists('.github/workflows')) {
    signals.add('hasGithubActions')
    signals.add('hasCi')
  }
  if (exists('.gitlab-ci.yml')) {
    signals.add('hasGitlabCi')
    signals.add('hasCi')
  }
  if (exists('.editorconfig')) signals.add('hasEditorconfig')
  if (
    exists('.eslintrc') || exists('.eslintrc.json') || exists('.eslintrc.js') || exists('.eslintrc.cjs') ||
    exists('eslint.config.js') || exists('eslint.config.mjs') || exists('ruff.toml') ||
    (readText('pyproject.toml') ?? '').includes('[tool.ruff]')
  ) {
    signals.add('hasLinter')
  }
  if (
    exists('.prettierrc') || exists('.prettierrc.json') || exists('.prettierrc.js') ||
    exists('prettier.config.js') || exists('.prettierrc.yaml') || exists('biome.json')
  ) {
    signals.add('hasFormatter')
  }
  if (exists('.env.example') || exists('.env.sample') || exists('.env.template')) {
    signals.add('hasEnvExample')
    mark('.env.example')
  }

  // 测试目录 / 测试文件
  const hasTestDir = tree.some((e) => e.dir && ['test', 'tests', '__tests__', 'spec', 'e2e'].includes(e.name))
  if (hasTestDir) signals.add('hasTests')
  if (!signals.has('hasTests')) {
    const probeNested = (entries: TreeEntry[]): boolean =>
      entries.some((e) =>
        e.dir ? (e.children ? probeNested(e.children) : false) : /(\.test\.|\.spec\.|_test\.)/.test(e.name),
      )
    if (probeNested(tree)) signals.add('hasTests')
  }

  mark('README.md')
  if (exists('README.md')) signals.add('hasReadme')
  if (exists('LICENSE')) signals.add('hasLicense')
  if (exists('CHANGELOG.md')) signals.add('hasChangelog')

  /* ---- 补上包管理器自带的安装命令 ---- */
  const installCommand: Record<string, string> = {
    npm: 'npm install',
    pnpm: 'pnpm install',
    yarn: 'yarn',
    bun: 'bun install',
    poetry: 'poetry install',
    uv: 'uv sync',
    pip: 'pip install -r requirements.txt',
    pipenv: 'pipenv install',
    'go modules': 'go mod download',
    cargo: 'cargo build',
    maven: 'mvn install',
    gradle: './gradlew build',
    composer: 'composer install',
  }
  if (packageManager && installCommand[packageManager]) {
    commands.unshift({
      kind: 'install',
      name: packageManager,
      command: installCommand[packageManager],
      source: packageManager,
    })
  } else if (pkgObj) {
    commands.unshift({ kind: 'install', name: 'npm', command: 'npm install', source: 'package.json' })
  }

  // 命令去重（同名同命令只留一条）
  const seenCmd = new Set<string>()
  const uniqueCommands = commands.filter((c) => {
    const k = `${c.command}`
    if (seenCmd.has(k)) return false
    seenCmd.add(k)
    return true
  })

  return {
    languages: [...new Set(languages)],
    frameworks: [...frameworks],
    packageManager,
    commands: uniqueCommands,
    keyFiles,
    signals: [...signals],
  }
}
