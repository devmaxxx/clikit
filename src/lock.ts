import { closeSync, fstatSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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

// Releasing must not delete a lock that was meanwhile cleared as stale and taken by another run.
function releaseIfOwned(path: string): void {
  if (holder(path)?.pid === process.pid) {
    unlinkIfPresent(path)
  }
}

function create(path: string): Lock | undefined {
  // The pid is written to a private file first and hard-linked into place, so the lock file never exists empty:
  // a racing run cannot read a half-made lock as stale and delete it.
  const staging = `${path}.${process.pid}.tmp`

  try {
    writeFileSync(staging, String(process.pid), { mode: 0o600 })
    // link(2) fails with EEXIST when the lock exists: of two runs racing for it, exactly one wins.
    linkSync(staging, path)

    return { release: () => releaseIfOwned(path) }
  }
  catch (e) {
    if (errnoCode(e) !== 'EEXIST') {
      throw e
    }

    return undefined
  }
  finally {
    unlinkIfPresent(staging)
  }
}

interface Holder {
  pid: number
  ino: bigint
}

function holder(path: string): Holder | undefined {
  let fd: number

  try {
    fd = openSync(path, 'r')
  }
  catch (e) {
    if (errnoCode(e) === 'ENOENT') {
      return undefined
    }

    throw e
  }

  try {
    return { pid: Number(readFileSync(fd, 'utf8')), ino: fstatSync(fd, { bigint: true }).ino }
  }
  finally {
    closeSync(fd)
  }
}

// unlink(2) cannot be told "only if it is still this file": another run may clear the same stale lock and take it
// between our read and our unlink. rename(2) is atomic, so the file is moved aside first and checked there; one
// that turns out to be another run's lock goes back. The pid is compared too, because a freed inode is often reused
// at once. Object.is: a garbage file reads as NaN, which never equals itself.
function removeStale(path: string, stale: Holder): void {
  const aside = `${path}.${process.pid}.stale`

  try {
    renameSync(path, aside)
  }
  catch (e) {
    if (errnoCode(e) === 'ENOENT') {
      return
    }

    throw e
  }

  const moved = holder(aside)

  if (moved && (moved.ino !== stale.ino || !Object.is(moved.pid, stale.pid))) {
    try {
      linkSync(aside, path)
    }
    catch (e) {
      // EEXIST: a third run took the free path meanwhile, and its lock stands. Anything else leaves the moved lock
      // where it is, so its owner can still be found.
      if (errnoCode(e) !== 'EEXIST') {
        throw e
      }
    }
  }

  unlinkIfPresent(aside)
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

    const held = holder(path)

    if (held === undefined) {
      continue
    }

    // An empty file reads as 0, and kill(0, 0) asks about our own process group, which is always alive.
    if (Number.isInteger(held.pid) && held.pid > 0 && running(held.pid)) {
      throw new LockHeld(held.pid, path)
    }

    removeStale(path, held)
  }
}
