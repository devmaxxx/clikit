import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { acquireLock, LockHeld } from '../src/lock'
import { tempDir } from './helpers'

const windows = process.platform === 'win32'

function tmp(): string {
  return join(tempDir('clikit-'), 'app.lock')
}

it('writes our pid and release removes the file', () => {
  const path = tmp()
  const lock = acquireLock(path)
  expect(readFileSync(path, 'utf8')).toBe(String(process.pid))
  lock.release()
  expect(existsSync(path)).toBe(false)
})

it.skipIf(windows)('a first run creates the lock directory, owner-only', () => {
  const dir = join(tempDir('clikit-'), 'state')
  acquireLock(join(dir, 'app.lock')).release()
  expect(statSync(dir).mode & 0o777).toBe(0o700)
})

it('a live pid holds the lock', () => {
  const path = tmp()
  writeFileSync(path, String(process.pid))
  expect(() => acquireLock(path)).toThrow(LockHeld)
  expect(() => acquireLock(path)).toThrow(`already running (pid ${process.pid})`)
  // After a reboot the pid can name a stranger; the owner needs the path to clear it.
  expect(() => acquireLock(path)).toThrow(path)
})

// kill(pid, 0) on another user's process fails with EPERM, which still means the process exists.
it.skipIf(windows || process.getuid?.() === 0)('a live pid owned by another user holds the lock', () => {
  const path = tmp()
  writeFileSync(path, '1')
  expect(() => acquireLock(path)).toThrow(LockHeld)
  expect(readFileSync(path, 'utf8')).toBe('1')
})

it('a dead pid is replaced', () => {
  const path = tmp()
  const dead = spawnSync(process.execPath, ['-e', '']).pid
  writeFileSync(path, String(dead))
  const lock = acquireLock(path)
  expect(readFileSync(path, 'utf8')).toBe(String(process.pid))
  lock.release()
})

it('a garbage lock file counts as stale', () => {
  const path = tmp()
  writeFileSync(path, 'not a pid')
  acquireLock(path).release()
  expect(existsSync(path)).toBe(false)
})

it('an empty lock file, left by a crash between create and write, counts as stale', () => {
  const path = tmp()
  writeFileSync(path, '')
  acquireLock(path).release()
  expect(existsSync(path)).toBe(false)
})
