# v2 Firebase 開發環境

## 用途

這個環境只用來開發與驗證家庭記帳 v2，和舊版 GAS／Google Sheets 分開。現階段不匯入舊資料，也不讀寫正式財務資料。

## 環境

- Firebase 專案 ID：`family-finance-v2-dev-260811`
- Hosting：<https://family-finance-v2-dev-260811.firebaseapp.com>
- Firestore：Standard、`asia-east1`（台灣）、已開啟刪除保護
- Authentication：Google 登入
- 家庭帳本 ID：`family-home`

## 權限模型

登入成功不等於可以讀取帳本。使用者還必須有以下成員文件：

```text
households/family-home/members/{uid}
```

目前的擁有者文件只有 `role: owner`，不把姓名、信箱或財務資料寫入版控。

Firestore 規則限制使用者只能讀取自己所屬家庭的資料；前端也會先檢查成員文件，非成員會停在「尚未加入家庭帳本」頁面。

## 本機驗證

```bash
npm test
```

完整測試包含後端安全檢查、核心計算、Firebase Auth Emulator 與 Firestore Rules Emulator。

## 部署

```bash
npm run deploy:dev:v2
```

部署指令會先建置 React v2，再只更新這個 dev 專案的 Firebase Hosting。Firestore 規則若有修改，需另外執行：

```bash
firebase deploy --only firestore:rules,firestore:indexes --project dev
```

## 目前狀態

分類、帳戶、交易、預算、專案、定期項目、代墊分帳、行事曆與報表都已接上 dev Firestore。測試站已有一組不含真實資訊的示範資料，供手機與電腦版操作驗證。

完整測試目前共 31 項，另包含 lint 與 production build。實際雲端已驗證新增／編輯／作廢交易、餘額與報表回算，以及多人代墊的部分收款。

## 尚未進行

- 尚未匯入舊版 GAS／Sheets／天天記帳資料
- 尚未建立正式 production Firebase 專案或切換正式入口
- 尚未開啟 Render 推播；目前提醒只在開啟 App 後處理
- 尚未進行 PWA 安裝、離線操作與前端程式碼分割最佳化

下一步先由 Pei Ching 使用示範資料完整走一次日常情境，記錄操作不順或欄位缺漏；確認後才建立一次性匯入預覽，不直接寫入正式資料。
