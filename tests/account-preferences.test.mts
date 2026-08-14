import assert from 'node:assert/strict'
import test from 'node:test'
import { preferredAccountId, sortAccountsForUser } from '../v2/src/account-preferences.ts'
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

test('記帳優先使用指定帳戶，其次個人預設，失效時退回排序第一個', () => {
  const accounts = [account('a', 0), account('b', 1), account('archived', 2, '2026-08-14')]
  const preferences = { accountOrder: ['b', 'a'], defaultAccountId: 'a' }
  assert.equal(preferredAccountId(accounts, preferences, 'b'), 'b')
  assert.equal(preferredAccountId(accounts, preferences), 'a')
  assert.equal(preferredAccountId(accounts, { accountOrder: ['b'], defaultAccountId: 'archived' }), 'b')
})
