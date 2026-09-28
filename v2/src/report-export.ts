import type { FinanceData, Direction } from './types.ts'
import { activeTransactions } from './finance.ts'

type CategoryRow = { id: string; name: string; direction: Direction; monthly: number[]; total: number }
type DetailRow = { date: string; direction: Direction; category: string; amount: number; project: string; note: string }

export type AnnualReportData = {
  year: number
  income: CategoryRow[]
  expense: CategoryRow[]
  details: DetailRow[]
  monthlyIncome: number[]
  monthlyExpense: number[]
}

const months = Array.from({ length: 12 }, (_, index) => index)
const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0)

export function buildAnnualReportData(data: FinanceData, year: number): AnnualReportData {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('年份不正確')
  const categories = new Map(data.categories.map((item) => [item.id, item]))
  const projects = new Map(data.projects.map((item) => [item.id, item.name]))
  const rows = new Map<string, CategoryRow>()
  const details: DetailRow[] = []
  for (const transaction of activeTransactions(data.transactions)) {
    if (Number(transaction.occurredOn.slice(0, 4)) !== year) continue
    const month = Number(transaction.occurredOn.slice(5, 7)) - 1
    if (month < 0 || month > 11) continue
    for (const line of transaction.reportLines) {
      const key = `${line.direction}:${line.categoryId}`
      if (!rows.has(key)) rows.set(key, {
        id: line.categoryId, name: categories.get(line.categoryId)?.name ?? '已刪除分類',
        direction: line.direction, monthly: Array(12).fill(0), total: 0,
      })
      const row = rows.get(key)!
      row.monthly[month] += line.amountTwdMinor
      row.total += line.amountTwdMinor
      details.push({
        date: transaction.occurredOn, direction: line.direction, category: row.name,
        amount: line.amountTwdMinor, project: transaction.projectId ? projects.get(transaction.projectId) ?? '已刪除專案' : '',
        note: transaction.note ?? '',
      })
    }
  }
  const categoryOrder = new Map(data.categories.map((item) => [item.id, item.sortOrder]))
  const byOrder = (a: CategoryRow, b: CategoryRow) => (categoryOrder.get(a.id) ?? 9999) - (categoryOrder.get(b.id) ?? 9999) || a.name.localeCompare(b.name, 'zh-TW')
  const income = [...rows.values()].filter((row) => row.direction === 'income').sort(byOrder)
  const expense = [...rows.values()].filter((row) => row.direction === 'expense').sort(byOrder)
  details.sort((a, b) => a.date.localeCompare(b.date))
  return {
    year, income, expense, details,
    monthlyIncome: months.map((month) => total(income.map((row) => row.monthly[month]))),
    monthlyExpense: months.map((month) => total(expense.map((row) => row.monthly[month]))),
  }
}

type Workbook = import('exceljs').Workbook
type Worksheet = import('exceljs').Worksheet
type Cell = import('exceljs').Cell

const ink = '35565C'
const blue = '05769A'
const pale = 'EAF3F1'
const orange = 'FBEAE3'
const green = 'E8F0DF'
const numberFormat = '#,##0;[Red](#,##0);–'
const percentFormat = '0.0%;[Red](0.0%);–'

function title(sheet: Worksheet, text: string, lastColumn: string) {
  sheet.mergeCells(`A1:${lastColumn}1`)
  const cell = sheet.getCell('A1')
  cell.value = text
  cell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${ink}` } }
  cell.alignment = { vertical: 'middle' }
  sheet.getRow(1).height = 36
  sheet.getColumn(1).width = 23
  sheet.getColumn(2).width = 15
  for (let column = 3; column <= 14; column++) sheet.getColumn(column).width = 15
  sheet.getColumn(15).width = 18
  sheet.getColumn(16).width = 16
}

function header(sheet: Worksheet, rowNumber: number, labels: string[]) {
  const row = sheet.getRow(rowNumber)
  labels.forEach((label, index) => {
    const cell = row.getCell(index + 1)
    cell.value = label
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${blue}` } }
    cell.alignment = { vertical: 'middle', horizontal: index < 2 ? 'left' : 'center', wrapText: true }
  })
  row.height = 28
}

function number(cell: Cell, value: number) {
  cell.value = value
  cell.numFmt = numberFormat
  cell.font = { name: 'Arial', size: 11, color: { argb: `FF${ink}` } }
}

function formula(cell: Cell, expression: string, result: number, format = numberFormat) {
  cell.value = { formula: expression, result }
  cell.numFmt = format
  cell.font = { name: 'Arial', size: 11, color: { argb: `FF${ink}` } }
}

function section(sheet: Worksheet, rowNumber: number, text: string, color: string) {
  sheet.mergeCells(`A${rowNumber}:P${rowNumber}`)
  const cell = sheet.getCell(`A${rowNumber}`)
  cell.value = text
  cell.font = { name: 'Arial', size: 12, bold: true, color: { argb: `FF${ink}` } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } }
  sheet.getRow(rowNumber).height = 25
}

