// Keep one copy of a daemon running, and recover from a lock left behind by a crash.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { acquireLock, LockHeld } from 'clikit/lock'

const dir = mkdtempSync(join(tmpdir(), 'clikit-example-'))
const path = join(dir, 'daemon.lock')

try {
  const lock = acquireLock(path)
  console.log(`first run holds ${path}`)

  assert.throws(() => acquireLock(path), (e) => {
    console.log(`second run: ${e.message}`)
    return e instanceof LockHeld && e.pid === process.pid
  })

  lock.release()

  // A crashed run leaves its pid behind; that process is gone, so the lock is stale and taken over.
  const crashed = spawnSync(process.execPath, ['-e', '']).pid
  writeFileSync(path, String(crashed))
  acquireLock(path).release()
  console.log(`a lock left by dead pid ${crashed} was taken over`)
}
finally {
  rmSync(dir, { recursive: true, force: true })
}
