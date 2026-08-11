# 家庭記帳系統第二版：資料結構與計算規則

> 版本：v0.1  
> 日期：2026-08-11  
> 狀態：開發前資料契約；不含真實帳戶、金額或家庭成員資料

## 1. 核心原則

1. **交易是帳務唯一來源**：帳戶餘額、收入、支出、專案與報表都由正式交易推導；不直接覆寫餘額而不留紀錄。
2. **一筆交易只存一次**：分類、帳戶、專案與報表只是同一筆交易的不同查看角度，不能重複加總。
3. **轉帳不算收入或支出**：投資本金移動、信用卡繳款、一般帳戶互轉都只改變帳戶餘額。
4. **代墊收回不是收入，償還代墊不重複算支出**。
5. **所有修改可追溯**：刪除採作廢／封存，不硬刪已有歷史的帳戶、分類、專案、規則或交易。
6. **金額用整數最小單位儲存**：新台幣／日圓以元為單位；需要小數的幣別依貨幣小數位換算，避免浮點誤差。
7. **舊資料一次性匯入**：匯入前預覽、匯入後核對，可整批撤回，不改動舊站或原始 CSV。

## 2. Firestore 建議結構

所有家庭資料放在同一個家庭帳本底下：

```text
households/{householdId}
  members/{uid}
  accounts/{accountId}
  categories/{categoryId}
  projects/{projectId}
  transactions/{transactionId}
  advancePeople/{personId}
  recurringRules/{ruleId}
  recurringOccurrences/{occurrenceId}
  budgets/{budgetId}
  importBatches/{batchId}
```

兩位核准使用者只能讀寫自己所屬的 `householdId`；不提供公開註冊與多家庭切換。

## 3. 共用欄位

需要編輯、封存或同步的文件都包含：

| 欄位 | 用途 |
|---|---|
| `schemaVersion` | 資料格式版本，第一版為 `1` |
| `createdAt` / `updatedAt` | 建立與最後修改時間 |
| `createdBy` / `updatedBy` | 操作者 UID |
| `revision` | 每次修改加一，用來偵測兩台裝置同時編輯 |
| `archivedAt` | 帳戶、分類、專案、規則的封存時間 |
| `voidedAt` / `voidReason` | 交易作廢時間與原因 |

交易 ID 由裝置先產生 UUID，離線時也能安全新增；匯入資料另外保存來源 UUID，避免重複匯入。

## 4. 帳戶 `accounts`

```ts
type Account = {
  name: string
  type: 'cash' | 'bank' | 'credit_card' | 'investment'
  currency: 'TWD' | 'JPY' | 'USD' | string
  iconKey: string
  sortOrder: number
  includeInNetWorth: boolean
  openingBalanceMinor: number
  openingDate: 'YYYY-MM-DD'
  referenceRateToTwd?: number
  cachedBalanceMinor: number
  creditCard?: {
    closingDay: number
    paymentDay: number
    defaultPaymentAccountId?: string
  }
}
```

- 現金、銀行、投資屬於資產帳戶；信用卡屬於負債帳戶。
- 投資帳戶餘額代表**累計投入本金**，不串即時市值。
- 外幣帳戶保存手動更新的台幣參考匯率；淨資產換算使用該帳戶目前參考匯率。
- `cachedBalanceMinor` 只用來加快首頁；真正來源仍是期初餘額加所有正式帳戶異動，必須能重新計算核對。

## 5. 分類 `categories`

```ts
type Category = {
  name: string
  direction: 'income' | 'expense'
  parentId?: string
  iconKey: string
  sortOrder: number
  systemKey?: 'balance_adjustment_income' | 'balance_adjustment_expense'
}
```

- 收入與支出分類分開管理，可新增、排序與封存。
- 不建立「投資支出」分類；投資本金以轉帳處理，投資收益才使用收入分類。
- 不建立「定期費用」分類；定期是產生交易的規則，不是花費用途。
- 餘額校正對使用者只顯示一個「調整餘額」動作；系統依正負差額分別使用收入／支出的「帳務調整」系統分類。
- 帳務調整會出現在收支與趨勢，可單獨篩選，但不占一般分類預算。

## 6. 專案 `projects`

```ts
type Project = {
  name: string
  iconKey: string
  note?: string
  startDate?: 'YYYY-MM-DD'
  endDate?: 'YYYY-MM-DD'
  budgetMinor?: number
  currency: 'TWD'
}
```

