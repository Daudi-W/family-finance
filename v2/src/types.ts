export type Direction = 'income' | 'expense'
export type AccountType = 'cash' | 'bank' | 'credit_card' | 'investment' | 'receivable'
export type TransactionKind = 'income' | 'expense' | 'transfer' | 'advance' | 'settlement' | 'balance_adjustment'

export type BaseDocument = {
  id: string
  schemaVersion: 1
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
  revision: number
  archivedAt?: string
}

export type Category = BaseDocument & {
  name: string
  direction: Direction
  iconKey: string
  sortOrder: number
  systemKey?: 'balance_adjustment_income' | 'balance_adjustment_expense' | 'bank_fee'
}

export type Account = BaseDocument & {
  name: string
  type: AccountType
  /** 帳戶歸屬的家庭成員 uid；留空代表共用。登入者自己的帳戶會排在最前面。 */
  ownerUid?: string
  currency: string
  iconKey: string
  sortOrder: number
  includeInNetWorth: boolean
  openingBalanceMinor: number
  openingDate: string
  referenceRateToTwd?: number
  referenceRateMode?: 'auto' | 'manual'
  referenceRateDate?: string
  referenceRateSource?: 'frankfurter' | 'manual'
  note?: string
  creditCard?: {
    closingDay: number
    paymentDay: number
    defaultPaymentAccountId?: string
  }
}

export type Project = BaseDocument & {
  name: string
  iconKey: string
  sortOrder: number
  note?: string
  startDate?: string
  endDate?: string
  budgetMinor?: number
  currency: 'TWD'
}

export type Budget = BaseDocument & {
  categoryId: string
  cycle: 'monthly' | 'annual'
  amountMinor: number
  year?: number
}

export type AdvancePerson = BaseDocument & {
  name: string
  iconKey: string
  sortOrder: number
}

export type AccountMove = {
  accountId: string
  deltaMinor: number
  currency: string
}

export type ReportLine = {
  direction: Direction
  categoryId: string
  amountMinor: number
  currency: string
  amountTwdMinor: number
  countsTowardBudget: boolean
}

export type AdvanceShare = {
  personId: string
  name?: string
  expectedMinor: number
  /** 舊版資料相容；新版以 settlement 交易保存收還款。 */
  settledMinor?: number
}

export type FinanceTransaction = BaseDocument & {
  kind: TransactionKind
  occurredOn: string
  note?: string
  projectId?: string
  accountMoves: AccountMove[]
  reportLines: ReportLine[]
  transfer?: {
    fromAccountId: string
    toAccountId: string
    fromAmountMinor: number
    toAmountMinor: number
    feeMinor: number
  }
  advance?: {
    direction: 'receivable' | 'payable'
    totalMinor: number
    ownShareMinor: number
    currency: string
    people: AdvanceShare[]
  }
  settlement?: {
    advanceTransactionId: string
    personId: string
    direction: 'collect' | 'repay'
    amountMinor: number
  }
  adjustment?: {
    accountId: string
    beforeMinor: number
    actualMinor: number
    differenceMinor: number
  }
  recurringOccurrenceId?: string
  voidedAt?: string
  voidReason?: string
}

export type RecurringTemplate = {
  kind: 'income' | 'expense' | 'transfer'
  amountMinor: number
  categoryId?: string
  accountId?: string
  fromAccountId?: string
  toAccountId?: string
  projectId?: string
  note?: string
}

export type RecurringRule = BaseDocument & {
  name: string
  iconKey: string
  sortOrder: number
  frequency: 'weekly' | 'monthly' | 'yearly'
  nextScheduledOn: string
  postingMode: 'confirm' | 'auto'
  previewDays: number
  transactionTemplate: RecurringTemplate
}

export type FinanceData = {
  accounts: Account[]
  categories: Category[]
  projects: Project[]
  transactions: FinanceTransaction[]
  budgets: Budget[]
  recurringRules: RecurringRule[]
  /** 代墊常用姓名；交易仍內嵌姓名，封存名單後歷史明細不受影響。 */
  advancePeople: AdvancePerson[]
}

export type CollectionName = keyof FinanceData
