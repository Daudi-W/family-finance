import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_ITEMS_PER_SHARD,
  flattenMonths,
  indexShards,
  monthIdOf,
  parseShardId,
  pickShardForWrite,
  shardIdOf,
  type TxMonthDocument,
} from '../v2/src/tx-months.ts'
import type { FinanceTransaction } from '../v2/src/types.ts'

const transaction = (id: string, occurredOn: string): FinanceTransaction => ({
  id,
  kind: 'expense',
  occurredOn,
  accountMoves: [],
  reportLines: [],
  schemaVersion: 1,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  createdBy: 'pei',
  updatedBy: 'pei',
  revision: 1,
})

const month = (id: string, items: FinanceTransaction[]): TxMonthDocument => ({
  id,
  month: parseShardId(id)!.month,
  schemaVersion: 1,
  items: Object.fromEntries(items.map((item) => [item.id, item])),
  updatedAt: '2026-08-14T00:00:00.000Z',
  updatedBy: 'pei',
})

test('月份代號取自交易日期，格式錯誤要擋下來', () => {
  assert.equal(monthIdOf('2026-08-14'), '2026-08')
  assert.equal(monthIdOf('2024-11-01'), '2024-11')
  assert.throws(() => monthIdOf('2026-13-01'), /日期格式/)
  assert.throws(() => monthIdOf(''), /日期格式/)
})

test('分片代號可以來回轉換，第一份不加後綴', () => {
  assert.equal(shardIdOf('2026-08', 0), '2026-08')
  assert.equal(shardIdOf('2026-08', 1), '2026-08-s2')
  assert.deepEqual(parseShardId('2026-08'), { month: '2026-08', index: 0 })
  assert.deepEqual(parseShardId('2026-08-s2'), { month: '2026-08', index: 1 })
  assert.equal(parseShardId('accounts'), null)
})

test('攤平月文件會還原成依日期排序的交易陣列', () => {
  const documents = [
    month('2026-08', [transaction('b', '2026-08-14'), transaction('a', '2026-08-02')]),
    month('2026-07', [transaction('c', '2026-07-30')]),
  ]
  assert.deepEqual(flattenMonths(documents).map((item) => item.id), ['c', 'a', 'b'])
})

test('同一天的交易依編號排序，順序在每台裝置上一致', () => {
  const documents = [month('2026-08', [transaction('z', '2026-08-05'), transaction('a', '2026-08-05')])]
  assert.deepEqual(flattenMonths(documents).map((item) => item.id), ['a', 'z'])
})

test('缺少 items 的月文件不會讓攤平壞掉', () => {
  const broken = { id: '2026-08', month: '2026-08', schemaVersion: 1, updatedAt: '', updatedBy: '' } as unknown as TxMonthDocument
  assert.deepEqual(flattenMonths([broken]), [])
})

test('既有交易編輯時寫回原本那份文件', () => {
  const index = indexShards([month('2026-08', [transaction('a', '2026-08-02')])])
  assert.equal(pickShardForWrite(index, '2026-08', 'a'), '2026-08')
})

test('新交易寫進同月還有空間的分片', () => {
  const index = indexShards([month('2026-08', [transaction('a', '2026-08-02')])])
  assert.equal(pickShardForWrite(index, '2026-08', 'new'), '2026-08')
})

test('單月滿了會自動開下一個分片，不會寫不進去', () => {
  const full = Array.from({ length: MAX_ITEMS_PER_SHARD }, (_, position) => transaction(`t${position}`, '2026-08-02'))
  const index = indexShards([month('2026-08', full)])
  assert.equal(pickShardForWrite(index, '2026-08', 'new'), '2026-08-s2')
})

test('把交易改到別的月份會指向新月份的文件', () => {
  const index = indexShards([month('2026-08', [transaction('a', '2026-08-02')])])
  assert.equal(index.shardIdByTransactionId.get('a'), '2026-08')
  assert.equal(pickShardForWrite(index, '2026-09', 'a'), '2026-09')
})

test('沒有任何月文件時從第一份開始寫', () => {
  assert.equal(pickShardForWrite(indexShards([]), '2026-08', 'new'), '2026-08')
})
