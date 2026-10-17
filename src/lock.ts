import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { errnoCode } from './errors'

/** Thrown by {@link acquireLock} when a live process holds the lock. */
export class LockHeld extends Error {
  readonly pid: number
  readonly path: string

  constructor(pid: number, path: string) {
    // A lock that outlived a reboot can name a stranger's pid, and only the owner can tell; the path lets them clear it.
    super(`already running (pid ${pid}); if it is not, delete ${path}`)
    this.name = 'LockHeld'
    this.pid = pid
    this.path = path
  }
}

export interface Lock {
  /** Removes the lock file. Safe to call when it is already gone. */
  release: () => void
}

// kill(2) answers EPERM for a process that exists but belongs to another user; only ESRCH means it is gone.
function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (e) {
    return errnoCode(e) === 'EPERM'
  }
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path)
  }
  catch (e) {
    if (errnoCode(e) !== 'ENOENT') {
      throw e
    }
  }
}

function create(path: string): Lock | undefined {
  try {
    // O_EXCL: of two runs racing for the file, exactly one creates it.
    const fd = openSync(path, 'wx', 0o600)

    try {
      writeSync(fd, String(process.pid))
    }
    finally {
      closeSync(fd)
    }

    return { release: () => unlinkIfPresent(path) }
  }
  catch (e) {
    if (errnoCode(e) !== 'EEXIST') {
      throw e
    }

    return undefined
  }
}

function holder(path: string): number | undefined {
  try {
    return Number(readFileSync(path, 'utf8'))
  }
  catch (e) {
    if (errnoCode(e) === 'ENOENT') {
      return undefined
    }

    throw e
  }
}

/**
 * Takes a pidfile lock at `path`, creating its directory (owner-only) if needed.
 * A file naming a dead process, or holding no pid, is stale and replaced. Throws {@link LockHeld} when a live
 * process holds it.
 */
export function acquireLock(path: string): Lock {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })

  for (;;) {
    const lock = create(path)

    if (lock) {
      return lock
    }

    const pid = holder(path)

    if (pid === undefined) {
      continue
    }

    // An empty file reads as 0, and kill(0, 0) asks about our own process group, which is always alive.
    if (Number.isInteger(pid) && pid > 0 && running(pid)) {
      throw new LockHeld(pid, path)
    }

    unlinkIfPresent(path)
  }
}
