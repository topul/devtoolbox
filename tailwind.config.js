/*
 * 主题色是 CSS 变量（hex 字符串）。直接写 'var(--c-x)' 时，Tailwind 的透明度
 * 修饰符（text-phosphor/40 等）会生成 rgb(var(--c-x) / 0.4) —— var 里是 hex
 * 而不是逗号分隔的 RGB 分量，整条声明会被浏览器丢弃、静默失效。
 * 改成函数形式 + color-mix 现场混透明度（Chromium 111+ / Electron 41 均支持）。
 *
 * 注意函数色的三种调用形态（见 tailwindcss lib/util/withAlphaVariable.js）：
 *   1. 带修饰符 text-phosphor/40 → opacityValue 是数值 '0.4'
 *   2. 基础类 bg-panel          → 走 withAlphaVariable，opacityValue 是
 *      'var(--tw-bg-opacity, 1)' 的**变量引用字符串**（不能 parseFloat！）
 *   3. toColorValue 路径        → 无参调用，opacityValue 为 undefined
 */
const themeColor =
  (name) =>
  ({ opacityValue } = {}) => {
    if (opacityValue === undefined) return `var(${name})`
    if (String(opacityValue).startsWith('var(')) {
      return `color-mix(in srgb, var(${name}) calc((${opacityValue}) * 100%), transparent)`
    }
    return `color-mix(in srgb, var(${name}) ${Math.round(parseFloat(opacityValue) * 100)}%, transparent)`
  }

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        phosphor: themeColor('--c-phosphor'),
        'phosphor-hover': themeColor('--c-phosphor-hover'),
        'phosphor-glow': themeColor('--c-phosphor-glow'),
        'phosphor-dim': themeColor('--c-phosphor-dim'),
        'phosphor-faint': themeColor('--c-phosphor-faint'),
        terminal: themeColor('--c-bg'),
        panel: themeColor('--c-panel'),
        'panel-2': themeColor('--c-panel-2'),
        line: themeColor('--c-line'),
        'line-soft': themeColor('--c-line-soft'),
        amber: themeColor('--c-amber'),
        danger: themeColor('--c-danger'),
        muted: themeColor('--c-muted'),
        bright: themeColor('--c-text-bright'),
        dim: themeColor('--c-text-dim'),
        cardtext: themeColor('--c-text-card'),
        'on-phosphor': themeColor('--c-on-phosphor'),
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
