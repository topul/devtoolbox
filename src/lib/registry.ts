import React from 'react'
import { TOOLS_L, CATEGORY_L, type ToolId } from './locales/registry'
import { Base64Tool, UrlTool, UnicodeTool, RadixTool, HtmlEntityTool, MorseTool } from '../tools/encoding'
import { JsonTool, SqlTool, XmlTool, MarkdownTool } from '../tools/format'
import { UuidTool, PasswordTool, QrTool, FakeDataTool } from '../tools/generators'
import { DiffTool, RegexTool, WordCountTool, CaseTool, LineOpsTool } from '../tools/text'
import { TimestampTool, CronTool, DateDiffTool } from '../tools/time'
import { HashTool, HmacTool, AesTool, JwtTool, HashIdentifyTool } from '../tools/crypto'
import { ReverseShellTool, PayloadCheatSheetTool, PortRefTool, HttpStatusTool, SubnetTool, ChmodTool } from '../tools/security'
import { YamlTool, JsonPathTool, CssTool } from '../tools/dataformats'
import { ColorTool, ImgBase64Tool, StringEscapeTool } from '../tools/converters'
import { UrlParserTool, UserAgentTool, IpIntTool, CookieTool } from '../tools/network'
import { XorTool, RotTool, VigenereTool, PrivescTool } from '../tools/offsec'

export type CategoryId =
  | 'encoding' | 'format' | 'generators' | 'crypto' | 'text'
  | 'datetime' | 'network' | 'offsec' | 'reference'

export interface ToolDef {
  /** Stable tool id, also the key in TOOLS_L */
  id: ToolId
  /** Language-neutral category id; display name comes from CATEGORY_L */
  category: CategoryId
  keywords: string[]
  hot?: boolean
  component: React.ComponentType
}

export const CATEGORIES: CategoryId[] = [
  'encoding',
  'format',
  'generators',
  'crypto',
  'text',
  'datetime',
  'network',
  'offsec',
  'reference',
] as const

