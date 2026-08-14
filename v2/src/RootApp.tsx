import { useEffect, useState } from 'react'
import { LogIn, LogOut, WalletCards } from 'lucide-react'
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, googleProvider, householdId, usesFirebaseEmulators } from './firebase.ts'
import { canonicalAuthUrl } from './auth-url.ts'
import Workspace from './Workspace.tsx'
import './App.css'

type AccessState = 'checking' | 'allowed' | 'denied'

function LoginPage({ redirectError = '' }: { redirectError?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const login = async () => {
    setBusy(true); setError('')
    try {
      if (usesFirebaseEmulators) {
        const email = 'pei.test@example.local'; const password = 'local-test-only'
        try { await signInWithEmailAndPassword(auth, email, password) } catch { await createUserWithEmailAndPassword(auth, email, password) }
      } else {
        const canonical = canonicalAuthUrl(window.location.href, import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '')
        if (canonical) { window.location.assign(canonical); return }
        await signInWithRedirect(auth, googleProvider)
      }
    } catch (loginError) { setError(loginError instanceof Error ? loginError.message : '登入失敗，請稍後再試。') } finally { setBusy(false) }
  }
  return <main className="login-page"><section className="login-card"><div className="login-logo"><WalletCards /></div><p className="eyebrow">Family Finance</p><h1>家庭記帳</h1><p>一起整理家庭收支、帳戶與生活中的每一筆記錄。</p><button className="login-button" type="button" disabled={busy} onClick={() => void login()}><LogIn />{busy ? '登入中…' : usesFirebaseEmulators ? '進入本機測試帳本' : '使用 Google 登入'}</button>{error || redirectError ? <p className="login-error" role="alert">{error || redirectError}</p> : null}<small>{usesFirebaseEmulators ? '需先啟動 Firebase Emulator；帳號只存在本機。' : '僅限已加入家庭帳本的 Google 帳號。'}</small></section></main>
}

function AccessDeniedPage() {
  return <main className="login-page"><section className="login-card"><div className="login-logo"><WalletCards /></div><p className="eyebrow">Family Finance v2</p><h1>尚未加入家庭帳本</h1><p>這個 Google 帳號已登入，但不在家庭成員名單內，因此無法讀取帳本。</p><button className="login-button secondary-login-button" type="button" onClick={() => void signOut(auth)}><LogOut />登出並更換帳號</button></section></main>
}

export default function RootApp() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [redirectError, setRedirectError] = useState('')
  const [access, setAccess] = useState<AccessState>('checking')
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      if (!nextUser) { setAccess('checking'); setLoading(false); return }
      setLoading(true)
      if (usesFirebaseEmulators) { setAccess('allowed'); setLoading(false); return }
      const memberReference = doc(db, 'households', householdId, 'members', nextUser.uid)
      void getDoc(memberReference).then(async (member) => {
        if (member.exists()) { setAccess('allowed'); return }
        if (!nextUser.email) { setAccess('denied'); return }
        const invite = await getDoc(doc(db, 'households', householdId, 'invites', nextUser.email.toLowerCase()))
        if (!invite.exists()) { setAccess('denied'); return }
        const timestamp = new Date().toISOString()
        await setDoc(memberReference, { id: nextUser.uid, role: 'member', schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, createdBy: nextUser.uid, updatedBy: nextUser.uid, revision: 1 })
        setAccess('allowed')
      }).catch(() => setAccess('denied')).finally(() => setLoading(false))
    })
    void getRedirectResult(auth).catch((loginError: unknown) => { setRedirectError(loginError instanceof Error ? loginError.message : 'Google 登入失敗，請稍後再試。'); setLoading(false) })
    return unsubscribe
  }, [])
  if (loading) return <div className="loading-screen">正在準備家庭帳本…</div>
  if (!user) return <LoginPage redirectError={redirectError} />
  return access === 'allowed' ? <Workspace user={user} /> : <AccessDeniedPage />
}
