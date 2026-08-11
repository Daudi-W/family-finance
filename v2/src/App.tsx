import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  HandCoins,
  Home,
  Landmark,
  LogIn,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Settings,
  TrendingUp,
  Utensils,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider, usesFirebaseEmulators } from './firebase'
import './App.css'

type Page = 'home' | 'accounts' | 'entry' | 'reports' | 'more' | 'budget'

type Transaction = {
  id: number
  title: string
  detail: string
  amount: number
  icon: LucideIcon
  tone: 'expense' | 'income'
}

const transactions: Transaction[] = [
  {
    id: 1,
    title: '午餐',
    detail: '餐飲 · 今天 12:40 · 現金',
    amount: -180,
    icon: Utensils,
    tone: 'expense',
  },
  {
    id: 2,
    title: '薪資',
    detail: '薪水 · 8/10 · 中信帳戶',
    amount: 62000,
    icon: ArrowDownLeft,
    tone: 'income',
  },
  {
    id: 3,
    title: '機場交通',
    detail: '交通 · 昨天 · 日本旅行',
    amount: -1280,
    icon: ArrowUpRight,
    tone: 'expense',
  },
]

const accounts = [
  { name: '現金', type: '現金', amount: 8600, icon: WalletCards },
  { name: '中信帳戶', type: '銀行', amount: 93644, icon: Landmark },
  { name: '永豐信用卡', type: '信用卡', amount: -16400, icon: CreditCard },
]

const reportPeriods = ['本月', '近三個月', '今年'] as const

const money = (value: number) =>
  new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(value)

function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return (
    <button className="icon-button" type="button" aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}

function TopBar({ page, onNavigate, onSignOut }: { page: Page; onNavigate: (page: Page) => void; onSignOut: () => void }) {
  const titleByPage: Record<Page, string> = {
    home: '首頁',
    accounts: '帳戶',
    entry: '記一筆',
    reports: '統計報表',
    more: '更多設定',
    budget: '8 月收支與預算',
  }

  return (
    <header className="topbar">
      <div className="topbar-side topbar-left">
        {page === 'budget' ? (
          <IconButton label="返回首頁" onClick={() => onNavigate('home')}>
            <ChevronRight className="back-icon" />
          </IconButton>
        ) : null}
      </div>
      <h1>{titleByPage[page]}</h1>
      <div className="topbar-side topbar-actions">
        {page === 'home' ? (
          <>
            <span className="notification-icon" aria-label="2 筆待確認項目">
              <Bell aria-hidden="true" />
              <b>2</b>
            </span>
            <IconButton label="登出" onClick={onSignOut}>
              <LogOut />
            </IconButton>
          </>
        ) : null}
      </div>
    </header>
  )
}

function TransactionList() {
  return (
    <div className="transaction-list">
      {transactions.map((transaction) => {
        const Icon = transaction.icon
        return (
          <button className="transaction-row" type="button" key={transaction.id}>
            <span className="transaction-icon"><Icon /></span>
            <span className="transaction-copy">
              <strong>{transaction.title}</strong>
              <small>{transaction.detail}</small>
            </span>
            <span className={`transaction-amount ${transaction.tone}`}>
              {transaction.amount > 0 ? '+' : ''}{money(transaction.amount)}
            </span>
            <ChevronRight className="row-chevron" />
          </button>
        )
      })}
    </div>
  )
}

function HomePage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <main className="page home-page">
      <button className="pending-card" type="button">
        <span><CalendarDays />2 筆定期收支待確認</span>
        <ChevronRight />
      </button>

      <section className="summary-grid" aria-label="本月收支摘要">
        <article><span>本月收入</span><strong>{money(62000)}</strong></article>
        <article><span>本月支出</span><strong>{money(49520)}</strong></article>
        <article><span>本月結餘</span><strong>{money(12480)}</strong></article>
      </section>

      <section className="section-block">
        <div className="section-title-row">
          <h2>8 月日常預算</h2>
          <button type="button" onClick={() => onNavigate('budget')}>查看</button>
        </div>
        <button className="budget-card" type="button" onClick={() => onNavigate('budget')}>
          <span className="budget-numbers"><span>已使用 73%</span><strong>24,800 / 34,000</strong></span>
          <span className="progress-track"><span style={{ width: '73%' }} /></span>
        </button>
      </section>

      <section className="section-block">
        <div className="section-title-row">
          <h2>交易明細</h2>
          <button type="button">看全部</button>
        </div>
        <TransactionList />
      </section>
    </main>
  )
}

