import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildLegacyImportDryRun, parseLegacyEntries, parseLegacyTransfers, type LegacyAccountMapping } from '../src/import/legacy-csv.mts'

const [entryPath, transferPath, mappingPath, asOf = new Date().toISOString().slice(0, 10)] = process.argv.slice(2)
if (!entryPath || !transferPath || !mappingPath) throw new Error('用法：legacy-import-dry-run.mts <收支.csv> <轉帳.csv> <帳戶對應.json> [YYYY-MM-DD]')
const entries = parseLegacyEntries(await readFile(entryPath, 'utf8'))
const transfers = parseLegacyTransfers(await readFile(transferPath, 'utf8'))
const mappings = JSON.parse(await readFile(mappingPath, 'utf8')) as LegacyAccountMapping[]
const result = buildLegacyImportDryRun(entries, transfers, mappings, asOf)
const outputDir = resolve('local/migration-preview')
await mkdir(outputDir, { recursive: true })
await writeFile(resolve(outputDir, 'proposed-import.json'), JSON.stringify(result, null, 2))
const unresolved = [...new Set(result.held.filter((item) => item.reason === 'unmapped_account').flatMap((item) => item.accounts))].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
await writeFile(resolve(outputDir, 'dry-run-summary.md'), `# 正式匯入乾跑\n\n- 可轉換交易：${result.transactions.length} 筆\n- 暫留交易：${result.held.length} 筆\n- 未來日期：${result.heldByReason.future_date ?? 0} 筆\n- 帳戶未對應：${result.heldByReason.unmapped_account ?? 0} 筆\n- 已對應帳戶：${result.mappedAccounts} 個\n\n## 尚未對應的帳戶名稱\n\n${unresolved.map((name) => `- ${name}`).join('\n') || '- 無'}\n`)
console.log(JSON.stringify({ transactions: result.transactions.length, held: result.held.length, heldByReason: result.heldByReason, mappedAccounts: result.mappedAccounts, unresolvedAccounts: unresolved.length }, null, 2))
