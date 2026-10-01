import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installWebApi } from './lib/web/web-api'

// 浏览器 / 插件版：没有 preload，装上浏览器版宿主实现（桌面版检测到 electronAPI 会跳过）
installWebApi()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
