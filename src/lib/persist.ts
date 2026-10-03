/**
 * 工具页状态的本地持久化。
 *
 * 为什么单独一层：评审发现 65 个工具里只有 http-client 和 mcp-inspector 用了 localStorage，
 * 其余工具切走再回来输入就空了 —— 这是工具箱最高频的状态丢失点。
 * 把「存/取/容错/截断」收在这里，工具页只写 `usePersistedState('base64', 'input', '')`。
 *
 * 四条硬约束：
 *   1. **永不抛**。隐私模式、配额满、SSR 都没有存储或会抛，读写都当失败处理；
 *   2. **有上限**。localStorage 总配额约 5MB，一个手粘的大 JSON 能把它写满，
 *      写满之后所有工具都存不住 —— 所以单条超长直接放弃并告知调用方；
 *   3. **带前缀**。键统一加 `devtoolbox-` 前缀，别和别的模块撞车；
 *   4. **敏感内容不落 localStorage**。JWT token、HMAC 密钥这类东西写进localStorage
 *      意味着关掉应用几天后再打开它还在磁盘上。敏感字段改走 sessionStorage：
 *      切页仍保留（不回到「切走就没了」的断层），关闭应用即清空。
 *
 * 纯逻辑为主（无 React 依赖），smoke:ux 能直接在 Node 里跑。
 */

/** 统一前缀，避免与其它模块的键冲突 */
export const PERSIST_PREFIX = 'devtoolbox-'

/**
 * 单条状态的上限（按字符数粗算）。
 *
 * localStorage 是 UTF-16，5MB 配额约合 250 万字符；这里留 3 个数量级的余量，
 * 单条 20 万字符足够放下「粘一份大日志」，又不会一个工具把配额吃光。
 */
export const MAX_PERSIST_CHARS = 200_000

/**
 * 敏感字段名（`toolStateKey` 里的 field 段）。
 *
 * 命中即改走 sessionStorage：切页保留、关闭应用清空，**永不进localStorage**。
 * 判定用**字段名精确匹配**而不是模糊包含 —— 「token」这种词太泛，
 * 用 includes 会把「tokenize 函数测试」之类的无关输入也拖进敏感路径。
 */
export const SENSITIVE_FIELDS: readonly string[] = [
  'token',
  'key',
  'secret',
  'password',
  'passwd',
  'pwd',
  'credential',
  'cookie',
  'authorization',
]

/** 字段名是否敏感 */
export function isSensitiveField(_toolId: string, field: string): boolean {
  return SENSITIVE_FIELDS.includes(field.toLowerCase())
}

/** 单条存储的选项 */
export interface PersistOpts {
  /**
   * 是否敏感。敏感则走 sessionStorage（关闭应用即清空），否则走 localStorage。
   * 缺省为 false —— 调用方通常直接用 `isSensitiveField` 判定后再传进来。
   */
  sensitive?: boolean
}

/**
 * 取存储：敏感走 sessionStorage，其余走 localStorage。
 *
 * **绝不降级**：敏感字段拿不到 sessionStorage 时返回 null（当成没有存储），
 * 绝不能回落到 localStorage —— 那正好违背了标记敏感的意义。
 */
function store(sensitive: boolean): Storage | null {
  const global = globalThis as { sessionStorage?: Storage; localStorage?: Storage }
  const pick = sensitive ? global.sessionStorage : global.localStorage
  if (!pick) return null
  try {
    // Safari 无痕模式访问存储本身就可能抛，得真的碰一下才知道
    pick.getItem(PERSIST_PREFIX + '__probe__')
    return pick
  } catch {
    return null
  }
}

/**
 * 读取一条持久化状态。
 *
 * 容错覆盖三种坏情况：没有存储、值损坏（别人写坏 / 版本升级后格式变了）、
 * 类型不符（把字符串当对象用）。任何一种都回落到 `fallback`，绝不抛。
 */
