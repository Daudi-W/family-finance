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
import type {
  BaseDocument,
  CollectionName,
  FinanceData,
} from './types.ts'

const emptyData: FinanceData = {
  accounts: [],
  categories: [],
  projects: [],
  transactions: [],
  budgets: [],
  recurringRules: [],
  advancePeople: [],
}

const collectionNames: CollectionName[] = [
  'accounts',
  'categories',
  'projects',
  'transactions',
  'budgets',
  'recurringRules',
  'advancePeople',
]

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createDocumentId() {
  return crypto.randomUUID()
}

function collectionPath(name: CollectionName) {
  return collection(db, 'households', householdId, name)
}

export function useFinanceStore(user: User) {
  const [data, setData] = useState<FinanceData>(emptyData)
  const [loaded, setLoaded] = useState<Set<CollectionName>>(new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    const unsubscribes = collectionNames.map((name) => onSnapshot(
      collectionPath(name),
      (snapshot) => {
        const documents = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        setData((current) => ({ ...current, [name]: documents }))
        setLoaded((current) => new Set(current).add(name))
      },
      (storeError) => setError(storeError.message),
    ))
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [])

  const actions = useMemo(() => {
    const save = async <K extends CollectionName>(name: K, input: Partial<FinanceData[K][number]> & { id?: string }) => {
      const id = input.id || createDocumentId()
      const existing = data[name].find((item) => item.id === id) as BaseDocument | undefined
      const reference = doc(collectionPath(name), id)
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
        transaction.set(reference, documentData, { merge: name !== 'transactions' })
      })
      return id
    }

    const archive = async (name: Exclude<CollectionName, 'transactions'>, id: string, archived: boolean) => {
      const reference = doc(collectionPath(name), id)
      const known = data[name].find((item) => item.id === id) as BaseDocument | undefined
      await runTransaction(db, async (transaction) => {
        const remote = await transaction.get(reference)
        const remoteData = remote.data() as BaseDocument | undefined
        if (!remote.exists()) throw new Error('找不到要封存的資料。')
        if (known && remoteData?.revision !== known.revision) throw new Error('這筆資料已在另一台裝置更新，請重新載入後再修改。')
        transaction.set(reference, { archivedAt: archived ? new Date().toISOString() : deleteField(), updatedAt: new Date().toISOString(), updatedBy: user.uid, revision: (remoteData?.revision ?? 0) + 1 }, { merge: true })
      })
    }

    const voidTransaction = async (id: string, reason = '使用者刪除') => {
      const reference = doc(collectionPath('transactions'), id)
      const known = data.transactions.find((item) => item.id === id)
      await runTransaction(db, async (transaction) => {
        const remote = await transaction.get(reference)
        const remoteData = remote.data() as BaseDocument | undefined
        if (!remote.exists()) throw new Error('找不到要刪除的明細。')
        if (known && remoteData?.revision !== known.revision) throw new Error('這筆明細已在另一台裝置更新，請重新載入後再修改。')
        transaction.set(reference, { voidedAt: new Date().toISOString(), voidReason: reason, updatedAt: new Date().toISOString(), updatedBy: user.uid, revision: (remoteData?.revision ?? 0) + 1 }, { merge: true })
      })
    }

    const seedDemo = async () => {
      const batch = writeBatch(db)
      const demo = buildDemoData()
      for (const name of collectionNames) {
        for (const item of demo[name]) batch.set(doc(collectionPath(name), item.id), clean({ ...item, createdBy: user.uid, updatedBy: user.uid }))
      }
      await batch.commit()
    }

    return { save, archive, voidTransaction, seedDemo }
  }, [data, user.uid])

  return {
    data,
    ready: loaded.size === collectionNames.length,
    error,
    ...actions,
  }
}
