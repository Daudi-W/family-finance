import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCalculatorExpression, formatCalculatorResult } from '../v2/src/calculator.ts'

test('計算機支援加減乘除與運算優先順序', () => {
  assert.equal(evaluateCalculatorExpression('100＋20×3'), 160)
  assert.equal(evaluateCalculatorExpression('100÷4－5'), 20)
})

test('計算機支援負數、小數與除以零防呆', () => {
  assert.equal(evaluateCalculatorExpression('-50+12.5'), -37.5)
  assert.equal(evaluateCalculatorExpression('10÷0'), null)
  assert.equal(evaluateCalculatorExpression('10＋'), null)
})

test('計算結果不留下浮點誤差或負零', () => {
  assert.equal(formatCalculatorResult(0.1 + 0.2), '0.3')
  assert.equal(formatCalculatorResult(-0), '0')
})
