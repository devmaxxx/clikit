import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { execSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cwdOf, isAlive, killGroup, spawnGroup, startOf } from '../src/proc'
import { tempDir } from './helpers'

// Anchored, and limited to one process group: a shell elsewhere can carry "sleep 313" inside a longer command line.
function survivors(pgid: number, n: number): string {
  return execSync(`pgrep -g ${pgid} -f "^sleep ${n}$" || true`).toString().trim()
}

function firstOutput(c: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise(r => c.stdout.once('data', (b: Buffer) => r(b.toString())))
}

const env = { PATH: process.env.PATH ?? '' }
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 200))

describe.skipIf(process.platform === 'win32')('process groups', () => {
  it('killGroup reaches grandchildren', async () => {
    const c = spawnGroup('bash', ['-c', 'sleep 311 & sleep 311 & wait'], { cwd: process.cwd(), env })

    await settle()
    await killGroup(c.pid as number, 500)
    expect(isAlive(c.pid as number)).toBe(false)
    expect(() => process.kill(-(c.pid as number), 0)).toThrow(/ESRCH/)
  })

  it('killGroup reaches a descendant that started its own group', async () => {
    // Stands in for a CLI that starts each tool shell detached and ignores SIGTERM.
    const cli
      = 'process.on(\'SIGTERM\', () => {}); const s = require(\'node:child_process\').spawn(\'sleep\', [\'313\'], { detached: true, stdio: \'ignore\' }); process.stdout.write(String(s.pid)); setInterval(() => {}, 1000)'

    const c = spawnGroup(process.execPath, ['-e', cli], { cwd: process.cwd(), env })
    const sleepPid = Number(await firstOutput(c))
    // A NaN or 0 here would make the pgrep below pass without having looked at the sleep at all.
    expect(Number.isInteger(sleepPid) && sleepPid > 1).toBe(true)
    expect(isAlive(sleepPid)).toBe(true)
    await killGroup(c.pid as number, 300)
    expect(isAlive(c.pid as number)).toBe(false)
    expect(survivors(sleepPid, 313)).toBe('')
  })

  it('killGroup gives a detached descendant SIGTERM and the grace period, not just SIGKILL', async () => {
    const marker = join(tempDir('clikit-'), 'termed')
    const shell = `trap 'touch ${marker}; exit 0' TERM; echo ready; while :; do sleep 0.05; done`
    const cli = `const s = require('node:child_process').spawn('sh', ['-c', ${JSON.stringify(shell)}], { detached: true, stdio: ['ignore', 'inherit', 'ignore'] }); setInterval(() => {}, 1000)`

    const c = spawnGroup(process.execPath, ['-e', cli], { env })
    await firstOutput(c)
    await killGroup(c.pid as number, 2_000)
    expect(existsSync(marker)).toBe(true)
  })

  it('killGroup reaches a detached group started during the grace period', async () => {
    const cli
      = 'const cp = require(\'node:child_process\'); process.on(\'SIGTERM\', () => { const s = cp.spawn(\'sleep\', [\'317\'], { detached: true, stdio: \'ignore\' }); process.stdout.write(s.pid + \'\\n\'); }); process.stdout.write(\'ready\\n\'); setInterval(() => {}, 1000)'

    const c = spawnGroup(process.execPath, ['-e', cli], { cwd: process.cwd(), env })
    let out = ''

    await new Promise<void>(r =>
      c.stdout.on('data', (b: Buffer) => {
        out += b.toString()

        if (out.includes('ready')) {
          r()
        }
      }),
    )

    let sleepPid = 0

    try {
      await killGroup(c.pid as number, 500)
      sleepPid = Number(out.split('\n')[1])
      expect(Number.isInteger(sleepPid) && sleepPid > 1).toBe(true)
      expect(survivors(sleepPid, 317)).toBe('')
    }
    finally {
      if (Number.isInteger(sleepPid) && sleepPid > 1) {
        try {
          process.kill(-sleepPid, 'SIGKILL')
        }
        catch {
          /* already gone */
        }
      }
    }
  })

  it('killGroup on a process that does not lead its group spares the rest of that group', async () => {
    const c = spawnGroup('bash', ['-c', 'sleep 315 & echo $!; sleep 316 & wait'], { cwd: process.cwd(), env })
    const target = Number(await firstOutput(c))
    expect(Number.isInteger(target) && target > 1).toBe(true)
    await settle()

    try {
      await killGroup(target, 300)
      expect(isAlive(c.pid as number)).toBe(true)
      expect(survivors(c.pid as number, 316)).not.toBe('')
    }
    finally {
      await killGroup(c.pid as number, 300)
    }
  })

  it('killGroup still signals the group when the process snapshot fails', async () => {
    const c = spawnGroup('bash', ['-c', 'sleep 318 & wait'], { cwd: process.cwd(), env })
    await settle()

    function failing(): string {
      throw Object.assign(new Error('spawn ps EAGAIN'), { code: 'EAGAIN' })
    }

    try {
      await killGroup(c.pid as number, 300, failing)
      expect(() => process.kill(-(c.pid as number), 0)).toThrow(/ESRCH/)
    }
    finally {
      await killGroup(c.pid as number, 0)
    }
  })

  it('killGroup refuses a pid that would signal its own group or every user process', async () => {
    // Stubbed so a missing guard fails the test instead of killing the runner or the desktop.
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)

    try {
      for (const pid of [0, 1, -5, 1.5, Number.NaN]) {
        await expect(killGroup(pid, 0)).rejects.toThrow(String(pid))
      }

      expect(kill).not.toHaveBeenCalled()
    }
    finally {
      kill.mockRestore()
    }
  })

  it('cwdOf names a live process working directory, and null once it is gone', async () => {
    const dir = realpathSync(tempDir('clikit-'))
    const c = spawnGroup('sleep', ['314'], { cwd: dir, env })
    await settle()
    expect(cwdOf(c.pid as number)).toBe(dir)
    await killGroup(c.pid as number, 300)
    expect(cwdOf(c.pid as number)).toBeNull()
  })

  it('startOf names a live process by its start time, the same under any locale or zone, and null once it is gone', async () => {
    const c = spawnGroup('sleep', ['315'], { cwd: tempDir('clikit-'), env })
    await settle()
    const first = startOf(c.pid as number)
    expect(first).toMatch(/^\w{3} \w{3}\s+\d+ \d\d:\d\d:\d\d \d{4}$/)
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.stubEnv('LC_ALL', 'ru_RU.UTF-8')
    expect(startOf(c.pid as number)).toBe(first)
    vi.unstubAllEnvs()
    await killGroup(c.pid as number, 300)
    expect(startOf(c.pid as number)).toBeNull()
  })
})

it('isAlive never reads 0 or a negative pid as a live process group', () => {
  expect(isAlive(0)).toBe(false)
  expect(isAlive(-1)).toBe(false)
  expect(isAlive(1.5)).toBe(false)
})

it('isAlive tells a running process from a finished one', async () => {
  expect(isAlive(process.pid)).toBe(true)
  const c = spawnGroup(process.execPath, ['-e', ''], { cwd: process.cwd(), env })
  await new Promise(r => c.once('exit', r))
  expect(isAlive(c.pid as number)).toBe(false)
})
