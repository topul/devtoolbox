/**
 * 二维码解码 —— 项目里已有「生成二维码」的工具（qrcode 库），这里补上反方向：
 * 从图片像素里把内容读出来。核心识别交给 jsqr（纯 JS，无需 canvas/DOM），
 * 本文件只收一个「像素数据进、解码结果出」的纯函数口，MCP 与界面共用；
 * 图片 → 像素的采样流程在组件里做（离屏 canvas 缩放后 getImageData）。
 */
import jsQR from 'jsqr'

export type QrDecodeResult = { ok: true; text: string } | { ok: false; error: string }

/**
 * 从 RGBA 像素数据中解码二维码。
 * @param data getImageData 得到的 RGBA 字节流（长度 = width * height * 4）
 * @param width  像素宽
 * @param height 像素高
 * @returns 成功给解码文本；画面里没有可识别的二维码时给英文错误说明
 */
export function decodeQr(data: Uint8ClampedArray, width: number, height: number): QrDecodeResult {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return { ok: false, error: 'invalid pixel buffer' }
  }
  const res = jsQR(data, width, height)
  if (!res) return { ok: false, error: 'no QR code found' }
  return { ok: true, text: res.data }
}
