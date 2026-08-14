export type TwdReferenceRate = {
  currency: string
  rate: number
  date: string
  source: 'frankfurter'
}

type FrankfurterRate = {
  date?: unknown
  base?: unknown
  quote?: unknown
  rate?: unknown
}

export async function fetchTwdReferenceRates(currencies: string[], fetcher: typeof fetch = fetch) {
  const normalized = [...new Set(currencies.map((currency) => currency.trim().toUpperCase()).filter((currency) => currency && currency !== 'TWD'))]
  const quotes = await Promise.all(normalized.map(async (currency): Promise<TwdReferenceRate> => {
    const response = await fetcher(`https://api.frankfurter.dev/v2/rate/${encodeURIComponent(currency)}/TWD`)
    if (!response.ok) throw new Error(`${currency} 匯率讀取失敗（${response.status}）`)
    const data = await response.json() as FrankfurterRate
    if (data.base !== currency || data.quote !== 'TWD' || typeof data.date !== 'string' || typeof data.rate !== 'number' || !Number.isFinite(data.rate) || data.rate <= 0) {
      throw new Error(`${currency} 匯率資料格式不正確`)
    }
    return { currency, rate: data.rate, date: data.date, source: 'frankfurter' }
  }))
  return Object.fromEntries(quotes.map((quote) => [quote.currency, quote]))
}
