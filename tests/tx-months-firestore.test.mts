import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, test } from 'node:test'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteField, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore'
import { flattenMonths, indexShards, monthIdOf, planTransactionWrite } from '../v2/src/tx-months.ts'

/**
 * 在 Firestore 模擬器上實際跑一次月打包的寫入路徑，
 * 驗證「兩台裝置同時動同一個月」不會互相覆蓋，以及改日期跨月不會留下重複。
 */
const projectId = 'demo-family-finance-v2'
const householdId = 'pei-household'
let testEnvironment: Awaited<ReturnType<typeof initializeTestEnvironment>>

const transaction = (id: string, occurredOn: string, note: string) => ({
  id,
  kind: 'expense',
  occurredOn,
  note,
  accountMoves: [{ accountId: 'cash', deltaMinor: -100, currency: 'TWD' }],
  reportLines: [],
  schemaVersion: 1,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  createdBy: 'pei',
  updatedBy: 'pei',
  revision: 1,
})

const memberDb = () => testEnvironment.authenticatedContext('pei').firestore()
const monthsOf = (db: ReturnType<typeof memberDb>) => collection(db, 'households', householdId, 'txMonths')

const readMonths = async (db: ReturnType<typeof memberDb>) => {
  const snapshot = await getDocs(monthsOf(db))
  return snapshot.docs.map((item) => ({ ...(item.data() as Record<string, unknown>), id: item.id })) as Parameters<typeof flattenMonths>[0]
}

/** 與 finance-store 相同的寫入方式：只動自己那一格。 */
const writeTransaction = async (db: ReturnType<typeof memberDb>, known: Parameters<typeof flattenMonths>[0], value: ReturnType<typeof transaction>) => {
  const plan = planTransactionWrite(indexShards(known), value.occurredOn, value.id)
  const stamp = { updatedAt: value.updatedAt, updatedBy: value.updatedBy }
  const batch = writeBatch(db)
  if (plan.createTarget) {
    batch.set(doc(monthsOf(db), plan.targetShardId), { id: plan.targetShardId, month: monthIdOf(value.occurredOn), schemaVersion: 1, items: { [value.id]: value }, ...stamp }, { merge: true })
  } else {
    batch.update(doc(monthsOf(db), plan.targetShardId), { [`items.${value.id}`]: value, ...stamp })
  }
  if (plan.removeFromShardId) batch.update(doc(monthsOf(db), plan.removeFromShardId), { [`items.${value.id}`]: deleteField(), ...stamp })
  await batch.commit()
}

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await testEnvironment.clearFirestore()
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'households', householdId, 'members', 'pei'), { role: 'owner' })
  })
})

after(async () => {
  await testEnvironment.cleanup()
})

test('兩台裝置同時在同一個月新增交易，兩筆都會保留', async () => {
  const first = memberDb()
  const second = memberDb()
  // 兩台都還沒看到對方建立的月文件，各自以「這個月還不存在」的狀態寫入。
  await writeTransaction(first, [], transaction('a', '2026-08-03', '沛的早餐'))
  await writeTransaction(second, [], transaction('b', '2026-08-04', '思的午餐'))
  const stored = flattenMonths(await readMonths(first))
  assert.deepEqual(stored.map((item) => item.id), ['a', 'b'])
})

test('編輯一筆交易不會動到同月其他交易', async () => {
  const db = memberDb()
  await writeTransaction(db, [], transaction('a', '2026-08-03', '早餐'))
  await writeTransaction(db, await readMonths(db), transaction('b', '2026-08-04', '午餐'))
  const updated = { ...transaction('a', '2026-08-03', '早餐改成 120'), revision: 2 }
  await writeTransaction(db, await readMonths(db), updated)
  const stored = flattenMonths(await readMonths(db))
  assert.deepEqual(stored.map((item) => item.note), ['早餐改成 120', '午餐'])
  assert.equal(stored.find((item) => item.id === 'a')?.revision, 2)
})

test('編輯後移除的欄位不會殘留舊值', async () => {
  const db = memberDb()
  await writeTransaction(db, [], { ...transaction('a', '2026-08-03', '有專案'), projectId: 'trip' })
  const cleared = transaction('a', '2026-08-03', '取消專案')
  await writeTransaction(db, await readMonths(db), cleared)
  const stored = flattenMonths(await readMonths(db))
  assert.equal(stored[0].projectId, undefined)
})

test('把交易改到別的月份，舊月份不會留下重複的那一筆', async () => {
  const db = memberDb()
  await writeTransaction(db, [], transaction('a', '2026-08-03', '記錯月份'))
  await writeTransaction(db, [], transaction('b', '2026-08-05', '同月另一筆'))
  const moved = { ...transaction('a', '2026-09-03', '改成九月'), revision: 2 }
  await writeTransaction(db, await readMonths(db), moved)
  const months = await readMonths(db)
  const stored = flattenMonths(months)
  assert.deepEqual(stored.map((item) => `${item.id}:${item.occurredOn}`), ['b:2026-08-05', 'a:2026-09-03'])
  assert.equal(months.find((item) => item.id === '2026-08')?.items.a, undefined)
  assert.equal(Object.keys(months.find((item) => item.id === '2026-09')!.items).length, 1)
})

test('讀回整個帳本只需要月份數量的文件', async () => {
  const db = memberDb()
  await writeTransaction(db, [], transaction('a', '2026-07-03', '七月'))
  await writeTransaction(db, await readMonths(db), transaction('b', '2026-08-04', '八月'))
  await writeTransaction(db, await readMonths(db), transaction('c', '2026-08-20', '八月另一筆'))
  const snapshot = await getDocs(monthsOf(db))
  assert.equal(snapshot.docs.length, 2)
  assert.equal(flattenMonths(await readMonths(db)).length, 3)
})
