/**
 * @file CLI runner for testing
 * Provides utilities to run CLI commands in test environment
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Run CLI command and return result
 * @param {string[]} args - CLI arguments
 * @param {object} options - Options
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
export async function runCli(args, options = {}) {
  return new Promise((resolve) => {
    // Use the built CLI from dist/cli.cjs
    const cliPath = join(__dirname, '../../dist/cli.cjs');
    
    const child = spawn('node', [cliPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Force test environment settings
        SHIP_API_URL: 'http://localhost:3000',
        SHIP_API_KEY: 'ship-test1234567890abcdef1234567890abcdef12345678',
        SHIP_DEPLOY_TOKEN: 'token-test1234567890abcdef1234567890abcdef1234567890abcdef',
        NO_COLOR: '1', // Disable colors for predictable output
        CI: '1'        // Disable spinners and interactive features
      },
      ...options
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (exitCode) => {
      resolve({
        exitCode: exitCode || 0,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });

    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message
      });
    });

    // Provide stdin if needed
    if (options.stdin) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

/**
 * Mock server utilities for CLI testing
 */
export class MockApiServerForCli {
  constructor() {
    this.requests = [];
    this.lastRequest = null;
  }

  addRequest(request) {
    this.requests.push(request);
    this.lastRequest = request;
  }

  getLastRequest() {
    return this.lastRequest;
  }

  getAllRequests() {
    return this.requests;
  }

  reset() {
    this.requests = [];
    this.lastRequest = null;
  }
}