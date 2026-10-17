// Read the JSON answer a CLI prints after its progress lines, and the object a model wraps in prose.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { lastJson, lastJsonObject } from 'clikit/json'

// Stands in for `pnpm ls --json`: progress, colour and a CRLF pretty-printed answer, all on stdout.
const cli = String.raw`
process.stdout.write('Progress: resolved 412, reused 410, downloaded 2\n')
process.stdout.write('\x1B[32m✔\x1B[39m Done in 1.2s\r\n')
process.stdout.write(JSON.stringify({ name: 'app', version: '1.4.0' }, null, 2).replace(/\n/g, '\r\n') + '\r\n')
`
const stdout = execFileSync(process.execPath, ['-e', cli], { encoding: 'utf8' })

const pkg = lastJson(stdout)
console.log('lastJson       →', pkg)
assert.deepEqual(pkg, { name: 'app', version: '1.4.0' })

const reply = [
  'Sure! Here is the review:',
  '```json',
  '{ "verdict": "approve", "issues": [] }',
  '```',
  'Close the block with `}` if you edit it.',
].join('\n')

const isReview = v => typeof v === 'object' && v !== null && 'verdict' in v
const review = lastJsonObject(reply, isReview)
console.log('lastJsonObject →', review)
assert.deepEqual(review, { verdict: 'approve', issues: [] })