function AccountsPage() {
  return (
    <main className="page">
      <section className="net-worth-card">
        <div><span>家庭淨資產</span><strong>{money(1248600)}</strong></div>
        <dl>
          <div><dt>總資產</dt><dd>{money(1265000)}</dd></div>
          <div><dt>總負債</dt><dd>{money(16400)}</dd></div>
        </dl>
      </section>
      <div className="section-title-row account-heading">
        <h2>我的帳戶</h2>
        <button type="button" className="line-action"><Menu />編輯</button>
      </div>
      <section className="account-list">
        {accounts.map((account) => {
          const Icon = account.icon
          return (
            <button type="button" className="account-row" key={account.name}>
              <span className="account-icon"><Icon /></span>
              <span><strong>{account.name}</strong><small>{account.type}</small></span>
              <b className={account.amount < 0 ? 'expense' : ''}>{money(account.amount)}</b>
              <ChevronRight />
            </button>
          )
        })}
      </section>
    </main>
  )
}

function EntryPage() {
  return (
    <main className="page entry-page">
      <div className="entry-tabs" role="tablist" aria-label="交易類型">
        <button className="active" type="button">支出</button>
        <button type="button">收入</button>
        <button type="button">轉帳</button>
        <button type="button">代墊</button>
      </div>
      <button className="date-row" type="button">2026 年 8 月 11 日 週二</button>
      <section className="entry-form">
        <button type="button"><CircleDollarSign /><span>金額</span><strong>輸入金額</strong></button>
        <button type="button"><Utensils /><span>分類</span><strong>餐飲</strong><ChevronRight /></button>
        <button type="button"><WalletCards /><span>付款帳戶</span><strong>現金</strong><ChevronRight /></button>
        <button type="button"><ReceiptText /><span>專案</span><strong>無</strong><ChevronRight /></button>
        <label><span>備註</span><textarea aria-label="備註" placeholder="寫下備註…" /></label>
      </section>
      <button className="primary-action" type="button">儲存</button>
    </main>
  )
}

function ReportsPage() {
  const [period, setPeriod] = useState<(typeof reportPeriods)[number]>('本月')
  return (
    <main className="page">
      <div className="period-switch" aria-label="報表期間">
        {reportPeriods.map((item) => (
          <button className={period === item ? 'active' : ''} type="button" onClick={() => setPeriod(item)} key={item}>{item}</button>
        ))}
      </div>
      <section className="chart-card">
        <div className="section-title-row"><h2>收入、支出與淨資產</h2></div>
        <div className="trend-chart" aria-label={`${period}趨勢示意圖`}>
          <span className="chart-line income-line" />
          <span className="chart-line expense-line" />
          <span className="chart-line asset-line" />
        </div>
        <div className="chart-legend"><span className="income-dot">收入</span><span className="expense-dot">支出</span><span className="asset-dot">淨資產</span></div>
      </section>
      <section className="category-card">
        <h2>支出分類</h2>
        <div className="donut" aria-label="餐飲 36%、居家 24%、交通 18%、其他 22%" />
        <div className="category-list"><span>餐飲 <b>36%</b></span><span>居家 <b>24%</b></span><span>交通 <b>18%</b></span><span>其他 <b>22%</b></span></div>
      </section>
    </main>
  )
}

function MorePage() {
  const items = [
    { label: '預算設定', icon: CircleDollarSign },
    { label: '專案', icon: ReceiptText },
    { label: '定期項目', icon: CalendarDays },
    { label: '代墊與分帳', icon: HandCoins },
    { label: '分類與圖示', icon: Settings },
  ]
  return (
    <main className="page">
      <section className="settings-list">
        {items.map((item) => {
          const Icon = item.icon
          return <button type="button" key={item.label}><Icon /><span>{item.label}</span><ChevronRight /></button>
        })}
      </section>
    </main>
  )
}

