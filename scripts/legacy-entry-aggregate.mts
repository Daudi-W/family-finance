import { readFile } from 'node:fs/promises'
import { parseLegacyEntries } from '../src/import/legacy-csv.mts'

const [entryPath, from, to] = process.argv.slice(2)
if (!entryPath || !from || !to) throw new Error('用法：legacy-entry-aggregate.mts <收支.csv> <from> <to>')

const rows = parseLegacyEntries(await readFile(entryPath, 'utf8')).filter((row) => row.occurredOn >= from && row.occurredOn <= to)
const buckets: Record<string, [number, number]> = {}
for (const row of rows) {
  const key = `${row.occurredOn.slice(0, 7)}|${row.direction}|${row.category}`
  const bucket = buckets[key] ?? [0, 0]
  bucket[0] += 1
  bucket[1] += Math.abs(row.amount)
  buckets[key] = bucket
}
console.log(JSON.stringify(buckets))
