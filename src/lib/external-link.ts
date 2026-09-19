/**
 * 外链白名单。
 *
 * 为什么需要：对话里的链接是**模型生成的**，属于不可信输入。渲染层点开链接时
 * 只有两条路 —— 在应用窗口内导航（会把整个界面顶掉），或交给系统浏览器。
 * 走系统浏览器时，链接会变成一次「用本机默认程序打开某个 URL」的请求，
 * 那么 `file:` / `javascript:` / 自定义协议就必须在进主进程之前挡掉。
 *
 * 纯函数：主进程与脚本都能用同一份实现。
 */

/** 允许交给系统浏览器打开的协议 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 网址上限：模型偶尔会吐出离谱长的追踪链接，超长一律拒绝 */
const MAX_LENGTH = 2048

/** 合法则返回规范化后的 URL，否则返回 null */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t || t.length > MAX_LENGTH) return null
  let url: URL
  try {
    url = new URL(t)
  } catch {
    return null
  }
  if (!SAFE_PROTOCOLS.has(url.protocol)) return null
  // 带账号密码的链接很容易被拿来做钓鱼展示（看起来是 A 实际连 B），整体拒绝
  if (url.username || url.password) return null
  return url.toString()
}
