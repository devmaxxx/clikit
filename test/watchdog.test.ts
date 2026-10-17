import type { WatchdogReason } from '../src/watchdog'
import { expect, it } from 'vitest'
import { Watchdog } from '../src/watchdog'

const MIN = 60_000

function setup(limits = { wallMs: 45 * MIN, stallMs: 10 * MIN }) {
  const clock = { now: 0 }
  const fired: WatchdogReason[] = []
  const w = new Watchdog(limits, why => fired.push(why), () => clock.now)
  return { clock, fired, w }
}

it('stall fires when no event arrives', () => {
  const { clock, fired, w } = setup()

  clock.now = 9 * MIN
  w.check()
  expect(fired).toEqual([])
  w.poke()
  clock.now = 18 * MIN
  w.check()
  expect(fired).toEqual([])
  clock.now = 20 * MIN
  w.check()
  expect(fired).toEqual(['stalled'])
})

it('wall clock fires even with events', () => {
  const { clock, fired, w } = setup()

  for (let m = 5; m <= 46; m += 5) {
    clock.now = m * MIN
    w.poke()
    w.check()
  }

  expect(fired).toEqual(['timed_out'])
})

it('fires once and setLimits applies now', () => {
  const { clock, fired, w } = setup()

  clock.now = 6 * MIN
  w.setLimits({ wallMs: 45 * MIN, stallMs: 5 * MIN })
  w.check()
  w.check()
  expect(fired).toEqual(['stalled'])
})

it('a limit is reached at its own mark', () => {
  const { clock, fired, w } = setup({ wallMs: 1000, stallMs: 5000 })

  clock.now = 999
  w.check()
  expect(fired).toEqual([])
  clock.now = 1000
  w.check()
  expect(fired).toEqual(['timed_out'])
})

it('a stopped watchdog never fires', () => {
  const { clock, fired, w } = setup()

  w.stop()
  clock.now = 60 * MIN
  w.check()
  expect(fired).toEqual([])
})