- 收入與支出可選擇一個專案，同時納入整體報表與專案明細。
- 轉帳、信用卡繳款與代墊收／還款不設定專案；用途可寫在備註。
- 專案可編輯與封存；封存後歷史交易仍保留。

## 7. 統一交易 `transactions`

```ts
type Transaction = {
  kind:
    | 'income'
    | 'expense'
    | 'transfer'
    | 'advance'
    | 'settlement'
    | 'balance_adjustment'
  occurredOn: 'YYYY-MM-DD'
  note?: string
  projectId?: string
  accountMoves: AccountMove[]
  reportLines: ReportLine[]
  transfer?: TransferDetail
  advance?: AdvanceDetail
  adjustment?: AdjustmentDetail
  source?: ImportSource
}

type AccountMove = {
  accountId: string
  deltaMinor: number
  currency: string
}

type ReportLine = {
  direction: 'income' | 'expense'
  categoryId: string
  amountMinor: number
  currency: string
  amountTwdMinor: number
}
```

`accountMoves` 回答「帳戶餘額怎麼變」；`reportLines` 回答「收入／支出報表要算多少」。兩者分開後，轉帳與代墊才不會重複計算。

## 8. 各交易的計算規則

### 8.1 收入

- 資產帳戶：餘額增加。
- 信用卡退款若記為收入：信用卡負債減少。
- 產生一筆收入 `reportLine`，可選收入分類與專案。

### 8.2 支出

- 現金／銀行付款：資產帳戶餘額減少。
- 信用卡付款：信用卡負債增加。
- 產生一筆支出 `reportLine`，可選支出分類與專案。

### 8.3 轉帳

- 資產轉資產：轉出帳戶減少、轉入帳戶增加。
- 信用卡繳款：銀行／現金減少、信用卡負債減少。
- 投資本金：銀行減少、投資帳戶累計投入增加。
- 不產生收入或支出 `reportLine`，也不設定專案。
- 若有手續費：在同一筆交易增加支出 `reportLine`，並讓付款帳戶再減少手續費。
- 跨幣別轉帳保存轉出金額、轉入金額與當次匯率；兩邊各用自己的帳戶幣別入帳。

### 8.4 餘額調整

- 使用者輸入「實際餘額」，系統先算出「帳面餘額」及差額。
- 正差額：增加帳戶餘額，列入收入的「帳務調整」。
- 負差額：減少帳戶餘額，列入支出的「帳務調整」。
- 保存調整前、實際餘額、差額、日期與原因；不占預算。

### 8.5 我替別人代墊

- `totalMinor`：實際付款總額。
- `ownShareMinor`：家庭自己負擔的部分，可為 `0`。
- 付款帳戶依總額變動。
- 只有 `ownShareMinor` 進入支出報表；其餘依每位對象形成待收款。
- 純代墊時 `ownShareMinor = 0`，不產生支出。

### 8.6 別人替我代墊

- 建立時自己的帳戶不變。
- 家庭應負擔金額立即列為支出，並形成待還款。
- 日後還款才讓實際付款帳戶減少，但不再次列支出。

### 8.7 代墊收款／還款

- 每次可部分收／還，必須選實際進出帳戶。
- 收回現金、銀行入帳等只改變帳戶與待收餘額，不算收入。
- 還給別人只改變帳戶與待還餘額，不重複算支出。
- 每筆收／還款都是可點入編輯的交易，並連回原代墊紀錄。

## 9. 代墊資料 `advance`

```ts
type AdvanceDetail = {
  direction: 'receivable' | 'payable'
  totalMinor: number
  ownShareMinor: number
  currency: string
  people: Array<{
    personId: string
    expectedMinor: number
    settledMinor: number
  }>
}
```

首頁鈴鐺顯示尚未結清的代墊筆數；管理頁分成「別人應還我」與「我應還別人」。

## 10. 預算 `budgets`

```ts
type Budget = {
  categoryId: string
  cycle: 'monthly' | 'annual'
  amountMinor: number
  year?: number
}
```

- 每個分類同一期間只保留一個有效預算規則。
- 月預算每月重算；年度預算追蹤整年累計，可集中在特定月份使用。
- 月預算的年度參考值為 `月額 × 12`；年度預算的月均參考值為 `年額 ÷ 12`。
- 總預算由各分類預算加總，不另外維護容易不一致的手填總額。
- 專案預算獨立顯示，但專案支出仍屬整體實際支出。
- 帳務調整、轉帳與代墊收／還款不占分類預算。

