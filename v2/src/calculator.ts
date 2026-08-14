const operators = new Set(['+', '-', '*', '/'])

const precedence = (operator: string) => operator === '*' || operator === '/' ? 2 : 1

export function evaluateCalculatorExpression(source: string): number | null {
  const expression = source.replaceAll('＋', '+').replaceAll('－', '-').replaceAll('−', '-').replaceAll('×', '*').replaceAll('÷', '/').replaceAll(/\s/g, '')
  if (!expression) return 0
  const rawTokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+|[+\-*/])/g)
  if (!rawTokens || rawTokens.join('') !== expression) return null

  const tokens: Array<number | string> = []
  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index]
    const previous = rawTokens[index - 1]
    const unary = (token === '-' || token === '+') && (index === 0 || operators.has(previous ?? ''))
    if (unary) {
      const next = rawTokens[index + 1]
      if (!next || operators.has(next)) return null
      tokens.push(Number(`${token}${next}`))
      index += 1
    } else if (operators.has(token)) tokens.push(token)
    else tokens.push(Number(token))
  }

  const values: number[] = []
  const operationStack: string[] = []
  const apply = () => {
    const operator = operationStack.pop()
    const right = values.pop()
    const left = values.pop()
    if (!operator || left === undefined || right === undefined || (operator === '/' && right === 0)) return false
    const result = operator === '+' ? left + right : operator === '-' ? left - right : operator === '*' ? left * right : left / right
    if (!Number.isFinite(result)) return false
    values.push(result)
    return true
  }

  for (const token of tokens) {
    if (typeof token === 'number') values.push(token)
    else {
      while (operationStack.length && precedence(operationStack.at(-1) ?? '') >= precedence(token)) if (!apply()) return null
      operationStack.push(token)
    }
  }
  while (operationStack.length) if (!apply()) return null
  return values.length === 1 && Number.isFinite(values[0]) ? values[0] : null
}

export function formatCalculatorResult(value: number) {
  const rounded = Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}
