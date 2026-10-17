import { stripAnsi } from './ansi'

/** A type guard; plug in a schema check such as `(v): v is T => schema.safeParse(v).success`. */
export type Guard<T> = (value: unknown) => value is T

// CLIs print progress (installs, builds) before their answer, so only the JSON value that ends the output counts.
// A top-level value starts its line, and the inner lines of a pretty-printed one are indented, so few starts need trying.
const MAX_LINE_TRIES = 32

// Each retry parses from an earlier `{` up to the last `}`, so a deeply nested tail costs tries × its size.
// The cap bounds that on hostile input; a real answer needs one try per object nested inside it.
const MAX_BRACE_TRIES = 1024

const FAILED = Symbol('failed')

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    return FAILED
  }
}

// A raw ESC or CR is never part of valid JSON, so removing them cannot change a value; a lone CR is a progress-bar redraw.
function normalize(text: string): string {
  return stripAnsi(text).replace(/\r\n?/g, '\n')
}

function startsOfWholeLine(line: string): number[] {
  return /^(?:[[{]|null$)/.test(line) ? [0] : []
}

// A last line may carry its value after a progress prefix, and the prefix can hold brackets of its own ("[INFO] {...}").
function startsOfLastLine(line: string): number[] {
  const starts = [...line.matchAll(/[[{]/g)].map(m => m.index)

  return /^\s*null$/.test(line) ? [0] : starts
}

function findLastJson(raw: string, accept: (value: unknown) => boolean): unknown {
  const text = normalize(raw).trimEnd()
  const lines = text.split('\n')
  let offset = text.length
  let tries = 0

  for (let i = lines.length - 1; i >= 0 && tries < MAX_LINE_TRIES; i--) {
    const line = lines[i] ?? ''
    offset -= line.length + (i < lines.length - 1 ? 1 : 0)
    const starts = i === lines.length - 1 ? startsOfLastLine(line) : startsOfWholeLine(line)

    for (const at of starts) {
      if (tries >= MAX_LINE_TRIES) {
        break
      }

      tries++
      const value = parse(text.slice(offset + at))

      if (value !== FAILED && accept(value)) {
        return value
      }
    }
  }

  return FAILED
}

function noValue(validate: Guard<unknown> | undefined): Error {
  return new Error(validate ? 'no JSON value in output passes validate' : 'no JSON value in output')
}

const any = (): boolean => true

/**
 * The JSON value that ends `text`, such as a CLI's stdout after its progress lines.
 * Strips ANSI escapes and reads CRLF output. Throws when no value ends the text.
 * With `validate`, a value the guard rejects is skipped and an earlier, enclosing start is tried.
 */
export function lastJson(text: string): unknown
export function lastJson<T>(text: string, validate: Guard<T>): T
export function lastJson(text: string, validate?: Guard<unknown>): unknown {
  const value = findLastJson(text, validate ?? any)

  if (value === FAILED) {
    throw noValue(validate)
  }

  return value
}

/** Like {@link lastJson}, but returns `undefined` instead of throwing. */
export function tryLastJson(text: string): unknown
export function tryLastJson<T>(text: string, validate: Guard<T>): T | undefined
export function tryLastJson(text: string, validate?: Guard<unknown>): unknown {
  const value = findLastJson(text, validate ?? any)

  return value === FAILED ? undefined : value
}

/**
 * The last `{…}` object in `text`, such as a model's answer wrapped in prose or a code fence.
 * Returns `undefined` when there is none. Arrays and scalars are not looked for.
 */
export function lastJsonObject(text: string): unknown
export function lastJsonObject<T>(text: string, validate: Guard<T>): T | undefined
export function lastJsonObject(raw: string, validate?: Guard<unknown>): unknown {
  const text = stripAnsi(raw)
  const end = text.lastIndexOf('}')

  if (end < 0) {
    return undefined
  }

  let i = text.lastIndexOf('{', end)

  for (let tries = 0; i >= 0 && tries < MAX_BRACE_TRIES; tries++) {
    const value = parse(text.slice(i, end + 1))

    if (value !== FAILED && (validate ?? any)(value)) {
      return value
    }

    // An inner brace, or a value the guard rejected: retry from the enclosing one.
    i = i === 0 ? -1 : text.lastIndexOf('{', i - 1)
  }

  return undefined
}
