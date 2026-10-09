/**
 * bcrypt 哈希与密码强度 —— 生成 / 校验 bcrypt 哈希，并实时评估密码强度。
 *
 * 设计取舍：bcrypt 是刻意「慢」的算法（这是它的安全属性），12+ rounds 在本机
 * 同步算会卡 UI 数百毫秒，这里不做 worker 迁移而是把卡顿明说在安全说明里 ——
 * 对本地工具这是可接受的取舍，迁移 worker 反而让「改一个字符立刻出强度」的
 * 实时体验变复杂。密码输入字段命名含 password，持久化自动走会话级敏感存储。
 */
import React, { useMemo, useState } from 'react'
import {
  Btn,
  ErrorNote,
  Input,
  Panel,
  ResultPanel,
  Select,
  TA,
  ToolShell,
  usePersistedState,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import {
  bcryptHash,
  bcryptNeedsRehash,
  bcryptVerify,
  passwordStrength,
} from '../lib/toolkit/bcrypt'

const L = {
  zh: {
    genPanel: '生成哈希',
    password: '密码',
    passwordPh: '输入要哈希的密码',
    rounds: 'Cost（rounds）',
    roundsHint: '每 +1 计算时间翻倍',
    gen: '生成哈希',
    hashResult: 'bcrypt 哈希',
    hashEmptyHint: '填好密码后点「生成哈希」，$2b$… 会显示在这里',
    strength: '密码强度',
    bits: 'bit 熵',
    pool: '字符池',
    sugs: {
      length: '长度不足：建议 12 位以上',
      upper: '加入大写字母',
      lower: '加入小写字母',
      digit: '加入数字',
      symbol: '加入符号（!@# 等）',
      common: '命中常见弱密码表 —— 请换一个完全不同的密码',
    } as Record<string, string>,
    verifyPanel: '校验',
    verifyHash: 'bcrypt 哈希',
    verifyHashPh: '$2b$12$…（粘贴待校验的哈希）',
    verifyPassword: '密码',
    verifyBtn: '校验',
    verifyOk: '密码与哈希匹配 ✓',
    verifyBad: '密码不匹配 ✗',
    verifyBadFormat: '不是有效的 bcrypt 哈希（应为 $2a/$2b/$2x/$2y 开头的 60 字符串）',
    rehashHint: '该哈希的 cost 低于当前所选值，建议按新 cost 重新生成',
    noteTitle: '安全说明',
    note: '**安全说明**：bcrypt 计算全程在本机完成，不访问网络；密码字段只存会话级（关闭应用即清空），不会写盘。cost 越高越慢，12 rounds 以上点「生成哈希」时界面短暂卡住属正常现象。生成的哈希仅用于本地测试与自托管服务的用户表，请勿将生产系统密码带到本工具里试算。',
  },
  en: {
    genPanel: 'Generate hash',
    password: 'Password',
    passwordPh: 'Password to hash',
    rounds: 'Cost (rounds)',
    roundsHint: 'each +1 doubles the time',
    gen: 'Generate hash',
    hashResult: 'bcrypt hash',
    hashEmptyHint: 'Enter a password and click "Generate hash"; the $2b$… output appears here',
    strength: 'Password strength',
    bits: 'bits of entropy',
    pool: 'Character pool',
    sugs: {
      length: 'Too short: aim for 12+ characters',
      upper: 'Add uppercase letters',
      lower: 'Add lowercase letters',
      digit: 'Add digits',
      symbol: 'Add symbols (!@# etc.)',
      common: 'Matches a well-known weak password — pick a completely different one',
    } as Record<string, string>,
    verifyPanel: 'Verify',
    verifyHash: 'bcrypt hash',
    verifyHashPh: '$2b$12$… (paste the hash to verify)',
    verifyPassword: 'Password',
    verifyBtn: 'Verify',
    verifyOk: 'Password matches the hash ✓',
    verifyBad: 'Password does not match ✗',
    verifyBadFormat:
      'Not a valid bcrypt hash (expected a 60-char string starting with $2a/$2b/$2x/$2y)',
    rehashHint: 'This hash was made with a lower cost than currently selected — consider rehashing',
    noteTitle: 'Security notes',
    note: '**Security notes**: bcrypt runs entirely on this machine — no network access; the password fields use session-only storage and are wiped when the app closes. Higher cost is slower by design; the UI briefly freezing on 12+ rounds is normal. Use these hashes for local testing and self-hosted user tables only — do not run production credentials through this tool.',
  },
}

const ROUND_OPTIONS = [
  { value: '8', label: '8' },
  { value: '10', label: '10' },
  { value: '12', label: '12' },
  { value: '14', label: '14' },
]

export function BcryptTool() {
  const l = useLocalized(L)
  const [password, setPassword] = usePersistedState('bcrypt', 'password', '')
  const [rounds, setRounds] = usePersistedState('bcrypt', 'rounds', '10')
  const [hash, setHash] = usePersistedState('bcrypt', 'generatedHash', '')

  const [verifyHash, setVerifyHash] = usePersistedState('bcrypt', 'verifyHash', '')
  const [verifyPw, setVerifyPw] = usePersistedState('bcrypt', 'verifyPassword', '')
  const [verifyResult, setVerifyResult] = useState<'ok' | 'bad' | 'badFormat' | null>(null)

  // 强度实时评估：纯同步计算，跟随输入即时刷新
  const strength = useMemo(() => passwordStrength(password), [password])

  const doVerify = () => {
    const h = verifyHash.trim()
    if (!/^\$2[abxy]\$\d{2}\$/.test(h)) {
      setVerifyResult('badFormat')
      return
    }
    setVerifyResult(bcryptVerify(verifyPw, h) ? 'ok' : 'bad')
  }

  // 校验结果的补充提示：cost 低于当前所选时建议重铸
  const rehash =
    verifyResult !== 'badFormat' &&
    verifyHash.trim().length > 0 &&
    bcryptNeedsRehash(verifyHash, parseInt(rounds, 10) || 10)

  // 强度条颜色：0-1 红、2 琥珀、3-4 磷光
  const barColor =
    strength.score <= 1 ? 'bg-danger' : strength.score === 2 ? 'bg-amber' : 'bg-phosphor'
  const litBars = strength.score + 1

  return (
    <ToolShell toolId="bcrypt">
      <Panel title={l.genPanel}>
        <div className="flex flex-col gap-3">
          <Input
            type="password"
            value={password}
            onChange={setPassword}
            label={l.password}
            placeholder={l.passwordPh}
            toolInput
          />
          <div className="flex items-end gap-3">
            <div className="w-40 shrink-0">
              <Select
                value={rounds}
                onChange={setRounds}
                options={ROUND_OPTIONS}
                label={l.rounds}
              />
            </div>
            <div className="pb-2 text-[11.5px] text-muted">{l.roundsHint}</div>
          </div>

          {/* 强度条：1-5 格按 score 点亮 */}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] font-medium text-muted uppercase tracking-wider">
                {l.strength}
              </span>
              <span className="text-[11.5px] text-muted">
                {strength.bits} {l.bits} · {l.pool} {strength.poolSize}
              </span>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  aria-hidden
                  className={`h-1.5 flex-1 rounded-full ${i < litBars ? barColor : 'bg-panel-2 border border-line-soft'}`}
                />
              ))}
            </div>
            {strength.suggestions.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {strength.suggestions.map((s) => (
                  <li
                    key={s}
                    className={`text-[12.5px] leading-relaxed ${s === 'common' ? 'text-danger font-medium' : 'text-muted'}`}
                  >
                    {s === 'common' && <span aria-hidden>⚠ </span>}
                    {l.sugs[s]}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <Btn
              variant="primary"
              disabled={password.length === 0}
              onClick={() => setHash(bcryptHash(password, parseInt(rounds, 10) || 10))}
            >
              {l.gen}
            </Btn>
          </div>
        </div>
      </Panel>

      <ResultPanel title={l.hashResult} text={hash} emptyHint={l.hashEmptyHint} maxHeight={140} />

      <Panel title={l.verifyPanel}>
        <div className="flex flex-col gap-3">
          <TA
            value={verifyHash}
            onChange={(v) => {
              setVerifyHash(v)
              setVerifyResult(null)
            }}
            label={l.verifyHash}
            placeholder={l.verifyHashPh}
            rows={2}
          />
          <Input type="password" value={verifyPw} onChange={setVerifyPw} label={l.verifyPassword} />
          <div>
            <Btn
              variant="primary"
              disabled={verifyHash.trim().length === 0 || verifyPw.length === 0}
              onClick={doVerify}
            >
              {l.verifyBtn}
            </Btn>
          </div>
          {verifyResult === 'badFormat' && <ErrorNote msg={l.verifyBadFormat} />}
          {verifyResult !== null && verifyResult !== 'badFormat' && (
            <div
              role="status"
              className={`rounded-lg border px-3 py-2 text-[12.5px] ${
                verifyResult === 'ok'
                  ? 'border-phosphor/40 bg-phosphor-faint/40 text-phosphor'
                  : 'border-danger/35 bg-danger/10 text-danger'
              }`}
            >
              {verifyResult === 'ok' ? l.verifyOk : l.verifyBad}
            </div>
          )}
          {rehash && <div className="text-[12px] text-amber">{l.rehashHint}</div>}
        </div>
      </Panel>

      <Panel title={l.noteTitle}>{l.note}</Panel>
    </ToolShell>
  )
}
