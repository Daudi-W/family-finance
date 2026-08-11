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

- Firebase 專案：`family-finance-v2-dev-260811`
- 測試網址：<https://family-finance-v2-dev-260811.firebaseapp.com>
- Firestore 區域：`asia-east1`（台灣）
- 登入方式：Google；登入後還需存在 `households/family-home/members/{uid}` 才能進入帳本

部署目前的 v2 前端：

```bash
npm run deploy:dev:v2
```

`.env.local` 不會進入 Git。專案內只保留 `.env.example` 的欄位範本，不保存 Firebase 設定值、登入信箱或家庭財務資料。

目前雲端頁面使用存放在 dev Firestore 的示意資料；舊版網站、GAS、Google Sheets 與歷史資料都沒有搬移或修改。

## 目前可操作範圍

- 分類與線條圖示：新增、編輯、排序、封存
- 帳戶：新增、設定、拖曳排序、封存、隱藏餘額、帳戶明細與餘額調整
- 交易：收入、支出、同幣別／跨幣別轉帳、手續費、專案、完整頁面編輯與作廢
- 預算：每月／年度分類預算、加總與實際支出
- 專案：設定、預算、專案收支與明細
- 定期項目：確認／自動入帳、提前顯示、略過與封存
- 代墊與分帳：多人應收／應付、個別餘額、部分收款／還款
- 查看：首頁、交易明細、行事曆、收入／支出／淨資產趨勢與分類報表

所有畫面都由同一批 Firestore 交易即時計算；兩台裝置同時修改同一文件時會阻止舊版本覆蓋新版本。
