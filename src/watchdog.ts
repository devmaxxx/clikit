/** Why a {@link Watchdog} fired: the wall-clock limit passed, or no activity arrived within the stall limit. */
export type WatchdogReason = 'timed_out' | 'stalled'

export interface WatchdogLimits {
  /** Total run time allowed, in milliseconds. */
  wallMs: number
  /** Longest gap allowed between two {@link Watchdog.poke} calls, in milliseconds. */
  stallMs: number
}

/**
 * Tracks a wall-clock limit and a stall limit. Call `poke()` on every sign of life (a line of output) and `check()`
 * on a timer; `onFire` runs once, on the first check at or past a limit.
 */
export class Watchdog {
  private readonly started: number

  private last: number

  private fired = false

  private limits: WatchdogLimits

  private readonly onFire: (why: WatchdogReason) => void

  private readonly now: () => number

  // A monotonic clock by default, so an NTP step cannot fire or delay it. It pauses while the machine sleeps, as the
  // child does: a laptop waking up must not read its own sleep as the child's stall.
  constructor(limits: WatchdogLimits, onFire: (why: WatchdogReason) => void, now: () => number = () => performance.now()) {
    this.limits = limits
    this.onFire = onFire
    this.now = now
    this.started = now()
    this.last = this.started
  }

  /** Records activity, restarting the stall clock. */
  poke(): void {
    this.last = this.now()
  }

  /** Replaces the limits; the next `check()` measures against them. */
  setLimits(limits: WatchdogLimits): void {
    this.limits = limits
  }

  /** Disarms the watchdog; `onFire` will not run. */
  stop(): void {
    this.fired = true
  }

  /** Fires `onFire` if a limit is reached. The wall clock wins when both are. */
  check(): void {
    if (this.fired) {
      return
    }

    const t = this.now()
    // A limit is reached at its own mark: a 45-minute wall clock fires at minute 45, not after it.
    let why: WatchdogReason | null = null

    if (t - this.started >= this.limits.wallMs) {
      why = 'timed_out'
    }
    else if (t - this.last >= this.limits.stallMs) {
      why = 'stalled'
    }

    if (why) {
      this.fired = true
      this.onFire(why)
    }
  }
}
