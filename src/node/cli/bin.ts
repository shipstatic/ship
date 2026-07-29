/**
 * @file The executable. `dist/cli.cjs` is this file; everything it drives lives
 * in `./index.ts`, which is a library.
 *
 * The split exists so that importing the command tree has NO side effects.
 * Until 2026-07-29 the bin block sat at the bottom of `index.ts` behind
 * `if (process.env.NODE_ENV !== 'test')` — production behaviour keyed on a test
 * environment variable, which is a smell on its own and a real constraint in
 * practice: anything wanting to READ the tree (the suite, and now the
 * completion generator) had to either be a test or pretend to be one. A module
 * boundary says the same thing without the conditional, and says it to every
 * caller rather than only to the one that sets the variable.
 *
 * **No `process.exit` on this path.** Outcomes land in `process.exitCode` and
 * the process ends when the event loop drains, so buffered stdout is never
 * truncated on a pipe. Exercised by the child-process smoke tier
 * (`tests/node/cli/smoke.test.ts`), never in-process.
 */
import { CommanderError } from 'commander';
import { buildProgram } from './index.js';

buildProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    // The exit override reports errors before throwing; the bare CommanderError
    // that reaches here only carries the exit code (help/version carry 0).
    if (err instanceof CommanderError) {
      process.exitCode = err.exitCode;
      return;
    }
    throw err;
  });
