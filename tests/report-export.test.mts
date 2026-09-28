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
  ],
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
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['年度總覽', '分類收支', '交易明細'])
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
