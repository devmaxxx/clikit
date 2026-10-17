// Run a CLI under a wall-clock and a stall limit, and stop its whole process tree when it hangs.
import assert from 'node:assert/strict'
import process from 'node:process'
import { killGroup, spawnGroup } from 'clikit/proc'
import { Watchdog } from 'clikit/watchdog'

if (process.platform === 'win32') {
  console.log('skipped: process groups are POSIX-only')
  process.exit(0)
}

// Prints twice, then hangs with a grandchild that would outlive a plain child.kill().
const child = spawnGroup('sh', ['-c', 'echo working; sleep 0.2; echo still working; sleep 60 & wait'])
let reason

const dog = new Watchdog({ wallMs: 10_000, stallMs: 500 }, (why) => {
  reason = why
  void killGroup(child.pid, 1_000)
})
const tick = setInterval(() => dog.check(), 50)

child.stdout.on('data', (b) => {
  process.stdout.write(`child: ${b}`)
  dog.poke()
})

const signal = await new Promise(r => child.on('close', (_code, sig) => r(sig)))
clearInterval(tick)
dog.stop()

console.log(`watchdog fired: ${reason}; child ended by ${signal}`)
assert.equal(reason, 'stalled')
