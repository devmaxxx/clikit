// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
}, {
  // Examples are scripts a reader runs: they print what they do and await at the top level.
  files: ['examples/**'],
  rules: {
    'no-console': 'off',
    'antfu/no-top-level-await': 'off',
  },
})
