type ReportMode = 'expense' | 'income' | 'balance' | 'netWorth'

type CategoryRow = { name: string; amount: number; percent: number }
type BalanceRow = { label: string; income: number; expense: number; balance: number }
type NetWorthRow = { label: string; netWorth: number; change: number }

export type ReportExport = {
  mode: ReportMode
  periodLabel: string
  from: string
  to: string
  accountName: string
  projectName: string
  income: number
  expense: number
  balance: number
  categories: CategoryRow[]
  balanceRows: BalanceRow[]
  netWorthRows: NetWorthRow[]
  openingNetWorth: number
}

const modeLabels: Record<ReportMode, string> = { expense: '支出', income: '收入', balance: '結餘', netWorth: '淨資產' }

function csvCell(value: string | number) {
  if (typeof value === 'number') return String(value)
  const safe = /^\s*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function buildReportCsv(report: ReportExport) {
  const lines: (string | number)[][] = [
    ['家庭記帳報表', modeLabels[report.mode]],
    ['期間', report.periodLabel],
    ['起日', report.from],
    ['迄日', report.to],
    ['帳戶', report.accountName],
    ['專案', report.projectName],
    [],
  ]

  if (report.mode === 'expense' || report.mode === 'income') {
    const total = report.mode === 'income' ? report.income : report.expense
    lines.push(['分類', '金額（TWD）', '占比（%）'])
    for (const row of report.categories) lines.push([row.name, row.amount, Number(row.percent.toFixed(2))])
    lines.push(['合計', total, report.categories.length ? 100 : 0])
  } else if (report.mode === 'balance') {
    lines.push(['收入合計（TWD）', report.income], ['支出合計（TWD）', report.expense], ['區間結餘（TWD）', report.balance], [])
    lines.push(['期間', '收入（TWD）', '支出（TWD）', '結餘（TWD）'])
    for (const row of report.balanceRows) lines.push([row.label, row.income, row.expense, row.balance])
  } else {
    const ending = report.netWorthRows.at(-1)?.netWorth ?? report.openingNetWorth
    lines.push(['期初淨資產（TWD）', report.openingNetWorth], ['期末淨資產（TWD）', ending], ['區間增減（TWD）', ending - report.openingNetWorth], [])
    lines.push(['期間', '淨資產（TWD）', '增減（TWD）'])
    for (const row of report.netWorthRows) lines.push([row.label, row.netWorth, row.change])
  }

  return `\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`
}

export function downloadReportCsv(report: ReportExport) {
  const blob = new Blob([buildReportCsv(report)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `家庭報表_${modeLabels[report.mode]}_${report.from}_${report.to}.csv`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
