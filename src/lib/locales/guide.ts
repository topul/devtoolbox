/**
 * 工具页「三步引导」的统一文案库。
 *
 * 为什么单独一个文件：引导步对**每一个**工具都成立（先粘什么 → 点什么 → 看什么），
 * 属于壳层文案而不是某个工具的私有文案。放这里有两个好处：
 *   1. smoke:render 的「英文渲染不能含中文」检查能覆盖到它（原来逐页硬编码中文，
 *      英文界面下会直接漏中文到界面上）；
 *   2. i18n:check 把两个分支的键一致性，漏写会在 CI 就红。
 *
 * 每条引导都是三步：粘什么 → 点什么 → 看什么。与 ToolShell 的 steps 一一对应。
 */

export interface GuideStrings {
  /** 引导条标题 */
  title: string
  /** ⌘↵ 提示里的动作名 */
  submit: string
  /** 示例条前缀 */
  example: string
}

export interface ToolGuideText {
  title: string
  steps: string[]
  /** 有警告性的注意事项（可选） */
  note?: string
  /** ⌘↵ 的动作名；给了才会显示快捷键提示 */
  submit?: string
}

const zh = {
  shell: { title: '怎么用', exampleLabel: '示例：' },
  base64: {
    steps: [
      '把原文或 Base64 粘进输入框',
      '点「编码」转成 Base64，点「解码」还原',
      '结果可直接复制，或点「互换」把它送回输入框继续处理',
    ],
    submit: '编码',
  },
  url: {
    steps: [
      '把待编码的文本或整条 URL 粘进输入框',
      '按需要选 encodeURIComponent（转义单段）/ encodeURI（保留分隔符）/ 解码',
      '确认结果里的 %XX 没有被重复编码',
    ],
    submit: 'encodeURIComponent',
  },
  unicode: {
    steps: [
      '把带重音或特殊符号的文本粘进来（如 café）',
      '「转义」得到 \\uXXXX 形式，「反转义」还原',
      '排查乱码时对照两边的码位',
    ],
    submit: '转义',
  },
  radix: {
    steps: [
      '输入一个数（如 255）',
      '选它当前是什么进制',
      '下方会同时给出二 / 八 / 十 / 十六四种表示',
    ],
  },
  htmlEntity: {
    steps: [
      '把含尖括号或 & 的 HTML 片段粘进来',
      '「编码」把 < > & 变成实体，「解码」还原',
      '排查 XSS 绕过时对照编码前后的差异',
    ],
    submit: '编码',
  },
  morse: {
    steps: [
      '输入字母、数字或点划（. -）',
      '「转摩斯」出点划序列，「从摩斯」还原文字',
      '中文暂不支持，先转成拼音或字母',
    ],
    submit: '转摩斯',
  },
  yamlJson: {
    steps: ['粘一段 YAML 或 JSON', '点转换，另一侧实时出结果', '常见坑：YAML 的 tab 缩进不被接受'],
    submit: '转换',
  },
  jsonPath: {
    steps: ['粘一段 JSON', '用 $.a.b[0] 这样的路径表达式取值', '拿不到值时先用格式化确认结构'],
    submit: '取值',
  },
  cssFormat: {
    steps: ['粘一段 CSS', '「美化」展开缩进，「压缩」压成一行', '注意：压缩版不保留注释'],
    submit: '美化',
  },
  tomlJson: {
    steps: ['粘一段 TOML', '点转换得到 JSON', 'TOML 的日期会被转成 ISO 字符串'],
    submit: '转换',
  },
  csvJson: {
    steps: [
      '粘 CSV 文本，第一行必须是表头',
      '选择分隔符（逗号 / 制表符 / 分号）',
      '点转换得到 JSON 数组',
    ],
    submit: '转换',
  },
  json: {
    steps: [
      '粘一段 JSON',
      '「美化」缩进对齐，「压缩」去掉所有空白',
      '「校验」只做语法检查，不查语义',
    ],
    submit: '美化',
  },
  sqlFormat: {
    steps: ['粘一段 SQL', '选择方言与缩进风格', '只重排格式，不会改写语义'],
    submit: '格式化',
  },
  xmlFormat: {
    steps: ['粘一段 XML 或 HTML', '「美化」按层级缩进', '不含声明头的片段也能处理'],
    submit: '美化',
  },
  markdown: {
    steps: [
      '左边写 Markdown，右边实时预览',
      '预览区支持 GFM 表格与代码高亮',
      '外链会走系统浏览器打开',
    ],
  },
  urlParser: {
    steps: [
      '粘一条完整 URL',
      '逐段看协议 / 主机 / 端口 / 路径 / 参数',
      '含中文的域名会同时给出 Punycode',
    ],
  },
  uaParser: {
    steps: ['粘一条 User-Agent', '对照识别出的浏览器、系统与引擎', 'UA 可以伪造，识别结果只作参考'],
  },
  ipInt: {
    steps: ['输入 IP 或十进制整数', '两边互相换算', '注意 127.0.0.1 的整数值不止一种写法'],
  },
  cookie: {
    steps: [
      '粘 Cookie 头或 Set-Cookie',
      '逐条看属性（Domain / Path / Secure / HttpOnly）',
      '排查会话 fixation 时看 SameSite',
    ],
  },
  dnsLookup: {
    steps: ['输入域名（如 github.com）', '选记录类型与 DoH 端点', 'NXDOMAIN 与 SERVFAIL 含义不同'],
    submit: '查询',
  },
  headerAudit: {
    steps: [
      '把响应头整段粘进来（或填 URL 现场抓）',
      '逐条看缺失项与风险等级',
      '「一键生成」可直接拿去改配置',
    ],
    submit: '审计',
  },
  uuid: {
    steps: ['设定数量与大小写/连字符选项', '点生成', '每点一次都是一批新的随机值'],
    submit: '生成',
  },
  password: {
    steps: ['设定长度与字符集', '点生成，看右侧强度条', '强度按熵值估算，不等同于线上强度'],
    submit: '生成',
  },
  qrcode: {
    steps: ['输入要编码的文本或 URL', '调整容错级别与尺寸', '点下载导出 PNG'],
    submit: '生成',
  },
  fakeData: {
    steps: ['描述字段（如 name,email,age）', '设定行数与随机种子', '点生成得到 CSV'],
    submit: '生成',
  },
  color: {
    steps: ['输入 HEX 或 RGB', '在色块之间点选可读的搭配', '下方给出对比度与无障碍等级'],
  },
  hash: {
    steps: ['输入原文', '选算法与输出格式（hex / base64）', '同一算法下不同格式结果等价'],
    submit: '计算',
  },
  hmac: {
    steps: ['输入原文与密钥', '选算法', '对比端务必用同一密钥，否则结果不同'],
    submit: '计算',
  },
  aes: {
    steps: ['输入明文或密文、密钥、IV', '选模式与编码', 'ECB 不建议用于真实数据'],
    submit: '加解密',
  },
  jwt: {
    steps: [
      '粘一个 JWT',
      '看 header / payload 的解析结果',
      '本工具只解码不验签；要验签用「JWT 弱密钥」',
    ],
  },
  hashId: {
    steps: ['粘一段哈希串', '按长度与特征逐个比对', '无法唯一确定时会给多个候选'],
  },
  xor: {
    steps: ['输入密文（十六进制或文本）与密钥', '点解密', '单字节 XOR 对长密钥并不可靠'],
    submit: '解密',
  },
  rot: {
    steps: ['输入原文', '选位移量（ROT13 即 13）', '连续两次 ROT13 会回到原文'],
    submit: '转换',
  },
  vigenere: {
    steps: ['输入明文与密钥词', '点加密 / 解密', '密钥重复不足时会降低强度'],
    submit: '加密',
  },
  x509: {
    steps: [
      '粘 PEM 证书或上传文件',
      '逐段看主体 / 有效期 / 扩展 / 指纹',
      '「证书链」可以看签发链是否完整',
    ],
  },
  jwtCrack: {
    steps: ['粘 JWT 与候选密钥（如 secret）', '点测试', '也会检测 alg=none 这类算法混淆'],
    submit: '测试',
  },
  diff: {
    steps: ['左右分别粘入两段文本', '逐行看差异标记', '忽略大小写 / 忽略空白可切换'],
    submit: '对比',
  },
  regex: {
    steps: ['填入正则表达式与测试文本', '实时看每一处匹配', '「常用」里有几个能直接用的模板'],
  },
  wordCount: {
    steps: ['粘入文本', '中英文分别统计，字数口径见说明', '结果随输入实时更新'],
  },
  caseConvert: {
    steps: ['粘入标识符或句子', '点目标风格', '中文场景注意驼峰会丢语义'],
    submit: '转换',
  },
  lineOps: {
    steps: ['粘入多行文本', '选去重 / 排序 / 过滤', '「去重」保留首次出现的行'],
    submit: '执行',
  },
  timestamp: {
    steps: ['粘时间戳或填可读时间', '两边实时互转', '注意秒 / 毫秒的位数差别'],
  },
  cron: {
    steps: ['填 cron 表达式', '看未来 10 次的触发时间', '秒级调度需要 6 位表达式'],
  },
  dateDiff: {
    steps: ['填两个日期时间', '看相差的年 / 月 / 日 / 时 / 分', '默认按时区本地时间计算'],
    submit: '计算',
  },
  timezone: {
    steps: ['填一个时间点', '在右侧加任意时区对比', '留空则用当前时刻'],
  },
  subnet: {
    steps: [
      '输入 CIDR（如 192.168.1.0/24）',
      '看网络地址 / 广播地址 / 可用主机数',
      '点容量可展开前若干个地址',
    ],
  },
  chmod: {
    steps: [
      '输入八进制（如 755）或勾选权限位',
      '两种写法实时互转',
      '注意 setuid / setgid / sticky 位',
    ],
  },
  httpStatus: {
    steps: ['输入状态码或从列表里点', '看含义与排查建议', '5xx 是服务端问题，4xx 通常是请求问题'],
  },
  httpClient: {
    steps: [
      '填 URL、方法、头与请求体',
      '⌘↵ 直接发送',
      '「历史」可回填之前的请求，「代码」可生成八种语言的调用代码',
    ],
  },
  trafficProxy: {
    steps: [
      '点「启动代理」并按提示信任根证书',
      '把浏览器或 App 的代理指到本地端口',
      '在「记录」里点开任意一条可重放',
    ],
  },
  sse: {
    steps: ['填 SSE 端点 URL', '点连接后看事件流逐帧到达', '断线可自动重连'],
    submit: '连接',
  },
  websocket: {
    steps: ['填 ws:// 或 wss:// 地址', '连接后在下方收发消息', '每条消息带时间戳，方便看心跳'],
    submit: '连接',
  },
  toolSchema: {
    steps: [
      '粘一份 JSON Schema 定义',
      '在三种互转形态之间切换',
      '转换后可导出 TypeScript / Pydantic 类型',
    ],
    submit: '转换',
  },
  agentRules: {
    steps: ['选要扫描的项目目录', '生成 AGENTS.md 候选内容', '扫描只读事实，不会改你的仓库'],
    submit: '扫描',
  },
  mcpServer: {
    steps: [
      '点启动，MCP 服务以 stdio 方式暴露内置工具目录',
      '把生成器里那段配置贴进你的 AI 客户端',
      '调试用「MCP 客户端」连回来验工具',
    ],
    submit: '启动',
  },
  mcpInspector: {
    steps: [
      '填 stdio 命令（默认就是本应用自身）',
      '点连接，看服务器信息与工具目录',
      '选一个工具手动调用，原始响应都在',
    ],
  },
  chatCompare: {
    steps: ['至少配两个模型档位', '发同一条消息，看并排回复', '统计首字延迟与总耗时，用于模型选型'],
  },
  jwtSign: {
    steps: [
      '填 header / payload 与密钥',
      '选算法（HS256/384/512、RS/ES、none）',
      '生成后可直接粘到请求头里用',
    ],
    submit: '签名',
  },
  totp: {
    steps: [
      '填 Base32 密钥（来自服务商的设置页）',
      '看当前 6 位验证码与剩余秒数',
      '校验模式可反过来验一个码是否有效',
    ],
    submit: '生成',
  },
  globTester: {
    steps: [
      '上面填 glob 模式，每行一条',
      '下面粘贴待测路径，矩阵实时给出每条是否命中',
      '排查 .gitignore 不生效时，试试 basename 开关',
    ],
  },
  tokenCounter: {
    steps: [
      '粘一段要发给模型的文本，或填 messages JSON 数组',
      '下方实时给出 token / 字符 / 中文 / 单词的估算',
      'messages 模式会按条拆出各自的估算',
    ],
  },
  dockerCompose: {
    steps: [
      '粘贴完整的 docker run 命令',
      '点转换得到 compose 的 services 片段（YAML）',
      '不认识的 flag 会被丢弃，尾部命令原样保留',
    ],
    submit: '转换',
  },
  floatBits: {
    steps: [
      '输入一个数（0.1、NaN、Infinity 都行）',
      '选 16 / 32 / 64 位，看 sign / exponent / mantissa 位型',
      '把位串粘回来可以反向还原成数值',
    ],
  },
  units: {
    steps: [
      '输入数值，选源单位',
      '换算到单个目标单位，或直接看全部单位对照',
      '注意 KB（1000）与 KiB（1024）是两套前缀',
    ],
  },
  portLookup: {
    steps: [
      '输入要查的端口号',
      '点查询，看是哪个进程在监听',
      '需要桌面版：走系统的 lsof / netstat',
    ],
    submit: '查询',
  },
  loadTest: {
    steps: [
      '填目标 URL 与并发数、请求数',
      '点开始压测，随时可停',
      '看 RPS 与 p50 / p90 / p99 延迟分布',
    ],
    submit: '开始',
  },
}

