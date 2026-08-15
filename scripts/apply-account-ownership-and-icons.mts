import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { firestoreDocumentData, firestoreFields } from '../src/import/firestore-rest.mts'

/**
 * 一次性整理：
 * 1. 帳戶「歸屬」依名稱前綴自動填（我的／另一半的），前綴由參數指定，沒對到的一律維持共用。
 * 2. 分類圖示改用擴充後的圖示庫，讓相近分類不再共用同一個預設錢幣圖示。
 *
 * 預設只預覽，加 --apply 才寫入。帳戶名稱、金額與交易完全不動，只改 ownerUid 與 iconKey。
 */
type Document = Record<string, unknown> & { id: string; name?: string }

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? '' }
const apply = args.includes('--apply')
const projectId = option('--project')
const householdId = option('--household') || 'family-home'
const minePrefix = option('--mine')
const partnerPrefix = option('--partner')
const mineUid = option('--mine-uid')
const partnerUid = option('--partner-uid')
if (!projectId) throw new Error('用法：apply-account-ownership-and-icons.mts --project <projectId> --mine <前綴> --mine-uid <uid> --partner <前綴> --partner-uid <uid> [--apply]')
if ((minePrefix && !mineUid) || (partnerPrefix && !partnerUid)) throw new Error('指定前綴時必須同時指定對應的 uid')

/** 圖示規則：先比對到的先套用，順序有意義（例如「代收/付」要排在「代收」前面）。 */
const iconRules: Array<[RegExp, string]> = [
  [/薪水/, 'briefcase'], [/副業/, 'laptop'], [/獎金/, 'award'], [/利息/, 'piggy-bank'], [/投資/, 'trending-up'],
  [/回饋/, 'ticket-percent'], [/補助/, 'hand-heart'], [/禮金/, 'gift'],
  [/代收\s*\/\s*付|代付/, 'arrow-left-right'], [/代收/, 'inbox'], [/還款/, 'rotate-ccw'], [/借款/, 'banknote'],
  [/飲食/, 'utensils'], [/定期費用/, 'calendar-clock'], [/水電瓦斯/, 'plug-zap'], [/電話|網路/, 'wifi'],
  [/日常用品/, 'shopping-basket'], [/家用/, 'house'], [/娛樂|旅遊/, 'ferris-wheel'],
  [/醫療|保健/, 'heart-pulse'], [/保險/, 'shield-check'], [/汽機車/, 'car'], [/交通/, 'train'],
  [/學習|文具/, 'pencil-ruler'], [/教育/, 'graduation-cap'], [/美容|美髮/, 'scissors'], [/服飾/, 'shirt'],
  [/孝親/, 'person-standing'], [/寵物/, 'paw-print'], [/交際|應酬/, 'beer'],
  [/教會/, 'church'], [/奉獻/, 'hand-coins'], [/餘額調整|帳務調整/, 'scale'], [/手續費/, 'receipt-text'],
  [/非經常性/, 'circle-ellipsis'],
]
const iconFor = (name: string) => iconRules.find(([pattern]) => pattern.test(name))?.[1] ?? 'circle-dollar-sign'

/** 圖示鍵一定要真的在前端圖示庫裡，否則畫面會退回預設錢幣。 */
const libraryKeys = new Set([...readFileSync(new URL('../v2/src/icons.tsx', import.meta.url), 'utf8').matchAll(/^ {2}'?([a-z0-9-]+)'?:/gm)].map((match) => match[1]))
const missing = [...new Set(iconRules.map(([, key]) => key))].filter((key) => !libraryKeys.has(key))
if (missing.length) throw new Error(`圖示庫沒有這些鍵：${missing.join(', ')}`)

const require = createRequire(import.meta.url)
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
const firebaseAuth = require(join(globalRoot, 'firebase-tools/lib/auth.js'))
const cliAccount = firebaseAuth.getProjectDefaultAccount(process.cwd()) ?? firebaseAuth.getGlobalDefaultAccount()
if (!cliAccount?.tokens?.refresh_token) throw new Error('找不到 Firebase CLI 登入憑證，請先執行 firebase login')
const accessToken = async () => (await firebaseAuth.getAccessToken(cliAccount.tokens.refresh_token, [])).access_token as string
const databaseBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`
const request = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${text}`)
  return text ? JSON.parse(text) : {}
}

