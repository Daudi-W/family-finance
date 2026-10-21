import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDemoData } from '../v2/src/demo-data.ts'
import { canonicalAuthUrl } from '../v2/src/auth-url.ts'
import {
  accountEffectiveRange,
  accountFlowPeriodLabel,
  accountPeriodRange,
  accountPeriodSummary,
  accountTransferDisplayAmount,
  addRecurringPeriod,
  advanceRows,
  advancePeopleRows,
  calculateBalances,
  calculateNetWorth,
  cardStatementBoundary,
  cardStatementPeriods,
  cardStatementStatus,
  cardStatementSummary,
  monthKey,
  monthlyBudgetRows,
  monthSequence,
  pendingRecurring,
  reportRangeForPeriod,
  reportForMonth,
  toMinor,
  todayIso,
  transferToAmountMinor,
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
  const range = { from: `${todayIso().slice(0, 7)}-01`, to: todayIso() }
  assert.deepEqual(accountPeriodSummary(bank, [...data.transactions, transfer], range.from, range.to), { income: 62_000, expense: 0, netTransfer: -5_000 })
  assert.deepEqual(accountPeriodSummary(card, [...data.transactions, transfer], range.from, range.to), { income: 0, expense: 14_280, netTransfer: 5_000 })
  assert.equal(accountTransferDisplayAmount(bank, transfer), -5_000)
  assert.equal(accountTransferDisplayAmount(card, transfer), 5_000)
})

test('帳戶快速期間可查看近 1 年或全部', () => {
  assert.deepEqual(accountPeriodRange('year', '2026-08-14'), { from: '2025-09-01', to: '2026-08-14' })
  assert.deepEqual(accountPeriodRange('all', '2026-08-14'), { from: '0001-01-01', to: '2026-08-14' })
  assert.deepEqual(accountEffectiveRange('all', '2024-12-22', '2025-01-31', '2026-08-14'), { from: '2024-12-22', to: '2025-01-31' })
  assert.deepEqual(accountEffectiveRange('year', '2024-12-22', '', '2026-08-14'), { from: '2024-12-22', to: '2026-08-14' })
})

test('帳戶摘要標籤帶出目前期間，避免期間流量被誤讀成當月', () => {
  assert.equal(accountFlowPeriodLabel('year', false), '近 1 年')
  assert.equal(accountFlowPeriodLabel('all', false), '全部期間')
  assert.equal(accountFlowPeriodLabel('year', true), '自訂期間')
})

test('web.app 登入入口會保留路徑並轉到 Firebase Auth 網域', () => {
  assert.equal(
    canonicalAuthUrl('https://family-finance-v2-dev-260811.web.app/reports?period=month#chart', 'family-finance-v2-dev-260811.firebaseapp.com'),
    'https://family-finance-v2-dev-260811.firebaseapp.com/reports?period=month#chart',
  )
  assert.equal(canonicalAuthUrl('https://family-finance-v2-dev-260811.firebaseapp.com/', 'family-finance-v2-dev-260811.firebaseapp.com'), '')
})

test('同幣別轉帳的轉入金額一律跟著轉出金額，不會沿用畫面上看不到的舊值', () => {
  // 編輯一筆原本 431 的同幣別轉帳，把金額改成 150：轉入金額必須跟著變成 150，
  // 否則會變成「轉出 150、轉入 431」，帳戶餘額與日期檢視就會對不起來
  assert.equal(transferToAmountMinor('TWD', 'TWD', 150, 431), 150)
  assert.equal(transferToAmountMinor('TWD', 'twd', 150, 0), 150)
  // 跨幣別才保留使用者自己填的轉入金額；沒填就退回轉出金額
  assert.equal(transferToAmountMinor('TWD', 'JPY', 1_000, 4_600), 4_600)
  assert.equal(transferToAmountMinor('TWD', 'JPY', 1_000, 0), 1_000)
})

test('信用卡欠款算負債，預存進去的錢算資產', () => {
  const data = buildDemoData()
  const base = { ...data.accounts[0], type: 'credit_card' as const, currency: 'TWD', includeInNetWorth: true, openingBalanceMinor: 0 }
  const owing = { ...base, id: 'card-owing' }
  const prepaid = { ...base, id: 'card-prepaid' }

  const owed = calculateNetWorth([owing], { 'card-owing': 4_000 })
  assert.equal(owed.liabilities, 4_000)
  assert.equal(owed.assets, 0)
  assert.equal(owed.netWorth, -4_000)

  // 餘額為負代表先把錢存進卡裡，那筆錢不能從淨資產憑空消失
  const stored = calculateNetWorth([prepaid], { 'card-prepaid': -1_500 })
  assert.equal(stored.liabilities, 0)
  assert.equal(stored.assets, 1_500)
  assert.equal(stored.netWorth, 1_500)
})

