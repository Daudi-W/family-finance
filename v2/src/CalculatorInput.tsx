import { useEffect, useState, type InputHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Delete, X } from 'lucide-react'
import { evaluateCalculatorExpression, formatCalculatorResult } from './calculator.ts'

type CalculatorInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'inputMode' | 'type' | 'value'> & {
  value: string
  onValueChange: (value: string) => void
}

const operatorPattern = /[+\-×÷]$/

export function CalculatorInput({ value, onValueChange, disabled, ...props }: CalculatorInputProps) {
  const [open, setOpen] = useState(false)
  const [expression, setExpression] = useState('')
  const [error, setError] = useState('')
  const [useCustomKeypad] = useState(() => window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 820)

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  const show = () => {
    if (!useCustomKeypad || disabled) return
    setExpression(value.replaceAll(',', '') || '')
    setError('')
    setOpen(true)
  }
  const number = (digit: string) => {
    setError('')
    setExpression((current) => {
      if (current.length >= 30) return current
      const segment = current.split(/[+\-×÷]/).at(-1) ?? ''
      if (digit === '.') {
        if (segment.includes('.')) return current
        return `${current}${segment ? '' : '0'}.`
      }
      if (!current || current === '0') return digit === '00' ? '0' : digit
      return `${current}${digit}`
    })
  }
  const operator = (next: string) => {
    setError('')
    setExpression((current) => {
      if (!current) return next === '-' ? '-' : current
      if (current === '-') return current
      if (operatorPattern.test(current)) return `${current.slice(0, -1)}${next}`
      return `${current.endsWith('.') ? `${current}0` : current}${next}`
    })
  }
  const done = () => {
    const result = evaluateCalculatorExpression(expression)
    if (result === null) return setError('算式還沒完成')
    onValueChange(formatCalculatorResult(result))
    setOpen(false)
  }
  const preview = expression && !operatorPattern.test(expression) ? evaluateCalculatorExpression(expression) : null

  return <>
    <input
      {...props}
      disabled={disabled}
      inputMode={useCustomKeypad ? 'none' : 'decimal'}
      readOnly={useCustomKeypad}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onClick={show}
      onFocus={show}
    />
    {open ? createPortal(<div className="calculator-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section className="calculator-keypad" role="dialog" aria-modal="true" aria-label="金額計算機">
        <header><span><small>金額計算</small><strong>{expression || '0'}</strong>{preview !== null && expression ? <em>= {formatCalculatorResult(preview)}</em> : null}</span><button type="button" aria-label="關閉計算機" onClick={() => setOpen(false)}><X /></button></header>
        {error ? <p role="alert">{error}</p> : null}
        <div className="calculator-grid">
          {['7', '8', '9'].map((key) => <button type="button" key={key} onClick={() => number(key)}>{key}</button>)}
          <button className="operator" type="button" onClick={() => operator('÷')}>÷</button>
          <button className="operator" type="button" onClick={() => { setExpression(''); setError('') }}>AC</button>
          {['4', '5', '6'].map((key) => <button type="button" key={key} onClick={() => number(key)}>{key}</button>)}
          <button className="operator" type="button" onClick={() => operator('×')}>×</button>
          <button className="operator" type="button" aria-label="刪除一位" onClick={() => { setExpression((current) => current.slice(0, -1)); setError('') }}><Delete /></button>
          {['1', '2', '3'].map((key) => <button type="button" key={key} onClick={() => number(key)}>{key}</button>)}
          <button className="operator" type="button" onClick={() => operator('+')}>＋</button>
          <button className="calculator-done" type="button" onClick={done}>完成</button>
          <button type="button" onClick={() => number('00')}>00</button>
          <button type="button" onClick={() => number('0')}>0</button>
          <button type="button" onClick={() => number('.')}>.</button>
          <button className="operator" type="button" onClick={() => operator('-')}>－</button>
        </div>
      </section>
    </div>, document.body) : null}
  </>
}
