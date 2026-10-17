# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

### Added

- `clikit/json`: `lastJson(text, validate?)`, `tryLastJson(text, validate?)` and `lastJsonObject(text, validate?)` read the JSON value that ends CLI output or the last object in model output, through ANSI escapes and CRLF, with an optional type guard.
- `clikit/proc`: `spawnGroup`, `killGroup` (SIGTERM, grace period, SIGKILL to the group and every detached group beneath it), `isAlive`, `cwdOf` and `startOf`.
- `clikit/watchdog`: `Watchdog` with a wall-clock and a stall limit.
- `clikit/lock`: `acquireLock` pidfile lock with stale-pid detection, and `LockHeld`.
- `clikit/env`: `withoutSecrets`, `withoutGitVars` and `SECRET_VARS`.
- `clikit/log`: `stripAnsi` (with opt-in caret notation) and `failureSignature`.
- `clikit/errors`: `errorMessage` and `errnoCode`.
- The root `clikit` entry re-exports every module.

[0.1.0]: https://github.com/arenuzzz/clikit/releases/tag/v0.1.0
