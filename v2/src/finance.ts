import type {
  Account,
  Budget,
  Category,
  FinanceTransaction,
  RecurringRule,
} from './types.ts'

export const todayIso = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export const monthKey = (date: string) => date.slice(0, 7)

export const currencyFractionDigits = (currency: string) => ['TWD', 'JPY', 'KRW'].includes(currency.toUpperCase()) ? 0 : 2
export const currencyScale = (currency: string) => 10 ** currencyFractionDigits(currency)
export const fromMinor = (value: number, currency: string) => value / currencyScale(currency)
export const toMinor = (value: string | number, currency: string) => Math.round(Number(String(value).replaceAll(',', '')) * currencyScale(currency))

export const money = (value: number, currency = 'TWD') =>
  new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency,
    maximumFractionDigits: currencyFractionDigits(currency),
  }).format(fromMinor(value, currency))

export function activeTransactions(transactions: FinanceTransaction[]) {
  return transactions.filter((transaction) => !transaction.voidedAt)
}

export function calculateBalances(accounts: Account[], transactions: FinanceTransaction[]) {
  const balances = Object.fromEntries(accounts.map((account) => [account.id, account.openingBalanceMinor])) as Record<string, number>
  for (const transaction of activeTransactions(transactions)) {
    for (const move of transaction.accountMoves) {
      if (balances[move.accountId] !== undefined) balances[move.accountId] += move.deltaMinor
    }
  }
  return balances
}

export function accountPeriodSummary(account: Account, transactions: FinanceTransaction[], from: string, to: string) {
  const related = activeTransactions(transactions).filter((transaction) => transaction.occurredOn >= from && transaction.occurredOn <= to && transaction.accountMoves.some((move) => move.accountId === account.id))
  const income = related.flatMap((transaction) => transaction.reportLines.filter((line) => line.direction === 'income')).reduce((sum, line) => sum + line.amountMinor, 0)
  const expense = related.flatMap((transaction) => transaction.reportLines.filter((line) => line.direction === 'expense')).reduce((sum, line) => sum + line.amountMinor, 0)
  const rawNetTransfer = related.filter((transaction) => transaction.kind === 'transfer').flatMap((transaction) => transaction.accountMoves.filter((move) => move.accountId === account.id)).reduce((sum, move) => sum + move.deltaMinor, 0)
  return { income, expense, netTransfer: (account.type === 'credit_card' ? -1 : 1) * rawNetTransfer }
}

export type AccountPeriod = 'month' | 'sixMonths' | 'year'

