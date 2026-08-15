import type { FinanceTransaction } from './types.ts'

/**
 * 同步狀態的顯示模型。
 *
 * 資料來源有兩個，各自補對方的不足：
 * - `hasPendingWrites`：Firestore SDK 自己回報「本機還有變更沒送上雲端」。
 *   它由 SDK 的待送佇列推導而來，重新整理頁面後依然準確，但只到「文件」層級，
 *   說不出是哪一筆交易。
 * - `session`：這次開啟 App 期間，我們自己記下寫過哪幾筆。有交易的細節可以顯示，
 *   但重新整理就會忘記。
 *
 * 兩者合起來：有細節就顯示細節，重新整理後細節沒了，至少還能誠實告訴使用者
 * 「還有變更在等上傳」，而不是假裝已經同步完成。
 */
export type SessionSyncState = Map<string, string | null>

export type SyncStatus = {
  /** 頂端徽章要顯示的數字；0 代表不顯示徽章 */
  badgeCount: number
  /** 已寫入本機、正在等待送出的交易 */
  queued: FinanceTransaction[]
  /** 送出後真的失敗、需要手動重試的交易 */
  failed: Array<{ transaction: FinanceTransaction | undefined; id: string; message: string }>
  /** SDK 說還有東西沒上傳，但這次開啟期間沒有細節可對應（通常是重新整理過） */
  hasUnknownPending: boolean
}

export function describeSyncStatus(
  session: SessionSyncState,
  hasPendingWrites: boolean,
  transactions: FinanceTransaction[],
): SyncStatus {
  const byId = new Map(transactions.map((item) => [item.id, item]))
  const queued: FinanceTransaction[] = []
  const failed: SyncStatus['failed'] = []

  for (const [id, message] of session) {
    if (message === null) {
      const transaction = byId.get(id)
      if (transaction) queued.push(transaction)
      continue
    }
    failed.push({ id, transaction: byId.get(id), message })
  }

  queued.sort((left, right) => (
    left.occurredOn === right.occurredOn ? left.id.localeCompare(right.id) : left.occurredOn.localeCompare(right.occurredOn)
  ))

  // SDK 說還有變更待上傳，但這次開啟期間沒有對應的細節可以列出來
  const hasUnknownPending = hasPendingWrites && queued.length === 0 && failed.length === 0
  const badgeCount = queued.length + failed.length + (hasUnknownPending ? 1 : 0)

  return { badgeCount, queued, failed, hasUnknownPending }
}