function classificationSheet(workbook: Workbook, report: AnnualReportData) {
  const sheet = workbook.addWorksheet('分類收支')
  title(sheet, `${report.year} 年度分類收支`, 'P')
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }]
  sheet.getCell('A2').value = '依帳本分類列出每月實際金額；轉帳不列為收入或支出。單位：TWD。'
  const block = (start: number, label: string, rows: CategoryRow[], monthly: number[], color: string) => {
    section(sheet, start, label, color)
    header(sheet, start + 1, ['分類', '子目', ...months.map((month) => `${month + 1}月`), '年度合計', '占比'])
    const first = start + 2
    rows.forEach((item, index) => {
      const row = first + index
      sheet.getCell(row, 1).value = item.name
      months.forEach((month) => number(sheet.getCell(row, month + 3), item.monthly[month]))
      formula(sheet.getCell(row, 15), `SUM(C${row}:N${row})`, item.total)
    })
    const totalRow = first + rows.length
    sheet.getCell(totalRow, 1).value = '合計'
    months.forEach((month) => {
      const letter = String.fromCharCode(67 + month)
      formula(sheet.getCell(totalRow, month + 3), rows.length ? `SUM(${letter}${first}:${letter}${totalRow - 1})` : '0', monthly[month])
    })
    const annual = total(monthly)
    formula(sheet.getCell(totalRow, 15), `SUM(C${totalRow}:N${totalRow})`, annual)
    rows.forEach((item, index) => formula(sheet.getCell(first + index, 16), annual ? `O${first + index}/$O$${totalRow}` : '0', annual ? item.total / annual : 0, percentFormat))
    formula(sheet.getCell(totalRow, 16), annual ? `SUM(P${first}:P${totalRow - 1})` : '0', annual ? 1 : 0, percentFormat)
    for (let column = 1; column <= 16; column++) sheet.getCell(totalRow, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } }
    return totalRow
  }
  const incomeTotalRow = block(3, '收入', report.income, report.monthlyIncome, green)
  const expenseTotalRow = block(incomeTotalRow + 3, '支出', report.expense, report.monthlyExpense, orange)
  sheet.getCell(expenseTotalRow + 2, 1).value = '註：系統分類目前只有一層，範本的子目欄位在此留白。'
  return { incomeTotalRow, expenseTotalRow }
}

function overviewSheet(sheet: Worksheet, report: AnnualReportData, totals: { incomeTotalRow: number; expenseTotalRow: number }) {
  title(sheet, `${report.year} 年度收支報表`, 'P')
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }]
  sheet.getCell('A2').value = '參考年度收支計畫表的月份編排；此檔只列家庭帳本的實際收支，不含預算或存錢目標。單位：TWD。'
  header(sheet, 3, ['項目', '說明', ...months.map((month) => `${month + 1}月`), '年度總計'])
  for (const [row, label, description] of [[4, '收入', '實際'], [5, '支出', '實際'], [6, '結餘', '收入－支出']] as const) {
    sheet.getCell(row, 1).value = label
    sheet.getCell(row, 2).value = description
  }
  months.forEach((month) => {
    const letter = String.fromCharCode(67 + month)
    formula(sheet.getCell(4, month + 3), `'分類收支'!${letter}${totals.incomeTotalRow}`, report.monthlyIncome[month])
    formula(sheet.getCell(5, month + 3), `'分類收支'!${letter}${totals.expenseTotalRow}`, report.monthlyExpense[month])
    formula(sheet.getCell(6, month + 3), `${letter}4-${letter}5`, report.monthlyIncome[month] - report.monthlyExpense[month])
  })
  formula(sheet.getCell('O4'), 'SUM(C4:N4)', total(report.monthlyIncome))
  formula(sheet.getCell('O5'), 'SUM(C5:N5)', total(report.monthlyExpense))
  formula(sheet.getCell('O6'), 'O4-O5', total(report.monthlyIncome) - total(report.monthlyExpense))
  for (let column = 1; column <= 15; column++) sheet.getCell(6, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${pale}` } }
  sheet.mergeCells('A9:P10')
  sheet.getCell('A9').value = '說明：投資本金移轉、信用卡繳款與帳戶間轉帳不算收入或支出；作廢交易不列入。結餘不是已存款金額。'
  sheet.getCell('A9').alignment = { wrapText: true, vertical: 'middle' }
  sheet.getCell('A9').font = { name: 'Arial', size: 11, color: { argb: `FF${ink}` } }
  sheet.getRow(9).height = 28
  sheet.getRow(10).height = 22
}

function detailSheet(workbook: Workbook, report: AnnualReportData) {
  const sheet = workbook.addWorksheet('交易明細')
  title(sheet, `${report.year} 年度收支交易明細`, 'F')
  sheet.getCell('A2').value = '每一筆收支分類記錄各占一列；代墊只計家庭實際負擔，金額以 TWD 表示。'
  header(sheet, 3, ['日期', '收支', '分類', '金額（TWD）', '專案', '備註'])
  sheet.getColumn(1).width = 16
  sheet.getColumn(2).width = 12
  sheet.getColumn(3).width = 22
  sheet.getColumn(4).width = 18
  sheet.getColumn(5).width = 24
  sheet.getColumn(6).width = 42
  sheet.views = [{ state: 'frozen', ySplit: 3 }]
  report.details.forEach((item, index) => {
    const row = index + 4
    sheet.getCell(row, 1).value = item.date
    sheet.getCell(row, 2).value = item.direction === 'income' ? '收入' : '支出'
    sheet.getCell(row, 3).value = item.category
    number(sheet.getCell(row, 4), item.amount)
    sheet.getCell(row, 5).value = item.project
    sheet.getCell(row, 6).value = item.note
  })
  sheet.autoFilter = { from: 'A3', to: `F${Math.max(3, report.details.length + 3)}` }
}

export async function createAnnualWorkbook(report: AnnualReportData): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '家庭記帳'
  workbook.calcProperties.fullCalcOnLoad = true
  const overview = workbook.addWorksheet('年度總覽')
  const totals = classificationSheet(workbook, report)
  overviewSheet(overview, report, totals)
  detailSheet(workbook, report)
  return workbook
}

export async function downloadAnnualReport(data: FinanceData, year: number) {
  const workbook = await createAnnualWorkbook(buildAnnualReportData(data, year))
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `家庭年度收支報表_${year}.xlsx`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
