import type { Account, Category, FinanceData, Direction, FinanceTransaction } from './types.ts'
import { activeTransactions, fromMinor, todayIso } from './finance.ts'

type CategoryRow = { id: string; name: string; direction: Direction; irregular: boolean; monthly: number[]; total: number }
type DetailRow = { date: string; direction: Direction; category: string; amount: number; project: string; note: string }

export type AnnualReportData = {
  year: number
  income: CategoryRow[]
  expense: CategoryRow[]
  details: DetailRow[]
  monthlyIncome: number[]
  monthlyExpense: number[]
  /** 支出拆成固定／不固定，兩者相加＝支出。 */
  monthlyFixedExpense: number[]
  monthlyIrregularExpense: number[]
  /** 對帳補上的收入－支出（已含在收支裡），可能是漏記。 */
  monthlyAdjustmentNet: number[]
  /** 每月月底的資產負債；尚未到的月份為 null。 */
  balanceSheet: (BalancePoint | null)[]
  /** 去年底，用來算一月的增減。 */
  openingBalance: BalancePoint
  /** 每月轉入投資帳戶的淨額（轉出為負）。 */
  monthlyInvestmentInflow: number[]
}

export type BalancePoint = { cash: number; investment: number; receivable: number; card: number }

const months = Array.from({ length: 12 }, (_, index) => index)
const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0)
/** 分類沒標記就算固定；系統的「餘額調整」支出分類不是生活費，算不固定。 */
export const isIrregularCategory = (category?: Category) => category?.irregular ?? category?.systemKey === 'balance_adjustment_expense'
const isAdjustment = (transaction: FinanceTransaction, category?: Category) => transaction.kind === 'balance_adjustment' || Boolean(category?.systemKey?.startsWith('balance_adjustment'))

const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)

/** 與 calculateNetWorth 同口徑：只算未封存、計入淨資產的帳戶；外幣用帳戶目前的參考匯率。 */
const netWorthAccounts = (accounts: Account[]) => accounts.filter((account) => !account.archivedAt && account.includeInNetWorth)
const toTwd = (account: Account, minor: number) => Math.round(fromMinor(minor, account.currency) * (account.currency === 'TWD' ? 1 : account.referenceRateToTwd ?? 0))

function balanceSeries(accounts: Account[], transactions: FinanceTransaction[], dates: string[]): BalancePoint[] {
  const tracked = netWorthAccounts(accounts)
  const balances = new Map(tracked.map((account) => [account.id, account.openingBalanceMinor]))
  const sorted = transactions.slice().sort((left, right) => left.occurredOn.localeCompare(right.occurredOn))
  let cursor = 0
  return dates.map((date) => {
    for (; cursor < sorted.length && sorted[cursor].occurredOn <= date; cursor++) {
      for (const move of sorted[cursor].accountMoves) if (balances.has(move.accountId)) balances.set(move.accountId, balances.get(move.accountId)! + move.deltaMinor)
    }
    const point: BalancePoint = { cash: 0, investment: 0, receivable: 0, card: 0 }
    for (const account of tracked) {
      const value = toTwd(account, balances.get(account.id)!)
      if (account.type === 'credit_card') point.card += value
      else if (account.type === 'investment') point.investment += value
      else if (account.type === 'receivable') point.receivable += value
      else point.cash += value
    }
    return point
  })
}

