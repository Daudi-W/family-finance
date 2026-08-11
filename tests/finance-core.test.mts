import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAdvanceRemaining,
  calculateBalances,
  calculateBudgetUsage,
  calculateNetWorthTwd,
  calculateProjectTotals,
  calculateReportTotals,
  createAdvanceOwed,
  createAdvancePaid,
  createBalanceAdjustment,
  createExpense,
  createSettlement,
  createTransfer,
  recurringOccurrenceId,
  replaceTransaction,
  voidTransaction,
  type Account,
} from '../src/domain/finance-core.mts';

const cash: Account = { id: 'cash', type: 'cash', currency: 'TWD', openingBalanceMinor: 10_000 };
const bank: Account = { id: 'bank', type: 'bank', currency: 'TWD', openingBalanceMinor: 50_000 };
const card: Account = { id: 'card', type: 'credit_card', currency: 'TWD', openingBalanceMinor: 0 };
const investment: Account = { id: 'investment', type: 'investment', currency: 'TWD', openingBalanceMinor: 0 };
const jpy: Account = { id: 'jpy', type: 'bank', currency: 'JPY', openingBalanceMinor: 1_000, referenceRateToTwd: 0.215 };
const accounts = [cash, bank, card, investment, jpy];

test('1. 現金支出只影響一次帳戶與支出', () => {
  const expense = createExpense({ id: 'e1', occurredOn: '2026-08-11', account: cash, amountMinor: 1_200, categoryId: 'food' });
  assert.equal(calculateBalances(accounts, [expense]).cash, 8_800);
  assert.deepEqual(calculateReportTotals([expense]), {
    incomeTwdMinor: 0,
    expenseTwdMinor: 1_200,
    balanceTwdMinor: -1_200,
    byCategory: { food: -1_200 },
  });
});

test('2. 信用卡消費算支出，繳卡費不重複', () => {
  const purchase = createExpense({ id: 'e2', occurredOn: '2026-08-11', account: card, amountMinor: 3_000, categoryId: 'home' });
  const payment = createTransfer({ id: 't2', occurredOn: '2026-08-12', fromAccount: bank, toAccount: card, fromAmountMinor: 3_000, toAmountMinor: 3_000 });
  const balances = calculateBalances(accounts, [purchase, payment]);
  assert.equal(balances.bank, 47_000);
  assert.equal(balances.card, 0);
  assert.equal(calculateReportTotals([purchase, payment]).expenseTwdMinor, 3_000);
});

test('3. 投資本金以轉帳處理，不列為支出', () => {
  const transfer = createTransfer({ id: 't3', occurredOn: '2026-08-11', fromAccount: bank, toAccount: investment, fromAmountMinor: 10_000, toAmountMinor: 10_000 });
  const balances = calculateBalances(accounts, [transfer]);
  assert.equal(balances.bank, 40_000);
  assert.equal(balances.investment, 10_000);
  assert.equal(calculateReportTotals([transfer]).expenseTwdMinor, 0);
});

test('4. 跨幣別轉帳保留兩側金額，只有手續費算支出', () => {
  const transfer = createTransfer({
    id: 't4', occurredOn: '2026-08-11', fromAccount: bank, toAccount: jpy,
    fromAmountMinor: 2_150, toAmountMinor: 10_000, feeMinor: 30, feeCategoryId: 'bank_fee',
  });
  const balances = calculateBalances(accounts, [transfer]);
  assert.equal(balances.bank, 47_820);
  assert.equal(balances.jpy, 11_000);
  assert.equal(calculateReportTotals([transfer]).expenseTwdMinor, 30);
  assert.equal(calculateNetWorthTwd(accounts, balances), 60_185);
});

test('5. 純替別人代墊時付款帳戶變動，家庭支出為零', () => {
  const advance = createAdvancePaid({
    id: 'a5', occurredOn: '2026-08-11', account: cash, totalMinor: 800, ownShareMinor: 0,
    people: [{ personId: 'friend', expectedMinor: 800 }], categoryId: 'food',
  });
  assert.equal(calculateBalances(accounts, [advance]).cash, 9_200);
  assert.equal(calculateReportTotals([advance]).expenseTwdMinor, 0);
  assert.equal(calculateAdvanceRemaining(advance, []), 800);
});

test('6. 多人代墊只把自己的份額算成支出', () => {
  const advance = createAdvancePaid({
    id: 'a6', occurredOn: '2026-08-11', account: card, totalMinor: 1_200, ownShareMinor: 400,
    people: [{ personId: 'a', expectedMinor: 300 }, { personId: 'b', expectedMinor: 500 }], categoryId: 'food',
  });
  assert.equal(calculateBalances(accounts, [advance]).card, 1_200);
  assert.equal(calculateReportTotals([advance]).expenseTwdMinor, 400);
  assert.equal(calculateAdvanceRemaining(advance, []), 800);
});

