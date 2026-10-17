import { expect, it } from 'vitest'
import { SECRET_VARS, withoutGitVars, withoutSecrets } from '../src/env'

const ENV = { PATH: '/bin', GH_TOKEN: 'shell', GIT_DIR: '/elsewhere', GIT_CONFIG_PARAMETERS: '\'x=y\'', HOME: '/h' }

it('withoutSecrets drops every secret and keeps the rest', () => {
  const out = withoutSecrets({ ...ENV, ...Object.fromEntries(SECRET_VARS.map(k => [k, 'v'])) })

  expect(Object.keys(out).sort()).toEqual(['GIT_CONFIG_PARAMETERS', 'GIT_DIR', 'HOME', 'PATH'])
})

it('withoutSecrets drops only the names it is given, and unset entries', () => {
  expect(withoutSecrets({ PATH: '/bin', NPM_TOKEN: 'n', GH_TOKEN: 'g', EMPTY: undefined }, ['NPM_TOKEN']))
    .toEqual({ PATH: '/bin', GH_TOKEN: 'g' })
})

it('withoutGitVars drops every GIT_ variable and keeps the rest', () => {
  expect(withoutGitVars(ENV)).toEqual({ PATH: '/bin', GH_TOKEN: 'shell', HOME: '/h' })
})