test('外幣以最小單位儲存，淨資產依參考匯率換算台幣', () => {
  assert.equal(toMinor('12.34', 'USD'), 1_234)
  const data = buildDemoData()
  const usdAccount = { ...data.accounts[0], id: 'usd', currency: 'USD', openingBalanceMinor: 12_345, referenceRateToTwd: 30, type: 'bank' as const }
  const netWorth = calculateNetWorth([usdAccount], { usd: 12_345 })
  assert.equal(netWorth.assets, 3_704)
})

test('定期項目日期在台北時區不會每期往前漂一天，月底不溢位', () => {
  assert.equal(addRecurringPeriod('2026-08-20', 'monthly'), '2026-09-20')
  assert.equal(addRecurringPeriod('2026-12-20', 'monthly'), '2027-01-20')
  assert.equal(addRecurringPeriod('2026-01-31', 'monthly'), '2026-02-28')
  assert.equal(addRecurringPeriod('2026-10-05', 'weekly'), '2026-10-12')
  assert.equal(addRecurringPeriod('2028-02-29', 'yearly'), '2029-02-28')
  const rule = { nextScheduledOn: '2026-10-05', previewDays: 0 } as Parameters<typeof pendingRecurring>[0][number]
  assert.equal(pendingRecurring([rule], '2026-10-05').length, 1)
  assert.equal(pendingRecurring([{ ...rule, nextScheduledOn: '2026-10-08', previewDays: 3 }], '2026-10-05').length, 1)
  assert.equal(pendingRecurring([{ ...rule, nextScheduledOn: '2026-10-09', previewDays: 3 }], '2026-10-05').length, 0)
})

test('信用卡依結帳日切成一期一期，小月結帳日落在月底，繳款日在結帳日前代表下個月繳', () => {
  const periods = cardStatementPeriods(12, 28, '2026-08-20', '2026-10-18')
  assert.deepEqual(periods.map((item) => [item.from, item.closingDate, item.paymentDate]), [
    ['2026-10-13', '2026-11-12', '2026-11-28'],
    ['2026-09-13', '2026-10-12', '2026-10-28'],
    ['2026-08-13', '2026-09-12', '2026-09-28'],
  ])
  const monthEnd = cardStatementPeriods(31, 15, '2026-02-10', '2026-03-01')
  assert.deepEqual(monthEnd.map((item) => [item.from, item.closingDate, item.paymentDate]), [
    ['2026-03-01', '2026-03-31', '2026-04-15'],
    ['2026-02-01', '2026-02-28', '2026-03-15'],
  ])
  const yearEnd = cardStatementPeriods(5, 22, '2026-12-28', '2027-01-03')
  assert.deepEqual(yearEnd.map((item) => [item.from, item.closingDate]), [['2026-12-06', '2027-01-05']])
})

test('帳單每期只算期間內的消費與繳款，結帳日欠款累計到結帳日為止', () => {
  const card = { id: 'card', type: 'credit_card', currency: 'TWD', openingBalanceMinor: 1_000, openingDate: '2026-08-01' } as Parameters<typeof cardStatementSummary>[0]
  const tx = (id: string, occurredOn: string, kind: string, deltaMinor: number, voidedAt?: string) => ({ id, occurredOn, kind, voidedAt, accountMoves: [{ accountId: 'card', deltaMinor, currency: 'TWD' }], reportLines: [] }) as unknown as Parameters<typeof cardStatementSummary>[1][number]
  const transactions = [
    tx('before', '2026-09-12', 'expense', 500),
    tx('first-day', '2026-09-13', 'expense', 300),
    tx('refund', '2026-09-20', 'income', -100),
    tx('pay', '2026-09-28', 'transfer', -1_500),
    tx('voided', '2026-10-01', 'expense', 9_999, '2026-10-02'),
    tx('closing-day', '2026-10-12', 'expense', 700),
    tx('next', '2026-10-13', 'expense', 50),
    { ...tx('other-card', '2026-10-01', 'expense', 0), accountMoves: [{ accountId: 'bank', deltaMinor: -80, currency: 'TWD' }] },
  ]
  const period = cardStatementPeriods(12, 28, '2026-10-01', '2026-10-12')[0]
  const summary = cardStatementSummary(card, transactions, period)
  assert.equal(summary.charges, 900)
  assert.equal(summary.payments, 1_500)
  assert.equal(summary.closingBalance, 900)
  assert.deepEqual(summary.transactions.map((item) => item.id), ['first-day', 'refund', 'pay', 'closing-day'])
})

