import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchTwdReferenceRates } from '../v2/src/exchange-rates.ts'

test('外幣匯率會去重、排除台幣並驗證回傳幣別', async () => {
  const requested: string[] = []
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input)
    requested.push(url)
    const currency = url.includes('/JPY/') ? 'JPY' : 'USD'
    return new Response(JSON.stringify({ date: '2026-08-14', base: currency, quote: 'TWD', rate: currency === 'JPY' ? 0.2017 : 32.147 }), { status: 200 })
  }
  const rates = await fetchTwdReferenceRates(['jpy', 'TWD', 'JPY', 'usd'], fakeFetch as typeof fetch)
  assert.equal(requested.length, 2)
  assert.deepEqual(rates.JPY, { currency: 'JPY', rate: 0.2017, date: '2026-08-14', source: 'frankfurter' })
  assert.equal(rates.USD.rate, 32.147)
})

test('外幣匯率異常時不接受零值或錯誤報價幣別', async () => {
  const zeroRate = async () => new Response(JSON.stringify({ date: '2026-08-14', base: 'JPY', quote: 'TWD', rate: 0 }), { status: 200 })
  await assert.rejects(fetchTwdReferenceRates(['JPY'], zeroRate as typeof fetch), /格式不正確/)
})
