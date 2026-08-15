/**
 * Firestore 的 writeBatch().commit() 要等伺服器確認才會 resolve；離線時本機其實
 * 已經寫好、也已經排進待補送佇列，但這個 promise 會一直卡著不動，導致畫面上的
 * 「儲存中」永遠轉不停。真正的錯誤（權限被拒、規則不符）通常在有網路時幾百毫秒
 * 內就會 reject，所以用一個短超時：真的失敗會被抓到並回報；純粹沒網路的情況，
 * 超時後就當作「已在本機排隊，之後自動補送」放行，不讓使用者卡住。
 */
export async function settleOrQueue(promise: Promise<unknown>, timeoutMs = 4000): Promise<void> {
  let settled = false
  const guarded = promise.then(
    () => { settled = true },
    (error) => { settled = true; throw error },
  )
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
  await Promise.race([guarded, timeout])
  if (!settled) guarded.catch(() => {})
}
