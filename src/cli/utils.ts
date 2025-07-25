/**
 * Simple CLI utilities following "impossible simplicity" mantra
 */

/**
 * Style functions for terminal output
 */
export const strong = (text: string) => `\x1b[1m${text}\x1b[0m`;
export const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

/**
 * Clears the current line in the terminal if in TTY mode,
 * otherwise adds a newline to maintain command composability
 */
export const clearLine = (): void => {
  // Only use terminal control sequences if we're connected to a TTY
  if (process.stdout.isTTY) {
    // Use carriage return to move cursor to beginning of line and ANSI escape to clear line
    process.stdout.write('\r\x1b[K');
  } else {
    // In non-TTY mode (pipes, redirects), just output a newline to maintain composability
    process.stdout.write('\n');
  }
};
