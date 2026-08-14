export type Direction = 'income' | 'expense'

export type LegacyEntry = {
  occurredOn: string
  category: string
  parentCategory: string
  amount: number
  currency: string
  member: string
  account: string
  tags: string
  note: string
  direction: Direction
  sourceUpdatedAt: string
  sourceId: string
}

export type LegacyTransfer = {
  occurredOn: string
  fromAccount: string
  fromAmount: number
  fromCurrency: string
  toAccount: string
  toAmount: number
  toCurrency: string
  tags: string
  note: string
  sourceUpdatedAt: string
  sourceId: string
}

const ENTRY_HEADER = ['日期', '類別', '大類別', '金額', '幣別', '成員', '帳戶', '標籤', '備註', '收支區分', '上次更新', 'UUID']
const TRANSFER_HEADER = ['日期', '從帳戶', '轉出金額', '幣別', '到帳戶', '轉入金額', '幣別', '標籤', '備註', '上次更新', 'UUID']

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (quoted) throw new Error('CSV 引號未正確結束')
  if (field || row.length) {
    row.push(field)
    if (row.some((cell) => cell !== '')) rows.push(row)
  }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '')
  return rows
}

function assertHeader(actual: string[] | undefined, expected: string[], label: string) {
  if (!actual || actual.length !== expected.length || actual.some((cell, index) => cell.trim() !== expected[index])) {
    throw new Error(`${label}欄位不符合天天記帳匯出格式`)
  }
}

export function normalizeLegacyDate(value: string): string {
  const compact = value.trim().replaceAll('/', '').replaceAll('-', '')
  if (!/^\d{8}$/.test(compact)) throw new Error(`無法辨識日期：${value}`)
  const result = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  const date = new Date(`${result}T00:00:00Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== result) throw new Error(`無效日期：${value}`)
  return result
}

function amount(value: string): number {
  const parsed = Number(value.trim().replaceAll(',', ''))
  if (!Number.isFinite(parsed)) throw new Error(`無法辨識金額：${value}`)
  return parsed
}

function direction(value: string): Direction {
  const normalized = value.trim()
  if (normalized === '收' || normalized === '收入') return 'income'
  if (normalized === '支' || normalized === '支出') return 'expense'
  throw new Error(`無法辨識收支區分：${value}`)
}

export function parseLegacyEntries(text: string): LegacyEntry[] {
  const [header, ...rows] = parseCsv(text)
  assertHeader(header, ENTRY_HEADER, '收支 CSV ')
  return rows.map((cells, index) => {
    if (cells.length !== ENTRY_HEADER.length) throw new Error(`收支 CSV 第 ${index + 2} 列欄位數錯誤`)
    return {
      occurredOn: normalizeLegacyDate(cells[0]), category: cells[1].trim(), parentCategory: cells[2].trim(),
      amount: amount(cells[3]), currency: cells[4].trim(), member: cells[5].trim(), account: cells[6].trim(),
      tags: cells[7].trim(), note: cells[8].trim(), direction: direction(cells[9]), sourceUpdatedAt: cells[10].trim(), sourceId: cells[11].trim(),
    }
  })
}

export function parseLegacyTransfers(text: string): LegacyTransfer[] {
  const [header, ...rows] = parseCsv(text)
  assertHeader(header, TRANSFER_HEADER, '轉帳 CSV ')
  return rows.map((cells, index) => {
    if (cells.length !== TRANSFER_HEADER.length) throw new Error(`轉帳 CSV 第 ${index + 2} 列欄位數錯誤`)
    return {
      occurredOn: normalizeLegacyDate(cells[0]), fromAccount: cells[1].trim(), fromAmount: amount(cells[2]), fromCurrency: cells[3].trim(),
      toAccount: cells[4].trim(), toAmount: amount(cells[5]), toCurrency: cells[6].trim(), tags: cells[7].trim(), note: cells[8].trim(),
      sourceUpdatedAt: cells[9].trim(), sourceId: cells[10].trim(),
    }
  })
}

function firstDayOfRecentSixMonths(asOf: string) {
  const date = new Date(`${asOf}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() - 5, 1)
  return date.toISOString().slice(0, 10)
}

function duplicateIds(rows: Array<{ sourceId: string }>) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.sourceId)) duplicates.add(row.sourceId)
    seen.add(row.sourceId)
  }
  return [...duplicates]
}

