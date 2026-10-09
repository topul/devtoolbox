/**
 * Glob 模式测试器 —— regex 工具的姊妹篇：.gitignore / shell 通配 / CI path filter
 * 的规则写完当场验证。算法用 minimatch，纯数据结果在 toolkit/glob.ts。
 */
import React, { useMemo } from 'react'
import { Panel, TA, ToolShell, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { globMatch } from '../lib/toolkit/glob'

const L = {
  zh: {
    patterns: '模式（每行一条）',
    patternsPh: 'src/**/*.ts\n!**/node_modules/**\nDockerfile*',
    paths: '路径（每行一条）',
    pathsPh: 'src/index.ts\nsrc/lib/util.ts\nnode_modules/x.js\nDockerfile.dev',
    dot: '匹配点文件（.gitignore 语义）',
    basename: '只按文件名匹配',
    result: '匹配结果',
    matchedBy: '命中',
    hit: '命中',
    miss: '未命中',
  },
  en: {
    patterns: 'Patterns (one per line)',
    patternsPh: 'src/**/*.ts\n!**/node_modules/**\nDockerfile*',
    paths: 'Paths (one per line)',
    pathsPh: 'src/index.ts\nsrc/lib/util.ts\nnode_modules/x.js\nDockerfile.dev',
    dot: 'Match dotfiles (.gitignore semantics)',
    basename: 'Match basename only',
    result: 'Results',
    matchedBy: 'matched by',
    hit: 'HIT',
    miss: 'MISS',
  },
}

export function GlobTool() {
  const l = useLocalized(L)
  const [patterns, setPatterns] = usePersistedState('glob-tester', 'patterns', '')
  const [paths, setPaths] = usePersistedState('glob-tester', 'paths', '')

  const results = useMemo(
    () => globMatch(patterns.split('\n'), paths.split('\n')),
    [patterns, paths],
  )
  const hitCount = results.filter((r) => r.matched).length

  return (
    <ToolShell toolId="glob-tester">
      <TA
        toolInput
        value={patterns}
        onChange={setPatterns}
        label={l.patterns}
        placeholder={l.patternsPh}
        rows={6}
        spellCheck
      />
      <TA
        value={paths}
        onChange={setPaths}
        label={l.paths}
        placeholder={l.pathsPh}
        rows={6}
        spellCheck
      />

      {results.length > 0 && (
        <Panel title={`${l.result} · ${hitCount}/${results.length}`}>
          <div className="space-y-1">
            {results.map((r) => (
              <div key={r.path} className="flex items-baseline gap-2 text-[12.5px] py-0.5">
                <span
                  className={`shrink-0 font-mono text-[11px] px-1.5 rounded ${
                    r.matched ? 'text-phosphor bg-phosphor-faint/60' : 'text-muted/70'
                  }`}
                >
                  {r.matched ? l.hit : l.miss}
                </span>
                <span className="font-mono text-bright break-all">{r.path}</span>
                {r.matchedBy.length > 0 && (
                  <span className="text-[11px] text-muted shrink-0">
                    {l.matchedBy}: {r.matchedBy.join(', ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </ToolShell>
  )
}
