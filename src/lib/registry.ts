import React from 'react'
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

export interface ToolDef {
  id: string
  name: string
  desc: string
  category: string
  keywords: string[]
  hot?: boolean
  component: React.ComponentType
}

export const CATEGORIES = ['编码转换', '格式化', '生成器', '加密与哈希', '文本处理', '时间与日期', '网络解析', '渗透测试', '参考速查'] as const

export const TOOLS: ToolDef[] = [
  // 编码转换
  { id: 'base64', name: 'Base64 编解码', desc: '文本与 Base64 互转，支持 UTF-8 中文', category: '编码转换', keywords: ['base64', 'b64', '编码'], hot: true, component: Base64Tool },
  { id: 'url-codec', name: 'URL 编解码', desc: 'encodeURIComponent / encodeURI / 解码', category: '编码转换', keywords: ['url', 'uri', '百分号', 'urlencode'], component: UrlTool },
  { id: 'unicode', name: 'Unicode 转义', desc: '中文与 \\uXXXX 转义序列互转', category: '编码转换', keywords: ['unicode', '转义', '中文'], component: UnicodeTool },
  { id: 'radix', name: '进制转换', desc: '二 / 八 / 十 / 十六进制互转', category: '编码转换', keywords: ['进制', 'hex', 'binary', 'bin', 'oct'], component: RadixTool },
  { id: 'html-entity', name: 'HTML 实体编码', desc: '< > & " 与 HTML 实体互转', category: '编码转换', keywords: ['html', 'entity', '实体', 'xss'], component: HtmlEntityTool },
  { id: 'morse', name: '摩尔斯电码', desc: '文本与摩尔斯电码互转', category: '编码转换', keywords: ['morse', '摩斯', '电码'], component: MorseTool },
  { id: 'str-escape', name: '多重编码链', desc: 'URL/HTML/Unicode/Hex 一键多层编码与解码', category: '编码转换', keywords: ['escape', '编码', '绕过', 'waf', 'hex'], component: StringEscapeTool },

  // 数据格式
  { id: 'yaml-json', name: 'YAML ↔ JSON', desc: 'YAML 与 JSON 双向转换', category: '格式化', keywords: ['yaml', 'yml', 'json', 'k8s', '配置'], hot: true, component: YamlTool },
  { id: 'jsonpath', name: 'JSONPath 查询', desc: '用 JSONPath 表达式从 JSON 中提取数据', category: '格式化', keywords: ['jsonpath', 'json', '查询', '提取'], component: JsonPathTool },
  { id: 'css-format', name: 'CSS 格式化', desc: 'CSS 美化 / 压缩 / 去注释', category: '格式化', keywords: ['css', '样式', '美化', 'minify'], component: CssTool },

  // 网络解析
  { id: 'url-parser', name: 'URL 解析器', desc: '拆解协议/主机/路径/查询参数，批量解析参数', category: '网络解析', keywords: ['url', 'uri', 'query', '参数'], hot: true, component: UrlParserTool },
  { id: 'ua-parser', name: 'User-Agent 解析', desc: '识别浏览器 / 操作系统 / 设备 / 爬虫', category: '网络解析', keywords: ['ua', 'user-agent', '浏览器', '爬虫'], component: UserAgentTool },
  { id: 'ip-int', name: 'IP 整形转换', desc: 'IP ↔ 整数/十六进制，SSRF 绕过技巧', category: '网络解析', keywords: ['ip', 'int', 'ssrf', '绕过', '0x7f'], component: IpIntTool },
  { id: 'cookie', name: 'Cookie 解析', desc: '解析 Set-Cookie / Cookie 头各字段含义', category: '网络解析', keywords: ['cookie', 'set-cookie', 'session', '会话'], component: CookieTool },

  // 格式化
  { id: 'json', name: 'JSON 格式化', desc: '格式化 / 压缩 / 校验 / 转义 JSON', category: '格式化', keywords: ['json', '格式化', '压缩', '校验'], hot: true, component: JsonTool },
  { id: 'sql-format', name: 'SQL 格式化', desc: '美化 SQL：关键字大写、分句换行', category: '格式化', keywords: ['sql', 'mysql', '美化'], component: SqlTool },
  { id: 'xml-format', name: 'XML / HTML 格式化', desc: '缩进美化或压缩标记语言', category: '格式化', keywords: ['xml', 'html', '格式化'], component: XmlTool },
  { id: 'markdown', name: 'Markdown 预览', desc: '左侧编辑右侧实时渲染', category: '格式化', keywords: ['markdown', 'md', '预览'], component: MarkdownTool },

  // 生成器
  { id: 'uuid', name: 'UUID 生成器', desc: '批量生成 UUID v4，可去横线 / 大写', category: '生成器', keywords: ['uuid', 'guid', '随机'], component: UuidTool },
  { id: 'password', name: '随机密码生成', desc: '可配置字符集与长度，含熵值强度评估', category: '生成器', keywords: ['password', '密码', 'random'], hot: true, component: PasswordTool },
  { id: 'qrcode', name: '二维码生成', desc: '文本 / 链接 / WiFi 生成二维码，可下载', category: '生成器', keywords: ['qrcode', 'qr', '二维码'], component: QrTool },
  { id: 'fake-data', name: '测试数据生成', desc: '姓名 / 手机 / 身份证 / IP 等虚拟数据，导出 JSON / CSV', category: '生成器', keywords: ['测试数据', 'mock', 'fake', '假数据'], component: FakeDataTool },
  { id: 'color', name: '颜色转换器', desc: 'HEX / RGB / HSL 互转，带取色器与调色板', category: '生成器', keywords: ['color', '颜色', 'hex', 'rgb', 'hsl'], component: ColorTool },
  { id: 'img-base64', name: '图片转 Base64', desc: '本地图片转 DataURL，可反向还原下载', category: '生成器', keywords: ['image', 'base64', 'dataurl', '图片'], component: ImgBase64Tool },

  // 加密与哈希
  { id: 'hash', name: '哈希计算', desc: 'MD5 / SHA-1 / SHA-256 / SHA-512 / SHA-3 / RIPEMD160', category: '加密与哈希', keywords: ['hash', 'md5', 'sha', '哈希', '散列'], hot: true, component: HashTool },
  { id: 'hmac', name: 'HMAC 签名', desc: 'HMAC-MD5 / SHA1 / SHA256 / SHA512', category: '加密与哈希', keywords: ['hmac', '签名', 'sign'], component: HmacTool },
  { id: 'aes', name: 'AES 加解密', desc: 'AES-256 ECB / CBC，Base64 输出', category: '加密与哈希', keywords: ['aes', '加密', '解密', 'encrypt'], component: AesTool },
  { id: 'jwt', name: 'JWT 解码', desc: '解析 Header / Payload，自动识别过期时间', category: '加密与哈希', keywords: ['jwt', 'token', '解码'], hot: true, component: JwtTool },
  { id: 'hash-id', name: 'Hash 类型识别', desc: '根据长度与格式识别哈希算法类型', category: '加密与哈希', keywords: ['hash', '识别', 'hashcat', 'ntlm', 'bcrypt'], component: HashIdentifyTool },
  { id: 'xor', name: 'XOR 加解密', desc: '任意密钥 XOR 运算，支持 Hex 输出，CTF 常客', category: '加密与哈希', keywords: ['xor', '异或', 'ctf', '加解密'], component: XorTool },
  { id: 'rot', name: 'ROT13 / 凯撒', desc: 'ROT13 / ROT47 / 任意位移凯撒密码，含爆破模式', category: '加密与哈希', keywords: ['rot13', 'caesar', '凯撒', 'rot47'], component: RotTool },
  { id: 'vigenere', name: '维吉尼亚密码', desc: '经典多表替换密码加密与解密', category: '加密与哈希', keywords: ['vigenere', '维吉尼亚', '古典密码'], component: VigenereTool },

  // 文本处理
  { id: 'diff', name: '文本 Diff 对比', desc: '基于 LCS 的逐行差异高亮对比', category: '文本处理', keywords: ['diff', '对比', '比较'], component: DiffTool },
  { id: 'regex', name: '正则测试器', desc: '实时匹配、分组提取，内置常用正则', category: '文本处理', keywords: ['regex', '正则', 'regexp'], hot: true, component: RegexTool },
  { id: 'word-count', name: '字数统计', desc: '字符 / 汉字 / 单词 / 行数 / 字节统计', category: '文本处理', keywords: ['字数', '统计', 'count'], component: WordCountTool },
  { id: 'case-convert', name: '命名风格转换', desc: 'camelCase / snake_case / kebab-case 等互转', category: '文本处理', keywords: ['驼峰', '下划线', '大小写', 'camel', 'snake'], component: CaseTool },
  { id: 'line-ops', name: '行处理工具', desc: '去重 / 排序 / 去空行 / 打乱 / 拼接', category: '文本处理', keywords: ['行', '去重', '排序', 'dedupe'], component: LineOpsTool },

  // 时间与日期
  { id: 'timestamp', name: '时间戳转换', desc: 'Unix 时间戳与日期互转，实时当前时间', category: '时间与日期', keywords: ['timestamp', '时间戳', 'unix'], hot: true, component: TimestampTool },
  { id: 'cron', name: 'Crontab 解析', desc: '解析 cron 表达式语义并预测执行时间', category: '时间与日期', keywords: ['cron', 'crontab', '定时'], component: CronTool },
  { id: 'date-diff', name: '日期差计算', desc: '计算两个日期之间的天 / 周 / 小时差', category: '时间与日期', keywords: ['日期', '差', 'date'], component: DateDiffTool },

  // 渗透测试
  { id: 'revshell', name: '反弹 Shell 生成', desc: 'Bash / Python / PHP / PowerShell 等 12 种反弹 Shell', category: '渗透测试', keywords: ['reverse', 'shell', '反弹', 'shellcode', 'nc'], hot: true, component: ReverseShellTool },
  { id: 'payloads', name: 'Payload 速查', desc: 'SQLi / XSS / 命令注入 / LFI / SSTI / XXE 常用 payload', category: '渗透测试', keywords: ['payload', 'sqli', 'xss', '注入', 'lfi', 'ssti', 'xxe'], hot: true, component: PayloadCheatSheetTool },
  { id: 'ports', name: '端口渗透速查', desc: '常见端口服务与攻击面要点速查', category: '渗透测试', keywords: ['port', '端口', 'nmap', '服务'], component: PortRefTool },
  { id: 'privesc', name: '提权速查', desc: 'Linux SUID/sudo/内核与 Windows 提权命令速查', category: '渗透测试', keywords: ['privesc', '提权', 'suid', 'sudo', 'root', 'system'], hot: true, component: PrivescTool },

  // 参考速查
  { id: 'http-status', name: 'HTTP 状态码', desc: '1xx-5xx 状态码完整速查', category: '参考速查', keywords: ['http', '状态码', '404', '500'], component: HttpStatusTool },
  { id: 'subnet', name: '子网计算器', desc: 'CIDR 计算网络地址 / 广播 / 可用主机范围', category: '参考速查', keywords: ['subnet', '子网', 'cidr', 'ip', '掩码'], component: SubnetTool },
  { id: 'chmod', name: 'chmod 计算器', desc: 'Linux 权限八进制与符号表示互转', category: '参考速查', keywords: ['chmod', '权限', '755', 'linux'], component: ChmodTool },
]

export function searchTools(q: string): ToolDef[] {
  if (!q.trim()) return TOOLS
  const query = q.trim().toLowerCase()
  return TOOLS.filter(t =>
    t.name.toLowerCase().includes(query) ||
    t.desc.toLowerCase().includes(query) ||
    t.category.includes(query) ||
    t.keywords.some(k => k.toLowerCase().includes(query))
  )
}