const en: typeof zh = {
  shell: { title: 'How to use', exampleLabel: 'Example:' },
  base64: {
    steps: [
      'Paste the plain text or a Base64 string into the input',
      'Click Encode for Base64, Decode to go back',
      'Copy the result, or click Swap to send it back into the input',
    ],
    submit: 'Encode',
  },
  url: {
    steps: [
      'Paste the text or the full URL to encode',
      'Pick encodeURIComponent (one segment), encodeURI (keeps separators) or Decode',
      'Check that %XX sequences are not double-encoded',
    ],
    submit: 'encodeURIComponent',
  },
  unicode: {
    steps: [
      'Paste text with accents or special symbols (e.g. café)',
      'Escape produces \\uXXXX, Unescape reverses it',
      'Compare both sides when debugging mojibake',
    ],
    submit: 'Escape',
  },
  radix: {
    steps: [
      'Enter a number such as 255',
      'Pick the base it is currently written in',
      'The binary / octal / decimal / hex forms show up below',
    ],
  },
  htmlEntity: {
    steps: [
      'Paste an HTML fragment containing < > or &',
      'Encode turns them into entities, Decode reverses it',
      'Compare before and after when testing XSS bypasses',
    ],
    submit: 'Encode',
  },
  morse: {
    steps: [
      'Enter letters, digits or dots and dashes (. -)',
      'To Morse gives the sequence, From Morse brings back the text',
      'Chinese is not supported — convert to pinyin or letters first',
    ],
    submit: 'To Morse',
  },
  yamlJson: {
    steps: [
      'Paste some YAML or JSON',
      'Convert and the other side updates live',
      'Common pitfall: YAML rejects tab indentation',
    ],
    submit: 'Convert',
  },
  jsonPath: {
    steps: [
      'Paste a JSON document',
      'Use a path expression such as $.a.b[0] to pull values out',
      'If nothing comes back, format first to check the shape',
    ],
    submit: 'Extract',
  },
  cssFormat: {
    steps: [
      'Paste some CSS',
      'Beautify expands the indentation, Minify squeezes it to one line',
      'Note: the minified form drops comments',
    ],
    submit: 'Beautify',
  },
  tomlJson: {
    steps: ['Paste some TOML', 'Click convert to get JSON', 'TOML dates become ISO strings'],
    submit: 'Convert',
  },
  csvJson: {
    steps: [
      'Paste CSV text; the first line must be the header',
      'Choose the delimiter (comma / tab / semicolon)',
      'Click convert to get a JSON array',
    ],
    submit: 'Convert',
  },
  json: {
    steps: [
      'Paste some JSON',
      'Beautify indents it, Minify strips all whitespace',
      'Validate only checks syntax, not semantics',
    ],
    submit: 'Beautify',
  },
  sqlFormat: {
    steps: [
      'Paste some SQL',
      'Choose the dialect and indentation style',
      'Only the layout changes — the meaning is untouched',
    ],
    submit: 'Format',
  },
  xmlFormat: {
    steps: [
      'Paste some XML or HTML',
      'Beautify indents by nesting level',
      'Fragments without a declaration header are fine',
    ],
    submit: 'Beautify',
  },
  markdown: {
    steps: [
      'Write Markdown on the left, the preview updates live on the right',
      'The preview supports GFM tables and code highlighting',
      'External links open in your system browser',
    ],
  },
  urlParser: {
    steps: [
      'Paste a complete URL',
      'Review protocol / host / port / path / query section by section',
      'Domains with non-ASCII characters also show their Punycode form',
    ],
  },
  uaParser: {
    steps: [
      'Paste a User-Agent string',
      'Compare the detected browser, OS and engine',
      'UA strings are spoofable — treat the result as a hint',
    ],
  },
  ipInt: {
    steps: [
      'Enter an IP or a decimal integer',
      'The two forms convert into each other',
      'Note 127.0.0.1 has more than one integer spelling',
    ],
  },
  cookie: {
    steps: [
      'Paste a Cookie header or a Set-Cookie line',
      'Review each attribute (Domain / Path / Secure / HttpOnly)',
      'Watch SameSite when debugging session fixation',
    ],
  },
  dnsLookup: {
    steps: [
      'Enter a domain such as github.com',
      'Pick the record type and the DoH endpoint',
      'NXDOMAIN and SERVFAIL mean different things',
    ],
    submit: 'Query',
  },
  headerAudit: {
    steps: [
      'Paste the whole response header block (or fill a URL to fetch it)',
      'Review each finding and its severity',
      'The generated snippet can be pasted straight into your config',
    ],
    submit: 'Audit',
  },
  uuid: {
    steps: [
      'Set the count plus the case and dash options',
      'Click generate',
      'Every click produces a fresh batch',
    ],
    submit: 'Generate',
  },
  password: {
    steps: [
      'Set the length and character sets',
      'Click generate and read the strength bar',
      'Strength is an entropy estimate, not a guarantee',
    ],
    submit: 'Generate',
  },
  qrcode: {
    steps: [
      'Enter the text or URL to encode',
      'Adjust the error correction level and size',
      'Download to export a PNG',
    ],
    submit: 'Generate',
  },
  fakeData: {
    steps: [
      'Describe the fields, e.g. name,email,age',
      'Set the row count and random seed',
      'Click generate to get CSV',
    ],
    submit: 'Generate',
  },
  color: {
    steps: [
      'Enter a HEX or RGB value',
      'Click through the swatches to find a readable pairing',
      'Contrast ratio and accessibility level show up below',
    ],
  },
  hash: {
    steps: [
      'Enter the plain text',
      'Pick the algorithm and output format (hex / base64)',
      'For one algorithm the formats are equivalent',
    ],
    submit: 'Compute',
  },
  hmac: {
    steps: [
      'Enter the message and the secret',
      'Pick the algorithm',
      'Both ends must use the same secret or the results differ',
    ],
    submit: 'Compute',
  },
  aes: {
    steps: [
      'Enter plaintext or ciphertext, the key and the IV',
      'Pick the mode and encoding',
      'ECB is not a good fit for real data',
    ],
    submit: 'Crypt',
  },
  jwt: {
    steps: [
      'Paste a JWT',
      'Read the decoded header and payload',
      'This tool decodes only, it does not verify — use JWT Crack for that',
    ],
  },
  hashId: {
    steps: [
      'Paste a hash string',
      'It is matched by length and character pattern',
      'Several candidates appear when the match is ambiguous',
    ],
  },
  xor: {
    steps: [
      'Enter the ciphertext (hex or text) and the key',
      'Click decrypt',
      'Single-byte XOR is not reliable with long keys',
    ],
    submit: 'Decrypt',
  },
  rot: {
    steps: [
      'Enter the text',
      'Set the shift (ROT13 is shift 13)',
      'Applying ROT13 twice returns the original',
    ],
    submit: 'Convert',
  },
  vigenere: {
    steps: [
      'Enter the plaintext and the key word',
      'Click encrypt or decrypt',
      'A key that repeats too early weakens the cipher',
    ],
    submit: 'Encrypt',
  },
  x509: {
    steps: [
      'Paste a PEM certificate or upload a file',
      'Review subject / validity / extensions / fingerprint',
      'Certificate Chain shows whether the issuing chain is complete',
    ],
  },
  jwtCrack: {
    steps: [
      'Paste the JWT and a candidate secret such as secret',
      'Click test',
      'It also flags alg=none and other algorithm-confusion tricks',
    ],
    submit: 'Test',
  },
  diff: {
    steps: [
      'Paste two texts, one per side',
      'Read the line-level difference markers',
      'Case and whitespace sensitivity can be toggled',
    ],
    submit: 'Compare',
  },
  regex: {
    steps: [
      'Enter the pattern and the text to test against',
      'Every match shows up live',
      'The presets section has a few ready-to-use templates',
    ],
  },
  wordCount: {
    steps: [
      'Paste the text',
      'Chinese and English are counted separately — see the note',
      'The result updates as you type',
    ],
  },
  caseConvert: {
    steps: [
      'Paste an identifier or a sentence',
      'Click the target style',
      'Camel case loses meaning for Chinese input',
    ],
    submit: 'Convert',
  },
  lineOps: {
    steps: [
      'Paste multi-line text',
      'Choose dedupe / sort / filter',
      'Dedupe keeps the first occurrence',
    ],
    submit: 'Run',
  },
  timestamp: {
    steps: [
      'Paste a timestamp or type a readable time',
      'The two sides convert live',
      'Mind the seconds vs milliseconds digit count',
    ],
  },
  cron: {
    steps: [
      'Fill in a cron expression',
      'See the next 10 trigger times',
      'Sub-second scheduling needs a 6-field expression',
    ],
  },
  dateDiff: {
    steps: [
      'Fill in two date-times',
      'Read the difference in years / months / days / hours / minutes',
      'Computed in your local time zone by default',
    ],
    submit: 'Compute',
  },
  timezone: {
    steps: [
      'Fill in one point in time',
      'Add any time zones on the right to compare',
      'Leave blank to use the current moment',
    ],
  },
  subnet: {
    steps: [
      'Enter a CIDR such as 192.168.1.0/24',
      'Read network / broadcast address and usable host count',
      'Click the count to expand the first addresses',
    ],
  },
  chmod: {
    steps: [
      'Enter an octal value such as 755, or tick the permission bits',
      'The two forms convert live',
      'Watch the setuid / setgid / sticky bits',
    ],
  },
  httpStatus: {
    steps: [
      'Enter a status code or click one from the list',
      'Read what it means and how to approach it',
      '5xx is a server-side problem, 4xx usually a request problem',
    ],
  },
  httpClient: {
    steps: [
      'Fill in URL, method, headers and body',
      'Press ⌘↵ to send',
      'History refills earlier requests; Code generates the call in eight languages',
    ],
  },
  trafficProxy: {
    steps: [
      'Click Start proxy and trust the root certificate when prompted',
      'Point your browser or app proxy at the local port',
      'Open any entry under Records to replay it',
    ],
  },
  sse: {
    steps: [
      'Fill in the SSE endpoint URL',
      'Click connect and watch events arrive frame by frame',
      'Reconnection can be automatic',
    ],
    submit: 'Connect',
  },
  websocket: {
    steps: [
      'Enter a ws:// or wss:// address',
      'Connect, then send and receive from the panel below',
      'Every message carries a timestamp, handy for heartbeats',
    ],
    submit: 'Connect',
  },
  toolSchema: {
    steps: [
      'Paste a JSON Schema definition',
      'Switch between the three interoperating forms',
      'Convert, then export TypeScript or Pydantic types',
    ],
    submit: 'Convert',
  },
  agentRules: {
    steps: [
      'Pick the project directory to scan',
      'Generate AGENTS.md candidate content',
      'The scan only reads facts and never modifies your repo',
    ],
    submit: 'Scan',
  },
  mcpServer: {
    steps: [
      'Click start; the MCP server exposes the tools over stdio',
      'Paste the config snippet into your AI client',
      'Use the MCP Inspector to connect back and verify a tool',
    ],
    submit: 'Start',
  },
  mcpInspector: {
    steps: [
      'Fill in the stdio command (it defaults to this app)',
      'Click connect to see server info and the tool catalog',
      'Call a tool by hand; the raw response is shown',
    ],
  },
  chatCompare: {
    steps: [
      'Configure at least two model profiles',
      'Send the same message and read the replies side by side',
      'Time-to-first-token and totals help you pick a model',
    ],
  },
  jwtSign: {
    steps: [
      'Fill in header / payload and the key',
      'Pick the algorithm (HS256/384/512, RS/ES, none)',
      'The result can go straight into an Authorization header',
    ],
    submit: 'Sign',
  },
  totp: {
    steps: [
      'Paste the Base32 secret from the service setup page',
      'Read the current 6-digit code and the seconds left',
      'Verify mode checks whether a given code is valid',
    ],
    submit: 'Generate',
  },
  globTester: {
    steps: [
      'Put glob patterns at the top, one per line',
      'Paste the paths below; the matrix updates live per path',
      'Try the basename toggle when .gitignore rules misbehave',
    ],
  },
  tokenCounter: {
    steps: [
      'Paste the text you plan to send to the model, or a messages JSON array',
      'Token / character / CJK / word estimates update live below',
      'messages mode also breaks the estimate down per message',
    ],
  },
  dockerCompose: {
    steps: [
      'Paste the full docker run command',
      'Click convert to get the compose services snippet (YAML)',
      'Unknown flags are dropped; the trailing command is kept as-is',
    ],
    submit: 'Convert',
  },
  floatBits: {
    steps: [
      'Enter a number (0.1, NaN and Infinity all work)',
      'Pick 16 / 32 / 64-bit to read the sign / exponent / mantissa bits',
      'Paste a bit pattern to decode it back into a number',
    ],
  },
  units: {
    steps: [
      'Enter a value and pick the source unit',
      'Convert to one target unit, or read the full table at once',
      'KB (1000) and KiB (1024) are different prefixes',
    ],
  },
  portLookup: {
    steps: [
      'Enter the port number to look up',
      'Click query to see which process is listening',
      'Desktop only: it shells out to lsof / netstat',
    ],
    submit: 'Query',
  },
  loadTest: {
    steps: [
      'Fill in the target URL plus concurrency and request count',
      'Click start; you can stop it any time',
      'Read RPS and the p50 / p90 / p99 latency profile',
    ],
    submit: 'Start',
  },
}

