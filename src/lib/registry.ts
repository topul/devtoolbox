import React, { lazy } from 'react'
import { TOOLS_L, CATEGORY_L, SECTION_L, type ToolId } from './locales/registry'
import { WEB_BUILD } from './platform'

export type CategoryId =
  | 'encoding' | 'format' | 'generators' | 'crypto' | 'text'
  | 'datetime' | 'network' | 'http' | 'offsec' | 'reference' | 'ai'

export interface ToolDef {
  /** Stable tool id, also the key in TOOLS_L */
  id: ToolId
  /** Language-neutral category id; display name comes from CATEGORY_L */
  category: CategoryId
  keywords: string[]
  hot?: boolean
  /** 依赖本机进程/文件系统的能力，浏览器（插件）构建里隐藏 */
  desktopOnly?: boolean
  /**
   * 工具组件的动态 import 工厂。首屏只加载对话与外壳，点进某个工具才拉它的分片；
   * 同一模块的多个工具共享一个 chunk。smoke:render 直接 await 它拿同步组件做 SSR。
   */
  load: () => Promise<{ default: React.ComponentType }>
  /** 由 load 包出的懒加载组件，App 的 ToolView 渲染用 */
  component: React.LazyExoticComponent<React.ComponentType>
}

export const CATEGORIES: CategoryId[] = [
  'encoding',
  'format',
  'generators',
  'crypto',
  'text',
  'datetime',
  'network',
  'http',
  'offsec',
  'reference',
  'ai',
] as const

/* ================= 导航分组 ================= */

/**
 * 侧栏与首页按「组」组织，而不是直接把 11 个分类平铺出来 ——
 * 65 个工具全摊在导航里，找东西反而变慢。
 *
 * 分组只影响**组织与排序**，不改变 `category` 的定义：
 * 分类仍是工具的稳定属性（搜索、面包屑、卡片都还按它来），
 * 这里只是给导航加一层聚合。
 *
 * 顺序即优先级：AI 第一（打开即对话），HTTP 调试与抓包第二 —— 这两块是日常用得最多的。
 * `http` 单独成组而不是并进 `network`，就是为了让它在侧栏里有自己的位置、默认展开；
 * 「网络与调试」剩下的都是解析/换算类小工具，不适合跟抓包抢位置。
 */
export type SectionId = 'ai' | 'http' | 'codec' | 'security' | 'network' | 'content' | 'misc'

export interface SectionDef {
  id: SectionId
  categories: CategoryId[]
}

export const SECTIONS: SectionDef[] = [
  { id: 'ai', categories: ['ai'] },
  { id: 'http', categories: ['http'] },
  { id: 'codec', categories: ['encoding', 'format'] },
  { id: 'security', categories: ['crypto', 'offsec'] },
  { id: 'network', categories: ['network'] },
  { id: 'content', categories: ['generators', 'text'] },
  { id: 'misc', categories: ['datetime', 'reference'] },
]

/**
 * 分类 → 分组。写成显式 `Record<CategoryId, SectionId>` 是**故意的**：
 * 以后新增分类却忘了归组时，这里会直接编译报错，而不是让它在导航里悄悄消失。
 */
const SECTION_OF: Record<CategoryId, SectionId> = {
  ai: 'ai',
  encoding: 'codec',
  format: 'codec',
  crypto: 'security',
  offsec: 'security',
  network: 'network',
  http: 'http',
  generators: 'content',
  text: 'content',
  datetime: 'misc',
  reference: 'misc',
}

export function sectionOf(cat: CategoryId): SectionId {
  return SECTION_OF[cat]
}

/** 某个组下的全部工具（按组内分类顺序、组内自然顺序） */
export function toolsInSection(id: SectionId): ToolDef[] {
  const sec = SECTIONS.find((s) => s.id === id)
  if (!sec) return []
  const pool = visibleTools()
  return sec.categories.flatMap((cat) => pool.filter((t) => t.category === cat))
}

/** 一个组里的工具数量（导航里显示计数用） */
export function sectionToolCount(id: SectionId): number {
  return toolsInSection(id).length
}

/**
 * 导航结构自检：`SECTIONS` 与 `SECTION_OF` 是两处手写，靠它防止走样。
 * 返回问题列表（空数组即正常）。`npm run smoke:render` 会断言它为空。
 */
