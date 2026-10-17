import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/env.ts',
    'src/errors.ts',
    'src/json.ts',
    'src/lock.ts',
    'src/log.ts',
    'src/proc.ts',
    'src/watchdog.ts',
  ],
  dts: true,
  exports: true,
  publint: true,
})
