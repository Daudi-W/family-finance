import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoData } from '../v2/src/demo-data.ts'
import { canonicalAuthUrl } from '../v2/src/auth-url.ts'
import {
  accountPeriodRange,
  accountPeriodSummary,
  accountTransferDisplayAmount,
  advanceRows,
  advancePeopleRows,
  calculateBalances,
  calculateNetWorth,
  monthKey,
  monthlyBudgetRows,
  monthSequence,
  pendingRecurring,
  reportRangeForPeriod,
  reportForMonth,
  toMinor,
  todayIso,
} from '../v2/src/finance.ts'

test('v2 示意資料由同一批交易推導帳戶、收支與淨資產', () => {
  const data = buildDemoData()
  const balances = calculateBalances(data.accounts, data.transactions)
  const report = reportForMonth(data.transactions, monthKey(todayIso()))
  const netWorth = calculateNetWorth(data.accounts, balances)

  assert.equal(report.income, 62_000)
  assert.equal(report.expense, 14_460)
  assert.equal(report.balance, 47_540)
  assert.equal(balances.cash, 8_600)
  assert.equal(balances.bank, 93_644)
  assert.equal(netWorth.netWorth, netWorth.assets - netWorth.liabilities)
})

test('v2 預算只計入一般支出，並提供月額與年度參考值', () => {
  const data = buildDemoData()
  const rows = monthlyBudgetRows(data.budgets, data.categories, data.transactions, monthKey(todayIso()))
  const food = rows.find((row) => row.category?.id === 'food')
  assert.equal(food?.monthlyAmount, 12_000)
  assert.equal(food?.annualAmount, 144_000)
  assert.equal(food?.spent, 980)
})

test('v2 代墊剩餘與定期預覽皆由原始文件計算', () => {
  const data = buildDemoData()
  const advances = advanceRows(data.transactions)
  assert.equal(advances[0]?.remaining, 1_600)
  const people = advancePeopleRows(advances[0].transaction, data.transactions)
  assert.deepEqual(people.map((person) => person.remainingMinor), [800, 800])
  assert.equal(pendingRecurring(data.recurringRules).length, 2)
})

test('舊版已寫入代墊份額的結清金額時，不再顯示為未結清', () => {
  const data = buildDemoData()
  const advance = data.transactions.find((transaction) => transaction.kind === 'advance')
  assert.ok(advance?.advance)
  advance.advance.people = advance.advance.people.map((person) => ({ ...person, settledMinor: person.expectedMinor }))
  assert.equal(advanceRows(data.transactions)[0]?.remaining, 0)
})

test('報表月份序列不受台灣時區影響而多出前一個月', () => {
  assert.deepEqual(monthSequence('2026-08-01', '2026-08-31'), ['2026-08'])
  assert.deepEqual(monthSequence('2026-06-01', '2026-08-31'), ['2026-06', '2026-07', '2026-08'])
})

test('新版報表可依指定月份產生月、近 6 個月與年度區間', () => {
  assert.deepEqual(reportRangeForPeriod('月', '2026-08'), { from: '2026-08-01', to: '2026-08-31' })
  assert.deepEqual(reportRangeForPeriod('近6個月', '2026-08'), { from: '2026-03-01', to: '2026-08-31' })
  assert.deepEqual(reportRangeForPeriod('年', '2026-08'), { from: '2026-01-01', to: '2026-12-31' })
})

test('帳戶摘要分開顯示本期收支與淨轉帳，信用卡付款方向符合負債直覺', () => {
  const data = buildDemoData()
  const bank = data.accounts.find((account) => account.id === 'bank')!
  const card = data.accounts.find((account) => account.id === 'card')!
  const transfer = {
    ...data.transactions[0], id: 'payment', kind: 'transfer' as const, occurredOn: todayIso(), reportLines: [],
    accountMoves: [{ accountId: 'bank', deltaMinor: -5_000, currency: 'TWD' }, { accountId: 'card', deltaMinor: -5_000, currency: 'TWD' }],
    transfer: { fromAccountId: 'bank', toAccountId: 'card', fromAmountMinor: 5_000, toAmountMinor: 5_000, feeMinor: 0 },
  }
  const range = accountPeriodRange('month')
  assert.deepEqual(accountPeriodSummary(bank, [...data.transactions, transfer], range.from, range.to), { income: 62_000, expense: 0, netTransfer: -5_000 })
  assert.deepEqual(accountPeriodSummary(card, [...data.transactions, transfer], range.from, range.to), { income: 0, expense: 14_280, netTransfer: 5_000 })
  assert.equal(accountTransferDisplayAmount(bank, transfer), -5_000)
  assert.equal(accountTransferDisplayAmount(card, transfer), 5_000)
})

test('帳戶快速期間以本月起點往前涵蓋 6 個月或 12 個月', () => {
  assert.deepEqual(accountPeriodRange('month', '2026-08-14'), { from: '2026-08-01', to: '2026-08-14' })
  assert.deepEqual(accountPeriodRange('sixMonths', '2026-08-14'), { from: '2026-03-01', to: '2026-08-14' })
  assert.deepEqual(accountPeriodRange('year', '2026-08-14'), { from: '2025-09-01', to: '2026-08-14' })
})

test('web.app 登入入口會保留路徑並轉到 Firebase Auth 網域', () => {
  assert.equal(
    canonicalAuthUrl('https://family-finance-v2-dev-260811.web.app/reports?period=month#chart', 'family-finance-v2-dev-260811.firebaseapp.com'),
    'https://family-finance-v2-dev-260811.firebaseapp.com/reports?period=month#chart',
  )
  assert.equal(canonicalAuthUrl('https://family-finance-v2-dev-260811.firebaseapp.com/', 'family-finance-v2-dev-260811.firebaseapp.com'), '')
})

test('外幣以最小單位儲存，淨資產依參考匯率換算台幣', () => {
  assert.equal(toMinor('12.34', 'USD'), 1_234)
  const data = buildDemoData()
  const usdAccount = { ...data.accounts[0], id: 'usd', currency: 'USD', openingBalanceMinor: 12_345, referenceRateToTwd: 30, type: 'bank' as const }
  const netWorth = calculateNetWorth([usdAccount], { usd: 12_345 })
  assert.equal(netWorth.assets, 3_704)
})
