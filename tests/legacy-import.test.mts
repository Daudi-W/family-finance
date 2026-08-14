import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLegacyImportDryRun, buildLegacyPreview, parseCsv, parseLegacyEntries, parseLegacyTransfers } from '../src/import/legacy-csv.mts'

test('CSV parser preserves commas, escaped quotes, and line breaks inside quoted cells', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,"two, three"\r\n2,"say ""hi""\nnext"\r\n'), [
    ['a', 'b'], ['1', 'two, three'], ['2', 'say "hi"\nnext'],
  ])
})

test('天天記帳收支與重複幣別轉帳欄位可正確解析', () => {
  const entries = parseLegacyEntries('\uFEFF日期,類別,大類別,金額,幣別,成員,帳戶,標籤,備註,收支區分,上次更新,UUID\n20260801,餐飲,,120,TWD,甲,現金,,午餐,支,20260801,e-1\n')
  const transfers = parseLegacyTransfers('\uFEFF日期,從帳戶,轉出金額,幣別,到帳戶,轉入金額,幣別,標籤,備註,上次更新,UUID\n20260802,銀行,1000,TWD,現金,1000,TWD,,,20260802,t-1\n')
  assert.equal(entries[0].occurredOn, '2026-08-01')
  assert.equal(entries[0].direction, 'expense')
  assert.equal(transfers[0].toCurrency, 'TWD')
})

test('最近六個月類別保持可選，歷史類別封存，未來交易暫留', () => {
  const base = { parentCategory: '', amount: 1, currency: 'TWD', member: '', account: '現金', tags: '', note: '', sourceUpdatedAt: '' }
  const preview = buildLegacyPreview([
    { ...base, occurredOn: '2025-01-01', category: '舊分類', direction: 'expense', sourceId: '1' },
    { ...base, occurredOn: '2026-04-01', category: '餐飲', direction: 'expense', sourceId: '2' },
    { ...base, occurredOn: '2026-05-01', category: '餘額調整', direction: 'income', sourceId: '3' },
    { ...base, occurredOn: '2026-09-01', category: '未來', direction: 'income', sourceId: '4' },
  ], [], '2026-08-14')
  assert.equal(preview.recentFrom, '2026-03-01')
  assert.equal(preview.proposed.futureEntriesHeld, 1)
  assert.equal(preview.proposed.activeAccounts, 1)
  assert.equal(preview.categories.find((item) => item.name === '舊分類')?.activeForNewEntry, false)
  assert.equal(preview.categories.find((item) => item.name === '餘額調整')?.systemKey, 'balance_adjustment_income')
  assert.equal(preview.categories.find((item) => item.name === '餘額調整')?.countsTowardBudget, false)
})

test('正式匯入乾跑只轉換已對應帳戶，並保留來源 UUID 防重', () => {
  const base = { parentCategory: '', amount: 100, currency: 'TWD', member: '', tags: '', note: '', sourceUpdatedAt: '' }
  const result = buildLegacyImportDryRun([
    { ...base, occurredOn: '2026-08-01', category: '薪水', direction: 'income', account: '銀行', sourceId: 'entry-1' },
    { ...base, occurredOn: '2026-08-02', category: '飲食', direction: 'expense', account: '舊帳戶', sourceId: 'entry-2' },
  ], [{ occurredOn: '2026-08-03', fromAccount: '銀行', fromAmount: 50, fromCurrency: 'TWD', toAccount: '信用卡', toAmount: 50, toCurrency: 'TWD', tags: '', note: '', sourceUpdatedAt: '', sourceId: 'transfer-1' }], [
    { sourceName: '銀行', accountId: 'bank', type: 'bank' }, { sourceName: '信用卡', accountId: 'card', type: 'credit_card' },
  ], '2026-08-14')
  assert.equal(result.transactions.length, 2)
  assert.equal(result.heldByReason.unmapped_account, 1)
  assert.equal(result.transactions[0].id, 'legacy-entry-1')
  assert.deepEqual((result.transactions[1].accountMoves as Array<{ deltaMinor: number }>).map((move) => move.deltaMinor), [-50, -50])
})
