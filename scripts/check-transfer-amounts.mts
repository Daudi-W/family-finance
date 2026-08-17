import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { firestoreDocumentData } from '../src/import/firestore-rest.mts'
import { fromMinor } from '../v2/src/finance.ts'

/**
 * 找出「轉出金額與轉入金額對不起來」的同幣別轉帳。
 *
 * 成因：編輯同幣別轉帳時，畫面上沒有「轉入金額」欄位，但草稿仍沿用編輯前的舊值，
 * 一改金額就寫成轉出 A、轉入 B。結果是帳戶餘額與日期檢視顯示的金額不一致，
 * 而且兩個帳戶之間憑空多出或少掉錢。
 *
 * 這支腳本**只讀不寫**。輸出落在 git 忽略的 local/，真實金額不會進版控。
 * 要實際修正請加 --apply，並且務必先跑 export-firestore-backup.mts 備份。
 */
type AnyDocument = Record<string, unknown> & { id?: string }
type Transfer = { fromAccountId?: string; toAccountId?: string; fromAmountMinor?: number; toAmountMinor?: number; feeMinor?: number }
type Move = { accountId?: string; deltaMinor?: number; currency?: string }
type Transaction = AnyDocument & { id: string; kind: string; occurredOn: string; transfer?: Transfer; accountMoves?: Move[]; voidedAt?: string }

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? '' }
const apply = args.includes('--apply')
const projectId = option('--project') || 'family-finance-home-260814'
const householdId = option('--household') || 'family-home'
const outputRoot = option('--out') || join(process.cwd(), 'local', 'checks')

