// Runs every example against the built package; `pnpm build` first.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import process from 'node:process'

const dir = import.meta.dirname
const self = basename(import.meta.filename)
let failed = 0

for (const file of readdirSync(dir).filter(f => f.endsWith('.mjs') && f !== self).sort()) {
  console.log(`\n▶ ${file}`)
  const { status } = spawnSync(process.execPath, [join(dir, file)], { stdio: 'inherit' })

  if (status !== 0) {
    failed++
  }
}

process.exit(failed === 0 ? 0 : 1)
