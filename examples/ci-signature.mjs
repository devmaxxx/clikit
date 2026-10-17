// Tell "the same CI failure again" from "a different failure" across reruns.
import assert from 'node:assert/strict'
import { failureSignature } from 'clikit/log'

// What `gh run view --log-failed` prints: job, step and a timestamp that changes on every run.
function log(at, assertion) {
  return [
    `unit\tRun tests\t${at}1Z \x1B[31m FAIL \x1B[39m src/sum.test.ts > adds (12ms)`,
    `unit\tRun tests\t${at}2Z ${assertion} at /home/runner/work/app/src/sum.ts:10:5`,
    `unit\tRun tests\t${at}3Z ##[error]Process completed with exit code 1.`,
  ].join('\n')
}

const first = failureSignature(log('2026-10-06T17:44:02.', 'AssertionError: expected 3 to be 4'))
const rerun = failureSignature(log('2026-10-06T18:02:51.', 'AssertionError: expected 3 to be 4'))
const other = failureSignature(log('2026-10-06T18:30:07.', 'TypeError: sum is not a function'))

console.log('first run →', first)
console.log('rerun     →', rerun)
console.log('other bug →', other)
assert.equal(first, rerun)
assert.notEqual(first, other)
