import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { doc, onSnapshot, runTransaction } from 'firebase/firestore'
import { db, householdId } from './firebase.ts'
import { emptyAccountPreferences, type AccountPreferences } from './account-preferences.ts'

type PreferenceDocument = AccountPreferences & {
  uid: string
  schemaVersion: 1
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
  revision: number
}

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function useUserPreferences(user: User) {
  const [value, setValue] = useState<AccountPreferences>(emptyAccountPreferences)
  const [revision, setRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const reference = useMemo(() => doc(db, 'households', householdId, 'userPreferences', user.uid), [user.uid])

  useEffect(() => onSnapshot(
    reference,
    (snapshot) => {
      const data = snapshot.data() as PreferenceDocument | undefined
      setValue(data ? { accountOrder: data.accountOrder ?? [], defaultAccountId: data.defaultAccountId } : emptyAccountPreferences)
      setRevision(data?.revision ?? 0)
      setReady(true)
    },
    (storeError) => {
      setError(storeError.message)
      setReady(true)
    },
  ), [reference])

  const save = async (patch: Partial<AccountPreferences>) => {
    await runTransaction(db, async (transaction) => {
      const remote = await transaction.get(reference)
      const remoteData = remote.data() as PreferenceDocument | undefined
      if (remote.exists() && remoteData?.revision !== revision) throw new Error('你的帳戶排序已在另一台裝置更新，請重新載入後再操作。')
      const timestamp = new Date().toISOString()
      transaction.set(reference, clean({
        accountOrder: remoteData?.accountOrder ?? value.accountOrder,
        ...patch,
        uid: user.uid,
        schemaVersion: 1,
        createdAt: remoteData?.createdAt ?? timestamp,
        updatedAt: timestamp,
        createdBy: remoteData?.createdBy ?? user.uid,
        updatedBy: user.uid,
        revision: (remoteData?.revision ?? 0) + 1,
      }))
    })
  }

  return { value, ready, error, save }
}
