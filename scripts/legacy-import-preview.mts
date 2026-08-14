import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { buildLegacyPreview, parseLegacyEntries, parseLegacyTransfers } from '../src/import/legacy-csv.mts'

const [entryPath, transferPath, asOf = new Date().toISOString().slice(0, 10)] = process.argv.slice(2)
if (!entryPath || !transferPath) throw new Error('用法：legacy-import-preview.mts <收支.csv> <轉帳.csv> [YYYY-MM-DD]')

const entries = parseLegacyEntries(await readFile(entryPath, 'utf8'))
const transfers = parseLegacyTransfers(await readFile(transferPath, 'utf8'))
const preview = buildLegacyPreview(entries, transfers, asOf)
const outputDir = resolve('local/migration-preview')
await mkdir(outputDir, { recursive: true })
await writeFile(resolve(outputDir, 'preview.json'), JSON.stringify({ sources: [basename(entryPath), basename(transferPath)], ...preview }, null, 2))

const active = preview.categories.filter((item) => item.activeForNewEntry)
const archived = preview.categories.filter((item) => !item.activeForNewEntry)
const activeAccounts = preview.accounts.filter((item) => item.activeForNewEntry)
const archivedAccounts = preview.accounts.filter((item) => !item.activeForNewEntry)
const categoryLines = (items: typeof preview.categories) => items.map((item) => `- ${item.direction === 'income' ? '收入' : '支出'}｜${item.name}：半年 ${item.recentCount} 筆、歷史 ${item.totalCount} 筆${item.systemKey ? `（${item.systemKey}）` : ''}`).join('\n') || '- 無'
const accountLines = (items: typeof preview.accounts) => items.map((item) => `- ${item.name}：半年異動 ${item.recentCount} 次、歷史 ${item.totalCount} 次；${item.currencies.join('／') || '未標示幣別'}`).join('\n') || '- 無'
const report = `# 舊資料匯入唯讀預覽\n\n產生基準日：${preview.asOf}\n最近六個月範圍：${preview.recentFrom}～${preview.asOf}\n\n## 來源檢查\n\n- 收支：${preview.source.entries} 筆（${preview.source.entryDateRange?.from}～${preview.source.entryDateRange?.to}）\n- 轉帳：${preview.source.transfers} 筆（${preview.source.transferDateRange?.from}～${preview.source.transferDateRange?.to}）\n- UUID 重複：收支 ${preview.source.entryUuidDuplicates}、轉帳 ${preview.source.transferUuidDuplicates}\n\n## 建議匯入範圍\n\n- 正式收支：${preview.proposed.postedEntries} 筆\n- 正式轉帳：${preview.proposed.postedTransfers} 筆\n- 未來交易暫留：收支 ${preview.proposed.futureEntriesHeld}、轉帳 ${preview.proposed.futureTransfersHeld}\n- 最近半年常用類別：${preview.proposed.activeCategories} 項\n- 僅歷史保留類別：${preview.proposed.archivedHistoricalCategories} 項\n- 最近半年使用帳戶：${preview.proposed.activeAccounts} 個\n- 僅歷史保留帳戶：${preview.proposed.archivedHistoricalAccounts} 個\n\n## 最近半年常用類別\n\n${categoryLines(active)}\n\n## 僅歷史保留、預設封存\n\n${categoryLines(archived)}\n\n## 最近半年使用帳戶\n\n${accountLines(activeAccounts)}\n\n## 僅歷史保留帳戶\n\n${accountLines(archivedAccounts)}\n\n## 注意事項\n\n${preview.warnings.map((item) => `- ${item}`).join('\n')}\n`
await writeFile(resolve(outputDir, 'report.md'), report)
console.log(JSON.stringify({ outputDir, source: preview.source, proposed: preview.proposed, warnings: preview.warnings }, null, 2))
