import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chunks, firestoreFields, type FirestoreDocument } from '../src/import/firestore-rest.mts'

type Mapping = { sourceName: string; accountId: string; type: 'cash' | 'bank' | 'credit_card' | 'investment' | 'receivable'; currency?: string }
type Preview = { accounts: Array<{ name: string; currencies: string[]; activeForNewEntry: boolean }> }
type DryRun = { asOf: string; mappedAccounts: number; categories: Array<Record<string, unknown> & { id: string; archived?: boolean }>; transactions: Array<Record<string, unknown> & { id: string; occurredOn: string; accountMoves: Array<{ accountId: string }> }>; held: unknown[]; heldByReason: Record<string, number> }

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? '' }
const apply = args.includes('--apply')
const projectId = option('--project')
const ownerUid = option('--owner-uid')
const dryRunPath = option('--dry-run')
const previewPath = option('--preview')
const mappingPath = option('--mapping')
const householdId = option('--household') || 'family-home'
if (!projectId || !ownerUid || !dryRunPath || !previewPath || !mappingPath) throw new Error('用法：import-production-firestore.mts --project <projectId> --owner-uid <uid> --dry-run <json> --preview <json> --mapping <json> [--household family-home] [--apply]')
if (/dev|demo/i.test(projectId)) throw new Error('正式匯入工具拒絕寫入 dev／demo 專案')

const [dryRunBuffer, previewBuffer, mappingBuffer] = await Promise.all([readFile(dryRunPath), readFile(previewPath), readFile(mappingPath)])
const dryRun = JSON.parse(dryRunBuffer.toString()) as DryRun
const preview = JSON.parse(previewBuffer.toString()) as Preview
const mappings = JSON.parse(mappingBuffer.toString()) as Mapping[]
if (dryRun.transactions.length === 0 || mappings.length === 0) throw new Error('匯入內容不可為空')
if (dryRun.mappedAccounts !== mappings.length || dryRun.heldByReason.unmapped_account) throw new Error('帳戶對應尚未完成')
if (new Set(dryRun.transactions.map((item) => item.id)).size !== dryRun.transactions.length) throw new Error('交易 ID 有重複')
if (new Set(mappings.map((item) => item.accountId)).size !== mappings.length) throw new Error('帳戶 ID 有重複')

const now = new Date().toISOString()
const digest = createHash('sha256').update(dryRunBuffer).update(previewBuffer).update(mappingBuffer).digest('hex')
const batchId = `legacy-${dryRun.asOf}`
const base = (id: string) => ({ id, schemaVersion: 1, createdAt: now, updatedAt: now, createdBy: ownerUid, updatedBy: ownerUid, revision: 1 })
const previewAccountMap = new Map(preview.accounts.map((item) => [item.name, item]))
const firstDateByAccount = new Map<string, string>()
for (const transaction of dryRun.transactions) for (const move of transaction.accountMoves) {
  const current = firstDateByAccount.get(move.accountId)
  if (!current || transaction.occurredOn < current) firstDateByAccount.set(move.accountId, transaction.occurredOn)
}
const accountIcon = { cash: 'wallet-cards', bank: 'landmark', credit_card: 'credit-card', investment: 'chart-no-axes-combined', receivable: 'hand-coins' } as const
const categoryIcon = (name: string) => {
  const choices: Array<[RegExp, string]> = [
    [/薪水|副業|獎金/, 'briefcase'], [/利息|投資|回饋/, 'coins'], [/飲食/, 'utensils'], [/汽機車/, 'car'], [/交通/, 'train'],
    [/教會|奉獻/, 'church'], [/家用|日常用品|水電瓦斯|電話網路/, 'house'], [/娛樂|旅遊/, 'gamepad-2'], [/醫療|保健/, 'heart-pulse'],
    [/教育|學習|文具/, 'graduation-cap'], [/保險/, 'shield-check'], [/服飾|美容|美髮/, 'shirt'], [/餘額調整/, 'scale'], [/手續費/, 'receipt-text'],
  ]
  return choices.find(([pattern]) => pattern.test(name))?.[1] ?? 'circle-dollar-sign'
}

