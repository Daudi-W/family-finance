import assert from 'node:assert/strict'
import test from 'node:test'
import { describeSyncStatus, type SessionSyncState } from '../v2/src/sync-status.ts'
import type { FinanceTransaction } from '../v2/src/types.ts'

const transaction = (id: string, occurredOn: string, note: string): FinanceTransaction => ({
  id,
  kind: 'expense',
  occurredOn,
  note,
  accountMoves: [],
  reportLines: [],
  schemaVersion: 1,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  createdBy: 'pei',
  updatedBy: 'pei',
  revision: 1,
})

const session = (entries: Array<[string, string | null]>): SessionSyncState => new Map(entries)

test('全部同步完成時不顯示徽章', () => {
  const status = describeSyncStatus(session([]), false, [transaction('a', '2026-08-15', '午餐')])
  assert.equal(status.badgeCount, 0)
  assert.deepEqual(status.queued, [])
  assert.deepEqual(status.failed, [])
  assert.equal(status.hasUnknownPending, false)
})

test('離線記的帳會列在等待連線，並附上交易細節', () => {
  const items = [transaction('a', '2026-08-15', '午餐'), transaction('b', '2026-08-15', '咖啡')]
  const status = describeSyncStatus(session([['b', null]]), true, items)
  assert.equal(status.badgeCount, 1)
  assert.deepEqual(status.queued.map((item) => item.note), ['咖啡'])
  assert.equal(status.hasUnknownPending, false)
})

test('真的失敗的交易會分開列出並帶錯誤訊息', () => {
  const items = [transaction('a', '2026-08-15', '午餐')]
  const status = describeSyncStatus(session([['a', '權限不足']]), false, items)
  assert.equal(status.badgeCount, 1)
  assert.deepEqual(status.queued, [])
  assert.equal(status.failed[0].message, '權限不足')
  assert.equal(status.failed[0].transaction?.note, '午餐')
})

test('等待中與失敗會一起計入徽章數字', () => {
  const items = [transaction('a', '2026-08-15', '午餐'), transaction('b', '2026-08-15', '咖啡')]
  const status = describeSyncStatus(session([['a', null], ['b', '寫入被拒絕']]), true, items)
  assert.equal(status.badgeCount, 2)
  assert.equal(status.queued.length, 1)
  assert.equal(status.failed.length, 1)
})

test('重新整理後細節不見了，仍誠實顯示還有變更待上傳', () => {
  const status = describeSyncStatus(session([]), true, [transaction('a', '2026-08-15', '午餐')])
  assert.equal(status.hasUnknownPending, true)
  assert.equal(status.badgeCount, 1)
})

test('有細節可顯示時，就不再另外顯示籠統的待上傳訊息', () => {
  const items = [transaction('a', '2026-08-15', '午餐')]
  const status = describeSyncStatus(session([['a', null]]), true, items)
  assert.equal(status.hasUnknownPending, false)
  assert.equal(status.badgeCount, 1)
})

test('等待中的交易依日期排序，兩台裝置看到的順序一致', () => {
  const items = [transaction('b', '2026-08-20', '晚餐'), transaction('a', '2026-08-02', '早餐')]
  const status = describeSyncStatus(session([['b', null], ['a', null]]), true, items)
  assert.deepEqual(status.queued.map((item) => item.id), ['a', 'b'])
})

test('交易已被刪除但仍記在待同步清單時不會壞掉', () => {
  const status = describeSyncStatus(session([['missing', null], ['gone', '同步失敗']]), true, [])
  assert.deepEqual(status.queued, [])
  assert.equal(status.failed[0].transaction, undefined)
  assert.equal(status.badgeCount, 1)
})
