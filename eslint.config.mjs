import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * 最小集 ESLint：typescript-eslint 推荐规则 + React hooks 经典规则。
 *
 * 几处刻意收敛：
 * - 不接 `recommendedTypeChecked`（需要全程序类型信息，CI 上慢一个量级），
 *   项目已有 strict tsc + 30 个 smoke 脚本兜底；
 * - hooks 只开 rules-of-hooks / exhaustive-deps 两条经典规则。
 *   eslint-plugin-react-hooks v6 新增的编译器规则（set-state-in-effect / refs /
 *   purity 等）会大面积误伤存量代码里合法的 effect 同步写法，留待后续按需逐个过；
 * - `no-explicit-any` 降为 warn：IPC 边界与测试脚本里 any 是合理实践，
 *   先可见、不阻断，随重构逐步清理。
 */
export default tseslint.config(
  {
    // 构建产物、依赖、打包 zip 一律不检
    ignores: [
      'out/**',
      'dist/**',
      'dist-extension/**',
      'release/**',
      'node_modules/**',
      'devtoolbox-extension-*.zip',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts', 'scripts/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      // `_` 前缀 = 有意保留的未使用项（解构剔除、接口占位参数）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
