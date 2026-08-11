/**
 * @file Harness for the IN-PROCESS CLI tier — drives `buildProgram()` from
 * `src/node/cli/index.ts` directly, so V8 coverage sees the command tree
 * (a subprocess is invisible to it; that is what kept the 917-line entry at
 * 0% while being "tested").
 *
 * The tree itself never calls `process.exit`: outcomes land in
 * `process.exitCode` or ride a thrown `CommanderError`. That makes this
 * harness observation-only — capture output, run, read the code. The
 * child-process tier (`smoke.test.ts`) proves the same tree through the real
 * binary.
 *
 * Hermeticity mirrors the child harness: an explicit `--config` pointing at
 * an empty file defeats the cosmiconfig search (the developer's `.shiprc`
 * can never leak in), and `--api-url`/`--token` default to the per-file mock
 * server and a well-formed test key.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { vi } from 'vitest';
import { buildProgram } from '../../../src/node/cli/index';
import { apiKey } from '../../fixtures/builders';
import { getMockServerUrl } from '../../mocks/server';

/** Built from the shape constants — a literal here would stop passing
 * the platform's own validator the day the width moved. */
export const TEST_TOKEN = apiKey('1');

const EMPTY_CONFIG = join(mkdtempSync(join(tmpdir(), 'ship-inproc-')), 'shiprc.json');
writeFileSync(EMPTY_CONFIG, '{}\n');

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  /** Skip the default `--token` injection — the invocation is anonymous. */
  anonymous?: boolean;
  /** Env vars for the invocation (stubbed, restored afterwards). */
  env?: Record<string, string>;
}

export async function runProgram(args: string[], options: RunOptions = {}): Promise<RunResult> {
  const argv = [...args];
  // Prepended, never appended — appending would let a flag be swallowed as
  // the value of a trailing value-taking option under test.
  if (!argv.includes('--config')) argv.unshift('--config', EMPTY_CONFIG);
  if (!argv.includes('--api-url')) argv.unshift('--api-url', getMockServerUrl());
  if (!argv.includes('--token') && !options.anonymous) argv.unshift('--token', TEST_TOKEN);

  // Deterministic colour environment: the invocation must not inherit the
  // developer's terminal. `FORCE_COLOR=3` (iTerm's default) once turned
  // sixteen exact-output assertions red in the CHILD tier; the in-process
  // tier reads the same `process.env`, so it gets the same discipline. An
  // empty FORCE_COLOR is falsy to `processOptions`, i.e. absent. A test's
  // own `options.env` is applied after and wins.
  vi.stubEnv('NO_COLOR', '1');
  vi.stubEnv('FORCE_COLOR', '');
  for (const [key, value] of Object.entries(options.env ?? {})) {
    vi.stubEnv(key, value);
  }

  let stdout = '';
  let stderr = '';
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts) => {
    stdout += `${parts.map(String).join(' ')}\n`;
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...parts) => {
    stderr += `${parts.map(String).join(' ')}\n`;
  });
  // Commander's own output (configureOutput) writes to the streams directly.
  const outWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  const errWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write);

  // `domains set` falls back to reading a piped deployment id from stdin when
  // it is not a TTY. In-process there is no piped stdin to end, so present a
  // TTY; the pipe behaviour itself is proven in the child-process smoke tier.
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  let exitCode = 0;
  try {
    await buildProgram().parseAsync(argv, { from: 'user' });
    exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      exitCode = err.exitCode;
    } else {
      throw err;
    }
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    outWriteSpy.mockRestore();
    errWriteSpy.mockRestore();
    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
    }
    process.exitCode = previousExitCode;
    vi.unstubAllEnvs();
  }

  return { stdout, stderr, exitCode };
}
