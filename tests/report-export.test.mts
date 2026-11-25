import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAnnualReportData, createAnnualWorkbook } from '../v2/src/report-export.ts'
import type { FinanceData } from '../v2/src/types.ts'

const data = {
  categories: [
    { id: 'income', name: '薪資', direction: 'income', sortOrder: 0 },
    { id: 'expense', name: '=HYPERLINK("bad")', direction: 'expense', sortOrder: 0 },
  ],
  projects: [{ id: 'trip', name: '旅行' }],
  transactions: [
    { occurredOn: '2026-01-05', note: '一月薪水', reportLines: [{ categoryId: 'income', direction: 'income', amountTwdMinor: 50000 }] },
    { occurredOn: '2026-01-07', projectId: 'trip', note: '餐費', reportLines: [{ categoryId: 'expense', direction: 'expense', amountTwdMinor: 8000 }] },
    { occurredOn: '2026-02-02', reportLines: [{ categoryId: 'expense', direction: 'expense', amountTwdMinor: 1500 }] },
    { occurredOn: '2026-02-03', reportLines: [], kind: 'transfer' },
    { occurredOn: '2026-02-04', voidedAt: '2026-02-05', reportLines: [{ categoryId: 'expense', direction: 'expense', amountTwdMinor: 999 }] },
  ].map((transaction) => ({ accountMoves: [], ...transaction })),
} as unknown as FinanceData

test('年度報表只計實際收支，轉帳與作廢交易不列入', () => {
  const report = buildAnnualReportData(data, 2026)
  assert.equal(report.monthlyIncome[0], 50000)
  assert.equal(report.monthlyExpense[0], 8000)
  assert.equal(report.monthlyExpense[1], 1500)
  assert.equal(report.expense[0].total, 9500)
  assert.equal(report.details.length, 3)
  assert.equal(report.details[1].project, '旅行')
})

test('XLSX 有年度總覽、分類與明細；公式及數字可供 Excel 使用', async () => {
  const workbook = await createAnnualWorkbook(buildAnnualReportData(data, 2026))
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['年度總覽', '儲蓄去向', '每月資產負債', '分類收支', '交易明細'])
  const overview = workbook.getWorksheet('年度總覽')!
  assert.deepEqual(overview.getCell('O4').value, { formula: 'SUM(C4:N4)', result: 50000 })
  assert.deepEqual(overview.getCell('C6').value, { formula: 'C4-C5', result: 42000 })
  const category = workbook.getWorksheet('分類收支')!
  assert.equal(category.getCell('A11').value, '=HYPERLINK("bad")')
  assert.equal(workbook.getWorksheet('交易明細')!.getCell('D5').value, 8000)
  const bytes = await workbook.xlsx.writeBuffer()
  assert.equal(new Uint8Array(bytes)[0], 0x50)
  assert.equal(new Uint8Array(bytes)[1], 0x4b)
  const { default: ExcelJS } = await import('exceljs')
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(bytes)
  assert.equal(reopened.getWorksheet('分類收支')!.getCell('A11').value, '=HYPERLINK("bad")')
  assert.deepEqual(reopened.getWorksheet('年度總覽')!.getCell('O6').value, { formula: 'O4-O5', result: 40500 })
})

const accounts = [
  { id: 'bank', type: 'bank', currency: 'TWD', openingBalanceMinor: 100000, includeInNetWorth: true },
  { id: 'etf', type: 'investment', currency: 'TWD', openingBalanceMinor: 0, includeInNetWorth: true },
  { id: 'card', type: 'credit_card', currency: 'TWD', openingBalanceMinor: 0, includeInNetWorth: true },
  { id: 'usd', type: 'bank', currency: 'USD', openingBalanceMinor: 1000, includeInNetWorth: true, referenceRateToTwd: 32 },
  { id: 'old', type: 'bank', currency: 'TWD', openingBalanceMinor: 999999, includeInNetWorth: true, archivedAt: '2026-01-01' },
]
const ledger = {
  ...data,
  accounts,
  transactions: [
    { occurredOn: '2025-12-20', kind: 'income', accountMoves: [{ accountId: 'bank', deltaMinor: 5000 }], reportLines: [{ categoryId: 'income', direction: 'income', amountTwdMinor: 5000 }] },
    { occurredOn: '2026-01-05', kind: 'income', accountMoves: [{ accountId: 'bank', deltaMinor: 50000 }], reportLines: [{ categoryId: 'income', direction: 'income', amountTwdMinor: 50000 }] },
    { occurredOn: '2026-01-07', kind: 'expense', accountMoves: [{ accountId: 'card', deltaMinor: 8000 }], reportLines: [{ categoryId: 'expense', direction: 'expense', amountTwdMinor: 8000 }] },
    { occurredOn: '2026-01-09', kind: 'transfer', accountMoves: [{ accountId: 'bank', deltaMinor: -30000 }, { accountId: 'etf', deltaMinor: 30000 }], reportLines: [] },
    { occurredOn: '2026-01-10', kind: 'transfer', voidedAt: '2026-01-11', accountMoves: [{ accountId: 'bank', deltaMinor: -7777 }, { accountId: 'etf', deltaMinor: 7777 }], reportLines: [] },
    { occurredOn: '2026-02-10', kind: 'transfer', accountMoves: [{ accountId: 'bank', deltaMinor: -8000 }, { accountId: 'card', deltaMinor: -8000 }], reportLines: [] },
    { occurredOn: '2026-02-12', kind: 'transfer', accountMoves: [{ accountId: 'etf', deltaMinor: -5000 }, { accountId: 'bank', deltaMinor: 5000 }], reportLines: [] },
    { occurredOn: '2026-03-15', kind: 'income', accountMoves: [{ accountId: 'bank', deltaMinor: 999 }], reportLines: [{ categoryId: 'income', direction: 'income', amountTwdMinor: 999 }] },
  ],
} as unknown as FinanceData

