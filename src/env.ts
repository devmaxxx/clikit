/** Credentials that {@link withoutSecrets} drops by default. */
export const SECRET_VARS: readonly string[] = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'JIRA_API_TOKEN',
]

function keep(env: NodeJS.ProcessEnv, drop: (name: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && !drop(k)) {
      out[k] = v
    }
  }

  return out
}

/**
 * A copy of `env` without the credentials in `names` (default {@link SECRET_VARS}) and without unset entries,
 * ready to pass to a child process.
 */
export function withoutSecrets(env: NodeJS.ProcessEnv, names: readonly string[] = SECRET_VARS): Record<string, string> {
  return keep(env, k => names.includes(k))
}

/**
 * A copy of `env` without any `GIT_*` variable. An inherited `GIT_DIR`, `GIT_WORK_TREE` or `GIT_CONFIG_PARAMETERS`
 * (set inside a git hook, for one) would point a child's git at another repository.
 */
export function withoutGitVars(env: NodeJS.ProcessEnv): Record<string, string> {
  return keep(env, k => k.startsWith('GIT_'))
}
