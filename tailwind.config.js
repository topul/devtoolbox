/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        phosphor: 'var(--c-phosphor)',
        'phosphor-hover': 'var(--c-phosphor-hover)',
        'phosphor-glow': 'var(--c-phosphor-glow)',
        'phosphor-dim': 'var(--c-phosphor-dim)',
        'phosphor-faint': 'var(--c-phosphor-faint)',
        terminal: 'var(--c-bg)',
        panel: 'var(--c-panel)',
        'panel-2': 'var(--c-panel-2)',
        line: 'var(--c-line)',
        'line-soft': 'var(--c-line-soft)',
        amber: 'var(--c-amber)',
        danger: 'var(--c-danger)',
        muted: 'var(--c-muted)',
        bright: 'var(--c-text-bright)',
        dim: 'var(--c-text-dim)',
        cardtext: 'var(--c-text-card)',
        'on-phosphor': 'var(--c-on-phosphor)',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', '"PingFang SC"', '"Microsoft YaHei"', 'monospace'],
      },
    },
  },
  plugins: [],
}
