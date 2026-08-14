export type AccountType = 'cash' | 'bank' | 'credit_card' | 'investment' | 'receivable';
export type TransactionKind =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'advance'
  | 'settlement'
  | 'balance_adjustment';

export type Account = {
  id: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: number;
  includeInNetWorth?: boolean;
  referenceRateToTwd?: number;
};

export type AccountMove = {
  accountId: string;
  currency: string;
  deltaMinor: number;
};

export type ReportLine = {
  direction: 'income' | 'expense';
  categoryId: string;
  amountMinor: number;
  currency: string;
  amountTwdMinor: number;
  countsTowardBudget: boolean;
};

export type AdvanceShare = {
  personId: string;
  expectedMinor: number;
  settledMinor: number;
};

export type AdvanceDetail = {
  direction: 'receivable' | 'payable';
  totalMinor: number;
  ownShareMinor: number;
  currency: string;
  people: AdvanceShare[];
};

export type Transaction = {
  id: string;
  kind: TransactionKind;
  occurredOn: string;
  note?: string;
  projectId?: string;
  accountMoves: AccountMove[];
  reportLines: ReportLine[];
  advance?: AdvanceDetail;
  settlement?: {
    advanceTransactionId: string;
    direction: 'collect' | 'repay';
    amountMinor: number;
  };
  adjustment?: {
    beforeMinor: number;
    actualMinor: number;
    differenceMinor: number;
  };
  voidedAt?: string;
};

type BaseInput = {
  id: string;
  occurredOn: string;
  note?: string;
};

function assertIntegerMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} 必須是安全整數`);
}

function assertPositiveMinor(value: number, label: string): void {
  assertIntegerMinor(value, label);
  if (value <= 0) throw new Error(`${label} 必須大於 0`);
}

function isLiability(account: Account): boolean {
  return account.type === 'credit_card';
}

function outflowDelta(account: Account, amountMinor: number): number {
  return isLiability(account) ? amountMinor : -amountMinor;
}

function inflowDelta(account: Account, amountMinor: number): number {
  return isLiability(account) ? -amountMinor : amountMinor;
}

function accountMove(account: Account, deltaMinor: number): AccountMove {
  return { accountId: account.id, currency: account.currency, deltaMinor };
}

function reportLine(
  direction: 'income' | 'expense',
  categoryId: string,
  amountMinor: number,
  currency: string,
  amountTwdMinor: number,
  countsTowardBudget = true,
): ReportLine {
  assertPositiveMinor(amountMinor, '報表金額');
  assertPositiveMinor(amountTwdMinor, '台幣報表金額');
  return { direction, categoryId, amountMinor, currency, amountTwdMinor, countsTowardBudget };
}

export function createExpense(input: BaseInput & {
  account: Account;
  amountMinor: number;
  amountTwdMinor?: number;
  categoryId: string;
  projectId?: string;
}): Transaction {
  assertPositiveMinor(input.amountMinor, '支出金額');
  const amountTwdMinor = input.amountTwdMinor ?? input.amountMinor;
  return {
    id: input.id,
    kind: 'expense',
    occurredOn: input.occurredOn,
    note: input.note,
    projectId: input.projectId,
    accountMoves: [accountMove(input.account, outflowDelta(input.account, input.amountMinor))],
    reportLines: [reportLine('expense', input.categoryId, input.amountMinor, input.account.currency, amountTwdMinor)],
  };
}

export function createIncome(input: BaseInput & {
  account: Account;
  amountMinor: number;
  amountTwdMinor?: number;
  categoryId: string;
  projectId?: string;
}): Transaction {
  assertPositiveMinor(input.amountMinor, '收入金額');
  const amountTwdMinor = input.amountTwdMinor ?? input.amountMinor;
  return {
    id: input.id,
    kind: 'income',
    occurredOn: input.occurredOn,
    note: input.note,
    projectId: input.projectId,
    accountMoves: [accountMove(input.account, inflowDelta(input.account, input.amountMinor))],
    reportLines: [reportLine('income', input.categoryId, input.amountMinor, input.account.currency, amountTwdMinor)],
  };
}

export function createTransfer(input: BaseInput & {
  fromAccount: Account;
  toAccount: Account;
  fromAmountMinor: number;
  toAmountMinor: number;
  feeMinor?: number;
  feeAmountTwdMinor?: number;
  feeCategoryId?: string;
}): Transaction {
  assertPositiveMinor(input.fromAmountMinor, '轉出金額');
  assertPositiveMinor(input.toAmountMinor, '轉入金額');
  const feeMinor = input.feeMinor ?? 0;
  assertIntegerMinor(feeMinor, '手續費');
  if (feeMinor < 0) throw new Error('手續費不得小於 0');

  const reportLines = feeMinor === 0
    ? []
    : [reportLine(
      'expense',
      input.feeCategoryId ?? 'bank_fee',
      feeMinor,
      input.fromAccount.currency,
      input.feeAmountTwdMinor ?? feeMinor,
    )];

  return {
    id: input.id,
    kind: 'transfer',
    occurredOn: input.occurredOn,
    note: input.note,
    accountMoves: [
      accountMove(input.fromAccount, outflowDelta(input.fromAccount, input.fromAmountMinor + feeMinor)),
      accountMove(input.toAccount, inflowDelta(input.toAccount, input.toAmountMinor)),
    ],
    reportLines,
  };
}

export function createBalanceAdjustment(input: BaseInput & {
  account: Account;
  currentBalanceMinor: number;
  actualBalanceMinor: number;
  incomeCategoryId?: string;
  expenseCategoryId?: string;
  amountTwdMinor?: number;
}): Transaction {
  assertIntegerMinor(input.currentBalanceMinor, '帳面餘額');
  assertIntegerMinor(input.actualBalanceMinor, '實際餘額');
  const differenceMinor = input.actualBalanceMinor - input.currentBalanceMinor;
  if (differenceMinor === 0) throw new Error('實際餘額與帳面餘額相同，不需要調整');

  const direction = isLiability(input.account)
    ? (differenceMinor > 0 ? 'expense' : 'income')
    : (differenceMinor > 0 ? 'income' : 'expense');
  const categoryId = direction === 'income'
    ? (input.incomeCategoryId ?? 'balance_adjustment_income')
    : (input.expenseCategoryId ?? 'balance_adjustment_expense');
  const absoluteMinor = Math.abs(differenceMinor);

  return {
    id: input.id,
    kind: 'balance_adjustment',
    occurredOn: input.occurredOn,
    note: input.note,
    accountMoves: [accountMove(input.account, differenceMinor)],
    reportLines: [reportLine(
      direction,
      categoryId,
      absoluteMinor,
      input.account.currency,
      input.amountTwdMinor ?? absoluteMinor,
      false,
    )],
    adjustment: {
      beforeMinor: input.currentBalanceMinor,
      actualMinor: input.actualBalanceMinor,
      differenceMinor,
    },
  };
}

export function createAdvancePaid(input: BaseInput & {
  account: Account;
  totalMinor: number;
  ownShareMinor: number;
  people: Array<{ personId: string; expectedMinor: number }>;
  categoryId: string;
  amountTwdMinor?: number;
  projectId?: string;
}): Transaction {
  assertPositiveMinor(input.totalMinor, '消費總額');
  assertIntegerMinor(input.ownShareMinor, '自己負擔金額');
  if (input.ownShareMinor < 0 || input.ownShareMinor > input.totalMinor) throw new Error('自己負擔金額超出消費總額');
  const expectedTotal = input.people.reduce((sum, person) => sum + person.expectedMinor, 0);
  if (expectedTotal !== input.totalMinor - input.ownShareMinor) throw new Error('各對象應還金額與代墊總額不一致');

  const reportLines = input.ownShareMinor === 0
    ? []
    : [reportLine(
      'expense',
      input.categoryId,
      input.ownShareMinor,
      input.account.currency,
      input.amountTwdMinor ?? input.ownShareMinor,
    )];

  return {
    id: input.id,
    kind: 'advance',
    occurredOn: input.occurredOn,
    note: input.note,
    projectId: input.projectId,
    accountMoves: [accountMove(input.account, outflowDelta(input.account, input.totalMinor))],
    reportLines,
    advance: {
      direction: 'receivable',
      totalMinor: input.totalMinor,
      ownShareMinor: input.ownShareMinor,
      currency: input.account.currency,
      people: input.people.map(person => ({ ...person, settledMinor: 0 })),
    },
  };
}

export function createAdvanceOwed(input: BaseInput & {
  currency: string;
  amountMinor: number;
  personId: string;
  categoryId: string;
  amountTwdMinor?: number;
  projectId?: string;
}): Transaction {
  assertPositiveMinor(input.amountMinor, '應還金額');
  return {
    id: input.id,
    kind: 'advance',
    occurredOn: input.occurredOn,
    note: input.note,
    projectId: input.projectId,
    accountMoves: [],
    reportLines: [reportLine(
      'expense',
      input.categoryId,
      input.amountMinor,
      input.currency,
      input.amountTwdMinor ?? input.amountMinor,
    )],
    advance: {
      direction: 'payable',
      totalMinor: input.amountMinor,
      ownShareMinor: input.amountMinor,
      currency: input.currency,
      people: [{ personId: input.personId, expectedMinor: input.amountMinor, settledMinor: 0 }],
    },
  };
}

export function createSettlement(input: BaseInput & {
  account: Account;
  advanceTransactionId: string;
  direction: 'collect' | 'repay';
  amountMinor: number;
}): Transaction {
  assertPositiveMinor(input.amountMinor, '收還款金額');
  const delta = input.direction === 'collect'
    ? inflowDelta(input.account, input.amountMinor)
    : outflowDelta(input.account, input.amountMinor);
  return {
    id: input.id,
    kind: 'settlement',
    occurredOn: input.occurredOn,
    note: input.note,
    accountMoves: [accountMove(input.account, delta)],
    reportLines: [],
    settlement: {
      advanceTransactionId: input.advanceTransactionId,
      direction: input.direction,
      amountMinor: input.amountMinor,
    },
  };
}

export function calculateBalances(accounts: Account[], transactions: Transaction[]): Record<string, number> {
  const accountMap = new Map(accounts.map(account => [account.id, account]));
  const balances = Object.fromEntries(accounts.map(account => [account.id, account.openingBalanceMinor]));
  for (const transaction of transactions) {
    if (transaction.voidedAt) continue;
    for (const move of transaction.accountMoves) {
      const account = accountMap.get(move.accountId);
      if (!account) throw new Error(`找不到帳戶：${move.accountId}`);
      if (account.currency !== move.currency) throw new Error(`帳戶 ${move.accountId} 的幣別不一致`);
      assertIntegerMinor(move.deltaMinor, '帳戶異動');
      balances[move.accountId] += move.deltaMinor;
    }
  }
  return balances;
}

export function calculateReportTotals(transactions: Transaction[]): {
  incomeTwdMinor: number;
  expenseTwdMinor: number;
  balanceTwdMinor: number;
  byCategory: Record<string, number>;
} {
  let incomeTwdMinor = 0;
  let expenseTwdMinor = 0;
  const byCategory: Record<string, number> = {};
  for (const transaction of transactions) {
    if (transaction.voidedAt) continue;
    for (const line of transaction.reportLines) {
      if (line.direction === 'income') incomeTwdMinor += line.amountTwdMinor;
      else expenseTwdMinor += line.amountTwdMinor;
      const sign = line.direction === 'income' ? 1 : -1;
      byCategory[line.categoryId] = (byCategory[line.categoryId] ?? 0) + sign * line.amountTwdMinor;
    }
  }
  return {
    incomeTwdMinor,
    expenseTwdMinor,
    balanceTwdMinor: incomeTwdMinor - expenseTwdMinor,
    byCategory,
  };
}

export function calculateBudgetUsage(transactions: Transaction[], categoryId?: string): number {
  let total = 0;
  for (const transaction of transactions) {
    if (transaction.voidedAt) continue;
    for (const line of transaction.reportLines) {
      if (line.direction !== 'expense' || !line.countsTowardBudget) continue;
      if (categoryId && line.categoryId !== categoryId) continue;
      total += line.amountTwdMinor;
    }
  }
  return total;
}

export function calculateProjectTotals(transactions: Transaction[], projectId: string): ReturnType<typeof calculateReportTotals> {
  return calculateReportTotals(transactions.filter(transaction => transaction.projectId === projectId));
}

export function calculateNetWorthTwd(accounts: Account[], balances: Record<string, number>): number {
  let total = 0;
  for (const account of accounts) {
    if (account.includeInNetWorth === false) continue;
    const rate = account.currency === 'TWD' ? 1 : account.referenceRateToTwd;
    if (!rate || rate <= 0) throw new Error(`帳戶 ${account.id} 缺少有效台幣參考匯率`);
    const twdValue = Math.round((balances[account.id] ?? 0) * rate);
    total += isLiability(account) ? -twdValue : twdValue;
  }
  return total;
}

export function calculateAdvanceRemaining(origin: Transaction, settlements: Transaction[]): number {
  if (!origin.advance) throw new Error('指定交易不是代墊');
  const expected = origin.advance.direction === 'receivable'
    ? origin.advance.totalMinor - origin.advance.ownShareMinor
    : origin.advance.totalMinor;
  const settled = settlements
    .filter(transaction => !transaction.voidedAt && transaction.settlement?.advanceTransactionId === origin.id)
    .reduce((sum, transaction) => sum + (transaction.settlement?.amountMinor ?? 0), 0);
  return Math.max(0, expected - settled);
}

export function replaceTransaction(transactions: Transaction[], replacement: Transaction): Transaction[] {
  const index = transactions.findIndex(transaction => transaction.id === replacement.id);
  if (index < 0) throw new Error(`找不到要編輯的交易：${replacement.id}`);
  return transactions.map((transaction, currentIndex) => currentIndex === index ? replacement : transaction);
}

export function voidTransaction(transaction: Transaction, voidedAt: string): Transaction {
  return { ...transaction, voidedAt };
}

export function recurringOccurrenceId(ruleId: string, scheduledOn: string): string {
  if (!ruleId || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledOn)) throw new Error('定期項目識別資料不完整');
  return `${ruleId}:${scheduledOn}`;
}

export function annualBudgetReference(cycle: 'monthly' | 'annual', amountMinor: number): number {
  assertPositiveMinor(amountMinor, '預算金額');
  return cycle === 'monthly' ? amountMinor * 12 : amountMinor;
}

export function monthlyBudgetReference(cycle: 'monthly' | 'annual', amountMinor: number): number {
  assertPositiveMinor(amountMinor, '預算金額');
  return cycle === 'annual' ? Math.round(amountMinor / 12) : amountMinor;
}
