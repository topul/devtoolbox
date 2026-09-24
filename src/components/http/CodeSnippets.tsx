import React, { useMemo, useState } from 'react'
import { CopyBtn } from '../ui'
import { CODE_TARGETS, generateCode, type CodeTarget, type RequestDoc } from '../../lib/http-codegen'
import type { httpClientL } from '../../lib/locales/httpclient'

type L = typeof httpClientL['zh']

/**
 * 多语言代码生成面板。
 *
 * 只依赖一个 RequestDoc —— 所以「还没发过请求」也能用；响应页签里传的是「实际发出的请求」，
 * 两处共用同一份实现，不会出现「表单里是这样、发出去是那样」两套代码。
 *
 * `codeHeight` 是给抽屉用的：抽屉有整屏高度，代码块还锁在 360px 会留一大片空白。
 */
export function CodeSnippets({ doc, l, codeHeight = '360px' }: { doc: RequestDoc; l: L; codeHeight?: string }) {
  const [target, setTarget] = useState<CodeTarget>('curl')
  const code = useMemo(() => generateCode(target, doc), [target, doc])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap">
        {CODE_TARGETS.map((t) => (
          <button
            key={t}
            onClick={() => setTarget(t)}
            className={`px-2 py-0.5 text-[11px] border transition-colors ${target === t ? 'border-phosphor/60 text-phosphor bg-phosphor-faint' : 'border-line-soft text-muted hover:text-phosphor'}`}
          >
            {l.code.langs[t]}
          </button>
        ))}
        <CopyBtn text={code} className="ml-auto" />
      </div>
      <pre style={{ maxHeight: codeHeight }} className="codeblock overflow-auto bg-panel-2 border border-line-soft px-3 py-2 text-[11.5px] text-bright">{code}</pre>
      <div className="text-[11px] text-muted">{l.code.hint}</div>
    </div>
  )
}
