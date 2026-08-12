import { todayIso } from './finance.ts'
import type {
  Account,
  AdvancePerson,
  Budget,
  Category,
  FinanceData,
  FinanceTransaction,
  Project,
  RecurringRule,
} from './types.ts'

const uid = 'demo-seed'
const now = () => new Date().toISOString()
const base = (id: string, sortOrder = 0) => ({
  id,
  schemaVersion: 1 as const,
  createdAt: now(),
  updatedAt: now(),
  createdBy: uid,
  updatedBy: uid,
  revision: 1,
  sortOrder,
})

function dateInCurrentMonth(day: number) {
  const [year, month] = todayIso().split('-')
  return `${year}-${month}-${String(day).padStart(2, '0')}`
}

function futureDate(days: number) {
  const [year, month, day] = todayIso().split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function buildDemoData(): FinanceData {
  const categories: Category[] = [
    { ...base('salary', 0), name: '薪水', direction: 'income', iconKey: 'briefcase' },
    { ...base('bonus', 1), name: '獎金', direction: 'income', iconKey: 'sparkles' },
    { ...base('interest', 2), name: '利息', direction: 'income', iconKey: 'coins' },
    { ...base('refund', 3), name: '退款', direction: 'income', iconKey: 'rotate-ccw' },
    { ...base('adjustment-income', 99), name: '帳務調整', direction: 'income', iconKey: 'scale', systemKey: 'balance_adjustment_income' },
    { ...base('food', 0), name: '餐飲', direction: 'expense', iconKey: 'utensils' },
    { ...base('home', 1), name: '居家', direction: 'expense', iconKey: 'house' },
    { ...base('transport', 2), name: '交通', direction: 'expense', iconKey: 'train' },
    { ...base('entertainment', 3), name: '娛樂', direction: 'expense', iconKey: 'gamepad-2' },
    { ...base('medical', 4), name: '醫療保健', direction: 'expense', iconKey: 'heart-pulse' },
    { ...base('education', 5), name: '教育', direction: 'expense', iconKey: 'graduation-cap' },
    { ...base('bank-fee', 98), name: '手續費', direction: 'expense', iconKey: 'receipt-text', systemKey: 'bank_fee' },
    { ...base('adjustment-expense', 99), name: '帳務調整', direction: 'expense', iconKey: 'scale', systemKey: 'balance_adjustment_expense' },
  ]

  const accounts: Account[] = [
    { ...base('cash', 0), name: '現金', type: 'cash', currency: 'TWD', iconKey: 'wallet-cards', includeInNetWorth: true, openingBalanceMinor: 8780, openingDate: dateInCurrentMonth(1) },
    { ...base('bank', 1), name: '中信帳戶', type: 'bank', currency: 'TWD', iconKey: 'landmark', includeInNetWorth: true, openingBalanceMinor: 31644, openingDate: dateInCurrentMonth(1) },
    { ...base('card', 2), name: '永豐信用卡', type: 'credit_card', currency: 'TWD', iconKey: 'credit-card', includeInNetWorth: true, openingBalanceMinor: 15120, openingDate: dateInCurrentMonth(1), creditCard: { closingDay: 12, paymentDay: 28, defaultPaymentAccountId: 'bank' } },
    { ...base('investment', 3), name: 'ETF 投資', type: 'investment', currency: 'TWD', iconKey: 'chart-no-axes-combined', includeInNetWorth: true, openingBalanceMinor: 1200000, openingDate: dateInCurrentMonth(1) },
  ]

  const projects: Project[] = [
    { ...base('japan', 0), name: '日本旅行', iconKey: 'plane', note: '家庭旅行', startDate: dateInCurrentMonth(1), endDate: dateInCurrentMonth(31), budgetMinor: 50000, currency: 'TWD' },
  ]

  const budgets: Budget[] = [
    { ...base('budget-food'), categoryId: 'food', cycle: 'monthly', amountMinor: 12000 },
    { ...base('budget-home'), categoryId: 'home', cycle: 'monthly', amountMinor: 8000 },
    { ...base('budget-transport'), categoryId: 'transport', cycle: 'monthly', amountMinor: 6000 },
    { ...base('budget-entertainment'), categoryId: 'entertainment', cycle: 'monthly', amountMinor: 8000 },
  ]

  const advancePeople: AdvancePerson[] = [
    { ...base('friend-a', 0), name: '朋友 A', iconKey: 'user-round' },
    { ...base('friend-b', 1), name: '朋友 B', iconKey: 'user-round' },
  ]

  const transactionBase = (id: string, occurredOn: string): Omit<FinanceTransaction, 'kind' | 'accountMoves' | 'reportLines'> => ({
    ...base(id),
    occurredOn,
  })

  const transactions: FinanceTransaction[] = [
    {
      ...transactionBase('salary-demo', dateInCurrentMonth(8)),
      kind: 'income', note: '本月薪資',
      accountMoves: [{ accountId: 'bank', deltaMinor: 62000, currency: 'TWD' }],
      reportLines: [{ direction: 'income', categoryId: 'salary', amountMinor: 62000, currency: 'TWD', amountTwdMinor: 62000, countsTowardBudget: true }],
    },
    {
      ...transactionBase('lunch-demo', todayIso()),
      kind: 'expense', note: '午餐',
      accountMoves: [{ accountId: 'cash', deltaMinor: -180, currency: 'TWD' }],
      reportLines: [{ direction: 'expense', categoryId: 'food', amountMinor: 180, currency: 'TWD', amountTwdMinor: 180, countsTowardBudget: true }],
    },
    {
      ...transactionBase('airport-demo', futureDate(-1)),
      kind: 'expense', note: '機場交通', projectId: 'japan',
      accountMoves: [{ accountId: 'card', deltaMinor: 1280, currency: 'TWD' }],
      reportLines: [{ direction: 'expense', categoryId: 'transport', amountMinor: 1280, currency: 'TWD', amountTwdMinor: 1280, countsTowardBudget: true }],
    },
    {
      ...transactionBase('home-demo', dateInCurrentMonth(5)),
      kind: 'expense', note: '日用品',
      accountMoves: [{ accountId: 'card', deltaMinor: 6200, currency: 'TWD' }],
      reportLines: [{ direction: 'expense', categoryId: 'home', amountMinor: 6200, currency: 'TWD', amountTwdMinor: 6200, countsTowardBudget: true }],
    },
    {
      ...transactionBase('entertainment-demo', dateInCurrentMonth(7)),
      kind: 'expense', note: '展覽門票',
      accountMoves: [{ accountId: 'card', deltaMinor: 6000, currency: 'TWD' }],
      reportLines: [{ direction: 'expense', categoryId: 'entertainment', amountMinor: 6000, currency: 'TWD', amountTwdMinor: 6000, countsTowardBudget: true }],
    },
    {
      ...transactionBase('advance-demo', dateInCurrentMonth(9)),
      kind: 'advance', note: '聚餐代墊',
      accountMoves: [{ accountId: 'card', deltaMinor: 2400, currency: 'TWD' }],
      reportLines: [{ direction: 'expense', categoryId: 'food', amountMinor: 800, currency: 'TWD', amountTwdMinor: 800, countsTowardBudget: true }],
      advance: { direction: 'receivable', totalMinor: 2400, ownShareMinor: 800, currency: 'TWD', people: [{ personId: 'friend-a', name: '朋友 A', expectedMinor: 800 }, { personId: 'friend-b', name: '朋友 B', expectedMinor: 800 }] },
    },
  ]

  const recurringRules: RecurringRule[] = [
    { ...base('recurring-subscription', 0), name: '影音訂閱', iconKey: 'calendar-days', frequency: 'monthly', nextScheduledOn: todayIso(), postingMode: 'confirm', previewDays: 3, transactionTemplate: { kind: 'expense', amountMinor: 390, categoryId: 'entertainment', accountId: 'card', note: '影音訂閱' } },
    { ...base('recurring-etf', 1), name: 'ETF 定期定額', iconKey: 'chart-no-axes-combined', frequency: 'monthly', nextScheduledOn: futureDate(2), postingMode: 'confirm', previewDays: 3, transactionTemplate: { kind: 'transfer', amountMinor: 10000, fromAccountId: 'bank', toAccountId: 'investment', note: 'ETF 定期定額' } },
  ]

  return { accounts, categories, projects, transactions, budgets, recurringRules, advancePeople }
}
