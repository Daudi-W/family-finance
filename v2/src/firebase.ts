import { initializeApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

const cloudConfigIsComplete = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID,
)

export const usesFirebaseEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ||
  !cloudConfigIsComplete

const firebaseConfig = cloudConfigIsComplete
  ? {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    }
  : {
      apiKey: 'demo-api-key',
      authDomain: 'demo-family-finance-v2.firebaseapp.com',
      projectId: 'demo-family-finance-v2',
      appId: '1:123456789:web:family-finance-v2',
    }

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
/**
 * 本機持久化快取：帳本資料存進瀏覽器 IndexedDB。
 * 重新整理與離線時直接由本機讀取，只有變動過的文件才向雲端補抓，
 * 大幅降低 Firestore 讀取次數；多分頁模式讓兩個分頁共用同一份快取。
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
export const googleProvider = new GoogleAuthProvider()
export const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || 'family-home'

if (usesFirebaseEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
    disableWarnings: true,
  })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
