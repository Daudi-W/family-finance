import assert from 'node:assert/strict'
import test from 'node:test'
import { preferredAccountId, reorderAccountIds, sortAccountsForUser } from '../v2/src/account-preferences.ts'
import type { Account } from '../v2/src/types.ts'

const account = (id: string, sortOrder: number, archivedAt?: string): Account => ({
  id,
  name: id,
  type: 'bank',
  currency: 'TWD',
  iconKey: 'landmark',
  sortOrder,
  includeInNetWorth: true,
  openingBalanceMinor: 0,
  openingDate: '2024-11-26',
  schemaVersion: 1,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  createdBy: 'test',
  updatedBy: 'test',
  revision: 1,
  archivedAt,
})

test('個人排序不改帳戶資料，未排的新帳戶接在後面', () => {
  const accounts = [account('a', 0), account('b', 1), account('c', 2), account('archived', 3, '2026-08-14')]
  assert.deepEqual(sortAccountsForUser(accounts, ['c', 'a']).map((item) => item.id), ['c', 'a', 'b'])
  assert.deepEqual(accounts.map((item) => item.sortOrder), [0, 1, 2, 3])
})

test('記帳優先使用指定帳戶，否則使用個人排序第一個', () => {
  const accounts = [account('a', 0), account('b', 1), account('archived', 2, '2026-08-14')]
  const preferences = { accountOrder: ['b', 'a'] }
  assert.equal(preferredAccountId(accounts, preferences, 'b'), 'b')
  assert.equal(preferredAccountId(accounts, preferences), 'b')
  assert.equal(preferredAccountId(accounts, { accountOrder: ['archived', 'a'] }), 'a')
})

const owned = (id: string, sortOrder: number, ownerUid?: string): Account => ({ ...account(id, sortOrder), ownerUid })

test('登入者自己的帳戶排最前，其次共用，最後才是另一半的', () => {
  const accounts = [owned('partner-1', 0, 'jessie'), owned('shared-1', 1), owned('mine-1', 2, 'pei')]
  assert.deepEqual(sortAccountsForUser(accounts, [], 'pei').map((item) => item.id), ['mine-1', 'shared-1', 'partner-1'])
})

test('換太太登入時順序自動相反', () => {
  const accounts = [owned('partner-1', 0, 'jessie'), owned('shared-1', 1), owned('mine-1', 2, 'pei')]
  assert.deepEqual(sortAccountsForUser(accounts, [], 'jessie').map((item) => item.id), ['partner-1', 'shared-1', 'mine-1'])
})

test('同一個歸屬群組內仍照個人拖曳排序', () => {
  const accounts = [owned('mine-a', 0, 'pei'), owned('mine-b', 1, 'pei'), owned('shared', 2)]
  assert.deepEqual(sortAccountsForUser(accounts, ['mine-b', 'mine-a'], 'pei').map((item) => item.id), ['mine-b', 'mine-a', 'shared'])
})

test('沒有設定歸屬時維持原本的個人排序，不受影響', () => {
  const accounts = [account('a', 0), account('b', 1), account('c', 2)]
  assert.deepEqual(sortAccountsForUser(accounts, ['c', 'a'], 'pei').map((item) => item.id), ['c', 'a', 'b'])
})

test('記帳預設帳戶會是登入者自己排最前面的那個', () => {
  const accounts = [owned('partner-1', 0, 'jessie'), owned('mine-1', 1, 'pei')]
  assert.equal(preferredAccountId(accounts, { accountOrder: [] }, '', 'pei'), 'mine-1')
  assert.equal(preferredAccountId(accounts, { accountOrder: [] }, '', 'jessie'), 'partner-1')
})

test('在選帳戶頁往上搬一個帳戶，只改順序不會弄丟其他帳戶', () => {
  const order = ['a', 'b', 'c', 'd']
  assert.deepEqual(reorderAccountIds(order, 'c', 'a'), ['c', 'a', 'b', 'd'])
  assert.deepEqual(reorderAccountIds(order, 'a', 'd'), ['b', 'c', 'd', 'a'])
  assert.deepEqual(order, ['a', 'b', 'c', 'd'])
})

test('搬到自己或不存在的帳戶時原樣退回，不會誤存偏好', () => {
  const order = ['a', 'b', 'c']
  assert.equal(reorderAccountIds(order, 'b', 'b'), order)
  assert.equal(reorderAccountIds(order, 'b', '不存在'), order)
  assert.equal(reorderAccountIds(order, '不存在', 'b'), order)
})

test('轉帳時清單少了對方帳戶，排序仍以完整清單計算，不會漏掉被過濾的帳戶', () => {
  const full = ['from', 'hidden', 'target']
  assert.deepEqual(reorderAccountIds(full, 'target', 'from'), ['target', 'from', 'hidden'])
})
