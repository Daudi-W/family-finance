import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReportCsv, type ReportExport } from '../v2/src/report-export.ts'

const base: ReportExport = {
  mode: 'expense', periodLabel: '2026 年 9 月', from: '2026-09-01', to: '2026-09-30',
  accountName: '全部帳戶', projectName: '全部專案', income: 1200, expense: 500, balance: 700,
  categories: [{ name: '=HYPERLINK("bad")', amount: 500, percent: 100 }],
  balanceRows: [], netWorthRows: [], openingNetWorth: 0,
}

test('分類報表可由 Excel 讀取，數字欄位維持數字且文字不會成為公式', () => {
  const csv = buildReportCsv(base)
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"分類","金額（TWD）","占比（%）"\r\n'))
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")",500,100\r\n'))
  assert.ok(csv.includes('"合計",500,100\r\n'))
})

test('結餘與淨資產報表匯出趨勢及摘要', () => {
  const balance = buildReportCsv({ ...base, mode: 'balance', balanceRows: [{ label: '9 月', income: 1200, expense: 500, balance: 700 }] })
  assert.ok(balance.includes('"區間結餘（TWD）",700\r\n'))
  assert.ok(balance.includes('"9 月",1200,500,700\r\n'))
  const worth = buildReportCsv({ ...base, mode: 'netWorth', openingNetWorth: 1000, netWorthRows: [{ label: '9 月', netWorth: 1300, change: 300 }] })
  assert.ok(worth.includes('"期末淨資產（TWD）",1300\r\n'))
  assert.ok(worth.includes('"9 月",1300,300\r\n'))
})
