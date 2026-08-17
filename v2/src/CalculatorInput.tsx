import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type InputHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Delete } from 'lucide-react'
import { evaluateCalculatorExpression, formatCalculatorResult } from './calculator.ts'

type CalculatorInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'inputMode' | 'type' | 'value'> & {
  value: string
  onValueChange: (value: string) => void
  /** 數字每變一次就自動打開鍵盤，用於「一進記帳頁就直接輸入金額」。 */
  autoOpenSignal?: number
}

/** 全域只保留一個開著的金額鍵盤：點另一個金額欄位時，鍵盤直接跳過去。 */
let activeFieldId = ''
const activeFieldListeners = new Set<() => void>()
const subscribeActiveField = (listener: () => void) => { activeFieldListeners.add(listener); return () => { activeFieldListeners.delete(listener) } }
const readActiveField = () => activeFieldId
function focusField(id: string) {
  if (activeFieldId === id) return
  activeFieldId = id
  for (const listener of activeFieldListeners) listener()
}

const operatorPattern = /[+\-×÷]$/

export function CalculatorInput({ value, onValueChange, disabled, autoOpenSignal = 0, ...props }: CalculatorInputProps) {
  const fieldId = useId()
  const open = useSyncExternalStore(subscribeActiveField, readActiveField) === fieldId
  const [expression, setExpression] = useState('')
  const [error, setError] = useState('')
  const [useCustomKeypad] = useState(() => window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 820)
  const inputRef = useRef<HTMLInputElement>(null)
  const expressionRef = useRef('')

  // 一進記帳頁就直接進入金額輸入，少按一下
  useEffect(() => {
    if (!autoOpenSignal || !useCustomKeypad || disabled) return
    const initial = value.replaceAll(',', '') || ''
    expressionRef.current = initial
    setExpression(initial)
    setError('')
    focusField(fieldId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenSignal])

  // 鍵盤浮在下方而不是蓋住整頁，開啟時把正在編輯的欄位捲到看得到的位置
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    return () => cancelAnimationFrame(frame)
  }, [open])

  // 沒有遮罩，所以自己判斷「點到別的地方」要收起來；點其他金額欄位則交給那一欄接手
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.calculator-keypad') || target?.closest('[data-calculator-field]')) return
      focusField('')
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  const show = () => {
    if (!useCustomKeypad || disabled) return
    const initial = value.replaceAll(',', '') || ''
    expressionRef.current = initial
    setExpression(initial)
    setError('')
    focusField(fieldId)
  }

  /** 每次變動就把目前算得出來的結果寫回欄位，不用等按完成。 */
  const apply = (next: string) => {
    expressionRef.current = next
    setExpression(next)
    setError('')
    if (!next) return onValueChange('')
    if (operatorPattern.test(next)) return
    const result = evaluateCalculatorExpression(next)
    if (result !== null) onValueChange(formatCalculatorResult(result))
  }

  // 用 ref 讀目前算式，連續快速點按時不會因為還沒重繪而吃掉數字
  const number = (digit: string) => {
    const current = expressionRef.current
    apply((() => {
      if (current.length >= 30) return current
      const segment = current.split(/[+\-×÷]/).at(-1) ?? ''
      if (digit === '.') {
        if (segment.includes('.')) return current
        return `${current}${segment ? '' : '0'}.`
      }
      if (!current || current === '0') return digit === '00' ? '0' : digit
      return `${current}${digit}`
    })())
  }

  const operator = (next: string) => {
    const current = expressionRef.current
    apply((() => {
      if (!current) return next === '-' ? '-' : current
      if (current === '-') return current
      if (operatorPattern.test(current)) return `${current.slice(0, -1)}${next}`
      return `${current.endsWith('.') ? `${current}0` : current}${next}`
    })())
  }

  /** 「完成」只負責把算式結果寫回欄位並收起鍵盤，儲存一律回到頁面上的儲存鍵。 */
  const done = () => {
    const result = evaluateCalculatorExpression(expressionRef.current)
    if (result === null) return setError('算式還沒完成')
    onValueChange(formatCalculatorResult(result))
    focusField('')
  }

  const preview = expression && !operatorPattern.test(expression) ? evaluateCalculatorExpression(expression) : null

  return <>
    <input
      {...props}
      ref={inputRef}
      data-calculator-field=""
      disabled={disabled}
      inputMode={useCustomKeypad ? 'none' : 'decimal'}
      readOnly={useCustomKeypad}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onClick={show}
      onFocus={show}
    />
    {open ? createPortal(
      <section className="calculator-keypad" role="group" aria-label="金額計算機">
        <header><span><small>金額計算</small><strong>{expression || '0'}</strong>{preview !== null && expression ? <em>= {formatCalculatorResult(preview)}</em> : null}</span></header>
        {error ? <p role="alert">{error}</p> : null}
        <div className="calculator-grid">
          {['7', '8', '9'].map((key) => <button type="button" key={key} onClick={() => number(key)}>{key}</button>)}
          <button className="operator" type="button" onClick={() => operator('÷')}>÷</button>
          <button className="operator" type="button" onClick={() => apply('')}>AC</button>
          {['4', '5', '6'].map((key) => <button type="button" key={key} onClick={() => number(key)}>{key}</button>)}
          <button className="operator" type="button" onClick={() => operator('×')}>×</button>
          <button className="operator" type="button" aria-label="刪除一位" onClick={() => apply(expressionRef.current.slice(0, -1))}><Delete /></button>
          {['1', '2', '3'].map((key) => <button type="button" key={key} onClick={() => number(key)}>{key}</button>)}
          <button className="operator" type="button" onClick={() => operator('+')}>＋</button>
          <button className="calculator-done" type="button" onClick={done}>完成</button>
          <button type="button" onClick={() => number('00')}>00</button>
          <button type="button" onClick={() => number('0')}>0</button>
          <button type="button" onClick={() => number('.')}>.</button>
          <button className="operator" type="button" onClick={() => operator('-')}>－</button>
        </div>
      </section>,
      document.body,
    ) : null}
  </>
}
