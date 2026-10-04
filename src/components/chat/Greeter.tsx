/**
 * 空会话引导小人（对话首页）：戴耳机的程序员坐在笔记本前 ——
 * 屏幕光标闪烁、偶尔眨眼、咖啡冒着热气。
 *
 * 纯描边线稿，颜色走 currentColor（由外层 text-phosphor 主题类驱动），
 * 深浅主题自动适配；动效类（greeter-*）定义在 index.css。
 */
import React from 'react'

export function Greeter(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 128 92"
      aria-hidden
      className="mx-auto mb-5 w-[128px] text-phosphor/80"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 桌面 */}
      <path d="M22 82h88" />
      {/* 身体：肩线从笔记本两侧露出 */}
      <path d="M40 74Q64 58 88 74" />
      {/* 头 */}
      <circle cx="64" cy="26" r="13" />
      {/* 耳机 */}
      <path d="M49 27a15 15 0 0 1 30 0" />
      <rect x="46" y="24" width="5.5" height="9" rx="2.2" />
      <rect x="76.5" y="24" width="5.5" height="9" rx="2.2" />
      {/* 眼睛（会眨眼） */}
      <g className="greeter-eyes" fill="currentColor" stroke="none">
        <circle cx="59" cy="25" r="1.8" />
        <circle cx="69" cy="25" r="1.8" />
      </g>
      {/* 微笑 */}
      <path d="M59.5 30.5Q64 34.5 68.5 30.5" />
      {/* 笔记本：屏幕上是 >_ 提示符和闪烁的块状光标。
          屏幕与底座填底色 —— 盖住身后透过来的肩线 */}
      <rect x="47" y="54" width="34" height="22" rx="2" fill="var(--c-bg)" />
      <text
        x="51.5"
        y="68"
        fontSize="8.5"
        fontFamily="'JetBrains Mono', ui-monospace, monospace"
        fill="currentColor"
        stroke="none"
      >
        &gt;_
      </text>
      <rect className="greeter-cursor" x="62.5" y="59.5" width="5.4" height="9.5" rx="1.2" fill="currentColor" stroke="none" />
      <path d="M43 76h42l5.5 6H37z" fill="var(--c-bg)" />
      {/* 咖啡（热气两段错峰升起） */}
      <rect x="96" y="69" width="13" height="13" rx="2" />
      <path d="M109 72q7 4.5 0 9" />
      <path className="greeter-steam" d="M99.5 63q2 -3 0 -6" />
      <path className="greeter-steam greeter-steam-s2" d="M104.5 63q-2 -3 0 -6" />
    </svg>
  )
}
