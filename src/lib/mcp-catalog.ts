/**
 * MCP 工具目录 —— 提供给 AI Agent 的能力清单（纯元数据）。
 *
 * 这里只放「声明」：工具名、说明、参数 Schema。真正的执行体在 `electron/mcp/tools.ts`，
 * 通过 `name` 绑定。之所以拆开，是因为界面（渲染进程）也要列出这份清单，
 * 而执行体依赖 Node 内置模块，不能被渲染层打包进去。
 *
 * 说明文案分中英两份：
 *   - `title` / `description` 是**协议面**文案，客户端（模型）读到的就是它；
 *   - `titleEn` / `descriptionEn` 只给英文界面展示用。
 *
 * 新增能力时三处要同步：本文件、`electron/mcp/tools.ts` 的处理器、
 * `scripts/smoke-mcp.mjs` 的调用参数表 —— 漏了 `npm run smoke:mcp` 会红。
 */

export type McpGroup = 'codec' | 'crypto' | 'data' | 'text' | 'time' | 'net' | 'gen' | 'http'

export interface McpProp {
  type: 'string' | 'number' | 'boolean'
  description: string
  descriptionEn: string
  default?: string | number | boolean
  enum?: string[]
}

export interface McpToolSpec {
  name: string
  title: string
  titleEn: string
  description: string
  descriptionEn: string
  group: McpGroup
  inputSchema: {
    type: 'object'
    properties: Record<string, McpProp>
    required?: string[]
  }
}

export const MCP_GROUPS: McpGroup[] = ['codec', 'crypto', 'data', 'text', 'time', 'net', 'gen', 'http']

const p = (
  type: McpProp['type'],
  description: string,
  descriptionEn: string,
  extra: Partial<McpProp> = {},
): McpProp => ({ type, description, descriptionEn, ...extra })

/** 按界面语言取说明文案 */
export function toolTitle(t: McpToolSpec, locale: 'zh' | 'en'): string {
  return locale === 'en' ? t.titleEn : t.title
}
export function toolDesc(t: McpToolSpec, locale: 'zh' | 'en'): string {
  return locale === 'en' ? t.descriptionEn : t.description
}
export function propDesc(prop: McpProp, locale: 'zh' | 'en'): string {
  return locale === 'en' ? prop.descriptionEn : prop.description
}

