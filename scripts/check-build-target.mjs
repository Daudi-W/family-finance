import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 防呆：確認打包出來的前端連的是預期的 Firebase 專案。
 * Vite 的 .env.production.local 優先權高於 .env.local，
 * 曾經因此把「正式站設定」打包進 dev 網站，讓 dev 直接讀寫真實帳本。
 */
const expected = process.argv[2]
if (!expected) throw new Error('用法：check-build-target.mjs <projectId>')

const assets = join('v2', 'dist', 'assets')
const files = (await readdir(assets)).filter((name) => name.endsWith('.js'))
if (files.length === 0) throw new Error('找不到建置產物，請先執行建置')

const found = new Set()
for (const file of files) {
  const source = await readFile(join(assets, file), 'utf8')
  for (const match of source.matchAll(/family-finance-[a-z0-9-]*\d{6}/g)) found.add(match[0])
}
const others = [...found].filter((id) => id !== expected)
if (!found.has(expected)) throw new Error(`建置產物沒有指向 ${expected}，實際找到：${[...found].join(', ') || '（無）'}`)
if (others.length > 0) throw new Error(`建置產物混到其他 Firebase 專案：${others.join(', ')}`)
console.log(`建置目標確認：${expected}`)
