/**
 * 浏览器版仓库扫描器 —— AgentRulesAPI 契约的 File System Access 实现。
 *
 * 探测逻辑（信号 / 命令分类 / 框架表）逐条对齐 electron/main/agentrules.ts，
 * 差异只在「怎么拿到文件」：桌面版走 fs，浏览器版走目录句柄。
 * 安全边界同样只读；写规则文件走句柄的可写流（用户授权过的那个目录）。
 *
 * 已知差异：浏览器没有绝对路径 —— root 是用户选中的目录名，UI 展示时按目录名理解。
 */
import type {
  AgentRulesSaveResult,
  AgentScanResult,
  AgentScanSpec,
  AgentScanFacts,
  DetectedCommand,
  ProjectSignal,
  RulesTarget,
} from '../agentrules-types'
import { RULES_FILENAMES } from '../agentrules-types'

/* ---- 与桌面版同款的纯表（改动需两侧同步） ---- */

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'build', 'release', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache',
  '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'target', 'vendor', '.idea', '.vscode', '.vs', 'bin', 'obj', 'Pods', 'DerivedData',
  '.gradle', '.mvn', 'tmp', 'logs',
])

const DEFAULT_MAX_DEPTH = 3
const DEFAULT_MAX_ENTRIES = 4000

const FRAMEWORK_HINTS: Record<string, string> = {
  react: 'React', 'react-dom': 'React', vue: 'Vue', svelte: 'Svelte', '@angular/core': 'Angular',
  next: 'Next.js', nuxt: 'Nuxt', electron: 'Electron', 'electron-builder': 'Electron',
  vite: 'Vite', webpack: 'Webpack', express: 'Express', fastify: 'Fastify', koa: 'Koa',
  '@nestjs/core': 'NestJS', tailwindcss: 'Tailwind CSS', typescript: 'TypeScript',
  jest: 'Jest', vitest: 'Vitest', mocha: 'Mocha', playwright: 'Playwright', '@playwright/test': 'Playwright',
  cypress: 'Cypress', prisma: 'Prisma', typeorm: 'TypeORM', sequelize: 'Sequelize',
  django: 'Django', flask: 'Flask', fastapi: 'FastAPI', pandas: 'pandas', numpy: 'NumPy',
  pytest: 'pytest', torch: 'PyTorch', tensorflow: 'TensorFlow', pydantic: 'pydantic',
  'pydantic-ai': 'pydantic-ai', ortools: 'OR-Tools', scrapy: 'Scrapy',
}

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

/* ---- 目录句柄存取 ---- */

// 全部用 any 引 FileSystemDirectoryHandle：lib.dom 在不同 TS 版本下该类型完备度不一
type DirHandle = any

const handles = new Map<string, DirHandle>()

async function pickDirectory(): Promise<DirHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<DirHandle> }).showDirectoryPicker
  if (!picker) return null // Firefox / Safari：没有 File System Access API
  try {
    return await picker({ mode: 'readwrite' })
  } catch {
    return null // 用户取消
  }
}

async function ensurePermission(h: DirHandle, write = false): Promise<boolean> {
  const opts = { mode: write ? 'readwrite' : 'read' }
  if ((await h.queryPermission(opts)) === 'granted') return true
  return (await h.requestPermission(opts)) === 'granted'
}

async function readText(h: DirHandle, name: string, limit = 200_000): Promise<string | null> {
  try {
    const fh = await h.getFileHandle(name)
    const file = await fh.getFile()
    if (file.size > 5 * 1024 * 1024) return null
    return (await file.text()).slice(0, limit)
  } catch {
    return null
  }
}

/* ---- 目录树 ---- */

