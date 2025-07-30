/**
 * @file Consolidated test helpers
 * Simplified test utilities - the "impossible simplicity" approach
 * Replaces: test-helpers.ts (simplified version)
 */

import { spawn } from 'child_process';
import * as path from 'path';

// Test configuration
export const CLI_PATH = path.resolve(__dirname, '../../dist/cli.cjs');

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
}

/**
 * Execute CLI command using spawn
 */
export async function runCli(args: string[], options: CliOptions = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    // Remove NODE_ENV from the environment so CLI runs normally
    const testEnv = { ...process.env, ...options.env };
    delete testEnv.NODE_ENV;
    
    const child = spawn('node', [CLI_PATH, ...args], {
      env: testEnv,
      cwd: path.resolve(__dirname, '../..'),
      stdio: ['pipe', 'pipe', 'pipe']
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
        exitCode: code || 0
      });
    });

    child.on('error', (err) => {
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1
      });
    });

    // Handle timeout
    const timeout = options.timeout || 10000;
    setTimeout(() => {
      child.kill();
      resolve({
        stdout,
        stderr: stderr + '\nTimeout exceeded',
        exitCode: 1
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
  } catch (e) {
    throw new Error(`Failed to parse JSON. Content: "${jsonString}"`);
  }
}

/**
 * Extract deployment ID from CLI output (strips ANSI codes)
 */
export function extractDeploymentId(output: string): string {
  const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '');
  const match = cleanOutput.match(/([a-z0-9-]+)\s+deployment created/);
  if (!match) throw new Error(`Could not extract deployment ID from: ${output}`);
  return match[1];
}