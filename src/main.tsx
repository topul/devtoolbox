import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installWebApi } from './lib/web/web-api'
import { purgeSensitiveSession } from './lib/persist'

// 浏览器 / 插件版：没有 preload，装上浏览器版宿主实现（桌面版检测到 electronAPI 会跳过）
installWebApi()

// 敏感输入（JWT token、密钥）走会话级存储，正常关闭应用会被清掉；
// 但崩溃 / 强杀 / 系统重启时可能残留，启动时主动清一遍把口子关严。
purgeSensitiveSession()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
