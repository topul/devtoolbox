export const formatL = {
  zh: {
    json: {
      input: '输入 JSON',
      output: '输出',
      err: 'JSON 解析失败：',
      indentLabel: '缩进',
      indentOptions: [
        { value: '2', label: '2 空格' },
        { value: '4', label: '4 空格' },
        { value: '0', label: 'Tab 风格(0)' },
      ],
      format: '格式化 / 校验',
      minify: '压缩',
      escape: '转义为字符串',
      unescape: '去除转义',
    },
    sql: {
      input: '输入 SQL',
      output: '格式化结果',
    },
    xml: {
      input: '输入 XML / HTML',
      output: '输出',
      format: '格式化',
      minify: '压缩',
      xmlErr: 'XML 语法错误',
      err: '解析失败：',
    },
    markdown: {
      sourceTitle: 'markdown 源',
      previewTitle: '实时预览',
      sample: '# Hello\n\n输入 **Markdown**，右侧实时预览。\n\n- 支持标题 / 列表 / 代码\n- `inline code`\n\n```js\nconsole.log("hack the planet")\n```',
    },
  },
  en: {
    json: {
      input: 'Input JSON',
      output: 'Output',
      err: 'JSON parse failed: ',
      indentLabel: 'Indent',
      indentOptions: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
        { value: '0', label: 'Tab style (0)' },
      ],
      format: 'Format / Validate',
      minify: 'Minify',
      escape: 'Escape to String',
      unescape: 'Unescape',
    },
    sql: {
      input: 'Input SQL',
      output: 'Formatted Result',
    },
    xml: {
      input: 'Input XML / HTML',
      output: 'Output',
      format: 'Format',
      minify: 'Minify',
      xmlErr: 'XML syntax error',
      err: 'Parse failed: ',
    },
    markdown: {
      sourceTitle: 'Markdown Source',
      previewTitle: 'Live Preview',
      sample: '# Hello\n\nType **Markdown**, live preview on the right.\n\n- Supports headings / lists / code\n- `inline code`\n\n```js\nconsole.log("hack the planet")\n```',
    },
  },
}