const accounts: FirestoreDocument[] = mappings.map((mapping, index) => {
  const source = previewAccountMap.get(mapping.sourceName)
  if (!source && !mapping.currency) throw new Error(`沒有交易歷史的帳戶必須在對應表指定幣別：${mapping.sourceName}`)
  const data: Record<string, unknown> = {
    ...base(mapping.accountId), name: mapping.sourceName, type: mapping.type, currency: source?.currencies[0] || mapping.currency || 'TWD', iconKey: accountIcon[mapping.type], sortOrder: index,
    includeInNetWorth: true, openingBalanceMinor: 0, openingDate: firstDateByAccount.get(mapping.accountId) ?? dryRun.asOf,
  }
  if (source && !source.activeForNewEntry) data.archivedAt = now
  return { path: `households/${householdId}/accounts/${mapping.accountId}`, data }
})
const categories: FirestoreDocument[] = dryRun.categories.map((category) => {
  const { archived, ...input } = category
  const data: Record<string, unknown> = { ...base(category.id), ...input, iconKey: categoryIcon(String(category.name ?? '')) }
  if (archived) data.archivedAt = now
  return { path: `households/${householdId}/categories/${category.id}`, data }
})
const transactions: FirestoreDocument[] = dryRun.transactions.map((transaction) => ({ path: `households/${householdId}/transactions/${transaction.id}`, data: { ...base(transaction.id), ...transaction } }))
const expected = { accounts: accounts.length, categories: categories.length, transactions: transactions.length, members: 1 }
const marker = (status: 'importing' | 'complete') => ({ ...base(batchId), status, digest, source: '天天記帳', sourceAsOf: dryRun.asOf, expected, held: dryRun.held.length })
const bootstrap: FirestoreDocument[] = [
  { path: `households/${householdId}`, data: { ...base(householdId), name: '家庭帳本', ownerUid } },
  { path: `households/${householdId}/members/${ownerUid}`, data: { ...base(ownerUid), role: 'owner' } },
  { path: `households/${householdId}/importBatches/${batchId}`, data: marker('importing') },
]
const documents = [...bootstrap, ...accounts, ...categories, ...transactions]
console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', projectId, householdId, batchId, digest: digest.slice(0, 12), expected, held: dryRun.held.length, documentWrites: documents.length }, null, 2))
if (!apply) process.exit(0)

const require = createRequire(import.meta.url)
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
const firebaseAuth = require(join(globalRoot, 'firebase-tools/lib/auth.js'))
const cliAccount = firebaseAuth.getProjectDefaultAccount(process.cwd()) ?? firebaseAuth.getGlobalDefaultAccount()
if (!cliAccount?.tokens?.refresh_token) throw new Error('找不到 Firebase CLI 登入憑證')
const accessToken = async () => (await firebaseAuth.getAccessToken(cliAccount.tokens.refresh_token, [])).access_token as string
const databaseResource = `projects/${projectId}/databases/(default)`
const databaseBase = `https://firestore.googleapis.com/v1/${databaseResource}`
const documentName = (path: string) => `${databaseResource}/documents/${path.split('/').map(encodeURIComponent).join('/')}`
const documentUrl = (path: string) => `${databaseBase}/documents/${path.split('/').map(encodeURIComponent).join('/')}`
const request = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${text}`)
  return text ? JSON.parse(text) : {}
}
const markerPath = `households/${householdId}/importBatches/${batchId}`
const markerUrl = documentUrl(markerPath)
const existingMarkerResponse = await fetch(markerUrl, { headers: { authorization: `Bearer ${await accessToken()}` } })
if (existingMarkerResponse.ok) {
  const existingMarker = await existingMarkerResponse.json()
  const existingDigest = existingMarker.fields?.digest?.stringValue
  if (existingDigest !== digest) throw new Error('production 已有不同內容的匯入批次，停止覆寫')
} else if (existingMarkerResponse.status !== 404) throw new Error(`${existingMarkerResponse.status} ${await existingMarkerResponse.text()}`)
else {
  const householdResponse = await fetch(documentUrl(`households/${householdId}`), { headers: { authorization: `Bearer ${await accessToken()}` } })
  if (householdResponse.status !== 404) throw new Error('production 家庭帳本已存在但沒有相符匯入批次，停止寫入')
}
for (const group of chunks(documents, 400)) {
  await request(`${databaseBase}/documents:batchWrite`, { method: 'POST', body: JSON.stringify({ writes: group.map((item) => ({ update: { name: documentName(item.path), fields: firestoreFields(item.data) } })) }) })
  console.log(`已寫入 ${Math.min(documents.length, documents.indexOf(group.at(-1)!) + 1)} / ${documents.length}`)
}
const countCollection = async (collection: string) => {
  let count = 0
  let pageToken = ''
  do {
    const url = new URL(`${databaseBase}/documents/households/${encodeURIComponent(householdId)}/${encodeURIComponent(collection)}`)
    url.searchParams.set('pageSize', '1000')
    url.searchParams.append('mask.fieldPaths', '__name__')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const page = await request(url.toString())
    count += page.documents?.length ?? 0
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return count
}
const actual = { accounts: await countCollection('accounts'), categories: await countCollection('categories'), transactions: await countCollection('transactions'), members: await countCollection('members') }
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`匯入後筆數不符：${JSON.stringify({ expected, actual })}`)
await request(`${databaseBase}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: [{ update: { name: documentName(markerPath), fields: firestoreFields({ ...marker('complete'), actual, completedAt: new Date().toISOString() }) } }] }) })
console.log(JSON.stringify({ ok: true, expected, actual, held: dryRun.held.length }, null, 2))