export function verifyNavigation(): string[] {
  const problems: string[] = []
  const seen = new Set<CategoryId>()
  for (const sec of SECTIONS) {
    for (const cat of sec.categories) {
      if (seen.has(cat)) problems.push(`分类 ${cat} 出现在多个分组里`)
      seen.add(cat)
      if (SECTION_OF[cat] !== sec.id) {
        problems.push(`分类 ${cat}：SECTIONS 归入 ${sec.id}，SECTION_OF 却是 ${SECTION_OF[cat]}`)
      }
    }
  }
  for (const cat of CATEGORIES) {
    if (!seen.has(cat)) problems.push(`分类 ${cat} 没有归入任何分组`)
  }
  return problems
}

/**
 * 当前构建应该展示的工具。浏览器（插件）构建没有本机进程：
 * stdio MCP、抓包代理这类能力物理上做不到，藏起来比点进去报「不可用」诚实。
 */
export function visibleTools(): ToolDef[] {
  return WEB_BUILD ? TOOLS.filter((t) => !t.desktopOnly) : TOOLS
}

/** 当前构建可见的工具数（侧栏/首页计数用） */
export function visibleToolCount(): number {
  return visibleTools().length
}

/**
 * 工具清单。`load` 是动态 import 工厂，`component` 由它包成 lazy 组件：
 * 同一模块的多个工具共享一个 chunk（如 encoding 的 9 个工具合成一个分片），
 * 点进其中任何一个时才加载 —— 首屏（对话）完全不碰这些分片。
 */