test('帳單狀態：還沒結帳是本期，填了帳單金額才比對相符或有差額', () => {
  const period = { from: '2026-09-13', closingDate: '2026-10-12', paymentDate: '2026-10-28', previousFrom: '2026-08-13' }
  assert.equal(cardStatementStatus(period, 900, 900, '2026-10-12'), 'open')
  assert.equal(cardStatementStatus(period, 900, undefined, '2026-10-13'), 'unchecked')
  assert.equal(cardStatementStatus(period, 900, null, '2026-10-13'), 'unchecked')
  assert.equal(cardStatementStatus(period, 900, 900, '2026-10-13'), 'matched')
  assert.equal(cardStatementStatus(period, 900, 1_200, '2026-10-13'), 'mismatch')
})

test('從卡片轉出的代墊／借出算新增款項，轉進卡片才算繳款', () => {
  const card = { id: 'card', type: 'credit_card', currency: 'TWD', openingBalanceMinor: 0, openingDate: '2026-01-01' } as Parameters<typeof cardStatementSummary>[0]
  const transactions = [
    { id: 'lend', occurredOn: '2026-07-26', kind: 'transfer', accountMoves: [{ accountId: 'card', deltaMinor: 480, currency: 'TWD' }, { accountId: 'loan', deltaMinor: 480, currency: 'TWD' }], reportLines: [] },
    { id: 'pay', occurredOn: '2026-08-07', kind: 'transfer', accountMoves: [{ accountId: 'bank', deltaMinor: -2_262, currency: 'TWD' }, { accountId: 'card', deltaMinor: -2_262, currency: 'TWD' }], reportLines: [] },
  ] as unknown as Parameters<typeof cardStatementSummary>[1]
  const summary = cardStatementSummary(card, transactions, cardStatementPeriods(21, 7, '2026-08-21', '2026-08-21')[0])
  assert.equal(summary.charges, 480)
  assert.equal(summary.payments, 2_262)
})

test('標成算到下一期的消費，這期不算、下一期才算，結帳日欠款也跟著銀行走', () => {
  const tx = (id: string, occurredOn: string, deltaMinor: number) => ({ id, occurredOn, kind: 'expense', accountMoves: [{ accountId: 'card', deltaMinor, currency: 'TWD' }], reportLines: [] })
  const transactions = [tx('early', '2026-07-01', 1_000), tx('sun-a', '2026-07-19', 360), tx('sun-b', '2026-07-19', 400), tx('aug', '2026-08-01', 2_000)] as unknown as Parameters<typeof cardStatementSummary>[1]
  const card = { id: 'card', type: 'credit_card', currency: 'TWD', openingBalanceMinor: 0, openingDate: '2026-01-01', statementDeferred: { 'sun-a': true, 'sun-b': true, early: false } } as unknown as Parameters<typeof cardStatementSummary>[0]
  const [august, july] = cardStatementPeriods(21, 7, '2026-07-01', '2026-08-21')
  assert.deepEqual([july.previousFrom, july.from, july.closingDate], ['2026-05-22', '2026-06-22', '2026-07-21'])
  assert.deepEqual([cardStatementSummary(card, transactions, july).charges, cardStatementSummary(card, transactions, july).closingBalance], [1_000, 1_000])
  const next = cardStatementSummary(card, transactions, august)
  assert.deepEqual([next.charges, next.closingBalance, next.transactions.map((item) => item.id).sort()], [2_760, 3_760, ['aug', 'sun-a', 'sun-b']])
  assert.deepEqual(cardStatementBoundary(card, transactions, july).map((item) => [item.transaction.id, item.deferred, item.movedIn]), [['sun-a', true, false], ['sun-b', true, false]])
  assert.deepEqual(cardStatementBoundary(card, transactions, august).map((item) => [item.transaction.id, item.movedIn]), [['sun-a', true], ['sun-b', true]])
  const januaryPeriod = cardStatementPeriods(21, 7, '2027-01-10', '2027-01-10')[0]
  assert.equal(januaryPeriod.previousFrom, '2026-11-22')
})