export function buildAnnualReportData(data: FinanceData, year: number, asOf = todayIso()): AnnualReportData {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('年份不正確')
  const categories = new Map(data.categories.map((item) => [item.id, item]))
  const projects = new Map(data.projects.map((item) => [item.id, item.name]))
  const rows = new Map<string, CategoryRow>()
  const details: DetailRow[] = []
  const monthlyAdjustmentNet = Array(12).fill(0)
  for (const transaction of activeTransactions(data.transactions)) {
    if (Number(transaction.occurredOn.slice(0, 4)) !== year) continue
    const month = Number(transaction.occurredOn.slice(5, 7)) - 1
    if (month < 0 || month > 11) continue
    for (const line of transaction.reportLines) {
      const key = `${line.direction}:${line.categoryId}`
      if (!rows.has(key)) rows.set(key, {
        id: line.categoryId, name: categories.get(line.categoryId)?.name ?? '已刪除分類',
        direction: line.direction, irregular: line.direction === 'expense' && isIrregularCategory(categories.get(line.categoryId)),
        monthly: Array(12).fill(0), total: 0,
      })
      const row = rows.get(key)!
      if (isAdjustment(transaction, categories.get(line.categoryId))) monthlyAdjustmentNet[month] += line.direction === 'income' ? line.amountTwdMinor : -line.amountTwdMinor
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
  const accounts = data.accounts ?? []
  const active = activeTransactions(data.transactions)
  const investmentIds = new Set(netWorthAccounts(accounts).filter((account) => account.type === 'investment').map((account) => account.id))
  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const monthlyInvestmentInflow = Array(12).fill(0)
  for (const transaction of active) {
    if (transaction.kind !== 'transfer' || Number(transaction.occurredOn.slice(0, 4)) !== year) continue
    const month = Number(transaction.occurredOn.slice(5, 7)) - 1
    for (const move of transaction.accountMoves) if (investmentIds.has(move.accountId)) monthlyInvestmentInflow[month] += toTwd(accountById.get(move.accountId)!, move.deltaMinor)
  }
  // 本月算到今天；之後的月份還沒發生，留空
  const dates = [`${year - 1}-12-31`, ...months.map((month) => monthEnd(year, month))]
  const points = balanceSeries(accounts, active, dates.map((date) => date > asOf ? asOf : date))
  return {
    year, income, expense, details,
    monthlyIncome: months.map((month) => total(income.map((row) => row.monthly[month]))),
    monthlyExpense: months.map((month) => total(expense.map((row) => row.monthly[month]))),
    monthlyFixedExpense: months.map((month) => total(expense.filter((row) => !row.irregular).map((row) => row.monthly[month]))),
    monthlyIrregularExpense: months.map((month) => total(expense.filter((row) => row.irregular).map((row) => row.monthly[month]))),
    monthlyAdjustmentNet,
    openingBalance: points[0],
    balanceSheet: months.map((month) => `${year}-${String(month + 1).padStart(2, '0')}-01` > asOf ? null : points[month + 1]),
    monthlyInvestmentInflow,
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
    header(sheet, start + 1, ['分類', '性質', ...months.map((month) => `${month + 1}月`), '年度合計', '占比'])
    const first = start + 2
    rows.forEach((item, index) => {
      const row = first + index
      sheet.getCell(row, 1).value = item.name
      if (item.direction === 'expense') sheet.getCell(row, 2).value = item.irregular ? '不固定' : '固定'
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
  sheet.getCell(expenseTotalRow + 2, 1).value = '註：「性質」依分類設定的「不固定支出」標記；沒標記的分類算固定。'
  return { incomeTotalRow, expenseTotalRow }
}

function overviewSheet(sheet: Worksheet, report: AnnualReportData, totals: { incomeTotalRow: number; expenseTotalRow: number }) {
  title(sheet, `${report.year} 年度收支報表`, 'P')
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }]
  sheet.getCell('A2').value = '參考年度收支計畫表的月份編排；此檔只列家庭帳本的實際收支，不含預算或存錢目標。單位：TWD。'
  header(sheet, 3, ['項目', '說明', ...months.map((month) => `${month + 1}月`), '年度總計'])
  for (const [row, label, description] of [[4, '收入', '實際'], [5, '支出', '實際'], [6, '結餘', '收入－支出'], [7, '　固定支出', '每月常態開銷'], [8, '　不固定支出', '大筆、不是每月都有'], [9, '對帳差額（淨）', '對帳補上的收入－支出，可能是漏記']] as const) {
    sheet.getCell(row, 1).value = label
    sheet.getCell(row, 2).value = description
  }
  months.forEach((month) => {
    const letter = String.fromCharCode(67 + month)
    formula(sheet.getCell(4, month + 3), `'分類收支'!${letter}${totals.incomeTotalRow}`, report.monthlyIncome[month])
    formula(sheet.getCell(5, month + 3), `'分類收支'!${letter}${totals.expenseTotalRow}`, report.monthlyExpense[month])
    formula(sheet.getCell(6, month + 3), `${letter}4-${letter}5`, report.monthlyIncome[month] - report.monthlyExpense[month])
    number(sheet.getCell(7, month + 3), report.monthlyFixedExpense[month])
    number(sheet.getCell(8, month + 3), report.monthlyIrregularExpense[month])
    number(sheet.getCell(9, month + 3), report.monthlyAdjustmentNet[month])
  })
  for (const row of [7, 8, 9]) formula(sheet.getCell(row, 15), `SUM(C${row}:N${row})`, total([report.monthlyFixedExpense, report.monthlyIrregularExpense, report.monthlyAdjustmentNet][row - 7]))
  formula(sheet.getCell('O4'), 'SUM(C4:N4)', total(report.monthlyIncome))
  formula(sheet.getCell('O5'), 'SUM(C5:N5)', total(report.monthlyExpense))
  formula(sheet.getCell('O6'), 'O4-O5', total(report.monthlyIncome) - total(report.monthlyExpense))
  for (let column = 1; column <= 15; column++) sheet.getCell(6, column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${pale}` } }
  note(sheet, 11, '說明：投資本金移轉、信用卡繳款與帳戶間轉帳不算收入或支出；作廢交易不列入。結餘不是已存款金額。固定＋不固定＝支出；分類沒標「不固定支出」就算固定，對帳補上的支出算不固定。對帳差額已含在收支裡，單月特別大通常代表那個月漏記較多。')
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

const column = (month: number) => String.fromCharCode(67 + month)

function note(sheet: Worksheet, rowNumber: number, text: string) {
  sheet.mergeCells(`A${rowNumber}:P${rowNumber + 1}`)
  const cell = sheet.getCell(`A${rowNumber}`)
  cell.value = text
  cell.alignment = { wrapText: true, vertical: 'top' }
  cell.font = { name: 'Arial', size: 11, color: { argb: `FF${ink}` } }
  sheet.getRow(rowNumber).height = 28
  sheet.getRow(rowNumber + 1).height = 28
}

function balanceSheetSheet(sheet: Worksheet, report: AnnualReportData) {
  title(sheet, `${report.year} 每月資產負債`, 'P')
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }]
  sheet.getCell('A2').value = '每月月底的帳戶餘額合計；本月算到下載當天，之後的月份留空。單位：TWD。'
  header(sheet, 3, ['項目', '說明', ...months.map((month) => `${month + 1}月`), '去年底'])
  const rows = [
    [4, '現金存款', '現金＋銀行', 'cash'],
    [5, '投資', '投入成本', 'investment'],
    [6, '應收／借出', '別人欠我們', 'receivable'],
    [7, '信用卡欠款', '未繳卡費', 'card'],
  ] as const
  for (const [row, label, description, key] of rows) {
    sheet.getCell(row, 1).value = label
    sheet.getCell(row, 2).value = description
    report.balanceSheet.forEach((point, month) => { if (point) number(sheet.getCell(row, month + 3), point[key]) })
    number(sheet.getCell(row, 15), report.openingBalance[key])
  }
  sheet.getCell('A8').value = '淨資產'
  sheet.getCell('B8').value = '資產－欠款'
  sheet.getCell('A9').value = '淨資產增減'
  sheet.getCell('B9').value = '比上個月'
  const netWorth = (point: { cash: number; investment: number; receivable: number; card: number }) => point.cash + point.investment + point.receivable - point.card
  report.balanceSheet.forEach((point, month) => {
    if (!point) return
    const letter = column(month)
    formula(sheet.getCell(8, month + 3), `${letter}4+${letter}5+${letter}6-${letter}7`, netWorth(point))
    const previous = month === 0 ? report.openingBalance : report.balanceSheet[month - 1]!
    formula(sheet.getCell(9, month + 3), month === 0 ? 'C8-O8' : `${letter}8-${column(month - 1)}8`, netWorth(point) - netWorth(previous))
  })
  formula(sheet.getCell('O8'), 'O4+O5+O6-O7', netWorth(report.openingBalance))
  for (let col = 1; col <= 15; col++) sheet.getCell(8, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${pale}` } }
  note(sheet, 11, '投資以投入成本計，不含市值漲跌與未記錄的股利；外幣用下載當天的參考匯率換算；封存帳戶與設定為不計入淨資產的帳戶不列入（與 App 淨資產一致）。')
}

function savingsSheet(sheet: Worksheet, report: AnnualReportData) {
  title(sheet, `${report.year} 儲蓄去向`, 'P')
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }]
  sheet.getCell('A2').value = '每月結餘有多少進了投資、現金存款實際增減多少。單位：TWD。'
  header(sheet, 3, ['項目', '說明', ...months.map((month) => `${month + 1}月`), '年度總計'])
  const labels = [
    [4, '結餘', '收入－支出'],
    [5, '轉入投資', '轉進投資帳戶的淨額'],
    [6, '結餘扣掉投資', '負數＝投資用到存款'],
    [7, '現金存款增減', '月底比上月底'],
  ] as const
  for (const [row, label, description] of labels) {
    sheet.getCell(row, 1).value = label
    sheet.getCell(row, 2).value = description
  }
  months.forEach((month) => {
    const letter = column(month)
    const balance = report.monthlyIncome[month] - report.monthlyExpense[month]
    formula(sheet.getCell(4, month + 3), `'年度總覽'!${letter}6`, balance)
    number(sheet.getCell(5, month + 3), report.monthlyInvestmentInflow[month])
    formula(sheet.getCell(6, month + 3), `${letter}4-${letter}5`, balance - report.monthlyInvestmentInflow[month])
    const point = report.balanceSheet[month]
    if (!point) return
    const previous = month === 0 ? report.openingBalance : report.balanceSheet[month - 1]!
    formula(sheet.getCell(7, month + 3), month === 0 ? `'每月資產負債'!C4-'每月資產負債'!O4` : `'每月資產負債'!${letter}4-'每月資產負債'!${column(month - 1)}4`, point.cash - previous.cash)
  })
  const filled = report.balanceSheet.filter(Boolean).length
  const lastCash = filled ? report.balanceSheet[filled - 1]!.cash : report.openingBalance.cash
  for (const [row, value] of [
    [4, total(report.monthlyIncome) - total(report.monthlyExpense)],
    [5, total(report.monthlyInvestmentInflow)],
    [6, total(report.monthlyIncome) - total(report.monthlyExpense) - total(report.monthlyInvestmentInflow)],
    [7, lastCash - report.openingBalance.cash],
  ] as const) formula(sheet.getCell(row, 15), `SUM(C${row}:N${row})`, value)
  for (let col = 1; col <= 15; col++) sheet.getCell(6, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${pale}` } }
  note(sheet, 9, '「結餘扣掉投資」和「現金存款增減」不會剛好相等，差額來自信用卡還沒繳的消費、代墊、帳務調整與匯率。如果「結餘扣掉投資」連續幾個月是負數，代表投資的錢來自存款，不是當月結餘。')
}

export async function createAnnualWorkbook(report: AnnualReportData): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '家庭記帳'
  workbook.calcProperties.fullCalcOnLoad = true
  const overview = workbook.addWorksheet('年度總覽')
  const savings = workbook.addWorksheet('儲蓄去向')
  const balance = workbook.addWorksheet('每月資產負債')
  const totals = classificationSheet(workbook, report)
  overviewSheet(overview, report, totals)
  savingsSheet(savings, report)
  balanceSheetSheet(balance, report)
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