async function readTree(dir: DirHandle, depth: number, budget: Budget, maxEntries: number): Promise<TreeEntry[]> {
  if (depth < 0) return []
  const dirs: TreeEntry[] = []
  const files: TreeEntry[] = []
  try {
    // entries() 是异步迭代器
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.')) continue
      if (budget.entries >= maxEntries) {
        budget.truncated = true
        break
      }
      budget.entries++
      if (handle.kind === 'directory') {
        if (IGNORED_DIRS.has(name)) continue
        budget.dirs++
        const children = depth > 0 ? await readTree(handle, depth - 1, budget, maxEntries) : undefined
        dirs.push({ name, dir: true, children })
      } else {
        budget.files++
        files.push({ name, dir: false })
      }
    }
  } catch {
    /* 无权限的子目录跳过 */
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
    } else if (e.dir && e.children === undefined) {
      lines.push(`${prefix}${last ? '    ' : '│   '}└── …`)
    }
  })
  return lines.join('\n')
}

/* ---- 项目探测（对齐桌面版 probeProject，数据源从 fs 换成句柄） ---- */

interface ProbeResult {
  languages: string[]
  frameworks: string[]
  packageManager: string | null
  commands: DetectedCommand[]
  keyFiles: string[]
  signals: ProjectSignal[]
}