const TOOL_SPECS: Omit<ToolDef, 'component'>[] = [
  // Encoding
  // NOTE: `keywords` are extra bilingual search aliases (matched in both locales).
  { id: 'base64', category: 'encoding', keywords: ['base64', 'b64', '编码'], hot: true, load: () => import('../tools/encoding').then(m => ({ default: m.Base64Tool })) },
  { id: 'url-codec', category: 'encoding', keywords: ['url', 'uri', '百分号', 'urlencode'], load: () => import('../tools/encoding').then(m => ({ default: m.UrlTool })) },
  { id: 'unicode', category: 'encoding', keywords: ['unicode', '转义', '中文'], load: () => import('../tools/encoding').then(m => ({ default: m.UnicodeTool })) },
  { id: 'radix', category: 'encoding', keywords: ['进制', 'hex', 'binary', 'bin', 'oct'], load: () => import('../tools/encoding').then(m => ({ default: m.RadixTool })) },
  { id: 'html-entity', category: 'encoding', keywords: ['html', 'entity', '实体', 'xss'], load: () => import('../tools/encoding').then(m => ({ default: m.HtmlEntityTool })) },
  { id: 'morse', category: 'encoding', keywords: ['morse', '摩斯', '电码'], load: () => import('../tools/encoding').then(m => ({ default: m.MorseTool })) },
  { id: 'str-escape', category: 'encoding', keywords: ['escape', '编码', '绕过', 'waf', 'hex'], load: () => import('../tools/converters').then(m => ({ default: m.StringEscapeTool })) },
  { id: 'base58-32', category: 'encoding', keywords: ['base58', 'base32', 'base32hex', '比特币', '地址'], load: () => import('../tools/codecs').then(m => ({ default: m.Base58Tool })) },
  { id: 'punycode', category: 'encoding', keywords: ['punycode', 'idn', 'xn--', '中文域名', '域名'], load: () => import('../tools/codecs').then(m => ({ default: m.PunycodeTool })) },

  // Data formats
  { id: 'yaml-json', category: 'format', keywords: ['yaml', 'yml', 'json', 'k8s', '配置'], load: () => import('../tools/dataformats').then(m => ({ default: m.YamlTool })) },
  { id: 'jsonpath', category: 'format', keywords: ['jsonpath', 'json', '查询', '提取'], load: () => import('../tools/dataformats').then(m => ({ default: m.JsonPathTool })) },
  { id: 'css-format', category: 'format', keywords: ['css', '样式', '美化', 'minify'], load: () => import('../tools/dataformats').then(m => ({ default: m.CssTool })) },
  { id: 'toml-json', category: 'format', keywords: ['toml', 'json', 'cargo', 'rust', '配置'], load: () => import('../tools/formats').then(m => ({ default: m.TomlTool })) },
  { id: 'csv-json', category: 'format', keywords: ['csv', 'json', '表格', '导出'], load: () => import('../tools/formats').then(m => ({ default: m.CsvTool })) },

  // Network
  { id: 'url-parser', category: 'network', keywords: ['url', 'uri', 'query', '参数'], load: () => import('../tools/network').then(m => ({ default: m.UrlParserTool })) },
  { id: 'ua-parser', category: 'network', keywords: ['ua', 'user-agent', '浏览器', '爬虫'], load: () => import('../tools/network').then(m => ({ default: m.UserAgentTool })) },
  { id: 'ip-int', category: 'network', keywords: ['ip', 'int', 'ssrf', '绕过', '0x7f'], load: () => import('../tools/network').then(m => ({ default: m.IpIntTool })) },
  { id: 'cookie', category: 'network', keywords: ['cookie', 'set-cookie', 'session', '会话'], load: () => import('../tools/network').then(m => ({ default: m.CookieTool })) },
  { id: 'dns-lookup', category: 'network', keywords: ['dns', 'doh', '解析', '域名', 'mx', 'a记录', 'ns', 'txt'], load: () => import('../tools/dns').then(m => ({ default: m.DnsLookupTool })) },

  // HTTP 调试
  { id: 'http-client', category: 'http', keywords: ['http', 'https', 'postman', 'rest', 'api', '请求', '接口', 'curl', 'fetch', '接口测试'], hot: true, load: () => import('../tools/httpclient').then(m => ({ default: m.HttpClientTool })) },
  { id: 'har-analyze', category: 'http', keywords: ['har', 'http archive', '抓包', '瀑布', 'waterfall', 'chrome devtools', 'fiddler', 'charles'], load: () => import('../tools/har').then(m => ({ default: m.HarTool })) },
  { id: 'graphql', category: 'http', keywords: ['graphql', 'gql', 'schema', 'introspection', '查询', 'mutation'], hot: true, load: () => import('../tools/graphql').then(m => ({ default: m.GraphqlTool })) },
  { id: 'traffic-proxy', category: 'http', keywords: ['proxy', '抓包', 'mitm', 'charles', 'fiddler', 'wireshark', '代理', '重放', 'replay', 'https', '证书'], hot: true, desktopOnly: true, load: () => import('../tools/proxy').then(m => ({ default: m.TrafficProxyTool })) },
  { id: 'sse', category: 'http', keywords: ['sse', 'server-sent', 'events', 'eventsource', '流', '推送', 'streaming', '实时'], load: () => import('../tools/sse').then(m => ({ default: m.SseTool })) },
  { id: 'websocket', category: 'http', keywords: ['websocket', 'ws', 'wss', 'socket', '长连接', '实时'], load: () => import('../tools/ws').then(m => ({ default: m.WsTool })) },
  { id: 'header-audit', category: 'http', keywords: ['header', '响应头', 'hsts', 'csp', '安全头', '审计', 'audit', 'x-frame-options'], load: () => import('../tools/audit').then(m => ({ default: m.HeaderAuditTool })) },

  // Formatters
  { id: 'sql-check', category: 'format', keywords: ['sql', '慢查询', 'explain', '索引', '优化', '性能', 'lint', '执行计划'], load: () => import('../tools/sqlcheck').then(m => ({ default: m.SqlCheckTool })) },
  { id: 'json', category: 'format', keywords: ['json', '格式化', '压缩', '校验'], hot: true, load: () => import('../tools/format').then(m => ({ default: m.JsonTool })) },
  { id: 'sql-format', category: 'format', keywords: ['sql', 'mysql', '美化'], load: () => import('../tools/format').then(m => ({ default: m.SqlTool })) },
  { id: 'xml-format', category: 'format', keywords: ['xml', 'html', '格式化'], load: () => import('../tools/format').then(m => ({ default: m.XmlTool })) },
  { id: 'markdown', category: 'format', keywords: ['markdown', 'md', '预览'], load: () => import('../tools/format').then(m => ({ default: m.MarkdownTool })) },

  // Generators
  { id: 'uuid', category: 'generators', keywords: ['uuid', 'guid', '随机'], load: () => import('../tools/generators').then(m => ({ default: m.UuidTool })) },
  { id: 'password', category: 'generators', keywords: ['password', '密码', 'random'], load: () => import('../tools/generators').then(m => ({ default: m.PasswordTool })) },
  { id: 'qrcode', category: 'generators', keywords: ['qrcode', 'qr', '二维码'], load: () => import('../tools/generators').then(m => ({ default: m.QrTool })) },
  { id: 'fake-data', category: 'generators', keywords: ['测试数据', 'mock', 'fake', '假数据'], load: () => import('../tools/generators').then(m => ({ default: m.FakeDataTool })) },
  { id: 'color', category: 'generators', keywords: ['color', '颜色', 'hex', 'rgb', 'hsl'], load: () => import('../tools/converters').then(m => ({ default: m.ColorTool })) },
  { id: 'img-base64', category: 'generators', keywords: ['image', 'base64', 'dataurl', '图片'], load: () => import('../tools/converters').then(m => ({ default: m.ImgBase64Tool })) },

  // Crypto & hash
  { id: 'hash', category: 'crypto', keywords: ['hash', 'md5', 'sha', '哈希', '散列'], load: () => import('../tools/crypto').then(m => ({ default: m.HashTool })) },
  { id: 'hmac', category: 'crypto', keywords: ['hmac', '签名', 'sign'], load: () => import('../tools/crypto').then(m => ({ default: m.HmacTool })) },
  { id: 'aes', category: 'crypto', keywords: ['aes', '加密', '解密', 'encrypt'], load: () => import('../tools/crypto').then(m => ({ default: m.AesTool })) },
  { id: 'jwt', category: 'crypto', keywords: ['jwt', 'token', '解码'], hot: true, load: () => import('../tools/crypto').then(m => ({ default: m.JwtTool })) },
  // 关键词只写**真能识别**的类型：bcrypt/argon2/md5crypt 都在 types 里（见 locales/crypto.ts）
  { id: 'hash-id', category: 'crypto', keywords: ['hash', '识别', '识别类型', 'hashcat', 'ntlm', 'bcrypt', 'argon2', 'md5crypt', 'shadow'], load: () => import('../tools/crypto').then(m => ({ default: m.HashIdentifyTool })) },
  { id: 'xor', category: 'crypto', keywords: ['xor', '异或', 'ctf', '加解密'], load: () => import('../tools/offsec').then(m => ({ default: m.XorTool })) },
  { id: 'rot', category: 'crypto', keywords: ['rot13', 'caesar', '凯撒', 'rot47'], load: () => import('../tools/offsec').then(m => ({ default: m.RotTool })) },
  { id: 'vigenere', category: 'crypto', keywords: ['vigenere', '维吉尼亚', '古典密码'], load: () => import('../tools/offsec').then(m => ({ default: m.VigenereTool })) },
  { id: 'tls-info', category: 'crypto', keywords: ['tls', 'ssl', '证书', '握手', 'cipher', '握手详情', 'chain', '中间证书'], load: () => import('../tools/tlsinfo').then(m => ({ default: m.TlsInfoTool })) },
  { id: 'x509', category: 'crypto', keywords: ['x509', '证书', 'certificate', 'pem', 'https', '指纹', 'openssl'], load: () => import('../tools/x509').then(m => ({ default: m.X509Tool })) },
  { id: 'jwt-crack', category: 'crypto', keywords: ['jwt', '弱密钥', '爆破', 'crack', 'alg=none', '算法混淆', '安全'], load: () => import('../tools/jwtcrack').then(m => ({ default: m.JwtCrackTool })) },
  // 认证类：签发与二次验证码。实现来自 toolkit/jwt-sign.ts 与 toolkit/totp.ts，
  // 算法正确性由 smoke:ux 的「签验往返 + RFC 6238 官方向量」把关。
  { id: 'jwt-sign', category: 'crypto', keywords: ['jwt', '签名', 'sign', 'hs256', 'hs384', 'hs512', '签发', 'token', 'bearer', 'auth'], load: () => import('../tools/authtools').then(m => ({ default: m.JwtSignTool })) },
  { id: 'totp', category: 'crypto', keywords: ['totp', 'otp', '2fa', 'mfa', '二次验证', '动态验证码', 'authenticator', 'google authenticator', 'base32'], load: () => import('../tools/authtools').then(m => ({ default: m.TotpTool })) },

  // Text
  { id: 'diff', category: 'text', keywords: ['diff', '对比', '比较'], load: () => import('../tools/text').then(m => ({ default: m.DiffTool })) },
  { id: 'regex', category: 'text', keywords: ['regex', '正则', 'regexp'], load: () => import('../tools/text').then(m => ({ default: m.RegexTool })) },
  { id: 'regex-replace', category: 'text', keywords: ['正则替换', 'replace', '重构', '批量替换', 'regex replace'], hot: true, load: () => import('../tools/regexreplace').then(m => ({ default: m.RegexReplaceTool })) },
  { id: 'word-count', category: 'text', keywords: ['字数', '统计', 'count'], load: () => import('../tools/text').then(m => ({ default: m.WordCountTool })) },
  { id: 'case-convert', category: 'text', keywords: ['驼峰', '下划线', '大小写', 'camel', 'snake'], load: () => import('../tools/text').then(m => ({ default: m.CaseTool })) },
  { id: 'line-ops', category: 'text', keywords: ['行', '去重', '排序', 'dedupe'], load: () => import('../tools/text').then(m => ({ default: m.LineOpsTool })) },

  // Date & time
  { id: 'timestamp', category: 'datetime', keywords: ['timestamp', '时间戳', 'unix'], load: () => import('../tools/time').then(m => ({ default: m.TimestampTool })) },
  { id: 'cron', category: 'datetime', keywords: ['cron', 'crontab', '定时'], load: () => import('../tools/time').then(m => ({ default: m.CronTool })) },
  { id: 'date-diff', category: 'datetime', keywords: ['日期', '差', 'date'], load: () => import('../tools/time').then(m => ({ default: m.DateDiffTool })) },
  { id: 'timezone', category: 'datetime', keywords: ['timezone', '时区', 'utc', 'gmt', '转换', '世界时间'], load: () => import('../tools/timezone').then(m => ({ default: m.TimezoneTool })) },

  // Offensive security
  { id: 'revshell', category: 'offsec', keywords: ['reverse', 'shell', '反弹', 'shellcode', 'nc'], load: () => import('../tools/security').then(m => ({ default: m.ReverseShellTool })) },
  { id: 'payloads', category: 'offsec', keywords: ['payload', 'sqli', 'xss', '注入', 'lfi', 'ssti', 'xxe'], load: () => import('../tools/security').then(m => ({ default: m.PayloadCheatSheetTool })) },
  { id: 'ports', category: 'offsec', keywords: ['port', '端口', 'nmap', '服务'], load: () => import('../tools/security').then(m => ({ default: m.PortRefTool })) },
  { id: 'privesc', category: 'offsec', keywords: ['privesc', '提权', 'suid', 'sudo', 'root', 'system'], load: () => import('../tools/offsec').then(m => ({ default: m.PrivescTool })) },

  // Reference
  { id: 'http-status', category: 'reference', keywords: ['http', '状态码', '404', '500'], load: () => import('../tools/security').then(m => ({ default: m.HttpStatusTool })) },
  { id: 'subnet', category: 'reference', keywords: ['subnet', '子网', 'cidr', 'ip', '掩码'], load: () => import('../tools/security').then(m => ({ default: m.SubnetTool })) },
  { id: 'chmod', category: 'reference', keywords: ['chmod', '权限', '755', 'linux'], load: () => import('../tools/security').then(m => ({ default: m.ChmodTool })) },

  // AI 接入
  { id: 'mcp-server', category: 'ai', keywords: ['mcp', 'ai', 'agent', '智能体', '大模型', 'claude', 'cursor', '接入', '工具调用'], hot: true, desktopOnly: true, load: () => import('../tools/mcp').then(m => ({ default: m.McpTool })) },
  { id: 'mcp-inspector', category: 'ai', keywords: ['mcp', 'inspector', '客户端', '连接', '调用', '工具调用', 'jsonrpc', 'stdio', '调试'], desktopOnly: true, load: () => import('../tools/mcpclient').then(m => ({ default: m.McpInspectorTool })) },
  { id: 'tool-schema', category: 'ai', keywords: ['schema', 'json schema', '工具定义', '函数调用', 'function calling', 'typescript', 'pydantic', 'openai', 'mcp', '转换', '校验'], load: () => import('../tools/schema').then(m => ({ default: m.ToolSchemaTool })) },
  { id: 'agent-rules', category: 'ai', keywords: ['agents.md', 'agents', 'cursorrules', 'claude', '规则文件', '项目说明', '扫描', '仓库结构', 'onboarding', 'ai 协作'], load: () => import('../tools/agentrules').then(m => ({ default: m.AgentRulesTool })) },
  { id: 'chat-compare', category: 'ai', keywords: ['对比', '多模型', '测评', '评测', 'compare', '模型选型', '并排', '首字延迟', 'benchmark'], load: () => import('../tools/chatcompare').then(m => ({ default: m.ChatCompareTool })) },
]

