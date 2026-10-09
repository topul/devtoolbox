/**
 * 工具页的示例数据 —— 空文本框的救命稻草。
 *
 * 为什么需要：评审发现 65 个工具里**一处示例/试用按钮都没有**。用户进来面对一个
 * 空文本框，不知道该粘什么、点了会出什么是最大的使用障碍（不是功能问题，是上手问题）。
 *
 * 三条约定：
 *   1. **示例必须能真跑通**。示例的价值是「一键看到结果」，示例本身不合法就是负优化
 *      （smoke:ux 会拿 base64 举例，往返验一次）。
 *   2. **示例要短**。目的是让人看懂用法，不是充当测试数据。
 *   3. **label 走 i18n**，这里只放纯数据（界面层不 import 这个模块）。
 *
 * 键必须是**语言中立**的工具 id（与 registry 里的 id 完全一致），
 * 不是分类 id —— 一个分类下多个工具的示例是不同的。
 */

export interface ToolExample {
  /** 示例输入，点一下就填进输入框 */
  sample: string
}

/**
 * 示例表。收录标准：这个工具「最典型的真实输入」是什么。
 * 没有收录的工具页不显示示例条（不硬塞一个不相关的示例）。
 */
export const EXAMPLES: Record<string, ToolExample> = {
  /* ---------- encoding ---------- */
  base64: { sample: 'Hello, DevOps Toolbox' },
  'url-codec': { sample: 'https://example.com/search?q=a b&lang=zh-CN' },
  unicode: { sample: 'café' },
  radix: { sample: '255' },
  'html-entity': { sample: '<script>alert("xss")</script>' },
  morse: { sample: 'SOS' },
  'str-escape': { sample: "O'Reilly & Sons <tag>" },
  'base58-32': { sample: '0x52908400098527886E0F7030069857D2E4169EE7' },
  punycode: { sample: '例子.测试' },

  /* ---------- format ---------- */
  'yaml-json': { sample: 'name: devtoolbox\nversion: 1.8.0\nports:\n  - 5000\n  - 6000\n' },
  jsonpath: { sample: '{"store":{"book":[{"title":"Dune","price":8.99}]}}' },
  'css-format': { sample: '.a{color:red;margin:0}.b{padding:4px}' },
  'toml-json': { sample: '[package]\nname = "devtoolbox"\nedition = "2021"\n' },
  'csv-json': { sample: 'id,name,role\n1,Ada,engineer\n2,Lin,pm\n' },
  json: { sample: '{"b":2,"a":[1,{"c":null}],"ok":true}' },
  'sql-format': {
    sample:
      'select a.id,b.name from users a join orders b on b.uid=a.id where a.active=1 order by a.id;',
  },
  'xml-format': { sample: '<root><item id="1">text</item></root>' },
  markdown: { sample: '# 标题\n\n- 项目一\n- 项目二\n\n|列A|列B|\n|-|-|\n|1|2|' },

  /* ---------- network ---------- */
  'url-parser': { sample: 'https://user:pw@example.com:8443/p/a?b=1&c=2#frag' },
  'ua-parser': {
    sample:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  },
  'ip-int': { sample: '10.0.0.1' },
  cookie: { sample: 'sessionId=abc123; theme=dark; path=/; HttpOnly; Secure; SameSite=Lax' },
  'dns-lookup': { sample: 'github.com' },

  /* ---------- http ---------- */
  'http-client': { sample: 'https://httpbin.org/get' },
  'header-audit': {
    sample:
      "Strict-Transport-Security: max-age=31536000; includeSubDomains\nX-Frame-Options: DENY\nContent-Security-Policy: default-src 'self'\nX-Content-Type-Options: nosniff\nReferrer-Policy: strict-origin-when-cross-origin",
  },

  /* ---------- generators ---------- */
  uuid: { sample: '1' },
  password: { sample: '16' },
  qrcode: { sample: 'https://example.com' },
  'fake-data': { sample: 'name,email\n3,user' },
  color: { sample: '#1D9E75' },

  /* ---------- crypto ---------- */
  hash: { sample: 'hello world' },
  hmac: { sample: 'hello world' },
  aes: { sample: 'hello world' },
  jwt: {
    sample:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  },
  'hash-id': { sample: '5f4dcc3b5aa765d61d8327deb882cf99' },
  xor: { sample: 'hello world' },
  rot: { sample: 'Hello World' },
  vigenere: { sample: 'ATTACKATDAWN' },
  'jwt-crack': { sample: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc' },
  'jwt-sign': { sample: '{\n  "sub": "1234567890",\n  "name": "Ada",\n  "admin": true\n}' },
  totp: { sample: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' },

  /* ---------- text ---------- */
  diff: { sample: 'line one\nline two\nline three' },
  regex: { sample: '\\b\\w+@\\w+\\.\\w+\\b' },
  'word-count': { sample: '短文本 word count 测试' },
  'case-convert': { sample: 'userProfileID' },
  'line-ops': { sample: 'b\na\nc\na\nb' },

  /* ---------- datetime ---------- */
  timestamp: { sample: '1700000000' },
  cron: { sample: '0 9 * * 1-5' },
  'date-diff': { sample: '2026-01-01\n2026-10-02' },
  timezone: { sample: '2026-10-02 14:30:00' },

  /* ---------- reference ---------- */
  subnet: { sample: '192.168.1.0/24' },
  chmod: { sample: '755' },
  'http-status': { sample: '429' },

  /* ---------- 2026-10 新增批次 ---------- */
  'glob-tester': { sample: 'src/**/*.ts\n!**/node_modules/**\nDockerfile*' },
  'token-counter': {
    sample: 'The quick brown fox jumps over the lazy dog. Estimate tokens before you send.',
  },
  docker2compose: {
    sample:
      'docker run -d --name web -p 8080:80 -v /data/nginx:/etc/nginx -e NGINX_PORT=80 --restart always nginx:alpine',
  },
  'float-bits': { sample: '0.1' },
  units: { sample: '1536' },
  'port-lookup': { sample: '8080' },
  loadtest: { sample: 'http://127.0.0.1:3000/api/health' },
}

/** 某个工具有没有示例；没有就不显示示例条 */
export function exampleFor(toolId: string): ToolExample | undefined {
  return EXAMPLES[toolId]
}
