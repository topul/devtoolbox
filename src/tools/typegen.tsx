/**
 * JSON 类型生成器 —— 粘贴 JSON，输出 TypeScript / Go / Rust / Python 的静态类型。
 * 推断与渲染全部在 toolkit/typegen.ts，本文件只做输入、语言切换与结果展示。
 */
import React, { useMemo } from 'react'
import {
  CopyBtn,
  ErrorNote,
  Input,
  Panel,
  TA,
  ToolShell,
  usePersistedState,
} from '../components/ui'
import { useLocalized } from '../lib/i18n'
import { cn } from '../lib/cn'
import { generateTypes, type TargetLang } from '../lib/toolkit/typegen'

const L = {
  zh: {
    input: 'JSON 输入',
    inputPh:
      '{\n  "name": "alice",\n  "age": 30,\n  "tags": ["admin"],\n  "address": { "city": "Shanghai" }\n}',
    rootName: '根类型名',
    output: '生成结果',
  },
  en: {
    input: 'JSON input',
    inputPh:
      '{\n  "name": "alice",\n  "age": 30,\n  "tags": ["admin"],\n  "address": { "city": "Shanghai" }\n}',
    rootName: 'Root type name',
    output: 'Generated code',
  },
}

const TABS: { id: TargetLang; label: string }[] = [
  { id: 'typescript', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'python', label: 'Python' },
]

export function TypeGenTool() {
  const l = useLocalized(L)
  const [input, setInput] = usePersistedState('typegen', 'input', '')
  const [lang, setLang] = usePersistedState<TargetLang>('typegen', 'lang', 'typescript')
  const [rootName, setRootName] = usePersistedState('typegen', 'root', 'Root')

  const result = useMemo(
    () => (input.trim() ? generateTypes(input, lang, rootName) : null),
    [input, lang, rootName],
  )

  return (
    <ToolShell toolId="typegen">
      <TA
        toolInput
        spellCheck
        value={input}
        onChange={setInput}
        label={l.input}
        placeholder={l.inputPh}
        rows={10}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40 shrink-0">
          <Input value={rootName} onChange={setRootName} label={l.rootName} placeholder="Root" />
        </div>
        <div className="flex rounded-lg border border-line-soft bg-panel-2 p-0.5" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={lang === tab.id}
              onClick={() => setLang(tab.id)}
              className={cn(
                'rounded-md px-3 py-1 text-[12px] transition-colors',
                lang === tab.id
                  ? 'bg-phosphor-faint text-phosphor font-medium'
                  : 'text-muted hover:text-bright',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {result && !result.ok && <ErrorNote msg={result.error ?? ''} />}

      {result?.ok && result.code !== undefined && (
        <Panel title={l.output} right={<CopyBtn text={result.code} />}>
          <pre
            className="codeblock overflow-auto text-[12px] leading-relaxed"
            style={{ maxHeight: 560 }}
          >
            {result.code}
          </pre>
        </Panel>
      )}
    </ToolShell>
  )
}
