export const secnoteL = {
  zh: {
    x509: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '解析一张 X.509 证书（PEM 格式）的关键字段，不验签、不校链 —— 本地纯解析，不发起任何网络请求。',
      scenesTitle: '典型场景',
      scenes: [
        '排查 HTTPS 报错：证书是否过期、生效时间是否在未来、主机名是否在 SAN 列表里',
        '核对指纹防中间人：把服务器证书的 SHA-256 指纹与官方渠道公布的比对',
        '评估密钥强度：RSA 模长 / EC 曲线是否达到当前安全基线',
        '确认证书用途：是不是 CA 证书（Basic Constraints）、能用来签名还是仅加密',
      ],
      caution:
        '「解析通过」不等于「证书可信」。信任链是否完整、是否被吊销，需要交给系统信任库或 openssl verify 判断。',
    },
    jwtcrack: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '检查一个 JWT 的常见误用：alg=none 无签名、HMAC 弱密钥（内置常见弱密钥词表）、以及非对称算法被降级成 HMAC 的算法混淆风险。',
      scenesTitle: '典型场景',
      scenes: [
        '授权审计：检查自家系统签发的 token 是否用了弱密钥，能不能被伪造身份',
        'CTF / 渗透测试：快速判断一个 JWT 是不是可以离线爆破或算法混淆',
        'Code Review 辅助：验证 JWT 库配置（alg 白名单、密钥强度）是否到位',
      ],
      caution: '仅用于你自有或获得书面授权的系统。对他人系统爆破弱密钥属于未授权行为。',
    },
    dns: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '通过公共 DoH（DNS over HTTPS）服务查询域名的 A / AAAA / MX 等记录，绕开本地 DNS 污染做交叉验证。',
      scenesTitle: '典型场景',
      scenes: [
        '排查解析异常：本地 DNS 被污染或缓存错误时，用多个 DoH 端点交叉验证',
        '确认域名配置：邮件 MX 记录、CDN CNAME 指向、TXT 验证记录是否生效',
        '安全分析：识别域名真实指向的 IP，辅助判断钓鱼 / 抢注',
      ],
      caution:
        '查询会发送到第三方 DoH 服务商（Google / Cloudflare / 阿里 / DNSPod），查询记录本身会暴露给服务商。',
    },
    audit: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '抓取一个 HTTPS 站点的安全响应头（HSTS / CSP / X-Frame-Options 等），按最佳实践给出缺失与弱配置清单。',
      scenesTitle: '典型场景',
      scenes: [
        '上线前自检：确认安全响应头配置到位，堵住点击劫持、MIME 嗅探等常见面',
        '合规基线：满足安全扫描项里的响应头要求',
        '对比参考：看看主流站点配了哪些头，作为自己配置的参照',
      ],
      caution:
        '只检查响应头，不替代渗透测试；且审计结果依赖目标站点的真实响应（可能因 CDN / WAF 返回不同结果）。',
    },
    httpreq: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '把一段原始 HTTP 请求（从 Burp / 代理日志复制）拆解成请求行、头、Cookie、参数，并按参数名特征标出值得测的攻击面线索。全程本地解析，不发起任何请求。',
      scenesTitle: '典型场景',
      scenes: [
        '拿到一个请求后快速摸清结构：哪些参数在 query / body / cookie 里',
        '代码审计与渗透测试辅助：按 id/url/file/redirect 等命名特征定位越权、SSRF、LFI、注入候选点',
        '检查凭据放置是否合理：token / 密码是否出现在 URL 等会被日志记录的位置',
      ],
      caution: '参数名命中只代表「值得测」，不代表漏洞存在；请只在自有或获得书面授权的系统上验证。',
    },
    cors: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '粘贴请求的 Origin 与响应头中的 CORS 三件套（ACAO / ACAC / Vary），按「证据→可利用条件→影响」判断跨域读取风险，并生成可在自己靶场验证的 PoC 页面。',
      scenesTitle: '典型场景',
      scenes: [
        '审计自家接口是否反射任意 Origin 且允许携带凭据',
        '判断 Access-Control-Allow-Origin: null、通配符等配置的真实影响',
        '给修复方案提供依据：白名单应精确匹配，而不是 startsWith / endsWith',
      ],
      caution:
        '结论依赖粘贴的响应头是否真实完整；CDN / WAF / 是否带凭据都会改变判定，请在授权范围内验证。',
    },
    csp: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '解析一条 Content-Security-Policy，逐条解释指令，标记 unsafe-inline、unsafe-eval、通配符、data:、可被 JSONP 利用的白名单主机等危险来源。',
      scenesTitle: '典型场景',
      scenes: [
        '上线前检查 CSP 是否能真正缓解 XSS，而不是「配了等于没配」',
        '评估外链 CDN 白名单是否可被 JSONP / 用户内容源绕过',
        '补齐 object-src、base-uri、frame-ancestors 等容易遗漏的指令',
      ],
      caution: '只分析策略文本；nonce 是否可猜、页面是否注入点等运行时问题需要结合实际页面判断。',
    },
    ssrf: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '给定内部目标 URL 或主机，批量生成进制、IPv6 映射、@ 混淆、结尾点、编码等语义等价写法，每类标注它针对的弱校验类型，用于验证自家 SSRF 防护是否可绕过。',
      scenesTitle: '典型场景',
      scenes: [
        '验证黑名单是否只拦了点分十进制的 127.0.0.1 / 内网网段',
        '验证 URL 解析器与后续 HTTP 客户端的解析差异（userinfo、结尾点）',
        '安全开发培训：展示「字符串校验 URL」为什么本质上不可靠',
      ],
      caution: '变体仅用于你自有或授权的靶场与系统；对他人服务发起内网探测是违法行为。',
    },
    reqdiff: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '并排解析两份原始 HTTP 请求，高亮方法、路径、请求头、body 的增删改差异，便于整理重放结果。纯本地文本对比。',
      scenesTitle: '典型场景',
      scenes: [
        'IDOR / 越权学习：对比两个身份的请求到底差在哪个头或参数',
        '记录「改了什么导致响应变化」，让结论可复现',
        '对比同一接口的正常请求与异常请求',
      ],
      caution: '差异本身不是漏洞；是否能越权取决于服务端是否真正做了对象级鉴权。',
    },
    redirect: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '输入回跳目标，按绕过手法分类生成开放重定向测试载荷（协议相对、反斜杠、@、后缀信任、编码、javascript 伪协议等）。',
      scenesTitle: '典型场景',
      scenes: [
        '验证 returnUrl / next / redirect 参数是否做了严格同源校验',
        '评估 startsWith / contains / endsWith 等错误校验的绕过面',
        '配合 OAuth 流程检查回跳地址是否可被窃取授权码',
      ],
      caution:
        '请只在自有或授权系统上测试；生成的 javascript: 载荷用于说明 DOM 型风险，不要用于真实用户。',
    },
    smuggling: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '讲解前端代理与后端服务器因 Content-Length / Transfer-Encoding 解析分歧导致的请求走私，生成 CL.TE / TE.CL / TE.TE 字节精确模板与无危害时间探测。',
      scenesTitle: '典型场景',
      scenes: [
        '在自己搭建的靶场上理解走私原理与验证步骤',
        '审计自建代理链路是否对 TE / CL 做了一致化处理',
        '安全培训：展示为什么「边界统一 HTTP 解析」是修复关键',
      ],
      caution:
        '走私会污染共享连接、影响其他真实用户。严禁对生产环境或他人系统发送此类请求，仅限本地隔离靶场。',
    },
    nmap: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '把 nmap 的普通输出 / grepable(-oG) / XML(-oX) 结果解析成主机与端口表格，支持版本字段，方便整理侦察结果。',
      scenesTitle: '典型场景',
      scenes: [
        '把扫描输出结构化，便于汇总开放端口与服务版本',
        '在授权测试的报告里快速整理资产面',
        '对比两次扫描的端口变化',
      ],
      caution: '端口扫描只允许针对自有资产或获得明确授权的目标；未授权扫描在多数司法辖区违法。',
    },
    sysinfo: {
      title: '适用场景说明',
      hint: '什么时候该用这个工具',
      what: '读取本机的 IP、网卡、系统版本、CPU / 内存 / 磁盘占用等信息。数据来自 Node 的 os 模块与只读系统命令（df / route / Get-CimInstance），全程不联网、不修改任何系统配置。',
      scenesTitle: '典型场景',
      scenes: [
        '排查本机网络：确认 IP / MAC / 默认网关 / 网段，判断走的是哪块网卡',
        '报障与写文档：一键整理系统版本、架构、运行时长、磁盘剩余空间',
        '观察资源：实时看 CPU 与内存占用，判断压测或联调时本机是否成为瓶颈',
      ],
      caution:
        '只展示本机信息，不查询公网 IP，也不采集其它主机数据；界面里的 IP/MAC/主机名粘贴给他人前请自行脱敏。',
    },
  },
  en: {
    x509: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Parse the key fields of an X.509 certificate (PEM). No signature verification, no chain building — fully local, no network requests.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Debug HTTPS errors: expiry, not-yet-valid dates, hostname vs SAN list',
        'Fingerprint pinning: compare the SHA-256 fingerprint against an official channel',
        'Key strength: RSA modulus / EC curve against current baselines',
        'Intended use: is it a CA (Basic Constraints), signing vs encryption only',
      ],
      caution:
        'A successful parse does not mean the certificate is trusted. Chain completeness and revocation belong to the system trust store or openssl verify.',
    },
    jwtcrack: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Check a JWT for common misuse: alg=none, weak HMAC secrets (built-in common-secret wordlist), and algorithm-confusion risk when asymmetric algs are downgraded to HMAC.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Authorization audit: are your own signed tokens using guessable secrets',
        'CTF / pentest: quickly tell whether a JWT is offline-crackable or confusion-prone',
        'Code review aid: verify JWT library config (alg allowlist, secret strength)',
      ],
      caution:
        'Use only on systems you own or are authorized to test in writing. Brute-forcing secrets on systems you do not own is unauthorized.',
    },
    dns: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Query A / AAAA / MX and other records for a domain via public DoH (DNS over HTTPS) resolvers — a cross-check when local DNS is polluted.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Debug resolution: cross-check across DoH providers when local DNS is poisoned or stale',
        'Verify domain config: MX for mail, CNAME for CDN, TXT verification records',
        'Security analysis: find where a domain really points, spot phishing / typosquatting',
      ],
      caution:
        'Queries go to third-party DoH providers (Google / Cloudflare / Aliyun / DNSPod) — your lookups are visible to them.',
    },
    audit: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Fetch a site’s security response headers (HSTS / CSP / X-Frame-Options …) and list missing or weak configurations against best practice.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Pre-launch self-check: headers in place against clickjacking, MIME sniffing and friends',
        'Compliance baselines: satisfy scanner requirements for response headers',
        'Reference: see which headers major sites set, as a baseline for your own config',
      ],
      caution:
        'Header checks only — not a substitute for pentesting; results depend on the live response (CDN / WAF may alter them).',
    },
    httpreq: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Paste a raw HTTP request (copied from Burp / a proxy log) to break it down into request line, headers, cookies and params, with name-based hints for interesting attack surfaces. Fully local — no request is ever sent.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Understand a request at a glance: which params live in query / body / cookies',
        'Code review and pentest aid: spot IDOR / SSRF / LFI / injection candidates by name patterns',
        'Credential hygiene: are tokens or passwords placed in URLs that end up in logs',
      ],
      caution:
        'A name match only means "worth testing", not "vulnerable". Verify only on systems you own or are authorized to test in writing.',
    },
    cors: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Paste the request Origin and the CORS response headers (ACAO / ACAC / Vary) to judge cross-origin read risk as evidence → preconditions → impact, and generate a PoC page for your own lab.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Audit whether your own API reflects any Origin with credentials allowed',
        'Understand the real impact of Access-Control-Allow-Origin: null and wildcards',
        'Motivate the fix: exact-match allowlists instead of startsWith / endsWith',
      ],
      caution:
        'Verdicts assume the pasted headers are real and complete; CDN / WAF and credential mode change the result. Verify within an authorized scope.',
    },
    csp: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Parse a Content-Security-Policy, explain each directive, and flag dangerous sources such as unsafe-inline, unsafe-eval, wildcards, data:, and JSONP-capable allowlist hosts.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Check before launch whether the CSP actually mitigates XSS',
        'Assess whether external CDN allowlists can be abused via JSONP or user content',
        'Fill in commonly missed directives: object-src, base-uri, frame-ancestors',
      ],
      caution:
        'Policy text only; whether nonces are guessable or a page is injectable needs the running application.',
    },
    ssrf: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Given an internal target URL or host, generate semantically equivalent notations (bases, IPv6 mappings, @ userinfo, trailing dots, encodings), each tagged with the weak validation it targets, to test your own SSRF defenses.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Check whether a denylist only blocks dotted-decimal 127.0.0.1 / internal ranges',
        'Expose parser discrepancies between validation and the HTTP client (userinfo, trailing dots)',
        'Security training: why string-based URL validation is fundamentally unreliable',
      ],
      caution:
        'Variants are for your own systems or authorized labs only; probing internal networks through someone else’s service is illegal.',
    },
    reqdiff: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Parse two raw HTTP requests side by side and highlight added, removed or changed method, path, headers and body. Pure local text comparison.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'IDOR / authorization learning: find which header or param differs between two identities',
        'Record "what changed caused the response change" so findings are reproducible',
        'Compare a normal and an abnormal request to the same endpoint',
      ],
      caution:
        'A difference is not a vulnerability; privilege escalation depends on real server-side object-level checks.',
    },
    redirect: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Given a redirect target, generate open-redirect payloads grouped by bypass technique: protocol-relative, backslashes, @, suffix trust, encodings, and javascript: schemes.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Verify that returnUrl / next / redirect params enforce strict same-origin checks',
        'Assess bypasses of broken startsWith / contains / endsWith validation',
        'Check OAuth flows for code theft via attacker-controlled redirect URIs',
      ],
      caution:
        'Test only systems you own or are authorized to test; the javascript: payload illustrates DOM risk and must never be aimed at real users.',
    },
    smuggling: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Explains request smuggling caused by front-end / back-end disagreement on Content-Length vs Transfer-Encoding, and generates byte-accurate CL.TE / TE.CL / TE.TE templates plus a harmless timing probe.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Understand the mechanics in a lab you built yourself',
        'Audit whether your own proxy chain normalizes TE / CL consistently',
        'Security training: why unified HTTP parsing at the boundary is the fix',
      ],
      caution:
        'Smuggling poisons shared connections and affects real users. Never send these at production or third-party systems — isolated local labs only.',
    },
    nmap: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Parse nmap normal / grepable (-oG) / XML (-oX) output into host and port tables with service versions, to organize reconnaissance results.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Structure scan output into open ports and service versions',
        'Summarize the attack surface in an authorized-test report',
        'Diff port changes between two scans',
      ],
      caution:
        'Port scanning is allowed only against assets you own or are explicitly authorized to test; unauthorized scanning is illegal in most jurisdictions.',
    },
    sysinfo: {
      title: 'When to use this',
      hint: 'Scenarios and goals',
      what: 'Read this machine\u2019s local IPs, network interfaces, OS version, and CPU / memory / disk usage. Data comes from Node\u2019s os module and read-only system commands (df / route / Get-CimInstance) — no network calls, no system changes.',
      scenesTitle: 'Typical scenarios',
      scenes: [
        'Local network triage: confirm IP / MAC / default gateway / subnet and which adapter is active',
        'Bug reports and docs: gather OS version, architecture, uptime and free disk space in one view',
        'Watch resources: live CPU and memory usage to see if this machine is the bottleneck during load tests',
      ],
      caution:
        'Only local data is shown — no public-IP lookup and nothing from other hosts; redact IPs/MAC/hostname before pasting screenshots elsewhere.',
    },
  },
}