export const MCP_TOOLS: McpToolSpec[] = [
  /* ================= codec ================= */
  {
    name: 'base64_encode',
    title: 'Base64 编码',
    titleEn: 'Base64 encode',
    description:
      'UTF-8 文本 → Base64。自动处理中文等多字节字符；urlSafe=true 时用 -_ 替代 +/ 并去掉补位 =，适合放进 URL 或 JWT。',
    descriptionEn:
      'UTF-8 text to Base64. Handles multi-byte characters. urlSafe=true uses -_ instead of +/ and strips padding, for URLs and JWTs.',
    group: 'codec',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '要编码的原文', 'Text to encode'),
        urlSafe: p('boolean', '是否输出 base64url 形式', 'Output base64url form', { default: false }),
      },
      required: ['text'],
    },
  },
  {
    name: 'base64_decode',
    title: 'Base64 解码',
    titleEn: 'Base64 decode',
    description:
      'Base64 → UTF-8 文本。容错处理：忽略空白与换行、接受缺失补位、兼容 base64url 字母表，因此粘贴 JWT 段或带换行的数据都能直接解。',
    descriptionEn:
      'Base64 to UTF-8. Forgiving: ignores whitespace and newlines, accepts missing padding, understands the base64url alphabet.',
    group: 'codec',
    inputSchema: {
      type: 'object',
      properties: { text: p('string', 'Base64 字符串', 'Base64 string') },
      required: ['text'],
    },
  },
  {
    name: 'url_encode',
    title: 'URL 编码',
    titleEn: 'URL encode',
    description:
      'URL 编码。mode=component 编码全部保留字符（用 query 参数值）；mode=full 保留 ?&=/# 只编码非法字符（用整条 URL）；mode=double 双重编码（绕 WAF 或二次解码场景）。',
    descriptionEn:
      'URL encoding. component encodes all reserved characters (query values); full keeps ?&=/# intact (whole URLs); double encodes twice.',
    group: 'codec',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '原文', 'Source text'),
        mode: p('string', '编码方式', 'Encoding mode', { enum: ['component', 'full', 'double'], default: 'component' }),
      },
      required: ['text'],
    },
  },
  {
    name: 'url_decode',
    title: 'URL 解码',
    titleEn: 'URL decode',
    description: 'URL 解码，mode 与 url_encode 对应。',
    descriptionEn: 'URL decoding; modes match url_encode.',
    group: 'codec',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '待解码文本', 'Text to decode'),
        mode: p('string', '解码方式', 'Decoding mode', { enum: ['component', 'full', 'double'], default: 'component' }),
      },
      required: ['text'],
    },
  },
  {
    name: 'escape_convert',
    title: '多编码链转换',
    titleEn: 'Escape chain convert',
    description:
      '一栈式编码/解码：url、doubleUrl、html（数字实体）、unicode（\\uXXXX）、hex（0xNN 逗号分隔）、base64。用于构造 payload 或在几种转义之间互转。',
    descriptionEn:
      'One-stop encode/decode across url, doubleUrl, html numeric entities, unicode (\\uXXXX), hex (comma-separated 0xNN) and base64.',
    group: 'codec',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '原文或已编码文本', 'Source or encoded text'),
        codec: p('string', '编码方式', 'Codec', { enum: ['url', 'doubleUrl', 'html', 'unicode', 'hex', 'base64'] }),
        mode: p('string', '方向', 'Direction', { enum: ['encode', 'decode'], default: 'encode' }),
      },
      required: ['text', 'codec'],
    },
  },
  {
    name: 'html_entity',
    title: 'HTML 实体编解码',
    titleEn: 'HTML entity codec',
    description:
      'HTML 实体转换。encoding 时把 & < > " \' 转义；decoding 时同时支持命名实体与十进制/十六进制数字实体。numeric=true 时每个字符都转成 &#NN; 形式。',
    descriptionEn:
      'HTML entity conversion. Encoding escapes & < > " \'; decoding handles named plus decimal and hex numeric entities.',
    group: 'codec',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '原文', 'Source text'),
        mode: p('string', '方向', 'Direction', { enum: ['encode', 'decode'], default: 'encode' }),
        numeric: p('boolean', '编码时是否用 &#NN; 数字实体', 'Encode as &#NN; numeric entities', { default: false }),
      },
      required: ['text'],
    },
  },
  {
    name: 'radix_convert',
    title: '进制转换',
    titleEn: 'Radix convert',
    description:
      '任意 2-36 进制整数互转，一次给出二进制/八进制/十进制/十六进制。用 BigInt 实现，雪花 ID、64 位掩码这类大整数不会丢精度。',
    descriptionEn:
      'Convert integers between any bases 2-36, returning binary, octal, decimal and hex at once. BigInt backed, so 64-bit values keep full precision.',
    group: 'codec',
    inputSchema: {
      type: 'object',
      properties: {
        input: p('string', '待转换的整数（可带 0x 前缀）', 'Integer to convert (0x prefix allowed)'),
        from: p('number', '源进制，2-36', 'Source radix, 2-36', { default: 10 }),
      },
      required: ['input'],
    },
  },

  /* ================= crypto ================= */
  {
    name: 'hash',
    title: '哈希计算',
    titleEn: 'Hash',
    description:
      '文本摘要。支持 MD5 / SHA1 / SHA256 / SHA512 / SHA3 / RIPEMD160；不传 algorithm 时一次返回全部算法结果。用于校验、指纹、签名前处理。',
    descriptionEn:
      'Message digest: MD5 / SHA1 / SHA256 / SHA512 / SHA3 / RIPEMD160. Omit algorithm to get every variant at once.',
    group: 'crypto',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '原文', 'Source text'),
        algorithm: p('string', '算法', 'Algorithm', { enum: ['MD5', 'SHA1', 'SHA256', 'SHA512', 'SHA3', 'RIPEMD160'] }),
      },
      required: ['text'],
    },
  },
  {
    name: 'hmac',
    title: 'HMAC 签名',
    titleEn: 'HMAC',
    description: 'HMAC 消息认证码，支持 MD5 / SHA1 / SHA256 / SHA512。接口签名验签、回调校验常用。',
    descriptionEn: 'HMAC over MD5 / SHA1 / SHA256 / SHA512 — for API signatures and webhook verification.',
    group: 'crypto',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '消息内容', 'Message'),
        key: p('string', '密钥', 'Secret key'),
        algorithm: p('string', '算法', 'Algorithm', { enum: ['MD5', 'SHA1', 'SHA256', 'SHA512'], default: 'SHA256' }),
      },
      required: ['text', 'key'],
    },
  },
  {
    name: 'aes_crypt',
    title: 'AES 加解密',
    titleEn: 'AES encrypt / decrypt',
    description:
      'AES 对称加解密（ECB/CBC，PKCS7）。密钥右侧补 \\0 到 32 字节；CBC 的 IV 取补足 16 字节后反转。仅用于与本工具箱自身的历史密文互通。',
    descriptionEn:
      'AES symmetric encryption (ECB/CBC, PKCS7). Key is right-padded with \\0 to 32 bytes; CBC IV is the reversed 16-byte pad. Meant for data produced by this toolbox.',
    group: 'crypto',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '明文或密文', 'Plaintext or ciphertext'),
        key: p('string', '密钥', 'Key'),
        mode: p('string', '模式', 'Mode', { enum: ['ECB', 'CBC'], default: 'ECB' }),
        op: p('string', '方向', 'Direction', { enum: ['encrypt', 'decrypt'], default: 'encrypt' }),
      },
      required: ['text', 'key'],
    },
  },
  {
    name: 'jwt_decode',
    title: 'JWT 解码',
    titleEn: 'JWT decode',
    description: '解码 JWT 的 header 与 payload 并展开为标准 JSON，同时标出是否已过期。只解码不验签。',
    descriptionEn:
      'Decode a JWT header and payload into plain JSON and report whether it is expired. Decodes only — no signature verification.',
    group: 'crypto',
    inputSchema: {
      type: 'object',
      properties: { token: p('string', 'JWT 字符串', 'JWT string') },
      required: ['token'],
    },
  },

  /* ================= data ================= */
  {
    name: 'json_format',
    title: 'JSON 格式化',
    titleEn: 'JSON format',
    description:
      '格式化 / 压缩 / 键名排序 JSON。mode=format 带缩进、mode=minify 压成一行、mode=sort 递归按键名排序（便于比对两份配置的差异）。',
    descriptionEn:
      'Format, minify or key-sort JSON. sort recurses so two configs can be compared line by line.',
    group: 'data',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', 'JSON 文本', 'JSON text'),
        mode: p('string', '处理方式', 'Operation', { enum: ['format', 'minify', 'sort'], default: 'format' }),
        indent: p('number', '缩进空格数', 'Indent width', { default: 2 }),
      },
      required: ['text'],
    },
  },
  {
    name: 'json_validate',
    title: 'JSON 校验',
    titleEn: 'JSON validate',
    description: '校验 JSON 语法，返回是否合法；不合法时给出解析器的原始报错信息与位置。',
    descriptionEn: 'Validate JSON syntax and surface the parser error verbatim when it is malformed.',
    group: 'data',
    inputSchema: {
      type: 'object',
      properties: { text: p('string', 'JSON 文本', 'JSON text') },
      required: ['text'],
    },
  },
  {
    name: 'json_query',
    title: 'JSONPath 查询',
    titleEn: 'JSONPath query',
    description:
      "按 JSONPath 取值。支持 $.a.b、$['a b']、$.a[0]、$.a[*]、$..key（递归下降）。用于在嵌套响应里定位字段。",
    descriptionEn:
      "Evaluate a JSONPath expression: $.a.b, $['a b'], $.a[0], $.a[*], $..key recursive descent.",
    group: 'data',
    inputSchema: {
      type: 'object',
      properties: {
        json: p('string', 'JSON 文本', 'JSON text'),
        path: p('string', '表达式，如 $.store.book[*].price', 'Expression, e.g. $.store.book[*].price'),
      },
      required: ['json', 'path'],
    },
  },
  {
    name: 'yaml_convert',
    title: 'YAML ⇄ JSON',
    titleEn: 'YAML ⇄ JSON',
    description:
      'YAML 与 JSON 互转。支持映射、列表、块标量、行内标量、注释；不支持锚点/别名/多文档（写配置够用）。',
    descriptionEn:
      'Convert between YAML and JSON. Handles mappings, lists, block scalars, inline scalars and comments; no anchors, aliases or multi-document.',
    group: 'data',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '源文本', 'Source text'),
        mode: p('string', '方向', 'Direction', { enum: ['yaml2json', 'json2yaml'], default: 'yaml2json' }),
      },
      required: ['text'],
    },
  },

  /* ================= text ================= */
  {
    name: 'text_case',
    title: '命名风格转换',
    titleEn: 'Case conversion',
    description:
      'camelCase / PascalCase / snake_case / SCREAMING_SNAKE / kebab-case 互转，不传 style 时一次给出全部风格。按代码规范批量改名时用。',
    descriptionEn:
      'Convert between camelCase, PascalCase, snake_case, SCREAMING_SNAKE and kebab-case. Omit style to get them all.',
    group: 'text',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '原始标识符或短语', 'Identifier or phrase'),
        style: p('string', '目标风格', 'Target style', {
          enum: ['camelCase', 'PascalCase', 'snake_case', 'SCREAMING_SNAKE', 'kebab-case', 'UPPERCASE', 'lowercase'],
        }),
      },
      required: ['text'],
    },
  },
  {
    name: 'line_ops',
    title: '逐行处理',
    titleEn: 'Line operations',
    description:
      '按行批量处理文本：dedupe 去重、removeEmpty 删空行、trim、sortAsc/sortDesc/sortNumeric 排序、shuffle、reverse、number 加序号、quote 加引号、join 合并成一行。',
    descriptionEn:
      'Line-wise processing: dedupe, removeEmpty, trim, sortAsc / sortDesc / sortNumeric, shuffle, reverse, number, quote, join.',
    group: 'text',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '多行文本', 'Multi-line text'),
        op: p('string', '操作', 'Operation', {
          enum: ['dedupe', 'removeEmpty', 'trim', 'sortAsc', 'sortDesc', 'sortNumeric', 'shuffle', 'reverse', 'number', 'quote', 'join'],
        }),
        separator: p('string', 'op=join 时的连接符', 'Separator when op=join', { default: ',' }),
      },
      required: ['text', 'op'],
    },
  },
  {
    name: 'text_stats',
    title: '文本统计',
    titleEn: 'Text statistics',
    description:
      '统计字符数、去空白字符数、中文字数、英文单词数、行数、段落数、UTF-8 字节数。用于估算 token 量的粗略下界或验证长度限制。',
    descriptionEn:
      'Count characters, non-space characters, CJK characters, words, lines, paragraphs and UTF-8 bytes — a rough lower bound for token counts.',
    group: 'text',
    inputSchema: {
      type: 'object',
      properties: { text: p('string', '文本', 'Text') },
      required: ['text'],
    },
  },
  {
    name: 'estimate_tokens',
    title: 'Token 估算',
    titleEn: 'Token estimate',
    description:
      '估算文本或一段对话的 token 量与协议开销。注意这是按字符估算（±20%），不是真正分词；碎片 token 没法自己算，用它来判断「塞不塞得下上下文」足够。传 messages 时按对话协议额外计入每条消息的固定开销。',
    descriptionEn:
      'Estimate token counts for text or a conversation, including per-message protocol overhead. Heuristic (±20%), not a real tokenizer — good enough for context-window budgeting.',
    group: 'text',
    inputSchema: {
      type: 'object',
      properties: {
        text: p('string', '单段文本；与 messages 二选一', 'Plain text; alternative to messages'),
        messages: p('string', '对话消息的 JSON 数组，如 [{"role":"user","content":"hi"}]', 'JSON array of chat messages, e.g. [{"role":"user","content":"hi"}]'),
      },
    },
  },
  {
    name: 'check_tool_schema',
    title: '工具定义体检与转换',
    titleEn: 'Tool schema lint & convert',
    description:
      '吃 OpenAI tools / MCP inputSchema / 裸 JSON Schema 三种工具定义，输出 TypeScript 接口、Pydantic 模型或归一化后的 JSON Schema，并列出写法问题（required 指向未定义字段、字段缺 description、工具名非法、数组缺 items、default 不在 enum 内等）。刚写完一份工具声明时用它自检，比拼运行时行为省事得多。',
    descriptionEn:
      'Parse an OpenAI tools / MCP inputSchema / bare JSON Schema definition, then emit TypeScript, Pydantic or normalized JSON Schema plus lint findings (required pointing at undefined fields, missing descriptions, invalid tool names, arrays without items). Use it to self-check a declaration you just wrote.',
    group: 'data',
    inputSchema: {
      type: 'object',
      properties: {
        schema: p('string', '工具定义（JSON 文本）', 'Tool definition as JSON text'),
        target: p('string', '输出格式', 'Output format', {
          enum: ['typescript', 'pydantic', 'json', 'openai', 'mcp'],
          default: 'typescript',
        }),
      },
      required: ['schema'],
    },
  },
  {
    name: 'diff',
    title: '文本差异比对',
    titleEn: 'Text diff',
    description:
      '按行做 LCS diff，返回增删行数与逐行结果。format=text 时给可直接读的 +/- 文本，format=json 时给结构化数组。',
    descriptionEn:
      'Line-level LCS diff with added/removed counts. format=text prints readable +/- lines; format=json returns structured rows.',
    group: 'text',
    inputSchema: {
      type: 'object',
      properties: {
        a: p('string', '旧文本', 'Original text'),
        b: p('string', '新文本', 'Revised text'),
        format: p('string', '输出形式', 'Output form', { enum: ['text', 'json'], default: 'text' }),
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'regex_test',
    title: '正则测试',
    titleEn: 'Regex test',
    description:
      '在文本上跑正则，返回每个匹配的位置、内容、捕获组与命名组。最多返回 1000 个匹配；正则语法错误会原样报出。',
    descriptionEn:
      'Run a regex over text and report each match position, content, capture groups and named groups. Up to 1000 matches; syntax errors are reported verbatim.',
    group: 'text',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: p('string', '正则表达式（不含首尾斜杠）', 'Pattern without surrounding slashes'),
        text: p('string', '测试文本', 'Test text'),
        flags: p('string', '标志位', 'Flags', { default: 'g' }),
      },
      required: ['pattern', 'text'],
    },
  },

  /* ================= time ================= */
  {
    name: 'timestamp_convert',
    title: '时间戳 ⇄ 日期',
    titleEn: 'Timestamp ⇄ date',
    description:
      '时间戳与日期互转，同时给出本地时间、UTC、ISO 与秒/毫秒双表示。unit=auto 时按量级自动识别秒/毫秒/微秒/纳秒（Agent 拿到的裸数字常常单位不明）。两个参数都不传则返回当前时间。',
    descriptionEn:
      'Convert between timestamps and dates, returning local time, UTC, ISO and both second and millisecond forms. unit=auto infers the magnitude. Pass neither parameter to get the current time.',
    group: 'time',
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: p('string', '时间戳数字', 'Numeric timestamp'),
        date: p('string', '日期串，如 2026-08-13 12:00:00', 'Date string, e.g. 2026-08-13 12:00:00'),
        unit: p('string', '时间戳单位', 'Timestamp unit', { enum: ['auto', 's', 'ms', 'us', 'ns'], default: 'auto' }),
      },
    },
  },
  {
    name: 'date_diff',
    title: '日期差值',
    titleEn: 'Date difference',
    description: '计算两个日期之间相差的天/周/时/分/秒，并给出先后方向。',
    descriptionEn: 'Difference between two dates in days, weeks, hours, minutes and seconds, plus the direction.',
    group: 'time',
    inputSchema: {
      type: 'object',
      properties: {
        a: p('string', '起始日期', 'Start date'),
        b: p('string', '结束日期', 'End date'),
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'cron_next',
    title: 'crontab 解析',
    titleEn: 'cron schedule',
    description:
      '解析标准 5 段 crontab 并推算接下来若干次触发时间。写定时任务或核对表达式是否写错时用。',
    descriptionEn:
      'Parse a standard five-field crontab and compute the next fire times — useful for sanity-checking a schedule.',
    group: 'time',
    inputSchema: {
      type: 'object',
      properties: {
        expr: p('string', 'cron 表达式，如 0 3 * * 1-5', 'cron expression, e.g. 0 3 * * 1-5'),
        count: p('number', '推算次数', 'Number of runs to compute', { default: 8 }),
      },
      required: ['expr'],
    },
  },

  /* ================= net ================= */
  {
    name: 'ip_convert',
    title: 'IPv4 等价写法',
    titleEn: 'IPv4 equivalents',
    description:
      'IPv4 与十进制/十六进制/八进制/点分十六进制/点分八进制互转。用于理解 SSRF 绕过变形（如 2130706433 = 127.0.0.1）。',
    descriptionEn:
      'Convert IPv4 between dotted, decimal, hex, octal, dotted-hex and dotted-octal forms — handy for SSRF bypass variants such as 2130706433 = 127.0.0.1.',
    group: 'net',
    inputSchema: {
      type: 'object',
      properties: { input: p('string', 'IP 或整数表示', 'IP or integer form') },
      required: ['input'],
    },
  },
  {
    name: 'cidr_info',
    title: 'CIDR 子网计算',
    titleEn: 'CIDR subnet info',
    description:
      '给定 CIDR（如 192.168.1.10/24）算出网络地址、广播地址、掩码、通配符、可用主机范围与主机数，并判断是否为私有网段。',
    descriptionEn:
      'Given a CIDR such as 192.168.1.10/24, compute network and broadcast addresses, masks, usable host range and count, and flag private ranges.',
    group: 'net',
    inputSchema: {
      type: 'object',
      properties: { cidr: p('string', 'CIDR 表示', 'CIDR notation') },
      required: ['cidr'],
    },
  },
  {
    name: 'chmod_convert',
    title: 'chmod 互转',
    titleEn: 'chmod convert',
    description: '八进制权限（755）与符号权限（rwxr-xr-x）互转，输入任一种即可。',
    descriptionEn: 'Convert between octal (755) and symbolic (rwxr-xr-x) permission notation, either direction.',
    group: 'net',
    inputSchema: {
      type: 'object',
      properties: { input: p('string', '755 或 rwxr-xr-x', '755 or rwxr-xr-x') },
      required: ['input'],
    },
  },
  {
    name: 'url_parse',
    title: 'URL 拆解',
    titleEn: 'URL parse',
    description: '拆解 URL 为协议、认证信息、主机、端口、路径、查询参数列表、锚点。',
    descriptionEn: 'Split a URL into protocol, credentials, host, port, path, query parameters and fragment.',
    group: 'net',
    inputSchema: {
      type: 'object',
      properties: { url: p('string', 'URL', 'URL') },
      required: ['url'],
    },
  },
  {
    name: 'cookie_parse',
    title: 'Cookie 解析',
    titleEn: 'Cookie parse',
    description:
      '解析 Set-Cookie 头或 Cookie 串，拆出键值与各属性，并标注是否缺少 HttpOnly / Secure / SameSite。排查会话与安全问题时用。',
    descriptionEn:
      'Parse a Set-Cookie header or Cookie string into name, value and attributes, flagging missing HttpOnly, Secure and SameSite.',
    group: 'net',
    inputSchema: {
      type: 'object',
      properties: { cookie: p('string', 'Cookie 文本', 'Cookie text') },
      required: ['cookie'],
    },
  },
  {
    name: 'ua_parse',
    title: 'User-Agent 解析',
    titleEn: 'User-Agent parse',
    description: '识别浏览器与版本、操作系统、设备类型，并标注是否为爬虫/扫描器/命令行工具。',
    descriptionEn: 'Identify browser and version, OS and device type, and flag crawlers, scanners and CLI tools.',
    group: 'net',
    inputSchema: {
      type: 'object',
      properties: { ua: p('string', 'User-Agent 字符串', 'User-Agent string') },
      required: ['ua'],
    },
  },

  /* ================= gen ================= */
  {
    name: 'uuid_generate',
    title: '生成 UUID',
    titleEn: 'Generate UUID',
    description: '生成真随机的 UUID v4，可选大写、去连字符、批量条数（1-500）。顺带一提：需要唯一 ID 时自己别猜。',
    descriptionEn:
      'Generate cryptographically random UUID v4 values, optionally uppercased, dash-stripped and batched (1-500).',
    group: 'gen',
    inputSchema: {
      type: 'object',
      properties: {
        count: p('number', '生成条数', 'How many', { default: 1 }),
        upper: p('boolean', '转大写', 'Uppercase', { default: false }),
        noDash: p('boolean', '去掉连字符', 'Strip dashes', { default: false }),
      },
    },
  },
  {
    name: 'password_generate',
    title: '生成密码',
    titleEn: 'Generate password',
    description: '用密码学强随机源生成密码，并给出熵值（bit）与强度分级。',
    descriptionEn: 'Generate a password from a CSPRNG and report its entropy in bits.',
    group: 'gen',
    inputSchema: {
      type: 'object',
      properties: {
        length: p('number', '长度 4-128', 'Length 4-128', { default: 16 }),
        lower: p('boolean', '包含小写', 'Include lowercase', { default: true }),
        upper: p('boolean', '包含大写', 'Include uppercase', { default: true }),
        digit: p('boolean', '包含数字', 'Include digits', { default: true }),
        symbol: p('boolean', '包含符号', 'Include symbols', { default: true }),
        excludeAmbiguous: p('boolean', '剔除易混淆字符 Il1O0', 'Drop ambiguous characters Il1O0', { default: false }),
      },
    },
  },
  {
    name: 'fake_data',
    title: '生成测试数据',
    titleEn: 'Generate test data',
    description:
      '生成姓名、手机号/SSN、邮箱、身份证（含 GB 11643 校验位）、IPv4、MAC 的测试数据，输出 JSON 或 CSV。填充测试库、造种子数据时用。',
    descriptionEn:
      'Generate names, phone numbers, emails, national IDs (GB 11643 check digit for zh), IPv4 and MAC addresses as JSON or CSV.',
    group: 'gen',
    inputSchema: {
      type: 'object',
      properties: {
        count: p('number', '条数 1-100', 'Rows 1-100', { default: 10 }),
        locale: p('string', '数据风格', 'Data style', { enum: ['zh', 'en'], default: 'zh' }),
        format: p('string', '输出格式', 'Output format', { enum: ['json', 'csv'], default: 'json' }),
      },
    },
  },

  /* ================= http ================= */
  {
    name: 'http_request',
    title: 'HTTP 请求',
    titleEn: 'HTTP request',
    description:
      '发任意 HTTP 请求并返回状态码、响应头、响应体与完整耗时分解（连接/TLS/首字节/总计）。相比普通 fetch 的关键优势：可指定上游 HTTP/SOCKS5 代理、可关闭 TLS 校验、可控重定向链、自动解压 gzip/deflate/br/zstd、保留重复响应头。接口调试与内网探测首选。',
    descriptionEn:
      'Send an arbitrary HTTP request and get status, headers, body and a full timing breakdown. Unlike plain fetch: upstream HTTP/SOCKS5 proxy support, TLS verification toggle, controlled redirects, automatic gzip/deflate/br/zstd decompression and duplicate response headers preserved.',
    group: 'http',
    inputSchema: {
      type: 'object',
      properties: {
        url: p('string', '完整 URL', 'Full URL'),
        method: p('string', 'HTTP 方法', 'HTTP method', { default: 'GET' }),
        headers: p('string', '请求头，每行一条 `Name: value`', 'Headers, one `Name: value` per line'),
        body: p('string', '请求体（文本）', 'Request body (text)'),
        timeoutMs: p('number', '超时毫秒', 'Timeout in ms', { default: 30000 }),
        followRedirects: p('boolean', '是否跟随重定向', 'Follow redirects', { default: true }),
        rejectUnauthorized: p('boolean', '是否校验 TLS 证书（自签内网可置 false）', 'Verify TLS certificates (false for self-signed)', { default: true }),
        proxy: p('string', '上游代理，如 http://127.0.0.1:7890 或 socks5://user:pass@host:1080', 'Upstream proxy, e.g. http://127.0.0.1:7890 or socks5://user:pass@host:1080'),
      },
      required: ['url'],
    },
  },
]

export const MCP_TOOL_NAMES: string[] = MCP_TOOLS.map((t) => t.name)

export function findMcpTool(name: string): McpToolSpec | undefined {
  return MCP_TOOLS.find((t) => t.name === name)
}

/** 协议面结构：只保留 MCP 认识的字段，界面专用的中英文案不发给客户端 */
export interface ProtocolTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string; default?: string | number | boolean; enum?: string[] }>
    required?: string[]
  }
}

export function toProtocolTools(): ProtocolTool[] {
  return MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.inputSchema.properties).map(([k, v]) => [
          k,
          { type: v.type, description: v.description, ...(v.default === undefined ? {} : { default: v.default }), ...(v.enum ? { enum: v.enum } : {}) },
        ]),
      ),
      ...(t.inputSchema.required ? { required: t.inputSchema.required } : {}),
    },
  }))
}
