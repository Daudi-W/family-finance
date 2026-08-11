import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { deleteApp, initializeApp } from 'firebase/app'
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'

const app = initializeApp({
  apiKey: 'demo-api-key',
  authDomain: 'demo-family-finance-v2.firebaseapp.com',
  projectId: 'demo-family-finance-v2',
  appId: '1:123456789:web:family-finance-v2-test',
}, 'auth-emulator-test')

const auth = getAuth(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })

after(async () => {
  await signOut(auth)
  await deleteApp(app)
})

test('測試帳號可以在 Auth Emulator 建立、登出並重新登入', async () => {
  const email = 'pei.test@example.local'
  const password = 'local-test-only'

  const created = await createUserWithEmailAndPassword(auth, email, password)
  assert.equal(created.user.email, email)

  await signOut(auth)
  assert.equal(auth.currentUser, null)

  const signedIn = await signInWithEmailAndPassword(auth, email, password)
  assert.equal(signedIn.user.email, email)
  assert.ok(signedIn.user.uid)
})