export function buildLegacyPreview(entries: LegacyEntry[], transfers: LegacyTransfer[], asOf: string) {
  const recentFrom = firstDayOfRecentSixMonths(asOf)
  const postedEntries = entries.filter((row) => row.occurredOn <= asOf)
  const postedTransfers = transfers.filter((row) => row.occurredOn <= asOf)
  const categoryMap = new Map<string, { name: string; direction: Direction; totalCount: number; recentCount: number }>()
  for (const row of postedEntries) {
    const key = `${row.direction}:${row.category}`
    const item = categoryMap.get(key) ?? { name: row.category, direction: row.direction, totalCount: 0, recentCount: 0 }
    item.totalCount += 1
    if (row.occurredOn >= recentFrom) item.recentCount += 1
    categoryMap.set(key, item)
  }
  const categories = [...categoryMap.values()].map((item) => ({
    ...item,
    activeForNewEntry: item.recentCount > 0,
    systemKey: item.name === '餘額調整' ? `balance_adjustment_${item.direction}` : item.name === '轉帳手續費' ? 'bank_fee' : undefined,
    countsTowardBudget: item.name !== '餘額調整',
  })).sort((left, right) => Number(right.activeForNewEntry) - Number(left.activeForNewEntry) || right.recentCount - left.recentCount || left.name.localeCompare(right.name, 'zh-Hant'))

  const accountMap = new Map<string, { name: string; totalCount: number; recentCount: number; currencies: Set<string> }>()
  const addAccount = (name: string, currency: string, occurredOn: string) => {
    const item = accountMap.get(name) ?? { name, totalCount: 0, recentCount: 0, currencies: new Set<string>() }
    item.totalCount += 1
    if (occurredOn >= recentFrom) item.recentCount += 1
    if (currency) item.currencies.add(currency)
    accountMap.set(name, item)
  }
  for (const row of postedEntries) addAccount(row.account, row.currency, row.occurredOn)
  for (const row of postedTransfers) {
    addAccount(row.fromAccount, row.fromCurrency, row.occurredOn)
    addAccount(row.toAccount, row.toCurrency, row.occurredOn)
  }
  const accounts = [...accountMap.values()].map((item) => ({ ...item, currencies: [...item.currencies].sort(), activeForNewEntry: item.recentCount > 0 }))
    .sort((left, right) => Number(right.activeForNewEntry) - Number(left.activeForNewEntry) || right.recentCount - left.recentCount || left.name.localeCompare(right.name, 'zh-Hant'))
  const dateRange = (rows: Array<{ occurredOn: string }>) => rows.length ? { from: rows.reduce((min, row) => row.occurredOn < min ? row.occurredOn : min, rows[0].occurredOn), to: rows.reduce((max, row) => row.occurredOn > max ? row.occurredOn : max, rows[0].occurredOn) } : null

  return {
    asOf,
    recentFrom,
    source: {
      entries: entries.length,
      transfers: transfers.length,
      entryDateRange: dateRange(entries),
      transferDateRange: dateRange(transfers),
      entryUuidDuplicates: duplicateIds(entries).length,
      transferUuidDuplicates: duplicateIds(transfers).length,
      missingEntryUuids: entries.filter((row) => !row.sourceId).length,
      missingTransferUuids: transfers.filter((row) => !row.sourceId).length,
    },
    proposed: {
      postedEntries: postedEntries.length,
      postedTransfers: postedTransfers.length,
      futureEntriesHeld: entries.length - postedEntries.length,
      futureTransfersHeld: transfers.length - postedTransfers.length,
      accountNames: accounts.length,
      activeAccounts: accounts.filter((item) => item.activeForNewEntry).length,
      archivedHistoricalAccounts: accounts.filter((item) => !item.activeForNewEntry).length,
      activeCategories: categories.filter((item) => item.activeForNewEntry).length,
      archivedHistoricalCategories: categories.filter((item) => !item.activeForNewEntry).length,
    },
    categories,
    accounts,
    currencies: [...new Set([...entries.map((row) => row.currency), ...transfers.flatMap((row) => [row.fromCurrency, row.toCurrency])])].filter(Boolean).sort(),
    warnings: [
      ...(entries.some((row) => row.parentCategory) ? [] : ['大類別欄位皆為空白，分類以「類別」欄為準。']),
      ...(entries.some((row) => row.occurredOn > asOf) ? ['未來日期的收支暫不列入正式帳務。'] : []),
      '代收、代收/付、還款、借款等舊分類先原樣保留，不自動改判為代墊或轉帳。',
      '帳戶名稱仍需與舊系統目前帳戶設定核對後才能正式匯入。',
    ],
  }
}
