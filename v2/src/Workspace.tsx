import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Eye,
  EyeOff,
  GripVertical,
  HandCoins,
  Home,
  Landmark,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  Save,
  Settings,
  Trash2,
  TrendingUp,
  WalletCards,
  X,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth, usesFirebaseEmulators } from './firebase.ts'
import { useFinanceStore } from './finance-store.ts'
import {
  activeTransactions,
  addRecurringPeriod,
  advancePeopleRows,
  advanceRows,
  calculateBalances,
  calculateNetWorth,
  fromMinor,
  money,
  monthKey,
  monthRange,
  monthSequence,
  monthlyBudgetRows,
  pendingRecurring,
  reportForMonth,
  reportForRange,
  todayIso,
  toMinor,
} from './finance.ts'
import { iconFor, selectableIcons } from './icons.tsx'
import type {
  Account,
  AccountType,
  Budget,
  Category,
  Direction,
  FinanceData,
  FinanceTransaction,
  RecurringRule,
  TransactionKind,
} from './types.ts'
import './workspace.css'

type RouteName =
  | 'home' | 'accounts' | 'entry' | 'reports' | 'more'
  | 'transactions' | 'calendar' | 'budget' | 'budgets'
  | 'account-detail' | 'account-form' | 'account-adjust'
  | 'categories' | 'category-form' | 'category-picker'
  | 'account-picker' | 'project-picker'
  | 'projects' | 'project-detail' | 'project-form'
  | 'recurring' | 'recurring-form'
  | 'advances' | 'advance-detail'

type Route = { name: RouteName; id?: string }
type EntryKind = 'expense' | 'income' | 'transfer' | 'advance'
type EntryDraft = {
  kind: EntryKind
  date: string
  amount: string
  toAmount: string
  categoryId: string
  accountId: string
  toAccountId: string
  projectId: string
  note: string
  fee: string
  advanceDirection: 'receivable' | 'payable'
  ownShare: string
  shares: Record<string, string>
}

type Store = ReturnType<typeof useFinanceStore>

const rootRoutes: RouteName[] = ['home', 'accounts', 'entry', 'reports', 'more']
const accountTypeLabels: Record<AccountType, string> = {
  cash: '現金',
  bank: '銀行',
  credit_card: '信用卡',
  investment: '投資理財',
}
const transactionLabels: Record<TransactionKind, string> = {
  income: '收入', expense: '支出', transfer: '轉帳', advance: '代墊', settlement: '收／還款', balance_adjustment: '帳務調整',
}

const activeSorted = <T extends { archivedAt?: string; sortOrder?: number }>(items: T[]) =>
  items.filter((item) => !item.archivedAt).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

