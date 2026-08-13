import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoData } from '../v2/src/demo-data.ts'
import {
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

test('外幣以最小單位儲存，淨資產依參考匯率換算台幣', () => {
  assert.equal(toMinor('12.34', 'USD'), 1_234)
  const data = buildDemoData()
  const usdAccount = { ...data.accounts[0], id: 'usd', currency: 'USD', openingBalanceMinor: 12_345, referenceRateToTwd: 30, type: 'bank' as const }
  const netWorth = calculateNetWorth([usdAccount], { usd: 12_345 })
  assert.equal(netWorth.assets, 3_704)
})
