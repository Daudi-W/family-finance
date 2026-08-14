export type FirestoreDocument = { path: string; data: Record<string, unknown> }

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, clean(item)]))
  return value
}

export function firestoreValue(input: unknown): Record<string, unknown> {
  const value = clean(input)
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } }
  throw new Error(`不支援的 Firestore 欄位型別：${typeof value}`)
}

export function firestoreFields(data: Record<string, unknown>) {
  return (firestoreValue(data).mapValue as { fields: Record<string, unknown> }).fields
}

/** 把 Firestore REST 的型別包裝還原成一般 JavaScript 值。 */
export function firestoreDecode(value: Record<string, unknown>): unknown {
  if (value === null || value === undefined) return null
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return String(value.timestampValue)
  if ('stringValue' in value) return String(value.stringValue)
  if ('arrayValue' in value) {
    const items = (value.arrayValue as { values?: Array<Record<string, unknown>> }).values ?? []
    return items.map(firestoreDecode)
  }
  if ('mapValue' in value) return firestoreDocumentData((value.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields ?? {})
  throw new Error(`不支援的 Firestore 回傳型別：${Object.keys(value).join(',')}`)
}

export function firestoreDocumentData(fields: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([key, value]) => [key, firestoreDecode(value)]))
}

export function chunks<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('批次大小必須是正整數')
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}
