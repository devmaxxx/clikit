import { describe, expect, it } from 'vitest'
import { failureSignature, stripAnsi } from '../src/log'

describe('stripAnsi', () => {
  it('removes colour, cursor and OSC hyperlink sequences', () => {
    expect(stripAnsi('\x1B[1;31mFAIL\x1B[0m \x1B[2K\x1B]8;;https://x.dev\x1B\\docs\x1B]8;;\x1B\\')).toBe('FAIL docs')
  })

  it('removes short escapes: tput sgr0\'s charset reset, cursor save and restore, keypad mode', () => {
    expect(stripAnsi('\x1B(B\x1B[mok\x1B7\x1B8\x1B=\x1B>')).toBe('ok')
  })

  it('leaves the JSON after a stray ESC intact', () => {
    expect(stripAnsi('\x1B{"a":1}')).toBe('\x1B{"a":1}')
    expect(stripAnsi('\x1B[1,2]')).toBe('\x1B[1,2]')
    expect(stripAnsi('\x1B[{"a":1}')).toBe('\x1B[{"a":1}')
    expect(stripAnsi('\x1B[[1]')).toBe('\x1B[[1]')
  })

  it('removes gh\'s literal ^[ escapes only when asked', () => {
    expect(stripAnsi('^[[36;1mpnpm test^[[0m')).toBe('^[[36;1mpnpm test^[[0m')
    expect(stripAnsi('^[[36;1mpnpm test^[[0m', { caret: true })).toBe('pnpm test')
  })
})

