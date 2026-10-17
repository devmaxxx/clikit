/* eslint-disable no-control-regex -- ESC and BEL are exactly what terminal escapes are made of */
// CSI sequences (colour, cursor), OSC sequences (titles, hyperlinks) ended by BEL or ST, and two-byte escapes.
const ANSI = /\x1B(?:\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[\x40-\x5A\x5C-\x5F])/g
/* eslint-enable no-control-regex */

// gh writes ESC as a literal `^[` when its output is not a terminal; anywhere else `^[` is content, so it is opt-in.
const CARET_ANSI = /\^\[\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g

export interface StripAnsiOptions {
  /** Also remove escapes written in caret notation (`^[[31m`), as `gh` prints them into a pipe or a log. */
  caret?: boolean
}

/** Removes ANSI escape sequences (colours, cursor moves, OSC hyperlinks) from `text`. */
export function stripAnsi(text: string, options: StripAnsiOptions = {}): string {
  const out = text.replace(ANSI, '')

  return options.caret ? out.replace(CARET_ANSI, '') : out
}
