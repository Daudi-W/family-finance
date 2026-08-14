# v2 Firebase 正式環境

## 環境

- Firebase 專案：`family-finance-home-260814`
- 正式入口：<https://family-finance-home-260814.firebaseapp.com/>
- Firestore：Standard、`asia-east1`（台灣）、刪除保護已啟用
- Authentication：Google 登入
- 家庭帳本：`family-home`
- 本機 production Firebase 設定放在 git 忽略的 `v2/.env.production.local`，不可提交

## 權限

- 家庭成員必須存在 `households/family-home/members/{uid}`。
- owner 由正式匯入工具建立；一般成員不能修改成員名單或把自己升成 owner。
- 受邀 Email 只存在 production Firestore 的 `invites`，不寫入程式碼或 Git。受邀者第一次 Google 登入時，只能替自己的 UID 建立 `member` 權限；其他 Email、其他 UID 與 owner 角色都會被 Rules 拒絕。

## 正式匯入

- 匯入批次：`legacy-2026-08-14`
- 帳戶 38 個、類別 36 個、交易 3,512 筆、owner 1 位；另有 1 筆未來交易暫留，不提前入帳。
- `scripts/import-production-firestore.mts` 預設只輸出預覽，必須加 `--apply` 才會寫入。
- 工具拒絕 dev／demo 專案，會驗證帳戶對應與 ID 唯一性；production 已有不同批次或未預期資料時停止。寫入後逐集合核對筆數，再把批次標記為完成。
- 真實 CSV、對應表與匯入內容都留在 git 忽略的 `local/` 或使用者下載資料夾，不進版控。

## 部署與驗證

```bash
npm test
firebase deploy --only hosting,firestore:rules,firestore:indexes --project prod
```

正式上線時已通過 31 項程式測試、10 項 Auth／Firestore Rules 測試、lint 與 production build。線上 HTML、JS／CSS hash、owner Google 登入、24 個啟用帳戶、6 個帳戶群組、當月交易清單與四個報表分頁均已驗證，console 無錯誤。