/**
 * 每条引导的形状。
 *
 * 显式写出来而不是靠 `as const` 推断：否则只有部分工具定义了 `note`/`submit` 时，
 * 联合类型会让这两个属性在别的键上「不存在」，调用处直接报错。
 */
export interface GuideEntry {
  steps: string[]
  /** ⚠️ 注意事项，可选 */
  note?: string
  /** ⌘↵ 的动作名；给了才显示快捷键提示 */
  submit?: string
}

/** 壳层文案（引导条标题、示例条前缀） */
export interface GuideShell {
  title: string
  exampleLabel: string
}

/** 一份引导词条表：壳层文案 + 每个工具的引导 */
export interface GuideDict {
  shell: GuideShell
  [toolKey: string]: GuideShell | GuideEntry
}

export const guideL: Record<'zh' | 'en', GuideDict> = { zh, en }

/**
 * 工具 id → 引导词条键。
 *
 * 为什么要有这层映射：工具 id 是 kebab-case（`url-codec`），JS 里的词条键习惯写
 * camelCase（`htmlEntity`）。如果直接拿 id 当键，两边写法一旦不一致就是
 * 「引导条静默不显示」—— 没有报错、没有警告，只是功能没了。
 *
 * 显式列出所有映射，smoke:ux 会校验：键必须在词条表里存在，且每个有示例的
 * 工具都必须在这里出现（见 smoke:ux「有示例的工具都有引导词条」）。
 */
