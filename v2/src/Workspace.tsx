import { useEffect, useRef, useState, type FormEvent, type ReactNode, type TouchEvent } from 'react'
import type { User } from 'firebase/auth'
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpDown,
  ArrowUpRight,
  ChartColumn,
  CalendarDays,
  ChartPie,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  Eye,
  EyeOff,
  GripVertical,
  Handshake,
  HandCoins,
  Home,
  Landmark,
  List,
  LogOut,
  Menu,
  Pencil,
  Plus,
  ReceiptText,
  Repeat2,
  Scale,
  Save,
  Settings,
  SlidersHorizontal,
  Trash2,
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
  monthlyBudgetRows,
  pendingRecurring,
  reportForMonth,
  reportForRange,
  reportRangeForPeriod,
  type ReportPeriod,
  todayIso,
  toMinor,
} from './finance.ts'
import { iconFor, selectableIcons } from './icons.tsx'
import type {
  Account,
  AccountType,
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
  | 'transactions' | 'budget' | 'budget-category' | 'budgets' | 'budget-form' | 'pending'
  | 'account-detail' | 'account-form' | 'account-adjust'
  | 'transaction-filter' | 'report-filter' | 'report-category' | 'report-date'
  | 'categories' | 'category-form' | 'category-picker'
  | 'account-picker' | 'project-picker'
  | 'projects' | 'project-detail' | 'project-form'
  | 'recurring' | 'recurring-form'
  | 'advances' | 'advance-detail' | 'settlement'

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
  shareNames: Record<string, string>
  shareOrder: string[]
}

