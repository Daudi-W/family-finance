import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { firestoreFields } from '../src/import/firestore-rest.mts'

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? '' : args[index + 1] ?? '' }
const apply = args.includes('--apply')
const projectId = option('--project')
const email = option('--email').trim().toLowerCase()
const householdId = option('--household') || 'family-home'
if (!projectId || !email) throw new Error('用法：add-household-invite.mts --project <projectId> --email <email> [--household family-home] [--apply]')
if (/dev|demo/i.test(projectId)) throw new Error('正式邀請工具拒絕寫入 dev／demo 專案')
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email 格式不正確')
console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', projectId, householdId, invite: email.replace(/(^.).*(@.*$)/, '$1***$2') }))
if (!apply) process.exit(0)

const require = createRequire(import.meta.url)
const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
const firebaseAuth = require(join(globalRoot, 'firebase-tools/lib/auth.js'))
const cliAccount = firebaseAuth.getProjectDefaultAccount(process.cwd()) ?? firebaseAuth.getGlobalDefaultAccount()
if (!cliAccount?.tokens?.refresh_token) throw new Error('找不到 Firebase CLI 登入憑證')
const token = (await firebaseAuth.getAccessToken(cliAccount.tokens.refresh_token, [])).access_token as string
const databaseResource = `projects/${projectId}/databases/(default)`
const path = `households/${householdId}/invites/${email}`
const name = `${databaseResource}/documents/${path.split('/').map(encodeURIComponent).join('/')}`
const response = await fetch(`https://firestore.googleapis.com/v1/${databaseResource}/documents:commit`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ writes: [{ update: { name, fields: firestoreFields({ role: 'member', createdAt: new Date().toISOString() }) } }] }),
})
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
console.log(JSON.stringify({ ok: true, invite: email.replace(/(^.).*(@.*$)/, '$1***$2') }))
