import type { FinanceTransaction } from './types.ts'

/**
 * 交易以「一個月一份文件」保存於 households/{id}/txMonths。
 * 文件內的 items 是「交易編號 → 交易內容」的對照表，寫入時只更新自己那一格，
 * 兩台裝置同時改同一個月的不同交易不會互相覆蓋。
 */
export type TxMonthDocument = {
  id: string
  month: string
  schemaVersion: 1
  items: Record<string, FinanceTransaction>
  updatedAt: string
  updatedBy: string
}

/**
 * 單份文件的交易數上限。Firestore 單一文件硬上限 1MB，實測單筆約 0.5KB，
 * 800 筆約 0.4MB，仍有一倍以上餘裕；超過就自動開下一個分片，不會寫不進去。
 */
export const MAX_ITEMS_PER_SHARD = 800

const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/
const SHARD_PATTERN = /^(\d{4}-(?:0[1-9]|1[0-2]))(?:-s(\d+))?$/

export function monthIdOf(occurredOn: string) {
  const month = String(occurredOn ?? '').slice(0, 7)
  if (!MONTH_PATTERN.test(month)) throw new Error(`交易日期格式不正確：${occurredOn}`)
  return month
}

export function shardIdOf(month: string, index: number) {
  if (!MONTH_PATTERN.test(month)) throw new Error(`月份格式不正確：${month}`)
  if (!Number.isInteger(index) || index < 0) throw new Error('分片序號必須是非負整數')
  return index === 0 ? month : `${month}-s${index + 1}`
}

export function parseShardId(id: string) {
  const matched = SHARD_PATTERN.exec(String(id ?? ''))
  if (!matched) return null
  const index = matched[2] ? Number(matched[2]) - 1 : 0
  if (index < 0) return null
  return { month: matched[1], index }
}

/** 把多份月文件攤平回 App 一直在用的交易陣列，順序固定為日期、再交易編號。 */
export function flattenMonths(documents: TxMonthDocument[]): FinanceTransaction[] {
  const transactions: FinanceTransaction[] = []
  for (const document of documents) {
    for (const item of Object.values(document.items ?? {})) if (item?.id) transactions.push(item)
  }
  return transactions.sort((left, right) => (
    left.occurredOn === right.occurredOn ? left.id.localeCompare(right.id) : left.occurredOn.localeCompare(right.occurredOn)
  ))
}

export type ShardIndex = {
  shardIdByTransactionId: Map<string, string>
  countByShardId: Map<string, number>
}

export function indexShards(documents: TxMonthDocument[]): ShardIndex {
  const shardIdByTransactionId = new Map<string, string>()
  const countByShardId = new Map<string, number>()
  for (const document of documents) {
    const ids = Object.keys(document.items ?? {})
    countByShardId.set(document.id, ids.length)
    for (const id of ids) shardIdByTransactionId.set(id, document.id)
  }
  return { shardIdByTransactionId, countByShardId }
}

/**
 * 決定一筆交易該寫進哪一份文件：
 * 已存在就寫回原本那份（同月編輯不搬家），否則找同月還有空間的分片，都滿了才開新分片。
 */
export type TransactionWritePlan = {
  /** 這筆要寫進哪一份月文件 */
  targetShardId: string
  /** 目標文件在本機還沒看過，需要用 merge 建立而不是更新 */
  createTarget: boolean
  /** 改了日期而跨月時，要從這一份移除舊的那一格 */
  removeFromShardId: string
}

/** 算出一筆交易的寫入計畫；純計算，方便單獨測試與在模擬器上重現。 */
export function planTransactionWrite(index: ShardIndex, occurredOn: string, transactionId: string): TransactionWritePlan {
  const month = monthIdOf(occurredOn)
  const targetShardId = pickShardForWrite(index, month, transactionId)
  const previousShardId = index.shardIdByTransactionId.get(transactionId) ?? ''
  return {
    targetShardId,
    createTarget: !index.countByShardId.has(targetShardId),
    removeFromShardId: previousShardId && previousShardId !== targetShardId ? previousShardId : '',
  }
}

export function pickShardForWrite(index: ShardIndex, month: string, transactionId: string, limit = MAX_ITEMS_PER_SHARD) {
  const current = index.shardIdByTransactionId.get(transactionId)
  if (current && parseShardId(current)?.month === month) return current
  for (let position = 0; position < 1000; position += 1) {
    const candidate = shardIdOf(month, position)
    if ((index.countByShardId.get(candidate) ?? 0) < limit) return candidate
  }
  throw new Error(`${month} 的交易分片已達上限`)
}
