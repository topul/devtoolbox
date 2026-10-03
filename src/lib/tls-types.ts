/**
 * TLS 握手详情的数据契约（跨 main / renderer 共享）。
 *
 * 放独立文件的原因：preload 与渲染层各有���份手写 interface，
 * 让它们都`import type` 这个片段，避免抄两份走样。
 */

/** 证书链上的一张证书 */
export interface TlsCert {
  subject: string
  issuer: string
  /** 生效时间（ISO 字符串） */
  notBefore: string
  notAfter: string
  /** 剩余有效天数；已过期为负 */
  daysLeft: number
  serial: string
  /** 证书里的域名（CN + SAN） */
  domains: string[]
  isCa: boolean
  /** 指纹 SHA-256（冒号分隔的大写 hex） */
  fingerprint256: string
  fingerprint1: string
  sigAlg: string
  pubkeyAlg: string
  /** 密钥位数（RSA）；ECDSA 等拿不到时为 0 */
  keyBits: number
}

/** 一次握手观测的完整结果 */
export interface TlsProbe {
  ok: boolean
  /** 失败时的稳定错误码 */
  errorCode?: string
  /** 失败时的补充说明（英文，界面负责映射文案） */
  errorDetail?: string
  host: string
  port: number
  /** 协商出的 TLS 版本，如 `TLSv1.3` */
  protocol: string
  /** 协商出的加密套件 */
  cipher: string
  cipherName: string
  /** TLS 1.3 的套件在 getCipher() 里返回 0x13 开头，要单独取 */
  cipherSuiteName: string
  alpn: string
  sni: string
  /** 服务端证书（含链上其余证书） */
  certs: TlsCert[]
  /** 握手耗时（毫秒） */
  elapsedMs: number
  /** 证书校验是否通过 */
  authorized: boolean
  authorizationError: string
  /** 是否为 IP 直连（无 SNI） */
  isIpHost: boolean
}

/** preload / 渲染层共享的 API 形状（两边都 import 这份，避免抄两份走样） */
export interface TlsAPI {
  probe: (host: string, port: number, timeoutMs: number) => Promise<TlsProbe>
}
