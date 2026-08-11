# 家庭記帳 v2

這是與舊版 GAS／Google Sheets 完全隔離的 React + TypeScript 前端。

## 本機開發

在專案根目錄執行：

```bash
npm install
firebase emulators:start --project demo-family-finance-v2
npm run dev:v2
```

開啟 Vite 顯示的本機網址，按「進入本機測試帳本」。測試帳號與資料只存在 Firebase Emulator。

## 正式測試環境

複製 `.env.example` 為 `.env.local`，填入獨立的 Firebase 測試專案設定。不要連到舊站或正式財務資料。
