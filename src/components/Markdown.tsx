/**
 * 模型回复的 Markdown 渲染。
 *
 * 三条设计选择，都是被具体问题逼出来的：
 *
 * 1. **不碰 `dangerouslySetInnerHTML`**。模型输出属于不可信输入，走 react-markdown 的
 *    React 元素输出 + 默认的 URL 白名单（非 http/https/mailto 等协议会被清成空串），
 *    结构上就没有注入点。原始 HTML 也刻意不开（不引 rehype-raw）。
 * 2. **代码块自带复制按钮与语言名**。对话里代码块是最常被拷走的东西，
 *    让人用鼠标划选一整段是最没必要的摩擦。
 * 3. **外链一律交给系统浏览器**。渲染层是应用外壳，`<a>` 直接导航会把整个界面顶掉；
 *    外链图片同样不加载（生产 CSP 里 `img-src` 只允许 self/data/blob）。
 */
import React, { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useI18n } from '../lib/i18n'
import { COMMON } from '../lib/locales/ui'
import { CopyBtn } from './ui'

/** 插件数组放在模块级：每次渲染都传新数组会让处理器重建，长回复下开销可观 */
const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [[rehypeHighlight, { detect: false }]] as never

const LANGUAGE_RE = /language-([\w+#.-]+)/

/** 把 React 子树里的文本抠出来（复制按钮与「是不是块级代码」的判断都用它） */
function extractText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  const el = node as { props?: { children?: React.ReactNode } }
  return extractText(el.props?.children)
}

function CodeRenderer({ className, children }: { className?: string; children?: React.ReactNode }): React.ReactElement {
  const cls = className ?? ''
  const lang = LANGUAGE_RE.exec(cls)?.[1] ?? ''
  const text = extractText(children)
  // 没有语言标注的围栏代码块也要认出来：只要带换行就不是行内代码
  const isBlock = !!lang || text.includes('\n')
  if (!isBlock) return <code className="md-inline-code">{children}</code>

  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="md-code-lang">{lang || 'text'}</span>
        <CopyBtn text={text} />
      </div>
      <pre className="codeblock">
        <code className={cls}>{children}</code>
      </pre>
    </div>
  )
}

function LinkRenderer({ href, children }: { href?: string; children?: React.ReactNode }): React.ReactElement {
  const { locale } = useI18n()
  const c = COMMON[locale]
  const url = href ?? ''
  return (
    <a
      href={url}
      title={c.openInBrowser}
      rel="noopener noreferrer"
      onClick={(e) => {
        // 永远不在应用窗口里导航：外链交给系统浏览器
        e.preventDefault()
        if (url) void window.electronAPI?.openExternal(url)
      }}
    >
      {children}
    </a>
  )
}

function ImageRenderer({ src, alt }: { src?: string; alt?: string }): React.ReactElement {
  const { locale } = useI18n()
  const c = COMMON[locale]
  const url = src ?? ''
  // 本地内联图能显示；外链图受 CSP 限制，与其静默留白不如说清楚
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return <img src={url} alt={alt ?? ''} className="md-img" />
  }
  return (
    <span className="md-img-blocked" title={url}>
      🖼 {alt || url} <span className="md-img-note">· {c.imageBlocked}</span>{' '}
      <a
        href={url}
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault()
          if (url) void window.electronAPI?.openExternal(url)
        }}
        title={c.openInBrowser}
      >
        ↗
      </a>
    </span>
  )
}

const COMPONENTS: Components = {
  // 代码块自己带外壳，这里把 <pre> 消掉，避免 pre 里套 div 的非法结构
  pre: ({ children }) => <>{children}</>,
  code: CodeRenderer as Components['code'],
  a: LinkRenderer as Components['a'],
  img: ImageRenderer as Components['img'],
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
}

/**
 * 正文渲染。`memo` 是必要的：流式输出时每一帧都会重算父组件，
 * 但只有正在增长的那一条消息的 text 变了，其余消息不该跟着重新解析 Markdown。
 */
export const Markdown = memo(function Markdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