type TransactionFilter = { kind: 'all' | TransactionKind; categoryId: string; projectId: string; from: string; to: string }
type ReportRange = { from: string; to: string; accountId: string; projectId: string }
type ReportSelection = ReportPeriod | '自訂'
type ReportMode = 'expense' | 'income' | 'balance'

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
const toTwdMinor = (amountMinor: number, account: Account) => Math.round(fromMinor(amountMinor, account.currency) * (account.currency === 'TWD' ? 1 : account.referenceRateToTwd ?? 0))
const formatDate = (date: string) => new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00`))
const formatEntryDate = (date: string) => {
  const value = new Date(`${date}T00:00:00`)
  const weekday = new Intl.DateTimeFormat('zh-TW', { weekday: 'short' }).format(value)
  return `${value.getFullYear()} 年 ${value.getMonth() + 1} 月 ${value.getDate()} 日 ${weekday}`
}
const currentMonth = () => monthKey(todayIso())
const displayAmount = (value: string) => Number(value.replaceAll(',', '')) || 0
const formatDateHeading = (date: string) => {
  const value = new Date(`${date}T00:00:00`)
  const weekday = new Intl.DateTimeFormat('zh-TW', { weekday: 'short' }).format(value)
  return `${value.getMonth() + 1} 月 ${value.getDate()} 日（${weekday}）`
}
const touchSortTarget = (event: TouchEvent) => {
  const touch = event.touches[0] ?? event.changedTouches[0]
  if (!touch) return ''
  return document.elementFromPoint(touch.clientX, touch.clientY)?.closest<HTMLElement>('[data-sort-id]')?.dataset.sortId ?? ''
}

function emptyEntry(kind: EntryKind = 'expense', accountId = '', categoryId = '', toAccountId = ''): EntryDraft {
  return { kind, date: todayIso(), amount: '', toAmount: '', categoryId, accountId, toAccountId, projectId: '', note: '', fee: '', advanceDirection: 'receivable', ownShare: '', shares: { 'share-1': '' }, shareNames: { 'share-1': '' }, shareOrder: ['share-1'] }
}

function newEntryDraft(kind: EntryKind, data: FinanceData, preferredAccountId = '') {
  const accounts = activeSorted(data.accounts)
  const accountId = preferredAccountId || accounts[0]?.id || ''
  const toAccountId = kind === 'transfer' ? accounts.find((item) => item.id !== accountId)?.id ?? '' : ''
  const direction: Direction = kind === 'income' ? 'income' : 'expense'
  const categoryId = activeSorted(data.categories.filter((item) => item.direction === direction))[0]?.id ?? ''
  return emptyEntry(kind, accountId, categoryId, toAccountId)
}

function draftFromTransaction(transaction: FinanceTransaction, data: FinanceData): EntryDraft {
  const firstMove = transaction.accountMoves[0]
  const transfer = transaction.transfer
  const firstAccount = data.accounts.find((item) => item.id === (transfer?.fromAccountId ?? firstMove?.accountId))
  const toAccount = data.accounts.find((item) => item.id === transfer?.toAccountId)
  const currency = transaction.advance?.currency ?? transaction.reportLines[0]?.currency ?? firstAccount?.currency ?? 'TWD'
  const shares = Object.fromEntries(transaction.advance?.people.map((person) => [person.personId, String(fromMinor(person.expectedMinor, currency))]) ?? [])
  const shareNames = Object.fromEntries(transaction.advance?.people.map((person) => [person.personId, person.name ?? data.advancePeople.find((item) => item.id === person.personId)?.name ?? '']) ?? [])
  const shareOrder = transaction.advance?.people.map((person) => person.personId) ?? []
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
    shareNames,
    shareOrder: shareOrder.length ? shareOrder : ['share-1'],
  }
}

function draftFromRecurringRule(rule: RecurringRule, data: FinanceData): EntryDraft {
  const template = rule.transactionTemplate
  const accountId = template.accountId ?? template.fromAccountId ?? ''
  const account = data.accounts.find((item) => item.id === accountId)
  return {
    ...emptyEntry(template.kind, accountId, template.categoryId ?? '', template.toAccountId ?? ''),
    date: rule.nextScheduledOn,
    amount: String(fromMinor(template.amountMinor, account?.currency ?? 'TWD')),
    projectId: template.projectId ?? '',
    note: template.note ?? rule.name,
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
  const [pendingRuleId, setPendingRuleId] = useState('')
  const [hideBalances, setHideBalances] = useState(false)
  const [manageAccounts, setManageAccounts] = useState(false)
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>({ kind: 'all', categoryId: '', projectId: '', from: '', to: '' })
  const [reportRange, setReportRange] = useState<ReportRange>({ from: `${todayIso().slice(0, 4)}-01-01`, to: todayIso(), accountId: '', projectId: '' })
  const [reportPeriod, setReportPeriod] = useState<ReportSelection>('月')
  const [reportAnchorMonth, setReportAnchorMonth] = useState(currentMonth())
  const [reportMode, setReportMode] = useState<ReportMode>('expense')
  const [transactionView, setTransactionView] = useState<'calendar' | 'list'>('calendar')
  const autoPosting = useRef(new Set<string>())
  const swipeStart = useRef<number | null>(null)
  const route = routes.at(-1) ?? { name: 'home' as const }
  const root = routes[0]?.name ?? 'home'

  const push = (next: Route) => setRoutes((current) => [...current, next])
  const back = () => setRoutes((current) => current.length > 1 ? current.slice(0, -1) : current)
  const goRoot = (name: RouteName) => {
    if (!rootRoutes.includes(name)) return
    setRoutes([{ name }])
    if (name !== 'accounts') setManageAccounts(false)
    if (name === 'entry') {
      setEntryDraft(newEntryDraft('expense', store.data))
      setEditingTransactionId('')
      setPendingRuleId('')
    }
  }
  const openNewEntry = (kind: EntryKind = 'expense', accountId = '') => {
    setEntryDraft(newEntryDraft(kind, store.data, accountId))
    setEditingTransactionId('')
    setPendingRuleId('')
    push({ name: 'entry' })
  }
  const continueEntry = (kind: EntryKind) => {
    setEntryDraft(newEntryDraft(kind, store.data))
    setEditingTransactionId('')
    setPendingRuleId('')
  }
  const editTransaction = (transaction: FinanceTransaction) => {
    setEntryDraft(draftFromTransaction(transaction, store.data))
    setEditingTransactionId(transaction.id)
    setPendingRuleId('')
    push({ name: 'entry', id: transaction.id })
  }
  const openPendingEntry = (rule: RecurringRule) => {
    setEntryDraft(draftFromRecurringRule(rule, store.data))
    setEditingTransactionId('')
    setPendingRuleId(rule.id)
    push({ name: 'entry', id: `recurring:${rule.id}` })
  }
  const leaveEntry = () => {
    setPendingRuleId('')
    if (routes.length > 1) back()
    else goRoot('home')
  }

  const pendingRules = pendingRecurring(store.data.recurringRules)
  const unsettled = advanceRows(store.data.transactions).filter((item) => item.remaining > 0)
  const accountBalances = calculateBalances(store.data.accounts, store.data.transactions)
  const projectSpent = (projectId: string) => activeTransactions(store.data.transactions).filter((transaction) => transaction.projectId === projectId).flatMap((transaction) => transaction.reportLines.filter((line) => line.direction === 'expense')).reduce((sum, line) => sum + line.amountTwdMinor, 0)
  const title = routeTitle(route, store.data)
  const showBack = routes.length > 1

  useEffect(() => {
    if (!store.ready) return
    for (const rule of pendingRules.filter((item) => item.postingMode === 'auto' && item.nextScheduledOn <= todayIso())) {
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
      case 'home': return <HomePage store={store} onPush={push} onEditTransaction={editTransaction} hideBalances={hideBalances} />
      case 'accounts': return <AccountsPage store={store} onPush={push} hideBalances={hideBalances} managing={manageAccounts} />
      case 'account-detail': return <AccountDetailPage store={store} accountId={route.id ?? ''} onPush={push} onEntry={openNewEntry} onEditTransaction={editTransaction} filter={transactionFilter} />
      case 'account-form': return <AccountFormPage store={store} accountId={route.id} onDone={back} />
      case 'account-adjust': return <AccountAdjustPage store={store} accountId={route.id ?? ''} onDone={back} />
      case 'entry': return <EntryPage store={store} draft={entryDraft} setDraft={setEntryDraft} editingId={editingTransactionId} recurringRule={store.data.recurringRules.find((item) => item.id === pendingRuleId)} onPush={push} onBack={leaveEntry} onDone={leaveEntry} onContinue={continueEntry} />
      case 'category-picker': return <PickerPage title="選擇分類" items={activeSorted(store.data.categories.filter((item) => item.direction === (entryDraft.kind === 'income' ? 'income' : 'expense')))} selectedId={entryDraft.categoryId} onBack={back} onSelect={(id) => { setEntryDraft((draft) => ({ ...draft, categoryId: id })); back() }} />
      case 'account-picker': return <PickerPage title={route.id === 'to' ? '選擇轉入帳戶' : entryDraft.kind === 'income' ? '選擇入帳帳戶' : entryDraft.kind === 'transfer' ? '選擇轉出帳戶' : '選擇付款帳戶'} items={activeSorted(store.data.accounts).filter((item) => item.id !== (route.id === 'to' ? entryDraft.accountId : entryDraft.toAccountId))} selectedId={route.id === 'to' ? entryDraft.toAccountId : entryDraft.accountId} variant="list" getMeta={(item) => `${accountTypeLabels[item.type]}・${item.currency}`} getEnd={(item) => money((item.type === 'credit_card' ? -1 : 1) * (accountBalances[item.id] ?? 0), item.currency)} getEndClass={(item) => item.type === 'credit_card' ? 'expense-text' : ''} onBack={back} onSelect={(id) => { setEntryDraft((draft) => ({ ...draft, [route.id === 'to' ? 'toAccountId' : 'accountId']: id })); back() }} />
      case 'project-picker': return <PickerPage title="選擇專案" items={activeSorted(store.data.projects)} selectedId={entryDraft.projectId} allowNone variant="list" getMeta={(item) => item.budgetMinor ? `已用 ${money(projectSpent(item.id))} / ${money(item.budgetMinor)}` : item.note || '未設定預算'} onBack={back} onSelect={(id) => { setEntryDraft((draft) => ({ ...draft, projectId: id })); back() }} />
      case 'transactions': return <TransactionsPage store={store} onEdit={editTransaction} view={transactionView} />
      case 'transaction-filter': return <TransactionFilterPage store={store} value={transactionFilter} onChange={setTransactionFilter} onDone={back} />
      case 'reports': return <ReportsPage store={store} customRange={reportRange} period={reportPeriod} setPeriod={setReportPeriod} anchorMonth={reportAnchorMonth} setAnchorMonth={setReportAnchorMonth} mode={reportMode} onCustom={() => push({ name: 'report-filter' })} onCategory={(direction, id) => push({ name: 'report-category', id: `${direction}:${id}` })} onDate={(id) => push({ name: 'report-date', id })} />
      case 'report-filter': return <ReportFilterPage store={store} value={reportRange} onChange={setReportRange} onDone={back} />
      case 'report-category': return <ReportCategoryPage store={store} reference={route.id ?? ''} customRange={reportRange} period={reportPeriod} anchorMonth={reportAnchorMonth} onEditTransaction={editTransaction} />
      case 'report-date': return <ReportDatePage store={store} dateKey={route.id ?? ''} customRange={reportRange} period={reportPeriod} onEditTransaction={editTransaction} />
      case 'budget': return <BudgetSummaryPage store={store} onPush={push} />
      case 'budget-category': return <BudgetCategoryPage store={store} categoryId={route.id ?? ''} onEditTransaction={editTransaction} />
      case 'more': return <MorePage onPush={push} />
      case 'categories': return <CategoryManager store={store} onPush={push} />
      case 'category-form': return <CategoryForm store={store} categoryId={route.id} onDone={back} />
      case 'budgets': return <BudgetManager store={store} onPush={push} />
      case 'budget-form': return <BudgetForm store={store} budgetId={route.id} onDone={back} />
      case 'projects': return <ProjectsPage store={store} onPush={push} />
      case 'project-detail': return <ProjectDetailPage store={store} projectId={route.id ?? ''} onEditTransaction={editTransaction} />
      case 'project-form': return <ProjectForm store={store} projectId={route.id} onDone={back} />
      case 'recurring': return <RecurringPage store={store} onPush={push} />
      case 'pending': return <PendingPage store={store} onEdit={openPendingEntry} />
      case 'recurring-form': return <RecurringForm store={store} ruleId={route.id} onDone={back} />
      case 'advances': return <AdvancesPage store={store} onPush={push} />
      case 'advance-detail': return <AdvanceDetailPage store={store} transactionId={route.id ?? ''} onPush={push} onEditTransaction={editTransaction} />
      case 'settlement': return <SettlementPage store={store} reference={route.id ?? ''} onDone={back} />
      default: return <HomePage store={store} onPush={push} onEditTransaction={editTransaction} hideBalances={hideBalances} />
    }
  })()

  const entryMode = ['entry', 'category-picker', 'account-picker', 'project-picker', 'account-form', 'recurring-form'].includes(route.name)
  const navigateSidebar = (name: RouteName) => name === 'transactions' ? setRoutes([{ name: 'home' }, { name: 'transactions' }]) : goRoot(name)

  return (
    <div className={`workspace-frame ${entryMode ? 'is-entry-mode' : ''}`}>
      <aside className="workspace-sidebar">
        <div className="workspace-brand">家庭帳本</div>
        <RootNavigation active={route.name} onNavigate={navigateSidebar} desktop />
        <button className="workspace-user" type="button" onClick={() => void signOut(auth)}><span>{user.email?.slice(0, 1).toUpperCase()}</span><small>登出</small><LogOut /></button>
      </aside>
      <section className="workspace-main" onTouchStart={(event) => { swipeStart.current = event.touches[0]?.clientX ?? null }} onTouchEnd={(event) => { const start = swipeStart.current; const end = event.changedTouches[0]?.clientX ?? 0; swipeStart.current = null; if (showBack && start !== null && start < 45 && end - start > 80) back() }}>
        {!entryMode ? <header className={`workspace-topbar ${route.name === 'reports' ? 'reports-topbar' : ''}`}>
          <div>{showBack ? <IconButton label="上一頁" onClick={back}><ArrowLeft /></IconButton> : null}</div>
          {route.name === 'reports' ? <ReportPrimaryTabs mode={reportMode} onChange={(value) => { setReportMode(value); if (value === 'balance' && reportPeriod === '近6個月') setReportPeriod('月') }} compact /> : <h1>{title}</h1>}
          <div className="workspace-top-actions">
            {route.name === 'home' ? <>
              <BadgeButton label="待確認定期收支" count={pendingRules.length} onClick={() => push({ name: 'pending' })}><Repeat2 /></BadgeButton>
              <BadgeButton label="未結清代墊與分帳" count={unsettled.length} onClick={() => push({ name: 'advances' })}><Handshake /></BadgeButton>
              <IconButton label={hideBalances ? '顯示金額' : '隱藏金額'} onClick={() => setHideBalances((value) => !value)}>{hideBalances ? <EyeOff /> : <Eye />}</IconButton>
            </> : null}
            {route.name === 'accounts' ? <>
              <IconButton label={hideBalances ? '顯示餘額' : '隱藏餘額'} onClick={() => setHideBalances((value) => !value)}>{hideBalances ? <EyeOff /> : <Eye />}</IconButton>
              <IconButton label="新增帳戶" onClick={() => push({ name: 'account-form' })}><Plus /></IconButton>
              <IconButton label={manageAccounts ? '完成帳戶編輯' : '編輯帳戶'} onClick={() => setManageAccounts((value) => !value)}>{manageAccounts ? <Check /> : <Menu />}</IconButton>
            </> : null}
            {route.name === 'account-detail' ? <><IconButton label="帳戶設定" onClick={() => push({ name: 'account-form', id: route.id })}><SlidersHorizontal /></IconButton><IconButton label="調整餘額" onClick={() => push({ name: 'account-adjust', id: route.id })}><Scale /></IconButton></> : null}
            {route.name === 'account-adjust' ? <button className="topbar-text-action" type="submit" form="account-adjust-form">儲存</button> : null}
            {route.name === 'projects' ? <IconButton label="新增專案" onClick={() => push({ name: 'project-form' })}><Plus /></IconButton> : null}
            {route.name === 'project-detail' ? <IconButton label="編輯專案" onClick={() => push({ name: 'project-form', id: route.id })}><Pencil /></IconButton> : null}
            {route.name === 'budgets' ? <IconButton label="新增分類預算" onClick={() => push({ name: 'budget-form' })}><Plus /></IconButton> : null}
            {route.name === 'recurring' ? <IconButton label="新增定期項目" onClick={() => push({ name: 'recurring-form' })}><Plus /></IconButton> : null}
            {route.name === 'advances' ? <IconButton label="新增代墊" onClick={() => openNewEntry('advance')}><Plus /></IconButton> : null}
            {route.name === 'advance-detail' ? <IconButton label="編輯代墊明細" onClick={() => { const transaction = store.data.transactions.find((item) => item.id === route.id); if (transaction) editTransaction(transaction) }}><Pencil /></IconButton> : null}
            {route.name === 'transactions' ? <div className="topbar-view-switch" role="group" aria-label="交易明細瀏覽模式"><button className={transactionView === 'calendar' ? 'active' : ''} type="button" aria-label="行事曆模式" aria-pressed={transactionView === 'calendar'} onClick={() => setTransactionView('calendar')}><CalendarDays /></button><button className={transactionView === 'list' ? 'active' : ''} type="button" aria-label="清單模式" aria-pressed={transactionView === 'list'} onClick={() => setTransactionView('list')}><List /></button></div> : null}
          </div>
        </header> : null}
        {usesFirebaseEmulators ? <div className="workspace-environment">本機測試資料</div> : null}
        {page}
        {!entryMode ? <nav className="workspace-bottom-nav"><RootNavigation active={root} onNavigate={goRoot} /></nav> : null}
      </section>
    </div>
  )
}

function routeTitle(route: Route, data: FinanceData) {
  const staticTitles: Partial<Record<RouteName, string>> = {
    home: '首頁', accounts: '帳戶', entry: route.id ? '編輯明細' : '記一筆', reports: '統計報表', more: '更多管理',
    transactions: '交易明細', budget: '本月收支與預算', 'budget-category': '分類預算明細', budgets: '預算設定', 'budget-form': route.id ? '編輯分類預算' : '新增分類預算', pending: '待確認',
    'transaction-filter': '篩選明細', 'report-filter': '自訂報表區間', 'report-category': '分類明細', 'report-date': '日期明細',
    'account-form': route.id && route.id !== 'manage' ? '帳戶設定' : route.id === 'manage' ? '管理帳戶' : '新增帳戶', 'account-adjust': '調整餘額',
    categories: '分類與圖示', 'category-form': route.id ? '編輯分類' : '新增分類', 'category-picker': '選擇分類', 'account-picker': '選擇帳戶', 'project-picker': '選擇專案',
    projects: '專案記帳', 'project-form': route.id ? '專案設定' : '新增專案', recurring: '定期項目', 'recurring-form': route.id ? '編輯定期項目' : '新增定期項目', advances: '代墊與分帳', settlement: '登記收款／還款',
  }
  if (route.name === 'account-detail') return data.accounts.find((item) => item.id === route.id)?.name ?? '帳戶明細'
  if (route.name === 'project-detail') return data.projects.find((item) => item.id === route.id)?.name ?? '專案明細'
  if (route.name === 'advance-detail') return '代墊明細'
  return staticTitles[route.name] ?? '家庭記帳'
}

function RootNavigation({ active, onNavigate, desktop = false }: { active: RouteName; onNavigate: (route: RouteName) => void; desktop?: boolean }) {
  const items = [
    { name: 'home' as const, label: '首頁', icon: Home },
    ...(desktop ? [{ name: 'transactions' as const, label: '明細', icon: CalendarDays }] : []),
    { name: 'accounts' as const, label: '帳戶', icon: Landmark },
    { name: 'entry' as const, label: '記一筆', icon: Plus },
    { name: 'reports' as const, label: desktop ? '統計報表' : '報表', icon: ChartPie },
    { name: 'more' as const, label: desktop ? '更多管理' : '更多', icon: Settings },
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

function HomePage({ store, onPush, onEditTransaction, hideBalances }: { store: Store; onPush: (route: Route) => void; onEditTransaction: (transaction: FinanceTransaction) => void; hideBalances: boolean }) {
  const month = currentMonth()
  const report = reportForMonth(store.data.transactions, month)
  const recent = activeTransactions(store.data.transactions).sort((a, b) => `${b.occurredOn}${b.updatedAt}`.localeCompare(`${a.occurredOn}${a.updatedAt}`)).slice(0, 10)
  const empty = store.data.accounts.length === 0 && store.data.categories.length === 0
  if (empty) return <main className="workspace-page"><EmptyDataCard onSeed={store.seedDemo} /></main>
  return <main className="workspace-page">
    <section className="home-summary" aria-label="本月收支摘要">
      <article><span>本月收入</span><strong>{hideBalances ? '••••' : money(report.income)}</strong></article>
      <article><span>本月支出</span><strong>{hideBalances ? '••••' : money(report.expense)}</strong></article>
      <article><span>本月結餘</span><strong>{hideBalances ? '••••' : money(report.balance)}</strong></article>
    </section>
    <section className="workspace-section home-transactions-section">
      <div className="section-heading"><h2>交易明細</h2><button type="button" onClick={() => onPush({ name: 'transactions' })}>看全部</button></div>
      <TransactionRows transactions={recent} data={store.data} onEdit={onEditTransaction} hideBalances={hideBalances} />
    </section>
  </main>
}

function TransactionRows({ transactions, data, onEdit, hideBalances = false, showDateHeading = true }: { transactions: FinanceTransaction[]; data: FinanceData; onEdit: (transaction: FinanceTransaction) => void; hideBalances?: boolean; showDateHeading?: boolean }) {
  if (transactions.length === 0) return <div className="simple-empty">目前沒有交易</div>
  const sorted = [...transactions].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.updatedAt.localeCompare(a.updatedAt))
  const grouped = sorted.reduce<Record<string, FinanceTransaction[]>>((result, transaction) => {
    result[transaction.occurredOn] = [...(result[transaction.occurredOn] ?? []), transaction]
    return result
  }, {})
  const groups: [string, FinanceTransaction[]][] = showDateHeading ? Object.entries(grouped) : [['', sorted]]
  return <div className="transaction-date-groups">{groups.map(([date, items]) => <section className="transaction-date-group" key={date || 'selected-day'}>{date ? <h3>{formatDateHeading(date)}</h3> : null}<div className="workspace-list">{items.map((transaction) => {
    const line = transaction.reportLines[0]
    const category = data.categories.find((item) => item.id === line?.categoryId)
    const account = data.accounts.find((item) => item.id === transaction.accountMoves[0]?.accountId)
    const settlement = transaction.settlement
    const advance = settlement ? data.transactions.find((item) => item.id === settlement.advanceTransactionId) : transaction.kind === 'advance' ? transaction : undefined
    const person = settlement && advance?.advance?.people.find((item) => item.personId === settlement.personId)
    const personName = person ? advanceShareName(person, data) : ''
    const advanceNames = transaction.advance?.people.map((item) => advanceShareName(item, data)).filter(Boolean).join('、') ?? ''
    const accountMovement = transaction.accountMoves[0]?.deltaMinor ?? 0
    const amount = settlement ? settlement.amountMinor * (settlement.direction === 'collect' ? 1 : -1) : transaction.advance?.direction === 'receivable' ? -transaction.advance.totalMinor : line ? line.amountTwdMinor * (line.direction === 'expense' ? -1 : 1) : transaction.transfer?.fromAmountMinor ? -transaction.transfer.fromAmountMinor : accountMovement
    const advanceReceivable = transaction.advance?.people.reduce((sum, item) => sum + item.expectedMinor, 0) ?? 0
    const familyExpense = transaction.reportLines.filter((item) => item.direction === 'expense').reduce((sum, item) => sum + item.amountTwdMinor, 0)
    const title = settlement
      ? (settlement.direction === 'collect' ? `收回代墊款${personName ? `・${personName}` : ''}` : `歸還代墊款${personName ? `・${personName}` : ''}`)
      : transaction.advance
        ? transaction.advance.direction === 'receivable' ? `我先代墊${advanceNames ? `・${advanceNames}` : ''}` : `${advanceNames || '別人'}先代墊`
        : transaction.note || category?.name || transactionLabels[transaction.kind]
    const advanceNote = transaction.note && transaction.note !== '代墊' ? `${transaction.note}・` : ''
    const detail = settlement
      ? `${settlement.direction === 'collect' ? '代墊收回・不計收入' : '代墊還款・不計支出'}${account ? ` · ${account.name}` : ''}`
      : transaction.advance
        ? transaction.advance.direction === 'receivable'
          ? `${advanceNote}${familyExpense ? `家庭支出 ${money(familyExpense)}・` : ''}待收 ${money(advanceReceivable)}${account ? ` · ${account.name}` : ''}`
          : `${advanceNote}${familyExpense ? `家庭支出 ${money(familyExpense)}・` : ''}待還 ${money(advanceReceivable)}`
        : `${category?.name ?? transactionLabels[transaction.kind]}${account ? ` · ${account.name}` : ''}`
    const amountTone = settlement || transaction.advance ? 'neutral-money' : amount < 0 ? 'expense-text' : amount > 0 ? 'income-text' : ''
    const amountText = transaction.advance?.direction === 'payable' ? `待還 ${money(advanceReceivable)}` : `${amount > 0 ? '+' : ''}${money(amount)}`
    return <button className="transaction-row-v2" type="button" key={transaction.id} onClick={() => onEdit(transaction)}>
      <EntityIcon iconKey={category?.iconKey ?? (transaction.kind === 'transfer' ? 'rotate-ccw' : transaction.kind === 'settlement' ? 'hand-coins' : 'receipt-text')} />
      <span><strong>{title}</strong><small>{detail}</small></span>
      <b className={amountTone}>{hideBalances ? '••••' : amountText}<small>{settlement ? '不計收支' : '明細'} ›</small></b>
    </button>
  })}</div></section>)}</div>
}

function AccountsPage({ store, onPush, hideBalances, managing }: { store: Store; onPush: (route: Route) => void; hideBalances: boolean; managing: boolean }) {
  const accounts = activeSorted(store.data.accounts)
  const balances = calculateBalances(accounts, store.data.transactions)
  const netWorth = calculateNetWorth(accounts, balances)
  const [dragging, setDragging] = useState('')
  const reorder = async (fromId: string, toId: string) => {
    const from = accounts.findIndex((item) => item.id === fromId)
    const to = accounts.findIndex((item) => item.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...accounts]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved)
    await Promise.all(next.map((item, index) => store.save('accounts', { id: item.id, sortOrder: index })))
  }
  const move = (items: Account[], id: string, delta: number) => {
    const index = items.findIndex((item) => item.id === id)
    const target = items[index + delta]
    if (target) void reorder(id, target.id)
  }
  const groups = [
    { key: 'cash', label: '現金', items: accounts.filter((item) => item.type === 'cash' && item.currency === 'TWD') },
    { key: 'bank', label: '銀行', items: accounts.filter((item) => item.type === 'bank' && item.currency === 'TWD') },
    { key: 'foreign', label: '外幣', items: accounts.filter((item) => item.currency !== 'TWD') },
    { key: 'credit_card', label: '信用卡', items: accounts.filter((item) => item.type === 'credit_card') },
    { key: 'investment', label: '投資', items: accounts.filter((item) => item.type === 'investment' && item.currency === 'TWD') },
  ].filter((group) => group.items.length)
  return <main className="workspace-page">
    <section className="net-worth-v2"><span>家庭淨資產</span><strong>{hideBalances ? '••••••' : money(netWorth.netWorth)}</strong><div><span>總資產 <b>{hideBalances ? '••••' : money(netWorth.assets)}</b></span><span>總負債 <b>{hideBalances ? '••••' : money(netWorth.liabilities)}</b></span></div></section>
    {groups.map((group) => <section className="account-group-v2" key={group.key}><div className="account-group-head"><span>{group.label}</span><span>{hideBalances ? '••••' : group.key === 'credit_card' ? `待繳 ${money(group.items.reduce((sum, item) => sum + Math.max(0, balances[item.id] ?? 0), 0))}` : money(group.items.reduce((sum, item) => sum + Math.round(fromMinor(balances[item.id] ?? 0, item.currency) * (item.currency === 'TWD' ? 1 : item.referenceRateToTwd ?? 0)), 0))}</span></div><div className="workspace-list account-list-v2">{group.items.map((account, index) => <div className={`account-manage-row ${managing ? 'is-managing' : ''}`} data-sort-id={account.id} draggable={managing} key={account.id} onDragStart={() => setDragging(account.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => void reorder(dragging, account.id)}>{managing ? <div className="account-sort-controls"><button type="button" className="account-drag" aria-label={`拖曳${account.name}`} onTouchStart={(event) => { event.stopPropagation(); setDragging(account.id) }} onTouchEnd={(event) => { event.stopPropagation(); void reorder(account.id, touchSortTarget(event)) }}><GripVertical /></button><span><button type="button" aria-label={`${account.name}上移`} disabled={index === 0} onClick={() => move(group.items, account.id, -1)}><ChevronUp /></button><button type="button" aria-label={`${account.name}下移`} disabled={index === group.items.length - 1} onClick={() => move(group.items, account.id, 1)}><ChevronDown /></button></span></div> : null}<button type="button" className="account-row-main" onClick={() => onPush({ name: managing ? 'account-form' : 'account-detail', id: account.id })}><EntityIcon iconKey={account.iconKey} /><span><strong>{account.name}</strong><small>{account.currency !== 'TWD' ? `${account.currency} · 匯率 ${account.referenceRateToTwd ?? '未設定'}` : account.type === 'credit_card' ? `結帳日 ${account.creditCard?.closingDay ?? '—'} 日 · 繳款日 ${account.creditCard?.paymentDay ?? '—'} 日` : accountTypeLabels[account.type]}</small></span><b className={account.type === 'credit_card' ? 'expense-text' : ''}>{hideBalances ? '••••' : money((account.type === 'credit_card' ? -1 : 1) * (balances[account.id] ?? 0), account.currency)}</b>{!managing ? <ChevronRight /> : null}</button>{managing ? <><IconButton label={`設定${account.name}`} onClick={() => onPush({ name: 'account-form', id: account.id })}><SlidersHorizontal /></IconButton><IconButton label={`調整${account.name}餘額`} onClick={() => onPush({ name: 'account-adjust', id: account.id })}><Scale /></IconButton><IconButton label={`封存${account.name}`} onClick={() => void store.archive('accounts', account.id, true)}><Trash2 /></IconButton></> : null}</div>)}</div></section>)}
  </main>
}

function AccountDetailPage({ store, accountId, onPush, onEntry, onEditTransaction, filter }: { store: Store; accountId: string; onPush: (route: Route) => void; onEntry: (kind: EntryKind, accountId: string) => void; onEditTransaction: (transaction: FinanceTransaction) => void; filter: TransactionFilter }) {
  const account = store.data.accounts.find((item) => item.id === accountId)
  if (!account) return <main className="workspace-page"><div className="simple-empty">找不到帳戶</div></main>
  const balance = calculateBalances(store.data.accounts, store.data.transactions)[account.id] ?? 0
  const allRelated = activeTransactions(store.data.transactions).filter((transaction) => transaction.accountMoves.some((move) => move.accountId === account.id)).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
  const related = allRelated.filter((transaction) => (filter.kind === 'all' || transaction.kind === filter.kind) && (!filter.categoryId || transaction.reportLines.some((line) => line.categoryId === filter.categoryId)) && (!filter.projectId || transaction.projectId === filter.projectId) && (!filter.from || transaction.occurredOn >= filter.from) && (!filter.to || transaction.occurredOn <= filter.to))
  const thisMonth = allRelated.filter((item) => monthKey(item.occurredOn) === currentMonth())
  const income = thisMonth.flatMap((item) => item.reportLines.filter((line) => line.direction === 'income')).reduce((sum, line) => sum + line.amountMinor, 0)
  const expense = thisMonth.flatMap((item) => item.reportLines.filter((line) => line.direction === 'expense')).reduce((sum, line) => sum + line.amountMinor, 0)
  const transfers = thisMonth.filter((item) => item.kind === 'transfer').flatMap((item) => item.accountMoves.filter((move) => move.accountId === account.id)).reduce((sum, move) => sum + move.deltaMinor, 0)
  return <main className="workspace-page">
    <section className="account-balance-compact"><EntityIcon iconKey={account.iconKey} /><span>帳面餘額</span><strong>{money((account.type === 'credit_card' ? -1 : 1) * balance, account.currency)}</strong></section>
    <section className="account-flow-summary"><span>本月收入 <b className="income-text">{money(income, account.currency)}</b></span><span>本月支出 <b className="expense-text">{money(expense, account.currency)}</b></span><span>本月轉帳 <b>{transfers > 0 ? '+' : ''}{money(transfers, account.currency)}</b></span></section>
    <div className="account-action-grid"><button type="button" onClick={() => onEntry('expense', account.id)}><ArrowUpRight />記支出</button><button type="button" onClick={() => onEntry('income', account.id)}><ArrowDownLeft />記收入</button><button type="button" onClick={() => onEntry('transfer', account.id)}><Repeat2 />轉帳</button></div>
    <section className="workspace-section"><div className="section-heading"><h2>這個帳戶的明細</h2><button type="button" onClick={() => onPush({ name: 'transaction-filter', id: account.id })}>篩選</button></div><TransactionRows transactions={related} data={store.data} onEdit={onEditTransaction} /></section>
  </main>
}

function EntryPage({ store, draft, setDraft, editingId, recurringRule, onPush, onBack, onDone, onContinue }: { store: Store; draft: EntryDraft; setDraft: (value: EntryDraft | ((current: EntryDraft) => EntryDraft)) => void; editingId: string; recurringRule?: RecurringRule; onPush: (route: Route) => void; onBack: () => void; onDone: () => void; onContinue: (kind: EntryKind) => void }) {
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
  const ownShare = draft.advanceDirection === 'payable' ? amount : toMinor(draft.ownShare || 0, account?.currency ?? 'TWD')
  const advanceHasPersonalExpense = draft.kind === 'advance' && ownShare > 0
  const existingTransaction = store.data.transactions.find((item) => item.id === editingId)
  const recurringOccurrenceId = recurringRule ? `${recurringRule.id}_${recurringRule.nextScheduledOn}` : ''

  if (existingTransaction?.kind === 'settlement') return <SettlementTransactionEditor store={store} transaction={existingTransaction} draft={draft} setDraft={setDraft} onPush={onPush} onDone={onDone} />
  if (existingTransaction?.kind === 'balance_adjustment') return <AdjustmentTransactionEditor store={store} transaction={existingTransaction} draft={draft} setDraft={setDraft} onPush={onPush} onDone={onDone} />

  const changeKind = (kind: EntryKind) => setDraft((current) => ({ ...newEntryDraft(kind, store.data), date: current.date }))
  const save = async (continueAfterSave = false) => {
    setError('')
    if (recurringOccurrenceId && store.data.transactions.some((item) => item.recurringOccurrenceId === recurringOccurrenceId)) return setError('這筆定期項目已經入帳')
    if (!amount) return setError('請輸入金額')
    if (draft.kind !== 'advance' || draft.advanceDirection === 'receivable') if (!account) return setError('請選擇帳戶')
    if ((draft.kind === 'expense' || draft.kind === 'income' || advanceHasPersonalExpense) && !category) return setError('請選擇分類')
    if (draft.kind === 'transfer' && !toAccount) return setError('請選擇轉入帳戶')
    if (draft.kind === 'transfer' && account && toAccount && account.currency !== toAccount.currency && !numberValue(draft.toAmount)) return setError('跨幣別轉帳請輸入轉入金額')
    const now = new Date().toISOString()
    const previous = store.data.transactions.find((item) => item.id === editingId)
    const common = { id: editingId || recurringOccurrenceId || undefined, occurredOn: draft.date, note: draft.note, projectId: draft.kind === 'transfer' ? undefined : draft.projectId || undefined, accountMoves: [], reportLines: [], voidedAt: previous?.voidedAt, recurringOccurrenceId: recurringOccurrenceId || previous?.recurringOccurrenceId }
    let transaction: Partial<FinanceTransaction>
    if (draft.kind === 'income' && account && category) transaction = { ...common, kind: 'income', accountMoves: [{ accountId: account.id, deltaMinor: inflowDelta(account, amount), currency: account.currency }], reportLines: [{ direction: 'income', categoryId: category.id, amountMinor: amount, currency: account.currency, amountTwdMinor: toTwdMinor(amount, account), countsTowardBudget: true }] }
    else if (draft.kind === 'expense' && account && category) transaction = { ...common, kind: 'expense', accountMoves: [{ accountId: account.id, deltaMinor: outflowDelta(account, amount), currency: account.currency }], reportLines: [{ direction: 'expense', categoryId: category.id, amountMinor: amount, currency: account.currency, amountTwdMinor: toTwdMinor(amount, account), countsTowardBudget: !category.systemKey?.startsWith('balance_adjustment') }] }
    else if (draft.kind === 'transfer' && account && toAccount) {
      const fee = toMinor(draft.fee || 0, account.currency)
      const feeCategory = store.data.categories.find((item) => item.systemKey === 'bank_fee' && !item.archivedAt)
      transaction = { ...common, kind: 'transfer', accountMoves: [{ accountId: account.id, deltaMinor: outflowDelta(account, amount + fee), currency: account.currency }, { accountId: toAccount.id, deltaMinor: inflowDelta(toAccount, toAmount), currency: toAccount.currency }], reportLines: fee && feeCategory ? [{ direction: 'expense', categoryId: feeCategory.id, amountMinor: fee, currency: account.currency, amountTwdMinor: toTwdMinor(fee, account), countsTowardBudget: true }] : [], transfer: { fromAccountId: account.id, toAccountId: toAccount.id, fromAmountMinor: amount, toAmountMinor: toAmount, feeMinor: fee } }
    } else if (draft.kind === 'advance') {
      const advanceCurrency = account?.currency ?? 'TWD'
      const shareIds = draft.advanceDirection === 'payable' ? draft.shareOrder.slice(0, 1) : draft.shareOrder
      const singleReceivable = draft.advanceDirection === 'receivable' && shareIds.length === 1
      const people = shareIds.map((personId) => ({ personId, name: draft.shareNames[personId]?.trim() || undefined, expectedMinor: draft.advanceDirection === 'payable' ? amount : singleReceivable ? Math.max(0, amount - ownShare) : toMinor(draft.shares[personId] || 0, advanceCurrency) })).filter((item) => item.name && item.expectedMinor > 0)
      if (!people.length) return setError('請填寫代墊對象')
      const peopleTotal = people.reduce((sum, person) => sum + person.expectedMinor, 0)
      if (draft.advanceDirection === 'receivable' && peopleTotal + ownShare !== amount) return setError('自己負擔與各對象金額加總必須等於消費總額')
      if (draft.advanceDirection === 'payable' && peopleTotal !== amount) return setError('代墊金額必須等於消費總額')
      transaction = { ...common, kind: 'advance', projectId: ownShare ? draft.projectId || undefined : undefined, accountMoves: draft.advanceDirection === 'receivable' && account ? [{ accountId: account.id, deltaMinor: outflowDelta(account, amount), currency: account.currency }] : [], reportLines: ownShare && category && account ? [{ direction: 'expense', categoryId: category.id, amountMinor: ownShare, currency: account.currency, amountTwdMinor: toTwdMinor(ownShare, account), countsTowardBudget: true }] : [], advance: { direction: draft.advanceDirection, totalMinor: amount, ownShareMinor: ownShare, currency: account?.currency ?? 'TWD', people } }
    } else return setError('資料不完整')
    setSaving(true)
    try {
      await store.save('transactions', { ...transaction, updatedAt: now })
      if (recurringRule) await store.save('recurringRules', { id: recurringRule.id, nextScheduledOn: addRecurringPeriod(recurringRule.nextScheduledOn, recurringRule.frequency) })
      if (continueAfterSave && !recurringRule) onContinue(draft.kind)
      else onDone()
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : '儲存失敗') } finally { setSaving(false) }
  }

  return <main className="entry-page-v2">
    <header className={`entry-page-head ${recurringRule ? 'editor-page-head' : ''}`}>
      <IconButton label="返回上一頁" onClick={onBack}><ArrowLeft /></IconButton>
      {recurringRule ? <h1>確認定期項目</h1> : <div className="entry-kind-tabs">{(['expense', 'income', 'transfer', 'advance'] as EntryKind[]).map((kind) => <button className={draft.kind === kind ? 'active' : ''} type="button" key={kind} onClick={() => changeKind(kind)}>{{ expense: '支出', income: '收入', transfer: '轉帳', advance: '代墊' }[kind]}</button>)}</div>}
      <button className="entry-head-save" type="button" disabled={saving} onClick={() => void save(false)}>{saving ? '處理中' : recurringRule ? '確認' : '儲存'}</button>
    </header>
    <div className="entry-page-content">
      <label className="date-only-row"><input type="date" aria-label="記帳日期" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /><span>{formatEntryDate(draft.date)}</span></label>
      {draft.kind === 'advance' ? <div className="advance-direction"><button className={draft.advanceDirection === 'receivable' ? 'active' : ''} type="button" onClick={() => setDraft((current) => ({ ...current, advanceDirection: 'receivable' }))}>我先付</button><button className={draft.advanceDirection === 'payable' ? 'active' : ''} type="button" onClick={() => setDraft((current) => ({ ...current, advanceDirection: 'payable' }))}>別人先付</button></div> : null}
      <section className="entry-fields-v2">
        {draft.kind === 'expense' || draft.kind === 'income' ? <>
          <AmountField label="金額" value={draft.amount} currency={account?.currency ?? 'TWD'} onChange={(value) => setDraft((current) => ({ ...current, amount: value }))} />
          <FieldButton icon={category?.iconKey ?? 'receipt-text'} label="分類" value={category?.name ?? '請選擇'} hint={category ? budgetHint(category.id, store.data) : undefined} onClick={() => onPush({ name: 'category-picker' })} />
          <FieldButton icon={account?.iconKey ?? 'wallet-cards'} label={draft.kind === 'income' ? '入帳帳戶' : '付款帳戶'} value={account?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'from' })} />
          <FieldButton icon={project?.iconKey ?? 'circle-off'} label="專案" value={project?.name ?? '無'} onClick={() => onPush({ name: 'project-picker' })} />
        </> : null}
        {draft.kind === 'transfer' ? <>
          <FieldButton icon={account?.iconKey ?? 'wallet-cards'} label="轉出" value={account?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'from' })} />
          <FieldButton icon={toAccount?.iconKey ?? 'landmark'} label="轉入" value={toAccount?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'to' })} />
          <AmountField label="金額" value={draft.amount} currency={account?.currency ?? 'TWD'} onChange={(value) => setDraft((current) => ({ ...current, amount: value }))} />
          {account && toAccount && account.currency !== toAccount.currency ? <AmountField label="轉入金額" icon="rotate-ccw" value={draft.toAmount} currency={toAccount.currency} onChange={(value) => setDraft((current) => ({ ...current, toAmount: value }))} /> : null}
        </> : null}
        {draft.kind === 'advance' ? <>
          <AmountField label="消費總額" value={draft.amount} currency={account?.currency ?? 'TWD'} onChange={(value) => setDraft((current) => ({ ...current, amount: value }))} />
          <AdvanceShareFields draft={draft} setDraft={setDraft} />
          {advanceHasPersonalExpense ? <FieldButton icon={category?.iconKey ?? 'receipt-text'} label="分類" value={category?.name ?? '請選擇'} hint={category ? budgetHint(category.id, store.data) : undefined} onClick={() => onPush({ name: 'category-picker' })} /> : null}
          {draft.advanceDirection === 'receivable' ? <FieldButton icon={account?.iconKey ?? 'wallet-cards'} label="付款帳戶" value={account?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'from' })} /> : null}
          {advanceHasPersonalExpense ? <FieldButton icon={project?.iconKey ?? 'circle-off'} label="專案" value={project?.name ?? '無'} onClick={() => onPush({ name: 'project-picker' })} /> : null}
        </> : null}
      </section>
      <label className="entry-note"><span>備註</span><textarea placeholder="寫下備註…" value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label>
      {draft.kind === 'transfer' ? <section className="transfer-fee-section"><label className="fee-toggle"><input type="checkbox" checked={draft.fee !== ''} onChange={(event) => setDraft((current) => ({ ...current, fee: event.target.checked ? '0' : '' }))} /><span>有手續費</span></label>{draft.fee !== '' ? <label className="fee-amount"><span>手續費</span><input inputMode="numeric" value={draft.fee} onChange={(event) => setDraft((current) => ({ ...current, fee: event.target.value }))} /><small>計入支出</small></label> : null}</section> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {editingId ? <button className="danger-button entry-delete-button" type="button" onClick={() => void store.voidTransaction(editingId).then(onDone)}><Trash2 />刪除這筆明細</button> : null}
      {recurringRule ? <div className="entry-submit-actions is-single"><button type="button" disabled={saving} onClick={() => void save(false)}>{saving ? '處理中' : '確認入帳'}</button></div> : <div className="entry-submit-actions"><button type="button" disabled={saving} onClick={() => void save(false)}>{saving ? '儲存中' : '儲存'}</button><button type="button" disabled={saving} onClick={() => void save(true)}>{saving ? '儲存中' : '再記一筆'}</button></div>}
    </div>
  </main>
}

function AmountField({ label, value, currency, onChange, icon = 'coins' }: { label: string; value: string; currency: string; onChange: (value: string) => void; icon?: string }) {
  return <label className="field-row amount-field-row"><EntityIcon iconKey={icon} /><span className="field-label"><b>{label}</b></span><input inputMode="decimal" placeholder="輸入金額" value={value} onChange={(event) => onChange(event.target.value)} /><small>{currency === 'TWD' ? 'NT$' : currency}</small></label>
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
  return <main className="entry-page-v2"><EditorPageHeader title={direction === 'collect' ? '代墊收款' : '代墊還款'} onBack={onDone} onSave={() => void save()} /><div className="entry-page-content"><label className="date-only-row"><input type="date" aria-label="記帳日期" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /><span>{formatEntryDate(draft.date)}</span></label><section className="entry-fields-v2"><FieldButton icon={account?.iconKey ?? 'wallet-cards'} label={direction === 'collect' ? '收款帳戶' : '付款帳戶'} value={account?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'from' })} /><AmountField label="金額" value={draft.amount} currency={account?.currency ?? 'TWD'} onChange={(value) => setDraft((current) => ({ ...current, amount: value }))} /></section><label className="entry-note"><span>備註</span><textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label><button className="danger-button entry-delete-button" type="button" onClick={() => void store.voidTransaction(transaction.id).then(onDone)}><Trash2 />刪除這筆明細</button></div></main>
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
    await store.save('transactions', { ...transaction, occurredOn: draft.date, note: draft.note, accountMoves: [{ accountId: account.id, deltaMinor: difference, currency: account.currency }], reportLines: [{ direction, categoryId: category.id, amountMinor: amount, currency: account.currency, amountTwdMinor: toTwdMinor(amount, account), countsTowardBudget: false }], adjustment: { accountId: account.id, beforeMinor: transaction.adjustment.beforeMinor, actualMinor: transaction.adjustment.beforeMinor + difference, differenceMinor: difference } })
    onDone()
  }
  return <main className="entry-page-v2"><EditorPageHeader title="帳務調整" onBack={onDone} onSave={() => void save()} /><div className="entry-page-content"><label className="date-only-row"><input type="date" aria-label="記帳日期" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /><span>{formatEntryDate(draft.date)}</span></label><section className="entry-fields-v2"><FieldButton icon={account?.iconKey ?? 'wallet-cards'} label="帳戶" value={account?.name ?? '請選擇'} onClick={() => onPush({ name: 'account-picker', id: 'from' })} /><AmountField label="調整差額" icon="scale" value={draft.amount} currency={account?.currency ?? 'TWD'} onChange={(value) => setDraft((current) => ({ ...current, amount: value }))} /></section><label className="entry-note"><span>備註</span><textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label><button className="danger-button entry-delete-button" type="button" onClick={() => void store.voidTransaction(transaction.id).then(onDone)}><Trash2 />刪除這筆明細</button></div></main>
}

function EditorPageHeader({ title, onBack, onSave }: { title: string; onBack: () => void; onSave: () => void }) {
  return <header className="entry-page-head editor-page-head"><IconButton label="返回上一頁" onClick={onBack}><ArrowLeft /></IconButton><h1>{title}</h1><button className="entry-head-save" type="button" onClick={onSave}>儲存</button></header>
}

function FieldButton({ icon, label, value, hint, onClick }: { icon: string; label: string; value: string; hint?: string; onClick: () => void }) {
  return <button className="field-row" type="button" onClick={onClick}><EntityIcon iconKey={icon} /><span className="field-label"><b>{label}</b></span><span className="field-value"><strong>{value}</strong>{hint ? <small>{hint}</small> : null}</span><ChevronRight /></button>
}

function budgetHint(categoryId: string, data: FinanceData) {
  const row = monthlyBudgetRows(data.budgets, data.categories, data.transactions, currentMonth()).find((item) => item.category?.id === categoryId)
  return row ? `本月預算剩餘 ${money(row.monthlyAmount - row.spent)}` : '尚未設定預算'
}

function AdvanceShareFields({ draft, setDraft }: { draft: EntryDraft; setDraft: (value: EntryDraft | ((current: EntryDraft) => EntryDraft)) => void }) {
  const syncTotal = (current: EntryDraft, shares: Record<string, string>, ownShare = current.ownShare) => {
    if (current.advanceDirection !== 'receivable' || current.shareOrder.length < 2) return current.amount
    const peopleTotal = current.shareOrder.reduce((sum, id) => sum + displayAmount(shares[id] ?? ''), 0)
    return String(peopleTotal + displayAmount(ownShare))
  }
  const addShare = () => {
    const id = crypto.randomUUID()
    setDraft((current) => {
      const firstId = current.shareOrder[0]
      const automaticallyCalculated = Math.max(0, Number(current.amount.replaceAll(',', '')) - Number((current.ownShare || '0').replaceAll(',', '')))
      const shares = { ...current.shares, ...(current.shareOrder.length === 1 && firstId ? { [firstId]: String(automaticallyCalculated || '') } : {}), [id]: '' }
      return { ...current, amount: String(automaticallyCalculated + displayAmount(current.ownShare)), shares, shareNames: { ...current.shareNames, [id]: '' }, shareOrder: [...current.shareOrder, id] }
    })
  }
  const removeShare = (id: string) => setDraft((current) => {
    const shareOrder = current.shareOrder.filter((item) => item !== id)
    const shares = { ...current.shares }; delete shares[id]
    const amount = current.shareOrder.length > 1 ? String(shareOrder.reduce((sum, personId) => sum + displayAmount(shares[personId] ?? ''), 0) + displayAmount(current.ownShare)) : current.amount
    return { ...current, amount, shares, shareOrder }
  })
  const singleReceivable = draft.advanceDirection === 'receivable' && draft.shareOrder.length === 1
  const automaticallyCalculated = Math.max(0, Number(draft.amount.replaceAll(',', '')) - Number((draft.ownShare || '0').replaceAll(',', '')))
  return <div className="advance-shares">
    {singleReceivable ? null : <p>{draft.advanceDirection === 'receivable' ? '填寫每個人各自應還的金額' : '填寫這次代墊者'}</p>}
    {(draft.advanceDirection === 'payable' ? draft.shareOrder.slice(0, 1) : draft.shareOrder).map((id) => <div className={`advance-share-row ${draft.advanceDirection === 'payable' ? 'payable-person-row' : singleReceivable ? 'single-person-row' : ''}`} key={id}><input aria-label="姓名" placeholder={draft.advanceDirection === 'receivable' ? '姓名' : '代墊者'} value={draft.shareNames[id] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, shareNames: { ...current.shareNames, [id]: event.target.value } }))} />{draft.advanceDirection === 'receivable' ? singleReceivable ? <span className="auto-share-amount">應還 {draft.amount ? new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 }).format(automaticallyCalculated) : '依總額計算'}</span> : <><input aria-label="應還金額" inputMode="decimal" placeholder="金額" value={draft.shares[id] ?? ''} onChange={(event) => setDraft((current) => { const shares = { ...current.shares, [id]: event.target.value }; return { ...current, amount: syncTotal(current, shares), shares } })} /><button type="button" aria-label="移除" onClick={() => removeShare(id)}><X /></button></> : null}</div>)}
    {draft.advanceDirection === 'receivable' ? <button className="add-share-button" type="button" onClick={addShare}><Plus />新增對象</button> : null}
    {draft.advanceDirection === 'receivable' ? <label className="advance-own-toggle"><input type="checkbox" checked={draft.ownShare !== ''} onChange={(event) => setDraft((current) => { const ownShare = event.target.checked ? '0' : ''; return { ...current, amount: syncTotal(current, current.shares, ownShare), ownShare } })} /><span>這筆也包含我的消費</span></label> : null}
    {draft.advanceDirection === 'receivable' && draft.ownShare !== '' ? <label className="advance-own-row"><span>我自己負擔</span><input inputMode="decimal" value={draft.ownShare} onChange={(event) => setDraft((current) => ({ ...current, amount: syncTotal(current, current.shares, event.target.value), ownShare: event.target.value }))} /></label> : null}
  </div>
}

function PickerPage<T extends { id: string; name: string; iconKey: string }>({ title, items, selectedId, allowNone, variant = 'grid', getMeta, getEnd, getEndClass, onBack, onSelect }: { title: string; items: T[]; selectedId: string; allowNone?: boolean; variant?: 'grid' | 'list'; getMeta?: (item: T) => string; getEnd?: (item: T) => string; getEndClass?: (item: T) => string; onBack: () => void; onSelect: (id: string) => void }) {
  return <main className="entry-page-v2 picker-page-v2"><header className="entry-page-head picker-page-head"><IconButton label="返回記帳" onClick={onBack}><ArrowLeft /></IconButton><h1>{title}</h1><span /></header>{variant === 'grid' ? <div className="picker-grid">{allowNone ? <button type="button" className={!selectedId ? 'selected' : ''} onClick={() => onSelect('')}><span className="entity-icon"><X /></span><b>無</b></button> : null}{items.map((item) => <button type="button" className={selectedId === item.id ? 'selected' : ''} key={item.id} onClick={() => onSelect(item.id)}><EntityIcon iconKey={item.iconKey} /><b>{item.name}</b>{selectedId === item.id ? <Check /> : null}</button>)}</div> : <div className="workspace-list picker-list-v2">{allowNone ? <button type="button" onClick={() => onSelect('')}><span className="entity-icon"><X /></span><span><strong>不使用專案</strong><small>只併入整體收支</small></span><b>›</b></button> : null}{items.map((item) => <button type="button" className={selectedId === item.id ? 'selected' : ''} key={item.id} onClick={() => onSelect(item.id)}><EntityIcon iconKey={item.iconKey} /><span><strong>{item.name}</strong>{getMeta ? <small>{getMeta(item)}</small> : null}</span><b className={getEndClass?.(item)}>{getEnd?.(item) ?? '›'}</b></button>)}</div>}</main>
}

function AccountFormPage({ store, accountId, onDone }: { store: Store; accountId?: string; onDone: () => void }) {
  const existing = store.data.accounts.find((item) => item.id === accountId)
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<AccountType>(existing?.type ?? 'bank')
  const [currency, setCurrency] = useState(existing?.currency ?? 'TWD')
  const [openingBalance, setOpeningBalance] = useState(String(existing ? fromMinor(existing.openingBalanceMinor, existing.currency) : 0))
  const [include, setInclude] = useState(existing?.includeInNetWorth ?? true)
  const [iconKey, setIconKey] = useState(existing?.iconKey ?? 'landmark')
  const [rate, setRate] = useState(String(existing?.referenceRateToTwd ?? ''))
  const [closingDay, setClosingDay] = useState(String(existing?.creditCard?.closingDay ?? 12))
  const [paymentDay, setPaymentDay] = useState(String(existing?.creditCard?.paymentDay ?? 28))
  const [paymentAccountId, setPaymentAccountId] = useState(existing?.creditCard?.defaultPaymentAccountId ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [position, setPosition] = useState(String((existing?.sortOrder ?? store.data.accounts.length) + 1))
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('請輸入帳戶名稱')
    await store.save('accounts', {
      id: existing?.id, name: name.trim(), type, currency: currency.toUpperCase(), iconKey,
      sortOrder: Math.max(0, numberValue(position) - 1), includeInNetWorth: include,
      openingBalanceMinor: toMinor(openingBalance || 0, currency.toUpperCase()), openingDate: existing?.openingDate ?? todayIso(),
      referenceRateToTwd: currency.toUpperCase() === 'TWD' ? undefined : Number(rate) || 0,
      creditCard: type === 'credit_card' ? { closingDay: numberValue(closingDay), paymentDay: numberValue(paymentDay), defaultPaymentAccountId: paymentAccountId || undefined } : undefined,
      note: note || undefined,
    })
    onDone()
  }
  return <main className="entry-page-v2"><header className="entry-page-head editor-page-head"><IconButton label="返回帳戶" onClick={onDone}><ArrowLeft /></IconButton><h1>{existing ? '帳戶設定' : '新增帳戶'}</h1><button className="entry-head-save" type="submit" form="account-form-v2">儲存</button></header><form id="account-form-v2" className="settings-form standalone-editor-content" onSubmit={(event) => void submit(event)}>
    <label><span>帳戶名稱</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：中信帳戶" /></label>
    <label><span>帳戶類型</span><select value={type} onChange={(event) => { const next = event.target.value as AccountType; setType(next); setIconKey({ cash: 'wallet-cards', bank: 'landmark', credit_card: 'credit-card', investment: 'chart-no-axes-combined' }[next]) }}>{Object.entries(accountTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label><span>幣別</span><input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value)} /></label>
    <label><span>初始餘額</span><input inputMode="numeric" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} disabled={Boolean(existing)} /><small>{existing ? '建立後請使用「調整餘額」，保留帳務紀錄。' : '信用卡請填目前未繳負債。'}</small></label>
    {currency.toUpperCase() !== 'TWD' ? <label><span>台幣參考匯率</span><input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} /></label> : null}
    {type === 'credit_card' ? <><div className="form-columns"><label><span>結帳日</span><input inputMode="numeric" value={closingDay} onChange={(event) => setClosingDay(event.target.value)} /></label><label><span>繳款日</span><input inputMode="numeric" value={paymentDay} onChange={(event) => setPaymentDay(event.target.value)} /></label></div><label><span>預設扣款帳戶</span><select value={paymentAccountId} onChange={(event) => setPaymentAccountId(event.target.value)}><option value="">不指定</option>{activeSorted(store.data.accounts).filter((item) => item.type !== 'credit_card' && item.id !== existing?.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></> : null}
    <ToggleRow label="計入淨資產" checked={include} onChange={setInclude} />
    <label><span>顯示位置</span><select value={position} onChange={(event) => setPosition(event.target.value)}>{Array.from({ length: Math.max(1, store.data.accounts.length + (existing ? 0 : 1)) }, (_, index) => <option key={index + 1} value={index + 1}>第 {index + 1} 位</option>)}</select></label>
    <IconChooser value={iconKey} onChange={setIconKey} />
    <label><span>備註</span><textarea placeholder="可留空" value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {error ? <p className="form-error">{error}</p> : null}
  </form></main>
}

function AccountAdjustPage({ store, accountId, onDone }: { store: Store; accountId: string; onDone: () => void }) {
  const account = store.data.accounts.find((item) => item.id === accountId)
  const current = account ? calculateBalances(store.data.accounts, store.data.transactions)[account.id] ?? 0 : 0
  const accountCurrency = account?.currency ?? 'TWD'
  const [actual, setActual] = useState(String(fromMinor(current, accountCurrency)))
  const [note, setNote] = useState('對帳差異')
  const [date, setDate] = useState(todayIso())
  if (!account) return <main className="workspace-page"><div className="simple-empty">找不到帳戶</div></main>
  const difference = toMinor(actual || 0, accountCurrency) - current
  const submit = async () => {
    if (!difference) return
    const direction: Direction = account.type === 'credit_card' ? (difference > 0 ? 'expense' : 'income') : (difference > 0 ? 'income' : 'expense')
    const category = store.data.categories.find((item) => item.systemKey === `balance_adjustment_${direction}`)
    if (!category) return
    await store.save('transactions', {
      kind: 'balance_adjustment', occurredOn: date, note,
      accountMoves: [{ accountId: account.id, deltaMinor: difference, currency: account.currency }],
      reportLines: [{ direction, categoryId: category.id, amountMinor: Math.abs(difference), currency: account.currency, amountTwdMinor: toTwdMinor(Math.abs(difference), account), countsTowardBudget: false }],
      adjustment: { accountId: account.id, beforeMinor: current, actualMinor: current + difference, differenceMinor: difference },
    })
    onDone()
  }
  return <main className="workspace-page"><section className="adjust-card"><span>目前帳面餘額</span><strong>{money(current, account.currency)}</strong></section><form id="account-adjust-form" className="settings-form" onSubmit={(event) => { event.preventDefault(); void submit() }}><label><span>實際餘額</span><input inputMode="numeric" value={actual} onChange={(event) => setActual(event.target.value)} /></label><div className="difference-row"><span>帳務調整</span><b className={difference < 0 ? 'expense-text' : 'income-text'}>{difference > 0 ? '+' : ''}{money(difference, account.currency)}</b></div><label><span>調整日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>原因</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label></form></main>
}

function TransactionsPage({ store, onEdit, view }: { store: Store; onEdit: (transaction: FinanceTransaction) => void; view: 'calendar' | 'list' }) {
  const [filter, setFilter] = useState<'all' | TransactionKind>('all')
  const transactions = activeTransactions(store.data.transactions).filter((item) => filter === 'all' || item.kind === filter).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
  return <main className="workspace-page">{view === 'calendar' ? <TransactionCalendar store={store} onEdit={onEdit} /> : <><div className="filter-chips transaction-type-filters">{([['all', '全部'], ['expense', '支出'], ['income', '收入'], ['transfer', '轉帳']] as const).map(([value, label]) => <button className={filter === value ? 'active' : ''} type="button" key={value} onClick={() => setFilter(value)}>{label}</button>)}</div><TransactionRows transactions={transactions} data={store.data} onEdit={onEdit} /></>}</main>
}

function TransactionCalendar({ store, onEdit }: { store: Store; onEdit: (transaction: FinanceTransaction) => void }) {
  const [month, setMonth] = useState(currentMonth())
  const [selected, setSelected] = useState(todayIso().startsWith(currentMonth()) ? todayIso() : `${currentMonth()}-01`)
  const [yearNumber, monthNumber] = month.split('-').map(Number)
  const days = new Date(yearNumber, monthNumber, 0).getDate()
  const start = (new Date(yearNumber, monthNumber - 1, 1).getDay() + 6) % 7
  const byDay = Object.fromEntries(Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`
    const items = activeTransactions(store.data.transactions).filter((item) => item.occurredOn === date)
    return [date, items]
  })) as Record<string, FinanceTransaction[]>
  const moveMonth = (delta: number) => { const date = new Date(yearNumber, monthNumber - 1 + delta, 1); const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; setMonth(next); setSelected(`${next}-01`) }
  const selectedItems = byDay[selected] ?? []
  const selectedReport = reportForRange(selectedItems, selected, selected)
  return <><div className="calendar-switch"><button type="button" aria-label="上個月" onClick={() => moveMonth(-1)}><ChevronLeft /></button><strong>{yearNumber} 年 {monthNumber} 月</strong><button type="button" aria-label="下個月" onClick={() => moveMonth(1)}><ChevronRight /></button></div><div className="calendar-week">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid-v2">{Array.from({ length: start }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => { const date = `${month}-${String(index + 1).padStart(2, '0')}`; const items = byDay[date] ?? []; const hasIncome = items.some((item) => item.reportLines.some((line) => line.direction === 'income')); const hasExpense = items.some((item) => item.reportLines.some((line) => line.direction === 'expense')); return <button className={selected === date ? 'selected' : ''} type="button" key={date} onClick={() => setSelected(date)}><b>{index + 1}</b><i>{hasIncome ? <em className="income-dot" /> : null}{hasExpense ? <em className="expense-dot" /> : null}</i></button> })}</div><div className="day-summary-v2"><strong>{formatDate(selected)}</strong><span>{selectedItems.length ? `${selectedReport.income ? `收入 ${money(selectedReport.income)}` : ''}${selectedReport.income && selectedReport.expense ? '・' : ''}${selectedReport.expense ? `支出 ${money(selectedReport.expense)}` : ''}` : '沒有收支'}</span></div><TransactionRows transactions={selectedItems} data={store.data} onEdit={onEdit} showDateHeading={false} /></>
}

