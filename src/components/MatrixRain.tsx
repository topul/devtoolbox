import { useEffect, useRef } from 'react'

const CHARS = '01アカサタナハマヤラワ<>/{}[]()=+*#$%!?:;ｱｶｻﾀﾅﾊﾏﾔﾗﾜ0101'

export default function MatrixRain({ opacity = 0.14, className = '' }: { opacity?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let cols = 0
    let drops: number[] = []
    const fs = 14

    // 从 CSS 变量读取颜色，支持主题切换
    const readColors = () => {
      const styles = getComputedStyle(document.documentElement)
      return {
        bg: styles.getPropertyValue('--c-matrix-bg').trim() || 'rgba(0,0,0,0.14)',
        bright: styles.getPropertyValue('--c-phosphor-glow').trim() || '#b8ffe0',
        main: styles.getPropertyValue('--c-phosphor').trim() || '#00F48E',
      }
    }
    let colors = readColors()

    // 监听主题变化（MutationObserver 观察 html class 变化）
    const observer = new MutationObserver(() => {
      colors = readColors()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      canvas.width = parent.clientWidth
      canvas.height = parent.clientHeight
      cols = Math.floor(canvas.width / fs)
      drops = Array.from({ length: cols }, () => Math.random() * -60)
    }
    resize()
    window.addEventListener('resize', resize)

    let last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 50) return
      last = t
      ctx.fillStyle = colors.bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.font = `${fs}px "JetBrains Mono", monospace`
      for (let i = 0; i < cols; i++) {
        const ch = CHARS[Math.floor(Math.random() * CHARS.length)]
        const x = i * fs
        const y = drops[i] * fs
        ctx.fillStyle = Math.random() > 0.975 ? colors.bright : colors.main
        ctx.fillText(ch, x, y)
        if (y > canvas.height && Math.random() > 0.976) drops[i] = 0
        drops[i]++
      }
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      observer.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={ref}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ opacity }}
    />
  )
}