describe('failureSignature', () => {
  it('ignores timings, paths and line numbers', () => {
    const a = 'FAIL test/a.test.ts > adds (12ms)\nError: expected 3 to be 4 at /Users/m/x/a.ts:10:5'
    const b = 'FAIL test/a.test.ts > adds (97ms)\nError: expected 3 to be 4 at /tmp/y/a.ts:11:2'
    expect(failureSignature(a)).toBe(failureSignature(b))
  })

  it('ignores the job, step and timestamp that gh run view --log-failed puts on every line', () => {
    function ci(job: string, step: string, ts: string) {
      return [
        `${job}\t${step}\t\uFEFF${ts} ##[group]Run pnpm test`,
        `${job}\t${step}\t${ts} FAIL test/a.test.ts > adds (12ms)`,
        `${job}\t${step}\t${ts} Error: expected 3 to be 4`,
      ].join('\n')
    }

    const bare = '##[group]Run pnpm test\nFAIL test/a.test.ts > adds (12ms)\nError: expected 3 to be 4'
    const a = failureSignature(ci('unit (api)', 'Run tests', '2026-10-06T17:44:02.1752304Z'))
    expect(a).toContain('FAIL test/a.test.ts > adds')
    expect(failureSignature(ci('unit · rest', 'UNKNOWN STEP', '2026-10-07T09:01:59.0000001Z'))).toBe(a)
    expect(failureSignature(bare)).toBe(a)

    expect(
      failureSignature(ci('unit (api)', 'Run tests', '2026-10-06T17:44:02.1752304Z').replace('a.test.ts', 'b.test.ts')),
    ).not.toBe(a)
  })

  it('keeps the columns of a tab-separated line without a CI timestamp', () => {
    expect(failureSignature('FAIL\tapi\tlocations.spec.ts')).not.toBe(failureSignature('FAIL\tui\tlocations.spec.ts'))
  })

  // The shape of `vitest run` 5.0.3 output into a pipe.
  function vitestRun(name: string, ms: string) {
    return [
      '',
      ' RUN  v5.0.3 /tmp/vt',
      '',
      ` ❯ a.test.ts (2 tests | 1 failed) ${ms}`,
      `   × ${name} ${ms}`,
      '',
      '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯',
      '',
      ` FAIL  a.test.ts > ${name}`,
      'AssertionError: expected 3 to be 4 // Object.is equality',
      '',
      ' ❯ a.test.ts:1:36',
      '',
      ' Test Files  1 failed (1)',
      '      Tests  1 failed | 1 passed (2)',
      '   Start at  14:00:15',
      `   Duration  ${ms} (transform 63%, import 13%, tests 13%, worker 10%)`,
    ].join('\n')
  }

  it('ignores the bare durations of vitest output', () => {
    const a = failureSignature(vitestRun('adds', '3ms'))
    expect(failureSignature(vitestRun('adds', '17ms'))).toBe(a)
    expect(failureSignature(vitestRun('subtracts', '3ms'))).not.toBe(a)
  })

  // gh writes ESC as a literal `^[` into a pipe.
  function ghLog(reason: string, ts = '2026-10-06T17:44:02') {
    const p = `lint\tCheck the title\t`
    return [
      `${p}\uFEFF${ts}.1752304Z ##[group]Run node check-title.mjs`,
      `${p}${ts}.1752812Z ^[[36;1mnode check-title.mjs "$TITLE"^[[0m`,
      `${p}${ts}.1761658Z shell: /usr/bin/bash -e {0}`,
      `${p}${ts}.1762772Z ##[endgroup]`,
      `${p}${ts}.1998096Z title rejected:`,
      `${p}${ts}.1998789Z   - ${reason}`,
      `${p}${ts}.2017592Z ##[error]Process completed with exit code 1.`,
      '',
    ].join('\n')
  }

  it('gives two different failures in one CI step different signatures', () => {
    const a = failureSignature(ghLog('subject must be "<type>: <description>"'))
    const b = failureSignature(ghLog('subject must not end with a period'))
    expect(a).not.toBe(b)
    expect(a).not.toMatch(/##\[|\^\[|Process completed/)
  })

  it('gives a rerun that moves only timestamps the same signature', () => {
    expect(failureSignature(ghLog('too long', '2026-10-07T09:01:59'))).toBe(failureSignature(ghLog('too long')))
  })

  it('reads through ANSI colour and GitHub annotations', () => {
    function line(text: string) {
      return `unit (api)\tRun tests\t2026-10-06T17:44:02.1752304Z ${text}`
    }

    const a = failureSignature(
      [
        line('\x1B[31m FAIL \x1B[39m a.test.ts > adds'),
        line('##[error]AssertionError: expected 3 to be 4'),
        line('##[error]Process completed with exit code 1.'),
      ].join('\n'),
    )

    expect(a).toBe('FAIL a.test.ts > adds | AssertionError: expected 3 to be 4')
  })

  it('reads through turbo task prefixes', () => {
    const a = failureSignature(
      [
        '@acme/api:test: cache bypass, force executing 5700208d754b1bf2',
        '@acme/api:test: $ vitest run',
        '@acme/api:test: ',
        '@acme/api:test:  FAIL  a.test.ts > adds',
        '@acme/api:test: AssertionError: expected 3 to be 4 // Object.is equality',
        '@acme/api:test: [ELIFECYCLE] Test failed. See above for more details.',
      ].join('\n'),
    )

    expect(a).toBe('FAIL a.test.ts > adds | AssertionError: expected 3 to be 4 // Object.is equality')
  })

  it('reads only the first failed job of a --log-failed listing', () => {
    const log = [
      'unit\tRun tests\t2026-10-06T17:44:02.1Z FAIL a.test.ts > adds',
      'all-green\tCheck\t2026-10-06T17:44:09.1Z Error: some jobs failed',
    ].join('\n')

    expect(failureSignature(log)).toBe('FAIL a.test.ts > adds |')
  })

  it('never picks coverage rows, deprecation warnings, pnpm trailers or caller noise', () => {
    const failure = 'src/a.ts(3,1): error TS2304: Cannot find name x.'
    const noise = [/^mytool: .* exited with code \d+$/]

    expect(
      failureSignature(
        [
          ' errors.module.ts |     100 |      100 |     100 |     100 |',
          '(node:13241) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications.',
          failure,
          '[ELIFECYCLE] Command failed with exit code 2.',
          'mytool: pnpm typecheck exited with code 2',
        ].join('\n'),
        { noise },
      ),
    ).toBe(failureSignature(failure))
  })

  it('names the failure by a noise line only when the command printed nothing else', () => {
    const noise = [/^mytool: .* exited with code \d+$/]

    function run(out: string, cmd: string) {
      return failureSignature(`${out}\nmytool: ${cmd} exited with code 1`, { noise })
    }

    expect(run('packages/x is missing MODULE.md', 'node check.mjs')).not.toBe(run('packages/y is missing MODULE.md', 'node check.mjs'))
    expect(run('', 'pnpm lint')).not.toBe(run('', 'pnpm typecheck'))
  })

  it('treats caret text and colon words outside a CI or turbo prefix as content', () => {
    expect(failureSignature('Error: expected \'^[[A\' to be \'^[[B\'')).not.toBe(
      failureSignature('Error: expected \'^[[B\' to be \'^[[A\''),
    )

    expect(failureSignature('warning:Deprecated: an error here')).toContain('warning:Deprecated:')
  })
})
