<div align="center">

# clikit

**Small, sharp helpers for CLIs that run other CLIs — read their JSON, stop their process trees, time them out, keep one copy running.**

[![npm version](https://img.shields.io/npm/v/clikit?color=cb3837)](https://www.npmjs.com/package/clikit)
[![npm downloads](https://img.shields.io/npm/dm/clikit)](https://www.npmjs.com/package/clikit)
[![CI](https://github.com/arenuzzz/clikit/actions/workflows/ci.yml/badge.svg)](https://github.com/arenuzzz/clikit/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/clikit)](https://www.npmjs.com/package/clikit)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)
[![bundle size](https://img.shields.io/bundlejs/size/clikit)](https://bundlejs.com/?q=clikit)
[![license: MIT](https://img.shields.io/npm/l/clikit)](./LICENSE)

</div>

## Why

A tool that drives other tools — a task runner, a CI bot, an AI agent harness — keeps hitting the same handful of problems:

- `pnpm`, `gh`, `turbo` and friends print progress before their `--json` answer, so `JSON.parse(stdout)` fails.
- LLMs wrap their JSON in prose and code fences.
- Killing a child leaves its grandchildren running, especially the ones it started detached.
- A hung child needs a wall-clock limit *and* a "no output for N minutes" limit.
- Two copies of your daemon must not run at once, and a crash must not leave the lock stuck forever.
- Children inherit `GH_TOKEN`, `ANTHROPIC_API_KEY` or a hook's `GIT_DIR` that they should never see.
- The same CI failure shows up with a new timestamp on every rerun, so "did the fix change anything?" is hard to answer.

clikit is seven tiny modules that handle these, extracted from a production agent orchestrator, each behind its own import path.

## Features

- **Zero runtime dependencies.** ESM, fully typed, Node.js built-ins only.
- **Pick only what you need.** Every module is its own subpath (`clikit/json`, `clikit/proc`, …) and the package is `sideEffects: false`.
- **Behaviour pinned by tests**, including hostile inputs that must finish fast.
- **Fails loudly where it matters.** `killGroup` refuses pids that would signal your own group or every process; `acquireLock` tells a dead holder from a live one owned by another user.

| Import | What it gives you |
| --- | --- |
| [`clikit/json`](#clikitjson) | `lastJson`, `tryLastJson`, `lastJsonObject` |
| [`clikit/proc`](#clikitproc) | `spawnGroup`, `killGroup`, `isAlive`, `cwdOf`, `startOf` |
| [`clikit/watchdog`](#clikitwatchdog) | `Watchdog` |
| [`clikit/lock`](#clikitlock) | `acquireLock`, `LockHeld` |
| [`clikit/env`](#clikitenv) | `withoutSecrets`, `withoutGitVars`, `SECRET_VARS` |
| [`clikit/log`](#clikitlog) | `stripAnsi`, `failureSignature` |
| [`clikit/errors`](#clikiterrors) | `errorMessage`, `errnoCode` |

## Install

```sh
npm install clikit
pnpm add clikit
yarn add clikit
bun add clikit
```

Requires Node.js 20 or later.

> **Pick only what you need.** `import { lastJson } from 'clikit/json'` loads just that module. The root `clikit` re-exports everything, and bundlers tree-shake it too.

## Quick start

Every output below is what the published build prints.

```ts
import { lastJson, lastJsonObject } from 'clikit/json'
import { failureSignature } from 'clikit/log'

const stdout = 'Progress: resolved 412, reused 410, downloaded 2, added 0\n'
  + '\x1B[32m✔\x1B[39m Done in 1.2s\r\n{\r\n  "version": "1.4.0",\r\n  "private": false\r\n}\r\n'

lastJson(stdout)
// { version: '1.4.0', private: false }

lastJsonObject('Sure! Here is the review:\n```json\n{ "verdict": "approve", "issues": [] }\n```\nAnything else?')
// { verdict: 'approve', issues: [] }

failureSignature(
  'unit\tRun tests\t2026-10-06T17:44:02.1752304Z \x1B[31m FAIL \x1B[39m src/sum.test.ts > adds (12ms)\n'
  + 'unit\tRun tests\t2026-10-06T17:44:02.18Z AssertionError: expected 3 to be 4 at /home/runner/work/app/src/sum.ts:10:5\n'
  + 'unit\tRun tests\t2026-10-06T17:44:02.2Z ##[error]Process completed with exit code 1.',
)
// 'FAIL src/sum.test.ts > adds | AssertionError: expected 3 to be 4 at sum.ts'
```

## API

### `clikit/json`

**Finds the answer, doesn't fix it.** These functions return the last *complete, valid* JSON value in a text and never guess at a broken one. That makes them the step before a repairer such as `jsonrepair` (when you want to salvage broken output) or a schema check such as zod (when you want to trust the shape).

#### `lastJson(text, validate?)`

The JSON value that ends `text` — a CLI's stdout after its progress lines. Throws `Error('no JSON value in output')` when none does.

- A value is found when it starts its own line (`{`, `[` or `null`), or after a prefix on the last line (`noise [1,2]` → `[1, 2]`). Pretty-printed values work, because their inner lines are indented.
- ANSI escapes are stripped and CRLF or lone-CR (progress bar) line endings read as newlines first. Neither can be part of valid JSON, so no value changes.
- At most 32 line starts are tried, so a 20,000-line log without JSON gives up in milliseconds.

```ts
lastJson('installing…\nnull\n') // null
lastJson('a\n{"x":1}\nnoise [1,2]\n') // [1, 2]
lastJson('nothing') // throws: no JSON value in output
```

#### `tryLastJson(text, validate?)`

Same as `lastJson`, but returns `undefined` instead of throwing.

```ts
tryLastJson('no json here') // undefined
```

#### `lastJsonObject(text, validate?)`

The last `{…}` object in `text` — a model's answer in prose or a code fence — or `undefined`. It ends at the last `}` and walks back over `{` until the slice parses. Arrays and scalars are not looked for, because prose is full of `[1]`-style brackets.

#### `validate`: plug in zod, valibot or your own guard

All three accept an optional type guard `(value: unknown) => value is T` and then return `T`. A value the guard rejects is skipped: `lastJson` tries an earlier line start, `lastJsonObject` an enclosing brace. No schema library is a dependency.

```ts
import { z } from 'zod'

const Pr = z.object({ number: z.number(), title: z.string() })
const isPr = (v: unknown): v is z.infer<typeof Pr> => Pr.safeParse(v).success

const pr = lastJson(stdout, isPr) // typed as { number: number, title: string }
```

### `clikit/proc`

Process groups and process facts. **POSIX only for groups:** `killGroup` throws on Windows, which has no process groups; `cwdOf` reads `lsof` and `startOf` reads `ps`, so both return `null` where those are missing (Windows, minimal containers). `isAlive` and `spawnGroup` work everywhere.

#### `spawnGroup(cmd, args, { cwd, env })`

`spawn` with `detached: true` and piped stdio: the child leads a new process group, so one signal reaches every grandchild that stays in it. Returns the `ChildProcess`.

#### `killGroup(pid, graceMs = 10_000, snapshot?)`

SIGTERM to the group led by `pid`, up to `graceMs` for it to exit, then SIGKILL — to that group *and* to every detached group started beneath it (found with `ps -axo pid=,ppid=,pgid=`, before the SIGTERM and again after the grace). Groups merely shared with the target are left alone. If `ps` fails (EAGAIN at the process limit), the target group is still killed. Rejects for `pid` 0, 1, negative or non-integer, which `kill(2)` would read as "my group" or "every process".

#### `isAlive(pid)`, `cwdOf(pid)`, `startOf(pid)`

```ts
isAlive(process.pid) // true
cwdOf(process.pid) // '/Users/me/projects/app'
startOf(process.pid) // 'Sat Oct 17 00:51:27 2026'
```

`startOf` pins `LC_ALL=C` and `TZ=UTC`, so the string is the same under any locale or zone. A pid plus its start time names one process even after the pid is reused.

### `clikit/watchdog`

#### `new Watchdog({ wallMs, stallMs }, onFire, now?)`

Call `poke()` on every sign of life and `check()` on a timer. `onFire('timed_out' | 'stalled')` runs once, on the first check at or past a limit (a 45-minute wall clock fires at minute 45). `setLimits()` applies from the next check, `stop()` disarms it, and `now` is injectable for tests.

### `clikit/lock`

#### `acquireLock(path)`

Creates `path` with `O_EXCL` and writes this process's pid; returns `{ release() }`. The directory is created owner-only (`0700`) if needed. A file naming a dead pid, or holding no pid (a crash between create and write), is stale and replaced. A live holder — including one owned by another user (`EPERM`) — throws `LockHeld`.

#### `LockHeld`

`Error` with `pid` and `path`; the message reads `already running (pid 4242); if it is not, delete /path/app.lock`, because after a reboot the pid can name an unrelated process.

### `clikit/env`

```ts
withoutSecrets({ PATH: '/usr/bin', GH_TOKEN: 'ghp_x', HOME: '/home/me' })
// { PATH: '/usr/bin', HOME: '/home/me' }

withoutGitVars({ PATH: '/usr/bin', GIT_DIR: '/repo/.git', GIT_INDEX_FILE: 'x' })
// { PATH: '/usr/bin' }
```

- `withoutSecrets(env, names = SECRET_VARS)` drops the named variables and unset entries. `SECRET_VARS` covers `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY` and `JIRA_API_TOKEN`; pass your own list to change it.
- `withoutGitVars(env)` drops every `GIT_*` variable, so a child started from inside a git hook does not operate on the hook's repository.

### `clikit/log`

#### `stripAnsi(text, { caret? })`

Removes CSI (colour, cursor), OSC (titles, hyperlinks) and two-byte escapes. With `caret: true` it also removes escapes written in caret notation (`^[[31m`), which is how `gh` prints them into a pipe. That stays opt-in because elsewhere `^[` is content.

```ts
stripAnsi('^[[31merror^[[0m \x1B[1mbold\x1B[22m', { caret: true }) // 'error bold'
```

#### `failureSignature(log, { noise? })`

A one-line signature of the failure in a CI or test log: the same across reruns of one failure, different for a different one. It reads through `gh run view --log-failed` job/step/timestamp prefixes (only the first failed job counts), ANSI colour, GitHub `##[error]` annotations and `##[group]` blocks, and turbo task prefixes. It drops durations, absolute paths and line numbers, and skips pnpm `ELIFECYCLE` trailers, deprecation warnings and coverage tables. It prefers a `FAIL` / `error` / `×` / Playwright heading line plus the first other error line, and falls back to the last five lines. Pass `noise` to skip your own tool's status lines.

### `clikit/errors`

```ts
errorMessage('plain string') // 'plain string' (a thrown non-Error never reads as undefined)
errnoCode(err) // 'ENOENT' for fs errors; undefined for a numeric exit code
```

## Recipes

### Run a CLI with a watchdog and parse its JSON answer

```ts
import { lastJson } from 'clikit/json'
import { killGroup, spawnGroup } from 'clikit/proc'
import { Watchdog } from 'clikit/watchdog'

async function runJson(cmd: string, args: string[]): Promise<unknown> {
  const child = spawnGroup(cmd, args, { cwd: process.cwd(), env: process.env as Record<string, string> })
  let stdout = ''
  let reason: string | undefined

  const dog = new Watchdog({ wallMs: 10 * 60_000, stallMs: 2 * 60_000 }, (why) => {
    reason = why
    void killGroup(child.pid!, 5_000)
  })
  const tick = setInterval(() => dog.check(), 1_000)

  child.stdout.on('data', (b) => {
    stdout += b
    dog.poke()
  })
  child.stderr.on('data', () => dog.poke())

  const code = await new Promise<number | null>(r => child.on('close', r))
  clearInterval(tick)
  dog.stop()

  if (reason || code !== 0) {
    throw new Error(`${cmd} ${reason ?? `exited with ${code}`}`)
  }

  return lastJson(stdout)
}

await runJson('pnpm', ['ls', '--json', '--depth', '0'])
```

### Parse `gh … --json` after noise, validated with zod

```ts
import { execFileSync } from 'node:child_process'
import { lastJson } from 'clikit/json'
import { z } from 'zod'

const Prs = z.array(z.object({ number: z.number(), title: z.string() }))
const isPrs = (v: unknown): v is z.infer<typeof Prs> => Prs.safeParse(v).success

const out = execFileSync('gh', ['pr', 'list', '--json', 'number,title'], { encoding: 'utf8' })
for (const pr of lastJson(out, isPrs)) console.log(pr.number, pr.title)
```

### Extract a structured LLM answer

```ts
import { lastJsonObject } from 'clikit/json'
import { z } from 'zod'

const Review = z.object({ verdict: z.enum(['approve', 'request_changes']), issues: z.array(z.string()) })
const isReview = (v: unknown): v is z.infer<typeof Review> => Review.safeParse(v).success

const review = lastJsonObject(modelReply, isReview)
if (!review)
  throw new Error('the model did not answer with a review object')
```

### Single-instance CLI

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, LockHeld } from 'clikit/lock'

let lock
try {
  lock = acquireLock(join(homedir(), '.mytool', 'daemon.lock'))
}
catch (e) {
  if (e instanceof LockHeld) {
    console.error(e.message)
    process.exit(1)
  }
  throw e
}
process.on('exit', () => lock.release())
```

### Clean env for child processes

```ts
import { spawn } from 'node:child_process'
import { withoutGitVars, withoutSecrets } from 'clikit/env'

// No inherited credentials, and no GIT_DIR from the hook this runs in.
spawn('pnpm', ['test'], { env: withoutGitVars(withoutSecrets(process.env)) })
```

### Dedupe CI failures by signature

```ts
import { execFileSync } from 'node:child_process'
import { failureSignature } from 'clikit/log'

const log = execFileSync('gh', ['run', 'view', runId, '--log-failed'], { encoding: 'utf8' })
const sig = failureSignature(log)

if (sig === previousSig) {
  console.log(`same failure twice, handing over to a human: ${sig}`)
}
```

## Compared with single-purpose packages

clikit trades breadth for a small, dependency-free core aimed at one job: supervising other CLIs. Where a dedicated package covers more, it says so below.

### `clikit/json`

| | clikit/json | `JSON.parse` | [jsonrepair](https://www.npmjs.com/package/jsonrepair) | [partial-json](https://www.npmjs.com/package/partial-json) / [best-effort-json-parser](https://www.npmjs.com/package/best-effort-json-parser) | [extract-json-from-string](https://www.npmjs.com/package/extract-json-from-string) | [`JsonOutputParser`](https://www.npmjs.com/package/@langchain/core) (@langchain/core) |
| --- | --- | --- | --- | --- | --- | --- |
| Finds JSON inside noise | yes, the last value | no | no, it repairs a document | no, it completes a truncated one | yes, every match | from fenced or bare model output |
| Broken or truncated JSON | rejected | throws | repaired | completed | skipped | depends on the parser |
| Type guard / schema hook | yes | no | no | no | no | via the framework |
| Runtime dependencies | 0 | — | 0 | 0 | 0 | the LangChain core |

Use jsonrepair or partial-json when the JSON itself is damaged or still streaming; use clikit when the JSON is fine but buried.

### The other modules

| clikit | Alternative | What differs |
| --- | --- | --- |
| `spawnGroup` + `killGroup` | [tree-kill](https://www.npmjs.com/package/tree-kill), [fkill](https://www.npmjs.com/package/fkill), [execa](https://www.npmjs.com/package/execa) | tree-kill signals each pid of the tree once and supports Windows; fkill kills by pid, name or port across platforms; execa is a full process runner with timeouts and `forceKillAfterDelay`. `killGroup` is POSIX-only, but follows grandchildren that started their own detached groups, re-scans after the grace period and refuses `kill(0)` / `kill(-1)`. |
| `Watchdog` | [p-timeout](https://www.npmjs.com/package/p-timeout), execa's `timeout` | Those bound the total time. `Watchdog` adds a stall limit that resets on every sign of life, and leaves the reaction to you. |
| `acquireLock` | [proper-lockfile](https://www.npmjs.com/package/proper-lockfile), [lockfile](https://www.npmjs.com/package/lockfile) | proper-lockfile uses mtime-refreshed lock directories and works over network file systems; lockfile retries and waits. `acquireLock` is a synchronous pidfile that checks whether the holder is alive. |
| `stripAnsi` | [strip-ansi](https://www.npmjs.com/package/strip-ansi) | strip-ansi covers more escape variants. clikit adds opt-in caret notation (`^[[31m`) for `gh` logs. |
| `errorMessage`, `errnoCode` | [serialize-error](https://www.npmjs.com/package/serialize-error) | serialize-error turns a whole error into a plain object and back. These two read the message and the errno name safely from any thrown value. |
| `withoutSecrets`, `withoutGitVars` | [env-var](https://www.npmjs.com/package/env-var) | env-var reads and validates variables. These filter what a child inherits. |

## Limits

- `lastJson` finds objects, arrays and `null` — not bare numbers, strings or booleans, which look like ordinary log lines. Only the value that *ends* the output counts, and on the last line only the first `[` or `{` is tried.
- `lastJsonObject` ends at the last `}` in the text. A stray `}` in prose after the answer hides it. It walks back over at most 1,024 opening braces, so an answer holding more than about a thousand nested objects is not found; that cap keeps hostile input (200,000 nested levels) under a second.
- A `validate` guard can only reject: `lastJsonObject` does not then look for an earlier, separate object.
- `killGroup` is POSIX-only and needs `ps`; `cwdOf` needs `lsof`.
- `acquireLock` is for one machine. It does not wait or retry, and it is not safe on network file systems.
- `failureSignature` is tuned for GitHub Actions, pnpm, turbo, vitest, tsc and Playwright output; other tools fall back to their last five lines.

## Contributing

Issues and pull requests are welcome at [github.com/arenuzzz/clikit](https://github.com/arenuzzz/clikit).

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

Tests pin behaviour, not implementation: a new case should describe what a caller relies on.

## License

[MIT](./LICENSE) © arenuzzz
