/**
 * @file Harness for the child-process CLI tier — spawns the real built binary.
 *
 * Two properties this file is responsible for:
 *
 *   **Hermeticity.** The spawned environment is built from an ALLOWLIST, not
 *   by scrubbing the parent's. A blocklist only removes what someone thought
 *   of: `FORCE_COLOR=3` (iTerm's default) used to reach the child, Node then
 *   printed "NO_COLOR is ignored" onto stderr, and sixteen exact-output tests
 *   failed on a developer's machine while passing in CI. `HOME` points at a
 *   throwaway directory so a CLI command that writes to the home directory
 *   (`config`, `completion install`) can never touch the developer's own.
 *
 *   **Freshness.** These tests execute `dist/cli.cjs`, which `pnpm test` does
 *   not build. Without the guard below, a local run certifies yesterday's
 *   binary while the in-process files test today's source.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMockServerUrl } from '../../mocks/server';

const PACKAGE_ROOT = path.resolve(__dirname, '../../..');

export const CLI_PATH = path.join(PACKAGE_ROOT, 'dist/cli.cjs');

// Resolved per call: the mock server binds an ephemeral port, so the URL is
// only known after `setup-server.ts`'s beforeAll has run.

/** 69 chars: `ship-` + 64 hex — passes the platform's own token validator. */
const TEST_TOKEN = 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

// =============================================================================
// DIST FRESHNESS GUARD
// =============================================================================

function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtimeMs(full) : fs.statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

(function assertFreshDist(): void {
  if (!fs.existsSync(CLI_PATH)) {
    throw new Error(`missing dist — run \`pnpm build\` (expected ${CLI_PATH})`);
  }
  const builtAt = fs.statSync(CLI_PATH).mtimeMs;
  const sourcedAt = newestMtimeMs(path.join(PACKAGE_ROOT, 'src'));
  if (sourcedAt > builtAt) {
    throw new Error(
      'stale dist — run `pnpm build`. The child-process CLI tests execute ' +
        'dist/cli.cjs, and src/ has changed since it was built, so this run ' +
        'would certify a binary that no longer matches the source.',
    );
  }
})();

// =============================================================================
// HERMETIC SANDBOX
// =============================================================================

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-cli-test-'));

/**
 * Default `HOME` for spawned CLIs. Empty, throwaway, and never the developer's:
 * `ship config` writes `~/.shiprc` and `completion install/uninstall` edits
 * `~/.zshrc`. Tests that assert on home-directory contents pass their own.
 */
const SANDBOX_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(SANDBOX_HOME);

/**
 * An explicit `--config` path bypasses cosmiconfig's search entirely, so
 * neither the developer's `~/.shiprc` nor any `.shiprc` on the walk up from the
 * test cwd can leak in. Tests exercising file config pass their own `--config`.
 */
const EMPTY_CONFIG = path.join(SANDBOX, 'shiprc.json');
fs.writeFileSync(EMPTY_CONFIG, '{}\n');

/**
 * The complete environment of a spawned CLI, before `options.env`. Nothing
 * else from the parent process reaches the child — notably not `SHELL`, so
 * shell detection is a test input rather than a property of the machine.
 */
function baseEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    TMPDIR: os.tmpdir(),
    HOME: SANDBOX_HOME,
    NO_COLOR: '1',
    CI: '1',
  };
}

// =============================================================================
// RUNNER
// =============================================================================

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliOptions {
  expectFailure?: boolean;
  timeout?: number;
  /**
   * Overrides on top of the base environment. A value of `undefined` REMOVES
   * the key — the only way to unset a base entry, and load-bearing for the
   * colour tests: `NO_COLOR=''` still counts as set to Node, which then prints
   * "NO_COLOR is ignored" onto stderr alongside `FORCE_COLOR`.
   */
  env?: Record<string, string | undefined>;
  /** Lines written to stdin (joined with \n, stdin closed after) */
  stdin?: string[];
}

/**
 * Execute the built CLI in a child process.
 *
 * Credentials: unless the test passes `--token` or `--api-url`, the CLI is
 * aimed at the mock server with a valid-shaped token, and `--token` is appended
 * so authentication is explicit rather than ambient.
 */
export async function runCli(args: string[], options: CliOptions = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    const hasToken = args.includes('--token');
    const hasApiUrl = args.includes('--api-url');
    const hasConfig = args.includes('--config');

    const env = baseEnv();
    if (!hasToken && !hasApiUrl) {
      env.SHIP_API_URL = getMockServerUrl();
      env.SHIP_TOKEN = TEST_TOKEN;
    }
    for (const [key, value] of Object.entries(options.env ?? {})) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }

    const executionArgs = hasToken ? [...args] : [...args, '--token', TEST_TOKEN];
    if (!hasConfig) {
      // Prepended, never appended — appending would let `--config` be
      // swallowed as the value of a trailing value-taking flag under test.
      executionArgs.unshift('--config', EMPTY_CONFIG);
    }

    const child = spawn('node', [CLI_PATH, ...executionArgs], {
      env,
      cwd: path.join(PACKAGE_ROOT, 'tests'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const kill = setTimeout(() => {
      child.kill();
      settle({ stdout, stderr: `${stderr}\nTimeout exceeded`, exitCode: 1 });
    }, options.timeout ?? 10000);

    function settle(result: CliResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      resolve(result);
    }

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // `code` is null when the process died from a signal — that is a failure,
    // not a success, so it must not collapse to 0.
    child.on('close', (code) => settle({ stdout, stderr, exitCode: code ?? 1 }));
    child.on('error', (err) => settle({ stdout: '', stderr: err.message, exitCode: 1 }));

    if (options.stdin) {
      child.stdin.write(`${options.stdin.join('\n')}\n`);
    }
    child.stdin.end();
  });
}

/** Parse JSON output from the CLI. */
export function parseJsonOutput(output: string): any {
  const jsonString = output.trim();
  if (!jsonString) {
    throw new Error('No output to parse as JSON');
  }
  try {
    return JSON.parse(jsonString);
  } catch {
    throw new Error(`Failed to parse JSON. Content: "${jsonString}"`);
  }
}

/** Extract a deployment ID from CLI output (strips ANSI codes). */
export function extractDeploymentId(output: string): string {
  const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '');
  const match = cleanOutput.match(/([a-z0-9-]+)\s+deployment created ✨/);
  if (!match) throw new Error(`Could not extract deployment ID from: ${output}`);
  return match[1];
}
