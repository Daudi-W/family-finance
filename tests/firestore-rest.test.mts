import assert from 'node:assert/strict'
import test from 'node:test'
import { chunks, firestoreFields, firestoreValue } from '../src/import/firestore-rest.mts'

test('Firestore REST 編碼保留整數、陣列、巢狀物件並移除 undefined', () => {
  assert.deepEqual(firestoreValue({ amount: 12, active: true, note: undefined, rows: [{ name: '早餐' }], empty: null }), {
    mapValue: { fields: {
      amount: { integerValue: '12' }, active: { booleanValue: true },
      rows: { arrayValue: { values: [{ mapValue: { fields: { name: { stringValue: '早餐' } } } }] } },
      empty: { nullValue: null },
    } },
  })
  assert.deepEqual(firestoreFields({ id: 'a', revision: 1 }), { id: { stringValue: 'a' }, revision: { integerValue: '1' } })
})

test('Firestore REST 批次切割不遺漏資料', () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.throws(() => chunks([1], 0), /正整數/)
})
