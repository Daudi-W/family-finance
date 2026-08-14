import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function publicFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    const name = prefix ? `${prefix}/${entry}` : entry
    return statSync(path).isDirectory() ? publicFiles(path, name) : [name]
  })
}

/** 產生 App 本體的離線快取清單，讓沒有網路時網頁本身也打得開。 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'family-finance-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((name) => name !== 'index.html')
      const precache = ['index.html', ...built, ...publicFiles('public')]
      const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12)
      const template = readFileSync('sw.template.js', 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__CACHE_NAME__', `family-finance-${version}`)
          .replace('__PRECACHE__', JSON.stringify(precache)),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorkerPlugin()],
})
