import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { execFileSync, spawn } from 'node:child_process'
import { readlinkSync } from 'node:fs'
import process from 'node:process'

export interface SpawnGroupOptions {
  /** Defaults to the current working directory. */
  cwd?: string
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
}

/**
 * Spawns `cmd` as the leader of a new process group, with piped stdio, so {@link killGroup} can later reach every
 * grandchild that stays in the group.
 */
export function spawnGroup(cmd: string, args: string[], options: SpawnGroupOptions = {}): ChildProcessWithoutNullStreams {
  return spawn(cmd, args, { cwd: options.cwd, env: options.env, detached: true, stdio: 'pipe' })
}

/**
 * Whether a process with this pid exists and can be signalled by this user. A pid that is not a positive integer is
 * never alive: kill(2) would read 0 or a negative number as a process group.
 */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

/**
 * The working directory of a live process, read from `/proc` on Linux and with `lsof` elsewhere; `null` once it is
 * gone or when neither is available.
 */
export function cwdOf(pid: number): string | null {
  // Minimal containers ship without lsof, and procfs answers without starting a process.
  if (process.platform === 'linux') {
    try {
      return readlinkSync(`/proc/${pid}/cwd`)
    }
    catch {
      /* not readable: lsof may still answer */
    }
  }

  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const line = out.split('\n').find(l => l.startsWith('n'))
    return line === undefined ? null : line.slice(1)
  }
  catch {
    return null
  }
}

/**
 * The start time of a live process, as `ps -o lstart=` prints it in the C locale and UTC
 * (`Mon Oct  6 17:44:02 2026`); `null` once it is gone. A pid plus its start time names one process even after
 * the pid is reused.
 */
export function startOf(pid: number): string | null {
  try {
    // lstart is printed in the locale and the local zone; both are pinned so a rerun under another LANG or TZ matches.
    const env = { ...process.env, LC_ALL: 'C', TZ: 'UTC' }

    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    return out === '' ? null : out
  }
  catch {
    return null
  }
}

function psSnapshot(): string {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' })
}

// Tools such as the Claude CLI start each shell they run detached, in a group of its own, so a signal to -pid misses them.
function descendantGroups(pid: number, snapshot: () => string): number[] {
  let listing: string

  // ps fails with EAGAIN at the process limit, exactly when a runaway tree most needs killing.
  try {
    listing = snapshot()
  }
  catch {
    return []
  }

  const rows = listing
    .trim()
    .split('\n')
    .map((l) => {
      const [p = 0, pp = 0, g = 0] = l.trim().split(/\s+/).map(Number)
      return { p, pp, g }
    })

  const tree = new Set([pid])

  for (let grew = true; grew;) {
    grew = false

    for (const r of rows) {
      if (tree.has(r.pp) && !tree.has(r.p)) {
        tree.add(r.p)
        grew = true
      }
    }
  }

  // Only groups led from inside the tree: a pid that does not lead its own group shares its parent's,
  // and that group holds processes killGroup was never asked to touch.
  // g > 1 holds the line killGroup's own guard holds, so an odd ps row can never turn into kill(0) or kill(-1).
  return [...new Set(rows.filter(r => tree.has(r.p) && tree.has(r.g) && r.g > 1 && r.g !== pid).map(r => r.g))]
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  }
  catch {
    return false
  }
}

function signal(group: number, s: NodeJS.Signals): void {
  try {
    process.kill(-group, s)
  }
  catch {
    /* group already gone */
  }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * Stops the process group led by `pid` and every detached group started beneath it: SIGTERM to all of them, up to
 * `graceMs` for them to exit, then SIGKILL. POSIX only (macOS, Linux); throws on Windows, which has no process groups.
 * `snapshot` replaces the `ps -axo pid=,ppid=,pgid=` call that maps the process tree.
 */
export async function killGroup(pid: number, graceMs = 10_000, snapshot: () => string = psSnapshot): Promise<void> {
  if (process.platform === 'win32') {
    throw new Error('killGroup: process groups are not supported on Windows')
  }

  // kill(2) reads 0 as the caller's own group and -1 as every process of the user.
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error(`killGroup: refusing pid ${pid}`)
  }

  // Taken before SIGTERM: once the leader dies its detached children are reparented and no longer reachable from pid.
  const groups = new Set([pid, ...descendantGroups(pid, snapshot)])

  for (const group of groups) {
    signal(group, 'SIGTERM')
  }

  const until = Date.now() + graceMs

  // The leader can exit on SIGTERM long before its descendants finish shutting down; they get the grace too.
  while (Date.now() < until && [...groups].some(groupAlive)) {
    await sleep(100)
  }

  // A leader that outlived the grace may have started more detached groups since the first snapshot.
  if (isAlive(pid)) {
    for (const group of descendantGroups(pid, snapshot)) {
      groups.add(group)
    }
  }

  for (const group of groups) {
    signal(group, 'SIGKILL')
  }

  await sleep(50)
}