test('每月資產負債：月底餘額依帳戶類型分組，排除封存帳戶，外幣換算，未來月份留空', () => {
  const report = buildAnnualReportData(ledger, 2026, '2026-02-20')
  assert.deepEqual(report.openingBalance, { cash: 105000 + 320, investment: 0, receivable: 0, card: 0 })
  assert.deepEqual(report.balanceSheet[0], { cash: 125000 + 320, investment: 30000, receivable: 0, card: 8000 })
  assert.deepEqual(report.balanceSheet[1], { cash: 122000 + 320, investment: 25000, receivable: 0, card: 0 })
  assert.equal(report.balanceSheet[2], null)
  assert.deepEqual(report.monthlyInvestmentInflow.slice(0, 3), [30000, -5000, 0])
})

test('儲蓄去向與資產負債頁的公式互相對得起來', async () => {
  const workbook = await createAnnualWorkbook(buildAnnualReportData(ledger, 2026, '2026-02-20'))
  const savings = workbook.getWorksheet('儲蓄去向')!
  assert.deepEqual(savings.getCell('C4').value, { formula: "'年度總覽'!C6", result: 42000 })
  assert.equal(savings.getCell('C5').value, 30000)
  assert.deepEqual(savings.getCell('C6').value, { formula: 'C4-C5', result: 12000 })
  assert.deepEqual(savings.getCell('C7').value, { formula: "'每月資產負債'!C4-'每月資產負債'!O4", result: 20000 })
  assert.deepEqual(savings.getCell('D7').value, { formula: "'每月資產負債'!D4-'每月資產負債'!C4", result: -3000 })
  assert.equal(savings.getCell('E7').value, null)
  const balance = workbook.getWorksheet('每月資產負債')!
  assert.deepEqual(balance.getCell('C8').value, { formula: 'C4+C5+C6-C7', result: 125320 + 30000 - 8000 })
  assert.deepEqual(balance.getCell('C9').value, { formula: 'C8-O8', result: 147320 - 105320 })
  assert.equal(balance.getCell('E4').value, null)
})

test('支出拆成固定／不固定，兩者相加＝支出；對帳差額另列淨額', async () => {
  const split = {
    categories: [
      { id: 'salary', name: '薪水', direction: 'income', sortOrder: 0 },
      { id: 'food', name: '飲食', direction: 'expense', sortOrder: 0 },
      { id: 'trip', name: '旅遊', direction: 'expense', sortOrder: 1, irregular: true },
      { id: 'rent', name: '房租', direction: 'expense', sortOrder: 2, irregular: false },
      { id: 'adj-out', name: '餘額調整', direction: 'expense', sortOrder: 3, systemKey: 'balance_adjustment_expense' },
      { id: 'adj-in', name: '餘額調整', direction: 'income', sortOrder: 1, systemKey: 'balance_adjustment_income' },
    ],
    projects: [],
    accounts: [],
    transactions: [
      { occurredOn: '2026-03-01', kind: 'income', accountMoves: [], reportLines: [{ categoryId: 'salary', direction: 'income', amountTwdMinor: 80000 }] },
      { occurredOn: '2026-03-02', kind: 'expense', accountMoves: [], reportLines: [{ categoryId: 'food', direction: 'expense', amountTwdMinor: 10000 }] },
      { occurredOn: '2026-03-03', kind: 'expense', accountMoves: [], reportLines: [{ categoryId: 'rent', direction: 'expense', amountTwdMinor: 22000 }] },
      { occurredOn: '2026-03-04', kind: 'expense', accountMoves: [], reportLines: [{ categoryId: 'trip', direction: 'expense', amountTwdMinor: 30000 }] },
      { occurredOn: '2026-03-20', kind: 'balance_adjustment', accountMoves: [], reportLines: [{ categoryId: 'adj-out', direction: 'expense', amountTwdMinor: 2000 }] },
      { occurredOn: '2026-03-20', kind: 'balance_adjustment', accountMoves: [], reportLines: [{ categoryId: 'adj-in', direction: 'income', amountTwdMinor: 500 }] },
    ],
  } as unknown as FinanceData
  const report = buildAnnualReportData(split, 2026, '2026-12-31')
  assert.equal(report.monthlyFixedExpense[2], 32000)
  assert.equal(report.monthlyIrregularExpense[2], 32000)
  assert.equal(report.monthlyFixedExpense[2] + report.monthlyIrregularExpense[2], report.monthlyExpense[2])
  assert.equal(report.monthlyAdjustmentNet[2], -1500)
  const workbook = await createAnnualWorkbook(report)
  const overview = workbook.getWorksheet('年度總覽')!
  assert.equal(overview.getCell('A7').value, '　固定支出')
  assert.equal(overview.getCell('E7').value, 32000)
  assert.equal(overview.getCell('E8').value, 32000)
  assert.equal(overview.getCell('E9').value, -1500)
  assert.deepEqual(overview.getCell('O9').value, { formula: 'SUM(C9:N9)', result: -1500 })
  const category = workbook.getWorksheet('分類收支')!
  const labels: Record<string, unknown> = {}
  category.eachRow((row) => { const name = row.getCell(1).value; if (typeof name === 'string') labels[name] = row.getCell(2).value })
  assert.equal(labels['飲食'], '固定')
  assert.equal(labels['旅遊'], '不固定')
  assert.equal(labels['薪水'], null)
})