export const TOOLS: ToolDef[] = TOOL_SPECS.map((spec) => ({ ...spec, component: lazy(spec.load) }))

/**
 * HOT 标记的总数上限。
 *
 * 原来 65 个工具里 20 个打了 `hot`，占三成 —— 侧栏的 ★ 和首页的 HOT 徽章
 * 都在说「这个特别重要」，结果全都不重要，标记本身就失效了。
 * 上限压到 8 个（约一成二），只留给真正每天都会用的那几个。
 */
export const HOT_TOOL_LIMIT = 8

/**
 * 某个工具的全部可匹配文本：双语名称 + 描述、分类名、分组名、关键词。
 *
 * 抽出来是因为打分与过滤都要用同一份词表 —— 两处各拼一次必然漂移。
 */
function haystack(t: ToolDef): string[] {
  const zh = TOOLS_L.zh[t.id]
  const en = TOOLS_L.en[t.id]
  return [
    zh.name, zh.desc, en.name, en.desc,
    CATEGORY_L.zh[t.category], CATEGORY_L.en[t.category],
    SECTION_L.zh[sectionOf(t.category)], SECTION_L.en[sectionOf(t.category)],
    ...t.keywords,
  ]
}

/**
 * 匹配打分：分数越高越靠前，0 表示不匹配。
 *
 * 为什么要打分而不是只做过滤：搜「base64」时 Base64 工具和「base64 编解码」
 * 都能命中，但前者显然该排第一。原来的 `includes` 只要命中就一律并列，
 * 等于没有排序。
 *
 * 权重：完全相等 > 名称前缀 > 关键词/描述前缀 > 任意位置包含。
 */