const listCollection = async (collection: string) => {
  const documents: Document[] = []
  let pageToken = ''
  do {
    const url = new URL(`${databaseBase}/documents/households/${encodeURIComponent(householdId)}/${encodeURIComponent(collection)}`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const page = await request(url.toString())
    for (const item of page.documents ?? []) documents.push(firestoreDocumentData(item.fields ?? {}) as Document)
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return documents
}

const members = await listCollection('members')
const memberIds = new Set(members.map((member) => member.id))
for (const [label, uid] of [['--mine-uid', mineUid], ['--partner-uid', partnerUid]] as const) {
  if (uid && !memberIds.has(uid)) throw new Error(`${label} 不是這個家庭的成員：${uid}`)
}
const actorUid = mineUid || members.find((member) => member.role === 'owner')?.id
if (!actorUid) throw new Error('找不到可用來記錄 updatedBy 的成員 uid')

const accounts = await listCollection('accounts')
const categories = await listCollection('categories')
const now = new Date().toISOString()

const ownershipFor = (name: string) => {
  if (minePrefix && name.startsWith(minePrefix)) return mineUid
  if (partnerPrefix && name.startsWith(partnerPrefix)) return partnerUid
  return ''
}

type Change = { path: string; fields: Record<string, unknown>; label: string }
const changes: Change[] = []
const accountPlan: Array<Record<string, string>> = []
for (const account of accounts) {
  const name = String(account.name ?? '')
  const target = ownershipFor(name)
  const current = String(account.ownerUid ?? '')
  const owner = target === mineUid && target ? '我的' : target === partnerUid && target ? '另一半的' : '共用'
  accountPlan.push({ 帳戶: name, 歸屬: owner, 狀態: current === target ? '不變' : '更新' })
  if (current === target) continue
  changes.push({
    path: `households/${householdId}/accounts/${account.id}`,
    fields: { ownerUid: target || null, updatedAt: now, updatedBy: actorUid, revision: Number(account.revision ?? 1) + 1 },
    label: `帳戶歸屬 ${name} → ${owner}`,
  })
}

const categoryPlan: Array<Record<string, string>> = []
for (const category of categories) {
  const name = String(category.name ?? '')
  const target = iconFor(name)
  const current = String(category.iconKey ?? '')
  categoryPlan.push({ 分類: name, 原圖示: current, 新圖示: target, 狀態: current === target ? '不變' : '更新' })
  if (current === target) continue
  changes.push({
    path: `households/${householdId}/categories/${category.id}`,
    fields: { iconKey: target, updatedAt: now, updatedBy: actorUid, revision: Number(category.revision ?? 1) + 1 },
    label: `分類圖示 ${name}：${current} → ${target}`,
  })
}

console.table(accountPlan)
console.table(categoryPlan)
console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  projectId, householdId,
  帳戶總數: accounts.length,
  帳戶待更新: accountPlan.filter((row) => row.狀態 === '更新').length,
  分類總數: categories.length,
  分類待更新: categoryPlan.filter((row) => row.狀態 === '更新').length,
}, null, 2))

if (!apply) {
  console.log('（預覽模式，未寫入。確認後加 --apply）')
  process.exit(0)
}

for (const change of changes) {
  const url = new URL(`${databaseBase}/documents/${change.path.split('/').map(encodeURIComponent).join('/')}`)
  for (const key of Object.keys(change.fields)) url.searchParams.append('updateMask.fieldPaths', key)
  await request(url.toString(), { method: 'PATCH', body: JSON.stringify({ fields: firestoreFields(change.fields) }) })
}

const verifyAccounts = await listCollection('accounts')
const verifyCategories = await listCollection('categories')
const badAccounts = verifyAccounts.filter((account) => String(account.ownerUid ?? '') !== ownershipFor(String(account.name ?? '')))
const badCategories = verifyCategories.filter((category) => String(category.iconKey ?? '') !== iconFor(String(category.name ?? '')))
console.log(JSON.stringify({ ok: badAccounts.length === 0 && badCategories.length === 0, 已寫入: changes.length, 帳戶核對失敗: badAccounts.length, 分類核對失敗: badCategories.length }, null, 2))
if (badAccounts.length || badCategories.length) process.exit(1)
