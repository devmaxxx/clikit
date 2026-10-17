/** The message of a thrown value. Anything that is not an `Error` is stringified, so it never reads `undefined`. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message
  }

  return String(e)
}

/**
 * The errno name Node puts on `code` (`ENOENT`, `EEXIST`, `EPERM`), or `undefined`.
 * A numeric `code`, such as a child process's exit code, is not an errno name and reads as `undefined`.
 */
export function errnoCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) {
    return undefined
  }

  const { code } = e

  return typeof code === 'string' ? code : undefined
}