export function accountPeriodRange(period: AccountPeriod, asOf = todayIso()) {
  const monthStart = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`)
  monthStart.setUTCMonth(monthStart.getUTCMonth() - (period === 'sixMonths' ? 5 : period === 'year' ? 11 : 0))
  return { from: monthStart.toISOString().slice(0, 10), to: asOf }
}

export function calculateNetWorth(accounts: Account[], balances: Record<string, number>) {
  let assets = 0
  let liabilities = 0
  for (const account of accounts.filter((item) => !item.archivedAt && item.includeInNetWorth)) {
    const twd = Math.round(fromMinor(balances[account.id] ?? 0, account.currency) * (account.currency === 'TWD' ? 1 : account.referenceRateToTwd ?? 0))
    if (account.type === 'credit_card') liabilities += Math.max(0, twd)
    else assets += twd
  }
  return { assets, liabilities, netWorth: assets - liabilities }
}

export function reportForRange(transactions: FinanceTransaction[], from: string, to: string) {
  let income = 0
  let expense = 0
  const byCategory: Record<string, number> = {}
  for (const transaction of activeTransactions(transactions)) {
    if (transaction.occurredOn < from || transaction.occurredOn > to) continue
    for (const line of transaction.reportLines) {
      if (line.direction === 'income') income += line.amountTwdMinor
      else expense += line.amountTwdMinor
      byCategory[line.categoryId] = (byCategory[line.categoryId] ?? 0) + (line.direction === 'income' ? line.amountTwdMinor : -line.amountTwdMinor)
    }
  }
  return { income, expense, balance: income - expense, byCategory }
}

export function reportForMonth(transactions: FinanceTransaction[], month: string) {
  return reportForRange(transactions, `${month}-01`, `${month}-31`)
}

export function categoryExpensesForMonth(transactions: FinanceTransaction[], month: string) {
  const result: Record<string, number> = {}
  for (const transaction of activeTransactions(transactions)) {
    if (monthKey(transaction.occurredOn) !== month) continue
    for (const line of transaction.reportLines) {
      if (line.direction !== 'expense' || !line.countsTowardBudget) continue
      result[line.categoryId] = (result[line.categoryId] ?? 0) + line.amountTwdMinor
    }
  }
  return result
}

export function monthlyBudgetRows(
  budgets: Budget[],
  categories: Category[],
  transactions: FinanceTransaction[],
  month: string,
) {
  const year = Number(month.slice(0, 4))
  const spent = categoryExpensesForMonth(transactions, month)
  return budgets
    .filter((budget) => !budget.archivedAt && (!budget.year || budget.year === year))
    .map((budget) => {
      const category = categories.find((item) => item.id === budget.categoryId)
      const monthlyAmount = budget.cycle === 'monthly' ? budget.amountMinor : Math.round(budget.amountMinor / 12)
      const annualAmount = budget.cycle === 'annual' ? budget.amountMinor : budget.amountMinor * 12
      return {
        budget,
        category,
        monthlyAmount,
        annualAmount,
        spent: spent[budget.categoryId] ?? 0,
      }
    })
}

export function settlementsByAdvance(transactions: FinanceTransaction[]) {
  const totals: Record<string, number> = {}
  for (const transaction of activeTransactions(transactions)) {
    if (!transaction.settlement) continue
    const id = transaction.settlement.advanceTransactionId
    totals[id] = (totals[id] ?? 0) + transaction.settlement.amountMinor
  }
  return totals
}

export function advanceRows(transactions: FinanceTransaction[]) {
  return activeTransactions(transactions)
    .filter((transaction) => transaction.kind === 'advance' && transaction.advance)
    .map((transaction) => ({
      transaction,
      remaining: advancePeopleRows(transaction, transactions).reduce((sum, person) => sum + person.remainingMinor, 0),
    }))
}

export function advancePeopleRows(advance: FinanceTransaction, transactions: FinanceTransaction[]) {
  if (!advance.advance) return []
  return advance.advance.people.map((person) => {
    const settledByTransactions = activeTransactions(transactions)
      .filter((transaction) => transaction.settlement?.advanceTransactionId === advance.id && transaction.settlement.personId === person.personId)
      .reduce((sum, transaction) => sum + (transaction.settlement?.amountMinor ?? 0), 0)
    const settled = Math.max(person.settledMinor ?? 0, settledByTransactions)
    return { ...person, settledMinor: settled, remainingMinor: Math.max(0, person.expectedMinor - settled) }
  })
}

export function pendingRecurring(rules: RecurringRule[], today = todayIso()) {
  return rules.filter((rule) => {
    if (rule.archivedAt) return false
    const previewDate = new Date(`${today}T00:00:00`)
    previewDate.setDate(previewDate.getDate() + rule.previewDays)
    return rule.nextScheduledOn <= previewDate.toISOString().slice(0, 10)
  })
}

export function addRecurringPeriod(date: string, frequency: RecurringRule['frequency']) {
  const next = new Date(`${date}T00:00:00`)
  if (frequency === 'weekly') next.setDate(next.getDate() + 7)
  if (frequency === 'monthly') next.setMonth(next.getMonth() + 1)
  if (frequency === 'yearly') next.setFullYear(next.getFullYear() + 1)
  return next.toISOString().slice(0, 10)
}

export function monthRange(period: '本月' | '近三個月' | '今年', now = todayIso()) {
  const [year, month] = now.split('-').map(Number)
  if (period === '本月') return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-31` }
  if (period === '今年') return { from: `${year}-01-01`, to: `${year}-12-31` }
  const start = new Date(year, month - 3, 1)
  return {
    from: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`,
    to: `${year}-${String(month).padStart(2, '0')}-31`,
  }
}

export type ReportPeriod = '月' | '近6個月' | '年'

export function reportRangeForPeriod(period: ReportPeriod, anchorMonth = monthKey(todayIso())) {
  const [year, month] = anchorMonth.split('-').map(Number)
  if (period === '月') return { from: `${anchorMonth}-01`, to: `${anchorMonth}-31` }
  if (period === '年') return { from: `${year}-01-01`, to: `${year}-12-31` }
  const start = new Date(year, month - 6, 1)
  return {
    from: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`,
    to: `${anchorMonth}-31`,
  }
}

export function monthSequence(from: string, to: string) {
  const [startYear, startMonth] = from.slice(0, 7).split('-').map(Number)
  const [endYear, endMonth] = to.slice(0, 7).split('-').map(Number)
  const result: string[] = []
  let year = startYear
  let month = startMonth
  while ((year < endYear || (year === endYear && month <= endMonth)) && result.length < 12) {
    result.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month === 13) { month = 1; year += 1 }
  }
  return result
}
