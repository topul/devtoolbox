/**
 * JSON Diff —— 左右两份 JSON 实时对比，输出按 JSON Pointer 定位的结构差异。
 * 算法在 toolkit/jsondiff.ts（对象递归 + 数组 LCS 对齐），本文件只做展示：
 * +/-/~ 三种前缀分别用 phosphor/danger/bright 着色，顶部计数条先给总量感。
 * 左右都为空时不出结果区，避免一进页面就是一片报错。
 */
import React, { useMemo } from 'react'
import { ErrorNote, Panel, Stat, TA, ToolShell, usePersistedState } from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { diffJson, stringifyValue } from '../lib/toolkit/jsondiff'

const L = {
  zh: {
    left: '左侧（旧）',
    leftPh: '{\n  "name": "alice",\n  "tags": ["a", "b"]\n}',
    right: '右侧（新）',
    rightPh: '{\n  "name": "bob",\n  "tags": ["b", "c"]\n}',
    added: '新增',
    removed: '删除',
    changed: '修改',
    result: '差异结果',
    identical: '两份 JSON 完全一致',
  },
  en: {
    left: 'Left (before)',
    leftPh: '{\n  "name": "alice",\n  "tags": ["a", "b"]\n}',
    right: 'Right (after)',
    rightPh: '{\n  "name": "bob",\n  "tags": ["b", "c"]\n}',
    added: 'Added',
    removed: 'Removed',
    changed: 'Changed',
    result: 'Diff result',
    identical: 'The two JSON documents are identical',
  },
}

const KIND_MARK = { added: '+', removed: '-', changed: '~' } as const
const KIND_CLS = { added: 'text-phosphor', removed: 'text-danger', changed: 'text-bright' } as const

export function JsonDiffTool() {
  const l = useLocalized(L)
  const [left, setLeft] = usePersistedState('json-diff', 'left', '')
  const [right, setRight] = usePersistedState('json-diff', 'right', '')

  const result = useMemo(
    () => (left.trim() || right.trim() ? diffJson(left, right) : null),
    [left, right],
  )
  const entries = result && result.ok ? result.entries : null
  const error = result && !result.ok ? result.error : null
  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, changed: 0 }
    for (const e of entries ?? []) c[e.kind] += 1
    return c
  }, [entries])

  return (
    <ToolShell toolId="json-diff">
      <TA
        toolInput
        spellCheck
        value={left}
        onChange={setLeft}
        label={l.left}
        placeholder={l.leftPh}
        rows={8}
      />
      <TA
        spellCheck
        value={right}
        onChange={setRight}
        label={l.right}
        placeholder={l.rightPh}
        rows={8}
      />

      {error && <ErrorNote msg={error} />}

      {entries && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label={l.added} value={<span className="text-phosphor">{counts.added}</span>} />
            <Stat label={l.removed} value={<span className="text-danger">{counts.removed}</span>} />
            <Stat label={l.changed} value={<span className="text-bright">{counts.changed}</span>} />
          </div>

          <Panel title={`${l.result} · ${entries.length}`}>
            {entries.length === 0 ? (
              <p className="py-1 text-[12.5px] text-phosphor">✓ {l.identical}</p>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: 400 }}>
                <div className="space-y-0.5">
                  {entries.map((e, i) => (
                    <div key={i} className="flex items-baseline gap-2 py-0.5 text-[12.5px]">
                      <span className={`w-3 shrink-0 font-mono ${KIND_CLS[e.kind]}`}>
                        {KIND_MARK[e.kind]}
                      </span>
                      <span className="shrink-0 break-all font-mono text-bright">
                        {e.path || '/'}
                      </span>
                      <span className="min-w-0 break-all font-mono text-[11.5px] text-muted">
                        {e.kind === 'added'
                          ? stringifyValue(e.right)
                          : e.kind === 'removed'
                            ? stringifyValue(e.left)
                            : `${stringifyValue(e.left)} → ${stringifyValue(e.right)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </ToolShell>
  )
}
