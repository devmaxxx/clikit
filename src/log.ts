import { stripAnsi } from './ansi'

export { stripAnsi } from './ansi'
export type { StripAnsiOptions } from './ansi'

// gh run view --log-failed writes every line as `<job>\t<step>\t<ISO timestamp> <text>`, a job's first line with a
// BOM. Kept, the prefix and timestamp would make every run's signature unique. The prefix is only taken before a
// timestamp, so a local tool's tab-separated output keeps its first columns.
const CI_LINE = /^([^\t]*)\t[^\t]*\t(?=\uFEFF?\d{4}-\d\d-\d\dT)/
// An annotation's continuation lines carry the prefix without a timestamp; a job already seen vouches for them.
const CI_CONTINUATION = /^([^\t]*)\t[^\t]*\t/
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?\s*/
// turbo's default --log-prefix. Scoped, it cannot be content; unscoped (`pkg:task: `) it reads like
// `warning:Deprecated: `, so it is only taken from a CI line.
const TURBO_SCOPED = /^@[\w.-]+\/[\w.-]+:[A-Z][\w:-]*:(?:\s|$)/i
const TURBO_ANY = /^@?[\w.-]+(?:\/[\w.-]+)?:[A-Z][\w:-]*:(?:\s|$)/i
const ANNOTATION = /^##\[(?:error|warning)\]/
// vitest prints `× adds 3ms`, without the parentheses the join-level rule below strips.
const DURATION = /\s+\d+(?:\.\d+)?m?s$/
const STEP_END = /^Process completed with exit code \d+\.?$/
// Word boundaries, so `errors.module.ts` is not a failing line and `prone to errors` not an error line. Playwright's
// `1) [project] › file › title` heading names the failing test; its `Error:` line only names the assertion kind.
const ANCHOR = /^(?:(?:FAIL|error|Error)\b|ERR!|✗|×|\d+\) \[)/
const ERROR_LINE = /error\b/i

// Lines that say only that something failed, or that change between two runs of one failure.
const NOISE = [
  /ELIFECYCLE|^\[?ERR_PNPM_|^Exit status \d+$/,
  STEP_END,
  /DeprecationWarning|\bDEP\d{4}\b/,
  /\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|/,
  /^-+(?:\|-+)+\|?$/,
  /^(?:Tasks|Cached|Time):(?:\s|$)/,
]

// A tool without a failing line often ends on a constant summary, with what failed a few lines above it.
const FALLBACK_LINES = 5

export interface FailureSignatureOptions {
  /**
   * Extra lines to ignore, such as your own tool's status line (`/^mytool: .* exited with code \d+$/`).
   * A noise line still names the failure when the log holds nothing else.
   */
  noise?: RegExp[]
}

function cleanLines(text: string): string[] {
  let job: string | undefined
  const jobs = new Set<string>()
  const out: string[] = []

  for (const raw of text.split('\n')) {
    const head = CI_CONTINUATION.exec(raw)
    const headJob = head?.[1]
    const ci = CI_LINE.exec(raw) ?? (head && headJob !== undefined && jobs.has(headJob) ? head : null)

    if (ci) {
      const name = ci[1] ?? ''

      job ??= name
      jobs.add(name)

      // --log-failed lists every failed job, an all-green aggregator often last; the first one is the failure.
      if (name !== job) {
        continue
      }
    }

    let l = stripAnsi((ci ? raw.slice(ci[0].length) : raw).trim().replace(TIMESTAMP, ''))

    if (ci) {
      l = stripAnsi(l, { caret: true }).trim().replace(TURBO_ANY, '')
    }

    out.push(l.trim().replace(TURBO_SCOPED, '').replace(ANNOTATION, '').replace(DURATION, '').trim())
  }

  return out
}

function failedStepLines(lines: string[]): string[] {
  const kept: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]

    // What follows the step's end is the job's post-run cleanup.
    if (l === undefined || STEP_END.test(l)) {
      break
    }

    if (l.startsWith('##[group]')) {
      // A group holds a step's command echo and env, or a passing turbo task. An unclosed one is kept.
      const end = lines.indexOf('##[endgroup]', i)

      if (end !== -1) {
        i = end
      }

      continue
    }

    if (l !== '' && l !== '##[endgroup]') {
      kept.push(l)
    }
  }

  return kept
}

/**
 * A one-line signature of the failure in a CI or test log, equal across reruns of the same failure and different
 * for a different one. Reads through `gh run view --log-failed` job/step/timestamp prefixes, ANSI colour (including
 * gh's literal `^[`), GitHub annotations, turbo task prefixes, durations, absolute paths and line numbers, and skips
 * pnpm trailers, deprecation warnings and coverage tables.
 */
export function failureSignature(log: string, options: FailureSignatureOptions = {}): string {
  const noise = [...NOISE, ...(options.noise ?? [])]
  const lines = failedStepLines(cleanLines(log))
  const candidates = lines.filter(l => !noise.some(n => n.test(l)))
  const anchor = candidates.find(l => ANCHOR.test(l))
  const picked = anchor !== undefined ? [anchor] : candidates.slice(-FALLBACK_LINES)
  const first = picked.length > 0 ? picked.join(' | ') : (lines.at(-1) ?? '')
  const err = candidates.find(l => !picked.includes(l) && ERROR_LINE.test(l)) ?? ''

  return `${first} | ${err}`
    .replace(/\(\d+(?:\.\d+)?\s*m?s\)/g, '')
    .replace(/(?:\/[\w.@-]+)+\/([\w.-]+)/g, '$1')
    .replace(/:\d+(?::\d+)?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
