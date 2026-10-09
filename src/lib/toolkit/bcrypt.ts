/**
 * bcrypt 哈希与密码强度 —— 渲染进程与 MCP 服务端共用的纯函数模块。
 *
 * 哈希走 bcryptjs 的同步 API（本地同步计算，不出网络）；密码强度不引第三方
 * 评分库，用「字符池 × 长度」的信息熵估算 —— 够用来给出「该加什么」的方向性
 * 建议，但不是 zxcvbn 那种针对字典攻击的精确模型，输出只作参考。
 */
import { compareSync, hashSync } from 'bcryptjs'

/** bcrypt 哈希的标准形态：$2a/$2b/$2x/$2y + 两位 cost + 53 字符盐与摘要 */
const HASH_RE = /^\$2[abxy]\$(\d{2})\$[./A-Za-z0-9]{53}$/

/**
 * 生成 bcrypt 哈希。rounds 越大越慢也越难暴力破解，
 * 传超出安全范围的值会被裁剪到 4-15（bcrypt 的 cost 本就只支持这两个界）。
 */
export function bcryptHash(password: string, rounds: number): string {
  const cost = Math.round(rounds)
  const clamped = Math.min(15, Math.max(4, Number.isFinite(cost) ? cost : 10))
  return hashSync(password, clamped)
}

/**
 * 校验密码与哈希是否匹配。
 * hash 格式不对时返回 false 而不是抛异常 —— 调用方拿到的是用户粘贴的任意文本，
 * 「格式错了」和「密码错了」对 UI 来说都是同一个 ✗。
 */
export function bcryptVerify(password: string, hash: string): boolean {
  const trimmed = hash.trim()
  if (!HASH_RE.test(trimmed)) return false
  try {
    return compareSync(password, trimmed)
  } catch {
    return false
  }
}

/**
 * 判断已有哈希是否低于目标 cost（需要 rehash）。
 * 格式无法解析时也返回 true —— 一个连 cost 都读不出来的哈希，重铸总是更安全的选择。
 */
export function bcryptNeedsRehash(hash: string, rounds: number): boolean {
  const m = hash.trim().match(HASH_RE)
  if (!m) return true
  return parseInt(m[1], 10) < rounds
}

/* ================= 密码强度 ================= */

export interface PasswordStrength {
  /** 0 很弱 - 4 很强 */
  score: 0 | 1 | 2 | 3 | 4
  /** 信息熵估算（bit）：长度 × log2(字符池) */
  bits: number
  /** 实际命中的字符池大小 */
  poolSize: number
  /** 改进建议（英文标识，由调用方映射成界面文案） */
  suggestions: ('length' | 'upper' | 'lower' | 'digit' | 'symbol' | 'common')[]
}

/** 常见弱密码黑名单：包含匹配（password123 也算命中），条目均 ≥ 6 字符以免误伤 */
const COMMON_PASSWORDS = [
  'password',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwertyuiop',
  'abc123',
  'password1',
  'iloveyou',
  '111111',
  '123123',
  'letmein',
  'welcome',
  'admin123',
  'administrator',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'batman',
  'trustno1',
  'master',
  'shadow',
  'michael',
  'jennifer',
  'whatever',
  '654321',
  'hello123',
  'freedom',
  'passw0rd',
  '1q2w3e4r',
  'qazwsx',
] as const

/**
 * 密码强度评估：纯本地计算。
 *
 * bits = 长度 × log2(命中的字符池大小)。这是熵的上界估算 —— 不建模字典词、
 * 键盘模式与重复结构，所以 'aaaaaaaaaaaaaaaa' 会被高估；黑名单命中直接判 0 分
 * 兜住最危险的常见误用。score 阈值：<28 弱到可秒破，≥90 视为离线爆破不可行。
 */
export function passwordStrength(password: string): PasswordStrength {
  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasDigit = /[0-9]/.test(password)
  const hasSpace = password.includes(' ')
  // 其余可打印 ASCII 符号（!@#$%^&* 等），33 个
  const hasSymbol = /[^\da-zA-Z\s]/.test(password)
  const hasOther = /[^\x20-\x7e]/.test(password) // 非 ASCII（中文、emoji 等），按 100 粗算

  let poolSize = 0
  if (hasLower) poolSize += 26
  if (hasUpper) poolSize += 26
  if (hasDigit) poolSize += 10
  if (hasSymbol) poolSize += 33
  if (hasSpace) poolSize += 1
  if (hasOther) poolSize += 100

  const bits = poolSize > 0 && password.length > 0 ? password.length * Math.log2(poolSize) : 0

  const suggestions: PasswordStrength['suggestions'] = []
  if (password.length < 12) suggestions.push('length')
  if (!hasUpper) suggestions.push('upper')
  if (!hasLower) suggestions.push('lower')
  if (!hasDigit) suggestions.push('digit')
  if (!hasSymbol) suggestions.push('symbol')
  const isCommon =
    password.length > 0 && COMMON_PASSWORDS.some((p) => password.toLowerCase().includes(p))
  if (isCommon) suggestions.push('common')

  let score: PasswordStrength['score']
  if (isCommon) score = 0
  else if (bits < 28) score = 0
  else if (bits < 36) score = 1
  else if (bits < 60) score = 2
  else if (bits < 90) score = 3
  else score = 4

  return { score, bits: Math.round(bits), poolSize, suggestions }
}