test('7. 分批收回現金只增加帳戶並減少待收，不算收入', () => {
  const advance = createAdvancePaid({
    id: 'a7', occurredOn: '2026-08-11', account: card, totalMinor: 800, ownShareMinor: 0,
    people: [{ personId: 'friend', expectedMinor: 800 }], categoryId: 'food',
  });
  const first = createSettlement({ id: 's71', occurredOn: '2026-08-12', account: cash, advanceTransactionId: advance.id, direction: 'collect', amountMinor: 300 });
  const second = createSettlement({ id: 's72', occurredOn: '2026-08-13', account: cash, advanceTransactionId: advance.id, direction: 'collect', amountMinor: 500 });
  assert.equal(calculateBalances(accounts, [advance, first, second]).cash, 10_800);
  assert.equal(calculateAdvanceRemaining(advance, [first]), 500);
  assert.equal(calculateAdvanceRemaining(advance, [first, second]), 0);
  assert.equal(calculateReportTotals([first, second]).incomeTwdMinor, 0);
});

test('8. 別人代墊先形成支出，分次還款不重複', () => {
  const owed = createAdvanceOwed({ id: 'a8', occurredOn: '2026-08-11', currency: 'TWD', amountMinor: 1_200, personId: 'friend', categoryId: 'hotel' });
  const first = createSettlement({ id: 's81', occurredOn: '2026-08-12', account: bank, advanceTransactionId: owed.id, direction: 'repay', amountMinor: 500 });
  const second = createSettlement({ id: 's82', occurredOn: '2026-08-13', account: bank, advanceTransactionId: owed.id, direction: 'repay', amountMinor: 700 });
  assert.equal(calculateBalances(accounts, [owed, first, second]).bank, 48_800);
  assert.equal(calculateReportTotals([owed, first, second]).expenseTwdMinor, 1_200);
  assert.equal(calculateAdvanceRemaining(owed, [first, second]), 0);
});

test('9. 資產與負債的餘額調整方向正確，且不占預算', () => {
  const cashAdjustment = createBalanceAdjustment({ id: 'b91', occurredOn: '2026-08-11', account: cash, currentBalanceMinor: 10_000, actualBalanceMinor: 10_200 });
  const cardAdjustment = createBalanceAdjustment({ id: 'b92', occurredOn: '2026-08-11', account: card, currentBalanceMinor: 500, actualBalanceMinor: 650 });
  const totals = calculateReportTotals([cashAdjustment, cardAdjustment]);
  assert.equal(totals.incomeTwdMinor, 200);
  assert.equal(totals.expenseTwdMinor, 150);
  assert.equal(calculateBudgetUsage([cashAdjustment, cardAdjustment]), 0);
});

test('10. 專案可獨立查看，但整體支出只計算一次', () => {
  const expense = createExpense({ id: 'e10', occurredOn: '2026-08-11', account: cash, amountMinor: 2_000, categoryId: 'travel', projectId: 'japan' });
  assert.equal(calculateReportTotals([expense]).expenseTwdMinor, 2_000);
  assert.equal(calculateProjectTotals([expense], 'japan').expenseTwdMinor, 2_000);
});

test('11. 同一規則與日期只會得到同一個定期項目識別碼', () => {
  assert.equal(recurringOccurrenceId('salary', '2026-09-08'), recurringOccurrenceId('salary', '2026-09-08'));
  assert.notEqual(recurringOccurrenceId('salary', '2026-09-08'), recurringOccurrenceId('salary', '2026-10-08'));
});

test('12. 編輯與作廢交易後，餘額和報表都會回算', () => {
  const original = createExpense({ id: 'e12', occurredOn: '2026-08-11', account: cash, amountMinor: 100, categoryId: 'food' });
  const edited = createExpense({ id: 'e12', occurredOn: '2026-08-11', account: cash, amountMinor: 250, categoryId: 'food' });
  const transactions = replaceTransaction([original], edited);
  assert.equal(calculateBalances(accounts, transactions).cash, 9_750);
  assert.equal(calculateReportTotals(transactions).expenseTwdMinor, 250);
  const voided = [voidTransaction(edited, '2026-08-12T00:00:00Z')];
  assert.equal(calculateBalances(accounts, voided).cash, 10_000);
  assert.equal(calculateReportTotals(voided).expenseTwdMinor, 0);
});