export const TOOLS: ToolDef[] = [
  // Encoding
  // NOTE: `keywords` are extra bilingual search aliases (matched in both locales).
  { id: 'base64', category: 'encoding', keywords: ['base64', 'b64', '编码'], hot: true, component: Base64Tool },
  { id: 'url-codec', category: 'encoding', keywords: ['url', 'uri', '百分号', 'urlencode'], component: UrlTool },
  { id: 'unicode', category: 'encoding', keywords: ['unicode', '转义', '中文'], component: UnicodeTool },
  { id: 'radix', category: 'encoding', keywords: ['进制', 'hex', 'binary', 'bin', 'oct'], component: RadixTool },
  { id: 'html-entity', category: 'encoding', keywords: ['html', 'entity', '实体', 'xss'], component: HtmlEntityTool },
  { id: 'morse', category: 'encoding', keywords: ['morse', '摩斯', '电码'], component: MorseTool },
  { id: 'str-escape', category: 'encoding', keywords: ['escape', '编码', '绕过', 'waf', 'hex'], component: StringEscapeTool },

  // Data formats
  { id: 'yaml-json', category: 'format', keywords: ['yaml', 'yml', 'json', 'k8s', '配置'], hot: true, component: YamlTool },
  { id: 'jsonpath', category: 'format', keywords: ['jsonpath', 'json', '查询', '提取'], component: JsonPathTool },
  { id: 'css-format', category: 'format', keywords: ['css', '样式', '美化', 'minify'], component: CssTool },

  // Network
  { id: 'url-parser', category: 'network', keywords: ['url', 'uri', 'query', '参数'], hot: true, component: UrlParserTool },
  { id: 'ua-parser', category: 'network', keywords: ['ua', 'user-agent', '浏览器', '爬虫'], component: UserAgentTool },
  { id: 'ip-int', category: 'network', keywords: ['ip', 'int', 'ssrf', '绕过', '0x7f'], component: IpIntTool },
  { id: 'cookie', category: 'network', keywords: ['cookie', 'set-cookie', 'session', '会话'], component: CookieTool },

  // Formatters
  { id: 'json', category: 'format', keywords: ['json', '格式化', '压缩', '校验'], hot: true, component: JsonTool },
  { id: 'sql-format', category: 'format', keywords: ['sql', 'mysql', '美化'], component: SqlTool },
  { id: 'xml-format', category: 'format', keywords: ['xml', 'html', '格式化'], component: XmlTool },
  { id: 'markdown', category: 'format', keywords: ['markdown', 'md', '预览'], component: MarkdownTool },

  // Generators
  { id: 'uuid', category: 'generators', keywords: ['uuid', 'guid', '随机'], component: UuidTool },
  { id: 'password', category: 'generators', keywords: ['password', '密码', 'random'], hot: true, component: PasswordTool },
  { id: 'qrcode', category: 'generators', keywords: ['qrcode', 'qr', '二维码'], component: QrTool },
  { id: 'fake-data', category: 'generators', keywords: ['测试数据', 'mock', 'fake', '假数据'], component: FakeDataTool },
  { id: 'color', category: 'generators', keywords: ['color', '颜色', 'hex', 'rgb', 'hsl'], component: ColorTool },
  { id: 'img-base64', category: 'generators', keywords: ['image', 'base64', 'dataurl', '图片'], component: ImgBase64Tool },

  // Crypto & hash
  { id: 'hash', category: 'crypto', keywords: ['hash', 'md5', 'sha', '哈希', '散列'], hot: true, component: HashTool },
  { id: 'hmac', category: 'crypto', keywords: ['hmac', '签名', 'sign'], component: HmacTool },
  { id: 'aes', category: 'crypto', keywords: ['aes', '加密', '解密', 'encrypt'], component: AesTool },
  { id: 'jwt', category: 'crypto', keywords: ['jwt', 'token', '解码'], hot: true, component: JwtTool },
  { id: 'hash-id', category: 'crypto', keywords: ['hash', '识别', 'hashcat', 'ntlm', 'bcrypt'], component: HashIdentifyTool },
  { id: 'xor', category: 'crypto', keywords: ['xor', '异或', 'ctf', '加解密'], component: XorTool },
  { id: 'rot', category: 'crypto', keywords: ['rot13', 'caesar', '凯撒', 'rot47'], component: RotTool },
  { id: 'vigenere', category: 'crypto', keywords: ['vigenere', '维吉尼亚', '古典密码'], component: VigenereTool },

  // Text
  { id: 'diff', category: 'text', keywords: ['diff', '对比', '比较'], component: DiffTool },
  { id: 'regex', category: 'text', keywords: ['regex', '正则', 'regexp'], hot: true, component: RegexTool },
  { id: 'word-count', category: 'text', keywords: ['字数', '统计', 'count'], component: WordCountTool },
  { id: 'case-convert', category: 'text', keywords: ['驼峰', '下划线', '大小写', 'camel', 'snake'], component: CaseTool },
  { id: 'line-ops', category: 'text', keywords: ['行', '去重', '排序', 'dedupe'], component: LineOpsTool },

  // Date & time
  { id: 'timestamp', category: 'datetime', keywords: ['timestamp', '时间戳', 'unix'], hot: true, component: TimestampTool },
  { id: 'cron', category: 'datetime', keywords: ['cron', 'crontab', '定时'], component: CronTool },
  { id: 'date-diff', category: 'datetime', keywords: ['日期', '差', 'date'], component: DateDiffTool },

  // Offensive security
  { id: 'revshell', category: 'offsec', keywords: ['reverse', 'shell', '反弹', 'shellcode', 'nc'], hot: true, component: ReverseShellTool },
  { id: 'payloads', category: 'offsec', keywords: ['payload', 'sqli', 'xss', '注入', 'lfi', 'ssti', 'xxe'], hot: true, component: PayloadCheatSheetTool },
  { id: 'ports', category: 'offsec', keywords: ['port', '端口', 'nmap', '服务'], component: PortRefTool },
  { id: 'privesc', category: 'offsec', keywords: ['privesc', '提权', 'suid', 'sudo', 'root', 'system'], hot: true, component: PrivescTool },

  // Reference
  { id: 'http-status', category: 'reference', keywords: ['http', '状态码', '404', '500'], component: HttpStatusTool },
  { id: 'subnet', category: 'reference', keywords: ['subnet', '子网', 'cidr', 'ip', '掩码'], component: SubnetTool },
  { id: 'chmod', category: 'reference', keywords: ['chmod', '权限', '755', 'linux'], component: ChmodTool },
]

/**
 * Search across display names, descriptions, category names and keywords.
 * Both locales are always matched, so "json" works in the zh UI and
 * "格式化" still works in the en UI. `keywords` holds extra bilingual aliases.
 */
export function searchTools(q: string): ToolDef[] {
  if (!q.trim()) return TOOLS
  const query = q.trim().toLowerCase()
  return TOOLS.filter(t => {
    const zh = TOOLS_L.zh[t.id]
    const en = TOOLS_L.en[t.id]
    const haystack = [
      zh.name, zh.desc, en.name, en.desc,
      CATEGORY_L.zh[t.category], CATEGORY_L.en[t.category],
      ...t.keywords,
    ]
    return haystack.some(s => s.toLowerCase().includes(query))
  })
}