const numberValue = (value: string) => Math.max(0, Math.round(Number(value.replaceAll(',', '')) || 0))
const inflowDelta = (account: Account, amount: number) => account.type === 'credit_card' ? -amount : amount
const outflowDelta = (account: Account, amount: number) => account.type === 'credit_card' ? amount : -amount
const formatDate = (date: string) => new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00`))
const currentMonth = () => monthKey(todayIso())

function emptyEntry(kind: EntryKind = 'expense', accountId = ''): EntryDraft {
  return { kind, date: todayIso(), amount: '', toAmount: '', categoryId: '', accountId, toAccountId: '', projectId: '', note: '', fee: '', advanceDirection: 'receivable', ownShare: '', shares: {} }
}

function draftFromTransaction(transaction: FinanceTransaction, data: FinanceData): EntryDraft {
  const firstMove = transaction.accountMoves[0]
  const transfer = transaction.transfer
  const firstAccount = data.accounts.find((item) => item.id === (transfer?.fromAccountId ?? firstMove?.accountId))
  const toAccount = data.accounts.find((item) => item.id === transfer?.toAccountId)
  const currency = transaction.advance?.currency ?? transaction.reportLines[0]?.currency ?? firstAccount?.currency ?? 'TWD'
  const shares = Object.fromEntries(transaction.advance?.people.map((person) => [person.personId, String(fromMinor(person.expectedMinor, currency))]) ?? [])
  return {
    kind: transaction.kind === 'income' || transaction.kind === 'transfer' || transaction.kind === 'advance' ? transaction.kind : 'expense',
    date: transaction.occurredOn,
    amount: String(fromMinor(transaction.advance?.totalMinor ?? transaction.reportLines[0]?.amountMinor ?? transfer?.fromAmountMinor ?? transaction.settlement?.amountMinor ?? Math.abs(firstMove?.deltaMinor ?? 0), currency)),
    toAmount: transfer?.toAmountMinor ? String(fromMinor(transfer.toAmountMinor, toAccount?.currency ?? currency)) : '',
    categoryId: transaction.reportLines[0]?.categoryId ?? '',
    accountId: transfer?.fromAccountId ?? transaction.adjustment?.accountId ?? firstMove?.accountId ?? '',
    toAccountId: transfer?.toAccountId ?? transaction.accountMoves[1]?.accountId ?? '',
    projectId: transaction.projectId ?? '',
    note: transaction.note ?? '',
    fee: transfer?.feeMinor ? String(fromMinor(transfer.feeMinor, firstAccount?.currency ?? currency)) : '',
    advanceDirection: transaction.advance?.direction ?? 'receivable',
    ownShare: transaction.advance?.ownShareMinor ? String(fromMinor(transaction.advance.ownShareMinor, currency)) : '',
    shares,
  }
}

function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick: () => void }) {
  return <button className="workspace-icon-button" type="button" aria-label={label} onClick={onClick}>{children}</button>
}

export default function Workspace({ user }: { user: User }) {
  const store = useFinanceStore(user)
  const [routes, setRoutes] = useState<Route[]>([{ name: 'home' }])
  const [entryDraft, setEntryDraft] = useState<EntryDraft>(() => emptyEntry())
  const [editingTransactionId, setEditingTransactionId] = useState('')
  const [hideBalances, setHideBalances] = useState(false)
  const autoPosting = useRef(new Set<string>())
  const swipeStart = useRef<number | null>(null)
  const route = routes.at(-1) ?? { name: 'home' as const }
  const root = routes[0]?.name ?? 'home'

  const push = (next: Route) => setRoutes((current) => [...current, next])
  const back = () => setRoutes((current) => current.length > 1 ? current.slice(0, -1) : current)
  const goRoot = (name: RouteName) => {
    if (!rootRoutes.includes(name)) return
    setRoutes([{ name }])
    if (name === 'entry') {
      setEntryDraft(emptyEntry())
      setEditingTransactionId('')
    }
  }
  const openNewEntry = (kind: EntryKind = 'expense', accountId = '') => {
    setEntryDraft(emptyEntry(kind, accountId))
    setEditingTransactionId('')
    push({ name: 'entry' })
  }
  const editTransaction = (transaction: FinanceTransaction) => {
    setEntryDraft(draftFromTransaction(transaction, store.data))
    setEditingTransactionId(transaction.id)
    push({ name: 'entry', id: transaction.id })
  }

  const pendingRules = pendingRecurring(store.data.recurringRules)
  const unsettled = advanceRows(store.data.transactions).filter((item) => item.remaining > 0)
  const title = routeTitle(route, store.data)
  const showBack = routes.length > 1

  useEffect(() => {
    if (!store.ready) return
    for (const rule of pendingRules.filter((item) => item.postingMode === 'auto')) {
      const occurrenceId = `${rule.id}_${rule.nextScheduledOn}`
      if (autoPosting.current.has(occurrenceId)) continue
      autoPosting.current.add(occurrenceId)
      void postRecurringRule(store, rule)
    }
  }, [store, pendingRules])

  const page = (() => {
    if (!store.ready) return <LoadingPage />
    if (store.error) return <ErrorPage message={store.error} />
    switch (route.name) {
      case 'home': return <HomePage store={store} onPush={push} onEditTransaction={editTransaction} />
      case 'accounts': return <AccountsPage store={store} onPush={push} hideBalances={hideBalances} />
      case 'account-detail': return <AccountDetailPage store={store} accountId={route.id ?? ''} onPush={push} onEntry={openNewEntry} onEditTransaction={editTransaction} />
      case 'account-form': return route.id === 'manage' ? <AccountManager store={store} /> : <AccountFormPage store={store} accountId={route.id} onDone={back} />
      case 'account-adjust': return <AccountAdjustPage store={store} accountId={route.id ?? ''} onDone={back} />
      case 'entry': return <EntryPage store={store} draft={entryDraft} setDraft={setEntryDraft} editingId={editingTransactionId} onPush={push} onDone={() => routes.length > 1 ? back() : goRoot('home')} />
      case 'category-picker': return <PickerPage title="選擇分類" items={activeSorted(store.data.categories.filter((item) => item.direction === (entryDraft.kind === 'income' ? 'income' : 'expense')))} selectedId={entryDraft.categoryId} onSelect={(id) => { setEntryDraft((draft) => ({ ...draft, categoryId: id })); back() }} />
      case 'account-picker': return <PickerPage title="選擇帳戶" items={activeSorted(store.data.accounts).filter((item) => item.id !== (route.id === 'to' ? entryDraft.accountId : entryDraft.toAccountId))} selectedId={route.id === 'to' ? entryDraft.toAccountId : entryDraft.accountId} onSelect={(id) => { setEntryDraft((draft) => ({ ...draft, [route.id === 'to' ? 'toAccountId' : 'accountId']: id })); back() }} />
      case 'project-picker': return <PickerPage title="選擇專案" items={activeSorted(store.data.projects)} selectedId={entryDraft.projectId} allowNone onSelect={(id) => { setEntryDraft((draft) => ({ ...draft, projectId: id })); back() }} />
      case 'transactions': return <TransactionsPage store={store} onEdit={editTransaction} />
      case 'calendar': return <CalendarPage store={store} onEdit={editTransaction} />
      case 'reports': return <ReportsPage store={store} />
      case 'budget': return <BudgetSummaryPage store={store} onEditTransaction={editTransaction} />
      case 'more': return <MorePage onPush={push} />
      case 'categories': return <CategoryManager store={store} onPush={push} />
      case 'category-form': return <CategoryForm store={store} categoryId={route.id} onDone={back} />
      case 'budgets': return <BudgetManager store={store} />
      case 'projects': return <ProjectsPage store={store} onPush={push} />
      case 'project-detail': return <ProjectDetailPage store={store} projectId={route.id ?? ''} onPush={push} onEditTransaction={editTransaction} />
      case 'project-form': return <ProjectForm store={store} projectId={route.id} onDone={back} />
      case 'recurring': return <RecurringPage store={store} onPush={push} onEditTransaction={editTransaction} />
      case 'recurring-form': return <RecurringForm store={store} ruleId={route.id} onDone={back} />
      case 'advances': return <AdvancesPage store={store} onPush={push} onNew={() => { setEntryDraft(emptyEntry('advance')); setEditingTransactionId(''); push({ name: 'entry' }) }} />
      case 'advance-detail': return <AdvanceDetailPage store={store} transactionId={route.id ?? ''} onEditTransaction={editTransaction} />
      default: return <HomePage store={store} onPush={push} onEditTransaction={editTransaction} />
    }
  })()

  return (
    <div className="workspace-frame">
      <aside className="workspace-sidebar">
        <div className="workspace-brand"><WalletCards /><span>家庭記帳</span></div>
        <RootNavigation active={root} onNavigate={goRoot} />
        <button className="workspace-user" type="button" onClick={() => void signOut(auth)}><span>{user.email?.slice(0, 1).toUpperCase()}</span><small>登出</small><LogOut /></button>
      </aside>
      <section className="workspace-main" onTouchStart={(event) => { swipeStart.current = event.touches[0]?.clientX ?? null }} onTouchEnd={(event) => { const start = swipeStart.current; const end = event.changedTouches[0]?.clientX ?? 0; swipeStart.current = null; if (showBack && start !== null && start < 45 && end - start > 80) back() }}>
        <header className="workspace-topbar">
          <div>{showBack ? <IconButton label="上一頁" onClick={back}><ArrowLeft /></IconButton> : null}</div>
          <h1>{title}</h1>
          <div className="workspace-top-actions">
            {route.name === 'home' ? <>
              <BadgeButton label="待確認定期收支" count={pendingRules.length} onClick={() => push({ name: 'recurring' })}><CalendarDays /></BadgeButton>
              <BadgeButton label="未結清代墊與分帳" count={unsettled.length} onClick={() => push({ name: 'advances' })}><HandCoins /></BadgeButton>
            </> : null}
            {route.name === 'accounts' ? <>
              <IconButton label={hideBalances ? '顯示餘額' : '隱藏餘額'} onClick={() => setHideBalances((value) => !value)}>{hideBalances ? <EyeOff /> : <Eye />}</IconButton>
              <IconButton label="新增帳戶" onClick={() => push({ name: 'account-form' })}><Plus /></IconButton>
              <IconButton label="編輯帳戶" onClick={() => push({ name: 'account-form', id: 'manage' })}><Menu /></IconButton>
            </> : null}
          </div>
        </header>
        {usesFirebaseEmulators ? <div className="workspace-environment">本機測試資料</div> : null}
        {page}
        <nav className="workspace-bottom-nav"><RootNavigation active={root} onNavigate={goRoot} /></nav>
      </section>
    </div>
  )
}

function routeTitle(route: Route, data: FinanceData) {
  const staticTitles: Partial<Record<RouteName, string>> = {
    home: '首頁', accounts: '帳戶', entry: route.id ? '編輯明細' : '記一筆', reports: '統計報表', more: '更多設定',
    transactions: '交易明細', calendar: '收支行事曆', budget: '本月收支與預算', budgets: '預算設定',
    'account-form': route.id && route.id !== 'manage' ? '帳戶設定' : route.id === 'manage' ? '管理帳戶' : '新增帳戶', 'account-adjust': '調整餘額',
    categories: '分類與圖示', 'category-form': route.id ? '編輯分類' : '新增分類', 'category-picker': '選擇分類', 'account-picker': '選擇帳戶', 'project-picker': '選擇專案',
    projects: '專案', 'project-form': route.id ? '專案設定' : '新增專案', recurring: '定期項目', 'recurring-form': route.id ? '編輯定期項目' : '新增定期項目', advances: '代墊與分帳',
  }
  if (route.name === 'account-detail') return data.accounts.find((item) => item.id === route.id)?.name ?? '帳戶明細'
  if (route.name === 'project-detail') return data.projects.find((item) => item.id === route.id)?.name ?? '專案明細'
  if (route.name === 'advance-detail') return '代墊明細'
  return staticTitles[route.name] ?? '家庭記帳'
}

function RootNavigation({ active, onNavigate }: { active: RouteName; onNavigate: (route: RouteName) => void }) {
  const items = [
    { name: 'home' as const, label: '首頁', icon: Home },
    { name: 'accounts' as const, label: '帳戶', icon: Landmark },
    { name: 'entry' as const, label: '記一筆', icon: Plus },
    { name: 'reports' as const, label: '報表', icon: TrendingUp },
    { name: 'more' as const, label: '更多', icon: MoreHorizontal },
  ]
  return <>{items.map((item) => { const Icon = item.icon; return <button className={`${active === item.name ? 'active' : ''} ${item.name === 'entry' ? 'entry-root-button' : ''}`} type="button" onClick={() => onNavigate(item.name)} key={item.name}><Icon /><span>{item.label}</span></button> })}</>
}

function BadgeButton({ label, count, children, onClick }: { label: string; count: number; children: ReactNode; onClick: () => void }) {
  return <button className="workspace-badge-button" type="button" aria-label={`${count} 筆${label}`} onClick={onClick}>{children}{count > 0 ? <b>{count}</b> : null}</button>
}

function LoadingPage() { return <main className="workspace-loading">正在同步測試帳本…</main> }
function ErrorPage({ message }: { message: string }) { return <main className="workspace-loading error-text">資料載入失敗：{message}</main> }

function EntityIcon({ iconKey }: { iconKey: string }) {
  const Icon = iconFor(iconKey)
  return <span className="entity-icon"><Icon /></span>
}

function EmptyDataCard({ onSeed }: { onSeed: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return <section className="empty-data-card"><WalletCards /><h2>測試帳本目前是空的</h2><p>可先建立一組不含真實資料的示範分類、帳戶與交易，再逐頁測試。</p><button type="button" disabled={busy} onClick={() => { setBusy(true); void onSeed().finally(() => setBusy(false)) }}>{busy ? '建立中…' : '建立示範資料'}</button></section>
}

function HomePage({ store, onPush, onEditTransaction }: { store: Store; onPush: (route: Route) => void; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const month = currentMonth()
  const report = reportForMonth(store.data.transactions, month)
  const budgetRows = monthlyBudgetRows(store.data.budgets, store.data.categories, store.data.transactions, month)
  const budgetTotal = budgetRows.reduce((sum, row) => sum + row.monthlyAmount, 0)
  const spent = budgetRows.reduce((sum, row) => sum + row.spent, 0)
  const recent = activeTransactions(store.data.transactions).sort((a, b) => `${b.occurredOn}${b.updatedAt}`.localeCompare(`${a.occurredOn}${a.updatedAt}`)).slice(0, 4)
  const empty = store.data.accounts.length === 0 && store.data.categories.length === 0
  if (empty) return <main className="workspace-page"><EmptyDataCard onSeed={store.seedDemo} /></main>
  return <main className="workspace-page">
    <section className="home-summary" aria-label="本月收支摘要">
      <article><span>本月收入</span><strong className="income-text">{money(report.income)}</strong></article>
      <article><span>本月支出</span><strong className="expense-text">{money(report.expense)}</strong></article>
      <article><span>本月結餘</span><strong>{money(report.balance)}</strong></article>
    </section>
    <section className="workspace-section">
      <div className="section-heading"><h2>{Number(month.slice(5))} 月日常預算</h2><button type="button" onClick={() => onPush({ name: 'budget' })}>查看</button></div>
      <button className="home-budget-card" type="button" onClick={() => onPush({ name: 'budget' })}>
        <span><span>已使用 {budgetTotal ? Math.round(spent / budgetTotal * 100) : 0}%</span><strong>{money(spent)} / {money(budgetTotal)}</strong></span>
        <i><b style={{ width: `${Math.min(100, budgetTotal ? spent / budgetTotal * 100 : 0)}%` }} /></i>
      </button>
    </section>
    <section className="workspace-section">
      <div className="section-heading"><h2>交易明細</h2><span><button type="button" onClick={() => onPush({ name: 'calendar' })}><CalendarDays />行事曆</button><button type="button" onClick={() => onPush({ name: 'transactions' })}>看全部</button></span></div>
      <TransactionRows transactions={recent} data={store.data} onEdit={onEditTransaction} />
    </section>
  </main>
}

function TransactionRows({ transactions, data, onEdit }: { transactions: FinanceTransaction[]; data: FinanceData; onEdit: (transaction: FinanceTransaction) => void }) {
  if (transactions.length === 0) return <div className="simple-empty">目前沒有交易</div>
  return <div className="workspace-list">{transactions.map((transaction) => {
    const line = transaction.reportLines[0]
    const category = data.categories.find((item) => item.id === line?.categoryId)
    const account = data.accounts.find((item) => item.id === transaction.accountMoves[0]?.accountId)
    const amount = line ? line.amountTwdMinor * (line.direction === 'expense' ? -1 : 1) : transaction.transfer?.fromAmountMinor ? -transaction.transfer.fromAmountMinor : transaction.settlement?.amountMinor ?? 0
    return <button className="transaction-row-v2" type="button" key={transaction.id} onClick={() => onEdit(transaction)}>
      <EntityIcon iconKey={category?.iconKey ?? (transaction.kind === 'transfer' ? 'rotate-ccw' : transaction.kind === 'settlement' ? 'hand-coins' : 'receipt-text')} />
      <span><strong>{transaction.note || category?.name || transactionLabels[transaction.kind]}</strong><small>{category?.name ?? transactionLabels[transaction.kind]} · {formatDate(transaction.occurredOn)}{account ? ` · ${account.name}` : ''}</small></span>
      <b className={amount < 0 ? 'expense-text' : amount > 0 ? 'income-text' : ''}>{amount > 0 ? '+' : ''}{money(amount)}</b><ChevronRight />
    </button>
  })}</div>
}

function AccountsPage({ store, onPush, hideBalances }: { store: Store; onPush: (route: Route) => void; hideBalances: boolean }) {
  const accounts = activeSorted(store.data.accounts)
  const balances = calculateBalances(accounts, store.data.transactions)
  const netWorth = calculateNetWorth(accounts, balances)
  return <main className="workspace-page">
    <section className="net-worth-v2"><span>家庭淨資產</span><strong>{hideBalances ? '••••••' : money(netWorth.netWorth)}</strong><div><span>總資產 <b>{hideBalances ? '••••' : money(netWorth.assets)}</b></span><span>總負債 <b>{hideBalances ? '••••' : money(netWorth.liabilities)}</b></span></div></section>
    <section className="workspace-section"><div className="section-heading"><h2>我的帳戶</h2></div><div className="workspace-list account-list-v2">{accounts.map((account) => <button type="button" key={account.id} onClick={() => onPush({ name: 'account-detail', id: account.id })}><EntityIcon iconKey={account.iconKey} /><span><strong>{account.name}</strong><small>{accountTypeLabels[account.type]} · {account.currency}</small></span><b className={account.type === 'credit_card' ? 'expense-text' : ''}>{hideBalances ? '••••' : money(balances[account.id] ?? 0, account.currency)}</b><ChevronRight /></button>)}</div></section>
  </main>
}

function AccountDetailPage({ store, accountId, onPush, onEntry, onEditTransaction }: { store: Store; accountId: string; onPush: (route: Route) => void; onEntry: (kind: EntryKind, accountId: string) => void; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const account = store.data.accounts.find((item) => item.id === accountId)
  if (!account) return <main className="workspace-page"><div className="simple-empty">找不到帳戶</div></main>
  const balance = calculateBalances(store.data.accounts, store.data.transactions)[account.id] ?? 0
  const related = activeTransactions(store.data.transactions).filter((transaction) => transaction.accountMoves.some((move) => move.accountId === account.id)).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
  const inflow = related.flatMap((item) => item.accountMoves.filter((move) => move.accountId === account.id && move.deltaMinor > 0)).reduce((sum, move) => sum + move.deltaMinor, 0)
  const outflow = related.flatMap((item) => item.accountMoves.filter((move) => move.accountId === account.id && move.deltaMinor < 0)).reduce((sum, move) => sum + Math.abs(move.deltaMinor), 0)
  return <main className="workspace-page">
    <section className="account-balance-compact"><EntityIcon iconKey={account.iconKey} /><span>目前餘額</span><strong>{money(balance, account.currency)}</strong><small>{account.currency} · {account.includeInNetWorth ? '計入淨資產' : '不計入淨資產'}</small></section>
    <div className="account-action-grid"><button type="button" onClick={() => onEntry('expense', account.id)}><ArrowUpRight />支出</button><button type="button" onClick={() => onEntry('income', account.id)}><ArrowDownLeft />收入</button><button type="button" onClick={() => onEntry('transfer', account.id)}><ArrowUpRight />轉帳</button><button type="button" onClick={() => onPush({ name: 'account-adjust', id: account.id })}><CircleDollarSign />調整餘額</button><button type="button" onClick={() => onPush({ name: 'account-form', id: account.id })}><Settings />帳戶設定</button></div>
    <section className="account-flow-summary"><span>流入 <b className="income-text">{money(inflow, account.currency)}</b></span><span>流出 <b className="expense-text">{money(outflow, account.currency)}</b></span></section>
    <section className="workspace-section"><div className="section-heading"><h2>帳戶明細</h2></div><TransactionRows transactions={related} data={store.data} onEdit={onEditTransaction} /></section>
  </main>
}

function EntryPage({ store, draft, setDraft, editingId, onPush, onDone }: { store: Store; draft: EntryDraft; setDraft: (value: EntryDraft | ((current: EntryDraft) => EntryDraft)) => void; editingId: string; onPush: (route: Route) => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const accounts = activeSorted(store.data.accounts)
  const categories = activeSorted(store.data.categories.filter((item) => item.direction === (draft.kind === 'income' ? 'income' : 'expense')))
  const account = accounts.find((item) => item.id === draft.accountId)
  const toAccount = accounts.find((item) => item.id === draft.toAccountId)
  const category = categories.find((item) => item.id === draft.categoryId)
  const project = store.data.projects.find((item) => item.id === draft.projectId)
  const amount = toMinor(draft.amount, account?.currency ?? 'TWD')
  const toAmount = toMinor(draft.toAmount, toAccount?.currency ?? account?.currency ?? 'TWD') || amount
  const existingTransaction = store.data.transactions.find((item) => item.id === editingId)

  if (existingTransaction?.kind === 'settlement') return <SettlementTransactionEditor store={store} transaction={existingTransaction} draft={draft} setDraft={setDraft} onPush={onPush} onDone={onDone} />
  if (existingTransaction?.kind === 'balance_adjustment') return <AdjustmentTransactionEditor store={store} transaction={existingTransaction} draft={draft} setDraft={setDraft} onPush={onPush} onDone={onDone} />

  const changeKind = (kind: EntryKind) => setDraft((current) => ({ ...emptyEntry(kind), date: current.date }))
  const save = async () => {
    setError('')
    if (!amount) return setError('請輸入金額')
    if (draft.kind !== 'advance' || draft.advanceDirection === 'receivable') if (!account) return setError('請選擇帳戶')
    if (draft.kind !== 'transfer' && !category) return setError('請選擇分類')
    if (draft.kind === 'transfer' && !toAccount) return setError('請選擇轉入帳戶')
    if (draft.kind === 'transfer' && account && toAccount && account.currency !== toAccount.currency && !numberValue(draft.toAmount)) return setError('跨幣別轉帳請輸入轉入金額')
    const now = new Date().toISOString()
    const previous = store.data.transactions.find((item) => item.id === editingId)
    const common = { id: editingId || undefined, occurredOn: draft.date, note: draft.note, projectId: draft.kind === 'transfer' ? undefined : draft.projectId || undefined, accountMoves: [], reportLines: [], voidedAt: previous?.voidedAt }
    let transaction: Partial<FinanceTransaction>
    if (draft.kind === 'income' && account && category) transaction = { ...common, kind: 'income', accountMoves: [{ accountId: account.id, deltaMinor: inflowDelta(account, amount), currency: account.currency }], reportLines: [{ direction: 'income', categoryId: category.id, amountMinor: amount, currency: account.currency, amountTwdMinor: Math.round(amount * (account.currency === 'TWD' ? 1 : account.referenceRateToTwd ?? 0)), countsTowardBudget: true }] }
    else if (draft.kind === 'expense' && account && category) transaction = { ...common, kind: 'expense', accountMoves: [{ accountId: account.id, deltaMinor: outflowDelta(account, amount), currency: account.currency }], reportLines: [{ direction: 'expense', categoryId: category.id, amountMinor: amount, currency: account.currency, amountTwdMinor: Math.round(amount * (account.currency === 'TWD' ? 1 : account.referenceRateToTwd ?? 0)), countsTowardBudget: !category.systemKey?.startsWith('balance_adjustment') }] }
    else if (draft.kind === 'transfer' && account && toAccount) {
      const fee = toMinor(draft.fee || 0, account.currency)
      const feeCategory = store.data.categories.find((item) => item.systemKey === 'bank_fee' && !item.archivedAt)
      transaction = { ...common, kind: 'transfer', accountMoves: [{ accountId: account.id, deltaMinor: outflowDelta(account, amount + fee), currency: account.currency }, { accountId: toAccount.id, deltaMinor: inflowDelta(toAccount, toAmount), currency: toAccount.currency }], reportLines: fee && feeCategory ? [{ direction: 'expense', categoryId: feeCategory.id, amountMinor: fee, currency: account.currency, amountTwdMinor: Math.round(fee * (account.currency === 'TWD' ? 1 : account.referenceRateToTwd ?? 0)), countsTowardBudget: true }] : [], transfer: { fromAccountId: account.id, toAccountId: toAccount.id, fromAmountMinor: amount, toAmountMinor: toAmount, feeMinor: fee } }
    } else if (draft.kind === 'advance' && category) {
      const advanceCurrency = account?.currency ?? 'TWD'
      const people = Object.entries(draft.shares).map(([personId, value]) => ({ personId, expectedMinor: toMinor(value, advanceCurrency) })).filter((item) => item.expectedMinor > 0)
      if (!people.length) return setError('請至少填寫一位對象的金額')
      const ownShare = draft.advanceDirection === 'payable' ? amount : toMinor(draft.ownShare || 0, advanceCurrency)
      const peopleTotal = people.reduce((sum, person) => sum + person.expectedMinor, 0)
      if (draft.advanceDirection === 'receivable' && peopleTotal + ownShare !== amount) return setError('自己負擔與各對象金額加總必須等於消費總額')
      if (draft.advanceDirection === 'payable' && peopleTotal !== amount) return setError('各對象金額加總必須等於應還總額')
      transaction = { ...common, kind: 'advance', accountMoves: draft.advanceDirection === 'receivable' && account ? [{ accountId: account.id, deltaMinor: outflowDelta(account, amount), currency: account.currency }] : [], reportLines: ownShare ? [{ direction: 'expense', categoryId: category.id, amountMinor: ownShare, currency: account?.currency ?? 'TWD', amountTwdMinor: Math.round(ownShare * (account?.currency === 'TWD' || !account ? 1 : account.referenceRateToTwd ?? 0)), countsTowardBudget: true }] : [], advance: { direction: draft.advanceDirection, totalMinor: amount, ownShareMinor: ownShare, currency: account?.currency ?? 'TWD', people } }
    } else return setError('資料不完整')
    setSaving(true)
    try { await store.save('transactions', { ...transaction, updatedAt: now }); onDone() } catch (saveError) { setError(saveError instanceof Error ? saveError.message : '儲存失敗') } finally { setSaving(false) }
  }

  return <main className="workspace-page entry-page-v2">
    <div className="entry-kind-tabs">{(['expense', 'income', 'transfer', 'advance'] as EntryKind[]).map((kind) => <button className={draft.kind === kind ? 'active' : ''} type="button" key={kind} onClick={() => changeKind(kind)}>{{ expense: '支出', income: '收入', transfer: '轉帳', advance: '代墊' }[kind]}</button>)}</div>
    <label className="date-only-row"><input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /><span>{formatDate(draft.date)}</span></label>
    {draft.kind === 'advance' ? <div className="advance-direction"><button className={draft.advanceDirection === 'receivable' ? 'active' : ''} type="button" onClick={() => setDraft((current) => ({ ...current, advanceDirection: 'receivable' }))}>我替別人代墊</button><button className={draft.advanceDirection === 'payable' ? 'active' : ''} type="button" onClick={() => setDraft((current) => ({ ...current, advanceDirection: 'payable' }))}>別人替我代墊</button></div> : null}
    <section className="entry-fields-v2">
      {draft.kind === 'transfer' ? <>
        <FieldButton icon="wallet-cards" label="轉出" value={account?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'from' })} />
        <FieldButton icon="landmark" label="轉入" value={toAccount?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'to' })} />
      </> : draft.kind !== 'advance' || draft.advanceDirection === 'receivable' ? <FieldButton icon={account?.iconKey ?? 'wallet-cards'} label={draft.kind === 'income' ? '存入帳戶' : '付款帳戶'} value={account?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'from' })} /> : null}
      <label className="field-row"><EntityIcon iconKey="circle-dollar-sign" /><span><b>{draft.kind === 'advance' ? '消費總額' : '金額'}</b></span><input inputMode="numeric" placeholder="輸入金額" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} /></label>
      {draft.kind === 'transfer' && account && toAccount && account.currency !== toAccount.currency ? <label className="field-row"><EntityIcon iconKey="rotate-ccw" /><span><b>轉入金額</b><small>{toAccount.currency}</small></span><input inputMode="decimal" placeholder="輸入轉入金額" value={draft.toAmount} onChange={(event) => setDraft((current) => ({ ...current, toAmount: event.target.value }))} /></label> : null}
      {draft.kind !== 'transfer' ? <FieldButton icon={category?.iconKey ?? 'receipt-text'} label="分類" value={category?.name ?? '請選擇'} hint={category ? budgetHint(category.id, store.data) : undefined} onClick={() => onPush({ name: 'category-picker' })} /> : null}
      {draft.kind !== 'transfer' && draft.kind !== 'advance' ? <FieldButton icon={project?.iconKey ?? 'receipt-text'} label="專案" value={project?.name ?? '無'} onClick={() => onPush({ name: 'project-picker' })} /> : null}
      {draft.kind === 'advance' ? <AdvanceShareFields store={store} draft={draft} setDraft={setDraft} /> : null}
      <label className="entry-note"><span>備註</span><textarea placeholder="寫下備註…" value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label>
      {draft.kind === 'transfer' ? <label className="field-row"><EntityIcon iconKey="receipt-text" /><span><b>手續費</b><small>有需要才填，會計入支出</small></span><input inputMode="numeric" placeholder="0" value={draft.fee} onChange={(event) => setDraft((current) => ({ ...current, fee: event.target.value }))} /></label> : null}
    </section>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="page-actions">{editingId ? <button className="danger-button" type="button" onClick={() => void store.voidTransaction(editingId).then(onDone)}><Trash2 />刪除這筆明細</button> : null}<button className="primary-button" type="button" disabled={saving} onClick={() => void save()}><Save />{saving ? '儲存中…' : '儲存'}</button></div>
  </main>
}

function SettlementTransactionEditor({ store, transaction, draft, setDraft, onPush, onDone }: { store: Store; transaction: FinanceTransaction; draft: EntryDraft; setDraft: (value: EntryDraft | ((current: EntryDraft) => EntryDraft)) => void; onPush: (route: Route) => void; onDone: () => void }) {
  const account = store.data.accounts.find((item) => item.id === draft.accountId)
  const amount = toMinor(draft.amount, account?.currency ?? 'TWD')
  const direction = transaction.settlement?.direction ?? 'collect'
  const save = async () => {
    if (!account || !amount || !transaction.settlement) return
    await store.save('transactions', { ...transaction, occurredOn: draft.date, note: draft.note, accountMoves: [{ accountId: account.id, deltaMinor: direction === 'collect' ? inflowDelta(account, amount) : outflowDelta(account, amount), currency: account.currency }], settlement: { ...transaction.settlement, amountMinor: amount } })
    onDone()
  }
  return <main className="workspace-page entry-page-v2"><div className="entry-type-label">{direction === 'collect' ? '代墊收款' : '代墊還款'}</div><label className="date-only-row"><input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /><span>{formatDate(draft.date)}</span></label><section className="entry-fields-v2"><FieldButton icon={account?.iconKey ?? 'wallet-cards'} label={direction === 'collect' ? '收款帳戶' : '付款帳戶'} value={account?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'from' })} /><label className="field-row"><EntityIcon iconKey="circle-dollar-sign" /><span><b>金額</b></span><input inputMode="numeric" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} /></label><label className="entry-note"><span>備註</span><textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label></section><div className="page-actions"><button className="danger-button" type="button" onClick={() => void store.voidTransaction(transaction.id).then(onDone)}><Trash2 />刪除這筆明細</button><button className="primary-button" type="button" onClick={() => void save()}><Save />儲存</button></div></main>
}

function AdjustmentTransactionEditor({ store, transaction, draft, setDraft, onPush, onDone }: { store: Store; transaction: FinanceTransaction; draft: EntryDraft; setDraft: (value: EntryDraft | ((current: EntryDraft) => EntryDraft)) => void; onPush: (route: Route) => void; onDone: () => void }) {
  const account = store.data.accounts.find((item) => item.id === draft.accountId)
  const amount = toMinor(draft.amount, account?.currency ?? 'TWD')
  const sign = Math.sign(transaction.adjustment?.differenceMinor ?? 1) || 1
  const difference = amount * sign
  const save = async () => {
    if (!account || !amount || !transaction.adjustment) return
    const direction: Direction = account.type === 'credit_card' ? (difference > 0 ? 'expense' : 'income') : (difference > 0 ? 'income' : 'expense')
    const category = store.data.categories.find((item) => item.systemKey === `balance_adjustment_${direction}`)
    if (!category) return
    await store.save('transactions', { ...transaction, occurredOn: draft.date, note: draft.note, accountMoves: [{ accountId: account.id, deltaMinor: difference, currency: account.currency }], reportLines: [{ direction, categoryId: category.id, amountMinor: amount, currency: account.currency, amountTwdMinor: amount, countsTowardBudget: false }], adjustment: { accountId: account.id, beforeMinor: transaction.adjustment.beforeMinor, actualMinor: transaction.adjustment.beforeMinor + difference, differenceMinor: difference } })
    onDone()
  }
  return <main className="workspace-page entry-page-v2"><div className="entry-type-label">帳務調整</div><label className="date-only-row"><input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /><span>{formatDate(draft.date)}</span></label><section className="entry-fields-v2"><FieldButton icon={account?.iconKey ?? 'wallet-cards'} label="帳戶" value={account?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'from' })} /><label className="field-row"><EntityIcon iconKey="scale" /><span><b>調整差額</b><small>{difference >= 0 ? '增加餘額' : '減少餘額'}</small></span><input inputMode="numeric" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))} /></label><label className="entry-note"><span>備註</span><textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label></section><div className="page-actions"><button className="danger-button" type="button" onClick={() => void store.voidTransaction(transaction.id).then(onDone)}><Trash2 />刪除這筆明細</button><button className="primary-button" type="button" onClick={() => void save()}><Save />儲存</button></div></main>
}

function FieldButton({ icon, label, value, hint, onClick }: { icon: string; label: string; value: string; hint?: string; onClick: () => void }) {
  return <button className="field-row" type="button" onClick={onClick}><EntityIcon iconKey={icon} /><span><b>{label}</b>{hint ? <small>{hint}</small> : null}</span><strong>{value}</strong><ChevronRight /></button>
}

function budgetHint(categoryId: string, data: FinanceData) {
  const row = monthlyBudgetRows(data.budgets, data.categories, data.transactions, currentMonth()).find((item) => item.category?.id === categoryId)
  return row ? `本月預算剩餘 ${money(row.monthlyAmount - row.spent)}` : '尚未設定預算'
}

function AdvanceShareFields({ store, draft, setDraft }: { store: Store; draft: EntryDraft; setDraft: (value: EntryDraft | ((current: EntryDraft) => EntryDraft)) => void }) {
  return <div className="advance-shares">
    {draft.advanceDirection === 'receivable' ? <label><span>我應負擔金額</span><input inputMode="numeric" placeholder="純代墊可填 0" value={draft.ownShare} onChange={(event) => setDraft((current) => ({ ...current, ownShare: event.target.value }))} /></label> : null}
    <p>{draft.advanceDirection === 'receivable' ? '誰應該還我' : '我應該還給誰'}</p>
    {activeSorted(store.data.advancePeople).map((person) => <label key={person.id}><span><EntityIcon iconKey={person.iconKey} />{person.name}</span><input inputMode="numeric" placeholder="0" value={draft.shares[person.id] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, shares: { ...current.shares, [person.id]: event.target.value } }))} /></label>)}
    {store.data.advancePeople.length === 0 ? <small>請先到「更多設定 → 代墊與分帳」新增對象。</small> : null}
  </div>
}

function PickerPage<T extends { id: string; name: string; iconKey: string }>({ items, selectedId, allowNone, onSelect }: { title: string; items: T[]; selectedId: string; allowNone?: boolean; onSelect: (id: string) => void }) {
  return <main className="workspace-page"><div className="picker-grid">{allowNone ? <button type="button" className={!selectedId ? 'selected' : ''} onClick={() => onSelect('')}><span className="entity-icon"><X /></span><b>無</b></button> : null}{items.map((item) => <button type="button" className={selectedId === item.id ? 'selected' : ''} key={item.id} onClick={() => onSelect(item.id)}><EntityIcon iconKey={item.iconKey} /><b>{item.name}</b>{selectedId === item.id ? <Check /> : null}</button>)}</div></main>
}

function AccountFormPage({ store, accountId, onDone }: { store: Store; accountId?: string; onDone: () => void }) {
  const existing = store.data.accounts.find((item) => item.id === accountId)
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<AccountType>(existing?.type ?? 'bank')
  const [currency, setCurrency] = useState(existing?.currency ?? 'TWD')
  const [openingBalance, setOpeningBalance] = useState(String(existing?.openingBalanceMinor ?? 0))
  const [include, setInclude] = useState(existing?.includeInNetWorth ?? true)
  const [iconKey, setIconKey] = useState(existing?.iconKey ?? 'landmark')
  const [rate, setRate] = useState(String(existing?.referenceRateToTwd ?? ''))
  const [closingDay, setClosingDay] = useState(String(existing?.creditCard?.closingDay ?? 12))
  const [paymentDay, setPaymentDay] = useState(String(existing?.creditCard?.paymentDay ?? 28))
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('請輸入帳戶名稱')
    await store.save('accounts', {
      id: existing?.id, name: name.trim(), type, currency: currency.toUpperCase(), iconKey,
      sortOrder: existing?.sortOrder ?? store.data.accounts.length, includeInNetWorth: include,
      openingBalanceMinor: toMinor(openingBalance || 0, currency.toUpperCase()), openingDate: existing?.openingDate ?? todayIso(),
      referenceRateToTwd: currency.toUpperCase() === 'TWD' ? undefined : Number(rate) || 0,
      creditCard: type === 'credit_card' ? { closingDay: numberValue(closingDay), paymentDay: numberValue(paymentDay) } : undefined,
    })
    onDone()
  }
  return <main className="workspace-page"><form className="settings-form" onSubmit={(event) => void submit(event)}>
    <label><span>帳戶名稱</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：中信帳戶" /></label>
    <label><span>帳戶類型</span><select value={type} onChange={(event) => { const next = event.target.value as AccountType; setType(next); setIconKey({ cash: 'wallet-cards', bank: 'landmark', credit_card: 'credit-card', investment: 'chart-no-axes-combined' }[next]) }}>{Object.entries(accountTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label><span>幣別</span><input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value)} /></label>
    <label><span>初始餘額</span><input inputMode="numeric" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} disabled={Boolean(existing)} /><small>{existing ? '建立後請使用「調整餘額」，保留帳務紀錄。' : '信用卡請填目前未繳負債。'}</small></label>
    {currency.toUpperCase() !== 'TWD' ? <label><span>台幣參考匯率</span><input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} /></label> : null}
    {type === 'credit_card' ? <div className="form-columns"><label><span>結帳日</span><input inputMode="numeric" value={closingDay} onChange={(event) => setClosingDay(event.target.value)} /></label><label><span>繳款日</span><input inputMode="numeric" value={paymentDay} onChange={(event) => setPaymentDay(event.target.value)} /></label></div> : null}
    <ToggleRow label="計入淨資產" checked={include} onChange={setInclude} />
    <IconChooser value={iconKey} onChange={setIconKey} />
    {error ? <p className="form-error">{error}</p> : null}<button className="primary-button" type="submit"><Save />儲存帳戶</button>
  </form></main>
}

function AccountManager({ store }: { store: Store }) {
  const accounts = [...store.data.accounts].sort((a, b) => a.sortOrder - b.sortOrder)
  const [dragging, setDragging] = useState('')
  const reorder = async (fromId: string, toId: string) => {
    const from = accounts.findIndex((item) => item.id === fromId)
    const to = accounts.findIndex((item) => item.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...accounts]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved)
    await Promise.all(next.map((item, index) => store.save('accounts', { id: item.id, sortOrder: index })))
  }
  return <main className="workspace-page"><p className="page-intro">拖曳三條線調整順序；點帳戶可在帳戶頁進入設定。已有明細的帳戶只封存，不刪除歷史。</p><div className="manager-list">{accounts.map((account) => <div className={account.archivedAt ? 'archived' : ''} draggable key={account.id} onDragStart={() => setDragging(account.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => void reorder(dragging, account.id)}><GripVertical /><EntityIcon iconKey={account.iconKey} /><span><b>{account.name}</b><small>{accountTypeLabels[account.type]}{account.archivedAt ? ' · 已封存' : ''}</small></span><button type="button" onClick={() => void store.archive('accounts', account.id, !account.archivedAt)}>{account.archivedAt ? '啟用' : '封存'}</button></div>)}</div></main>
}

function AccountAdjustPage({ store, accountId, onDone }: { store: Store; accountId: string; onDone: () => void }) {
  const account = store.data.accounts.find((item) => item.id === accountId)
  const current = account ? calculateBalances(store.data.accounts, store.data.transactions)[account.id] ?? 0 : 0
  const accountCurrency = account?.currency ?? 'TWD'
  const [actual, setActual] = useState(String(fromMinor(current, accountCurrency)))
  const [note, setNote] = useState('對帳差異')
  if (!account) return <main className="workspace-page"><div className="simple-empty">找不到帳戶</div></main>
  const difference = toMinor(actual || 0, accountCurrency) - current
  const submit = async () => {
    if (!difference) return
    const direction: Direction = account.type === 'credit_card' ? (difference > 0 ? 'expense' : 'income') : (difference > 0 ? 'income' : 'expense')
    const category = store.data.categories.find((item) => item.systemKey === `balance_adjustment_${direction}`)
    if (!category) return
    await store.save('transactions', {
      kind: 'balance_adjustment', occurredOn: todayIso(), note,
      accountMoves: [{ accountId: account.id, deltaMinor: difference, currency: account.currency }],
      reportLines: [{ direction, categoryId: category.id, amountMinor: Math.abs(difference), currency: account.currency, amountTwdMinor: Math.abs(difference), countsTowardBudget: false }],
      adjustment: { accountId: account.id, beforeMinor: current, actualMinor: current + difference, differenceMinor: difference },
    })
    onDone()
  }
  return <main className="workspace-page"><section className="adjust-card"><span>帳面餘額</span><strong>{money(current, account.currency)}</strong></section><div className="settings-form"><label><span>實際餘額</span><input inputMode="numeric" value={actual} onChange={(event) => setActual(event.target.value)} /></label><div className="difference-row"><span>將產生帳務調整</span><b className={difference < 0 ? 'expense-text' : 'income-text'}>{difference > 0 ? '+' : ''}{money(difference, account.currency)}</b></div><label><span>備註</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="primary-button" type="button" disabled={!difference} onClick={() => void submit()}><Save />儲存調整</button></div></main>
}

function TransactionsPage({ store, onEdit }: { store: Store; onEdit: (transaction: FinanceTransaction) => void }) {
  const [filter, setFilter] = useState<'all' | TransactionKind>('all')
  const transactions = activeTransactions(store.data.transactions).filter((item) => filter === 'all' || item.kind === filter).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
  return <main className="workspace-page"><div className="filter-chips">{([['all', '全部'], ['expense', '支出'], ['income', '收入'], ['transfer', '轉帳'], ['advance', '代墊']] as const).map(([value, label]) => <button className={filter === value ? 'active' : ''} type="button" key={value} onClick={() => setFilter(value)}>{label}</button>)}</div><TransactionRows transactions={transactions} data={store.data} onEdit={onEdit} /></main>
}

function CalendarPage({ store, onEdit }: { store: Store; onEdit: (transaction: FinanceTransaction) => void }) {
  const [month, setMonth] = useState(currentMonth())
  const [selected, setSelected] = useState(todayIso())
  const [yearNumber, monthNumber] = month.split('-').map(Number)
  const days = new Date(yearNumber, monthNumber, 0).getDate()
  const start = new Date(yearNumber, monthNumber - 1, 1).getDay()
  const byDay = Object.fromEntries(Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`
    const items = activeTransactions(store.data.transactions).filter((item) => item.occurredOn === date)
    return [date, items]
  })) as Record<string, FinanceTransaction[]>
  const moveMonth = (delta: number) => { const date = new Date(yearNumber, monthNumber - 1 + delta, 1); const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; setMonth(next); setSelected(`${next}-01`) }
  return <main className="workspace-page"><div className="calendar-switch"><button type="button" onClick={() => moveMonth(-1)}><ChevronLeft /></button><strong>{yearNumber} 年 {monthNumber} 月</strong><button type="button" onClick={() => moveMonth(1)}><ChevronRight /></button></div><div className="calendar-week">{['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid-v2">{Array.from({ length: start }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => { const date = `${month}-${String(index + 1).padStart(2, '0')}`; const items = byDay[date]; const hasIncome = items.some((item) => item.reportLines.some((line) => line.direction === 'income')); const hasExpense = items.some((item) => item.reportLines.some((line) => line.direction === 'expense')); return <button className={selected === date ? 'selected' : ''} type="button" key={date} onClick={() => setSelected(date)}><b>{index + 1}</b><i>{hasIncome ? <em className="income-dot" /> : null}{hasExpense ? <em className="expense-dot" /> : null}</i></button> })}</div><section className="workspace-section"><div className="section-heading"><h2>{formatDate(selected)}</h2></div><TransactionRows transactions={byDay[selected] ?? []} data={store.data} onEdit={onEdit} /></section></main>
}

function ReportsPage({ store }: { store: Store }) {
  const [period, setPeriod] = useState<'本月' | '近三個月' | '今年'>('本月')
  const range = monthRange(period)
  const totals = reportForRange(store.data.transactions, range.from, range.to)
  const balances = calculateBalances(store.data.accounts, store.data.transactions)
  const net = calculateNetWorth(store.data.accounts, balances)
  const categories = Object.entries(totals.byCategory).filter(([, value]) => value < 0).map(([id, value]) => ({ category: store.data.categories.find((item) => item.id === id), amount: Math.abs(value) })).sort((a, b) => b.amount - a.amount)
  const maxCategory = Math.max(...categories.map((item) => item.amount), 1)
  const monthSeries = buildReportSeries(store.data, range.from, range.to)
  return <main className="workspace-page"><div className="filter-chips report-period">{(['本月', '近三個月', '今年'] as const).map((item) => <button className={period === item ? 'active' : ''} type="button" onClick={() => setPeriod(item)} key={item}>{item}</button>)}</div><section className="report-summary"><article><span>收入</span><b className="income-text">{money(totals.income)}</b></article><article><span>支出</span><b className="expense-text">{money(totals.expense)}</b></article><article><span>淨資產</span><b>{money(net.netWorth)}</b></article></section><section className="report-card"><h2>收入、支出與淨資產趨勢</h2><div className="trend-table">{monthSeries.map((item) => <div key={item.month}><strong>{Number(item.month.slice(5))} 月</strong><span className="income-text">收入 {money(item.income)}</span><span className="expense-text">支出 {money(item.expense)}</span><span>淨資產 {money(item.netWorth)}</span></div>)}</div></section><section className="report-card"><h2>支出分類</h2><div className="category-bars">{categories.map((item) => <div key={item.category?.id}><span><b>{item.category?.name ?? '其他'}</b><strong>{money(item.amount)}</strong></span><i><b style={{ width: `${item.amount / maxCategory * 100}%` }} /></i></div>)}</div></section></main>
}

function buildReportSeries(data: FinanceData, from: string, to: string) {
  return monthSequence(from, to).map((month) => {
    const report = reportForMonth(data.transactions, month)
    const transactionsToDate = data.transactions.filter((item) => item.occurredOn <= `${month}-31`)
    const net = calculateNetWorth(data.accounts, calculateBalances(data.accounts, transactionsToDate))
    return { month, income: report.income, expense: report.expense, netWorth: net.netWorth }
  })
}

function BudgetSummaryPage({ store, onEditTransaction }: { store: Store; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const month = currentMonth()
  const report = reportForMonth(store.data.transactions, month)
  const rows = monthlyBudgetRows(store.data.budgets, store.data.categories, store.data.transactions, month)
  const [categoryId, setCategoryId] = useState('')
  const selectedTransactions = activeTransactions(store.data.transactions).filter((transaction) => monthKey(transaction.occurredOn) === month && transaction.reportLines.some((line) => line.categoryId === categoryId))
  return <main className="workspace-page"><section className="report-summary"><article><span>本月收入</span><b className="income-text">{money(report.income)}</b></article><article><span>本月支出</span><b className="expense-text">{money(report.expense)}</b></article><article><span>本月結餘</span><b>{money(report.balance)}</b></article></section><div className="budget-rows-v2">{rows.map((row) => { const percent = row.monthlyAmount ? Math.round(row.spent / row.monthlyAmount * 100) : 0; return <button type="button" key={row.budget.id} onClick={() => setCategoryId(row.category?.id ?? '')}><EntityIcon iconKey={row.category?.iconKey ?? 'circle-dollar-sign'} /><span><b>{row.category?.name}</b><small>月 {money(row.monthlyAmount)} · 年 {money(row.annualAmount)}</small><i><em style={{ width: `${Math.min(100, percent)}%` }} /></i></span><strong className={row.spent > row.monthlyAmount ? 'expense-text' : ''}>{money(row.spent)}<small>剩餘 {money(row.monthlyAmount - row.spent)}</small></strong><ChevronRight /></button> })}</div>{categoryId ? <section className="workspace-section"><div className="section-heading"><h2>{store.data.categories.find((item) => item.id === categoryId)?.name}明細</h2><button type="button" onClick={() => setCategoryId('')}>收合</button></div><TransactionRows transactions={selectedTransactions} data={store.data} onEdit={onEditTransaction} /></section> : null}</main>
}

function MorePage({ onPush }: { onPush: (route: Route) => void }) {
  const items = [
    { route: 'budgets' as const, label: '預算設定', description: '每月與年度分類預算', icon: CircleDollarSign },
    { route: 'projects' as const, label: '專案', description: '旅行、活動等獨立收支', icon: ReceiptText },
    { route: 'recurring' as const, label: '定期項目', description: '待確認與自動入帳規則', icon: CalendarDays },
    { route: 'advances' as const, label: '代墊與分帳', description: '應收、應付與收還款', icon: HandCoins },
    { route: 'categories' as const, label: '分類與圖示', description: '收入、支出分類與排序', icon: Settings },
  ]
  return <main className="workspace-page"><div className="settings-menu-v2">{items.map((item) => { const Icon = item.icon; return <button type="button" key={item.route} onClick={() => onPush({ name: item.route })}><span className="entity-icon"><Icon /></span><span><b>{item.label}</b><small>{item.description}</small></span><ChevronRight /></button> })}</div></main>
}

function CategoryManager({ store, onPush }: { store: Store; onPush: (route: Route) => void }) {
  const [direction, setDirection] = useState<Direction>('expense')
  const categories = [...store.data.categories].filter((item) => item.direction === direction).sort((a, b) => a.sortOrder - b.sortOrder)
  const move = async (category: Category, delta: number) => {
    const index = categories.findIndex((item) => item.id === category.id)
    const swap = categories[index + delta]
    if (!swap) return
    await Promise.all([store.save('categories', { id: category.id, sortOrder: swap.sortOrder }), store.save('categories', { id: swap.id, sortOrder: category.sortOrder })])
  }
  return <main className="workspace-page"><div className="filter-chips"><button className={direction === 'expense' ? 'active' : ''} type="button" onClick={() => setDirection('expense')}>支出</button><button className={direction === 'income' ? 'active' : ''} type="button" onClick={() => setDirection('income')}>收入</button></div><div className="category-manager-grid">{categories.map((category) => <div className={category.archivedAt ? 'archived' : ''} key={category.id}><button type="button" className="category-main" onClick={() => onPush({ name: 'category-form', id: category.id })}><EntityIcon iconKey={category.iconKey} /><b>{category.name}</b></button><span><button type="button" aria-label="往前移" onClick={() => void move(category, -1)}><ArrowUp /></button><button type="button" aria-label="往後移" onClick={() => void move(category, 1)}><ArrowDown /></button><button type="button" onClick={() => void store.archive('categories', category.id, !category.archivedAt)}>{category.archivedAt ? '啟用' : '封存'}</button></span></div>)}</div><button className="floating-add" type="button" onClick={() => onPush({ name: 'category-form' })}><Plus />新增分類</button></main>
}

function CategoryForm({ store, categoryId, onDone }: { store: Store; categoryId?: string; onDone: () => void }) {
  const existing = store.data.categories.find((item) => item.id === categoryId)
  const [name, setName] = useState(existing?.name ?? '')
  const [direction, setDirection] = useState<Direction>(existing?.direction ?? 'expense')
  const [iconKey, setIconKey] = useState(existing?.iconKey ?? 'circle-dollar-sign')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; await store.save('categories', { id: existing?.id, name: name.trim(), direction, iconKey, sortOrder: existing?.sortOrder ?? store.data.categories.filter((item) => item.direction === direction).length, systemKey: existing?.systemKey }); onDone() }
  return <main className="workspace-page"><form className="settings-form" onSubmit={(event) => void submit(event)}><label><span>分類名稱</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>收支類型</span><select value={direction} disabled={Boolean(existing?.systemKey)} onChange={(event) => setDirection(event.target.value as Direction)}><option value="expense">支出</option><option value="income">收入</option></select></label><IconChooser value={iconKey} onChange={setIconKey} /><button className="primary-button" type="submit"><Save />儲存分類</button></form></main>
}

function BudgetManager({ store }: { store: Store }) {
  const categories = activeSorted(store.data.categories.filter((item) => item.direction === 'expense' && !item.systemKey))
  const rows = categories.map((category) => ({ category, budget: store.data.budgets.find((item) => item.categoryId === category.id && !item.archivedAt) }))
  const totalMonth = rows.reduce((sum, row) => sum + (row.budget ? row.budget.cycle === 'monthly' ? row.budget.amountMinor : row.budget.amountMinor / 12 : 0), 0)
  const totalYear = rows.reduce((sum, row) => sum + (row.budget ? row.budget.cycle === 'annual' ? row.budget.amountMinor : row.budget.amountMinor * 12 : 0), 0)
  return <main className="workspace-page"><section className="budget-total"><span>分類預算加總</span><div><b>每月 {money(Math.round(totalMonth))}</b><b>年度 {money(Math.round(totalYear))}</b></div></section><div className="budget-editor-list">{rows.map(({ category, budget }) => <BudgetEditor key={category.id} category={category} budget={budget} store={store} />)}</div></main>
}

function BudgetEditor({ category, budget, store }: { category: Category; budget?: Budget; store: Store }) {
  const [cycle, setCycle] = useState<'monthly' | 'annual'>(budget?.cycle ?? 'monthly')
  const [amount, setAmount] = useState(String(budget?.amountMinor ?? ''))
  const [saved, setSaved] = useState(false)
  const save = async () => { const value = numberValue(amount); if (!value) return; await store.save('budgets', { id: budget?.id, categoryId: category.id, cycle, amountMinor: value, year: cycle === 'annual' ? Number(todayIso().slice(0, 4)) : undefined }); setSaved(true); setTimeout(() => setSaved(false), 1200) }
  return <div><EntityIcon iconKey={category.iconKey} /><span><b>{category.name}</b><select value={cycle} onChange={(event) => setCycle(event.target.value as 'monthly' | 'annual')}><option value="monthly">每月預算</option><option value="annual">年度預算</option></select></span><input inputMode="numeric" placeholder="金額" value={amount} onChange={(event) => setAmount(event.target.value)} /><button type="button" onClick={() => void save()}>{saved ? <Check /> : <Save />}</button></div>
}

function ProjectsPage({ store, onPush }: { store: Store; onPush: (route: Route) => void }) {
  const projects = activeSorted(store.data.projects)
  return <main className="workspace-page"><div className="project-grid">{projects.map((project) => { const totals = projectTotals(store.data.transactions, project.id); return <button type="button" key={project.id} onClick={() => onPush({ name: 'project-detail', id: project.id })}><EntityIcon iconKey={project.iconKey} /><span><b>{project.name}</b><small>{project.startDate || '未設定期間'}{project.endDate ? `－${project.endDate}` : ''}</small></span><strong className="expense-text">支出 {money(totals.expense)}</strong><ChevronRight /></button> })}</div><button className="floating-add" type="button" onClick={() => onPush({ name: 'project-form' })}><Plus />新增專案</button></main>
}

function projectTotals(transactions: FinanceTransaction[], projectId: string) {
  let income = 0; let expense = 0
  for (const transaction of activeTransactions(transactions).filter((item) => item.projectId === projectId)) {
    for (const line of transaction.reportLines) {
      if (line.direction === 'income') income += line.amountTwdMinor
      else expense += line.amountTwdMinor
    }
  }
  return { income, expense, balance: income - expense }
}

function ProjectDetailPage({ store, projectId, onPush, onEditTransaction }: { store: Store; projectId: string; onPush: (route: Route) => void; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const project = store.data.projects.find((item) => item.id === projectId)
  if (!project) return <main className="workspace-page"><div className="simple-empty">找不到專案</div></main>
  const transactions = activeTransactions(store.data.transactions).filter((item) => item.projectId === project.id).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
  const totals = projectTotals(transactions, project.id)
  const spentPercent = project.budgetMinor ? Math.round(totals.expense / project.budgetMinor * 100) : 0
  return <main className="workspace-page"><section className="project-hero"><EntityIcon iconKey={project.iconKey} /><h2>{project.name}</h2><p>{project.note || '沒有專案說明'}</p><div><span>收入 <b className="income-text">{money(totals.income)}</b></span><span>支出 <b className="expense-text">{money(totals.expense)}</b></span><span>結餘 <b>{money(totals.balance)}</b></span></div>{project.budgetMinor ? <small>預算已使用 {spentPercent}% · 剩餘 {money(project.budgetMinor - totals.expense)}</small> : null}<button type="button" onClick={() => onPush({ name: 'project-form', id: project.id })}><Pencil />編輯專案</button></section><section className="workspace-section"><div className="section-heading"><h2>專案明細</h2></div><TransactionRows transactions={transactions} data={store.data} onEdit={onEditTransaction} /></section></main>
}

function ProjectForm({ store, projectId, onDone }: { store: Store; projectId?: string; onDone: () => void }) {
  const existing = store.data.projects.find((item) => item.id === projectId)
  const [name, setName] = useState(existing?.name ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [budget, setBudget] = useState(String(existing?.budgetMinor ?? ''))
  const [startDate, setStartDate] = useState(existing?.startDate ?? '')
  const [endDate, setEndDate] = useState(existing?.endDate ?? '')
  const [iconKey, setIconKey] = useState(existing?.iconKey ?? 'plane')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; await store.save('projects', { id: existing?.id, name: name.trim(), note, budgetMinor: numberValue(budget) || undefined, startDate: startDate || undefined, endDate: endDate || undefined, currency: 'TWD', iconKey, sortOrder: existing?.sortOrder ?? store.data.projects.length }); onDone() }
  return <main className="workspace-page"><form className="settings-form" onSubmit={(event) => void submit(event)}><label><span>專案名稱</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>內容</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><label><span>專案預算</span><input inputMode="numeric" value={budget} onChange={(event) => setBudget(event.target.value)} /></label><div className="form-columns"><label><span>開始日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span>結束日期</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div><IconChooser value={iconKey} onChange={setIconKey} /><button className="primary-button" type="submit"><Save />儲存專案</button>{existing ? <button className="danger-button" type="button" onClick={() => void store.archive('projects', existing.id, true).then(onDone)}><Trash2 />封存專案</button> : null}</form></main>
}

async function postRecurringRule(store: Store, rule: RecurringRule) {
  const template = rule.transactionTemplate
  const occurrenceId = `${rule.id}_${rule.nextScheduledOn}`
  if (store.data.transactions.some((item) => item.recurringOccurrenceId === occurrenceId)) return
  const account = store.data.accounts.find((item) => item.id === template.accountId || item.id === template.fromAccountId)
  const toAccount = store.data.accounts.find((item) => item.id === template.toAccountId)
  const category = store.data.categories.find((item) => item.id === template.categoryId)
  if (template.kind === 'transfer' && account && toAccount && account.currency === toAccount.currency) await store.save('transactions', { id: occurrenceId, kind: 'transfer', occurredOn: rule.nextScheduledOn, note: template.note || rule.name, accountMoves: [{ accountId: account.id, deltaMinor: outflowDelta(account, template.amountMinor), currency: account.currency }, { accountId: toAccount.id, deltaMinor: inflowDelta(toAccount, template.amountMinor), currency: toAccount.currency }], reportLines: [], transfer: { fromAccountId: account.id, toAccountId: toAccount.id, fromAmountMinor: template.amountMinor, toAmountMinor: template.amountMinor, feeMinor: 0 }, recurringOccurrenceId: occurrenceId })
  else if (account && category) {
    const direction: Direction = template.kind === 'income' ? 'income' : 'expense'
    await store.save('transactions', { id: occurrenceId, kind: direction, occurredOn: rule.nextScheduledOn, note: template.note || rule.name, projectId: template.projectId, accountMoves: [{ accountId: account.id, deltaMinor: direction === 'income' ? inflowDelta(account, template.amountMinor) : outflowDelta(account, template.amountMinor), currency: account.currency }], reportLines: [{ direction, categoryId: category.id, amountMinor: template.amountMinor, currency: account.currency, amountTwdMinor: Math.round(fromMinor(template.amountMinor, account.currency) * (account.currency === 'TWD' ? 1 : account.referenceRateToTwd ?? 0)), countsTowardBudget: true }], recurringOccurrenceId: occurrenceId })
  } else return
  await store.save('recurringRules', { id: rule.id, nextScheduledOn: addRecurringPeriod(rule.nextScheduledOn, rule.frequency) })
}

function RecurringPage({ store, onPush, onEditTransaction }: { store: Store; onPush: (route: Route) => void; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const rules = activeSorted(store.data.recurringRules)
  const pending = pendingRecurring(rules)
  const posted = activeTransactions(store.data.transactions).filter((item) => item.recurringOccurrenceId)
  return <main className="workspace-page">{pending.length ? <section className="workspace-section first-section"><div className="section-heading"><h2>待確認</h2><span>{pending.length} 筆</span></div><div className="recurring-list">{pending.map((rule) => <div key={rule.id}><EntityIcon iconKey={rule.iconKey} /><span><b>{rule.name}</b><small>{rule.nextScheduledOn} · {rule.postingMode === 'confirm' ? '確認後入帳' : '自動入帳'}</small></span><strong>{money(rule.transactionTemplate.amountMinor)}</strong><span className="recurring-actions"><button type="button" onClick={() => void store.save('recurringRules', { id: rule.id, nextScheduledOn: addRecurringPeriod(rule.nextScheduledOn, rule.frequency) })}>略過</button><button type="button" onClick={() => void postRecurringRule(store, rule)}><Check />入帳</button></span></div>)}</div></section> : <div className="simple-empty compact">目前沒有待確認項目</div>}<section className="workspace-section"><div className="section-heading"><h2>全部規則</h2></div><div className="settings-menu-v2">{rules.map((rule) => <button type="button" key={rule.id} onClick={() => onPush({ name: 'recurring-form', id: rule.id })}><EntityIcon iconKey={rule.iconKey} /><span><b>{rule.name}</b><small>下次 {rule.nextScheduledOn} · 提前 {rule.previewDays} 天</small></span><ChevronRight /></button>)}</div></section>{posted.length ? <section className="workspace-section"><div className="section-heading"><h2>已入帳紀錄</h2></div><TransactionRows transactions={posted} data={store.data} onEdit={onEditTransaction} /></section> : null}<button className="floating-add" type="button" onClick={() => onPush({ name: 'recurring-form' })}><Plus />新增定期項目</button></main>
}

function RecurringForm({ store, ruleId, onDone }: { store: Store; ruleId?: string; onDone: () => void }) {
  const existing = store.data.recurringRules.find((item) => item.id === ruleId)
  const existingAccount = store.data.accounts.find((item) => item.id === existing?.transactionTemplate.accountId || item.id === existing?.transactionTemplate.fromAccountId)
  const [name, setName] = useState(existing?.name ?? '')
  const [kind, setKind] = useState<'income' | 'expense' | 'transfer'>(existing?.transactionTemplate.kind ?? 'expense')
  const [amount, setAmount] = useState(existing ? String(fromMinor(existing.transactionTemplate.amountMinor, existingAccount?.currency ?? 'TWD')) : '')
  const [accountId, setAccountId] = useState(existing?.transactionTemplate.accountId ?? existing?.transactionTemplate.fromAccountId ?? '')
  const [toAccountId, setToAccountId] = useState(existing?.transactionTemplate.toAccountId ?? '')
  const [categoryId, setCategoryId] = useState(existing?.transactionTemplate.categoryId ?? '')
  const [frequency, setFrequency] = useState<RecurringRule['frequency']>(existing?.frequency ?? 'monthly')
  const [nextDate, setNextDate] = useState(existing?.nextScheduledOn ?? todayIso())
  const [mode, setMode] = useState<RecurringRule['postingMode']>(existing?.postingMode ?? 'confirm')
  const [previewDays, setPreviewDays] = useState(String(existing?.previewDays ?? 3))
  const selectedAccount = store.data.accounts.find((item) => item.id === accountId)
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!name.trim() || !Number(amount) || !accountId || !selectedAccount) return; await store.save('recurringRules', { id: existing?.id, name: name.trim(), iconKey: existing?.iconKey ?? 'calendar-days', frequency, nextScheduledOn: nextDate, postingMode: mode, previewDays: numberValue(previewDays), sortOrder: existing?.sortOrder ?? store.data.recurringRules.length, transactionTemplate: { kind, amountMinor: toMinor(amount, selectedAccount.currency), accountId: kind === 'transfer' ? undefined : accountId, fromAccountId: kind === 'transfer' ? accountId : undefined, toAccountId: kind === 'transfer' ? toAccountId : undefined, categoryId: kind === 'transfer' ? undefined : categoryId, note: name.trim() } }); onDone() }
  const categories = activeSorted(store.data.categories.filter((item) => item.direction === kind))
  return <main className="workspace-page"><form className="settings-form" onSubmit={(event) => void submit(event)}><label><span>項目名稱</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>交易類型</span><select value={kind} onChange={(event) => setKind(event.target.value as 'income' | 'expense' | 'transfer')}><option value="expense">支出</option><option value="income">收入</option><option value="transfer">轉帳</option></select></label><label><span>金額</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label><span>{kind === 'transfer' ? '轉出帳戶' : '帳戶'}</span><select value={accountId} onChange={(event) => { setAccountId(event.target.value); setToAccountId('') }}><option value="">請選擇</option>{activeSorted(store.data.accounts).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{kind === 'transfer' ? <label><span>轉入帳戶</span><select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}><option value="">請選擇</option>{activeSorted(store.data.accounts).filter((item) => item.id !== accountId && (!selectedAccount || item.currency === selectedAccount.currency)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>定期轉帳先限相同幣別；跨幣別請到期後確認金額再記。</small></label> : <label><span>分類</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">請選擇</option>{categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}<label><span>頻率</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurringRule['frequency'])}><option value="weekly">每週</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label><label><span>下次日期</span><input type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} /></label><label><span>入帳方式</span><select value={mode} onChange={(event) => setMode(event.target.value as RecurringRule['postingMode'])}><option value="confirm">預設確認</option><option value="auto">自動入帳</option></select></label><label><span>提前顯示天數</span><input inputMode="numeric" value={previewDays} onChange={(event) => setPreviewDays(event.target.value)} /></label><button className="primary-button" type="submit"><Save />儲存定期項目</button>{existing ? <button className="danger-button" type="button" onClick={() => void store.archive('recurringRules', existing.id, true).then(onDone)}><Trash2 />封存規則</button> : null}</form></main>
}

function AdvancesPage({ store, onPush, onNew }: { store: Store; onPush: (route: Route) => void; onNew: () => void }) {
  const [tab, setTab] = useState<'receivable' | 'payable' | 'people'>('receivable')
  const rows = advanceRows(store.data.transactions).filter((row) => row.transaction.advance?.direction === tab)
  const [personName, setPersonName] = useState('')
  const addPerson = async () => { if (!personName.trim()) return; await store.save('advancePeople', { name: personName.trim(), iconKey: 'user-round', sortOrder: store.data.advancePeople.length }); setPersonName('') }
  return <main className="workspace-page"><div className="filter-chips"><button className={tab === 'receivable' ? 'active' : ''} type="button" onClick={() => setTab('receivable')}>別人應還我</button><button className={tab === 'payable' ? 'active' : ''} type="button" onClick={() => setTab('payable')}>我應還別人</button><button className={tab === 'people' ? 'active' : ''} type="button" onClick={() => setTab('people')}>對象</button></div>{tab === 'people' ? <><div className="manager-list">{activeSorted(store.data.advancePeople).map((person) => <div key={person.id}><EntityIcon iconKey={person.iconKey} /><span><b>{person.name}</b></span><button type="button" onClick={() => void store.archive('advancePeople', person.id, true)}>封存</button></div>)}</div><div className="inline-add"><input placeholder="新增對象名稱" value={personName} onChange={(event) => setPersonName(event.target.value)} /><button type="button" onClick={() => void addPerson()}><Plus />新增</button></div></> : <div className="advance-list-v2">{rows.length ? rows.map((row) => { const people = row.transaction.advance?.people.map((share) => store.data.advancePeople.find((person) => person.id === share.personId)?.name).filter(Boolean).join('、'); return <button type="button" key={row.transaction.id} onClick={() => onPush({ name: 'advance-detail', id: row.transaction.id })}><EntityIcon iconKey="hand-coins" /><span><b>{row.transaction.note || '代墊'}</b><small>{people} · {formatDate(row.transaction.occurredOn)}</small></span><strong className={row.remaining ? 'expense-text' : 'income-text'}>剩餘 {money(row.remaining, row.transaction.advance?.currency ?? 'TWD')}</strong><ChevronRight /></button> }) : <div className="simple-empty">目前沒有資料</div>}</div>}<button className="floating-add" type="button" onClick={onNew}><Plus />新增代墊</button></main>
}

function AdvanceDetailPage({ store, transactionId, onEditTransaction }: { store: Store; transactionId: string; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const transaction = store.data.transactions.find((item) => item.id === transactionId)
  const row = advanceRows(store.data.transactions).find((item) => item.transaction.id === transactionId)
  const [personId, setPersonId] = useState(transaction?.advance?.people[0]?.personId ?? '')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  if (!transaction?.advance || !row) return <main className="workspace-page"><div className="simple-empty">找不到代墊資料</div></main>
  const settlements = activeTransactions(store.data.transactions).filter((item) => item.settlement?.advanceTransactionId === transaction.id)
  const personRows = advancePeopleRows(transaction, store.data.transactions)
  const selectedPerson = personRows.find((item) => item.personId === personId)
  const settle = async () => {
    const account = store.data.accounts.find((item) => item.id === accountId); const value = toMinor(amount, account?.currency ?? transaction.advance?.currency ?? 'TWD')
    if (!account || !value || value > row.remaining || value > (selectedPerson?.remainingMinor ?? 0)) return
    const direction = transaction.advance?.direction === 'receivable' ? 'collect' : 'repay'
    await store.save('transactions', { kind: 'settlement', occurredOn: todayIso(), note: direction === 'collect' ? '收到代墊款' : '歸還代墊款', accountMoves: [{ accountId: account.id, deltaMinor: direction === 'collect' ? inflowDelta(account, value) : outflowDelta(account, value), currency: account.currency }], reportLines: [], settlement: { advanceTransactionId: transaction.id, personId, direction, amountMinor: value } })
    setAmount('')
  }
  return <main className="workspace-page"><section className="advance-hero"><EntityIcon iconKey="hand-coins" /><h2>{transaction.note || '代墊'}</h2><span>{transaction.advance.direction === 'receivable' ? '別人應還我' : '我應還別人'}</span><strong>{money(row.remaining, transaction.advance.currency)}</strong><small>原始金額 {money(transaction.advance.totalMinor, transaction.advance.currency)} · 自己負擔 {money(transaction.advance.ownShareMinor, transaction.advance.currency)}</small><button type="button" onClick={() => onEditTransaction(transaction)}><Pencil />編輯原始代墊</button></section><section className="advance-person-breakdown">{personRows.map((person) => <div key={person.personId}><span><b>{store.data.advancePeople.find((item) => item.id === person.personId)?.name ?? '未知對象'}</b><small>應收／應還 {money(person.expectedMinor, transaction.advance?.currency ?? 'TWD')}</small></span><strong>剩餘 {money(person.remainingMinor, transaction.advance?.currency ?? 'TWD')}</strong></div>)}</section>{row.remaining ? <section className="settlement-form"><h2>{transaction.advance.direction === 'receivable' ? '記錄收款' : '記錄還款'}</h2><label><span>對象</span><select value={personId} onChange={(event) => setPersonId(event.target.value)}>{personRows.filter((person) => person.remainingMinor > 0).map((share) => <option value={share.personId} key={share.personId}>{store.data.advancePeople.find((item) => item.id === share.personId)?.name ?? '未知對象'}（剩餘 {money(share.remainingMinor, transaction.advance?.currency ?? 'TWD')}）</option>)}</select></label><label><span>帳戶</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">請選擇</option>{activeSorted(store.data.accounts).filter((item) => item.currency === transaction.advance?.currency).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>收還款帳戶需與原代墊幣別相同。</small></label><label><span>金額</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><button className="primary-button" type="button" onClick={() => void settle()}><Save />儲存{transaction.advance.direction === 'receivable' ? '收款' : '還款'}</button></section> : <div className="paid-off"><Check />已全部結清</div>}<section className="workspace-section"><div className="section-heading"><h2>收還款紀錄</h2></div><TransactionRows transactions={settlements} data={store.data} onEdit={onEditTransaction} /></section></main>
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>
}

function IconChooser({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return <fieldset className="icon-chooser"><legend>圖示</legend><div>{selectableIcons.map((key) => { const Icon = iconFor(key); return <button className={value === key ? 'selected' : ''} type="button" aria-label={key} key={key} onClick={() => onChange(key)}><Icon />{value === key ? <Check /> : null}</button> })}</div></fieldset>
}