export function loadPersisted<T>(key: string, fallback: T, opts: PersistOpts = {}): T {
  const s = store(opts.sensitive === true)
  if (!s) return fallback
  try {
    const raw = s.getItem(PERSIST_PREFIX + key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    // 只接受与 fallback 同类的值：类型不符时宁可不读，也不要把字符串当数组使
    if (parsed === null || typeof parsed !== typeof fallback) return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

/**
 * 写入一条持久化状态。
 *
 * @returns 是否真的写进去了。失败（隐私模式 / 超配额 / 超长）返回 false，
 *   调用方可以据此提示「本次输入不会被保留」—— 静默失败才是真的坏体验。
 */
export function savePersisted(key: string, value: unknown, opts: PersistOpts = {}): boolean {
  const s = store(opts.sensitive === true)
  if (!s) return false
  let raw: string
  try {
    raw = JSON.stringify(value)
  } catch {
    return false // 循环引用等无法序列化的值
  }
  // 超长直接放弃：截一半存进去，下次读出来是坏数据，比不存更糟
  if (raw.length > MAX_PERSIST_CHARS) return false
  try {
    s.setItem(PERSIST_PREFIX + key, raw)
    return true
  } catch {
    return false // 配额满 / 隐私模式
  }
}

/** 删掉一条持久化状态（「清空」按钮用） */
export function clearPersisted(key: string, opts: PersistOpts = {}): void {
  const s = store(opts.sensitive === true)
  if (!s) return
  try {
    s.removeItem(PERSIST_PREFIX + key)
  } catch { /* 隐私模式忽略 */ }
}

/** 某个键当前是否已有内容（「清空」按钮决定是否可点的依据） */
export function hasPersisted(key: string, opts: PersistOpts = {}): boolean {
  const s = store(opts.sensitive === true)
  if (!s) return false
  try {
    return s.getItem(PERSIST_PREFIX + key) !== null
  } catch {
    return false
  }
}

/** 工具页状态键：统一前缀，避免各工具自己拼键撞车 */
export function toolStateKey(toolId: string, field: string): string {
  return `tool-${toolId}-${field}`
}

/**
 * 启动时清理敏感残留。
 *
 * sessionStorage 正常关闭应用会被浏览器清掉，但**崩溃 / 强杀 / 系统重启**时可能留下残渣。
 * 正常路径不该读到上次的数据，万一上次是异常退出，就在启动时主动清一遍：
 *   - 清 sessionStorage 里的敏感键（崩溃残留）
 *   - 清 localStorage 里的敏感键（更早的版本落盘的遗留，那批最该清）
 *
 * **只清敏感键**：非敏感输入必须留着 —— 那正是持久化的价值。
 *
 * 键名形如 `devtoolbox-tool-<toolId>-<field>`，判定方式是「倒数第二段命中 SENSITIVE_FIELDS」。
 * 不认识的键一律不动（别的模块可能存在 sessionStorage 里）。
 *
 * @returns 清掉了几条
 */
export function purgeSensitiveSession(): number {
  const global = globalThis as { sessionStorage?: Storage; localStorage?: Storage }
  let removed = 0
  // sessionStorage 要先删：删完之后再扫 localStorage，避免同一 session 的键被算两次
  for (const s of [global.sessionStorage, global.localStorage]) {
    if (!s) continue
    try {
      // 复制一份再遍历：removeItem 会在遍历中改动下标
      const keys: string[] = []
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k) keys.push(k)
      }
      for (const k of keys) {
        if (!k.startsWith(PERSIST_PREFIX)) continue // 不碰别的模块的键
        const rest = k.slice(PERSIST_PREFIX.length)
        const parts = rest.split('-')
        // 形如 tool-<toolId>-<field>：toolId 可能含连字符，所以从右往左找 field 段
        const field = parts[parts.length - 1]
        if (parts.length < 3 || parts[0] !== 'tool') continue
        if (!isSensitiveField('', field)) continue
        s.removeItem(k)
        removed++
      }
    } catch {
      // 隐私模式 / 存储不可用：跳过，不能因为清理失败而挡住应用启动
    }
  }
  return removed
}