function matchScore(t: ToolDef, terms: string[]): number {
  // 名称命中比描述命中重要，所以先拿名称单独算一遍
  const zh = TOOLS_L.zh[t.id]
  const en = TOOLS_L.en[t.id]
  const names = [zh.name, en.name].map((s) => s.toLowerCase())
  const rest = haystack(t).map((s) => s.toLowerCase())

  let score = 0
  for (const term of terms) {
    let best = 0
    for (const n of names) {
      if (n === term) best = Math.max(best, 100)
      else if (n.startsWith(term)) best = Math.max(best, 70)
      else if (n.includes(term)) best = Math.max(best, 50)
    }
    for (const s of rest) {
      if (s.startsWith(term)) best = Math.max(best, 30)
      else if (s.includes(term)) best = Math.max(best, 10)
    }
    // 一个词不命中就整体不匹配（AND 语义）——
    // 「json 格式化」只命中一个词的工具不该被列进结果
    if (best === 0) return 0
    score += best
  }
  return score
}

/**
 * Search across display names, descriptions, category names and keywords.
 *
 * 两处刻意的行为：
 *   1. **两种语言同时匹配** —— zh 界面下输 "json" 能搜到，en 界面下输 "格式化" 也能搜到。
 *      `keywords` 里放的是双语别名。
 *   2. **空格分词 + AND** —— 原来的整串 `includes` 让「time json」这种
 *      自然的组合查询永远零结果。现在按空格切开，每个词都要命中（可落在不同字段），
 *      并按命中位置加权排序。
 */
export function searchTools(q: string): ToolDef[] {
  if (!q.trim()) return visibleTools()
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return visibleTools()
  const scored: { t: ToolDef; s: number }[] = []
  for (const t of visibleTools()) {
    const s = matchScore(t, terms)
    if (s > 0) scored.push({ t, s })
  }
  // 分数降序；同分保持 registry 原序（后注册的排在后面），别让排序不稳定
  return scored.sort((a, b) => b.s - a.s).map((x) => x.t)
}