function TransactionFilterPage({ store, value, onChange, onDone }: { store: Store; value: TransactionFilter; onChange: (value: TransactionFilter) => void; onDone: () => void }) {
  const [draft, setDraft] = useState(value)
  return <main className="workspace-page"><form className="settings-form" onSubmit={(event) => { event.preventDefault(); onChange(draft); onDone() }}><label><span>交易類型</span><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as TransactionFilter['kind'] })}><option value="all">全部</option><option value="expense">支出</option><option value="income">收入</option><option value="transfer">轉帳</option><option value="advance">代墊與分帳</option></select></label><label><span>分類</span><select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">全部分類</option>{activeSorted(store.data.categories).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>專案</span><select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}><option value="">全部專案</option>{activeSorted(store.data.projects).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="form-columns"><label><span>開始日期</span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label><label><span>結束日期</span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label></div><button className="primary-button" type="submit">套用篩選</button></form></main>
}

function ReportFilterPage({ store, value, onChange, onDone }: { store: Store; value: ReportRange; onChange: (value: ReportRange) => void; onDone: () => void }) {
  const [draft, setDraft] = useState(value)
  return <main className="workspace-page"><form className="settings-form" onSubmit={(event) => { event.preventDefault(); onChange(draft); onDone() }}><div className="form-columns"><label><span>開始日期</span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label><label><span>結束日期</span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label></div><label><span>帳戶</span><select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}><option value="">全部帳戶</option>{activeSorted(store.data.accounts).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>專案</span><select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}><option value="">全部專案</option>{activeSorted(store.data.projects).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="primary-button" type="submit">套用報表區間</button></form></main>
}