export const GUIDE_FOR_TOOL: Record<string, GuideKey> = {
  base64: 'base64',
  'url-codec': 'url',
  unicode: 'unicode',
  radix: 'radix',
  'html-entity': 'htmlEntity',
  morse: 'morse',
  'str-escape': 'htmlEntity',
  'base58-32': 'radix',
  punycode: 'url',
  'yaml-json': 'yamlJson',
  jsonpath: 'jsonPath',
  'css-format': 'cssFormat',
  'toml-json': 'tomlJson',
  'csv-json': 'csvJson',
  json: 'json',
  'sql-format': 'sqlFormat',
  'xml-format': 'xmlFormat',
  markdown: 'markdown',
  'url-parser': 'urlParser',
  'ua-parser': 'uaParser',
  'ip-int': 'ipInt',
  cookie: 'cookie',
  'dns-lookup': 'dnsLookup',
  'header-audit': 'headerAudit',
  uuid: 'uuid',
  password: 'password',
  qrcode: 'qrcode',
  'fake-data': 'fakeData',
  color: 'color',
  'img-base64': 'color',
  hash: 'hash',
  hmac: 'hmac',
  aes: 'aes',
  jwt: 'jwt',
  'hash-id': 'hashId',
  xor: 'xor',
  rot: 'rot',
  vigenere: 'vigenere',
  x509: 'x509',
  'jwt-crack': 'jwtCrack',
  diff: 'diff',
  regex: 'regex',
  'word-count': 'wordCount',
  'case-convert': 'caseConvert',
  'line-ops': 'lineOps',
  timestamp: 'timestamp',
  cron: 'cron',
  'date-diff': 'dateDiff',
  timezone: 'timezone',
  subnet: 'subnet',
  chmod: 'chmod',
  'http-status': 'httpStatus',
  'http-client': 'httpClient',
  'traffic-proxy': 'trafficProxy',
  sse: 'sse',
  websocket: 'websocket',
  'tool-schema': 'toolSchema',
  'agent-rules': 'agentRules',
  'mcp-server': 'mcpServer',
  'mcp-inspector': 'mcpInspector',
  'chat-compare': 'chatCompare',
  'jwt-sign': 'jwtSign',
  totp: 'totp',
  'glob-tester': 'globTester',
  'token-counter': 'tokenCounter',
  docker2compose: 'dockerCompose',
  'float-bits': 'floatBits',
  units: 'units',
  'port-lookup': 'portLookup',
  loadtest: 'loadTest',
}

/**
 * 引导词条的键。排除 `shell`（壳层文案，不是某个工具的引导）——
 * 不排除的话 ToolShell 的 `guide` 属性就能接到壳层上，类型系统也拦不住。
 */
export type GuideKey = Exclude<string, 'shell'>
