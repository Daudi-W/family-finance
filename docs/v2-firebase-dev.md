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

## 下一步

先以示意資料建立第一個 Firestore 集合並接上畫面。建議由「分類」開始，因為不涉及真實金額，最適合先驗證讀取、排序、圖示與成員權限。
