import type { Account } from './types.ts'

export type AccountPreferences = {
  accountOrder: string[]
}

export const emptyAccountPreferences: AccountPreferences = { accountOrder: [] }

/** 歸屬分組：自己的排最前，其次共用，最後才是另一半的。 */
function ownershipRank(account: Account, currentUid: string) {
  if (!account.ownerUid) return 1
  return account.ownerUid === currentUid ? 0 : 2
}

export function sortAccountsForUser(accounts: Account[], accountOrder: string[], currentUid = '') {
  const active = accounts
    .filter((account) => !account.archivedAt)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const position = new Map(accountOrder.map((id, index) => [id, index]))
  return active.sort((a, b) => {
    const ownership = ownershipRank(a, currentUid) - ownershipRank(b, currentUid)
    if (ownership !== 0) return ownership
    const aPosition = position.get(a.id)
    const bPosition = position.get(b.id)
    if (aPosition === undefined && bPosition === undefined) return 0
    if (aPosition === undefined) return 1
    if (bPosition === undefined) return -1
    return aPosition - bPosition
  })
}

export function preferredAccountId(accounts: Account[], preferences: AccountPreferences, requestedId = '', currentUid = '') {
  const sorted = sortAccountsForUser(accounts, preferences.accountOrder, currentUid)
  if (requestedId && sorted.some((account) => account.id === requestedId)) return requestedId
  return sorted[0]?.id ?? ''
}
