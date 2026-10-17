// Start a child without the credentials and git bindings this process carries.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { withoutGitVars, withoutSecrets } from 'clikit/env'

const parent = { ...process.env, GH_TOKEN: 'ghp_example', GIT_DIR: '/elsewhere/.git', GIT_SSH_COMMAND: 'ssh -i key' }
const env = withoutGitVars(withoutSecrets(parent))

const seen = JSON.parse(execFileSync(process.execPath, ['-e', String.raw`
  const { GH_TOKEN, GIT_DIR, GIT_SSH_COMMAND } = process.env
  console.log(JSON.stringify({ GH_TOKEN, GIT_DIR, GIT_SSH_COMMAND }))
`], { env, encoding: 'utf8' }))

console.log('the child sees', seen)
assert.deepEqual(seen, { GIT_SSH_COMMAND: 'ssh -i key' })
