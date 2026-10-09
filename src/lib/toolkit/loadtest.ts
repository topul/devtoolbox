/**
 * HTTP 压测的统计层 —— 采样在组件里做（复用主进程 HTTP 内核），这里只管算。
 * 分位数用最近邻插值（与 ab/wrk 语义一致），样本按需排序一次即可。
 */

export interface LoadSample {
  /** 全流程耗时 ms */
  ms: number
  /** HTTP 状态码；网络错误为 0 */
  status: number
  /** 响应字节数（错误为 0） */
  bytes: number
  /** 网络级错误码（如 ENOTFOUND），与状态码分开聚合 */
  errorCode?: string
}

export interface LoadLatency {
  min: number
  avg: number
  p50: number
  p90: number
  p95: number
  p99: number
  max: number
}

export interface LoadStats {
  total: number
  ok: number
  failed: number
  /** 吞吐：请求/秒（按实际压测时长算，不是按单请求） */
  rps: number
  /** 吞吐：KB/s */
  kbps: number
  bytesTotal: number
  latency: LoadLatency
  /** 2xx/3xx/4xx/… 计数 */
  statusCounts: { status: number; count: number }[]
  /** 网络级错误聚合（errorCode → count） */
  errors: { code: string; count: number }[]
}

/** 最近邻分位数：sorted 已升序 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

export function summarize(samples: LoadSample[], elapsedMs: number): LoadStats {
  const times = samples.map((s) => s.ms).sort((a, b) => a - b)
  const sum = times.reduce((a, b) => a + b, 0)
  const bytesTotal = samples.reduce((a, s) => a + s.bytes, 0)
  const sec = Math.max(elapsedMs, 1) / 1000

  const byStatus = new Map<number, number>()
  const byError = new Map<string, number>()
  let ok = 0
  let failed = 0
  for (const s of samples) {
    if (s.errorCode) {
      failed++
      byError.set(s.errorCode, (byError.get(s.errorCode) ?? 0) + 1)
      continue
    }
    if (s.status >= 200 && s.status < 400) ok++
    else failed++
    byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1)
  }

  const statusAsc = (m: Map<number, number>): { status: number; count: number }[] =>
    [...m.entries()].sort((a, b) => a[0] - b[0]).map(([status, count]) => ({ status, count }))

  return {
    total: samples.length,
    ok,
    failed,
    rps: samples.length / sec,
    kbps: bytesTotal / 1024 / sec,
    bytesTotal,
    latency: {
      min: times[0] ?? 0,
      avg: times.length ? sum / times.length : 0,
      p50: percentile(times, 50),
      p90: percentile(times, 90),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      max: times[times.length - 1] ?? 0,
    },
    statusCounts: statusAsc(byStatus),
    errors: [...byError.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({ code, count })),
  }
}

/** 中途停止时也用同一入口：已完成的样本就是全部样本 */
export function liveStats(samples: LoadSample[], elapsedMs: number): LoadStats {
  return summarize(samples, elapsedMs)
}