## 11. 定期項目

```ts
type RecurringRule = {
  name: string
  transactionTemplate: object
  frequency: 'weekly' | 'monthly' | 'yearly'
  nextScheduledOn: 'YYYY-MM-DD'
  postingMode: 'confirm' | 'auto'
  previewDays: number
}
```

- 規則不是正式交易；到期後才產生 `recurringOccurrence`。
- 預設確認後入帳，可改為自動入帳。
- App 開啟後背景檢查，不阻塞首頁；可提前顯示、修改、略過、延後或提前入帳。
- `occurrenceId = ruleId + 預定日期`，兩位使用者同時開啟也不會重複產生。
- 只有正式入帳後才建立交易並影響餘額與報表。

## 12. 圖示

- 正式前端安裝 Lucide 套件並隨程式打包，不靠執行時 CDN。
- 資料只保存 `iconKey`，例如 `utensils`、`credit-card`、`landmark`、`plane`。
- 分類、帳戶與專案共用圖示選擇器；帳戶依類型先帶預設圖示，但可自行更換。
- 程式使用允許清單將 `iconKey` 對應到實際 SVG 元件；找不到時顯示通用圖示，不讓頁面載入失敗。

## 13. 舊資料匯入

優先順序：

1. 重新從天天記帳匯出「全部期間」的收支與轉帳 CSV，保留原始 UUID。
2. 從現行 GAS／Sheets 取得帳戶、目前餘額、對帳日期、快照與停用帳戶設定。
3. 以 GAS 內既有 `allTx`／`allTf` 作為缺漏比對，不直接假設 Downloads 內只有 2026 年 6 月的檔案是完整歷史。

主要欄位映射：

| 天天記帳欄位 | 第二版 |
|---|---|
| `UUID` | `source.sourceId`，並用於防重 |
| `日期` | `occurredOn` |
| `收支區分` | `kind`／`reportLines.direction` |
| `大類別`＋`類別` | 主分類＋子分類 |
| `帳戶` | `accountMoves.accountId` |
| `金額`＋`幣別` | 原幣金額 |
| `從帳戶`／`到帳戶` | 轉帳兩側帳戶 |
| `轉出金額`／`轉入金額` | 跨幣別轉帳兩側金額 |
| `標籤` | 保存在匯入來源資料，第一版可不顯示 |
| `成員` | 保存在匯入來源資料，第一版不提供成員欄位 |
| `備註` | `note` |
| `上次更新` | `source.updatedAt` |

每個匯入批次保存筆數、日期範圍、對應結果與核對摘要；正式寫入前可預覽，寫入後可依 `batchId` 整批撤回。

## 14. 必須通過的計算測試

1. 現金支出後，帳戶與支出各減／增一次。
2. 信用卡消費增加負債與支出；繳卡費只減銀行與信用卡負債，不再增加支出。
3. 銀行轉投資只改變兩個帳戶，不列支出。
4. 跨幣別轉帳的兩側原幣餘額正確，手續費另外列支出。
5. 純替別人代墊時付款帳戶全額變動，但家庭支出為零。
6. 有自己份額的多人代墊只把自己的份額算支出。
7. 別人分批還現金時，現金逐次增加、待收逐次減少，收入維持不變。
8. 別人替我代墊時先形成支出與待還；日後分次還款不重複算支出。
9. 餘額正／負調整分別進收入／支出的帳務調整分類，且預算不變。
10. 同一筆交易加入專案後，整體與專案都能查到，但總支出只計算一次。
11. 兩台裝置同時產生同一期定期項目，只會建立一筆交易。
12. 作廢或編輯舊交易後，帳戶餘額、月份報表、專案與預算都同步回算。

## 15. 開發順序

1. 先以純 TypeScript 建立上述交易計算器與自動測試，不接畫面、不放真實資料。
2. 再建立 Firebase 測試專案、登入白名單與 Firestore Rules。
3. 接上帳戶、分類及收入／支出／轉帳三個基本流程。
4. 基本帳務驗證通過後，才依序加入預算、專案、定期項目與代墊。
5. 最後才執行一次性歷史匯入與新舊總額核對。