const require = createRequire(import.meta.url)
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
const firebaseAuth = require(join(globalRoot, 'firebase-tools/lib/auth.js'))
const cliAccount = firebaseAuth.getProjectDefaultAccount(process.cwd()) ?? firebaseAuth.getGlobalDefaultAccount()
if (!cliAccount?.tokens?.refresh_token) throw new Error('找不到 Firebase CLI 登入憑證，請先執行 firebase login')
const accessToken = async () => (await firebaseAuth.getAccessToken(cliAccount.tokens.refresh_token, [])).access_token as string
const databaseBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`

const listCollection = async (collection: string) => {
  const documents: (AnyDocument & { __name?: string })[] = []
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
    for (const item of page.documents ?? []) documents.push({ ...firestoreDocumentData(item.fields ?? {}), __name: String(item.name).split('/').pop() })
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return documents
}

const accounts = await listCollection('accounts')
const accountName = new Map(accounts.map((item) => [String(item.id), String(item.name ?? '')]))
const accountCurrency = new Map(accounts.map((item) => [String(item.id), String(item.currency ?? 'TWD').toUpperCase()]))
const accountType = new Map(accounts.map((item) => [String(item.id), String(item.type ?? '')]))

const months = await listCollection('txMonths')
const findings: {
  monthDocument: string
  id: string
  occurredOn: string
  note: string
  fromAccount: string
  toAccount: string
  currency: string
  fromAmount: number
  toAmount: number
  差額: number
}[] = []

for (const month of months) {
  const items = (month.items ?? {}) as Record<string, Transaction>
  for (const [id, transaction] of Object.entries(items)) {
    if (transaction.kind !== 'transfer' || transaction.voidedAt) continue
    const transfer = transaction.transfer
    if (!transfer) continue
    const fromId = String(transfer.fromAccountId ?? '')
    const toId = String(transfer.toAccountId ?? '')
    const fromCurrency = accountCurrency.get(fromId) ?? 'TWD'
    const toCurrency = accountCurrency.get(toId) ?? 'TWD'
    if (fromCurrency !== toCurrency) continue
    const fromAmount = Number(transfer.fromAmountMinor ?? 0)
    const toAmount = Number(transfer.toAmountMinor ?? 0)
    if (fromAmount === toAmount) continue
    findings.push({
      monthDocument: String(month.__name ?? ''),
      id,
      occurredOn: transaction.occurredOn,
      note: String(transaction.note ?? ''),
      fromAccount: accountName.get(fromId) ?? fromId,
      toAccount: accountName.get(toId) ?? toId,
      currency: fromCurrency,
      fromAmount: fromMinor(fromAmount, fromCurrency),
      toAmount: fromMinor(toAmount, toCurrency),
      差額: fromMinor(toAmount - fromAmount, toCurrency),
    })
  }
}

findings.sort((left, right) => left.occurredOn.localeCompare(right.occurredOn))
const total = findings.reduce((sum, item) => sum + item.差額, 0)

console.log(`專案：${projectId} / ${householdId}`)
console.log(`同幣別轉帳兩邊金額對不起來：${findings.length} 筆，轉入端合計多出 ${total}`)
for (const item of findings) {
  console.log(`  ${item.occurredOn}  ${item.note || '(無備註)'}  ${item.fromAccount} → ${item.toAccount}  轉出 ${item.fromAmount} / 轉入 ${item.toAmount}（差 ${item.差額}）`)
}

await mkdir(outputRoot, { recursive: true })
const reportPath = join(outputRoot, `transfer-amount-mismatch-${new Date().toISOString().replaceAll(':', '').replace(/\..+/, '')}.json`)
await writeFile(reportPath, JSON.stringify({ projectId, householdId, 檢查時間: new Date().toISOString(), 筆數: findings.length, findings }, null, 2))
console.log(`\n完整清單：${reportPath}`)

if (!apply) {
  console.log('\n這是預覽，沒有修改任何資料。確認清單無誤後，加 --apply 才會實際修正。')
  process.exit(0)
}

console.log('\n開始修正：以「轉出金額」為準，把轉入金額與轉入帳戶的異動一起校正。')
let fixed = 0
for (const finding of findings) {
  const month = months.find((item) => item.__name === finding.monthDocument)
  const transaction = ((month?.items ?? {}) as Record<string, Transaction>)[finding.id]
  if (!transaction?.transfer) continue
  const fromAmountMinor = Number(transaction.transfer.fromAmountMinor ?? 0)
  const toId = String(transaction.transfer.toAccountId ?? '')
  const isCreditCard = accountType.get(toId) === 'credit_card'
  const moves = (transaction.accountMoves ?? []).map((move) =>
    String(move.accountId) === toId ? { ...move, deltaMinor: isCreditCard ? -fromAmountMinor : fromAmountMinor } : move)
  const next = { ...transaction, transfer: { ...transaction.transfer, toAmountMinor: fromAmountMinor }, accountMoves: moves }

  const url = `${databaseBase}/documents/households/${encodeURIComponent(householdId)}/txMonths/${encodeURIComponent(finding.monthDocument)}`
  const readResponse = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } })
  if (!readResponse.ok) throw new Error(`讀取 ${finding.monthDocument} 失敗：${readResponse.status}`)
  const document = await readResponse.json()
  const current = firestoreDocumentData(document.fields ?? {}) as { items?: Record<string, Transaction> }
  if (!current.items?.[finding.id]) { console.log(`  略過 ${finding.id}：文件已變動`); continue }
  current.items[finding.id] = next as Transaction

  const encode = (value: unknown): unknown => {
    if (value === null || value === undefined) return { nullValue: null }
    if (typeof value === 'string') return { stringValue: value }
    if (typeof value === 'boolean') return { booleanValue: value }
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
    return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encode(item)])) } }
  }
  const writeResponse = await fetch(`${url}?updateMask.fieldPaths=items`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { items: encode(current.items) } }),
  })
  if (!writeResponse.ok) throw new Error(`寫入 ${finding.monthDocument} 失敗：${writeResponse.status} ${await writeResponse.text()}`)
  fixed += 1
  console.log(`  已修正 ${finding.occurredOn} ${finding.note || finding.id}：轉入改為 ${finding.fromAmount}`)
}
console.log(`\n完成，共修正 ${fixed} 筆。請重新開啟 App 確認帳戶餘額。`)
