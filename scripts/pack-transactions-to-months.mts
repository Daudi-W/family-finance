import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { chunks, firestoreDocumentData, firestoreFields, type FirestoreDocument } from '../src/import/firestore-rest.mts'
import { MAX_ITEMS_PER_SHARD, monthIdOf, shardIdOf } from '../v2/src/tx-months.ts'

/**
 * 把「一筆交易一份文件」的 transactions 集合，改打包成「一個月一份文件」的 txMonths。
 * 來源集合完全不動，保留作為還原點；重跑會合併而不是覆蓋，可在部署後再跑一次補漏。
 */
type Transaction = Record<string, unknown> & { id: string; occurredOn: string; revision?: number }

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? '' }
const apply = args.includes('--apply')
const projectId = option('--project')
const householdId = option('--household') || 'family-home'
if (!projectId) throw new Error('用法：pack-transactions-to-months.mts --project <projectId> [--household family-home] [--apply]')

const require = createRequire(import.meta.url)
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
const firebaseAuth = require(join(globalRoot, 'firebase-tools/lib/auth.js'))
const cliAccount = firebaseAuth.getProjectDefaultAccount(process.cwd()) ?? firebaseAuth.getGlobalDefaultAccount()
if (!cliAccount?.tokens?.refresh_token) throw new Error('找不到 Firebase CLI 登入憑證')
const accessToken = async () => (await firebaseAuth.getAccessToken(cliAccount.tokens.refresh_token, [])).access_token as string
const databaseResource = `projects/${projectId}/databases/(default)`
const databaseBase = `https://firestore.googleapis.com/v1/${databaseResource}`
const documentName = (path: string) => `${databaseResource}/documents/${path.split('/').map(encodeURIComponent).join('/')}`
const request = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${text}`)
  return text ? JSON.parse(text) : {}
}

const listCollection = async (collection: string) => {
  const documents: Array<Record<string, unknown>> = []
  let pageToken = ''
  do {
    const url = new URL(`${databaseBase}/documents/households/${encodeURIComponent(householdId)}/${encodeURIComponent(collection)}`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const page = await request(url.toString())
    for (const item of page.documents ?? []) documents.push(firestoreDocumentData(item.fields ?? {}))
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return documents
}

/** 核對用指紋：筆數與金額總和，任何一筆遺漏或被改動都會讓數字對不起來。 */
const fingerprint = (items: Transaction[]) => {
  let moves = 0
  let lines = 0
  for (const item of items) {
    for (const move of (item.accountMoves as Array<{ deltaMinor?: number }> | undefined) ?? []) moves += Number(move.deltaMinor ?? 0)
    for (const line of (item.reportLines as Array<{ amountMinor?: number }> | undefined) ?? []) lines += Number(line.amountMinor ?? 0)
  }
  return { count: items.length, moves, lines }
}

const source = (await listCollection('transactions')) as Transaction[]
if (source.length === 0) throw new Error('來源 transactions 集合是空的，停止搬遷')
const missingId = source.find((item) => !item.id || !item.occurredOn)
if (missingId) throw new Error('來源交易缺少 id 或 occurredOn，停止搬遷')
if (new Set(source.map((item) => item.id)).size !== source.length) throw new Error('來源交易 ID 有重複，停止搬遷')

const existing = (await listCollection('txMonths')) as Array<{ id: string; month: string; items?: Record<string, Transaction> }>
const packed = new Map<string, Record<string, Transaction>>()
for (const document of existing) packed.set(document.id, { ...(document.items ?? {}) })

const shardOwnerOf = (transactionId: string) => {
  for (const [shardId, items] of packed) if (items[transactionId]) return shardId
  return ''
}

let added = 0
let refreshed = 0
for (const transaction of source) {
  const month = monthIdOf(transaction.occurredOn)
  const owner = shardOwnerOf(transaction.id)
  if (owner) {
    const current = packed.get(owner)![transaction.id]
    if (Number(current.revision ?? 0) >= Number(transaction.revision ?? 0)) continue
    packed.get(owner)![transaction.id] = transaction
    refreshed += 1
    continue
  }
  let shardId = ''
  for (let position = 0; position < 1000 && !shardId; position += 1) {
    const candidate = shardIdOf(month, position)
    const items = packed.get(candidate)
    if (!items) packed.set(candidate, {})
    if (Object.keys(packed.get(candidate)!).length < MAX_ITEMS_PER_SHARD) shardId = candidate
  }
  if (!shardId) throw new Error(`${month} 的交易分片已達上限`)
  packed.get(shardId)![transaction.id] = transaction
  added += 1
}

const now = new Date().toISOString()
const shardIds = [...packed.keys()].sort()
const documents: FirestoreDocument[] = shardIds.map((shardId) => {
  const items = packed.get(shardId)!
  const data = { id: shardId, month: shardId.slice(0, 7), schemaVersion: 1, items, updatedAt: now, updatedBy: 'migration' }
  return { path: `households/${householdId}/txMonths/${shardId}`, data }
})
const largest = documents.reduce((carry, item) => Math.max(carry, JSON.stringify(item.data).length), 0)
if (largest > 900_000) throw new Error(`單份月文件過大（${largest} bytes），請降低分片門檻後重試`)

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  projectId,
  householdId,
  來源交易: source.length,
  既有月文件: existing.length,
  將寫入月文件: documents.length,
  新增交易: added,
  更新交易: refreshed,
  最大月文件KB: Math.round(largest / 1024),
  每月筆數: Object.fromEntries(shardIds.map((shardId) => [shardId, Object.keys(packed.get(shardId)!).length])),
}, null, 2))
if (!apply) process.exit(0)

for (const group of chunks(documents, 8)) {
  await request(`${databaseBase}/documents:batchWrite`, { method: 'POST', body: JSON.stringify({ writes: group.map((item) => ({ update: { name: documentName(item.path), fields: firestoreFields(item.data) } })) }) })
}

const written = (await listCollection('txMonths')) as Array<{ id: string; items?: Record<string, Transaction> }>
const writtenTransactions = written.flatMap((document) => Object.values(document.items ?? {}))
const sourceFingerprint = fingerprint(source)
const writtenFingerprint = fingerprint(writtenTransactions)
const sourceIds = new Set(source.map((item) => item.id))
const missing = [...sourceIds].filter((id) => !writtenTransactions.some((item) => item.id === id))
if (missing.length > 0) throw new Error(`搬遷後有 ${missing.length} 筆交易不見了：${missing.slice(0, 5).join(', ')}`)
if (new Set(writtenTransactions.map((item) => item.id)).size !== writtenTransactions.length) throw new Error('搬遷後有重複交易')
if (writtenFingerprint.count < sourceFingerprint.count) throw new Error(`搬遷後筆數變少：${JSON.stringify({ sourceFingerprint, writtenFingerprint })}`)
if (writtenFingerprint.moves !== sourceFingerprint.moves || writtenFingerprint.lines !== sourceFingerprint.lines) {
  throw new Error(`搬遷後金額總和不符：${JSON.stringify({ sourceFingerprint, writtenFingerprint })}`)
}
console.log(JSON.stringify({ ok: true, 月文件: written.length, 來源: sourceFingerprint, 搬遷後: writtenFingerprint }, null, 2))
