import { expect, it } from 'vitest'
import { errnoCode, errorMessage } from '../src/errors'

it('errorMessage reads an Error and stringifies anything else', () => {
  expect(errorMessage(new Error('boom'))).toBe('boom')
  expect(errorMessage('plain')).toBe('plain')
  expect(errorMessage(42)).toBe('42')
  expect(errorMessage(undefined)).toBe('undefined')
})

it('errnoCode reads a string code and nothing else', () => {
  expect(errnoCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT')
  expect(errnoCode({ code: 1 })).toBeUndefined()
  expect(errnoCode(new Error('x'))).toBeUndefined()
  expect(errnoCode(null)).toBeUndefined()
  expect(errnoCode('ENOENT')).toBeUndefined()
})
