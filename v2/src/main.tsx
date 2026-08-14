import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './RootApp.tsx'

// 註冊離線快取；開發模式不註冊，避免蓋掉即時更新。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js') })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
