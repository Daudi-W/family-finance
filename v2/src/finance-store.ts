import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  runTransaction,
  writeBatch,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db, householdId } from './firebase.ts'
import { buildDemoData } from './demo-data.ts'
import { settleOrQueue } from './offline-write.ts'
import {
  flattenMonths,
  indexShards,
  monthIdOf,
  planTransactionWrite,
  type ShardIndex,
  type TxMonthDocument,
} from './tx-months.ts'
import type {
  BaseDocument,
  CollectionName,
  FinanceData,
  FinanceTransaction,
} from './types.ts'

type DocumentCollectionName = Exclude<CollectionName, 'transactions'>
type DocumentData = Omit<FinanceData, 'transactions'>

const emptyDocuments: DocumentData = {
  accounts: [],
  categories: [],
  projects: [],
  budgets: [],
  recurringRules: [],
  advancePeople: [],
}

/** 這些集合資料量小（各數十筆），維持一份文件一筆，讀取成本可忽略。 */
const documentCollectionNames: DocumentCollectionName[] = [
  'accounts',
  'categories',
  'projects',
  'budgets',
  'recurringRules',
  'advancePeople',
]

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createDocumentId() {
  return crypto.randomUUID()
}

function collectionPath(name: DocumentCollectionName) {
  return collection(db, 'households', householdId, name)
}

function monthCollectionPath() {
  return collection(db, 'households', householdId, 'txMonths')
}

