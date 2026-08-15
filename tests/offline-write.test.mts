import assert from 'node:assert/strict'
import test from 'node:test'
import { settleOrQueue } from '../v2/src/offline-write.ts'

test('正常成功的寫入會照常等待，不會被超時提前放行', async () => {
  const started = Date.now()
  let resolved = false
  await settleOrQueue(Promise.resolve().then(() => { resolved = true }), 200)
  assert.equal(resolved, true)
  assert.ok(Date.now() - started < 100, '應該幾乎立刻返回，不用等到超時')
})

test('真正的錯誤（如權限被拒）會被回報，不會被超時吞掉', async () => {
  await assert.rejects(
    settleOrQueue(Promise.reject(new Error('permission-denied')), 200),
    /permission-denied/,
  )
})

test('離線時卡住不動的寫入，超時後會放行，不讓使用者卡住', async () => {
  const started = Date.now()
  const neverSettles = new Promise(() => {}) // 模擬離線時 commit() 永遠不 resolve
  await settleOrQueue(neverSettles, 50)
  const elapsed = Date.now() - started
  assert.ok(elapsed >= 50 && elapsed < 300, `應該在超時附近返回，實際 ${elapsed}ms`)
})

test('超時放行之後，若原本的寫入之後才失敗，不會產生未處理的 rejection', async () => {
  let rejectLate: (error: Error) => void = () => {}
  const laterFails = new Promise((_, reject) => { rejectLate = reject })
  await settleOrQueue(laterFails, 30)
  rejectLate(new Error('之後才失敗，不該讓整個程序爆炸'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  // 執行到這裡代表 unhandled rejection 沒有讓測試程序中斷
  assert.ok(true)
})
