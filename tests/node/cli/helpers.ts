/**
 * @file Consolidated test helpers
 * Simplified test utilities - the "impossible simplicity" approach
 * Replaces: test-helpers.ts (simplified version)
 */

import { spawn } from 'child_process';
import * as path from 'path';

// Test configuration
export const CLI_PATH = path.resolve(process.cwd(), './dist/cli.cjs');

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
    // Don't set environment variables if the test is providing explicit CLI options
    const hasApiKey = args.includes('--api-key');
    const hasApiUrl = args.includes('--api-url');
    
    const testEnv = { 
      ...process.env, 
      ...options.env,
      NO_COLOR: '1',
      CI: '1'
    };
    delete testEnv.NODE_ENV;
    
    // Only set environment variables if not explicitly testing CLI validation
    // and if they're not already set via options.env
    if (!hasApiKey && !hasApiUrl) {
      if (!testEnv.SHIP_API_URL) {
        testEnv.SHIP_API_URL = 'http://localhost:3000';
      }
      if (!testEnv.SHIP_API_KEY) {
        testEnv.SHIP_API_KEY = 'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      }
    }
    
    // Add the --api-key flag to ensure explicit authentication (69 chars: ship- + 64 hex chars)
    // But only if no --api-key is already provided (for validation tests)
    const executionArgs = hasApiKey ? [...args] : [
      ...args,
      '--api-key',
      'ship-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    ];
    
    const child = spawn('node', [CLI_PATH, ...executionArgs], {
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
  const match = cleanOutput.match(/([a-z0-9-]+)\s+deployment created ✨/);
  if (!match) throw new Error(`Could not extract deployment ID from: ${output}`);
  return match[1];
}