export function useFinanceStore(user: User) {
  const [documents, setDocuments] = useState<DocumentData>(emptyDocuments)
  const [months, setMonths] = useState<TxMonthDocument[]>([])
  const [loaded, setLoaded] = useState<Set<CollectionName>>(new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    const unsubscribes = documentCollectionNames.map((name) => onSnapshot(
      collectionPath(name),
      (snapshot) => {
        const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        setDocuments((current) => ({ ...current, [name]: items }))
        setLoaded((current) => new Set(current).add(name))
      },
      (storeError) => setError(storeError.message),
    ))
    unsubscribes.push(onSnapshot(
      monthCollectionPath(),
      (snapshot) => {
        setMonths(snapshot.docs.map((item) => ({ ...(item.data() as Omit<TxMonthDocument, 'id'>), id: item.id })))
        setLoaded((current) => new Set(current).add('transactions'))
      },
      (storeError) => setError(storeError.message),
    ))
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [])

  const transactions = useMemo(() => flattenMonths(months), [months])
  const shardIndex = useMemo(() => indexShards(months), [months])
  const data = useMemo<FinanceData>(() => ({ ...documents, transactions }), [documents, transactions])

  const actions = useMemo(() => {
    /**
     * 寫入單筆交易：只更新月文件裡屬於這筆的那一格，
     * 因此同一個月的其他交易（包含另一台裝置剛新增的）不會被覆蓋，離線也能排隊送出。
     */
    const writeTransactionItem = async (value: FinanceTransaction, index: ShardIndex) => {
      const plan = planTransactionWrite(index, value.occurredOn, value.id)
      const stamp = { updatedAt: value.updatedAt, updatedBy: value.updatedBy }
      const targetReference = doc(monthCollectionPath(), plan.targetShardId)
      const batch = writeBatch(db)
      if (plan.createTarget) {
        batch.set(targetReference, { id: plan.targetShardId, month: monthIdOf(value.occurredOn), schemaVersion: 1, items: { [value.id]: value }, ...stamp }, { merge: true })
      } else {
        batch.update(targetReference, { [`items.${value.id}`]: value, ...stamp })
      }
      // 改日期跨到別的月份時，從原本那份移除，避免同一筆出現兩次。
      if (plan.removeFromShardId) {
        batch.update(doc(monthCollectionPath(), plan.removeFromShardId), { [`items.${value.id}`]: deleteField(), ...stamp })
      }
      // 離線時本機已經寫好，不等伺服器確認也讓畫面往下走；真正的錯誤仍會被回報。
      await settleOrQueue(batch.commit())
    }

    const saveTransaction = async (input: Partial<FinanceTransaction> & { id?: string }) => {
      const id = input.id || createDocumentId()
      const existing = transactions.find((item) => item.id === id)
      const timestamp = new Date().toISOString()
      const value = clean({
        ...input,
        id,
        schemaVersion: 1,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        createdBy: existing?.createdBy ?? user.uid,
        updatedBy: user.uid,
        revision: (existing?.revision ?? 0) + 1,
      }) as FinanceTransaction
      await writeTransactionItem(value, shardIndex)
      return id
    }

    const save = async <K extends CollectionName>(name: K, input: Partial<FinanceData[K][number]> & { id?: string }) => {
      if (name === 'transactions') return saveTransaction(input as Partial<FinanceTransaction> & { id?: string })
      const collectionName = name as DocumentCollectionName
      const id = input.id || createDocumentId()
      const existing = documents[collectionName].find((item) => item.id === id) as BaseDocument | undefined
      const reference = doc(collectionPath(collectionName), id)
      await runTransaction(db, async (transaction) => {
        const remote = await transaction.get(reference)
        const remoteData = remote.data() as BaseDocument | undefined
        if (remote.exists() && existing && remoteData?.revision !== existing.revision) throw new Error('這筆資料已在另一台裝置更新，請重新載入後再修改。')
        if (remote.exists() && !existing) throw new Error('這筆資料已存在，請重新載入後再操作。')
        const timestamp = new Date().toISOString()
        const documentData = clean({
          ...input,
          id,
          schemaVersion: 1,
          createdAt: remoteData?.createdAt ?? timestamp,
          updatedAt: timestamp,
          createdBy: remoteData?.createdBy ?? user.uid,
          updatedBy: user.uid,
          revision: (remoteData?.revision ?? 0) + 1,
        })
        transaction.set(reference, documentData, { merge: true })
      })
      return id
    }

    const archive = async (name: DocumentCollectionName, id: string, archived: boolean) => {
      const reference = doc(collectionPath(name), id)
      const known = documents[name].find((item) => item.id === id) as BaseDocument | undefined
      await runTransaction(db, async (transaction) => {
        const remote = await transaction.get(reference)
        const remoteData = remote.data() as BaseDocument | undefined
        if (!remote.exists()) throw new Error('找不到要封存的資料。')
        if (known && remoteData?.revision !== known.revision) throw new Error('這筆資料已在另一台裝置更新，請重新載入後再修改。')
        transaction.set(reference, { archivedAt: archived ? new Date().toISOString() : deleteField(), updatedAt: new Date().toISOString(), updatedBy: user.uid, revision: (remoteData?.revision ?? 0) + 1 }, { merge: true })
      })
    }

    const voidTransaction = async (id: string, reason = '使用者刪除') => {
      const existing = transactions.find((item) => item.id === id)
      if (!existing) throw new Error('找不到要刪除的明細。')
      const timestamp = new Date().toISOString()
      const value = clean({
        ...existing,
        voidedAt: timestamp,
        voidReason: reason,
        updatedAt: timestamp,
        updatedBy: user.uid,
        revision: (existing.revision ?? 0) + 1,
      }) as FinanceTransaction
      await writeTransactionItem(value, shardIndex)
    }

    const seedDemo = async () => {
      const batch = writeBatch(db)
      const demo = buildDemoData()
      for (const name of documentCollectionNames) {
        for (const item of demo[name]) batch.set(doc(collectionPath(name), item.id), clean({ ...item, createdBy: user.uid, updatedBy: user.uid }))
      }
      const timestamp = new Date().toISOString()
      const demoMonths = new Map<string, Record<string, FinanceTransaction>>()
      for (const item of demo.transactions) {
        const month = monthIdOf(item.occurredOn)
        const bucket = demoMonths.get(month) ?? {}
        bucket[item.id] = clean({ ...item, createdBy: user.uid, updatedBy: user.uid })
        demoMonths.set(month, bucket)
      }
      for (const [month, items] of demoMonths) {
        batch.set(doc(monthCollectionPath(), month), { id: month, month, schemaVersion: 1, items, updatedAt: timestamp, updatedBy: user.uid }, { merge: true })
      }
      await batch.commit()
    }

    return { save, archive, voidTransaction, seedDemo }
  }, [documents, transactions, shardIndex, user.uid])

  return {
    data,
    ready: loaded.size === documentCollectionNames.length + 1,
    error,
    ...actions,
  }
}
