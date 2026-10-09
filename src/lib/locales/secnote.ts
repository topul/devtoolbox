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
  },
}
