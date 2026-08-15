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
import {
  flattenMonths,
  indexShards,
  monthIdOf,
  planTransactionWrite,
  type ShardIndex,
  type TxMonthDocument,
} from './tx-months.ts'
import { describeSyncStatus } from './sync-status.ts'
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

/** 一筆交易目前的同步狀態：null＝已排隊等伺服器確認，字串＝真的失敗的錯誤訊息。 */
export type PendingSyncMap = Map<string, string | null>

/** Firestore 回報「本機還有變更沒送上雲端」時，SDK 會把這個旗標設為 true。 */
const hasUnsyncedWrites = (snapshot: { metadata: { hasPendingWrites: boolean } }) => snapshot.metadata.hasPendingWrites

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
  const [pendingSync, setPendingSync] = useState<PendingSyncMap>(new Map())
  const [hasPendingWrites, setHasPendingWrites] = useState(false)

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
    // includeMetadataChanges 讓我們收得到「這份文件還有本機變更沒上傳」的通知；
    // metadata 變動不計入 Firestore 讀取次數，不影響額度。
    unsubscribes.push(onSnapshot(
      monthCollectionPath(),
      { includeMetadataChanges: true },
      (snapshot) => {
        setMonths(snapshot.docs.map((item) => ({ ...(item.data() as Omit<TxMonthDocument, 'id'>), id: item.id })))
        setHasPendingWrites(hasUnsyncedWrites(snapshot))
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
     * 寫入單筆交易：只更新月文件裡屬於這筆的那一格，因此同一個月的其他交易
     * （包含另一台裝置剛新增的）不會被覆蓋。
     *
     * 這裡不等伺服器確認——Firestore 呼叫 commit() 的當下就會把資料寫進本機
     * 快取並讓畫面立刻更新，剩下「送到伺服器」的部分交給 SDK 在背景處理，
     * 離線時它會自己排隊、恢復連線後自動補送。UI 只要標記「這筆還在等」，
     * 真的失敗（不是單純離線）才需要使用者手動重試。
     */
    const writeTransactionItem = (value: FinanceTransaction, index: ShardIndex) => {
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
      setPendingSync((current) => new Map(current).set(value.id, null))
      batch.commit().then(
        () => setPendingSync((current) => { if (!current.has(value.id)) return current; const next = new Map(current); next.delete(value.id); return next }),
        (commitError: unknown) => setPendingSync((current) => new Map(current).set(value.id, commitError instanceof Error ? commitError.message : '同步失敗')),
      )
    }

    /** 手動重試：把已經標成失敗的那筆，用它最後一次的內容重新送一次。 */
    const retrySync = (id: string) => {
      const value = transactions.find((item) => item.id === id)
      if (!value) return
      writeTransactionItem(value, indexShards(months))
    }

    const saveTransaction = (input: Partial<FinanceTransaction> & { id?: string }) => {
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
      writeTransactionItem(value, shardIndex)
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

    const voidTransaction = (id: string, reason = '使用者刪除') => {
      const existing = transactions.find((item) => item.id === id)
      if (!existing) return
      const timestamp = new Date().toISOString()
      const value = clean({
        ...existing,
        voidedAt: timestamp,
        voidReason: reason,
        updatedAt: timestamp,
        updatedBy: user.uid,
        revision: (existing.revision ?? 0) + 1,
      }) as FinanceTransaction
      writeTransactionItem(value, shardIndex)
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

    return { save, archive, voidTransaction, seedDemo, retrySync }
  }, [documents, transactions, months, shardIndex, user.uid])

  const syncStatus = useMemo(
    () => describeSyncStatus(pendingSync, hasPendingWrites, transactions),
    [pendingSync, hasPendingWrites, transactions],
  )

  return {
    data,
    ready: loaded.size === documentCollectionNames.length + 1,
    error,
    syncStatus,
    ...actions,
  }
}
