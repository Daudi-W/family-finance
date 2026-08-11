import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const projectId = 'demo-family-finance-v2'
const householdId = 'pei-household'
let testEnvironment

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile('firestore.rules', 'utf8'),
    },
  })
})

beforeEach(async () => {
  await testEnvironment.clearFirestore()
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'households', householdId), { name: '測試家庭帳本' })
    await setDoc(doc(db, 'households', householdId, 'members', 'pei'), { role: 'owner' })
    await setDoc(doc(db, 'households', householdId, 'accounts', 'cash'), { name: '現金' })
    await setDoc(doc(db, 'households', 'other-household'), { name: '別人的帳本' })
  })
})

after(async () => {
  await testEnvironment.cleanup()
})

test('未登入者不能讀取家庭帳本', async () => {
  const db = testEnvironment.unauthenticatedContext().firestore()
  await assertFails(getDoc(doc(db, 'households', householdId)))
})

test('非成員不能讀取家庭帳本', async () => {
  const db = testEnvironment.authenticatedContext('stranger').firestore()
  await assertFails(getDoc(doc(db, 'households', householdId)))
})

test('成員可以讀取自己的家庭帳本與帳戶', async () => {
  const db = testEnvironment.authenticatedContext('pei').firestore()
  const household = await assertSucceeds(getDoc(doc(db, 'households', householdId)))
  const account = await assertSucceeds(getDoc(doc(db, 'households', householdId, 'accounts', 'cash')))
  assert.equal(household.data().name, '測試家庭帳本')
  assert.equal(account.data().name, '現金')
})

test('成員可以新增與修改自己的交易資料', async () => {
  const db = testEnvironment.authenticatedContext('pei').firestore()
  const transaction = doc(db, 'households', householdId, 'transactions', 'lunch')
  await assertSucceeds(setDoc(transaction, { type: 'expense', amount: 180 }))
  await assertSucceeds(setDoc(transaction, { type: 'expense', amount: 200 }))
})

test('成員仍不能讀取其他家庭帳本', async () => {
  const db = testEnvironment.authenticatedContext('pei').firestore()
  await assertFails(getDoc(doc(db, 'households', 'other-household')))
})

test('前端不能自行建立家庭帳本或竄改成員名單', async () => {
  const db = testEnvironment.authenticatedContext('pei').firestore()
  await assertFails(setDoc(doc(db, 'households', 'new-household'), { name: '未授權帳本' }))
  await assertFails(setDoc(doc(db, 'households', householdId, 'members', 'stranger'), { role: 'owner' }))
})

test('未列入資料模型的集合預設拒絕存取', async () => {
  const db = testEnvironment.authenticatedContext('pei').firestore()
  await assertFails(setDoc(doc(db, 'households', householdId, 'unknown', 'document'), { unsafe: true }))
})
