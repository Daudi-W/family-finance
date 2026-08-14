import type { Account } from './types.ts'

export type AccountPreferences = {
  accountOrder: string[]
}

export const emptyAccountPreferences: AccountPreferences = { accountOrder: [] }

export function sortAccountsForUser(accounts: Account[], accountOrder: string[]) {
  const active = accounts
    .filter((account) => !account.archivedAt)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const position = new Map(accountOrder.map((id, index) => [id, index]))
  return active.sort((a, b) => {
    const aPosition = position.get(a.id)
    const bPosition = position.get(b.id)
    if (aPosition === undefined && bPosition === undefined) return 0
    if (aPosition === undefined) return 1
    if (bPosition === undefined) return -1
    return aPosition - bPosition
  })
}

export function preferredAccountId(accounts: Account[], preferences: AccountPreferences, requestedId = '') {
  const sorted = sortAccountsForUser(accounts, preferences.accountOrder)
  if (requestedId && sorted.some((account) => account.id === requestedId)) return requestedId
  return sorted[0]?.id ?? ''
}
