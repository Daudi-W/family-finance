import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { firestoreDocumentData } from '../src/import/firestore-rest.mts'
import { fromMinor } from '../v2/src/finance.ts'

/**
 * 帳本備份：把整個家庭帳本匯出成 JSON（完整還原用）與 CSV（人可直接看，不需要任何程式）。
 * 只讀不寫 Firestore；輸出永遠落在 git 忽略的位置，真實金額不會進版控。
 */
const COLLECTIONS = ['accounts', 'categories', 'projects', 'budgets', 'recurringRules', 'advancePeople', 'txMonths', 'transactions', 'members', 'importBatches']

type AnyDocument = Record<string, unknown> & { id?: string }
type Transaction = AnyDocument & { id: string; kind: string; occurredOn: string }

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? '' }
const projectId = option('--project') || 'family-finance-home-260814'
const householdId = option('--household') || 'family-home'
const outputRoot = option('--out') || join(process.cwd(), 'local', 'backups')
const mirrorRoot = option('--mirror')
const keep = Number(option('--keep') || '12')
if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep 必須是正整數')

const require = createRequire(import.meta.url)
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
const firebaseAuth = require(join(globalRoot, 'firebase-tools/lib/auth.js'))
const cliAccount = firebaseAuth.getProjectDefaultAccount(process.cwd()) ?? firebaseAuth.getGlobalDefaultAccount()
if (!cliAccount?.tokens?.refresh_token) throw new Error('找不到 Firebase CLI 登入憑證，請先執行 firebase login')
const accessToken = async () => (await firebaseAuth.getAccessToken(cliAccount.tokens.refresh_token, [])).access_token as string
const databaseBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`

const listCollection = async (collection: string) => {
  const documents: AnyDocument[] = []
  let pageToken = ''
  do {
    const url = new URL(`${databaseBase}/documents/households/${encodeURIComponent(householdId)}/${encodeURIComponent(collection)}`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetch(url.toString(), { headers: { authorization: `Bearer ${await accessToken()}` } })
    if (response.status === 404) return documents
    const text = await response.text()
    if (!response.ok) throw new Error(`${collection} ${response.status} ${text}`)
    const page = JSON.parse(text)
    for (const item of page.documents ?? []) documents.push(firestoreDocumentData(item.fields ?? {}))
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return documents
}

const ledger: Record<string, AnyDocument[]> = {}
for (const collection of COLLECTIONS) ledger[collection] = await listCollection(collection)

const monthly = ledger.txMonths.flatMap((document) => Object.values((document.items ?? {}) as Record<string, Transaction>))
const transactions = (monthly.length > 0 ? monthly : (ledger.transactions as Transaction[]))
  .slice()
  .sort((left, right) => (left.occurredOn === right.occurredOn ? left.id.localeCompare(right.id) : left.occurredOn.localeCompare(right.occurredOn)))
if (transactions.length === 0) throw new Error('讀不到任何交易，備份中止')

const nameOf = (collection: string) => new Map(ledger[collection].map((item) => [String(item.id), String(item.name ?? '')]))
const accountNames = nameOf('accounts')
const categoryNames = nameOf('categories')
const projectNames = nameOf('projects')
const accountCurrency = new Map(ledger.accounts.map((item) => [String(item.id), String(item.currency ?? 'TWD')]))

const kindLabel: Record<string, string> = { income: '收入', expense: '支出', transfer: '轉帳', advance: '代墊', settlement: '代墊收還款', balance_adjustment: '帳務調整' }

const amountOf = (transaction: Transaction) => {
  const lines = (transaction.reportLines as Array<{ amountMinor?: number; currency?: string; categoryId?: string }> | undefined) ?? []
  const moves = (transaction.accountMoves as Array<{ accountId?: string; currency?: string }> | undefined) ?? []
  const currency = String(lines[0]?.currency ?? moves[0]?.currency ?? accountCurrency.get(String(moves[0]?.accountId ?? '')) ?? 'TWD')
  const transfer = transaction.transfer as { fromAmountMinor?: number } | undefined
  const advance = transaction.advance as { totalMinor?: number } | undefined
  const settlement = transaction.settlement as { amountMinor?: number } | undefined
  const adjustment = transaction.adjustment as { differenceMinor?: number } | undefined
  const minor = transfer?.fromAmountMinor ?? advance?.totalMinor ?? settlement?.amountMinor ?? adjustment?.differenceMinor
    ?? lines.reduce((carry, line) => carry + Number(line.amountMinor ?? 0), 0)
  return { amount: fromMinor(Number(minor ?? 0), currency), currency }
}

const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
const csvRows = [['日期', '類型', '金額', '幣別', '分類', '帳戶', '對方帳戶', '專案', '備註', '狀態', '交易編號'].join(',')]
for (const transaction of transactions) {
  const { amount, currency } = amountOf(transaction)
  const lines = (transaction.reportLines as Array<{ categoryId?: string }> | undefined) ?? []
  const moves = (transaction.accountMoves as Array<{ accountId?: string }> | undefined) ?? []
  const transfer = transaction.transfer as { fromAccountId?: string; toAccountId?: string } | undefined
  csvRows.push([
    transaction.occurredOn,
    kindLabel[transaction.kind] ?? transaction.kind,
    amount,
    currency,
    lines.map((line) => categoryNames.get(String(line.categoryId ?? '')) ?? '').filter(Boolean).join(' / '),
    accountNames.get(String(transfer?.fromAccountId ?? moves[0]?.accountId ?? '')) ?? '',
    transfer ? accountNames.get(String(transfer.toAccountId ?? '')) ?? '' : '',
    projectNames.get(String(transaction.projectId ?? '')) ?? '',
    transaction.note ?? '',
    transaction.voidedAt ? '已作廢' : '有效',
    transaction.id,
  ].map(csvCell).join(','))
}

const stamp = new Date().toISOString().replaceAll(':', '').replace(/\..+/, '').replace('T', '-')
const folderName = `family-finance-${stamp}`
const summary = {
  匯出時間: new Date().toISOString(),
  projectId,
  householdId,
  交易來源: monthly.length > 0 ? 'txMonths（月打包）' : 'transactions（舊結構）',
  筆數: Object.fromEntries(COLLECTIONS.map((collection) => [collection, ledger[collection].length])),
  交易總數: transactions.length,
  日期範圍: `${transactions[0].occurredOn} → ${transactions.at(-1)!.occurredOn}`,
}

const write = async (root: string) => {
  const folder = join(root, folderName)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'ledger.json'), JSON.stringify({ summary, ledger }, null, 2))
  await writeFile(join(folder, 'transactions.csv'), `﻿${csvRows.join('\n')}\n`)
  await writeFile(join(folder, 'summary.json'), JSON.stringify(summary, null, 2))
  const folders = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('family-finance-'))
    .map((entry) => entry.name)
    .sort()
  for (const stale of folders.slice(0, Math.max(0, folders.length - keep))) await rm(join(root, stale), { recursive: true, force: true })
  return folder
}

const primary = await write(outputRoot)
if (mirrorRoot) {
  await mkdir(mirrorRoot, { recursive: true })
  await cp(primary, join(mirrorRoot, folderName), { recursive: true })
}
console.log(JSON.stringify({ ok: true, 備份位置: primary, 副本: mirrorRoot ? join(mirrorRoot, folderName) : '（未設定）', ...summary }, null, 2))
