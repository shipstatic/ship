/**
 * @file Consolidated test helpers
 * Simplified test utilities - the "impossible simplicity" approach
 * Replaces: test-helpers.ts (simplified version)
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Test configuration
export const CLI_PATH = path.resolve(process.cwd(), './dist/cli.cjs');

// Hermetic file config: an explicit --config path bypasses the cosmiconfig
// search entirely, so the developer's real ~/.shiprc (or any .shiprc on the
// walk up from the test cwd) can never leak into CLI tests. Tests that
// exercise file config pass their own --config or HOME.
const EMPTY_CONFIG = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'ship-cli-test-')),
  'shiprc.json',
);
fs.writeFileSync(EMPTY_CONFIG, '{}\n');

// CLI execution result type
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// CLI execution options
export interface CliOptions {
  expectFailure?: boolean;
  timeout?: number;
  env?: Record<string, string>;
  /** Lines to write to stdin (joined with \n, stdin closed after) */
  stdin?: string[];
}

/**
 * Execute CLI command using spawn
 */
export async function runCli(args: string[], options: CliOptions = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    // Remove NODE_ENV from the environment so CLI runs normally
    // Don't set environment variables if the test is providing explicit CLI options
    const hasToken = args.includes('--token');
    const hasApiUrl = args.includes('--api-url');
    const hasConfig = args.includes('--config');

    const testEnv: Record<string, string | undefined> = { ...process.env };
    delete testEnv.NODE_ENV;

    // Hermeticity: the developer's own SHIP_* environment must never reach
    // the spawned CLI — a stray SHIP_API_URL would aim the suite at a real
    // API. Scrub inherited values first; a test's own `options.env` wins.
    for (const key of Object.keys(testEnv)) {
      if (key.startsWith('SHIP_')) delete testEnv[key];
    }
    Object.assign(testEnv, options.env, { NO_COLOR: '1', CI: '1' });

    // Only set environment variables if not explicitly testing CLI validation
    // and if they're not already set via options.env
    if (!hasToken && !hasApiUrl) {
      if (!testEnv.SHIP_API_URL) {
        testEnv.SHIP_API_URL = 'http://localhost:13579';
      }
      if (!testEnv.SHIP_TOKEN) {
        testEnv.SHIP_TOKEN =
          'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      }
    }

    // Add the --token flag to ensure explicit authentication (69 chars: ship- + 64 hex chars)
    // But only if no --token is already provided (for validation tests)
    const executionArgs = hasToken
      ? [...args]
      : [
          ...args,
          '--token',
          'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        ];
    if (!hasConfig) {
      // Prepended, never appended — appending would let `--config` be
      // swallowed as the value of a trailing value-taking flag under test.
      executionArgs.unshift('--config', EMPTY_CONFIG);
    }

    const child = spawn('node', [CLI_PATH, ...executionArgs], {
      env: testEnv,
      cwd: path.resolve(__dirname, '../..'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code || 0,
      });
    });

    child.on('error', (err) => {
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      });
    });

    // Write stdin lines if provided, otherwise close stdin immediately
    if (options.stdin) {
      child.stdin.write(`${options.stdin.join('\n')}\n`);
    }
    child.stdin.end();

    // Handle timeout
    const timeout = options.timeout || 10000;
    setTimeout(() => {
      child.kill();
      resolve({
        stdout,
        stderr: `${stderr}\nTimeout exceeded`,
        exitCode: 1,
      });
    }, timeout);
  });
}

/**
 * Parse JSON output from CLI
 */
export function parseJsonOutput(output: string): any {
  const jsonString = output.trim();
  if (!jsonString) {
    throw new Error('No output to parse as JSON');
  }

  try {
    return JSON.parse(jsonString);
  } catch (_e) {
    throw new Error(`Failed to parse JSON. Content: "${jsonString}"`);
  }
}

/**
 * Extract deployment ID from CLI output (strips ANSI codes)
 */
export function extractDeploymentId(output: string): string {
  const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '');
  const match = cleanOutput.match(/([a-z0-9-]+)\s+deployment created ✨/);
  if (!match) throw new Error(`Could not extract deployment ID from: ${output}`);
  return match[1];
}
