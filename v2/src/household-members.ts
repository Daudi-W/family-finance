import { useEffect, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db, householdId } from './firebase.ts'

export type HouseholdMember = {
  id: string
  role?: string
}

/**
 * 家庭成員名單（只有兩三筆，讀取成本可忽略）。
 * 用來讓帳戶設定的「歸屬」可以指定給另一位成員。
 */
export function useHouseholdMembers(user: User) {
  const [members, setMembers] = useState<HouseholdMember[]>([])
  useEffect(() => onSnapshot(
    collection(db, 'households', householdId, 'members'),
    (snapshot) => setMembers(snapshot.docs.map((item) => ({ ...(item.data() as Omit<HouseholdMember, 'id'>), id: item.id }))),
    () => setMembers([]),
  ), [])
  return {
    members,
    /** 另一位成員；對方還沒第一次登入時為空字串。 */
    partnerUid: members.find((member) => member.id !== user.uid)?.id ?? '',
  }
}
