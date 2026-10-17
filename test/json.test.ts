import { describe, expect, it } from 'vitest'
import { lastJson, lastJsonObject, tryLastJson } from '../src/json'

function isTaskList(v: unknown): v is { id: string }[] {
  return Array.isArray(v) && v.every(t => typeof t === 'object' && t !== null && 'id' in t)
}

describe('lastJson reads the value that ends a CLI output', () => {
  it('skips progress lines before the answer', () => {
    expect(lastJson('progress\n{"a":1}')).toEqual({ a: 1 })
  })

  it('reads a value that follows a progress prefix on the last line', () => {
    expect(lastJson('a\n{"x":1}\nnoise [1,2]\n')).toEqual([1, 2])
  })

  it('reads a pretty-printed value and a bare null', () => {
    expect(lastJson('progress [1/2]\n{\n  "id": "7",\n  "branch": "task/7"\n}\n')).toEqual({ id: '7', branch: 'task/7' })
    expect(lastJson('installing…\nnull\n')).toBeNull()
  })

  it('reads a large pretty-printed list after a log', () => {
    const tasks = Array.from({ length: 200 }, (_, i) => ({ id: String(i), title: `T${i}`, labels: ['a', 'b'] }))
    expect(lastJson(`installing…\n[1/2] done\n${JSON.stringify(tasks, null, 2)}\n`)).toEqual(tasks)
  })

  it('throws when the output ends in no JSON value', () => {
    expect(() => lastJson('nothing')).toThrow('no JSON value in output')
  })

  it('reads Windows CRLF output', () => {
    expect(lastJson('Resolving…\r\n{\r\n  "ok": true\r\n}\r\n')).toEqual({ ok: true })
  })

  it('reads output whose progress bar redraws with a lone CR', () => {
    expect(lastJson('10%\r50%\r100%\r{"done":3}')).toEqual({ done: 3 })
  })

  it('reads through ANSI colour and OSC hyperlinks', () => {
    const out = '\x1B[32m✔\x1B[39m built \x1B]8;;https://x.dev\x07link\x1B]8;;\x07\n\x1B[1m{"version":"1.2.0"}\x1B[22m\n'
    expect(lastJson(out)).toEqual({ version: '1.2.0' })
  })
})

describe('lastJson stays fast on hostile logs', () => {
  it('gives up promptly on a long log whose lines end in brackets', () => {
    const log = Array.from({ length: 20_000 }, (_, i) =>
      i % 2 ? `[step ${i}] done {cached}` : `step ${i}: done [cached]`).join('\n')

    const t0 = Date.now()
    expect(() => lastJson(log)).toThrow(/no JSON/)
    expect(Date.now() - t0).toBeLessThan(1_000)
  })

  it('gives up promptly on a long log without JSON', () => {
    expect(() => lastJson(Array.from({ length: 20_000 }, (_, i) => `step ${i}: [cached] {ok`).join('\n'))).toThrow(/no JSON/)
  })
})

describe('tryLastJson and validate', () => {
  it('tryLastJson returns the value, or undefined instead of throwing', () => {
    expect(tryLastJson('log\n[1]')).toEqual([1])
    expect(tryLastJson('nothing')).toBeUndefined()
  })

  it('a value the guard accepts comes back typed', () => {
    const tasks = lastJson('fetching…\n[{"id":"1"}]', isTaskList)
    expect(tasks[0]?.id).toBe('1')
  })

  it('a value the guard rejects is not returned', () => {
    expect(() => lastJson('log\n{"error":"rate limited"}', isTaskList)).toThrow('no JSON value in output passes validate')
    expect(tryLastJson('log\n{"error":"rate limited"}', isTaskList)).toBeUndefined()
  })
})

describe('lastJsonObject reads the last object in model output', () => {
  it('finds an object in prose', () => {
    expect(lastJsonObject('prose {"b":2} more')).toEqual({ b: 2 })
  })

  it('finds a nested object inside a code fence', () => {
    const answer = 'Here is the plan:\n```json\n{\n  "steps": [{"n": 1}, {"n": 2}],\n  "meta": {"ok": true}\n}\n```\nLet me know!'
    expect(lastJsonObject(answer)).toEqual({ steps: [{ n: 1 }, { n: 2 }], meta: { ok: true } })
  })

  it('takes the last of several objects', () => {
    expect(lastJsonObject('For example {"verdict":"x"}. My answer: {"verdict":"approve"}')).toEqual({ verdict: 'approve' })
  })

  it('returns undefined when there is no object', () => {
    expect(lastJsonObject('no braces here')).toBeUndefined()
    expect(lastJsonObject('a set {1, 2}')).toBeUndefined()
  })

  it('returns undefined when the guard rejects the last object', () => {
    const hasVerdict = (v: unknown): v is { verdict: string } => typeof v === 'object' && v !== null && 'verdict' in v
    expect(lastJsonObject('{"verdict":"ok"} then {"other":1}', hasVerdict)).toBeUndefined()
    expect(lastJsonObject('answer: {"verdict":"ok"}', hasVerdict)?.verdict).toBe('ok')
  })

  it('finishes fast on deeply nested input that never closes', () => {
    const depth = 200_000
    const hostile = `${'{"a":'.repeat(depth)}1${'}'.repeat(depth - 1)}`

    const t0 = Date.now()
    expect(lastJsonObject(hostile)).toBeUndefined()
    expect(lastJsonObject(`${'{ '.repeat(depth)}"k" }`)).toBeUndefined()
    expect(Date.now() - t0).toBeLessThan(1_000)
  })
})