const reportColors = ['#ef476f', '#ffbd2e', '#118ab2', '#06a77d', '#7b61a8', '#f78c6b', '#4d908e', '#8d99ae']

function selectionRange(period: ReportSelection, anchorMonth: string, customRange: ReportRange) {
  return period === '自訂' ? customRange : reportRangeForPeriod(period, anchorMonth)
}

function reportPeriodLabel(period: ReportSelection, anchorMonth: string, range: { from: string; to: string }) {
  const [year, month] = anchorMonth.split('-').map(Number)
  if (period === '月') return `${year} 年 ${month} 月`
  if (period === '年') return `${year} 年`
  if (period === '近6個月') return `${Number(range.from.slice(0, 4))} 年 ${Number(range.from.slice(5, 7))} 月－${year} 年 ${month} 月`
  const short = (date: string) => `${Number(date.slice(0, 4))}/${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
  return `${short(range.from)}－${short(range.to)}`
}

function categoryReportRows(data: FinanceData, transactions: FinanceTransaction[], range: { from: string; to: string }, direction: Direction) {
  const amounts = new Map<string, number>()
  for (const transaction of activeTransactions(transactions)) {
    if (transaction.occurredOn < range.from || transaction.occurredOn > range.to) continue
    for (const line of transaction.reportLines.filter((item) => item.direction === direction)) amounts.set(line.categoryId, (amounts.get(line.categoryId) ?? 0) + line.amountTwdMinor)
  }
  return [...amounts].map(([id, amount]) => ({ id, amount, category: data.categories.find((item) => item.id === id) })).filter((item): item is { id: string; amount: number; category: Category } => Boolean(item.category)).sort((a, b) => b.amount - a.amount)
}

function ReportPrimaryTabs({ mode, onChange, compact = false }: { mode: ReportMode; onChange: (value: ReportMode) => void; compact?: boolean }) {
  return <div className={`report-primary-tabs ${compact ? 'compact' : ''}`} role="group" aria-label="報表類型">
    {([['expense', '支出'], ['income', '收入'], ['balance', '結餘']] as const).map(([value, label]) => <button className={mode === value ? 'active' : ''} type="button" aria-pressed={mode === value} onClick={() => onChange(value)} key={value}>{label}</button>)}
  </div>
}

function ReportsPage({ store, customRange, period, setPeriod, anchorMonth, setAnchorMonth, mode, onCustom, onCategory, onDate }: { store: Store; customRange: ReportRange; period: ReportSelection; setPeriod: (value: ReportSelection) => void; anchorMonth: string; setAnchorMonth: (value: string) => void; mode: ReportMode; onCustom: () => void; onCategory: (direction: Direction, id: string) => void; onDate: (id: string) => void }) {
  const [chartView, setChartView] = useState<'donut' | 'bar'>('donut')
  const [descending, setDescending] = useState(true)
  const [legendPage, setLegendPage] = useState(0)
  const range = selectionRange(period, anchorMonth, customRange)
  const accountFilter = period === '自訂' ? customRange.accountId : ''
  const projectFilter = period === '自訂' ? customRange.projectId : ''
  const sourceTransactions = store.data.transactions.filter((transaction) => (!accountFilter || transaction.accountMoves.some((move) => move.accountId === accountFilter)) && (!projectFilter || transaction.projectId === projectFilter))
  const totals = reportForRange(sourceTransactions, range.from, range.to)
  const direction: Direction = mode === 'income' ? 'income' : 'expense'
  const total = direction === 'income' ? totals.income : totals.expense
  const rows = categoryReportRows(store.data, sourceTransactions, range, direction).map((item, index) => ({ ...item, color: reportColors[index % reportColors.length], percent: item.amount / Math.max(1, total) * 100 }))
  const sortedRows = descending ? rows : [...rows].reverse()
  const legendPageSize = 6
  const legendPages = Math.max(1, Math.ceil(rows.length / legendPageSize))
  const visibleLegend = rows.slice(Math.min(legendPage, legendPages - 1) * legendPageSize, (Math.min(legendPage, legendPages - 1) + 1) * legendPageSize)
  let stop = 0
  const gradient = rows.map((item) => { const start = stop; stop += item.percent; return `${item.color} ${start}% ${stop}%` }).join(', ')
  const reportAccounts = accountFilter ? store.data.accounts.filter((item) => item.id === accountFilter) : store.data.accounts
  const worthTransactions = store.data.transactions.filter((transaction) => !accountFilter || transaction.accountMoves.some((move) => move.accountId === accountFilter))
  const balanceSeries = buildBalanceSeries(sourceTransactions, worthTransactions, reportAccounts, range, period)
  const endingBalances = calculateBalances(reportAccounts, worthTransactions.filter((transaction) => transaction.occurredOn <= range.to))
  const endingNetWorth = calculateNetWorth(reportAccounts, endingBalances).netWorth
  const periodTabs: ReportSelection[] = mode === 'balance' ? ['月', '年', '自訂'] : ['月', '近6個月', '年', '自訂']
  const movePeriod = (delta: number) => {
    const [year, month] = anchorMonth.split('-').map(Number)
    const next = new Date(year, month - 1 + delta * (period === '年' ? 12 : 1), 1)
    setAnchorMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }
  return <main className="workspace-page reports-v3">
    <div className={`report-period-tabs ${mode === 'balance' ? 'three' : ''}`} role="group" aria-label="報表期間">
      {periodTabs.map((item) => <button className={period === item ? 'active' : ''} type="button" onClick={() => { if (item === '自訂') onCustom(); setPeriod(item); setLegendPage(0) }} key={item}>{item}</button>)}
    </div>
    <div className="report-period-switch">
      {period !== '自訂' ? <button type="button" aria-label="上一個期間" onClick={() => movePeriod(-1)}><ChevronLeft /></button> : <span />}
      <strong>{reportPeriodLabel(period, anchorMonth, range)}</strong>
      {period !== '自訂' ? <button type="button" aria-label="下一個期間" onClick={() => movePeriod(1)}><ChevronRight /></button> : <span />}
    </div>
    {mode === 'balance' ? <BalanceReport totals={totals} series={balanceSeries} endingNetWorth={endingNetWorth} descending={descending} onToggleSort={() => setDescending((value) => !value)} onDate={onDate} /> : <>
      <section className="report-chart-panel">
        <button className="report-chart-toggle" type="button" aria-label={chartView === 'donut' ? '切換成柱狀圖' : '切換成圓環圖'} onClick={() => setChartView((value) => value === 'donut' ? 'bar' : 'donut')}>{chartView === 'donut' ? <ChartColumn /> : <ChartPie />}</button>
        {rows.length ? chartView === 'donut' ? <div className="report-donut" style={{ background: `conic-gradient(${gradient})` }}><div><span>總{mode === 'income' ? '收入' : '支出'}</span><strong>{money(total)}</strong></div></div> : <CategoryBarChart rows={rows} /> : <div className="simple-empty compact">這個期間沒有{mode === 'income' ? '收入' : '支出'}資料</div>}
      </section>
      {rows.length ? <section className="report-legend-card">
        <div className="report-legend-grid">{visibleLegend.map((item) => <button type="button" key={item.id} onClick={() => onCategory(direction, item.id)}><i style={{ background: item.color }} /><span>{item.category.name}</span><b>{Math.round(item.percent)}%</b></button>)}</div>
        {legendPages > 1 ? <div className="report-legend-pages">{Array.from({ length: legendPages }, (_, index) => <button className={legendPage === index ? 'active' : ''} type="button" aria-label={`圖例第 ${index + 1} 頁`} onClick={() => setLegendPage(index)} key={index} />)}</div> : null}
      </section> : null}
      <section className="report-detail-card">
        <header><h2>{mode === 'income' ? '收入' : '支出'}明細</h2><button type="button" aria-label={descending ? '改為金額由小到大' : '改為金額由大到小'} onClick={() => setDescending((value) => !value)}><ArrowUpDown /></button></header>
        {sortedRows.length ? sortedRows.map((item) => <button type="button" key={item.id} onClick={() => onCategory(direction, item.id)}><EntityIcon iconKey={item.category.iconKey} /><span>{item.category.name}</span><strong>{money(item.amount)}</strong><ChevronRight /></button>) : <div className="simple-empty compact">沒有分類明細</div>}
      </section>
    </>}
  </main>
}

function CategoryBarChart({ rows }: { rows: { id: string; amount: number; category: Category; color: string }[] }) {
  const visible = rows.slice(0, 8)
  const max = Math.max(...visible.map((item) => item.amount), 1)
  return <div className="report-category-columns">{visible.map((item) => <div key={item.id}><span>{money(item.amount)}</span><i style={{ height: `${Math.max(8, item.amount / max * 100)}%`, background: item.color }} /><b>{item.category.name}</b></div>)}</div>
}

type BalancePoint = { key: string; label: string; income: number; expense: number; balance: number; netWorth: number }

function buildBalanceSeries(flowTransactions: FinanceTransaction[], worthTransactions: FinanceTransaction[], accounts: Account[], range: { from: string; to: string }, period: ReportSelection): BalancePoint[] {
  const spanDays = Math.round((new Date(`${range.to}T00:00:00`).getTime() - new Date(`${range.from}T00:00:00`).getTime()) / 86_400_000)
  const groupByMonth = period === '年' || spanDays > 62
  const groups = new Map<string, FinanceTransaction[]>()
  for (const transaction of activeTransactions(flowTransactions).filter((item) => item.occurredOn >= range.from && item.occurredOn <= range.to)) {
    const key = groupByMonth ? transaction.occurredOn.slice(0, 7) : transaction.occurredOn
    groups.set(key, [...(groups.get(key) ?? []), transaction])
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => {
    const totals = reportForRange(items, groupByMonth ? `${key}-01` : key, groupByMonth ? `${key}-31` : key)
    const pointEnd = groupByMonth ? `${key}-31` : key
    const balances = calculateBalances(accounts, worthTransactions.filter((item) => item.occurredOn <= pointEnd))
    const netWorth = calculateNetWorth(accounts, balances).netWorth
    return { key, label: groupByMonth ? `${Number(key.slice(5))} 月` : formatDateHeading(key), income: totals.income, expense: totals.expense, balance: totals.balance, netWorth }
  })
}

function BalanceReport({ totals, series, endingNetWorth, descending, onToggleSort, onDate }: { totals: ReturnType<typeof reportForRange>; series: BalancePoint[]; endingNetWorth: number; descending: boolean; onToggleSort: () => void; onDate: (id: string) => void }) {
  const displayed = descending ? [...series].reverse() : series
  return <>
    <section className="report-trend-summary"><article><span>收入</span><b className="income-text">{money(totals.income)}</b></article><article><span>支出</span><b className="expense-text">{money(totals.expense)}</b></article><article><span>本期結餘</span><b className={totals.balance < 0 ? 'expense-text' : 'income-text'}>{totals.balance > 0 ? '+' : ''}{money(totals.balance)}</b></article><article><span>期末淨資產</span><b>{money(endingNetWorth)}</b></article></section>
    <section className="report-chart-panel balance-chart-panel">{series.length ? <BalanceLineChart series={series} /> : <div className="simple-empty compact">這個期間沒有收支資料</div>}</section>
    <section className="report-detail-card trend-detail-card"><header><h2>趨勢明細</h2><button type="button" aria-label={descending ? '改為日期由舊到新' : '改為日期由新到舊'} onClick={onToggleSort}><ArrowUpDown /></button></header>{displayed.length ? displayed.map((item) => <button type="button" key={item.key} onClick={() => onDate(item.key)}><span>{item.label}</span><span className="trend-row-values"><small>收入 {money(item.income)}・支出 {money(item.expense)}</small><strong className={item.balance < 0 ? 'expense-text' : 'income-text'}>結餘 {item.balance > 0 ? '+' : ''}{money(item.balance)}</strong><small>淨資產 {money(item.netWorth)}</small></span><ChevronRight /></button>) : <div className="simple-empty compact">沒有趨勢明細</div>}</section>
  </>
}

function BalanceLineChart({ series }: { series: BalancePoint[] }) {
  const width = 320
  const height = 180
  const chartTop = 14
  const chartBottom = 142
  const values = series.flatMap((item) => [item.income, item.expense, item.balance])
  const highest = Math.max(0, ...values)
  const lowest = Math.min(0, ...values)
  const span = Math.max(1, highest - lowest)
  const x = (index: number) => series.length === 1 ? width / 2 : 14 + index / (series.length - 1) * (width - 28)
  const y = (value: number) => chartTop + (highest - value) / span * (chartBottom - chartTop)
  const rawWorthLow = Math.min(...series.map((item) => item.netWorth))
  const rawWorthHigh = Math.max(...series.map((item) => item.netWorth))
  const worthPadding = Math.max(1, (rawWorthHigh - rawWorthLow) * .12)
  const worthLow = rawWorthLow - worthPadding
  const worthHigh = rawWorthHigh + worthPadding
  const worthY = (value: number) => chartTop + (worthHigh - value) / (worthHigh - worthLow) * (chartBottom - chartTop)
  const balancePoints = series.map((item, index) => `${x(index)},${y(item.balance)}`).join(' ')
  const worthPoints = series.map((item, index) => `${x(index)},${worthY(item.netWorth)}`).join(' ')
  const labels = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])]
  const barWidth = Math.max(3, Math.min(10, 42 / Math.max(1, series.length)))
  return <div className="balance-line-chart"><div className="balance-chart-legend"><span><i className="income" />收入</span><span><i className="expense" />支出</span><span><i className="balance" />結餘</span><span><i className="net-worth" />淨資產</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="收入、支出、結餘與淨資產趨勢圖"><line className="zero-line" x1="14" x2={width - 14} y1={y(0)} y2={y(0)} />{series.map((item, index) => <g key={item.key}><rect className="income-bar" x={x(index) - barWidth - 1} y={y(item.income)} width={barWidth} height={Math.max(1, y(0) - y(item.income))} /><rect className="expense-bar" x={x(index) + 1} y={y(item.expense)} width={barWidth} height={Math.max(1, y(0) - y(item.expense))} /></g>)}<g className="balance"><polyline points={balancePoints} />{series.map((item, index) => <circle cx={x(index)} cy={y(item.balance)} r="3" key={`balance-${item.key}`} />)}</g><g className="net-worth"><polyline points={worthPoints} />{series.map((item, index) => <circle cx={x(index)} cy={worthY(item.netWorth)} r="3" key={`worth-${item.key}`} />)}</g>{labels.map((index) => <text x={x(index)} y="169" textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'} key={series[index].key}>{series[index].label.replaceAll(' ', '').replaceAll('（', '(').replaceAll('）', ')')}</text>)}</svg></div>
}

function ReportCategoryPage({ store, reference, customRange, period, anchorMonth, onEditTransaction }: { store: Store; reference: string; customRange: ReportRange; period: ReportSelection; anchorMonth: string; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const [rawDirection, categoryId] = reference.split(':')
  const direction: Direction = rawDirection === 'income' ? 'income' : 'expense'
  const category = store.data.categories.find((item) => item.id === categoryId)
  const range = selectionRange(period, anchorMonth, customRange)
  const accountFilter = period === '自訂' ? customRange.accountId : ''
  const projectFilter = period === '自訂' ? customRange.projectId : ''
  const transactions = activeTransactions(store.data.transactions).filter((transaction) => transaction.occurredOn >= range.from && transaction.occurredOn <= range.to && (!accountFilter || transaction.accountMoves.some((move) => move.accountId === accountFilter)) && (!projectFilter || transaction.projectId === projectFilter) && transaction.reportLines.some((line) => line.direction === direction && line.categoryId === categoryId))
  const total = transactions.flatMap((transaction) => transaction.reportLines.filter((line) => line.direction === direction && line.categoryId === categoryId)).reduce((sum, line) => sum + line.amountTwdMinor, 0)
  if (!category) return <main className="workspace-page"><div className="simple-empty">找不到分類</div></main>
  return <main className="workspace-page"><section className="report-category-summary"><EntityIcon iconKey={category.iconKey} /><span><small>{period}{direction === 'income' ? '收入' : '支出'}</small><strong>{category.name}</strong></span><b className={direction === 'income' ? 'income-text' : 'expense-text'}>{money(total)}</b></section><TransactionRows transactions={transactions} data={store.data} onEdit={onEditTransaction} /></main>
}

function ReportDatePage({ store, dateKey, customRange, period, onEditTransaction }: { store: Store; dateKey: string; customRange: ReportRange; period: ReportSelection; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const from = dateKey.length === 7 ? `${dateKey}-01` : dateKey
  const to = dateKey.length === 7 ? `${dateKey}-31` : dateKey
  const accountFilter = period === '自訂' ? customRange.accountId : ''
  const projectFilter = period === '自訂' ? customRange.projectId : ''
  const transactions = activeTransactions(store.data.transactions).filter((transaction) => transaction.occurredOn >= from && transaction.occurredOn <= to && (!accountFilter || transaction.accountMoves.some((move) => move.accountId === accountFilter)) && (!projectFilter || transaction.projectId === projectFilter) && transaction.reportLines.length)
  const totals = reportForRange(transactions, from, to)
  const label = dateKey.length === 7 ? `${Number(dateKey.slice(0, 4))} 年 ${Number(dateKey.slice(5, 7))} 月` : `${Number(dateKey.slice(5, 7))} 月 ${Number(dateKey.slice(8, 10))} 日`
  return <main className="workspace-page"><section className="report-category-summary report-date-summary"><span><small>{label}</small><strong>結餘 {totals.balance > 0 ? '+' : ''}{money(totals.balance)}</strong></span><b>收入 {money(totals.income)}<small>支出 {money(totals.expense)}</small></b></section><TransactionRows transactions={transactions} data={store.data} onEdit={onEditTransaction} /></main>
}

function BudgetSummaryPage({ store, onPush }: { store: Store; onPush: (route: Route) => void }) {
  const month = currentMonth()
  const report = reportForMonth(store.data.transactions, month)
  const rows = monthlyBudgetRows(store.data.budgets, store.data.categories, store.data.transactions, month)
  const total = rows.reduce((sum, row) => sum + row.monthlyAmount, 0)
  const spent = rows.reduce((sum, row) => sum + row.spent, 0)
  return <main className="workspace-page"><section className="report-summary"><article><span>本月收入</span><b className="income-text">{money(report.income)}</b></article><article><span>本月支出</span><b className="expense-text">{money(report.expense)}</b></article><article><span>本月結餘</span><b>{money(report.balance)}</b></article></section><div className="section-heading"><h2>日常預算</h2><button type="button" onClick={() => onPush({ name: 'budgets' })}>管理預算</button></div><div className="home-budget-card"><span><span>已使用 {total ? Math.round(spent / total * 100) : 0}%</span><strong>{money(spent)} / {money(total)}</strong></span><i><b style={{ width: `${Math.min(100, total ? spent / total * 100 : 0)}%` }} /></i></div><div className="section-heading"><h2>各分類開銷</h2><span>點分類看明細</span></div><div className="budget-rows-v2">{rows.map((row) => { const percent = row.monthlyAmount ? Math.round(row.spent / row.monthlyAmount * 100) : 0; return <button type="button" key={row.budget.id} onClick={() => onPush({ name: 'budget-category', id: row.category?.id })}><EntityIcon iconKey={row.category?.iconKey ?? 'circle-dollar-sign'} /><span><b>{row.category?.name}</b><small>已用 {money(row.spent)}・預算 {money(row.monthlyAmount)}</small><i><em style={{ width: `${Math.min(100, percent)}%` }} /></i></span><strong className={row.spent > row.monthlyAmount ? 'expense-text' : ''}>剩餘 {money(row.monthlyAmount - row.spent)}<small>{percent}% ›</small></strong><ChevronRight /></button> })}</div></main>
}

function BudgetCategoryPage({ store, categoryId, onEditTransaction }: { store: Store; categoryId: string; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const category = store.data.categories.find((item) => item.id === categoryId)
  const row = monthlyBudgetRows(store.data.budgets, store.data.categories, store.data.transactions, currentMonth()).find((item) => item.category?.id === categoryId)
  const transactions = activeTransactions(store.data.transactions).filter((transaction) => monthKey(transaction.occurredOn) === currentMonth() && transaction.reportLines.some((line) => line.categoryId === categoryId))
  if (!category) return <main className="workspace-page"><div className="simple-empty">找不到分類</div></main>
  return <main className="workspace-page"><section className="budget-summary-cards"><article><span>本月已用</span><b>{money(row?.spent ?? 0)}</b></article><article><span>預算剩餘</span><b>{money((row?.monthlyAmount ?? 0) - (row?.spent ?? 0))}</b></article></section><div className="section-heading"><h2>{category.name}明細</h2></div><TransactionRows transactions={transactions} data={store.data} onEdit={onEditTransaction} /></main>
}

function MorePage({ onPush }: { onPush: (route: Route) => void }) {
  const items = [
    { route: 'projects' as const, label: '專案記帳', description: '旅行、活動等獨立收支', icon: ReceiptText },
    { route: 'budgets' as const, label: '預算設定', description: '每月與年度分類預算', icon: CircleDollarSign },
    { route: 'recurring' as const, label: '定期項目', description: '待確認與自動入帳規則', icon: CalendarDays },
    { route: 'advances' as const, label: '代墊與分帳', description: '應收、應付與收還款', icon: HandCoins },
    { route: 'categories' as const, label: '分類與圖示', description: '收入、支出分類與排序', icon: Settings },
  ]
  return <main className="workspace-page"><div className="settings-menu-v2">{items.map((item) => { const Icon = item.icon; return <button type="button" key={item.route} onClick={() => onPush({ name: item.route })}><span className="entity-icon"><Icon /></span><span><b>{item.label}</b><small>{item.description}</small></span><ChevronRight /></button> })}</div></main>
}

function CategoryManager({ store, onPush }: { store: Store; onPush: (route: Route) => void }) {
  const [direction, setDirection] = useState<Direction>('expense')
  const [sorting, setSorting] = useState(false)
  const [dragging, setDragging] = useState('')
  const categories = [...store.data.categories].filter((item) => item.direction === direction).sort((a, b) => a.sortOrder - b.sortOrder)
  const reorder = async (fromId: string, toId: string) => {
    const from = categories.findIndex((item) => item.id === fromId); const to = categories.findIndex((item) => item.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const next = [...categories]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved)
    await Promise.all(next.map((item, index) => store.save('categories', { id: item.id, sortOrder: index })))
  }
  const move = (id: string, delta: number) => {
    const index = categories.findIndex((item) => item.id === id)
    const target = categories[index + delta]
    if (target) void reorder(id, target.id)
  }
  return <main className="workspace-page"><div className="view-toggle-v2"><button className={direction === 'expense' ? 'active' : ''} type="button" onClick={() => setDirection('expense')}>支出類別</button><button className={direction === 'income' ? 'active' : ''} type="button" onClick={() => setDirection('income')}>收入類別</button></div><div className="category-manage-actions"><button type="button" onClick={() => setSorting((value) => !value)}>{sorting ? '完成排序' : '排序'}</button><button type="button" onClick={() => onPush({ name: 'category-form' })}>＋ 新增類別</button></div>{sorting ? <p className="sort-help">拖曳圖示調整順序，或使用上移、下移。</p> : null}<div className="category-manager-grid">{categories.map((category, index) => <div className={`category-tile ${category.archivedAt ? 'archived' : ''} ${sorting ? 'is-sorting' : ''}`} data-sort-id={category.id} draggable={sorting} key={category.id} onDragStart={() => setDragging(category.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => void reorder(dragging, category.id)}>{sorting ? <div className="category-main"><button type="button" className="category-drag" aria-label={`拖曳${category.name}`} onTouchStart={(event) => { event.stopPropagation(); setDragging(category.id) }} onTouchEnd={(event) => { event.stopPropagation(); void reorder(category.id, touchSortTarget(event)) }}><GripVertical /></button><EntityIcon iconKey={category.iconKey} /><b>{category.name}</b></div> : <button className="category-main" type="button" onClick={() => onPush({ name: 'category-form', id: category.id })}><EntityIcon iconKey={category.iconKey} /><b>{category.name}</b></button>}{sorting ? <span className="category-sort-actions"><button type="button" aria-label={`${category.name}上移`} disabled={index === 0} onClick={() => move(category.id, -1)}><ChevronUp /></button><button type="button" aria-label={`${category.name}下移`} disabled={index === categories.length - 1} onClick={() => move(category.id, 1)}><ChevronDown /></button></span> : null}</div>)}</div></main>
}

function CategoryForm({ store, categoryId, onDone }: { store: Store; categoryId?: string; onDone: () => void }) {
  const existing = store.data.categories.find((item) => item.id === categoryId)
  const [name, setName] = useState(existing?.name ?? '')
  const [direction, setDirection] = useState<Direction>(existing?.direction ?? 'expense')
  const [iconKey, setIconKey] = useState(existing?.iconKey ?? 'circle-dollar-sign')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; await store.save('categories', { id: existing?.id, name: name.trim(), direction, iconKey, sortOrder: existing?.sortOrder ?? store.data.categories.filter((item) => item.direction === direction).length, systemKey: existing?.systemKey }); onDone() }
  return <main className="workspace-page"><form className="settings-form" onSubmit={(event) => void submit(event)}><label><span>分類名稱</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>收支類型</span><select value={direction} disabled={Boolean(existing?.systemKey)} onChange={(event) => setDirection(event.target.value as Direction)}><option value="expense">支出</option><option value="income">收入</option></select></label><IconChooser value={iconKey} onChange={setIconKey} /><button className="primary-button" type="submit"><Save />儲存分類</button>{existing && !existing.systemKey ? <button className="danger-button" type="button" onClick={() => void store.archive('categories', existing.id, !existing.archivedAt).then(onDone)}>{existing.archivedAt ? '重新啟用分類' : '封存這個分類'}</button> : null}</form></main>
}

function BudgetManager({ store, onPush }: { store: Store; onPush: (route: Route) => void }) {
  const categories = activeSorted(store.data.categories.filter((item) => item.direction === 'expense' && !item.systemKey))
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly')
  const budgets = activeSorted(store.data.budgets).filter((item) => item.cycle === cycle)
  const totalMonth = activeSorted(store.data.budgets).reduce((sum, item) => sum + (item.cycle === 'monthly' ? item.amountMinor : 0), 0)
  const annualExtra = activeSorted(store.data.budgets).reduce((sum, item) => sum + (item.cycle === 'annual' ? item.amountMinor : 0), 0)
  const yearSpent = reportForRange(store.data.transactions, `${todayIso().slice(0, 4)}-01-01`, `${todayIso().slice(0, 4)}-12-31`).byCategory
  return <main className="workspace-page"><section className="budget-summary-cards"><article><span>每月預算合計</span><b>{money(totalMonth)}</b></article><article><span>全年總預算</span><b>{money(totalMonth * 12 + annualExtra)}</b></article></section><div className="section-heading"><h2>分類預算</h2></div><div className="view-toggle-v2"><button className={cycle === 'monthly' ? 'active' : ''} type="button" onClick={() => setCycle('monthly')}>每月預算</button><button className={cycle === 'annual' ? 'active' : ''} type="button" onClick={() => setCycle('annual')}>年度預算</button></div><div className="settings-menu-v2 budget-list-v2">{budgets.map((budget) => { const category = categories.find((item) => item.id === budget.categoryId); const spent = Math.abs(Math.min(0, yearSpent[budget.categoryId] ?? 0)); return <button type="button" key={budget.id} onClick={() => onPush({ name: 'budget-form', id: budget.id })}><EntityIcon iconKey={category?.iconKey ?? 'circle-dollar-sign'} /><span><b>{category?.name ?? '已封存分類'}</b><small>{cycle === 'monthly' ? `本月預算` : `月均 ${money(Math.round(budget.amountMinor / 12))}・今年已用 ${money(spent)}`}</small></span><strong>{money(budget.amountMinor)}<small>設定 ›</small></strong></button> })}{budgets.length === 0 ? <div className="simple-empty">尚未設定{cycle === 'monthly' ? '每月' : '年度'}預算</div> : null}</div></main>
}

function BudgetForm({ store, budgetId, onDone }: { store: Store; budgetId?: string; onDone: () => void }) {
  const existing = store.data.budgets.find((item) => item.id === budgetId)
  const [cycle, setCycle] = useState<'monthly' | 'annual'>(existing?.cycle ?? 'monthly')
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '')
  const [amount, setAmount] = useState(existing ? String(fromMinor(existing.amountMinor, 'TWD')) : '')
  const categories = activeSorted(store.data.categories.filter((item) => item.direction === 'expense' && !item.systemKey))
  const submit = async () => { if (!categoryId || !numberValue(amount)) return; await store.save('budgets', { id: existing?.id, categoryId, cycle, amountMinor: toMinor(amount, 'TWD'), year: cycle === 'annual' ? Number(todayIso().slice(0, 4)) : undefined }); onDone() }
  return <main className="workspace-page"><form className="settings-form" onSubmit={(event) => { event.preventDefault(); void submit() }}><label><span>控管週期</span><select value={cycle} onChange={(event) => setCycle(event.target.value as 'monthly' | 'annual')}><option value="monthly">每月預算</option><option value="annual">年度預算</option></select></label><label><span>分類</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">請選擇</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label><span>預算金額</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><p className="page-intro">{cycle === 'monthly' ? '每月重新計算使用額度。' : '全年共用額度，適合集中在特定月份的開銷。'}</p><button className="primary-button" type="submit">儲存分類預算</button>{existing ? <button className="danger-button" type="button" onClick={() => void store.archive('budgets', existing.id, true).then(onDone)}>移除這個分類預算</button> : null}</form></main>
}

function ProjectsPage({ store, onPush }: { store: Store; onPush: (route: Route) => void }) {
  const projects = activeSorted(store.data.projects)
  return <main className="workspace-page"><div className="project-grid">{projects.map((project) => { const totals = projectTotals(store.data.transactions, project.id); const percent = project.budgetMinor ? Math.min(100, totals.expense / project.budgetMinor * 100) : 0; return <button type="button" key={project.id} onClick={() => onPush({ name: 'project-detail', id: project.id })}><div className="project-card-head"><span><EntityIcon iconKey={project.iconKey} />{project.name}</span><strong>{money(totals.expense)}{project.budgetMinor ? ` / ${money(project.budgetMinor)}` : ''}</strong></div>{project.budgetMinor ? <i><b style={{ width: `${percent}%` }} /></i> : null}<small>{project.note || `${project.startDate || '未設定期間'}${project.endDate ? `－${project.endDate}` : ''}`}</small></button> })}{projects.length === 0 ? <div className="simple-empty">目前沒有專案</div> : null}</div></main>
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

function ProjectDetailPage({ store, projectId, onEditTransaction }: { store: Store; projectId: string; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const [filter, setFilter] = useState<'all' | Direction>('all')
  const project = store.data.projects.find((item) => item.id === projectId)
  if (!project) return <main className="workspace-page"><div className="simple-empty">找不到專案</div></main>
  const allTransactions = activeTransactions(store.data.transactions).filter((item) => item.projectId === project.id).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
  const transactions = allTransactions.filter((item) => filter === 'all' || item.reportLines.some((line) => line.direction === filter))
  const totals = projectTotals(allTransactions, project.id)
  const spentPercent = project.budgetMinor ? Math.round(totals.expense / project.budgetMinor * 100) : 0
  return <main className="workspace-page"><section className="project-budget-card"><div><span>{project.name}</span><strong>{money(totals.expense)}{project.budgetMinor ? ` / ${money(project.budgetMinor)}` : ''}</strong></div>{project.budgetMinor ? <i><b style={{ width: `${Math.min(100, spentPercent)}%` }} /></i> : null}</section><section className="home-summary project-stats"><article><span>收入</span><strong>{money(totals.income)}</strong></article><article><span>支出</span><strong>{money(totals.expense)}</strong></article><article><span>淨支出</span><strong>{money(totals.expense - totals.income)}</strong></article></section><div className="section-heading"><h2>專案收支細項</h2></div><div className="filter-chips"><button className={filter === 'all' ? 'active' : ''} type="button" onClick={() => setFilter('all')}>全部</button><button className={filter === 'expense' ? 'active' : ''} type="button" onClick={() => setFilter('expense')}>支出</button><button className={filter === 'income' ? 'active' : ''} type="button" onClick={() => setFilter('income')}>收入</button></div><TransactionRows transactions={transactions} data={store.data} onEdit={onEditTransaction} /></main>
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

function PendingPage({ store, onEdit }: { store: Store; onEdit: (rule: RecurringRule) => void }) {
  const pending = pendingRecurring(activeSorted(store.data.recurringRules))
  const due = pending.filter((rule) => rule.nextScheduledOn <= todayIso())
  const future = pending.filter((rule) => rule.nextScheduledOn > todayIso())
  const rowContent = (rule: RecurringRule) => <><EntityIcon iconKey={rule.iconKey} /><span><b>{rule.name}</b><small>{formatDate(rule.nextScheduledOn)} · {rule.postingMode === 'confirm' ? '確認後入帳' : '自動入帳'}</small></span><strong>{money(rule.transactionTemplate.amountMinor)}</strong></>
  const rows = (rules: RecurringRule[], actionable: boolean) => <div className="recurring-list">{rules.map((rule) => <div key={rule.id}>{actionable ? <button className="recurring-edit-target" type="button" aria-label={`調整${rule.name}後確認`} onClick={() => onEdit(rule)}>{rowContent(rule)}</button> : <div className="recurring-preview-row">{rowContent(rule)}</div>}{actionable ? <button className="recurring-confirm" type="button" onClick={() => void postRecurringRule(store, rule)}>確認</button> : null}</div>)}</div>
  return <main className="workspace-page"><div className="section-heading"><h2>今天以前</h2></div>{due.length ? rows(due, true) : <div className="simple-empty compact">目前沒有待確認項目</div>}<div className="section-heading"><h2>未來 7 天</h2></div>{future.length ? rows(future, false) : <div className="simple-empty compact">未來沒有預排項目</div>}</main>
}

function RecurringPage({ store, onPush }: { store: Store; onPush: (route: Route) => void }) {
  const rules = activeSorted(store.data.recurringRules)
  const pending = pendingRecurring(rules)
  return <main className="workspace-page"><section className="report-summary"><article><span>啟用中</span><b>{rules.length} 個規則</b></article><article><span>待確認</span><b>{pending.length} 筆</b></article></section><div className="section-heading"><h2>定期收支與轉帳</h2></div><div className="settings-menu-v2 recurring-rules">{rules.map((rule) => <button type="button" key={rule.id} onClick={() => onPush({ name: 'recurring-form', id: rule.id })}><EntityIcon iconKey={rule.iconKey} /><span><b>{rule.name}</b><small>{rule.frequency === 'weekly' ? '每週' : rule.frequency === 'monthly' ? '每月' : '每年'}・{rule.postingMode === 'confirm' ? '確認後入帳' : '自動入帳'}</small></span><strong>{money(rule.transactionTemplate.amountMinor)}<small>下一次 {formatDate(rule.nextScheduledOn)} ›</small></strong></button>)}</div></main>
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
  const [projectId, setProjectId] = useState(existing?.transactionTemplate.projectId ?? '')
  const [note, setNote] = useState(existing?.transactionTemplate.note ?? '')
  const selectedAccount = store.data.accounts.find((item) => item.id === accountId)
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!name.trim() || !Number(amount) || !accountId || !selectedAccount) return; await store.save('recurringRules', { id: existing?.id, name: name.trim(), iconKey: existing?.iconKey ?? 'calendar-days', frequency, nextScheduledOn: nextDate, postingMode: mode, previewDays: numberValue(previewDays), sortOrder: existing?.sortOrder ?? store.data.recurringRules.length, transactionTemplate: { kind, amountMinor: toMinor(amount, selectedAccount.currency), accountId: kind === 'transfer' ? undefined : accountId, fromAccountId: kind === 'transfer' ? accountId : undefined, toAccountId: kind === 'transfer' ? toAccountId : undefined, categoryId: kind === 'transfer' ? undefined : categoryId, projectId: kind === 'transfer' ? undefined : projectId || undefined, note: note || name.trim() } }); onDone() }
  const categories = activeSorted(store.data.categories.filter((item) => item.direction === kind))
  return <main className="entry-page-v2"><header className="entry-page-head editor-page-head"><IconButton label="返回定期項目" onClick={onDone}><ArrowLeft /></IconButton><h1>{existing ? '編輯定期項目' : '新增定期項目'}</h1><button className="entry-head-save" type="submit" form="recurring-form-v2">儲存</button></header><form id="recurring-form-v2" className="settings-form standalone-editor-content" onSubmit={(event) => void submit(event)}><label><span>項目名稱</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label><span>交易類型</span><select value={kind} onChange={(event) => setKind(event.target.value as 'income' | 'expense' | 'transfer')}><option value="expense">支出</option><option value="income">收入</option><option value="transfer">轉帳</option></select></label><label><span>預設金額</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label><span>{kind === 'transfer' ? '轉出帳戶' : '帳戶'}</span><select value={accountId} onChange={(event) => { setAccountId(event.target.value); setToAccountId('') }}><option value="">請選擇</option>{activeSorted(store.data.accounts).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{kind === 'transfer' ? <label><span>轉入帳戶</span><select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}><option value="">請選擇</option>{activeSorted(store.data.accounts).filter((item) => item.id !== accountId && (!selectedAccount || item.currency === selectedAccount.currency)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label> : <><label><span>分類</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">請選擇</option>{categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label><span>專案</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">無</option>{activeSorted(store.data.projects).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></>}<label><span>週期</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurringRule['frequency'])}><option value="weekly">每週</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label><label><span>下次日期</span><input type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} /></label><label><span>入帳方式</span><select value={mode} onChange={(event) => setMode(event.target.value as RecurringRule['postingMode'])}><option value="confirm">確認後入帳（預設）</option><option value="auto">自動入帳</option></select></label><label><span>提前顯示</span><select value={previewDays} onChange={(event) => setPreviewDays(event.target.value)}><option value="7">提前 7 天</option><option value="3">提前 3 天</option><option value="0">當天</option></select></label><label><span>備註</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>{existing ? <button className="danger-button" type="button" onClick={() => void store.archive('recurringRules', existing.id, true).then(onDone)}><Trash2 />封存這個定期項目</button> : null}</form></main>
}

function advanceShareName(share: { personId: string; name?: string }, data: FinanceData) {
  return share.name?.trim() || data.advancePeople.find((person) => person.id === share.personId)?.name || '未命名'
}

function AdvancesPage({ store, onPush }: { store: Store; onPush: (route: Route) => void }) {
  const [tab, setTab] = useState<'receivable' | 'payable'>('receivable')
  const rows = advanceRows(store.data.transactions).filter((row) => row.remaining > 0 && row.transaction.advance?.direction === tab)
  const allRows = advanceRows(store.data.transactions)
  const receivable = allRows.filter((row) => row.transaction.advance?.direction === 'receivable').reduce((sum, row) => sum + row.remaining, 0)
  const payable = allRows.filter((row) => row.transaction.advance?.direction === 'payable').reduce((sum, row) => sum + row.remaining, 0)
  return <main className="workspace-page"><section className="report-summary"><article><span>別人應還我</span><b>{money(receivable)}</b></article><article><span>我應還別人</span><b>{money(payable)}</b></article></section><div className="section-heading"><h2>未結清項目</h2></div><div className="filter-chips"><button className={tab === 'receivable' ? 'active' : ''} type="button" onClick={() => setTab('receivable')}>待收</button><button className={tab === 'payable' ? 'active' : ''} type="button" onClick={() => setTab('payable')}>待還</button></div><div className="advance-list-v2">{rows.length ? rows.map((row) => { const people = row.transaction.advance?.people.map((share) => advanceShareName(share, store.data)).join('、'); return <button type="button" key={row.transaction.id} onClick={() => onPush({ name: 'advance-detail', id: row.transaction.id })}><EntityIcon iconKey="hand-coins" /><span><b>{people}{row.transaction.note ? `・${row.transaction.note}` : ''}</b><small>原始 {money(row.transaction.advance?.people.reduce((sum, share) => sum + share.expectedMinor, 0) ?? 0, row.transaction.advance?.currency ?? 'TWD')}・{formatDate(row.transaction.occurredOn)}</small></span><strong>待{tab === 'receivable' ? '收' : '還'} {money(row.remaining, row.transaction.advance?.currency ?? 'TWD')}<small>明細 ›</small></strong></button> }) : <div className="simple-empty">目前沒有資料</div>}</div></main>
}

function AdvanceDetailPage({ store, transactionId, onPush, onEditTransaction }: { store: Store; transactionId: string; onPush: (route: Route) => void; onEditTransaction: (transaction: FinanceTransaction) => void }) {
  const transaction = store.data.transactions.find((item) => item.id === transactionId)
  const row = advanceRows(store.data.transactions).find((item) => item.transaction.id === transactionId)
  if (!transaction?.advance || !row) return <main className="workspace-page"><div className="simple-empty">找不到代墊資料</div></main>
  const settlements = activeTransactions(store.data.transactions).filter((item) => item.settlement?.advanceTransactionId === transaction.id)
  const personRows = advancePeopleRows(transaction, store.data.transactions)
  const original = personRows.reduce((sum, person) => sum + person.expectedMinor, 0)
  const paid = original - row.remaining
  const account = store.data.accounts.find((item) => item.id === transaction.accountMoves[0]?.accountId)
  const project = store.data.projects.find((item) => item.id === transaction.projectId)
  return <main className="workspace-page"><section className="advance-balance"><span>{transaction.advance.direction === 'receivable' ? '別人應還我' : '我應還別人'}</span><strong>{money(row.remaining, transaction.advance.currency)}</strong><small>{personRows.map((person) => advanceShareName(person, store.data)).join('、')}{transaction.note ? `・${transaction.note}` : ''}</small></section><section className="detail-card-v2"><div><span>原始金額</span><b>{money(original, transaction.advance.currency)}</b></div><div><span>已處理</span><b>{money(paid, transaction.advance.currency)}</b></div><div><span>日期</span><b>{formatDate(transaction.occurredOn)}</b></div><div><span>付款帳戶</span><b>{account?.name ?? '—'}</b></div><div><span>專案</span><b>{project?.name ?? '無'}</b></div><div><span>備註</span><b>{transaction.note || '—'}</b></div></section>{row.remaining ? <button className="primary-button full-width-action" type="button" onClick={() => onPush({ name: 'settlement', id: transaction.id })}>登記{transaction.advance.direction === 'receivable' ? '收款' : '還款'}</button> : <div className="paid-off"><Check />已全部結清</div>}<section className="workspace-section"><div className="section-heading"><h2>收款／還款紀錄</h2></div><TransactionRows transactions={settlements} data={store.data} onEdit={onEditTransaction} /></section></main>
}

function SettlementPage({ store, reference, onDone }: { store: Store; reference: string; onDone: () => void }) {
  const transaction = store.data.transactions.find((item) => item.id === reference)
  const personRows = transaction ? advancePeopleRows(transaction, store.data.transactions).filter((item) => item.remainingMinor > 0) : []
  const [personId, setPersonId] = useState(personRows[0]?.personId ?? '')
  const [amount, setAmount] = useState(personRows[0] ? String(fromMinor(personRows[0].remainingMinor, transaction?.advance?.currency ?? 'TWD')) : '')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  if (!transaction?.advance) return <main className="workspace-page"><div className="simple-empty">找不到代墊資料</div></main>
  const direction = transaction.advance.direction === 'receivable' ? 'collect' : 'repay'
  const selected = personRows.find((item) => item.personId === personId)
  const submit = async () => {
    const account = store.data.accounts.find((item) => item.id === accountId)
    const value = toMinor(amount, account?.currency ?? transaction.advance?.currency ?? 'TWD')
    if (!account || !selected || !value || value > selected.remainingMinor) return
    await store.save('transactions', { kind: 'settlement', occurredOn: date, note: note || (direction === 'collect' ? '收到代墊款' : '歸還代墊款'), accountMoves: [{ accountId: account.id, deltaMinor: direction === 'collect' ? inflowDelta(account, value) : outflowDelta(account, value), currency: account.currency }], reportLines: [], settlement: { advanceTransactionId: transaction.id, personId, direction, amountMinor: value } })
    onDone()
  }
  return <main className="workspace-page"><form className="settings-form" onSubmit={(event) => { event.preventDefault(); void submit() }}><p className="page-intro">{selected ? `${advanceShareName(selected, store.data)}・待${direction === 'collect' ? '收' : '還'} ${money(selected.remainingMinor, transaction.advance.currency)}` : ''}</p><label><span>本次金額</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>{personRows.length > 1 ? <label><span>姓名</span><select value={personId} onChange={(event) => setPersonId(event.target.value)}>{personRows.map((person) => <option key={person.personId} value={person.personId}>{advanceShareName(person, store.data)}</option>)}</select></label> : null}<label><span>{direction === 'collect' ? '收款帳戶' : '付款帳戶'}</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">請選擇</option>{activeSorted(store.data.accounts).filter((item) => item.currency === transaction.advance?.currency).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>備註</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="primary-button" type="submit">確認{direction === 'collect' ? '收款' : '還款'}</button></form></main>
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>
}

function IconChooser({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return <fieldset className="icon-chooser"><legend>圖示</legend><div>{selectableIcons.map((key) => { const Icon = iconFor(key); return <button className={value === key ? 'selected' : ''} type="button" aria-label={key} key={key} onClick={() => onChange(key)}><Icon />{value === key ? <Check /> : null}</button> })}</div></fieldset>
}