function BudgetPage() {
  return (
    <main className="page">
      <section className="month-balance">
        <div><span>本月收入</span><strong className="income">+{money(62000)}</strong></div>
        <div><span>本月支出</span><strong className="expense">-{money(49520)}</strong></div>
        <div><span>本月結餘</span><strong>{money(12480)}</strong></div>
      </section>
      <section className="budget-category-list">
        {[
          ['餐飲', '8,600', '12,000', 72],
          ['居家', '6,200', '8,000', 78],
          ['交通', '4,000', '6,000', 67],
          ['娛樂', '6,000', '8,000', 75],
        ].map(([name, used, total, percent]) => (
          <button type="button" key={String(name)}>
            <span className="budget-category-copy"><strong>{name}</strong><small>{used} / {total}</small></span>
            <span className="mini-progress"><span style={{ width: `${percent}%` }} /></span>
            <ChevronRight />
          </button>
        ))}
      </section>
    </main>
  )
}

function AppShell({ user }: { user: User }) {
  const [page, setPage] = useState<Page>('home')
  const rootPage = page === 'budget' ? 'home' : page
  const navItems = useMemo(() => [
    { page: 'home' as const, label: '首頁', icon: Home },
    { page: 'accounts' as const, label: '帳戶', icon: Landmark },
    { page: 'entry' as const, label: '記一筆', icon: Plus },
    { page: 'reports' as const, label: '報表', icon: TrendingUp },
    { page: 'more' as const, label: '更多', icon: MoreHorizontal },
  ], [])

  const content = {
    home: <HomePage onNavigate={setPage} />,
    accounts: <AccountsPage />,
    entry: <EntryPage />,
    reports: <ReportsPage />,
    more: <MorePage />,
    budget: <BudgetPage />,
  }[page]

  return (
    <div className="app-frame">
      <aside className="desktop-sidebar">
        <div className="brand-mark"><WalletCards /><span>家庭記帳</span></div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon
            return <button type="button" className={rootPage === item.page ? 'active' : ''} onClick={() => setPage(item.page)} key={item.page}><Icon /><span>{item.label}</span></button>
          })}
        </nav>
        <button className="sidebar-user" type="button" onClick={() => void signOut(auth)}><span>{user.email?.slice(0, 1).toUpperCase() ?? 'P'}</span><small>{user.email}</small><LogOut /></button>
      </aside>
      <section className="app-main">
        <TopBar page={page} onNavigate={setPage} onSignOut={() => void signOut(auth)} />
        {usesFirebaseEmulators ? <div className="environment-badge">本機測試資料</div> : null}
        {content}
        <nav className="bottom-nav">
          {navItems.map((item) => {
            const Icon = item.icon
            return <button type="button" className={`${rootPage === item.page ? 'active' : ''} ${item.page === 'entry' ? 'entry-nav' : ''}`} onClick={() => setPage(item.page)} key={item.page}><Icon /><span>{item.label}</span></button>
          })}
        </nav>
      </section>
    </div>
  )
}

function LoginPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const login = async () => {
    setBusy(true)
    setError('')
    try {
      if (usesFirebaseEmulators) {
        const email = 'pei.test@example.local'
        const password = 'local-test-only'
        try {
          await signInWithEmailAndPassword(auth, email, password)
        } catch {
          await createUserWithEmailAndPassword(auth, email, password)
        }
      } else {
        await signInWithPopup(auth, googleProvider)
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登入失敗，請稍後再試。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-logo"><WalletCards /></div>
        <p className="eyebrow">Family Finance v2</p>
        <h1>家庭記帳</h1>
        <p>新的測試版本與舊帳本完全分開，現在不會讀寫正式財務資料。</p>
        <button className="login-button" type="button" disabled={busy} onClick={() => void login()}><LogIn />{busy ? '登入中…' : usesFirebaseEmulators ? '進入本機測試帳本' : '使用 Google 登入'}</button>
        {error ? <p className="login-error" role="alert">{error}</p> : null}
        <small>{usesFirebaseEmulators ? '需先啟動 Firebase Emulator；帳號只存在本機。' : '僅限已加入家庭帳本的 Google 帳號。'}</small>
      </section>
    </main>
  )
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser)
    setLoading(false)
  }), [])

  if (loading) return <div className="loading-screen">正在準備測試帳本…</div>
  return user ? <AppShell user={user} /> : <LoginPage />
}

export default App
