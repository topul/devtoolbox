/**
 * 系统代理模块诊断（**不触发提权、不改动系统设置**）
 *
 * 只做三件安全的事：
 *   1. 读一次真实系统代理状态（networksetup -get* 不需要管理员权限）
 *   2. 校验生成的接管/还原批处理脚本（引号、含空格的网卡名、bypass 合并、sh 语法）
 *   3. 复现「不提权写入会失败」这一前提，并确认**系统设置未被改动**（前后读回一致）
 *
 *   npm run smoke:systemproxy
 *
 * 真正写入系统代理必须走 osascript 管理员授权，那一步不放在自动脚本里（会弹密码框），
 * 由应用里的按钮触发 —— 见 electron/main/systemproxy.ts 的 runElevated。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SystemProxyManager, buildMacSetCommands, buildMacRestoreCommands, type MacServiceSnapshot } from '../electron/main/systemproxy'

const run = promisify(execFile)
const NETWORKSETUP = '/usr/sbin/networksetup'

let passed = 0
const failures: string[] = []

function check(name: string, ok: boolean, extra = ''): void {
  if (ok) {
    passed++
    console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    failures.push(name)
    console.log(`  ✖ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function readAllServices(): Promise<{ service: string; web: string; secure: string; bypass: string }[]> {
  const { stdout } = await run(NETWORKSETUP, ['-listallnetworkservices'])
  const services = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('An asterisk') && !l.startsWith('*'))
  const out = []
  for (const service of services) {
    out.push({
      service,
      web: (await run(NETWORKSETUP, ['-getwebproxy', service])).stdout.trim(),
      secure: (await run(NETWORKSETUP, ['-getsecurewebproxy', service])).stdout.trim(),
      bypass: (await run(NETWORKSETUP, ['-getproxybypassdomains', service])).stdout.trim(),
    })
  }
  return out
}

const main = async (): Promise<void> => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devtoolbox-sysproxy-'))
  const snapshotFile = path.join(tmp, 'system-proxy-snapshot.json')
  const manager = new SystemProxyManager(snapshotFile)

  console.log(`\n平台：${process.platform}`)

  console.log('\n[1] 读取系统代理状态（无需授权）')
  const state = await manager.getState()
  check('getState 不抛错', typeof state.detail === 'string')
  check('supported 与平台一致', state.supported === (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux'))
  check('未接管时 managed=false', state.managed === false)
  console.log(`     当前：enabled=${state.enabled} server=${state.server || '(空)'} detail=${state.detail}`)

  console.log('\n[2] 快照文件生命周期')
  check('无快照文件时 isManaging=false', manager.isManaging === false)
  fs.writeFileSync(snapshotFile, JSON.stringify({
    platform: process.platform,
    createdAt: new Date().toISOString(),
    port: 8899,
    ...(process.platform === 'darwin'
      ? { mac: [{ service: 'Wi-Fi', web: { enabled: false, server: '127.0.0.1', port: 7890 }, secure: { enabled: false, server: '127.0.0.1', port: 7890 }, bypass: ['127.0.0.1'] }] }
      : {}),
  }, null, 2))
  const reopened = new SystemProxyManager(snapshotFile)
  check('有快照文件时 isManaging=true（重启后仍能识别上次接管）', reopened.isManaging === true)
  const withSnap = await reopened.getState()
  check('带快照时 getState 仍可读', typeof withSnap.detail === 'string')
  const mismatched = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
  check('快照含接管端口，便于判断系统代理是否指向本工具', mismatched.port === 8899)

  if (process.platform === 'darwin') {
    console.log('\n[3] 接管/还原批处理脚本')
    const snapshots: MacServiceSnapshot[] = [
      { service: 'Wi-Fi', web: { enabled: false, server: '127.0.0.1', port: 7890 }, secure: { enabled: false, server: '127.0.0.1', port: 7890 }, bypass: ['127.0.0.1', '192.168.0.0/16'] },
      { service: 'USB 10/100 LAN', web: { enabled: true, server: '10.0.0.1', port: 8080 }, secure: { enabled: false, server: '', port: 0 }, bypass: [] },
    ]
    const set = buildMacSetCommands(snapshots, '127.0.0.1', 8899)
    const restore = buildMacRestoreCommands(snapshots)

    check('每个网卡 5 条命令（web/secure/两个开关/bypass）', set.length === 10, `count=${set.length}`)
    check('含空格的网卡名被单引号包裹', set.some((c) => c.includes(`'USB 10/100 LAN'`)))
    check('接管时 web 与 secure 都指向本机', set.filter((c) => c.includes('127.0.0.1 8899')).length === 4)
    check('接管时两个代理开关都置 on', set.filter((c) => c.endsWith(' on')).length === 4)
    const bypassLine = set.find((c) => c.includes('USB 10/100 LAN') && c.includes('bypassdomains')) ?? ''
    check('bypass 合并了必填项与原有项', bypassLine.includes(`'127.0.0.1'`) && bypassLine.includes(`'localhost'`) && bypassLine.includes(`'*.local'`))
    check('bypass 去重（原有 127.0.0.1 不重复）', (bypassLine.match(/'127\.0\.0\.1'/g) ?? []).length === 1)
    check('还原保留原始 server/port', restore.some((c) => c.includes(`'Wi-Fi' '127.0.0.1' 7890`)))
    check('还原按快照恢复开关状态（on/off 混合）', restore.some((c) => c.includes(`'USB 10/100 LAN'`) && c.endsWith(' off')) && restore.some((c) => c.includes(`'USB 10/100 LAN'`) && c.endsWith(' on')))
    check('原本为空的 bypass 用显式空串清空', restore.some((c) => c.endsWith(`bypassdomains 'USB 10/100 LAN' ''`)))

    const script = path.join(tmp, 'batch.sh')
    const batchBody = (cmds: string[]): string => `#!/bin/sh\nFAILED=0\n${cmds.map((c) => `${c} || FAILED=1`).join('\n')}\nexit $FAILED\n`
    fs.writeFileSync(script, batchBody(set))
    const setSyntax = await run('/bin/sh', ['-n', script]).then(() => true).catch((e) => e as Error)
    check('接管脚本 shell 语法正确（sh -n）', setSyntax === true, setSyntax === true ? '' : String(setSyntax))
    fs.writeFileSync(script, batchBody(restore))
    const restoreSyntax = await run('/bin/sh', ['-n', script]).then(() => true).catch((e) => e as Error)
    check('还原脚本 shell 语法正确（sh -n）', restoreSyntax === true, restoreSyntax === true ? '' : String(restoreSyntax))
    check('批处理不因单条失败中断（不用 set -e，改累加标记）', !batchBody(set).includes('set -e') && batchBody(set).includes('exit $FAILED'))

    console.log('\n[4] 复现「写入需要管理员权限」并确认未改动系统设置')
    const before = await readAllServices()
    const target = before[0]?.service
    if (target) {
      let code = 0
      let stderr = ''
      try {
        await run(NETWORKSETUP, ['-setwebproxy', target, '127.0.0.1', '8899'])
      } catch (err) {
        const e = err as Error & { code?: number; stderr?: string }
        code = e.code ?? 0
        stderr = (e.stderr ?? e.message ?? '').trim()
      }
      const after = await readAllServices()
      const unchanged = JSON.stringify(before) === JSON.stringify(after)
      check('非提权写入被拒绝或未生效，且系统设置完全未变', unchanged, `exit=${code} ${stderr.split('\n')[0] ?? ''}`)
      if (code === 14) console.log('     确认：networksetup 写操作需要管理员权限 → 应用内必须走 osascript 授权（已实现）')
      else console.log(`     注意：本机非提权写入返回 exit=${code}，若为 0 说明该版本无需提权`)
    } else {
      check('至少存在一个网卡服务', false)
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n${failures.length === 0 ? `OK: ${passed} 项断言全部通过` : `${failures.length} 项失败：\n  - ${failures.join('\n  - ')}`}`)
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('诊断脚本异常终止：', err)
  process.exit(1)
})