async function probeProject(root: DirHandle, tree: TreeEntry[]): Promise<ProbeResult> {
  const exists = async (rel: string): Promise<boolean> => {
    try {
      // 一级路径（如 .github/workflows）按目录或文件都算存在
      const parts = rel.split('/')
      let h = root
      for (let i = 0; i < parts.length; i++) {
        h = i === parts.length - 1
          ? await h.getFileHandle(parts[i]).catch(() => h.getDirectoryHandle(parts[i]))
          : await h.getDirectoryHandle(parts[i])
      }
      return !!h
    } catch {
      return false
    }
  }

  const signals = new Set<ProjectSignal>()
  const keyFiles: string[] = []
  const languages: string[] = []
  const frameworks = new Set<string>()
  const commands: DetectedCommand[] = []
  let packageManager: string | null = null

  const mark = (rel: string): void => {
    // mark 只管「存在即列入关键文件」，存在性由调用方保证
    if (!keyFiles.includes(rel)) keyFiles.push(rel)
  }

  /* ---- Node / 前端 ---- */
  const pkgBody = await readText(root, 'package.json')
  const pkgObj = (() => {
    if (pkgBody == null) return null
    try {
      return JSON.parse(pkgBody) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; packageManager?: string; workspaces?: unknown }
    } catch {
      return null
    }
  })()
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
    if (typeof pkgObj.packageManager === 'string') packageManager = pkgObj.packageManager.split('@')[0]
    if (pkgObj.workspaces) signals.add('hasMonorepo')
  }

  if (await exists('tsconfig.json')) {
    languages.push('TypeScript')
    signals.add('hasTsconfig')
    frameworks.add('TypeScript')
    mark('tsconfig.json')
  } else if (pkgObj) {
    languages.push('JavaScript')
  }

  if (await exists('pnpm-lock.yaml')) {
    packageManager = 'pnpm'
    signals.add('hasLockfile')
    mark('pnpm-lock.yaml')
  } else if (await exists('yarn.lock')) {
    packageManager = packageManager ?? 'yarn'
    signals.add('hasLockfile')
    mark('yarn.lock')
  } else if (await exists('package-lock.json')) {
    packageManager = packageManager ?? 'npm'
    signals.add('hasLockfile')
    mark('package-lock.json')
  } else if (await exists('bun.lockb')) {
    packageManager = 'bun'
    signals.add('hasLockfile')
    mark('bun.lockb')
  }
  if (packageManager === null && pkgObj) packageManager = 'npm'

  if (await exists('pnpm-workspace.yaml')) {
    signals.add('hasMonorepo')
    mark('pnpm-workspace.yaml')
  }
  if (await exists('lerna.json')) {
    signals.add('hasMonorepo')
    mark('lerna.json')
  }
  if (tree.some((e) => e.dir && (e.name === 'packages' || e.name === 'apps'))) signals.add('hasMonorepo')

  /* ---- Python ---- */
  const pyproject = await readText(root, 'pyproject.toml')
  if (pyproject != null) {
    languages.push('Python')
    mark('pyproject.toml')
    if (pyproject.includes('[tool.poetry]')) packageManager = packageManager ?? 'poetry'
    else if (pyproject.includes('[tool.uv]')) packageManager = packageManager ?? 'uv'
    else if (pyproject.includes('[build-system]')) packageManager = packageManager ?? 'pip'
    if (pyproject.includes('[tool.pytest')) {
      frameworks.add('pytest')
      signals.add('hasTests')
    }
    for (const [dep, label] of Object.entries(FRAMEWORK_HINTS)) {
      if (new RegExp(`(^|[^a-z0-9-])${dep}([^a-z0-9-]|$)`, 'i').test(pyproject)) frameworks.add(label)
    }
  }
  const reqTxt = await readText(root, 'requirements.txt')
  if (reqTxt != null) {
    if (!languages.includes('Python')) languages.push('Python')
    packageManager = packageManager ?? 'pip'
    mark('requirements.txt')
    for (const [dep, label] of Object.entries(FRAMEWORK_HINTS)) {
      if (new RegExp(`^${dep}([=<>!~\\[]|$)`, 'im').test(reqTxt)) frameworks.add(label)
    }
  }
  if (await exists('poetry.lock')) {
    packageManager = 'poetry'
    signals.add('hasLockfile')
    mark('poetry.lock')
  }
  if (await exists('uv.lock')) {
    packageManager = 'uv'
    signals.add('hasLockfile')
    mark('uv.lock')
  }
  if (await exists('Pipfile')) packageManager = packageManager ?? 'pipenv'
  if (await exists('setup.py')) mark('setup.py')

  /* ---- 其它语言 ---- */
  if (await exists('go.mod')) {
    languages.push('Go')
    mark('go.mod')
    packageManager = packageManager ?? 'go modules'
  }
  if (await exists('Cargo.toml')) {
    languages.push('Rust')
    mark('Cargo.toml')
    packageManager = packageManager ?? 'cargo'
  }
  if (await exists('pom.xml')) {
    languages.push('Java')
    mark('pom.xml')
    packageManager = packageManager ?? 'maven'
  }
  if (await exists('build.gradle') || await exists('build.gradle.kts')) {
    if (!languages.includes('Java')) languages.push('Java')
    packageManager = packageManager ?? 'gradle'
    mark('build.gradle')
  }
  if (await exists('Gemfile')) {
    languages.push('Ruby')
    mark('Gemfile')
  }
  if (await exists('composer.json')) {
    languages.push('PHP')
    mark('composer.json')
    packageManager = packageManager ?? 'composer'
  }

  /* ---- Makefile 目标 ---- */
  const makefile = await readText(root, 'Makefile')
  if (makefile != null) {
    mark('Makefile')
    const seen = new Set<string>()
    for (const line of makefile.split('\n')) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?!=)/)
      if (!m) continue
      const name = m[1]
      if (seen.has(name) || name === 'all') continue
      seen.add(name)
      commands.push({ kind: classifyScript(name), name, command: `make ${name}`, source: 'Makefile' })
    }
  }

  /* ---- 工程化配置 ---- */
  if (await exists('Dockerfile') || await exists('docker-compose.yml') || await exists('docker-compose.yaml') || await exists('compose.yml')) {
    signals.add('hasDocker')
  }
  if (await exists('.github/workflows')) {
    signals.add('hasGithubActions')
    signals.add('hasCi')
  }
  if (await exists('.gitlab-ci.yml')) {
    signals.add('hasGitlabCi')
    signals.add('hasCi')
  }
  if (await exists('.editorconfig')) signals.add('hasEditorconfig')
  if (
    await exists('eslint.config.js') || await exists('eslint.config.mjs') ||
    (pyproject ?? '').includes('[tool.ruff]')
  ) {
    signals.add('hasLinter')
  }
  if (await exists('prettier.config.js') || await exists('biome.json')) {
    signals.add('hasFormatter')
  }
  if (await exists('.env.example')) {
    signals.add('hasEnvExample')
    mark('.env.example')
  }

  const hasTestDir = tree.some((e) => e.dir && ['test', 'tests', '__tests__', 'spec', 'e2e'].includes(e.name))
  if (hasTestDir) signals.add('hasTests')
  if (!signals.has('hasTests')) {
    const probeNested = (entries: TreeEntry[]): boolean =>
      entries.some((e) =>
        e.dir ? (e.children ? probeNested(e.children) : false) : /(\.test\.|\.spec\.|_test\.)/.test(e.name),
      )
    if (probeNested(tree)) signals.add('hasTests')
  }

  if (await exists('README.md')) {
    mark('README.md')
    signals.add('hasReadme')
  }
  if (await exists('LICENSE')) signals.add('hasLicense')
  if (await exists('CHANGELOG.md')) signals.add('hasChangelog')

  const installCommand: Record<string, string> = {
    npm: 'npm install', pnpm: 'pnpm install', yarn: 'yarn', bun: 'bun install',
    poetry: 'poetry install', uv: 'uv sync', pip: 'pip install -r requirements.txt', pipenv: 'pipenv install',
    'go modules': 'go mod download', cargo: 'cargo build', maven: 'mvn install',
    gradle: './gradlew build', composer: 'composer install',
  }
  if (packageManager && installCommand[packageManager]) {
    commands.unshift({ kind: 'install', name: packageManager, command: installCommand[packageManager], source: packageManager })
  } else if (pkgObj) {
    commands.unshift({ kind: 'install', name: 'npm', command: 'npm install', source: 'package.json' })
  }

  const seenCmd = new Set<string>()
  const uniqueCommands = commands.filter((c) => {
    if (seenCmd.has(c.command)) return false
    seenCmd.add(c.command)
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

/* ---- 扫描入口 ---- */

async function scanHandle(root: DirHandle, rootName: string, spec: AgentScanSpec): Promise<AgentScanResult> {
  const maxDepth = Math.max(1, Math.min(spec.maxDepth ?? DEFAULT_MAX_DEPTH, 8))
  const maxEntries = Math.max(1, Math.min(spec.maxEntries ?? DEFAULT_MAX_ENTRIES, 20000))
  if (!(await ensurePermission(root))) return { ok: false, code: 'PERMISSION_DENIED' }

  const budget: Budget = { entries: 0, truncated: false, files: 0, dirs: 0 }
  const tree = await readTree(root, maxDepth, budget, maxEntries)
  const notes: string[] = []
  if (budget.truncated) notes.push('truncated')

  const probe = await probeProject(root, tree)
  const facts: AgentScanFacts = {
    root: rootName,
    rootName,
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

export function buildWebAgentRules(): ElectronAgentRules {
  return {
    defaultRoot: async (): Promise<string> => '',
    pick: async (): Promise<string | null> => {
      const h = await pickDirectory()
      if (!h) return null
      handles.set(h.name, h)
      return h.name
    },
    scan: async (spec: AgentScanSpec): Promise<AgentScanResult> => {
      const h = handles.get(spec.root)
      if (!h) return { ok: false, code: 'ROOT_NOT_FOUND', detail: '请先选择目录' }
      return scanHandle(h, spec.root, spec)
    },
    save: async (root: string, target: RulesTarget, content: string): Promise<AgentRulesSaveResult> => {
      const h = handles.get(root)
      if (!h) return { ok: false, code: 'ROOT_NOT_FOUND', detail: '请先选择目录' }
      if (!(await ensurePermission(h, true))) return { ok: false, code: 'PERMISSION_DENIED' }
      try {
        const fh = await h.getFileHandle(RULES_FILENAMES[target], { create: true })
        const writable = await fh.createWritable()
        await writable.write(content)
        await writable.close()
        return { ok: true, path: `${root}/${RULES_FILENAMES[target]}` }
      } catch (e) {
        return { ok: false, code: 'WRITE_FAILED', detail: (e as Error).message }
      }
    },
  }
}

interface ElectronAgentRules {
  defaultRoot: () => Promise<string>
  pick: (title?: string) => Promise<string | null>
  scan: (spec: AgentScanSpec) => Promise<AgentScanResult>
  save: (root: string, target: RulesTarget, content: string) => Promise<AgentRulesSaveResult>
}
