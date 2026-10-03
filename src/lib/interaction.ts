/**
 * 交互一致性的纯逻辑：结果区截断提示、危险操作确认、异步防重入。
 *
 * 为什么要抽成纯函数：这三条都是「很容易凭肉眼写错、错了还很安静」的规则。
 *   - 截断提示少写一次，用户就以为结果只有 20 行（7 处结果区都缺复制入口）
 *   - 确认逻辑写成「点一下就清」，用户一次误点就丢掉所有输入
 *   - 异步不加防重入，连点 5 次就是 5 个并发任务（CA 证书生成曾有这种竞态）
 * 抽出来才能在 Node 冒烟里逐条断言。
 *
 * 不碰 DOM、不 import React —— 与 lib/ 的分层约定一致。
 */

/* ================= 结果区截断 ================= */

/**
 * 结果被截断时的提示文案；没截断返回 null（不显示任何提示）。
 *
 * @param shown 实际显示的条数
 * @param total 真实总条数
 * @returns 语言中立 key + 参数，或 null
 *
 * 静默截断是最糟的一种：用户看到 20 行，会以为输入就只有这么多，
 * 转而去手动验证文件完整性 —— 而不是意识到还有 480 行被藏起来了。
 */
export function truncationNotice(shown: number, total: number): string | null {
  if (total <= shown) return null
  return `showing ${shown} of ${total}`
}

/* ================= 危险操作确认 ================= */

/** 待确认状态机 */
export type ConfirmState = 'idle' | 'armed'

/**
 * 决定「这一次点击要不要真的执行」。
 *
 * 语义是**两段式确认**：第一次点只是进入待确认态（按钮变成「确认清空 / 取消」），
 * 第二次点才执行。用它就不用window.confirm —— 后者与整套自绘风格割裂，
 * 而且在同一个界面里和行内确认并存时，用户要建立两套肌肉记忆。
 *
 * @param state 当前状态
 * @param clicked 用户是否点了主按钮（false 表示点了取消）
 * @returns 是否应该真正执行这次操作
 */
export function shouldConfirm(state: ConfirmState, clicked: boolean): boolean {
  if (!clicked) return false // 取消永远不执行
  return state === 'armed' // 已待确认才执行；idle 时只是进入待确认
}

/* ================= 异步防重入 ================= */

/**
 * 造一个防重入守卫。
 *
 * 典型场景：CA 证书生成要写磁盘 + 生成密钥，整个面板 4 个按钮都没有 disabled 时，
 * 用户连点就会并发触发 caReset + caExport。
 *
 * @param isBusy 读当前是否在运行（由调用方用 state 闭包提供）
 */
export function makeAsyncGuard(isBusy: () => boolean): {
  enter: () => boolean
  isBusy: () => boolean
} {
  return {
    // 空闲才允许进入；已经在跑就拒绝，这次点击直接忽略
    enter: () => !isBusy(),
    isBusy,
  }
}

/**
 * 异步动作跑完后统一收尾：清 busy、错误归位。
 *
 * 单独抽出来是因为「catch 里忘了清 busy」是这类代码最常见的漏洞：
 * 一旦漏了，按钮会永久禁用到刷新页面，用户只能重启应用。
 */
export function finishAsync(
  setBusy: (v: boolean) => void,
  setError?: (msg: string | null) => void,
  err?: unknown,
): void {
  setBusy(false)
  if (setError) setError(err === undefined || err === null ? null : String(err instanceof Error ? err.message : err))
}