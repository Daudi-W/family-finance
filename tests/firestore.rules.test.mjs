import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'

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

test('成員可以管理 v2 的分類、帳戶、預算、專案、定期與代墊資料', async () => {
  const db = testEnvironment.authenticatedContext('pei').firestore()
  for (const collectionName of ['categories', 'accounts', 'budgets', 'projects', 'recurringRules', 'advancePeople']) {
    await assertSucceeds(setDoc(doc(db, 'households', householdId, collectionName, 'sample'), { name: '測試資料', schemaVersion: 1 }))
  }
})

test('每位成員只能讀寫自己的帳戶偏好', async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'households', householdId, 'members', 'jessie'), { role: 'member' })
  })
  const pei = testEnvironment.authenticatedContext('pei').firestore()
  const jessie = testEnvironment.authenticatedContext('jessie').firestore()
  const createdAt = '2026-08-14T00:00:00.000Z'
  const preference = { uid: 'pei', accountOrder: ['cash'], schemaVersion: 1, createdAt, updatedAt: createdAt, createdBy: 'pei', updatedBy: 'pei', revision: 1 }
  const reference = doc(pei, 'households', householdId, 'userPreferences', 'pei')
  await assertSucceeds(setDoc(reference, preference))
  await assertSucceeds(getDoc(reference))
  await assertSucceeds(setDoc(reference, { ...preference, accountOrder: ['bank', 'cash'], updatedAt: '2026-08-14T00:01:00.000Z', revision: 2 }))
  await assertFails(getDoc(doc(jessie, 'households', householdId, 'userPreferences', 'pei')))
  await assertFails(setDoc(doc(jessie, 'households', householdId, 'userPreferences', 'pei'), { ...preference, updatedBy: 'jessie' }))
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

test('只有受邀 Email 可為自己的 UID 建立一般成員，且不能冒充 owner', async () => {
  const invitedEmail = 'jessie@example.test'
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'households', householdId, 'invites', invitedEmail), { role: 'member' })
  })
  const invited = testEnvironment.authenticatedContext('invited-user', { email: invitedEmail }).firestore()
  const stranger = testEnvironment.authenticatedContext('stranger-user', { email: 'stranger@example.test' }).firestore()
  const memberData = { id: 'invited-user', role: 'member', schemaVersion: 1, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', createdBy: 'invited-user', updatedBy: 'invited-user', revision: 1 }
  await assertSucceeds(getDoc(doc(invited, 'households', householdId, 'invites', invitedEmail)))
  await assertFails(getDoc(doc(stranger, 'households', householdId, 'invites', invitedEmail)))
  await assertSucceeds(setDoc(doc(invited, 'households', householdId, 'members', 'invited-user'), memberData))
  await assertFails(setDoc(doc(stranger, 'households', householdId, 'members', 'stranger-user'), { ...memberData, id: 'stranger-user', createdBy: 'stranger-user', updatedBy: 'stranger-user' }))
  await assertFails(setDoc(doc(invited, 'households', householdId, 'members', 'another-user'), { ...memberData, id: 'another-user' }))
  await assertFails(setDoc(doc(invited, 'households', householdId, 'members', 'invited-owner'), { ...memberData, id: 'invited-owner', role: 'owner' }))
})

test('月打包交易只有家庭成員能讀寫，且不能整份刪除', async () => {
  const member = testEnvironment.authenticatedContext('pei').firestore()
  const stranger = testEnvironment.authenticatedContext('stranger').firestore()
  const monthDocument = { id: '2026-08', month: '2026-08', schemaVersion: 1, items: { a: { id: 'a', occurredOn: '2026-08-14' } }, updatedAt: '2026-08-14T00:00:00.000Z', updatedBy: 'pei' }
  await assertSucceeds(setDoc(doc(member, 'households', householdId, 'txMonths', '2026-08'), monthDocument))
  await assertSucceeds(getDoc(doc(member, 'households', householdId, 'txMonths', '2026-08')))
  await assertFails(getDoc(doc(stranger, 'households', householdId, 'txMonths', '2026-08')))
  await assertFails(setDoc(doc(stranger, 'households', householdId, 'txMonths', '2026-09'), monthDocument))
  await assertFails(deleteDoc(doc(member, 'households', householdId, 'txMonths', '2026-08')))
})

test('單份月文件塞超過上限會被規則擋下來', async () => {
  const member = testEnvironment.authenticatedContext('pei').firestore()
  const items = Object.fromEntries(Array.from({ length: 1001 }, (_, position) => [`t${position}`, { id: `t${position}` }]))
  await assertFails(setDoc(doc(member, 'households', householdId, 'txMonths', '2026-08'), { id: '2026-08', month: '2026-08', schemaVersion: 1, items, updatedAt: '2026-08-14T00:00:00.000Z', updatedBy: 'pei' }))
})

test('未列入資料模型的集合預設拒絕存取', async () => {
  const db = testEnvironment.authenticatedContext('pei').firestore()
  await assertFails(setDoc(doc(db, 'households', householdId, 'unknown', 'document'), { unsafe: true }))
})
