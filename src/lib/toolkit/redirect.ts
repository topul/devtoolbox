/**
 * 开放重定向 Payload 生成 —— 纯函数。
 *
 * 输入回跳目标（攻击者站点）与被信任站点，按「绕过手法」分类生成变体。
 * 用于验证自家应用的 returnUrl / next / redirect 参数是否做了正确的
 * 同源校验。仅生成字符串，不发起请求、不包含真实站点。
 */

export type RedirectCategory =
  | 'protocolRelative'
  | 'backslash'
  | 'schemeAbuse'
  | 'userinfo'
  | 'suffix'
  | 'whitespace'
  | 'encoding'
  | 'javascript'

export interface RedirectPayload {
  category: RedirectCategory
  /** 直接填进回跳参数的值 */
  value: string
  /** 语言中立的手法 id */
  bypassId: string
}

export interface RedirectResult {
  ok: boolean
  error?: string
  payloads: RedirectPayload[]
  /** 拼好的完整测试 URL 模板（用户可填自己的回跳端点） */
  target: string
}

export function generateRedirectPayloads(
  target: string,
  trusted = 'trusted.local',
): RedirectResult {
  const t = target
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
  if (!t) return { ok: false, error: 'EMPTY', payloads: [], target: '' }

  const out: RedirectPayload[] = []
  const seen = new Set<string>()
  const push = (category: RedirectCategory, value: string, bypassId: string): void => {
    if (!seen.has(value)) {
      seen.add(value)
      out.push({ category, value, bypassId })
    }
  }

  // 协议相对：绕过「必须以 / 开头或必须 http」类检查
  push('protocolRelative', `//${t}`, 'check.startsWithSlash')
  push('protocolRelative', `///${t}`, 'check.tripleSlash')
  push('protocolRelative', `////${t}`, 'check.quadSlash')

  // 反斜杠：部分浏览器 / 解析器把 \ 当 /
  push('backslash', `/\\${t}`, 'check.backslash')
  push('backslash', `\\/\\/${t}`, 'check.mixedSlash')
  push('backslash', `https:\\\\${t}`, 'check.schemeBackslash')
  push('backslash', `//${t}/..`, 'check.pathTraversalSuffix')

  // 协议滥用
  push('schemeAbuse', `https:${t}`, 'check.colonScheme')
  push('schemeAbuse', `//${t}%2f..`, 'check.encodedSlash')
  push('schemeAbuse', `/../../${t}`, 'check.relativeEscape')

  // userinfo：把可信域名放在 @ 前面做幌子
  push('userinfo', `//${trusted}@${t}`, 'check.userinfo')
  push('userinfo', `https://${trusted}@${t}`, 'check.userinfoScheme')
  push('userinfo', `//${t}@${trusted}`, 'check.userinfoSuffix')

  // 后缀信任绕过：startsWith / endsWith / contains 三类错误
  push('suffix', `//${t}.${trusted}`, 'check.suffixDomain')
  push('suffix', `//${trusted}.${t}`, 'check.subdomainPrefix')
  push('suffix', `//${t}/${trusted}`, 'check.pathContainsTrusted')
  push('suffix', `//${t}?${trusted}`, 'check.queryContainsTrusted')
  push('suffix', `//${t}#${trusted}`, 'check.fragmentContainsTrusted')

  // 空白与特殊字符
  push('whitespace', ` //${t}`, 'check.leadingSpace')
  push('whitespace', `\t//${t}`, 'check.leadingTab')
  push('whitespace', `//${t}\n`, 'check.trailingNewline')
  push('whitespace', `/\n/${t}`, 'check.embeddedNewline')

  // 编码
  push('encoding', `%2F%2F${t}`, 'check.encodedSlashes')
  push('encoding', `%5C%5C${t}`, 'check.encodedBackslashes')
  push('encoding', `//${encodeURIComponent(t)}`, 'check.encodedHost')
  push('encoding', `。${t}`, 'check.unicodeDot')

  // DOM 型：location 赋值 / window.location 不走 302 时
  push('javascript', `javascript:alert(document.domain)`, 'sink.domXss')
  push('javascript', `data:text/html,<script>location='//${t}'</script>`, 'sink.dataUrl')

  return { ok: true, payloads: out, target: t }
}
