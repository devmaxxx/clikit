/** Credentials that {@link withoutSecrets} drops by default. */
export const SECRET_VARS: readonly string[] = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITLAB_TOKEN',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'JIRA_API_TOKEN',
]

// `git rev-parse --local-env-vars`: the variables that tie git to one repository. The rest (GIT_SSH_COMMAND,
// GIT_ASKPASS, GIT_AUTHOR_*) carry auth and identity a child may still need.
const GIT_REPO_VARS = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
])

function isGitRepoVar(name: string): boolean {
  return GIT_REPO_VARS.has(name) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name)
}

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
 * A copy of `env` without the variables that bind git to a repository (`git rev-parse --local-env-vars`, plus
 * `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`). An inherited `GIT_DIR`, `GIT_WORK_TREE` or `GIT_CONFIG_PARAMETERS` (set
 * inside a git hook, for one) would point a child's git at another repository. `GIT_SSH_COMMAND`, `GIT_ASKPASS` and
 * other `GIT_*` settings are kept.
 */
export function withoutGitVars(env: NodeJS.ProcessEnv): Record<string, string> {
  return keep(env, isGitRepoVar)
}
